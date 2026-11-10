"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import {
  AiInsightCard,
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DescriptionList,
  EmptyState,
  Field,
  Grid,
  Input,
  LineChart,
  Menu,
  MetricDelta,
  Modal,
  RadioGroup,
  Select,
  Stack,
  StatCard,
  StatusBadge,
  Tabs,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { useFacilities, useLookups, useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, dateTime, money, moneyShort, number, pct } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { useActor } from "../audit";
import { raiseException, recordCovenantTest, recordPeriodicFinancials, signOffAiFlag } from "../service";
import {
  buildAgentFees,
  buildCovenants,
  buildInflowProfiles,
  buildPeriodicReviews,
  covenantStatusTones,
  inflowMonthLabels,
  inflowStatusTones,
  type Covenant,
  type InflowProfile,
  type PeriodicReview,
} from "../data";
import { daysBetween, natureDescriptions } from "../logic";
import { RaiseExceptionModal, type RaiseExceptionTarget } from "../raise-exception";
import { openExceptionFor, useMonitoring } from "../store";

type CovRow = Covenant & { obligorName: string; daysToTest: number; exceptionId?: string };

const AI_KEY = "inflow-shortfall-2026-11";

export function CovenantsPage() {
  const facilities = useFacilities();
  const obligors = useObligors();
  const { obligor } = useLookups();
  const canEdit = useCan("monitoring", "edit");
  const tests = useMonitoring((s) => s.covenantTests);
  const exceptions = useMonitoring((s) => s.exceptions);
  const [raiseTarget, setRaiseTarget] = useState<RaiseExceptionTarget | null>(null);
  const [testFor, setTestFor] = useState<CovRow | null>(null);
  const { actor } = useScope();
  const dueSoon = useRule<number>("monitoring.covenant.dueSoonDays");
  // Deep link: /monitoring/covenants?tab=inflows (used by notifications and demo scripts).
  const [initialTab] = useState(() => (typeof window === "undefined" ? "register" : (new URLSearchParams(window.location.search).get("tab") ?? "register")));

  const covenants: CovRow[] = useMemo(
    () =>
      buildCovenants(facilities, obligor).map((c) => {
        const t = tests[c.id];
        const merged: Covenant = t ? { ...c, status: t.status, lastTestedAt: t.at, lastResult: t.result, nextTestAt: t.nextTestAt ?? c.nextTestAt } : c;
        return {
          ...merged,
          obligorName: obligor.get(c.obligorId)?.name ?? c.obligorId,
          daysToTest: -daysBetween(merged.nextTestAt),
          exceptionId: openExceptionFor(exceptions, { facilityId: c.facilityId, type: "Covenant breach" })?.id,
        };
      }),
    [facilities, obligor, tests, exceptions],
  );

  const counts = {
    total: covenants.length,
    compliant: covenants.filter((c) => c.status === "Compliant").length,
    due: covenants.filter((c) => (c.status === "Due" || c.status === "Compliant") && c.daysToTest >= 0 && c.daysToTest <= dueSoon).length,
    overdue: covenants.filter((c) => c.status === "Overdue").length,
    breached: covenants.filter((c) => c.status === "Breached").length,
  };

  const raiseForCovenant = (c: CovRow) =>
    setRaiseTarget({
      obligorId: c.obligorId,
      obligorName: c.obligorName,
      facilityId: c.facilityId,
      type: "Covenant breach",
      title: `Covenant breach — ${c.kind.toLowerCase()}`,
      detail: `${c.obligorName}: "${c.text}" — ${c.lastResult ?? "not met"}.`,
    });

  const columns: DataTableColumn<CovRow>[] = [
    { id: "id", header: "Covenant", accessor: "id", sortable: true, cell: (c) => <span className="font-mono">{c.id}</span> },
    {
      id: "obligor",
      header: "Obligor / facility",
      accessor: "obligorName",
      sortable: true,
      cell: (c) => (
        <Stack gap="none">
          <span className="font-medium text-fg">{c.obligorName}</span>
          <Text variant="caption" tone="subtle">
            {c.facilityId}
          </Text>
        </Stack>
      ),
    },
    {
      id: "text",
      header: "Covenant",
      accessor: "text",
      cell: (c) => (
        <Stack gap="none">
          <span className="text-fg">{c.text}</span>
          <Text variant="caption" tone="subtle">
            {c.kind} · {c.frequency} · Evidence: {c.evidence}
          </Text>
        </Stack>
      ),
    },
    { id: "kind", header: "Type", accessor: "kind", hidden: true },
    { id: "last", header: "Last test", accessor: (c) => c.lastTestedAt ?? "", sortable: true, cell: (c) => (c.lastTestedAt ? date(c.lastTestedAt) : "—") },
    {
      id: "next",
      header: "Next test",
      accessor: "nextTestAt",
      sortable: true,
      cell: (c) => (
        <Stack gap="none">
          <span>{date(c.nextTestAt)}</span>
          <Text variant="caption" tone={c.daysToTest < 0 ? "accent" : "subtle"}>
            {c.daysToTest < 0 ? `${-c.daysToTest} days overdue` : `in ${c.daysToTest} days`}
          </Text>
        </Stack>
      ),
    },
    {
      id: "status",
      header: "Compliance",
      accessor: "status",
      sortable: true,
      cell: (c) => (
        <Stack gap="none">
          <StatusBadge status={c.status} tones={covenantStatusTones} />
          {c.lastResult && c.status === "Breached" && (
            <Text variant="caption" tone="subtle">
              {c.lastResult}
            </Text>
          )}
        </Stack>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (c) =>
        canEdit ? (
          <Menu
            align="end"
            triggerLabel={`Actions for ${c.id}`}
            trigger={<MoreHorizontal aria-hidden className="size-4" />}
            items={[
              { label: "Record covenant test", onSelect: () => setTestFor(c) },
              { label: c.exceptionId ? `Exception ${c.exceptionId} open` : "Raise exception", onSelect: () => raiseForCovenant(c), disabled: !!c.exceptionId },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <ModulePage
      module="monitoring"
      description="Every special covenant tagged at origination is a trackable compliance item with a due date, evidence requirement and owner. Account inflows are reconciled against the obligor's Nature-of-Business profile."
    >
      <Tabs
        label="Covenants and inflow tracking"
        defaultValue={initialTab}
        variant="underline"
        items={[
          {
            id: "register",
            label: "Covenant register",
            badge: counts.breached ? String(counts.breached) : undefined,
            content: (
              <Stack gap="large">
                <Grid columns={{ base: 2, lg: 4 }} gap="medium">
                  <StatCard label="Covenants tracked" value={number(counts.total)} hint={`${pct((counts.compliant / counts.total) * 100, 0)} compliant`} />
                  <StatCard label={`Test due ≤ ${dueSoon} days`} value={number(counts.due)} tone="info" />
                  <StatCard label="Overdue evidence" value={number(counts.overdue)} tone="warning" />
                  <StatCard label="Breached" value={number(counts.breached)} tone="danger" hint="Enter the escalation protocol" />
                </Grid>
                <DataTable
                  label="Covenant register"
                  data={covenants}
                  columns={columns}
                  getRowId={(c) => c.id}
                  searchable
                  searchPlaceholder="Search obligor, facility or covenant"
                  density="compact"
                  defaultSort={{ id: "next", direction: "asc" }}
                  filters={[
                    { id: "status", label: "Compliance", columnId: "status" },
                    { id: "kind", label: "Type", columnId: "kind" },
                    {
                      id: "owner",
                      label: "Owner",
                      options: [
                        { value: "mine", label: `My role (${roleById[actor.roleId]?.name ?? actor.roleId})` },
                        ...[...new Set(covenants.map((c) => c.ownerRole))].map((r) => ({ value: r, label: roleById[r as RoleId]?.name ?? r })),
                      ],
                      filterFn: (c, v) => (v === "mine" ? c.ownerRole === actor.roleId : c.ownerRole === v),
                    },
                  ]}
                  exportFilename="covenant-register.csv"
                  emptyState={<EmptyState title="No covenants match" description="Clear the filters to see the full register." />}
                />
              </Stack>
            ),
          },
          { id: "inflows", label: "Account inflows", content: <InflowsTab obligors={obligors} canEdit={canEdit} onRaise={setRaiseTarget} /> },
          { id: "periodic", label: "Periodic reviews", content: <PeriodicTab canEdit={canEdit} onRaise={setRaiseTarget} /> },
          { id: "fees", label: "External agents' fees", content: <FeesTab /> },
        ]}
      />
      <RaiseExceptionModal target={raiseTarget} onClose={() => setRaiseTarget(null)} />
      {testFor && <CovenantTestModal covenant={testFor} onClose={() => setTestFor(null)} onBreach={(c) => raiseForCovenant(c)} />}
    </ModulePage>
  );
}

/* ---------------- Covenant test ---------------- */

function CovenantTestModal({ covenant, onClose, onBreach }: { covenant: CovRow; onClose: () => void; onBreach: (c: CovRow) => void }) {
  const [outcome, setOutcome] = useState<"pass" | "fail">("pass");
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const minEvidence = useRule<number>("monitoring.exceptions.minEvidenceLength");
  const save = async () => {
    const r = await recordCovenantTest(covenant, { outcome, evidence, note });
    if (!r.ok) return setError(r.reason);
    onClose();
    const result = outcome === "pass" ? `Passed${note ? ` — ${note}` : ""}` : `Failed — ${note || "covenant not met"}`;
    if (outcome === "fail" && !covenant.exceptionId) onBreach({ ...covenant, status: "Breached", lastResult: result });
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record covenant test"
      description={`${covenant.obligorName} · ${covenant.text}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={evidence.trim().length < minEvidence}>
            Save result
          </Button>
        </>
      }
    >
      <Stack gap="medium">
        {error && <Alert tone="danger">{error}</Alert>}
        <RadioGroup
          name="outcome"
          label="Result"
          value={outcome}
          onChange={(v: string) => setOutcome(v as "pass" | "fail")}
          orientation="horizontal"
          options={[
            { value: "pass", label: "Passed" },
            { value: "fail", label: "Failed — breach" },
          ]}
        />
        <Field label="Evidence reference" htmlFor="cov-evidence" description={`Required: ${covenant.evidence}`} required>
          <Input id="cov-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="e.g. Q3 2026 management accounts.pdf" />
        </Field>
        <Field label="Result note" htmlFor="cov-note" optional>
          <Textarea id="cov-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. DSCR 1.42x on Q3 management accounts" />
        </Field>
        {outcome === "fail" && (
          <Alert tone="warning" title="A failed test raises a covenant-breach exception">
            You’ll be asked to confirm the exception, which enters the escalation protocol at Level 1.
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}

/* ---------------- Account inflows ---------------- */

function InflowsTab({ obligors, canEdit, onRaise }: { obligors: ReturnType<typeof useObligors>; canEdit: boolean; onRaise: (t: RaiseExceptionTarget) => void }) {
  const { obligor, sector } = useLookups();
  const profiles = useMemo(() => buildInflowProfiles(obligors), [obligors]);
  const flagged = profiles.filter((p) => p.aiFlag);
  const [selected, setSelected] = useState(flagged[0]?.obligorId ?? profiles[0]?.obligorId ?? "");
  const signoff = useMonitoring((s) => s.aiSignoffs[AI_KEY]);
  const exceptions = useMonitoring((s) => s.exceptions);
  const actor = useActor();
  const bandPct = useRule<number>("monitoring.inflow.envelopeBandPct");
  const p = profiles.find((x) => x.obligorId === selected);
  const o = p ? obligor.get(p.obligorId) : undefined;

  type InRow = InflowProfile & { name: string; sectorName: string };
  const rows: InRow[] = profiles.map((x) => {
    const ob = obligor.get(x.obligorId)!;
    return { ...x, name: ob.name, sectorName: sector.get(ob.sectorId)?.name ?? "" };
  });

  const accept = async () => {
    for (const f of flagged) {
      if (exceptions.some((e) => e.obligorId === f.obligorId && e.type === "Inflow-envelope deviation" && e.status !== "Resolved")) continue;
      const ob = obligor.get(f.obligorId)!;
      await raiseException({
        type: "Inflow-envelope deviation",
        title: "Inflow below AI envelope",
        detail: `${ob.name}: net verified inflow over the last 3 months is ${Math.round(f.ratio3m * 100)}% of the expected ${f.nature.toLowerCase()} pattern (AI-flagged, signed off by ${actor.name}).`,
        obligorId: f.obligorId,
        source: "AI-flagged",
      });
    }
    signOffAiFlag(AI_KEY, "accepted");
  };
  const dismiss = () => signOffAiFlag(AI_KEY, "dismissed");

  const inColumns: DataTableColumn<InRow>[] = [
    { id: "name", header: "Obligor", accessor: "name", sortable: true, cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
    { id: "nature", header: "Nature of business", accessor: "nature", sortable: true },
    { id: "sector", header: "Sector", accessor: "sectorName", sortable: true },
    { id: "net", header: "Net inflow (3m)", accessor: "net3m", numeric: true, sortable: true, cell: (r) => moneyShort(r.net3m) },
    { id: "ratio", header: "vs expected", accessor: "ratio3m", numeric: true, sortable: true, cell: (r) => pct(r.ratio3m * 100, 0) },
    { id: "status", header: "Envelope", accessor: "status", sortable: true, cell: (r) => <StatusBadge status={r.status} tones={inflowStatusTones} /> },
    { id: "ai", header: "AI", accessor: (r) => (r.aiFlag ? "AI-flagged" : ""), cell: (r) => (r.aiFlag ? <StatusBadge status="AI-flagged" tones={{ "AI-flagged": "warning" }} /> : null) },
  ];

  return (
    <Stack gap="large">
      {signoff?.decision !== "dismissed" && (
        <AiInsightCard
          kind="flagged"
          title="Inflow shortfall against the Nature-of-Business envelope"
          model="Credigit trend engine (simulated)"
          generatedAt={dateTime(DEMO_NOW)}
          confidence={0.82}
          paragraphs={[
            `${flagged.length} obligors show net verified account inflows well below their rolling expected envelope for the last three months. Their Nature-of-Business profiles expect regular monthly turnover, so the silence is an exception rather than seasonality.`,
          ]}
          bullets={flagged.map((f) => `${obligor.get(f.obligorId)?.name}: ${pct(f.ratio3m * 100, 0)} of expected (${f.nature}) — ${moneyShort(f.net3m)} vs ${moneyShort(f.expected3m)}`)}
          sources={[
            { label: "CBA connector — credit turnover, net of inter-branch, suspense, in-and-out and reversal entries (PRD §5.1)" },
            { label: "Nature-of-Business profile captured at origination (PRD §6.4.3)" },
            { label: "NGX Sector Corpus seasonality (PRD §6.2.8)" },
          ]}
          onAccept={canEdit && !signoff ? accept : undefined}
          onDismiss={canEdit && !signoff ? dismiss : undefined}
          labels={{ accept: "Accept & raise exceptions" }}
          signedOffBy={signoff ? `Signed off by ${signoff.by} on ${dateTime(signoff.at)} — exceptions raised` : undefined}
        />
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Expected vs actual inflow</CardTitle>
            <CardDescription>
              Monthly net verified credit turnover against the AI-built envelope (expected ± {bandPct}% — business rule). Expected pattern comes from declared turnover shaped by the
              Nature-of-Business profile.
            </CardDescription>
          </div>
        </CardHeader>
        <Stack gap="medium">
          <Field label="Obligor" htmlFor="inflow-obligor">
            <Select
              id="inflow-obligor"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              options={rows
                .slice()
                .sort((a, b) => Number(b.aiFlag) - Number(a.aiFlag) || a.name.localeCompare(b.name))
                .map((r) => ({ value: r.obligorId, label: `${r.aiFlag ? "⚑ " : ""}${r.name} — ${r.nature}` }))}
            />
          </Field>
          {p && o && (
            <Grid columns={{ base: 1, lg: 3 }} gap="large">
              <div className="lg:col-span-2">
                <LineChart
                  label={`Expected vs actual inflow — ${o.name}`}
                  height={240}
                  yFormatter={(v) => moneyShort(v)}
                  series={[
                    { name: "Envelope ceiling", tone: "neutral", points: p.ceiling.map((y, i) => ({ x: inflowMonthLabels[i]!, y })) },
                    { name: "Expected", tone: "info", points: p.expected.map((y, i) => ({ x: inflowMonthLabels[i]!, y })) },
                    { name: "Envelope floor", tone: "warning", points: p.floor.map((y, i) => ({ x: inflowMonthLabels[i]!, y })) },
                    { name: "Actual (net verified)", tone: "accent", points: p.actual.map((y, i) => ({ x: inflowMonthLabels[i]!, y })) },
                  ]}
                />
              </div>
              <Stack gap="medium">
                <Stack direction="horizontal" gap="small" wrap align="center">
                  <StatusBadge status={p.status} tones={inflowStatusTones} />
                  <Text variant="small" tone="muted">
                    {p.nature}
                  </Text>
                </Stack>
                <Text variant="small" tone="muted">
                  {natureDescriptions[p.nature]}
                </Text>
                <DescriptionList
                  columns={1}
                  layout="inline"
                  items={[
                    { label: "Gross CBA credits (3m)", value: money(p.gross3m), mono: true },
                    { label: "− Inter-branch", value: money(p.exclusions.interBranch), mono: true },
                    { label: "− Suspense", value: money(p.exclusions.suspense), mono: true },
                    { label: "− In-and-out", value: money(p.exclusions.inAndOut), mono: true, hint: "Pairs of near-equal value within T+2 (tenant window)" },
                    { label: "− Reversals", value: money(p.exclusions.reversals), mono: true },
                    { label: "Net verified inflow", value: money(p.net3m), mono: true },
                    { label: "Expected (3m)", value: money(p.expected3m), mono: true },
                    { label: "Ratio", value: pct(p.ratio3m * 100, 0), mono: true },
                  ]}
                />
                {canEdit && p.status === "Below envelope" && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      onRaise({
                        obligorId: o.id,
                        obligorName: o.name,
                        type: "Inflow-envelope deviation",
                        title: "Inflow below envelope",
                        detail: `${o.name}: net verified inflow over the last 3 months is ${pct(p.ratio3m * 100, 0)} of the expected ${p.nature.toLowerCase()} pattern.`,
                      })
                    }
                  >
                    Raise exception
                  </Button>
                )}
              </Stack>
            </Grid>
          )}
        </Stack>
      </Card>

      <DataTable
        label="Inflow tracking by obligor"
        data={rows}
        columns={inColumns}
        getRowId={(r) => r.obligorId}
        searchable
        density="compact"
        defaultSort={{ id: "ratio", direction: "asc" }}
        filters={[
          { id: "status", label: "Envelope", columnId: "status" },
          { id: "nature", label: "Nature of business", columnId: "nature" },
        ]}
        onRowClick={(r) => {
          setSelected(r.obligorId);
          if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        exportFilename="inflow-tracking.csv"
      />
    </Stack>
  );
}

/* ---------------- Periodic analysis (§6.4.5) ---------------- */

function PeriodicTab({ canEdit, onRaise }: { canEdit: boolean; onRaise: (t: RaiseExceptionTarget) => void }) {
  const obligors = useObligors();
  const facilities = useFacilities();
  const { obligor } = useLookups();
  const tests = useMonitoring((s) => s.covenantTests);
  type PRow = PeriodicReview & { name: string };
  const rows: PRow[] = useMemo(
    () =>
      buildPeriodicReviews(obligors, facilities).map((r) => {
        const t = tests[`PR-${r.obligorId}`];
        return { ...r, name: obligor.get(r.obligorId)?.name ?? r.obligorId, ...(t ? { status: "Received" as const, lastFinancialsAt: t.at, nextDueAt: t.nextTestAt ?? r.nextDueAt, reviewer: t.by } : {}) };
      }),
    [obligors, facilities, obligor, tests],
  );
  const markReceived = (r: PRow) => {
    recordPeriodicFinancials(r.obligorId, r.type, r.status);
  };
  const cols: DataTableColumn<PRow>[] = [
    { id: "name", header: "Obligor", accessor: "name", sortable: true, cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
    { id: "type", header: "Periodic report", accessor: "type", sortable: true },
    { id: "last", header: "Last received", accessor: "lastFinancialsAt", sortable: true, cell: (r) => date(r.lastFinancialsAt) },
    { id: "next", header: "Next due", accessor: "nextDueAt", sortable: true, cell: (r) => date(r.nextDueAt) },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (r) => <StatusBadge status={r.status} tones={{ Received: "success", Due: "info", Overdue: "danger" }} /> },
    {
      id: "grade",
      header: "Risk grade (orig. → now)",
      accessor: "gradeNow",
      sortable: true,
      cell: (r) => (
        <Stack direction="horizontal" gap="small" align="center">
          <span className="font-mono">
            {r.gradeAtOrigination} → {r.gradeNow}
          </span>
          <MetricDelta delta={r.gradeNow - r.gradeAtOrigination} invert size="small" format={(v: number) => (v > 0 ? `+${v}` : String(v))} />
        </Stack>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (r) =>
        canEdit && r.status !== "Received" ? (
          <Stack direction="horizontal" gap="small">
            <Button size="small" variant="tertiary" onClick={() => markReceived(r)}>
              Mark received
            </Button>
            {r.status === "Overdue" && (
              <Button
                size="small"
                variant="text"
                onClick={() =>
                  onRaise({ obligorId: r.obligorId, obligorName: r.name, type: "Periodic financials overdue", title: `${r.type} overdue`, detail: `${r.name}: ${r.type.toLowerCase()} were due on ${date(r.nextDueAt)} and have not been received.` })
                }
              >
                Raise exception
              </Button>
            )}
          </Stack>
        ) : null,
    },
  ];
  return (
    <Stack gap="large">
      <Alert tone="info" title="Post-disbursement continuous periodic analysis (PRD §6.4.5)">
        Borrowers upload periodic financial reports for the life of the loan, so Loan Review monitors the overall health of the customer — not only loan performance.
      </Alert>
      <Grid columns={{ base: 1, sm: 3 }} gap="medium">
        <StatCard label="Obligors under periodic review" value={number(rows.length)} />
        <StatCard label="Reports due ≤ 21 days" value={number(rows.filter((r) => r.status === "Due").length)} tone="info" />
        <StatCard label="Reports overdue" value={number(rows.filter((r) => r.status === "Overdue").length)} tone="danger" />
      </Grid>
      <DataTable label="Periodic reviews" data={rows} columns={cols} getRowId={(r) => r.obligorId} searchable density="compact" defaultSort={{ id: "next", direction: "asc" }} filters={[{ id: "status", label: "Status", columnId: "status" }]} exportFilename="periodic-reviews.csv" />
    </Stack>
  );
}

/* ---------------- External agents' fees (§6.4.3) ---------------- */

function FeesTab() {
  const obligors = useObligors();
  const { obligor } = useLookups();
  const fees = useMemo(() => buildAgentFees(obligors).map((f) => ({ ...f, name: obligor.get(f.obligorId)?.name ?? "" })), [obligors, obligor]);
  type F = (typeof fees)[number];
  const cols: DataTableColumn<F>[] = [
    { id: "invoice", header: "Invoice", accessor: "invoiceRef", cell: (f) => <span className="font-mono">{f.invoiceRef}</span> },
    { id: "agent", header: "Agent", accessor: "agent", sortable: true, cell: (f) => <Stack gap="none"><span className="text-fg">{f.agent}</span><Text variant="caption" tone="subtle">{f.kind}</Text></Stack> },
    { id: "kind", header: "Kind", accessor: "kind", hidden: true },
    { id: "obligor", header: "Obligor", accessor: "name", sortable: true },
    { id: "amount", header: "Amount", accessor: "amount", numeric: true, sortable: true, cell: (f) => money(f.amount) },
    { id: "date", header: "Invoiced", accessor: "invoicedAt", sortable: true, cell: (f) => date(f.invoicedAt) },
    { id: "status", header: "Reconciliation", accessor: "status", sortable: true, cell: (f) => <StatusBadge status={f.status} tones={{ Reconciled: "success", "Awaiting debit to customer": "info", "Paid — not reconciled": "warning", Disputed: "danger" }} /> },
  ];
  const total = fees.reduce((a, f) => a + f.amount, 0);
  const unrec = fees.filter((f) => f.status !== "Reconciled").reduce((a, f) => a + f.amount, 0);
  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, sm: 3 }} gap="medium">
        <StatCard label="Fees recorded (YTD)" value={moneyShort(total)} hint={`${fees.length} invoices`} />
        <StatCard label="Not yet reconciled" value={moneyShort(unrec)} tone="warning" />
        <StatCard label="Disputed" value={number(fees.filter((f) => f.status === "Disputed").length)} tone="danger" />
      </Grid>
      <DataTable label="External agents' fees" caption={`Valuers, solicitors and other external agents per the Payment of External Agents' Fees procedure. As of ${format(DEMO_NOW, "d MMM yyyy")}.`} data={fees} columns={cols} getRowId={(f) => f.id} searchable density="compact" filters={[{ id: "kind", label: "Agent type", columnId: "kind" }, { id: "status", label: "Status", columnId: "status" }]} exportFilename="external-agents-fees.csv" />
    </Stack>
  );
}
