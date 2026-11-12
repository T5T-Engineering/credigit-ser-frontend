"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CalendarClock, Lock, MessageSquarePlus, Search, SendHorizontal } from "lucide-react";
import {
  AiInsightCard,
  Alert,
  Avatar,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeSnippet,
  DataTable,
  DonutChart,
  EmptyState,
  Field,
  Grid,
  Input,
  LineChart,
  List,
  Modal,
  PermissionGate,
  SegmentedControl,
  Select,
  Stack,
  StackedBarChart,
  StatusBadge,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useSession } from "@/lib/auth/session";
import { useAudit, useCollateral, useFacilities, useObligors, useSectors, useUsers } from "@/lib/data/hooks";
import { newId } from "@/lib/data/store";
import { DEMO_NOW } from "@/lib/data/seed";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { submitOperation, type SubmitResult } from "@/lib/platform/operations";
import { getRule, useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { dateTime, moneyShort, pct } from "@/lib/format";
import { useOpRisk } from "../../operational-risk/store";
import { PendingBadge, SubmitOutcome } from "../../operational-risk/operation-ui";
import { roleNames, useAuditLog, useRuleValues } from "../../operational-risk/shared";
import { useAppetite } from "../../enterprise-risk/logic";
import { useAiActivity, type AiActivity } from "../activity";
import { answerQuery, dataDictionary, detectIntent, suggestedQuestions, type Answer, type ChartSpec, type QueryData, type QueryResult, type QueryScope, type ValueFormat } from "../intents";
import { AI, aiKeys, consoleScopeFor, submitAiSignOff, type AiQueryHookCtx } from "../platform";
import { useAi, type QueryRecord, type SavedQuery } from "../store";

/** Module frame for every AI sub-page: header + access gate (PRD §6.13 roles from business rules). */
function AiFrame({ description, children }: { description: string; children: (scope: QueryScope) => React.ReactNode }) {
  const { actor } = useScope();
  useRuleValues();
  const scope = consoleScopeFor(actor.roleId);
  const allowed = [...getRule<RoleId[]>(aiKeys.fullScopeRoles), ...getRule<RoleId[]>(aiKeys.platformScopeRoles)];
  return (
    <ModulePage module="ai-console" description={description}>
      <PermissionGate
        allowed={!!scope}
        title="Restricted to designated power users"
        description={`The natural-language query console is open only to ${roleNames(allowed)}. AI-drafted and AI-flagged items for your role appear in the module you work in.`}
      >
        {scope && children(scope)}
      </PermissionGate>
    </ModulePage>
  );
}

/** /ai — natural-language query console. */
export function AiConsolePage() {
  return <AiFrame description="Ask the Risk Data Spine a question in plain language and get a chart and a short narrative — every query and answer is written to the audit trail.">{(scope) => <Console scope={scope} />}</AiFrame>;
}

/** /ai/activity — AI drafts and flags awaiting the accountable role's sign-off. */
export function AiActivityPage() {
  return <AiFrame description="AI-drafted and AI-flagged outputs across modules — each needs the accountable role's sign-off, recorded through the Operations workflow.">{() => <ActivityTab />}</AiFrame>;
}

/** /ai/log — query log and scheduled reports. */
export function AiLogPage() {
  return <AiFrame description="Every console query, and the reports scheduled from it.">{() => <QueryLogTab />}</AiFrame>;
}

function useQueryData(): QueryData {
  const obligors = useObligors();
  const facilities = useFacilities();
  const sectors = useSectors();
  const collateral = useCollateral();
  const users = useUsers();
  const audit = useAudit();
  const lossEvents = useOpRisk((s) => s.lossEvents);
  const { metrics, readings } = useAppetite();
  return useMemo(() => ({ obligors, facilities, sectors, collateral, users, audit, lossEvents, kris: readings, appetite: metrics }), [obligors, facilities, sectors, collateral, users, audit, lossEvents, readings, metrics]);
}

function Console({ scope }: { scope: QueryScope }) {
  const user = useSession((s) => s.user);
  const roleId = useSession((s) => s.roleId);
  const { actor } = useScope();
  const history = useAi((s) => s.history);
  const after = useAi((s) => s.conversationAfter);
  const { addQuery, newConversation } = useAi.getState();
  const data = useQueryData();
  const audit = useAuditLog();
  const model = useRule<string>(aiKeys.modelVersion);
  const maxExchanges = useRule<number>(aiKeys.conversationMax);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveOutcome, setSaveOutcome] = useState<SubmitResult | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const start = after ? history.findIndex((h) => h.id === after) + 1 : 0;
  const conversation = history.slice(start).filter((h) => (h.askedById ? h.askedById === actor.id : h.askedBy === user?.name)).slice(-maxExchanges);
  const audit7 = data.audit;
  const suggestions = suggestedQuestions.filter((s) => scope === "full" || s.scope === "platform");

  const seen = useRef(conversation.length);
  useEffect(() => {
    // Scroll only when a new answer arrives, not on first render.
    if (conversation.length > seen.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    seen.current = conversation.length;
  }, [conversation.length]);

  /** Resolve a question: ai.query.before hooks (data-scope guard; may veto/rewrite) → answer → log, audit, event → .after hooks. */
  const runQuery = async (question: string) => {
    const qText = question.trim();
    if (!qText || !user || !roleId) return;
    const ctx: AiQueryHookCtx = { question: qText, intent: detectIntent(qText.toLowerCase()), scope, actor: { id: actor.id, name: actor.name, roleId: actor.roleId } };
    const before = await runHooks("ai.query.before", ctx);
    const q = before.ok ? before.ctx.question : qText;
    const result: QueryResult = before.ok ? answerQuery(q, scope, data) : { status: "refused", intent: ctx.intent ?? "unmatched", reason: `${before.reason} (${before.vetoedBy})` };
    const rec: QueryRecord = { id: newId("NLQ"), question: q, askedAt: new Date().toISOString(), askedBy: user.name, askedById: user.id, roleId, intent: result.status === "unknown" ? "unmatched" : result.intent, status: result.status, reason: result.status === "answered" ? undefined : result.reason };
    addQuery(rec);
    audit(
      result.status === "answered" ? "AI query answered" : result.status === "refused" ? "AI query refused (out of scope)" : "AI query not understood",
      "AI query",
      rec.id,
      q,
      result.status === "answered" ? `${result.title} · data touched: ${result.touched} · ${model}` : result.reason,
    );
    publish(result.status === "answered" ? "ai.query.answered" : result.status === "refused" ? "ai.query.refused" : "ai.query.unmatched", { module: AI, subject: { type: "AiQuery", id: rec.id, title: q, href: "/ai/log" }, payload: { intent: rec.intent, scope, touched: result.status === "answered" ? result.touched : undefined } });
    await runHooks("ai.query.after", { ...ctx, question: q, record: rec, status: result.status });
  };
  const ask = (question: string) => {
    void runQuery(question);
    setText("");
  };

  // Deep link: /ai?ask=<question> (e.g. "Ask AI" from another module) runs the question once.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    const q = new URLSearchParams(window.location.search).get("ask");
    if (q) {
      seen.current = Number.MAX_SAFE_INTEGER; // don't scroll for deep links
      void runQuery(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <Grid columns={{ base: 1, lg: 12 }} gap="large" className="pt-2">
      <Stack gap="large" className="min-w-0 lg:col-span-8">
        <SubmitOutcome result={saveOutcome} />
        {scope === "platform" && (
          <Alert tone="info" title="Platform scope">Your queries are limited to platform-health and configuration data — never customer-identifiable financial detail — unless separately entitled.</Alert>
        )}
        {conversation.length === 0 ? (
          <Stack gap="medium">
            <Alert tone="info" title="Ask the Risk Data Spine">
              Questions resolve against the platform’s data dictionary — Section 8 metrics and every Operational and Market Risk indicator. The console never searches external sources.
            </Alert>
            <Text variant="eyebrow" tone="muted">Example answer (not logged)</Text>
            <Exchange
              record={{ id: "EXAMPLE", question: suggestions[0]!.q, askedAt: DEMO_NOW.toISOString(), askedBy: user?.name ?? "", roleId: roleId ?? "", intent: "example", status: "answered" }}
              result={answerQuery(suggestions[0]!.q, scope, data)}
              onSave={() => setSaving(suggestions[0]!.q)}
            />
          </Stack>
        ) : (
          conversation.map((h) => <Exchange key={h.id} record={h} result={h.status === "answered" ? answerQuery(h.question, scope, data) : h.status === "refused" ? { status: "refused", intent: h.intent, reason: h.reason ?? "Outside your query scope." } : { status: "unknown", reason: h.reason ?? "Not understood." }} onSave={() => setSaving(h.question)} />)
        )}
        <div ref={endRef} />

        <Card variant="elevated">
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(text);
              }}
            >
              <Stack gap="small">
                <Field label="Ask a question" htmlFor="nlq-input" description="Answers are AI-generated from the live data, labelled with sources and model version, and logged to the audit trail.">
                  <Textarea
                    id="nlq-input"
                    rows={2}
                    value={text}
                    placeholder="e.g. Top 10 obligors by exposure in Manufacturing"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        ask(text);
                      }
                    }}
                  />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" variant="text" size="small" iconBefore={<MessageSquarePlus aria-hidden />} onClick={() => newConversation()} disabled={conversation.length === 0}>
                    New conversation
                  </Button>
                  <Button type="submit" iconAfter={<SendHorizontal aria-hidden />} disabled={!text.trim()}>
                    Ask
                  </Button>
                </div>
              </Stack>
            </form>
          </CardContent>
        </Card>
      </Stack>

      <Stack gap="large" className="lg:col-span-4">
        <Card>
          <CardHeader>
            <CardTitle>Suggested questions</CardTitle>
            <CardDescription>{scope === "full" ? "Full risk-data-spine scope" : "Platform-health scope"}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-stretch gap-2">
              {suggestions.map((s) => (
                <Button key={s.q} variant="tertiary" size="small" className="h-auto! min-h-control-sm justify-start! py-2 text-start whitespace-normal! leading-snug!" iconBefore={<Search aria-hidden />} onClick={() => ask(s.q)}>
                  {s.q}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Data dictionary</CardTitle>
            <CardDescription>What the console can resolve</CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              {dataDictionary.map((d) => (
                <div key={d.area}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                    {d.area}
                    {scope === "platform" && !d.area.startsWith("Platform") && <Lock aria-label="Outside your scope" className="size-3.5 text-fg-subtle" />}
                  </div>
                  <List variant="unordered" spacing="xsmall" items={d.items.map((i) => <Text key={i} as="span" variant="small" tone="muted">{i}</Text>)} />
                </div>
              ))}
              <Text variant="caption" tone="subtle">Model: {model}. Queries logged to the audit trail: {audit7.filter((a) => a.entityType === "AI query").length}.</Text>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <SaveQueryModal question={saving} onClose={() => setSaving(null)} onDone={setSaveOutcome} />
    </Grid>
  );
}

function Exchange({ record, result, onSave }: { record: QueryRecord; result: QueryResult; onSave: () => void }) {
  return (
    <Stack gap="small">
      <div className="flex items-start justify-end gap-3">
        <div className="max-w-[85%] rounded-3xl bg-surface-sunken px-4 py-3">
          <Text>{record.question}</Text>
          <Text variant="caption" tone="subtle">{record.askedBy} · {dateTime(record.askedAt)} · {record.id}</Text>
        </div>
        <Avatar name={record.askedBy} size="small" />
      </div>
      {result.status === "answered" ? (
        <AnswerCard answer={result} record={record} onSave={onSave} />
      ) : (
        <Alert tone={result.status === "refused" ? "warning" : "info"} title={result.status === "refused" ? "Outside your query scope" : "Not understood"}>
          {result.reason} This attempt has been logged.
        </Alert>
      )}
    </Stack>
  );
}

const fmt = (f: ValueFormat) => (v: number) => (f === "money" ? moneyShort(v) : f === "pct" ? pct(v, v < 10 ? 2 : 1) : String(Math.round(v * 100) / 100));

function ChartView({ chart }: { chart: ChartSpec }) {
  if (chart.kind === "bar") return <BarChart label={chart.label} data={chart.data} orientation={chart.data.length > 6 ? "horizontal" : "vertical"} valueFormatter={fmt(chart.format)} tone="accent" height={chart.data.length > 6 ? Math.max(220, chart.data.length * 30) : 220} showValues />;
  if (chart.kind === "donut") return <div className="mx-auto max-w-xs"><DonutChart segments={chart.segments} centerLabel={chart.centerLabel} centerValue={chart.centerValue} /></div>;
  if (chart.kind === "stacked") return <StackedBarChart label={chart.label} categories={chart.categories} series={chart.series} mode={chart.mode} orientation="horizontal" height={Math.max(260, chart.categories.length * 34)} valueFormatter={fmt(chart.format)} />;
  return (
    <Stack gap="medium">
      {chart.panels.map((p) => (
        <div key={p.title}>
          <Text variant="small" className="font-semibold">{p.title}</Text>
          <LineChart label={p.title} series={p.series} height={170} yFormatter={fmt(p.format)} area />
        </div>
      ))}
      <Text variant="caption" tone="subtle">Both series share one monthly time axis; panels are stacked instead of a dual-axis chart so neither scale distorts the other.</Text>
    </Stack>
  );
}

function AnswerCard({ answer, record, onSave }: { answer: Answer; record: QueryRecord; onSave: () => void }) {
  const model = useRule<string>(aiKeys.modelVersion);
  const columns: DataTableColumn<(string | number)[]>[] = answer.table
    ? answer.table.columns.map((c, i) => ({ id: `c${i}`, header: c, accessor: (r) => r[i], numeric: answer.table!.numeric?.[i], sortable: answer.table!.rows.length > 5 }))
    : [];
  return (
    <AiInsightCard
      kind="insight"
      title={answer.title}
      model={model}
      generatedAt={dateTime(record.askedAt)}
      confidence={answer.confidence}
      paragraphs={answer.narrative.filter(Boolean)}
      sources={answer.sources}
      signOffNote="AI-generated ad hoc analysis — verify before relying on it. It has no workflow effect and is logged to the audit trail."
    >
      <Stack gap="medium" className="mt-2">
        {/* Layout wrapper: the library charts' sr-only data tables are absolutely positioned and, without a positioned
            ancestor, widen the mobile layout viewport (2,000px+ horizontal overflow). Clip them to the answer card. */}
        {answer.chart && (
          <div className="relative overflow-x-clip">
            <ChartView chart={answer.chart} />
          </div>
        )}
        {answer.table && (
          <DataTable
            label={answer.title}
            columns={columns}
            data={answer.table.rows}
            getRowId={(_, i) => String(i)}
            defaultPageSize={10}
            pageSizeOptions={[]}
            paginate={answer.table.rows.length > 10}
            exportFilename={`${record.id.toLowerCase()}.csv`}
            density="compact"
          />
        )}
        <CodeSnippet label="Resolved structured query" language="sql" code={answer.structuredQuery} copyable />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text variant="caption" tone="subtle">Data touched: {answer.touched}</Text>
          <Button size="small" variant="tertiary" iconBefore={<CalendarClock aria-hidden />} onClick={onSave}>Save as scheduled report</Button>
        </div>
      </Stack>
    </AiInsightCard>
  );
}

function SaveQueryModal({ question, onClose, onDone }: { question: string | null; onClose: () => void; onDone: (r: SubmitResult) => void }) {
  const user = useSession((s) => s.user);
  const audit = useAuditLog();
  const cadences = useRule<string[]>(aiKeys.cadences);
  const [cadence, setCadence] = useState<SavedQuery["cadence"]>(cadences[0] ?? "");
  const [recipients, setRecipients] = useState("");
  return (
    <Modal
      open={!!question}
      onOpenChange={(o) => !o && onClose()}
      title="Save as scheduled report"
      description={question ?? undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              const q: SavedQuery = { id: newId("SQ"), question: question!, cadence, createdBy: user?.name ?? "", createdAt: DEMO_NOW.toISOString(), recipients: recipients.trim() || (user?.email ?? "") };
              const r = await submitOperation<SavedQuery>("ai.schedule.create", {
                title: `Scheduled AI report (${q.cadence}): ${q.question}`,
                subject: { type: "AiSchedule", id: q.id, title: q.question, href: "/ai/log" },
                payload: q,
                summary: [
                  { label: "Question", value: q.question },
                  { label: "Cadence", value: q.cadence },
                  { label: "Recipients", value: q.recipients },
                ],
              });
              if (r.ok) audit("Requested scheduled AI report", "AI query schedule", q.id, undefined, `${q.cadence} · ${q.question} · ${r.instance.id}`);
              onDone(r);
              setRecipients("");
              onClose();
            }}
          >
            Submit for approval
          </Button>
        </div>
      }
    >
      <Stack gap="medium">
        <Field label="Cadence" htmlFor="sq-cadence">
          <Select id="sq-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as SavedQuery["cadence"])} options={cadences.map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Recipients" htmlFor="sq-rec" optional description="Named officers only — never a generic distribution list. Defaults to you.">
          <Input id="sq-rec" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder={user?.email} />
        </Field>
      </Stack>
    </Modal>
  );
}

