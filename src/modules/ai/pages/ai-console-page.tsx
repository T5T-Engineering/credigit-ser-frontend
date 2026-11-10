"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CalendarClock, Lock, MessageSquarePlus, Search, SendHorizontal, Sparkles } from "lucide-react";
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
  Select,
  Stack,
  StackedBarChart,
  StatusBadge,
  Tabs,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole, useSession } from "@/lib/auth/session";
import { useAudit, useCollateral, useFacilities, useObligors, useSectors, useUsers } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { dateTime, moneyShort, pct } from "@/lib/format";
import { useOpRisk } from "../../operational-risk/store";
import { useAuditLog } from "../../operational-risk/shared";
import { useAppetite } from "../../enterprise-risk/logic";
import { useAiActivity, type AiActivity } from "../activity";
import { MODEL_VERSION, answerQuery, dataDictionary, suggestedQuestions, type Answer, type ChartSpec, type QueryData, type QueryResult, type QueryScope, type ValueFormat } from "../intents";
import { useAi, type QueryRecord, type SavedQuery } from "../store";

/** PRD §6.13: restricted to System Admin/Support Team, CRO and Head of Risk. */
const consoleScope: Partial<Record<RoleId, QueryScope>> = { cro: "full", "head-of-risk": "full", "system-admin": "platform", "it-support": "platform" };

