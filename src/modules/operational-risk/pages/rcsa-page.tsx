"use client";

import { useMemo, useState } from "react";
import { CalendarClock, ClipboardCheck, ListChecks, ShieldX } from "lucide-react";
import {
  Alert,
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
import { useCan } from "@/lib/iam/permissions";
import { date } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { publish } from "@/lib/platform/events";
import { submitOperation, useMyApprovalQueue, usePendingFor, type SubmitResult } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { kris, overallEffectiveness, rcsaCycle, type RcsaRisk } from "../data";
import { riskScales, riskScore, scoreBand, scoreLegend } from "../logic";
import { PendingBadge, SubmitOutcome } from "../operation-ui";
import { OPRISK, orKeys, type RcsaSignOffPayload } from "../platform";
import { useOpRisk } from "../store";
import { useAuditLog, useRuleValues } from "../shared";

const effTones = { Effective: "success", "Partially effective": "warning", Ineffective: "danger", "Not tested": "neutral" } as const;
const statusTones = { Reviewed: "success", Submitted: "info", "In progress": "warning", "Not started": "neutral" } as const;
const actionTones = { Open: "info", "In progress": "warning", Completed: "success", Overdue: "danger" } as const;

function RcsaActions({
  risk,
  onStart,
  onSubmit,
  canStart,
  canSubmit,
}: {
  risk: RcsaRisk;
  onStart: (r: RcsaRisk) => void;
  onSubmit: (r: RcsaRisk) => Promise<void>;
  /** Holds operational-risk.rcsa.update (starts the self-assessment). */
  canStart: boolean;
  /** Holds operational-risk.rcsa.submit (routes the assessment for second-line sign-off). */
  canSubmit: boolean;
}) {
  const pending = usePendingFor("RcsaRisk", risk.id);
  if (pending) return <Alert tone="info">Second-line sign-off is with the approvers in Operations ({pending.id}).</Alert>;
  if (risk.status === "Not started" ? !canStart : !canSubmit) return null;
  return (
    <div className="flex justify-end">
      {risk.status === "Not started" ? (
        <Button onClick={() => onStart(risk)}>Start self-assessment</Button>
      ) : (
        <Button onClick={() => void onSubmit(risk)}>{risk.status === "Submitted" ? "Route for second-line sign-off" : "Submit for second-line sign-off"}</Button>
      )}
    </div>
  );
}

export function RcsaPage() {
  const canUpdate = useCan("operational-risk.rcsa.update");
  const canSubmit = useCan("operational-risk.rcsa.submit");
  const canExport = useCan("operational-risk.registers.export");
  const { actor } = useScope();
  const rules = useRuleValues();
  const cycleMonths = useRule<number>(orKeys.rcsaCycleMonths);
  const allRisks = useOpRisk((s) => s.rcsa);
  const { updateRcsa } = useOpRisk.getState();
  const audit = useAuditLog();
  const queue = useMyApprovalQueue(actor);
  const [view, setView] = useState<"inherent" | "residual">("residual");
  const [cell, setCell] = useState<{ row: string; column: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [scopeView, setScopeView] = useState<"all" | "mine">("all");
  const [outcome, setOutcome] = useState<SubmitResult | null>(null);
  const awaitingMe = new Set(queue.filter((o) => o.operationType === "operational-risk.rcsa.sign-off").map((o) => o.subject.id));
  /** "My assessments": ones I submitted, or awaiting my second-line sign-off. */
  const mine = allRisks.filter((r) => r.submittedById === actor.id || awaitingMe.has(r.id));
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
        out.push({ row: String(l), column: String(i), value: n, label: n ? String(n) : "", tone: band.tone, description: `${band.label} (score ${l * i}) — ${n} risk${n === 1 ? "" : "s"}` });
      }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rules` re-runs the banding when a rule changes
  }, [risks, view, lMax, iMax, rules]);

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
    {
      id: "status",
      header: "Assessment",
      accessor: "status",
      sortable: true,
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={r.status} tones={statusTones} />
          <PendingBadge subjectType="RcsaRisk" subjectId={r.id} />
        </div>
      ),
    },
  ];

  const start = (r: RcsaRisk) => {
    updateRcsa(r.id, { status: "In progress", assessedAt: DEMO_NOW.toISOString() });
    audit("Started RCSA self-assessment", "RCSA", r.id, r.status, "In progress");
  };
  /** Submit the self-assessment and route the second-line sign-off through Operations. */
  const submitForSignOff = async (r: RcsaRisk) => {
    const res = await submitOperation<RcsaSignOffPayload>("operational-risk.rcsa.sign-off", {
      title: `RCSA sign-off — ${r.title}`,
      subject: { type: "RcsaRisk", id: r.id, title: r.title, href: "/operational-risk/rcsa" },
      payload: { riskId: r.id, title: r.title, residual: riskScore(r.residual), comment: "Self-assessment submitted for second-line review" },
      summary: [
        { label: "Risk", value: `${r.id} — ${r.title}` },
        { label: "Business unit", value: r.businessUnit },
        { label: "Residual score", value: `${riskScore(r.residual)} (${scoreBand(riskScore(r.residual)).label})` },
        { label: "Control effectiveness", value: overallEffectiveness(r) },
        { label: "Open actions", value: String(r.actions.filter((a) => a.status !== "Completed").length) },
      ],
    });
    setOutcome(res);
    if (!res.ok) return;
    if (r.status !== "Submitted" && !res.applied) updateRcsa(r.id, { status: "Submitted", submittedBy: actor.name, submittedById: actor.id, assessedAt: DEMO_NOW.toISOString() });
    audit("Submitted RCSA self-assessment for sign-off", "RCSA", r.id, r.status, `Submitted · ${res.instance.id}`);
    publish("operational-risk.rcsa.submitted", { module: OPRISK, subject: { type: "RcsaRisk", id: r.id, title: r.title, href: "/operational-risk/rcsa" }, payload: { operationId: res.instance.id } });
  };
  const completeAction = (r: RcsaRisk, actionId: string) => {
    updateRcsa(r.id, { actions: r.actions.map((a) => (a.id === actionId ? { ...a, status: "Completed" } : a)) });
    audit("Completed RCSA action plan", "RCSA action", actionId, r.actions.find((a) => a.id === actionId)?.status, "Completed");
    publish("operational-risk.rcsa.action-completed", { module: OPRISK, subject: { type: "RcsaRisk", id: r.id, title: r.title, href: "/operational-risk/rcsa" }, payload: { actionId } });
  };

  return (
    <ModulePage module="operational-risk" description="Risk & Control Self-Assessment, refreshed on a configurable cycle and mapped to each indicator category so control owners are identified before an incident — structured on COSO's identify-assess-respond-monitor cycle.">
      <Stack gap="large">
        <SubmitOutcome result={outcome} />
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label={rcsaCycle.name} value={<span className="font-mono">{done}/{allRisks.length}</span>} hint={`Submitted · every ${cycleMonths} months · closes ${date(rcsaCycle.closesAt)}`} icon={<CalendarClock aria-hidden />}>
            <ProgressBar value={done / allRisks.length} size="small" ariaLabel="RCSA cycle completion" tone="accent" />
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
                  <CardDescription>Select a cell to filter the register. Scales and banding are business rules.</CardDescription>
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
                rows={scales.likelihood.map((_, i) => lMax - i).map((l) => ({ id: String(l), label: `${l} · ${scales.likelihood[l - 1]}` }))}
                columns={scales.impact.map((label, i) => ({ id: String(i + 1), label: `${i + 1} · ${label}` }))}
                cells={cells}
                rowAxisLabel="Likelihood"
                columnAxisLabel="Impact"
                onCellClick={(c) => setCell((cur) => (cur?.row === c.row && cur.column === c.column ? null : { row: c.row, column: c.column }))}
                selected={cell}
                legend={scoreLegend()}
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

        <div className="flex justify-end">
          <SegmentedControl
            label="Register scope"
            size="small"
            value={scopeView}
            onChange={setScopeView}
            options={[
              { value: "all", label: `All risks (${allRisks.length})` },
              { value: "mine", label: `My assessments (${mine.length})` },
            ]}
          />
        </div>
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
          exportFilename={canExport ? "rcsa-register.csv" : undefined}
          defaultPageSize={20}
        />
      </Stack>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={selected?.title ?? ""}
        description={selected ? `${selected.id} · ${selected.category}` : undefined}
        footer={selected && (canUpdate || canSubmit) && selected.status !== "Reviewed" ? <RcsaActions risk={selected} onStart={start} onSubmit={submitForSignOff} canStart={canUpdate} canSubmit={canSubmit} /> : undefined}
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
                { label: "Submitted by", value: selected.submittedBy },
                { label: "Signed off by", value: selected.reviewedBy },
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
                      {canUpdate && a.status !== "Completed" && <Button size="small" variant="tertiary" onClick={() => completeAction(selected, a.id)}>Mark complete</Button>}
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
