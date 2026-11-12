"use client";

import { useState } from "react";
import { ArrowUpRight, SlidersHorizontal } from "lucide-react";
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
  Field,
  Grid,
  Input,
  KeyValueGrid,
  LineChart,
  Modal,
  ProgressBar,
  RagIndicator,
  Sparkline,
  Stack,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { useCan } from "@/lib/iam/permissions";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, dateTime } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import type { SubmitResult } from "@/lib/platform/operations";
import { getRule, useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { PendingBadge, SubmitOutcome } from "../../operational-risk/operation-ui";
import { ragLabel, roleNames, useAuditLog } from "../../operational-risk/shared";
import { APPETITE_MONTHS, fmtMetric, rasVersion, type AppetiteMetric, type Rag } from "../data";
import { useAppetite } from "../logic";
import { ERM, ermKeys, requestRasChange } from "../platform";
import { useErm } from "../store";

type Row = AppetiteMetric & { rag: Rag };
const ragOrder = { red: 0, amber: 1, green: 2 } as const;

function utilisation(m: Row) {
  return m.direction === "max" ? m.actual / m.limit : m.limit / Math.max(0.0001, m.actual);
}

export function AppetiteSection() {
  const { metrics } = useAppetite();
  const canRequestChange = useCan("enterprise-risk.appetite-limits.request-change");
  const canEscalate = useCan("enterprise-risk.appetite-breaches.escalate");
  const canExport = useCan("enterprise-risk.data.export");
  const escalations = useErm((s) => s.appetiteEscalations);
  const escalateStore = useErm((s) => s.escalateAppetite);
  const audit = useAuditLog();
  const { actor } = useScope();
  const ras = rasVersion();
  const [openId, setOpenId] = useState<string | null>(null);
  const [changing, setChanging] = useState<Row | null>(null);
  const [outcome, setOutcome] = useState<SubmitResult | null>(null);
  const selected = metrics.find((m) => m.id === openId) ?? null;
  const breaches = metrics.filter((m) => m.rag === "red");
  const escalationRoles = (m: Row) => getRule<RoleId[]>(m.rag === "red" ? ermKeys.redEscalationRoles : ermKeys.amberEscalationRoles);

  /** Escalate an Amber/Red metric to the roles in the escalation rules: hooks, audit, event, notification. */
  const escalate = async (m: Row) => {
    const before = await runHooks("enterprise-risk.appetite.escalate.before", { metric: m, roles: escalationRoles(m), actor });
    if (!before.ok) {
      setOutcome({ ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` });
      return;
    }
    const roles = before.ctx.roles;
    const to = roleNames(roles);
    escalateStore(m.id, { by: actor.name, at: DEMO_NOW.toISOString(), to });
    audit("Escalated risk appetite breach", "Risk appetite metric", m.id, `${ragLabel[m.rag]} ${fmtMetric(m, m.actual)}`, `Escalated to ${to}`);
    publish("enterprise-risk.appetite.breach-escalated", { module: ERM, subject: { type: "AppetiteMetric", id: m.id, title: m.name, href: "/enterprise-risk" }, payload: { rag: m.rag, actual: m.actual, limit: m.limit, escalatedTo: roles } });
    notify({
      templateId: "enterprise-risk.appetite-breach",
      toRoles: roles,
      href: "/enterprise-risk",
      data: { metric: m.name, metricId: m.id, status: m.rag === "red" ? "Breach" : "Early warning", actual: fmtMetric(m, m.actual), limit: `${m.direction === "max" ? "≤" : "≥"} ${fmtMetric(m, m.limit)}`, tolerance: fmtMetric(m, m.tolerance), owner: m.owner, escalatedTo: to, by: actor.name, rasVersion: ras.version },
    });
    await runHooks("enterprise-risk.appetite.escalate.after", { metric: m, roles, actor });
  };

  const columns: DataTableColumn<Row>[] = [
    { id: "name", header: "Appetite metric", accessor: "name", searchable: true, cell: (m) => <div><div className="font-medium text-fg">{m.name}</div><div className="font-mono text-xs text-fg-subtle">{m.id} · {m.owner}</div></div> },
    { id: "type", header: "Risk type", accessor: "type", sortable: true },
    { id: "limit", header: "Appetite", numeric: true, accessor: (m) => `${m.direction === "max" ? "≤" : "≥"} ${fmtMetric(m, m.limit)}` },
    { id: "tolerance", header: "Early warning", numeric: true, accessor: (m) => fmtMetric(m, m.tolerance) },
    { id: "actual", header: "Actual", numeric: true, sortable: true, sortValue: (m) => utilisation(m), accessor: (m) => fmtMetric(m, m.actual), cell: (m) => <span className="font-mono font-semibold">{fmtMetric(m, m.actual)}</span> },
    { id: "util", header: "Use of appetite", exportable: false, cell: (m) => <div className="w-32"><ProgressBar value={Math.min(1, utilisation(m))} tone={m.rag === "red" ? "danger" : m.rag === "amber" ? "warning" : "success"} size="small" ariaLabel={`${m.name} utilisation`} showValue /></div> },
    { id: "rag", header: "Status", accessor: (m) => ragLabel[m.rag], sortable: true, sortValue: (m) => ragOrder[m.rag], cell: (m) => <div className="flex flex-col items-start gap-1"><RagIndicator status={m.rag} label={ragLabel[m.rag]} size="small" /><PendingBadge subjectType="AppetiteMetric" subjectId={m.id} /></div> },
    { id: "trend", header: "12 months", exportable: false, cell: (m) => <div className="w-24"><Sparkline values={m.history} tone={m.rag === "red" ? "danger" : m.rag === "amber" ? "warning" : "success"} height={26} /></div> },
  ];

  return (
    <Stack gap="large">
      <SubmitOutcome result={outcome} />
      <Grid columns={{ base: 1, lg: 3 }} gap="large">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Risk Appetite Statement in force</CardTitle>
            <CardDescription>Owned by the CRO (§4.3); captured at onboarding as versioned configuration in the Rules & Parameters Engine</CardDescription>
          </CardHeader>
          <CardContent>
            <KeyValueGrid
              columns={4}
              items={[
                { label: "Version", value: ras.version, mono: true },
                { label: "Approved by", value: ras.approvedBy },
                { label: "Approved", value: date(ras.approvedAt) },
                { label: "Next review", value: date(ras.nextReview) },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Scorecard</CardTitle>
            <CardDescription>{metrics.length} metrics across credit, concentration, capital, liquidity, market and operational risk</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {(["green", "amber", "red"] as const).map((r) => (
                <RagIndicator key={r} status={r} label={`${metrics.filter((m) => m.rag === r).length} ${ragLabel[r]}`} />
              ))}
            </div>
          </CardContent>
        </Card>
      </Grid>

      {breaches.length > 0 && (
        <Alert tone="danger" title={`${breaches.length} appetite breach${breaches.length > 1 ? "es" : ""} — escalation to ${roleNames(getRule<RoleId[]>(ermKeys.redEscalationRoles))}`}>
          {breaches.map((m) => `${m.name}: ${fmtMetric(m, m.actual)} vs ${m.direction === "max" ? "≤" : "≥"} ${fmtMetric(m, m.limit)}${escalations[m.id] ? ` (escalated to ${escalations[m.id]!.to} by ${escalations[m.id]!.by})` : ""}`).join("; ")}.
        </Alert>
      )}

      <DataTable
        label="Risk appetite scorecard"
        columns={columns}
        data={metrics}
        getRowId={(m) => m.id}
        filters={[{ id: "type", label: "Risk type" }, { id: "rag", label: "Status" }]}
        defaultSort={{ id: "rag", direction: "asc" }}
        onRowClick={(m) => setOpenId(m.id)}
        exportFilename={canExport ? "risk-appetite-scorecard.csv" : undefined}
        paginate={false}
      />
      <Text variant="caption" tone="subtle">Limits and early-warning bands are business rules (enterprise-risk.ras.*); regulatory floors are cited from the PRD (CBN 3.2, §6.8.3, §9.1), the rest are illustrative Board RAS values. Changes route through Operations (CRO → Board). CAR, liquidity and NOP actuals are simulated feeds until the Phase 2 engines publish to the spine.</Text>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={selected?.name ?? ""}
        description={selected ? `${selected.id} · ${selected.type} risk` : undefined}
        footer={
          selected && (canRequestChange || canEscalate) ? (
            <div className="flex flex-wrap justify-end gap-2">
              {canRequestChange && (
                <Button variant="tertiary" iconBefore={<SlidersHorizontal aria-hidden />} onClick={() => setChanging(selected)}>
                  Propose limit change
                </Button>
              )}
              {canEscalate && selected.rag !== "green" && !escalations[selected.id] && (
                <Button iconBefore={<ArrowUpRight aria-hidden />} onClick={() => void escalate(selected)}>
                  Escalate to {roleNames(escalationRoles(selected))}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {selected && (
          <Stack gap="large">
            <div className="flex flex-wrap items-center gap-3">
              <RagIndicator status={selected.rag} label={`${ragLabel[selected.rag]} — ${fmtMetric(selected, selected.actual)}`} />
              {escalations[selected.id] && <Badge tone="info">Escalated to {escalations[selected.id]!.to} · {dateTime(escalations[selected.id]!.at)}</Badge>}
              <PendingBadge subjectType="AppetiteMetric" subjectId={selected.id} />
            </div>
            <LineChart
              label={`${selected.name} trend`}
              height={220}
              showLegend
              series={[
                { name: "Actual", points: selected.history.map((y, i) => ({ x: APPETITE_MONTHS[i]!, y })), tone: "accent" },
                { name: "Appetite limit", points: APPETITE_MONTHS.map((x) => ({ x, y: selected.limit })), tone: "danger" },
                { name: "Early warning", points: APPETITE_MONTHS.map((x) => ({ x, y: selected.tolerance })), tone: "warning" },
              ]}
            />
            <DescriptionList
              columns={1}
              layout="inline"
              items={[
                { label: "Formula", value: selected.formula },
                { label: "Source", value: selected.source },
                { label: "Basis of limit", value: selected.basis },
                { label: "Metric owner", value: selected.owner },
                { label: "Appetite", value: `${selected.direction === "max" ? "≤" : "≥"} ${fmtMetric(selected, selected.limit)}` },
                { label: "Early warning", value: fmtMetric(selected, selected.tolerance) },
              ]}
            />
          </Stack>
        )}
      </Drawer>

      <RasChangeModal
        metric={changing}
        onClose={() => setChanging(null)}
        onSubmit={async (limit, tolerance, reason) => {
          const m = changing!;
          const r = await requestRasChange({ metricId: m.id, name: m.name, limit, tolerance, before: { limit: m.limit, tolerance: m.tolerance }, reason });
          if (r.ok) audit("Requested risk appetite change", "Risk appetite metric", m.id, `${m.limit} / ${m.tolerance}`, `${limit} / ${tolerance} · ${r.instance.id}`);
          setOutcome(r);
          setChanging(null);
        }}
      />
    </Stack>
  );
}

function RasChangeModal({ metric, onClose, onSubmit }: { metric: Row | null; onClose: () => void; onSubmit: (limit: number, tolerance: number, reason: string) => void | Promise<void> }) {
  const minComment = useRule<number>("operations.minCommentLength");
  const [limit, setLimit] = useState("");
  const [tol, setTol] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const l = Number(limit || metric?.limit);
  const t = Number(tol || metric?.tolerance);
  const error = !Number.isFinite(l) || !Number.isFinite(t) || l < 0 || t < 0 ? "Enter non-negative numbers" : metric?.direction === "max" ? (t > l ? "Early warning must not exceed the limit" : undefined) : t < l ? "Early warning must not be below the floor" : undefined;
  const reasonError = reason.trim().length < minComment ? `Give a reason (at least ${minComment} characters)` : undefined;
  const reset = () => { setLimit(""); setTol(""); setReason(""); setTouched(false); };
  return (
    <Modal
      open={!!metric}
      onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}
      title="Propose risk appetite change"
      description={metric ? `${metric.id} — ${metric.name}. Routed through Operations (CRO review, Board approval); applies once approved.` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={() => { setTouched(true); if (error || reasonError) return; void onSubmit(l, t, reason.trim()); reset(); }}>Submit for approval</Button>
        </div>
      }
    >
      {metric && (
        <Stack gap="medium">
          <Grid columns={2} gap="medium">
            <Field label={metric.direction === "max" ? "Appetite limit (max)" : "Appetite floor (min)"} htmlFor="ras-limit" description={`Now ${fmtMetric(metric, metric.limit)}`} error={touched ? error : undefined}>
              <Input id="ras-limit" inputMode="decimal" value={limit} placeholder={String(metric.limit)} onChange={(e) => setLimit(e.target.value)} />
            </Field>
            <Field label="Early warning" htmlFor="ras-tol" description={`Now ${fmtMetric(metric, metric.tolerance)}`}>
              <Input id="ras-tol" inputMode="decimal" value={tol} placeholder={String(metric.tolerance)} onChange={(e) => setTol(e.target.value)} />
            </Field>
          </Grid>
          <Field label="Reason" htmlFor="ras-reason" required error={touched ? reasonError : undefined}>
            <Textarea id="ras-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Text variant="caption" tone="subtle">Basis: {metric.basis}</Text>
        </Stack>
      )}
    </Modal>
  );
}
