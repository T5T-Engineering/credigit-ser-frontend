"use client";

import { useMemo, useState } from "react";
import { CalendarClock, ClipboardCheck, ListChecks, ShieldX } from "lucide-react";
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
  ProgressBar,
  SegmentedControl,
  Stack,
  StatCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  type DataTableColumn,
  type MatrixCell,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { date } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { kris, overallEffectiveness, rcsaCycle, type AssessmentStatus, type RcsaRisk } from "../data";
import { impactLabels, likelihoodLabels, riskScore, scoreBand } from "../logic";
import { useOpRisk } from "../store";
import { useAuditLog } from "../shared";

const effTones = { Effective: "success", "Partially effective": "warning", Ineffective: "danger", "Not tested": "neutral" } as const;
const statusTones = { Reviewed: "success", Submitted: "info", "In progress": "warning", "Not started": "neutral" } as const;
const actionTones = { Open: "info", "In progress": "warning", Completed: "success", Overdue: "danger" } as const;

export function RcsaPage() {
  const canEdit = useCan("operational-risk", "edit");
  const risks = useOpRisk((s) => s.rcsa);
  const { updateRcsa } = useOpRisk.getState();
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
        out.push({ row: String(l), column: String(i), value: n, label: n ? String(n) : "", tone: band.tone, description: `${band.label} (score ${l * i}) — ${n} risk${n === 1 ? "" : "s"}` });
      }
    return out;
  }, [risks, view]);

  const filtered = cell ? risks.filter((r) => String(r[view].likelihood) === cell.row && String(r[view].impact) === cell.column) : risks;
  const done = risks.filter((r) => r.status === "Submitted" || r.status === "Reviewed").length;
  const controls = risks.flatMap((r) => r.controls);
  const actions = risks.flatMap((r) => r.actions.map((a) => ({ ...a, risk: r })));
  const openActions = actions.filter((a) => a.status !== "Completed");

  const columns: DataTableColumn<RcsaRisk>[] = [
    { id: "title", header: "Risk", accessor: "title", searchable: true, sortable: true, cell: (r) => <div><div className="font-medium text-fg">{r.title}</div><div className="font-mono text-xs text-fg-subtle">{r.id} · {r.businessUnit}</div></div> },
    { id: "category", header: "Indicator category", accessor: "category", sortable: true },
    { id: "owner", header: "Control owner", accessor: "controlOwner", sortable: true },
    { id: "inherent", header: "Inherent", numeric: true, sortable: true, accessor: (r) => riskScore(r.inherent), cell: (r) => <Badge tone={scoreBand(riskScore(r.inherent)).tone}>{riskScore(r.inherent)} · {scoreBand(riskScore(r.inherent)).label}</Badge> },
    { id: "effectiveness", header: "Control effectiveness", accessor: (r) => overallEffectiveness(r), sortable: true, cell: (r) => <StatusBadge status={overallEffectiveness(r)} tones={effTones} /> },
    { id: "residual", header: "Residual", numeric: true, sortable: true, accessor: (r) => riskScore(r.residual), cell: (r) => <Badge tone={scoreBand(riskScore(r.residual)).tone}>{riskScore(r.residual)} · {scoreBand(riskScore(r.residual)).label}</Badge> },
    { id: "status", header: "Assessment", accessor: "status", sortable: true, cell: (r) => <StatusBadge status={r.status} tones={statusTones} /> },
  ];

  const advance = (r: RcsaRisk) => {
    const next: Record<AssessmentStatus, AssessmentStatus> = { "Not started": "In progress", "In progress": "Submitted", Submitted: "Reviewed", Reviewed: "Reviewed" };
    updateRcsa(r.id, { status: next[r.status], assessedAt: DEMO_NOW.toISOString() });
    audit(next[r.status] === "Reviewed" ? "Reviewed RCSA self-assessment" : "Updated RCSA self-assessment", "RCSA", r.id, r.status, next[r.status]);
  };
  const completeAction = (r: RcsaRisk, actionId: string) => {
    updateRcsa(r.id, { actions: r.actions.map((a) => (a.id === actionId ? { ...a, status: "Completed" } : a)) });
    audit("Completed RCSA action plan", "RCSA action", actionId, r.actions.find((a) => a.id === actionId)?.status, "Completed");
  };

  return (
    <ModulePage module="operational-risk" description="Risk & Control Self-Assessment, refreshed on a configurable cycle and mapped to each indicator category so control owners are identified before an incident — structured on COSO's identify-assess-respond-monitor cycle.">
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label={rcsaCycle.name} value={<span className="font-mono">{done}/{risks.length}</span>} hint={`Assessments submitted · closes ${date(rcsaCycle.closesAt)}`} icon={<CalendarClock aria-hidden />}>
            <ProgressBar value={done / risks.length} size="small" ariaLabel="RCSA cycle completion" tone="accent" />
          </StatCard>
          <StatCard label="Controls assessed" value={<span className="font-mono">{controls.length}</span>} hint={`${controls.filter((c) => c.operating === "Effective").length} operating effectively`} icon={<ClipboardCheck aria-hidden />} tone="success" />
          <StatCard label="Ineffective / partially effective" value={<span className="font-mono">{controls.filter((c) => c.operating === "Ineffective" || c.operating === "Partially effective").length}</span>} hint="Controls needing remediation" icon={<ShieldX aria-hidden />} tone="warning" />
          <StatCard label="Open action plans" value={<span className="font-mono">{openActions.length}</span>} hint={`${openActions.filter((a) => a.status === "Overdue").length} overdue`} icon={<ListChecks aria-hidden />} tone={openActions.some((a) => a.status === "Overdue") ? "danger" : "neutral"} />
        </Grid>

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card className="lg:col-span-7">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Risk heat map — likelihood × impact</CardTitle>
                  <CardDescription>Select a cell to filter the register. Banding is a demo default (tenant-configurable).</CardDescription>
                </div>
                <SegmentedControl
                  label="Heat map view"
                  size="small"
                  value={view}
                  onChange={(v) => { setView(v); setCell(null); }}
                  options={[{ value: "inherent", label: "Inherent" }, { value: "residual", label: "Residual" }]}
                />
              </div>
            </CardHeader>
            <CardContent>
              <Matrix
                label={`${view === "inherent" ? "Inherent" : "Residual"} risk heat map`}
                rows={[5, 4, 3, 2, 1].map((l) => ({ id: String(l), label: `${l} · ${likelihoodLabels[l - 1]}` }))}
                columns={[1, 2, 3, 4, 5].map((i) => ({ id: String(i), label: `${i} · ${impactLabels[i - 1]}` }))}
                cells={cells}
                rowAxisLabel="Likelihood"
                columnAxisLabel="Impact"
                onCellClick={(c) => setCell((cur) => (cur?.row === c.row && cur.column === c.column ? null : { row: c.row, column: c.column }))}
                selected={cell}
                legend={[{ label: "Low (1–4)", tone: "success" }, { label: "Medium (5–9)", tone: "warning" }, { label: "High (10–14)", tone: "accent" }, { label: "Critical (15–25)", tone: "danger" }]}
              />
            </CardContent>
          </Card>
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle>Action plans</CardTitle>
              <CardDescription>Remediation for controls rated below Effective</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="small">
                {openActions.length === 0 && <Text tone="muted">No open action plans.</Text>}
                {openActions
                  .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
                  .slice(0, 6)
                  .map((a) => (
                    <div key={a.id} className="flex items-start justify-between gap-3 rounded-3xl bg-surface-sunken p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-fg">{a.title}</div>
                        <Text variant="caption" tone="subtle">{a.risk.title} · {a.owner} · due {date(a.dueAt)}</Text>
                      </div>
                      <StatusBadge status={a.status} tones={actionTones} />
                    </div>
                  ))}
                {openActions.length > 6 && <Text variant="small" tone="muted">+{openActions.length - 6} more — open a risk in the register below to see its action plans.</Text>}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <DataTable
          label="RCSA risk & control register"
          caption={cell ? `Filtered to likelihood ${cell.row} × impact ${cell.column} (${view})` : undefined}
          toolbar={cell ? <Button size="small" variant="tertiary" onClick={() => setCell(null)}>Clear heat-map filter</Button> : undefined}
          columns={columns}
          data={filtered}
          getRowId={(r) => r.id}
          searchable
          searchPlaceholder="Search risks"
          filters={[{ id: "category", label: "Category" }, { id: "status", label: "Assessment" }, { id: "effectiveness", label: "Effectiveness" }]}
          defaultSort={{ id: "residual", direction: "desc" }}
          onRowClick={(r) => setOpenId(r.id)}
          exportFilename="rcsa-register.csv"
          defaultPageSize={20}
        />
      </Stack>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={selected?.title ?? ""}
        description={selected ? `${selected.id} · ${selected.category}` : undefined}
        footer={
          selected && canEdit && selected.status !== "Reviewed" ? (
            <div className="flex justify-end">
              <Button onClick={() => advance(selected)}>{selected.status === "Submitted" ? "Mark reviewed (2nd line)" : selected.status === "Not started" ? "Start self-assessment" : "Submit self-assessment"}</Button>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <Stack gap="large">
            <DescriptionList
              columns={2}
              items={[
                { label: "Business unit", value: selected.businessUnit },
                { label: "Control owner", value: selected.controlOwner },
                { label: "Inherent", value: `L${selected.inherent.likelihood} × I${selected.inherent.impact} = ${riskScore(selected.inherent)}` },
                { label: "Residual", value: `L${selected.residual.likelihood} × I${selected.residual.impact} = ${riskScore(selected.residual)}` },
                { label: "Assessment", status: selected.status, statusTones: statusTones },
                { label: "Last assessed", value: selected.assessedAt ? date(selected.assessedAt) : undefined },
                { label: "Linked KRIs", value: selected.kriIds.map((id) => kris.find((k) => k.id === id)?.name ?? id).join("; ") || undefined, span: 2 },
              ]}
            />
            <div>
              <Text variant="eyebrow" tone="muted">Controls</Text>
              <Table className="mt-2">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Control</TableHeaderCell>
                    <TableHeaderCell>Design</TableHeaderCell>
                    <TableHeaderCell>Operating</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selected.controls.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="text-fg">{c.name}</div>
                        <div className="font-mono text-xs text-fg-subtle">{c.id} · {c.type} · tested {date(c.lastTested)}</div>
                      </TableCell>
                      <TableCell><StatusBadge status={c.design} tones={effTones} /></TableCell>
                      <TableCell><StatusBadge status={c.operating} tones={effTones} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div>
              <Text variant="eyebrow" tone="muted">Action plans</Text>
              <Stack gap="small" className="mt-2">
                {selected.actions.length === 0 && <Text tone="muted" variant="small">No action required — controls effective.</Text>}
                {selected.actions.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-surface-sunken p-3">
                    <div>
                      <div className="text-sm font-medium text-fg">{a.title}</div>
                      <Text variant="caption" tone="subtle">{a.id} · {a.owner} · due {date(a.dueAt)}</Text>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.status} tones={actionTones} />
                      {canEdit && a.status !== "Completed" && <Button size="small" variant="tertiary" onClick={() => completeAction(selected, a.id)}>Mark complete</Button>}
                    </div>
                  </div>
                ))}
              </Stack>
            </div>
          </Stack>
        )}
      </Drawer>
    </ModulePage>
  );
}
