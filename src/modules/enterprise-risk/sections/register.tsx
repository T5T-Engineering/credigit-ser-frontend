"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DescriptionList,
  Drawer,
  Grid,
  Matrix,
  MiniBarList,
  SegmentedControl,
  Stack,
  Text,
  type DataTableColumn,
  type MatrixCell,
} from "@credigit/web-ui";
import { useCan } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { date } from "@/lib/format";
import { impactLabels, likelihoodLabels, riskScore, scoreBand } from "../../operational-risk/logic";
import { useAuditLog } from "../../operational-risk/shared";
import type { EnterpriseRisk } from "../data";
import { useErm } from "../store";

const trendTone = { Rising: "danger", Stable: "neutral", Falling: "success" } as const;

export function RegisterSection() {
  const risks = useErm((s) => s.risks);
  const updateRisk = useErm((s) => s.updateRisk);
  const canEdit = useCan("enterprise-risk", "edit");
  const audit = useAuditLog();
  const [view, setView] = useState<"inherent" | "residual">("residual");
  const [cell, setCell] = useState<{ row: string; column: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = risks.find((r) => r.id === openId) ?? null;

  const cells: MatrixCell[] = useMemo(() => {
    const out: MatrixCell[] = [];
    for (let l = 5; l >= 1; l--)
      for (let i = 1; i <= 5; i++) {
        const n = risks.filter((r) => r[view].likelihood === l && r[view].impact === i).length;
        const band = scoreBand(l * i);
        out.push({ row: String(l), column: String(i), value: n, label: n ? String(n) : "", tone: band.tone, description: `${band.label} — ${n} risk${n === 1 ? "" : "s"}` });
      }
    return out;
  }, [risks, view]);
  const filtered = cell ? risks.filter((r) => String(r[view].likelihood) === cell.row && String(r[view].impact) === cell.column) : risks;
  const top = [...risks].sort((a, b) => riskScore(b.residual) - riskScore(a.residual)).slice(0, 6);

  const columns: DataTableColumn<EnterpriseRisk>[] = [
    { id: "title", header: "Risk", accessor: "title", searchable: true, cell: (r) => <div><div className="font-medium text-fg">{r.title}</div><div className="font-mono text-xs text-fg-subtle">{r.id}</div></div> },
    { id: "category", header: "Category", accessor: "category", sortable: true },
    { id: "owner", header: "Risk owner", accessor: "owner", sortable: true },
    { id: "inherent", header: "Inherent", numeric: true, sortable: true, accessor: (r) => riskScore(r.inherent), cell: (r) => <Badge tone={scoreBand(riskScore(r.inherent)).tone}>{riskScore(r.inherent)}</Badge> },
    { id: "residual", header: "Residual", numeric: true, sortable: true, accessor: (r) => riskScore(r.residual), cell: (r) => <Badge tone={scoreBand(riskScore(r.residual)).tone}>{riskScore(r.residual)} · {scoreBand(riskScore(r.residual)).label}</Badge> },
    { id: "trend", header: "Trend", accessor: "trend", sortable: true, cell: (r) => <Badge tone={trendTone[r.trend]} variant="outline">{r.trend}</Badge> },
    { id: "response", header: "Response", accessor: "response", sortable: true },
    { id: "stage", header: "COSO stage", accessor: "stage", sortable: true },
  ];

  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, lg: 12 }} gap="large">
        <Card className="lg:col-span-7">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Enterprise heat map</CardTitle>
                <CardDescription>Likelihood × impact. Select a cell to filter the register.</CardDescription>
              </div>
              <SegmentedControl label="Heat map view" size="small" value={view} onChange={(v) => { setView(v); setCell(null); }} options={[{ value: "inherent", label: "Inherent" }, { value: "residual", label: "Residual" }]} />
            </div>
          </CardHeader>
          <CardContent>
            <Matrix
              label={`Enterprise ${view} risk heat map`}
              rows={[5, 4, 3, 2, 1].map((l) => ({ id: String(l), label: `${l} · ${likelihoodLabels[l - 1]}` }))}
              columns={[1, 2, 3, 4, 5].map((i) => ({ id: String(i), label: `${i} · ${impactLabels[i - 1]}` }))}
              cells={cells}
              rowAxisLabel="Likelihood"
              columnAxisLabel="Impact"
              selected={cell}
              onCellClick={(c) => setCell((cur) => (cur?.row === c.row && cur.column === c.column ? null : { row: c.row, column: c.column }))}
              legend={[{ label: "Low", tone: "success" }, { label: "Medium", tone: "warning" }, { label: "High", tone: "accent" }, { label: "Critical", tone: "danger" }]}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Top residual risks</CardTitle>
            <CardDescription>Ranked by residual score (likelihood × impact)</CardDescription>
          </CardHeader>
          <CardContent>
            <MiniBarList label="Top residual risks" items={top.map((r) => ({ label: r.title, value: riskScore(r.residual), meta: `${r.category} · ${r.owner}`, tone: scoreBand(riskScore(r.residual)).tone }))} max={25} />
          </CardContent>
        </Card>
      </Grid>

      <DataTable
        label="Enterprise risk register"
        caption={cell ? `Filtered to likelihood ${cell.row} × impact ${cell.column} (${view})` : undefined}
        toolbar={cell ? <Button size="small" variant="tertiary" onClick={() => setCell(null)}>Clear heat-map filter</Button> : undefined}
        columns={columns}
        data={filtered}
        getRowId={(r) => r.id}
        searchable
        searchPlaceholder="Search risks"
        filters={[{ id: "category", label: "Category" }, { id: "response", label: "Response" }, { id: "stage", label: "COSO stage" }]}
        defaultSort={{ id: "residual", direction: "desc" }}
        onRowClick={(r) => setOpenId(r.id)}
        exportFilename="enterprise-risk-register.csv"
        defaultPageSize={20}
      />
      <Text variant="caption" tone="subtle">Responses follow ISO 31000 treatment options; stages follow COSO ERM’s identify-assess-respond-monitor cycle (§9.2).</Text>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={selected?.title ?? ""}
        description={selected ? `${selected.id} · ${selected.category}` : undefined}
        footer={
          selected && canEdit ? (
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  updateRisk(selected.id, { lastReviewed: DEMO_NOW.toISOString() });
                  audit("Reviewed enterprise risk", "Enterprise risk", selected.id, `Last reviewed ${date(selected.lastReviewed)}`, `Reviewed ${date(DEMO_NOW)}`);
                }}
              >
                Record review
              </Button>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <DescriptionList
            columns={2}
            items={[
              { label: "Risk owner", value: selected.owner },
              { label: "Trend", value: selected.trend },
              { label: "Inherent", value: `L${selected.inherent.likelihood} × I${selected.inherent.impact} = ${riskScore(selected.inherent)} (${scoreBand(riskScore(selected.inherent)).label})` },
              { label: "Residual", value: `L${selected.residual.likelihood} × I${selected.residual.impact} = ${riskScore(selected.residual)} (${scoreBand(riskScore(selected.residual)).label})` },
              { label: "Response", value: selected.response },
              { label: "COSO stage", value: selected.stage },
              { label: "Key controls", value: selected.keyControls, span: 2 },
              { label: "Linked appetite metric", value: selected.linkedMetric, mono: true },
              { label: "Last reviewed", value: date(selected.lastReviewed) },
            ]}
          />
        )}
      </Drawer>
    </Stack>
  );
}