export function AiConsolePage() {
  const role = useRole();
  const scope = role ? consoleScope[role.id] : undefined;
  // Initial tab from ?tab= (client-only page, rendered after sign-in).
  const [tab, setTab] = useState(() => (typeof window === "undefined" ? "console" : (new URLSearchParams(window.location.search).get("tab") ?? "console")));
  return (
    <ModulePage module="ai-console" description="Ask the Risk Data Spine a question in plain language and get a chart and a short narrative — every query and answer is written to the audit trail.">
      <PermissionGate
        allowed={!!scope}
        title="Restricted to designated power users"
        description="The natural-language query console is open only to the System Admin/Support Team, the Chief Risk Officer and the Head of Risk (PRD §6.13). AI-drafted and AI-flagged items for your role appear in the module you work in."
      >
        {scope && (
          <Tabs
            label="AI analytics"
            value={tab}
            onValueChange={setTab}
            variant="underline"
            items={[
              { id: "console", label: "Query console", icon: <Bot aria-hidden className="size-4" />, content: <Console scope={scope} /> },
              { id: "activity", label: "AI activity", icon: <Sparkles aria-hidden className="size-4" />, content: <ActivityTab /> },
              { id: "log", label: "Query log & schedules", icon: <CalendarClock aria-hidden className="size-4" />, content: <QueryLogTab /> },
            ]}
          />
        )}
      </PermissionGate>
    </ModulePage>
  );
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
  const history = useAi((s) => s.history);
  const after = useAi((s) => s.conversationAfter);
  const { addQuery, newConversation } = useAi.getState();
  const data = useQueryData();
  const audit = useAuditLog();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const start = after ? history.findIndex((h) => h.id === after) + 1 : 0;
  const conversation = history.slice(start).filter((h) => h.askedBy === user?.name).slice(-8);
  const audit7 = data.audit;
  const suggestions = suggestedQuestions.filter((s) => scope === "full" || s.scope === "platform");

  const seen = useRef(conversation.length);
  useEffect(() => {
    // Scroll only when a new answer arrives, not on first render.
    if (conversation.length > seen.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    seen.current = conversation.length;
  }, [conversation.length]);

  const runQuery = (question: string) => {
    const qText = question.trim();
    if (!qText || !user || !roleId) return;
    const result = answerQuery(qText, scope, data);
    const rec: QueryRecord = { id: `NLQ-${Date.now().toString(36).toUpperCase()}`, question: qText, askedAt: new Date().toISOString(), askedBy: user.name, roleId, intent: result.status === "unknown" ? "unmatched" : result.intent, status: result.status };
    addQuery(rec);
    audit(
      result.status === "answered" ? "AI query answered" : result.status === "refused" ? "AI query refused (out of scope)" : "AI query not understood",
      "AI query",
      rec.id,
      qText,
      result.status === "answered" ? `${result.title} · data touched: ${result.touched} · ${MODEL_VERSION}` : result.reason,
    );
  };
  const ask = (question: string) => {
    runQuery(question);
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
      runQuery(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <Grid columns={{ base: 1, lg: 12 }} gap="large" className="pt-2">
      <Stack gap="large" className="min-w-0 lg:col-span-8">
        {scope === "platform" && (
          <Alert tone="info" title="Platform scope">Your queries are limited to platform-health and configuration data — never customer-identifiable financial detail — unless separately entitled (§6.13).</Alert>
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
          conversation.map((h) => <Exchange key={h.id} record={h} result={answerQuery(h.question, scope, data)} onSave={() => setSaving(h.question)} />)
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
              <Text variant="caption" tone="subtle">Model: {MODEL_VERSION}. Queries logged to the audit trail: {audit7.filter((a) => a.entityType === "AI query").length}.</Text>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <SaveQueryModal question={saving} onClose={() => setSaving(null)} />
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
  const columns: DataTableColumn<(string | number)[]>[] = answer.table
    ? answer.table.columns.map((c, i) => ({ id: `c${i}`, header: c, accessor: (r) => r[i], numeric: answer.table!.numeric?.[i], sortable: answer.table!.rows.length > 5 }))
    : [];
  return (
    <AiInsightCard
      kind="insight"
      title={answer.title}
      model={MODEL_VERSION}
      generatedAt={dateTime(record.askedAt)}
      confidence={answer.confidence}
      paragraphs={answer.narrative.filter(Boolean)}
      sources={answer.sources}
      signOffNote="AI-generated ad hoc analysis — verify before relying on it. It has no workflow effect and is logged to the audit trail."
    >
      <Stack gap="medium" className="mt-2">
        {answer.chart && <ChartView chart={answer.chart} />}
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

function SaveQueryModal({ question, onClose }: { question: string | null; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const saveQuery = useAi((s) => s.saveQuery);
  const audit = useAuditLog();
  const [cadence, setCadence] = useState<SavedQuery["cadence"]>("Weekly");
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
            onClick={() => {
              const q: SavedQuery = { id: `SQ-${Date.now().toString(36).toUpperCase()}`, question: question!, cadence, createdBy: user?.name ?? "", createdAt: DEMO_NOW.toISOString(), recipients: recipients.trim() || (user?.email ?? "") };
              saveQuery(q);
              audit("Saved AI query as scheduled report", "AI query schedule", q.id, undefined, `${q.cadence} · ${q.question}`);
              setRecipients("");
              onClose();
            }}
          >
            Save schedule
          </Button>
        </div>
      }
    >
      <Stack gap="medium">
        <Field label="Cadence" htmlFor="sq-cadence">
          <Select id="sq-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as SavedQuery["cadence"])} options={["Daily", "Weekly", "Monthly"].map((v) => ({ value: v, label: v }))} />
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
  const items = useAiActivity();
  const role = useRole();
  const user = useSession((s) => s.user);
  const signOff = useAi((s) => s.signOff);
  const audit = useAuditLog();
  const decide = (a: AiActivity, status: "Signed off" | "Rejected") => {
    signOff(a.id, { status, by: user?.name ?? "", at: DEMO_NOW.toISOString() });
    audit(status === "Signed off" ? "Signed off AI output" : "Rejected AI output", "AI output", a.id, "Pending sign-off", status);
  };
  const columns: DataTableColumn<AiActivity>[] = [
    { id: "item", header: "AI output", accessor: "item", searchable: true, cell: (a) => <div><div className="font-medium text-fg">{a.item}</div><div className="font-mono text-xs text-fg-subtle">{a.id} · {a.entity}</div></div> },
    { id: "kind", header: "Label", accessor: "kind", sortable: true, cell: (a) => <Badge tone={a.kind === "AI-flagged" ? "warning" : "accent"}>{a.kind}</Badge> },
    { id: "capability", header: "Capability", accessor: "capability", sortable: true, cell: (a) => <div><div>{a.capability}</div><div className="text-xs text-fg-subtle">Phase {a.phase}</div></div> },
    { id: "module", header: "Module", accessor: "module", sortable: true },
    { id: "confidence", header: "Confidence", numeric: true, accessor: (a) => Math.round(a.confidence * 100), cell: (a) => `${Math.round(a.confidence * 100)}%` },
    { id: "accountable", header: "Sign-off by", accessor: (a) => roleById[a.accountable].name, sortable: true },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (a) => <div><StatusBadge status={a.status} tones={statusTones} />{a.decidedBy && <div className="mt-1 text-xs text-fg-subtle">{a.decidedBy}</div>}</div> },
    {
      id: "act",
      header: "",
      exportable: false,
      cell: (a) => (
        <div className="flex justify-end gap-2">
          {a.status === "Pending sign-off" && role?.id === a.accountable ? (
            <>
              <Button size="small" onClick={() => decide(a, "Signed off")}>Sign off</Button>
              <Button size="small" variant="tertiary" onClick={() => decide(a, "Rejected")}>Reject</Button>
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
        AI output is always labelled AI-drafted or AI-flagged, is fully editable, and needs the accountable role’s sign-off — the AI never auto-approves a credit decision or auto-books a provisioning entry (§6.12).
      </Alert>
      <Grid columns={{ base: 1, sm: 3 }} gap="medium">
        {(["Pending sign-off", "Signed off", "Rejected"] as const).map((s) => (
          <Card key={s} variant="filled" padding="small">
            <Text variant="eyebrow" tone="muted">{s}</Text>
            <div className="font-mono text-headline font-bold text-fg">{items.filter((i) => i.status === s).length}</div>
          </Card>
        ))}
      </Grid>
      <DataTable label="AI drafts and flags across modules" columns={columns} data={items} getRowId={(a) => a.id} searchable searchPlaceholder="Search AI outputs" filters={[{ id: "kind", label: "Label" }, { id: "module", label: "Module" }, { id: "status", label: "Status" }]} exportFilename="ai-activity.csv" />
    </Stack>
  );
}

function QueryLogTab() {
  const history = useAi((s) => s.history);
  const saved = useAi((s) => s.saved);
  const removeSaved = useAi((s) => s.removeSaved);
  const audit = useAuditLog();
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
        <DataTable label="Query log" caption="Every query is also written to the immutable audit trail (§10.1)." columns={logCols} data={[...history].reverse()} getRowId={(h) => h.id} searchable searchPlaceholder="Search questions" filters={[{ id: "status", label: "Outcome" }]} exportFilename="nlq-query-log.csv" emptyState={<EmptyState icon={<Bot aria-hidden />} title="No queries yet" description="Ask a question in the console." />} />
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
                    <Button size="small" variant="text" onClick={() => { removeSaved(s.id); audit("Removed scheduled AI query", "AI query schedule", s.id, s.cadence, undefined); }}>Remove</Button>
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
