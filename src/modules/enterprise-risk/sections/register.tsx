"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Field,
  Modal,
  SubmitButton,
  Textarea,
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
import { useCan } from "@/lib/iam/permissions";
import { DEMO_NOW } from "@/lib/data/seed";
import { date } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { submitOperation, usePendingFor, type SubmitResult } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { riskScales, riskScore, scoreBand, scoreLegend } from "../../operational-risk/logic";
import { PendingBadge, SubmitOutcome } from "../../operational-risk/operation-ui";
import { useAuditLog, useRuleValues } from "../../operational-risk/shared";
import type { EnterpriseRisk } from "../data";
import { ERM, type RiskAcceptancePayload } from "../platform";
import { useErm } from "../store";

const trendTone = { Rising: "danger", Stable: "neutral", Falling: "success" } as const;

function AcceptButton({ risk, onClick }: { risk: EnterpriseRisk; onClick: () => void }) {
  const pending = usePendingFor("EnterpriseRisk", risk.id);
  return (
    <Button variant="tertiary" disabled={!!pending} onClick={onClick}>
      {pending ? "Acceptance awaiting approval" : "Request risk acceptance"}
    </Button>
  );
}

function AcceptanceModal({ risk, onClose, onSubmit }: { risk: EnterpriseRisk | null; onClose: () => void; onSubmit: (r: EnterpriseRisk, rationale: string) => void | Promise<void> }) {
  const minComment = useRule<number>("operations.minCommentLength");
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const error = text.trim().length < minComment ? `Give a rationale (at least ${minComment} characters)` : undefined;
  const close = () => { setText(""); setTouched(false); onClose(); };
  return (
    <Modal
      open={!!risk}
      onOpenChange={(o) => !o && close()}
      title="Request risk acceptance"
      description={risk ? `${risk.id} — ${risk.title}. Accepting (tolerating) the residual risk is approved through the Operations workflow.` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={close}>Cancel</Button>
          <SubmitButton onClick={() => { setTouched(true); if (error || !risk) return; void onSubmit(risk, text.trim()); setText(""); setTouched(false); }}>Submit for approval</SubmitButton>
        </div>
      }
    >
      <Field label="Rationale" htmlFor="acc-why" required error={touched ? error : undefined}>
        <Textarea id="acc-why" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function RegisterSection() {
  const allRisks = useErm((s) => s.risks);
  const updateRisk = useErm((s) => s.updateRisk);
  const canRequestAcceptance = useCan("enterprise-risk.risks.request-acceptance");
  const canReview = useCan("enterprise-risk.risks.review");
  const canExport = useCan("enterprise-risk.data.export");
  const audit = useAuditLog();
  const { actor } = useScope();
  const rules = useRuleValues();
  const [view, setView] = useState<"inherent" | "residual">("residual");
  const [cell, setCell] = useState<{ row: string; column: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [scopeView, setScopeView] = useState<"all" | "mine">("all");
  const [accepting, setAccepting] = useState<EnterpriseRisk | null>(null);
  const [outcome, setOutcome] = useState<SubmitResult | null>(null);
  /** "My risks": risks owned by my role. */
  const mine = allRisks.filter((r) => r.ownerRole === actor.roleId);
  const risks = scopeView === "mine" ? mine : allRisks;
  const selected = allRisks.find((r) => r.id === openId) ?? null;
  const scales = riskScales();
  const lMax = scales.likelihood.length;
  const iMax = scales.impact.length;

  const cells: MatrixCell[] = useMemo(() => {
    const out: MatrixCell[] = [];
    for (let l = lMax; l >= 1; l--)
      for (let i = 1; i <= iMax; i++) {
        const n = risks.filter((r) => r[view].likelihood === l && r[view].impact === i).length;
        const band = scoreBand(l * i);
        out.push({ row: String(l), column: String(i), value: n, label: n ? String(n) : "", tone: band.tone, description: `${band.label} — ${n} risk${n === 1 ? "" : "s"}` });
      }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rules` re-runs the banding when a rule changes
  }, [risks, view, lMax, iMax, rules]);
  const filtered = cell ? risks.filter((r) => String(r[view].likelihood) === cell.row && String(r[view].impact) === cell.column) : risks;
  const top = [...risks].sort((a, b) => riskScore(b.residual) - riskScore(a.residual)).slice(0, 6);

  const columns: DataTableColumn<EnterpriseRisk>[] = [
    { id: "title", header: "Risk", accessor: "title", searchable: true, cell: (r) => <div><div className="font-medium text-fg">{r.title}</div><div className="font-mono text-xs text-fg-subtle">{r.id}</div></div> },
    { id: "category", header: "Category", accessor: "category", sortable: true },
    { id: "owner", header: "Risk owner", accessor: "owner", sortable: true },
    { id: "inherent", header: "Inherent", numeric: true, sortable: true, accessor: (r) => riskScore(r.inherent), cell: (r) => <Badge tone={scoreBand(riskScore(r.inherent)).tone}>{riskScore(r.inherent)}</Badge> },
    { id: "residual", header: "Residual", numeric: true, sortable: true, accessor: (r) => riskScore(r.residual), cell: (r) => <Badge tone={scoreBand(riskScore(r.residual)).tone}>{riskScore(r.residual)} · {scoreBand(riskScore(r.residual)).label}</Badge> },
    { id: "trend", header: "Trend", accessor: "trend", sortable: true, cell: (r) => <Badge tone={trendTone[r.trend]} variant="outline">{r.trend}</Badge> },
    { id: "response", header: "Response", accessor: "response", sortable: true, cell: (r) => <div className="flex flex-col items-start gap-1"><span>{r.response}{r.acceptedBy ? " (accepted)" : ""}</span><PendingBadge subjectType="EnterpriseRisk" subjectId={r.id} /></div> },
    { id: "stage", header: "COSO stage", accessor: "stage", sortable: true },
  ];

  return (
    <Stack gap="large">
      <SubmitOutcome result={outcome} />
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
              rows={scales.likelihood.map((_, i) => lMax - i).map((l) => ({ id: String(l), label: `${l} · ${scales.likelihood[l - 1]}` }))}
              columns={scales.impact.map((label, i) => ({ id: String(i + 1), label: `${i + 1} · ${label}` }))}
              cells={cells}
              rowAxisLabel="Likelihood"
              columnAxisLabel="Impact"
              selected={cell}
              onCellClick={(c) => setCell((cur) => (cur?.row === c.row && cur.column === c.column ? null : { row: c.row, column: c.column }))}
              legend={scoreLegend()}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Top residual risks</CardTitle>
            <CardDescription>Ranked by residual score (likelihood × impact)</CardDescription>
          </CardHeader>
          <CardContent>
            <MiniBarList label="Top residual risks" items={top.map((r) => ({ label: r.title, value: riskScore(r.residual), meta: `${r.category} · ${r.owner}`, tone: scoreBand(riskScore(r.residual)).tone }))} max={lMax * iMax} />
          </CardContent>
        </Card>
      </Grid>

      <div className="flex justify-end">
        <SegmentedControl
          label="Register scope"
          size="small"
          value={scopeView}
          onChange={setScopeView}
          options={[
            { value: "all", label: `All risks (${allRisks.length})` },
            { value: "mine", label: `My risks (${mine.length})` },
          ]}
        />
      </div>
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
        exportFilename={canExport ? "enterprise-risk-register.csv" : undefined}
        defaultPageSize={20}
      />
      <Text variant="caption" tone="subtle">Responses follow ISO 31000 treatment options; stages follow COSO ERM’s identify-assess-respond-monitor cycle.</Text>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={selected?.title ?? ""}
        description={selected ? `${selected.id} · ${selected.category}` : undefined}
        footer={
          selected && (canRequestAcceptance || canReview) ? (
            <div className="flex flex-wrap justify-end gap-2">
              {canRequestAcceptance && !selected.acceptedBy && <AcceptButton risk={selected} onClick={() => setAccepting(selected)} />}
              {canReview && (
                <SubmitButton
                  onClick={() => {
                    updateRisk(selected.id, { lastReviewed: DEMO_NOW.toISOString() });
                    audit("Reviewed enterprise risk", "Enterprise risk", selected.id, `Last reviewed ${date(selected.lastReviewed)}`, `Reviewed ${date(DEMO_NOW)}`);
                    publish("enterprise-risk.risk.reviewed", { module: ERM, subject: { type: "EnterpriseRisk", id: selected.id, title: selected.title, href: "/enterprise-risk/register" } });
                  }}
                >
                  Record review
                </SubmitButton>
              )}
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
              { label: "Risk accepted by", value: selected.acceptedBy ? `${selected.acceptedBy}, ${date(selected.acceptedAt!)}` : undefined },
              { label: "Acceptance rationale", value: selected.acceptanceRationale, span: 2 },
            ]}
          />
        )}
      </Drawer>

      <AcceptanceModal
        risk={accepting}
        onClose={() => setAccepting(null)}
        onSubmit={async (r, rationale) => {
          const res = await submitOperation<RiskAcceptancePayload>("enterprise-risk.risk.acceptance", {
            title: `Accept risk ${r.id} — ${r.title}`,
            subject: { type: "EnterpriseRisk", id: r.id, title: r.title, href: "/enterprise-risk/register" },
            payload: { riskId: r.id, title: r.title, residual: riskScore(r.residual), rationale, previousResponse: r.response },
            summary: [
              { label: "Risk", value: `${r.id} — ${r.title}` },
              { label: "Residual", value: `${riskScore(r.residual)} (${scoreBand(riskScore(r.residual)).label})` },
              { label: "Current response", value: r.response },
              { label: "Rationale", value: rationale },
            ],
          });
          if (res.ok) audit("Requested risk acceptance", "Enterprise risk", r.id, r.response, `Tolerate · ${res.instance.id}`);
          setOutcome(res);
          setAccepting(null);
        }}
      />
    </Stack>
  );
}