const statusTones = { "Pending sign-off": "warning", "Signed off": "success", Rejected: "danger" } as const;

function ActivityTab() {
  const all = useAiActivity();
  const { actor } = useScope();
  const [scopeView, setScopeView] = useState<"all" | "mine">("all");
  const [outcome, setOutcome] = useState<SubmitResult | null>(null);
  /** "Mine": outputs my role is accountable for. */
  const mine = all.filter((a) => a.accountable === actor.roleId);
  const items = scopeView === "mine" ? mine : all;
  const decide = async (a: AiActivity, decision: "Signed off" | "Rejected") => {
    const r = await submitAiSignOff({ activityId: a.id, item: a.item, module: a.module, href: a.href, decision, accountable: a.accountable });
    setOutcome(r);
  };
  const columns: DataTableColumn<AiActivity>[] = [
    { id: "item", header: "AI output", accessor: "item", searchable: true, cell: (a) => <div><div className="font-medium text-fg">{a.item}</div><div className="font-mono text-xs text-fg-subtle">{a.id} · {a.entity}</div></div> },
    { id: "kind", header: "Label", accessor: "kind", sortable: true, cell: (a) => <Badge tone={a.kind === "AI-flagged" ? "warning" : "accent"}>{a.kind}</Badge> },
    { id: "capability", header: "Capability", accessor: "capability", sortable: true, cell: (a) => <div><div>{a.capability}</div><div className="text-xs text-fg-subtle">Phase {a.phase}</div></div> },
    { id: "module", header: "Module", accessor: "module", sortable: true },
    { id: "confidence", header: "Confidence", numeric: true, accessor: (a) => Math.round(a.confidence * 100), cell: (a) => `${Math.round(a.confidence * 100)}%` },
    { id: "accountable", header: "Sign-off by", accessor: (a) => roleById[a.accountable].name, sortable: true },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (a) => <div className="flex flex-col items-start gap-1"><StatusBadge status={a.status} tones={statusTones} />{a.decidedBy && <div className="text-xs text-fg-subtle">{a.decidedBy}</div>}<PendingBadge subjectType="AiOutput" subjectId={a.id} /></div> },
    {
      id: "act",
      header: "",
      exportable: false,
      cell: (a) => (
        <div className="flex justify-end gap-2">
          {a.status === "Pending sign-off" && actor.roleId === a.accountable ? (
            <>
              <Button size="small" onClick={() => void decide(a, "Signed off")}>Sign off</Button>
              <Button size="small" variant="tertiary" onClick={() => void decide(a, "Rejected")}>Reject</Button>
            </>
          ) : (
            <Button size="small" variant="text" as={Link} href={a.href}>Open</Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <Stack gap="large" className="pt-2">
      <Alert tone="info" title="Human sign-off before any workflow effect">
        AI output is always labelled AI-drafted or AI-flagged, is fully editable, and needs the accountable role’s sign-off — the AI never auto-approves a credit decision or auto-books a provisioning entry.
      </Alert>
      <SubmitOutcome result={outcome} appliedText="Recorded through the Operations workflow (no extra approval steps configured)." />
      <Grid columns={{ base: 1, sm: 3 }} gap="medium">
        {(["Pending sign-off", "Signed off", "Rejected"] as const).map((s) => (
          <Card key={s} variant="filled" padding="small">
            <Text variant="eyebrow" tone="muted">{s}</Text>
            <div className="font-mono text-headline font-bold text-fg">{items.filter((i) => i.status === s).length}</div>
          </Card>
        ))}
      </Grid>
      <div className="flex justify-end">
        <SegmentedControl
          label="Activity scope"
          size="small"
          value={scopeView}
          onChange={setScopeView}
          options={[
            { value: "all", label: `All outputs (${all.length})` },
            { value: "mine", label: `Mine to sign off (${mine.length})` },
          ]}
        />
      </div>
      <DataTable label="AI drafts and flags across modules" columns={columns} data={items} getRowId={(a) => a.id} searchable searchPlaceholder="Search AI outputs" filters={[{ id: "kind", label: "Label" }, { id: "module", label: "Module" }, { id: "status", label: "Status" }]} exportFilename="ai-activity.csv" />
    </Stack>
  );
}

function QueryLogTab() {
  const all = useAi((s) => s.history);
  const saved = useAi((s) => s.saved);
  const removeSaved = useAi((s) => s.removeSaved);
  const audit = useAuditLog();
  const { actor } = useScope();
  const [scopeView, setScopeView] = useState<"all" | "mine">("all");
  const mine = all.filter((h) => h.askedById === actor.id);
  const history = scopeView === "mine" ? mine : all;
  const logCols: DataTableColumn<QueryRecord>[] = [
    { id: "askedAt", header: "When", accessor: (h) => dateTime(h.askedAt), sortValue: (h) => h.askedAt, sortable: true },
    { id: "askedBy", header: "Who", accessor: "askedBy", sortable: true, cell: (h) => <div><div>{h.askedBy}</div><div className="text-xs text-fg-subtle">{roleById[h.roleId as RoleId]?.name ?? h.roleId}</div></div> },
    { id: "question", header: "Question", accessor: "question", searchable: true },
    { id: "intent", header: "Resolved to", accessor: "intent", sortable: true },
    { id: "status", header: "Outcome", accessor: "status", sortable: true, cell: (h) => <StatusBadge status={h.status} tones={{ answered: "success", refused: "warning", unknown: "neutral" }} /> },
  ];
  return (
    <Grid columns={{ base: 1, lg: 3 }} gap="large" className="pt-2">
      <div className="min-w-0 lg:col-span-2">
        <div className="mb-3 flex justify-end">
          <SegmentedControl
            label="Query log scope"
            size="small"
            value={scopeView}
            onChange={setScopeView}
            options={[
              { value: "all", label: `All queries (${all.length})` },
              { value: "mine", label: `My queries (${mine.length})` },
            ]}
          />
        </div>
        <DataTable label="Query log" caption="Every query is also written to the immutable audit trail." columns={logCols} data={[...history].reverse()} getRowId={(h) => h.id} searchable searchPlaceholder="Search questions" filters={[{ id: "status", label: "Outcome" }]} exportFilename="nlq-query-log.csv" emptyState={<EmptyState icon={<Bot aria-hidden />} title="No queries yet" description="Ask a question in the console." />} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Scheduled reports</CardTitle>
          <CardDescription>Queries saved to run on a recurring cadence</CardDescription>
        </CardHeader>
        <CardContent>
          {saved.length === 0 ? (
            <Text variant="small" tone="muted">None yet — use “Save as scheduled report” on an answer.</Text>
          ) : (
            <Stack gap="small">
              {saved.map((s) => (
                <div key={s.id} className="rounded-3xl bg-surface-sunken p-3">
                  <div className="text-sm font-medium text-fg">{s.question}</div>
                  <Text variant="caption" tone="subtle">{s.cadence} · to {s.recipients} · by {s.createdBy}</Text>
                  <div className="mt-2 flex justify-end">
                    <Button size="small" variant="text" onClick={() => { removeSaved(s.id); audit("Removed scheduled AI query", "AI query schedule", s.id, s.cadence, undefined); publish("ai.schedule.removed", { module: AI, subject: { type: "AiSchedule", id: s.id, title: s.question, href: "/ai/log" } }); }}>Remove</Button>
                  </div>
                </div>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
