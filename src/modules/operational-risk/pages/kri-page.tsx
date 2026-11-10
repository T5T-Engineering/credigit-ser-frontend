"use client";

import { useState } from "react";
import { Activity, AlertTriangle, ArrowUpRight, Gauge as GaugeIcon, ShieldAlert, SlidersHorizontal } from "lucide-react";
import {
  AiInsightCard,
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
  LineChart,
  MetricDelta,
  Modal,
  RagIndicator,
  SectionHeader,
  SegmentedControl,
  Sparkline,
  Stack,
  StackedBarChart,
  StatCard,
  Steps,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { dateTime } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import type { SubmitResult } from "@/lib/platform/operations";
import { aiKeys, submitAiSignOff } from "../../ai/platform";
import { MONTHS_48, fmtKri, indicatorCategories, kris } from "../data";
import { escalationLevels, useKriReadings, type KriReading } from "../logic";
import { OperationRow, PendingBadge, SubmitOutcome, useOperationsOfType } from "../operation-ui";
import { OPRISK, requestKriThresholdChange } from "../platform";
import { useOpRisk } from "../store";
import { bestLag, pearson, ragLabel, roleNames, round, useAuditLog, useRuleValues } from "../shared";

const ragOrder = { red: 0, amber: 1, green: 2 } as const;

export function KriPage() {
  const canEdit = useCan("operational-risk", "edit");
  const { actor } = useScope();
  useRuleValues(); // re-render when any rule (thresholds, escalation roles) changes
  const signedOff = useOpRisk((s) => s.commentarySignedOffBy);
  const { setEscalation } = useOpRisk.getState();
  const audit = useAuditLog();
  const trendModel = useRule<string>(aiKeys.trendModel);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proposeFor, setProposeFor] = useState<KriReading | null>(null);
  const [scopeView, setScopeView] = useState<"all" | "mine">("all");
  const [outcome, setOutcome] = useState<SubmitResult | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const levels = escalationLevels();
  const readings = useKriReadings();
  const myLevelSet = new Set(levels.filter((l) => l.roles.includes(actor.roleId)).map((l) => l.level as number));
  /** "My KRIs": breaches currently at a level routed to my role, or that I acknowledged/escalated. */
  const isMine = (k: KriReading) => (k.level > 0 && myLevelSet.has(k.level)) || k.acknowledged?.acknowledgedById === actor.id || k.acknowledged?.escalatedById === actor.id;
  const mine = readings.filter(isMine);
  const shown = scopeView === "mine" ? mine : readings;
  const selected = readings.find((k) => k.id === selectedId) ?? null;
  const counts = { green: readings.filter((k) => k.rag === "green").length, amber: readings.filter((k) => k.rag === "amber").length, red: readings.filter((k) => k.rag === "red").length };
  const reds = readings.filter((k) => k.rag === "red");
  const changes = useOperationsOfType(["operational-risk.kri.threshold-change"]);
  const pending = changes.filter((c) => c.status === "Pending" || c.status === "In progress");
  /** Escalation is open to the module's editors and to every role on the escalation ladder. */
  const canEscalate = canEdit || myLevelSet.size > 0;

  const byCategory = indicatorCategories.map((c) => readings.filter((k) => k.category === c.name));
  const attr = kris.find((k) => k.id === "KRI-HC-01")!.history;
  const compl = kris.find((k) => k.id === "KRI-CC-01")!.history;
  const r = pearson(attr, compl);
  const lag = bestLag(attr, compl, 6);
  const downtime = kris.find((k) => k.id === "KRI-SYS-01")!.history;
  const errors = kris.find((k) => k.id === "KRI-TPQ-01")!.history;
  const r2 = pearson(downtime.slice(-24), errors.slice(-24));

  const escalate = async (k: KriReading) => {
    const next = Math.min(4, Math.max(1, k.level) + 1) as 1 | 2 | 3 | 4;
    const before = await runHooks("operational-risk.kri.escalate.before", { kri: k, from: k.level, to: next, actor });
    if (!before.ok) {
      setFlash({ tone: "danger", text: `Escalation blocked by ${before.vetoedBy}: ${before.reason}` });
      return;
    }
    setEscalation({ ...k.acknowledged, kriId: k.id, level: next, escalatedById: actor.id });
    audit("Escalated KRI breach", "KRI", k.id, `Level ${k.level}`, `Level ${next}`);
    publish("operational-risk.kri.escalated", { module: OPRISK, subject: { type: "KRI", id: k.id, title: k.name, href: "/operational-risk" }, payload: { from: k.level, to: next, rag: k.rag, value: k.current } });
    const lvl = levels.find((l) => l.level === next)!;
    notify({
      templateId: "operational-risk.kri-red-breach",
      toRoles: lvl.roles,
      href: "/operational-risk",
      data: { kri: k.name, kriId: k.id, rag: ragLabel[k.rag], value: fmtKri(k, k.current), amber: fmtKri(k, k.amber), red: fmtKri(k, k.red), persistence: k.persistence, owner: `${k.owner} — ${k.ownerTitle}`, level: next, levelRoles: roleNames(lvl.roles), by: actor.name },
    });
    await runHooks("operational-risk.kri.escalate.after", { kri: k, from: k.level, to: next, actor });
    setFlash({ tone: "success", text: `${k.name} escalated to Level ${next} — ${roleNames(lvl.roles)} notified.` });
  };
  const acknowledge = (k: KriReading) => {
    setEscalation({ ...k.acknowledged, kriId: k.id, level: Math.max(1, k.level) as 1 | 2 | 3 | 4, acknowledgedBy: actor.name, acknowledgedById: actor.id, acknowledgedAt: DEMO_NOW.toISOString() });
    audit("Acknowledged KRI reading", "KRI", k.id, undefined, `${ragLabel[k.rag]} ${fmtKri(k, k.current)}`);
    publish("operational-risk.kri.acknowledged", { module: OPRISK, subject: { type: "KRI", id: k.id, title: k.name, href: "/operational-risk" }, payload: { rag: k.rag, value: k.current } });
  };

  const columns: DataTableColumn<KriReading>[] = [
    {
      id: "name",
      header: "KRI",
      accessor: "name",
      sortable: true,
      searchable: true,
      cell: (k) => (
        <div className="min-w-0">
          <div className="font-medium text-fg">{k.name}</div>
          <div className="font-mono text-xs text-fg-subtle">
            {k.id} · {k.frequency}
            {k.boardReported ? " · Board-reported" : ""}
          </div>
        </div>
      ),
    },
    { id: "category", header: "Category", accessor: "category", sortable: true },
    { id: "rag", header: "Status", accessor: (k) => ragLabel[k.rag], sortValue: (k) => ragOrder[k.rag], sortable: true, cell: (k) => <RagIndicator status={k.rag} label={ragLabel[k.rag]} size="small" /> },
    {
      id: "current",
      header: "Current",
      numeric: true,
      sortable: true,
      sortValue: (k) => k.current,
      accessor: (k) => fmtKri(k, k.current),
      cell: (k) => (
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono">{fmtKri(k, k.current)}</span>
          <MetricDelta delta={round(k.current - k.previous, k.decimals)} invert={k.higherIsWorse} size="small" variant="inline" />
        </div>
      ),
    },
    { id: "thresholds", header: "Amber / Red", numeric: true, accessor: (k) => `${fmtKri(k, k.amber)} / ${fmtKri(k, k.red)}` },
    { id: "trend", header: "12-month trend", exportable: false, cell: (k) => <div className="w-28"><Sparkline values={k.history.slice(-12)} tone={k.rag === "red" ? "danger" : k.rag === "amber" ? "warning" : "success"} height={28} /></div> },
    { id: "owner", header: "Control owner", accessor: "owner", sortable: true, cell: (k) => <div><div className="text-fg">{k.owner}</div><div className="text-xs text-fg-subtle">{k.ownerTitle}</div></div> },
    {
      id: "level",
      header: "Escalation",
      accessor: (k) => (k.level ? `Level ${k.level}` : "—"),
      sortValue: (k) => k.level,
      sortable: true,
      cell: (k) => (
        <div className="flex flex-col items-start gap-1">
          {k.level ? <Badge tone={k.level >= 3 ? "danger" : k.level === 2 ? "warning" : "info"}>Level {k.level}</Badge> : <Text variant="small" tone="subtle">—</Text>}
          <PendingBadge subjectType="KRI" subjectId={k.id} />
        </div>
      ),
    },
  ];

  return (
    <ModulePage
      module="operational-risk"
      description="Forward-looking Key Risk Indicator framework alongside the loss-event register — Green/Amber/Red banding against Board-approved tolerance, escalated on the same standard as credit exceptions."
    >
      <Stack gap="large">
        {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}
        <SubmitOutcome result={outcome} appliedText="Applied — the workflow for this operation has no approval steps." />
        {reds.length > 0 && (
          <Alert tone="danger" title={`${reds.length} KRIs in Red — outside Board-approved tolerance`}>
            {reds.map((k) => k.name).join(", ")}. Red readings run through the §6.4.4 escalation protocol ({levels.map((l) => roleNames(l.roles)).join(" → ")}).
          </Alert>
        )}

        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="KRIs monitored" value={<span className="font-mono">{readings.length}</span>} hint={`${readings.filter((k) => k.boardReported).length} Board-reported · ${indicatorCategories.length} indicator categories`} icon={<Activity aria-hidden />} />
          <StatCard label="Green · Amber · Red" value={<span className="font-mono">{counts.green} · {counts.amber} · {counts.red}</span>} hint="Current reading vs tenant thresholds" icon={<GaugeIcon aria-hidden />} tone={counts.red ? "danger" : "success"} />
          <StatCard label="Open escalations" value={<span className="font-mono">{readings.filter((k) => k.level > 0).length}</span>} hint={`${readings.filter((k) => k.level >= 3).length} at Level 3 or above · ${mine.length} need your attention`} icon={<ShieldAlert aria-hidden />} tone="warning" />
          <StatCard label="Threshold changes pending" value={<span className="font-mono">{pending.length}</span>} hint="Routed through the Operations workflow" icon={<SlidersHorizontal aria-hidden />} />
        </Grid>

        <Grid columns={{ base: 1, lg: 3 }} gap="large">
          <Stack gap="large" className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>RAG mix by indicator category</CardTitle>
              <CardDescription>Count of KRIs per band, current month (§6.9.2 categories)</CardDescription>
            </CardHeader>
            <CardContent>
              <StackedBarChart
                label="KRI RAG mix by category"
                orientation="horizontal"
                categories={indicatorCategories.map((c) => c.name)}
                series={[
                  { name: "Green", values: byCategory.map((l) => l.filter((k) => k.rag === "green").length), tone: "success" },
                  { name: "Amber", values: byCategory.map((l) => l.filter((k) => k.rag === "amber").length), tone: "warning" },
                  { name: "Red", values: byCategory.map((l) => l.filter((k) => k.rag === "red").length), tone: "danger" },
                ]}
                height={260}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Escalation standard</CardTitle>
              <CardDescription>Amber raises Level 1; Red runs the full §6.4.4 protocol until cured — never a weaker standard than credit exceptions.</CardDescription>
            </CardHeader>
            <CardContent>
              <Steps
                orientation="horizontal"
                items={levels.map((l) => ({ title: l.title.replace(/^Level \d — /, `L${l.level} · `), description: `${readings.filter((k) => k.level === l.level).length} KRI(s) · ${l.note}` }))}
              />
            </CardContent>
          </Card>
          </Stack>
          <AiInsightCard
            kind="drafted"
            title="Trend & correlation commentary"
            model={trendModel}
            generatedAt="10 Nov 2026, 06:00"
            confidence={0.82}
            paragraphs={[
              `Staff attrition (rolling 12-month) has risen from ${attr[attr.length - 13]}% to ${attr[attr.length - 1]}% over the year and is now ${ragLabel[readings.find((k) => k.id === "KRI-HC-01")!.rag]}. Customer complaints per 10,000 customers track it closely (r = ${r.toFixed(2)} over 48 months), strongest with a ${lag.lag}-month lag (r = ${lag.r.toFixed(2)}) — a potential service-quality root cause before it shows as a loss event.`,
              `Complaints show a recurring December peak (seasonality). Core banking downtime and transaction error rate are also correlated over 24 months (r = ${r2.toFixed(2)}).`,
            ]}
            sources={[
              { label: "KRI-HC-01 · HRIS connector", detail: "48 monthly readings" },
              { label: "KRI-CC-01 · Complaints/CRM connector", detail: "48 monthly readings" },
              { label: "KRI-SYS-01, KRI-TPQ-01", detail: "24 monthly readings" },
            ]}
            signedOffBy={signedOff ? `Adopted by ${signedOff}` : undefined}
            onAccept={
              canEdit && !signedOff
                ? async () => {
                    const r = await submitAiSignOff({ activityId: "AIA-KRI-COMMENTARY", item: "KRI trend & correlation commentary", module: "Operational risk", href: "/operational-risk", decision: "Signed off", accountable: "operational-risk-analyst" });
                    setOutcome(r);
                  }
                : undefined
            }
            signOffNote="Operational Risk Analyst must review and adopt before it is used in reporting."
          />
        </Grid>

        <Stack gap="medium">
          <SectionHeader
            title="KRI register"
            description="Every designated KRI with owner, formula, source system, frequency and RAG thresholds. Select a row for its trend, mapped control and escalation history."
            action={
              <SegmentedControl
                label="KRI scope"
                size="small"
                value={scopeView}
                onChange={setScopeView}
                options={[
                  { value: "all", label: `All KRIs (${readings.length})` },
                  { value: "mine", label: `My KRIs (${mine.length})` },
                ]}
              />
            }
          />
          <DataTable
            label="Key Risk Indicators"
            columns={columns}
            data={shown}
            getRowId={(k) => k.id}
            searchable
            searchPlaceholder="Search KRIs"
            filters={[
              { id: "category", label: "Category" },
              { id: "rag", label: "Status" },
              { id: "frequency", label: "Frequency", filterFn: (k, v) => k.frequency === v, options: ["Daily", "Weekly", "Monthly", "Quarterly"].map((v) => ({ value: v, label: v })) },
            ]}
            defaultSort={{ id: "rag", direction: "asc" }}
            onRowClick={(k) => setSelectedId(k.id)}
            exportFilename="kri-register.csv"
            defaultPageSize={20}
          />
        </Stack>

        {changes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>KRI threshold governance</CardTitle>
              <CardDescription>Threshold changes are business-rule changes routed through the Operations workflow (Head of Risk / CRO approval), versioned and audited (§6.9.1, §10.1).</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="small">
                {changes.map((c) => (
                  <OperationRow key={c.id} op={c} />
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        title={selected?.name ?? ""}
        description={selected ? `${selected.id} · ${selected.category}` : undefined}
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-2">
              {canEdit && <Button variant="tertiary" iconBefore={<SlidersHorizontal aria-hidden />} onClick={() => setProposeFor(selected)}>Propose threshold change</Button>}
              {canEdit && selected.rag !== "green" && !selected.acknowledged?.acknowledgedBy && <Button variant="secondary" onClick={() => acknowledge(selected)}>Acknowledge</Button>}
              {canEscalate && selected.rag === "red" && selected.level < 4 && <Button iconBefore={<ArrowUpRight aria-hidden />} onClick={() => void escalate(selected)}>Escalate to Level {selected.level + 1}</Button>}
            </div>
          )
        }
      >
        {selected && (
          <Stack gap="large">
            <div className="flex flex-wrap items-center gap-3">
              <RagIndicator status={selected.rag} label={`${ragLabel[selected.rag]} — ${fmtKri(selected, selected.current)}`} />
              {selected.persistence > 0 && <Badge tone="warning" variant="outline">Outside green for {selected.persistence} month{selected.persistence > 1 ? "s" : ""}</Badge>}
              <PendingBadge subjectType="KRI" subjectId={selected.id} />
            </div>
            <LineChart
              label={`${selected.name} — 24 months`}
              series={[
                { name: selected.name, points: selected.history.slice(-24).map((y, i) => ({ x: MONTHS_48[24 + i]!, y })), tone: "accent" },
                { name: "Amber threshold", points: MONTHS_48.slice(-24).map((x) => ({ x, y: selected.amber })), tone: "warning" },
                { name: "Red threshold", points: MONTHS_48.slice(-24).map((x) => ({ x, y: selected.red })), tone: "danger" },
              ]}
              height={220}
              showLegend
            />
            <DescriptionList
              columns={1}
              layout="inline"
              items={[
                { label: "Formula", value: selected.formula },
                { label: "Source system", value: selected.sourceSystem },
                { label: "Frequency", value: selected.frequency },
                { label: "Business line", value: selected.businessLine },
                { label: "Control owner", value: `${selected.owner} — ${selected.ownerTitle}` },
                { label: "Mapped RCSA control", value: selected.controlId, mono: true },
                { label: "Thresholds", value: `Amber ≥ ${fmtKri(selected, selected.amber)} · Red ≥ ${fmtKri(selected, selected.red)}`, hint: "Business rules — changes route through Operations" },
                { label: "Acknowledged", value: selected.acknowledged?.acknowledgedBy ? `${selected.acknowledged.acknowledgedBy}, ${dateTime(selected.acknowledged.acknowledgedAt!)}` : undefined },
              ]}
            />
            {selected.rag !== "green" ? (
              <div>
                <Text variant="eyebrow" tone="muted">Escalation</Text>
                <Steps
                  className="mt-3"
                  items={levels
                    .filter((l) => selected.rag === "red" || l.level === 1)
                    .map((l) => ({ title: l.title, description: l.note, status: l.level < selected.level ? "complete" : l.level === selected.level ? "current" : "upcoming" }))}
                />
              </div>
            ) : (
              <Alert tone="success" title="Within appetite">No escalation open for this KRI.</Alert>
            )}
          </Stack>
        )}
      </Drawer>

      <ThresholdModal
        kri={proposeFor}
        onClose={() => setProposeFor(null)}
        onSubmit={async (amber, red, reason) => {
          const k = proposeFor!;
          const r = await requestKriThresholdChange({ kriId: k.id, amber, red, before: { amber: k.amber, red: k.red }, reason }, k.name);
          if (r.ok) audit("Requested KRI threshold change", "KRI", k.id, `${k.amber}/${k.red}`, `${amber}/${red} · ${r.instance.id}`);
          setOutcome(r);
          setProposeFor(null);
        }}
      />
    </ModulePage>
  );
}

function ThresholdModal({ kri, onClose, onSubmit }: { kri: KriReading | null; onClose: () => void; onSubmit: (amber: number, red: number, reason: string) => void }) {
  const [amber, setAmber] = useState("");
  const [red, setRed] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const a = Number(amber || kri?.amber);
  const r = Number(red || kri?.red);
  const minComment = useRule<number>("operations.minCommentLength");
  const error = !Number.isFinite(a) || !Number.isFinite(r) || a < 0 || r < 0 ? "Enter non-negative numbers" : kri?.higherIsWorse ? (a >= r ? "Amber must be below Red" : undefined) : a <= r ? "Amber must be above Red" : undefined;
  const reasonError = reason.trim().length < minComment ? `Give a reason (at least ${minComment} characters)` : undefined;
  return (
    <Modal
      open={!!kri}
      onOpenChange={(o) => {
        if (!o) {
          setAmber("");
          setRed("");
          setReason("");
          setTouched(false);
          onClose();
        }
      }}
      title="Propose threshold change"
      description={kri ? `${kri.name} — routed through the Operations workflow; the change takes effect once approved.` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              setTouched(true);
              if (error || reasonError) return;
              onSubmit(a, r, reason.trim());
              setAmber("");
              setRed("");
              setReason("");
              setTouched(false);
            }}
          >
            Submit for approval
          </Button>
        </div>
      }
    >
      {kri && (
        <Stack gap="medium">
          <Grid columns={2} gap="medium">
            <Field label="Amber from" htmlFor="thr-amber" description={`Now ${fmtKri(kri, kri.amber)}`} error={touched ? error : undefined}>
              <Input id="thr-amber" inputMode="decimal" value={amber} placeholder={String(kri.amber)} onChange={(e) => setAmber(e.target.value)} />
            </Field>
            <Field label="Red from" htmlFor="thr-red" description={`Now ${fmtKri(kri, kri.red)}`}>
              <Input id="thr-red" inputMode="decimal" value={red} placeholder={String(kri.red)} onChange={(e) => setRed(e.target.value)} />
            </Field>
          </Grid>
          <Field label="Reason" htmlFor="thr-reason" required error={touched ? reasonError : undefined}>
            <Textarea id="thr-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          <Alert tone="info">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle aria-hidden className="size-4" /> Thresholds express the Board-approved tolerance; every change is versioned and logged.
            </span>
          </Alert>
        </Stack>
      )}
    </Modal>
  );
}
