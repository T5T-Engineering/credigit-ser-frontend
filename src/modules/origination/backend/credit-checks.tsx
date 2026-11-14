"use client";

/**
 * Credit checks of an application on the backend API (backend ADR-0022 / ADR-0023 / ADR-0024): bureau / CRMS checks and statements for
 * the COP Ratio (connector runs, results keyed in from print-outs / consented statements when no connector job delivers them), the COP
 * Ratio and customer explanation, engine inputs and the computed limit gate / recommendation, covenant tagging and Legal's collateral
 * search. Every action is permission-gated here and re-checked by the backend (endpoint key, rule role group, stage).
 */
import { useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  DescriptionList,
  Field,
  Grid,
  Input,
  Select,
  Spinner,
  Stack,
  Text,
  Textarea,
  type DataTableColumn,
  type Tone,
} from "@credigit/web-ui";
import { date, dateTime, money } from "@/lib/format";
import { useCan } from "@/lib/iam/permissions";
import { useRule } from "@/lib/platform/rules";
import { recommendationLabel } from "../logic";
import {
  isBreach,
  originationApi,
  useBackend,
  type AnalysisInputs,
  type ApplicationAck,
  type BureauLine,
  type ConnectorRun,
  type CreditApplication,
  type LimitGateDetail,
  type StatementSummary,
} from "./api";

export type Run = (title: string, call: () => Promise<unknown>, text: (ack: ApplicationAck) => string) => Promise<boolean>;

const bandTones: Record<string, Tone> = { High: "success", Medium: "warning", Low: "danger" };
const runTones: Record<ConnectorRun["status"], Tone> = { Requested: "warning", Completed: "success", Failed: "danger" };

/** Parses a typed amount ("1,250,000" → 1250000); null when empty or not a number. */
const num = (v: string) => {
  const n = Number(v.replace(/,/g, "").trim());
  return v.trim() && Number.isFinite(n) ? n : null;
};

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);

function Actions({ children }: { children: ReactNode }) {
  return (
    <Stack direction="horizontal" gap="small" wrap>
      {children}
    </Stack>
  );
}

// ---------------------------------------------------------------- Credit checks tab

/** Bureau / CRMS checks and the COP Ratio (PRD §5.2, §6.1.4). */
export function CreditChecks({ app, run }: { app: CreditApplication; run: Run }) {
  const runs = useBackend(() => originationApi.connectorRuns(app.id), [app.id, app.version]);
  const byId = new Map((runs.data ?? []).map((r) => [r.id, r]));
  const pick = (ids?: string[]) => (ids ?? []).map((id) => byId.get(id)).filter((r): r is ConnectorRun => Boolean(r));
  return (
    <Stack gap="large">
      {runs.error ? <Alert tone="danger">{runs.error}</Alert> : null}
      {runs.loading && !runs.data ? <Spinner label="Loading connector runs" /> : null}
      <BureauCard app={app} runs={pick(app.bureauCheck?.runIds)} run={run} />
      <CopCard app={app} runs={pick(app.statements?.runIds)} run={run} />
    </Stack>
  );
}

function BureauCard({ app, runs, run }: { app: CreditApplication; runs: ConnectorRun[]; run: Run }) {
  const canRun = useCan("origination.bureau-checks.run");
  const canRecord = useCan("origination.bureau-checks.record");
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<string | null>(null);
  const check = app.bureauCheck;
  const inAnalysis = app.stage === "Analysis";
  const act = async (title: string, call: () => Promise<unknown>, text: (ack: ApplicationAck) => string) => {
    setBusy(true);
    const ok = await run(title, call, text);
    setBusy(false);
    if (ok) setEntry(null);
  };
  const columns: DataTableColumn<ConnectorRun>[] = [
    { id: "source", header: "Source", accessor: "connectorName" },
    { id: "status", header: "Status", accessor: "status", cell: (r) => <Badge tone={runTones[r.status]}>{r.status}</Badge> },
    { id: "reference", header: "Reference", accessor: (r) => r.reference ?? "—" },
    { id: "score", header: "Score", numeric: true, accessor: (r) => r.result?.bureau?.score ?? "—" },
    { id: "np", header: "Non-performing", numeric: true, accessor: (r) => (r.result?.bureau ? r.result.bureau.lines.filter((l) => l.nonPerforming).length : "—") },
    { id: "outstanding", header: "Outstanding", numeric: true, accessor: (r) => (r.result?.bureau ? money(r.result.bureau.lines.reduce((s, l) => s + l.outstandingNgn, 0)) : "—") },
    {
      id: "action",
      header: "",
      cell: (r) =>
        r.status === "Requested" && inAnalysis && canRecord ? (
          <Button size="small" variant="secondary" onClick={() => setEntry(r.id)}>
            Record result
          </Button>
        ) : r.message ? (
          <Text variant="caption" tone="muted">{r.message}</Text>
        ) : null,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Credit bureau and CRMS</CardTitle>
          <CardDescription>At least the configured bureaux plus the CBN CRMS search, before the analysis (PRD §5.2).</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          {check ? (
            <DescriptionList
              items={[
                { label: "Requested", value: `${dateTime(check.requestedAt)} by ${check.requestedBy.name}` },
                {
                  label: "Status",
                  value: check.completedAt ? (
                    <Badge tone={check.adverse ? "danger" : "success"}>{check.adverse ? "Complete — adverse finding" : "Complete — no adverse finding"}</Badge>
                  ) : (
                    <Badge tone="warning">{`${runs.filter((r) => r.status === "Completed").length} of ${check.runIds.length} results in`}</Badge>
                  ),
                },
              ]}
            />
          ) : (
            <Text variant="small" tone="muted">No checks requested yet.</Text>
          )}
          {runs.length ? <DataTable label="Bureau and CRMS runs" columns={columns} data={runs} getRowId={(r) => r.id} /> : null}
          {entry ? (
            <BureauResultForm
              runName={runs.find((r) => r.id === entry)?.connectorName ?? entry}
              busy={busy}
              onCancel={() => setEntry(null)}
              onSave={(body) => act("Result recorded", () => originationApi.recordBureauResult(app.id, entry, body), () => "The result is on record and audited.")}
            />
          ) : null}
          {inAnalysis && canRun ? (
            <Actions>
              <Button variant={check ? "secondary" : "primary"} loading={busy} disabled={busy} onClick={() => void act("Bureau checks requested", () => originationApi.runBureauChecks(app.id), () => "The bureau and CRMS enquiries are requested.")}>
                {check ? "Run the checks again" : "Run bureau and CRMS checks"}
              </Button>
            </Actions>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

type LineDraft = { institution: string; facilityType: string; approved: string; outstanding: string; nonPerforming: boolean };
const emptyLine: LineDraft = { institution: "", facilityType: "", approved: "", outstanding: "", nonPerforming: false };

function BureauResultForm({ runName, busy, onCancel, onSave }: { runName: string; busy: boolean; onCancel: () => void; onSave: (body: { reference: string; score: number | null; lines: BureauLine[]; evidenceDocumentId: string | null }) => void }) {
  const [reference, setReference] = useState("");
  const [score, setScore] = useState("");
  const [evidence, setEvidence] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const filled = lines.filter((l) => l.institution.trim() || l.facilityType.trim());
  const valid = reference.trim() && filled.every((l) => l.institution.trim() && l.facilityType.trim() && num(l.approved) != null && num(l.outstanding) != null);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Record {runName} result</CardTitle>
          <CardDescription>From the provider print-out: reference, score and every facility reported, bank by bank.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          <Grid columns={{ base: 1, md: 3 }} gap="medium">
            <Field label="Reference" htmlFor="br-ref" required>
              <Input id="br-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Score" htmlFor="br-score" optional>
              <Input id="br-score" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} />
            </Field>
            <Field label="Evidence document ID" htmlFor="br-doc" optional description="The uploaded print-out (Documents tab).">
              <Input id="br-doc" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            </Field>
          </Grid>
          {lines.map((l, i) => (
            <Grid key={i} columns={{ base: 1, md: 3, lg: 6 }} gap="small">
              <Field label="Institution" htmlFor={`br-inst-${i}`}>
                <Input id={`br-inst-${i}`} value={l.institution} onChange={(e) => setLine(i, { institution: e.target.value })} />
              </Field>
              <Field label="Facility type" htmlFor={`br-type-${i}`}>
                <Input id={`br-type-${i}`} value={l.facilityType} onChange={(e) => setLine(i, { facilityType: e.target.value })} />
              </Field>
              <Field label="Approved (NGN)" htmlFor={`br-appr-${i}`}>
                <Input id={`br-appr-${i}`} inputMode="decimal" value={l.approved} onChange={(e) => setLine(i, { approved: e.target.value })} />
              </Field>
              <Field label="Outstanding (NGN)" htmlFor={`br-out-${i}`}>
                <Input id={`br-out-${i}`} inputMode="decimal" value={l.outstanding} onChange={(e) => setLine(i, { outstanding: e.target.value })} />
              </Field>
              <Checkbox label="Non-performing" checked={l.nonPerforming} onChange={(e) => setLine(i, { nonPerforming: e.target.checked })} />
            </Grid>
          ))}
          <Actions>
            <Button variant="tertiary" onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}>
              Add a facility line
            </Button>
          </Actions>
          <Actions>
            <Button
              loading={busy}
              disabled={busy || !valid}
              onClick={() =>
                onSave({
                  reference: reference.trim(),
                  score: num(score),
                  evidenceDocumentId: evidence.trim() || null,
                  lines: filled.map((l) => ({ institution: l.institution.trim(), facilityType: l.facilityType.trim(), approvedNgn: num(l.approved)!, outstandingNgn: num(l.outstanding)!, nonPerforming: l.nonPerforming })),
                })
              }
            >
              Save result
            </Button>
            <Button variant="tertiary" onClick={onCancel}>
              Cancel
            </Button>
          </Actions>
        </Stack>
      </CardContent>
    </Card>
  );
}

function CopCard({ app, runs, run }: { app: CreditApplication; runs: ConnectorRun[]; run: Run }) {
  const canRequest = useCan("origination.statements.request");
  const canRecord = useCan("origination.statements.record");
  const canCompute = useCan("origination.cop.compute");
  const canExplain = useCan("origination.cop-explanations.update");
  const minComment = useRule<number>("operations.minCommentLength");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"request" | "compute" | "explain" | null>(null);
  const [entry, setEntry] = useState<string | null>(null);
  const [banks, setBanks] = useState("");
  const [declared, setDeclared] = useState(app.customer.declaredTurnoverNgn == null ? "" : String(app.customer.declaredTurnoverNgn));
  const [afs, setAfs] = useState("");
  const [explanation, setExplanation] = useState(app.cop?.explanation ?? "");
  const inAnalysis = app.stage === "Analysis";
  const cop = app.cop;
  const act = async (title: string, call: () => Promise<unknown>, text: (ack: ApplicationAck) => string) => {
    setBusy(true);
    const ok = await run(title, call, text);
    setBusy(false);
    if (ok) {
      setPanel(null);
      setEntry(null);
    }
  };
  const columns: DataTableColumn<ConnectorRun>[] = [
    { id: "source", header: "Statement", accessor: (r) => (r.parameters.bank ? `${r.connectorName} · ${r.parameters.bank}` : r.connectorName) },
    { id: "status", header: "Status", accessor: "status", cell: (r) => <Badge tone={runTones[r.status]}>{r.status}</Badge> },
    { id: "period", header: "Period", accessor: (r) => (r.result?.statement ? `${date(r.result.statement.periodFrom)} – ${date(r.result.statement.periodTo)}` : "—") },
    { id: "gross", header: "Gross credits", numeric: true, accessor: (r) => (r.result?.statement ? money(r.result.statement.grossCreditsNgn) : "—") },
    {
      id: "excluded",
      header: "Discounted",
      numeric: true,
      accessor: (r) => (r.result?.statement ? money(r.result.statement.interBranchSuspenseNgn + r.result.statement.inAndOutNgn + r.result.statement.reversalsNgn) : "—"),
    },
    {
      id: "action",
      header: "",
      cell: (r) =>
        r.status === "Requested" && inAnalysis && canRecord ? (
          <Button size="small" variant="secondary" onClick={() => setEntry(r.id)}>
            Record statement
          </Button>
        ) : r.message ? (
          <Text variant="caption" tone="muted">{r.message}</Text>
        ) : null,
    },
  ];
  const entryRun = runs.find((r) => r.id === entry);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Statements and COP Ratio</CardTitle>
          <CardDescription>Verified bank-account turnover (reconciled, CBA and other banks) ÷ declared turnover per audited financial statement (PRD §6.1.4).</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          {cop ? (
            <DescriptionList
              items={[
                { label: "COP Ratio", value: <Badge tone={bandTones[cop.band] ?? "neutral"}>{`${cop.ratio.toFixed(2)} · ${cop.band} confidence`}</Badge> },
                { label: "Verified turnover", value: money(cop.verifiedTurnoverNgn) },
                { label: "Declared turnover", value: `${money(cop.declaredTurnoverNgn)}${cop.declaredSourceDocumentId ? ` · document ${cop.declaredSourceDocumentId}` : ""}` },
                { label: "Computed", value: `${dateTime(cop.computedAt)} by ${cop.computedBy.name}` },
                {
                  label: "Customer explanation",
                  value: cop.explanation ? `${cop.explanation} (${cop.explainedBy?.name ?? "—"}, ${cop.explainedAt ? dateTime(cop.explainedAt) : "—"})` : cop.requiresExplanation ? <Badge tone="danger">Required</Badge> : "Not required",
                },
              ]}
            />
          ) : (
            <Text variant="small" tone="muted">{app.statements ? "Statements requested; compute the ratio when they are all in." : "No statements requested yet."}</Text>
          )}
          {runs.length ? <DataTable label="Statement runs" columns={columns} data={runs} getRowId={(r) => r.id} /> : null}
          {entryRun ? (
            <StatementForm
              run={entryRun}
              busy={busy}
              onCancel={() => setEntry(null)}
              onSave={(body) => act("Statement recorded", () => originationApi.recordStatement(app.id, entryRun.id, body), () => "The reconciled statement is on record and audited.")}
            />
          ) : null}
          {panel === "request" ? (
            <Stack gap="small">
              <Field label="Other banks" htmlFor="st-banks" optional description="One bank per line. The CBA statement is always requested when configured.">
                <Textarea id="st-banks" rows={3} value={banks} onChange={(e) => setBanks(e.target.value)} />
              </Field>
              <Actions>
                <Button loading={busy} disabled={busy} onClick={() => void act("Statements requested", () => originationApi.requestStatements(app.id, banks.split("\n").map((b) => b.trim()).filter(Boolean)), () => "The statements are requested.")}>
                  Request statements
                </Button>
                <Button variant="tertiary" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
              </Actions>
            </Stack>
          ) : null}
          {panel === "compute" ? (
            <Stack gap="small">
              <Grid columns={{ base: 1, md: 2 }} gap="medium">
                <Field label="Declared turnover (NGN)" htmlFor="cop-declared" required description="Per the audited financial statements.">
                  <Input id="cop-declared" inputMode="decimal" value={declared} onChange={(e) => setDeclared(e.target.value)} />
                </Field>
                <Field label="Audited financials document ID" htmlFor="cop-afs" optional>
                  <Input id="cop-afs" value={afs} onChange={(e) => setAfs(e.target.value)} />
                </Field>
              </Grid>
              <Actions>
                <Button loading={busy} disabled={busy || !num(declared)} onClick={() => void act("COP Ratio computed", () => originationApi.computeCop(app.id, num(declared), afs.trim() || null), () => "The COP Ratio is on record.")}>
                  Compute COP Ratio
                </Button>
                <Button variant="tertiary" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
              </Actions>
            </Stack>
          ) : null}
          {panel === "explain" ? (
            <Stack gap="small">
              <Field label="Customer explanation" htmlFor="cop-expl" required description={`Why verified turnover differs from the declared figure. At least ${minComment} characters.`}>
                <Textarea id="cop-expl" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
              </Field>
              <Actions>
                <Button loading={busy} disabled={busy || explanation.trim().length < minComment} onClick={() => void act("Explanation recorded", () => originationApi.explainCop(app.id, explanation.trim()), () => "The customer's explanation is on record.")}>
                  Save explanation
                </Button>
                <Button variant="tertiary" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
              </Actions>
            </Stack>
          ) : null}
          {inAnalysis && !panel ? (
            <Actions>
              {canRequest ? (
                <Button variant={app.statements ? "secondary" : "primary"} onClick={() => setPanel("request")}>
                  {app.statements ? "Request statements again" : "Request statements"}
                </Button>
              ) : null}
              {canCompute && app.statements?.receivedAt ? <Button onClick={() => setPanel("compute")}>{cop ? "Recompute COP Ratio" : "Compute COP Ratio"}</Button> : null}
              {canExplain && cop ? (
                <Button variant={cop.requiresExplanation && !cop.explanation ? "primary" : "tertiary"} onClick={() => setPanel("explain")}>
                  {cop.explanation ? "Edit explanation" : "Record customer explanation"}
                </Button>
              ) : null}
            </Actions>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function StatementForm({ run, busy, onCancel, onSave }: { run: ConnectorRun; busy: boolean; onCancel: () => void; onSave: (body: { reference: string; statement: StatementSummary; evidenceDocumentId: string | null }) => void }) {
  const [f, setF] = useState({ reference: "", bank: run.parameters.bank ?? "", account: "", from: "", to: "", gross: "", interBranch: "", inAndOut: "", reversals: "", evidence: "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const amounts = [f.gross, f.interBranch, f.inAndOut, f.reversals].map(num);
  const valid = f.reference.trim() && f.bank.trim() && f.from && f.to && amounts.every((a) => a != null && a >= 0);
  const field = (k: keyof typeof f, label: string, opts: { amount?: boolean; type?: string; required?: boolean; description?: string } = {}) => (
    <Field label={label} htmlFor={`st-${k}`} required={opts.required} optional={!opts.required} description={opts.description}>
      <Input id={`st-${k}`} type={opts.type} inputMode={opts.amount ? "decimal" : undefined} value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Record {run.connectorName} statement</CardTitle>
          <CardDescription>The reconciled figures: gross credits and the inter-branch / suspense, in-and-out and reversal entries discounted (PRD §5.1).</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          <Grid columns={{ base: 1, md: 3 }} gap="medium">
            {field("reference", "Reference", { required: true })}
            {field("bank", "Bank", { required: true })}
            {field("account", "Account")}
            {field("from", "Period from", { type: "date", required: true })}
            {field("to", "Period to", { type: "date", required: true })}
            {field("evidence", "Evidence document ID", { description: "The consented statement (Documents tab)." })}
            {field("gross", "Gross credits (NGN)", { amount: true, required: true })}
            {field("interBranch", "Inter-branch / suspense (NGN)", { amount: true, required: true })}
            {field("inAndOut", "In-and-out (NGN)", { amount: true, required: true })}
            {field("reversals", "Reversals (NGN)", { amount: true, required: true })}
          </Grid>
          <Actions>
            <Button
              loading={busy}
              disabled={busy || !valid}
              onClick={() =>
                onSave({
                  reference: f.reference.trim(),
                  evidenceDocumentId: f.evidence.trim() || null,
                  statement: { bank: f.bank.trim(), accountRef: f.account.trim() || null, periodFrom: f.from, periodTo: f.to, grossCreditsNgn: amounts[0]!, interBranchSuspenseNgn: amounts[1]!, inAndOutNgn: amounts[2]!, reversalsNgn: amounts[3]! },
                })
              }
            >
              Save statement
            </Button>
            <Button variant="tertiary" onClick={onCancel}>
              Cancel
            </Button>
          </Actions>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Analysis (engine inputs)

/**
 * Engine inputs (backend ADR-0022): 360 RAR scores, risk grade, watchlist, security cover. Adverse bureau and COP come from their checks
 * when those exist (shown read-only); the server computes the limit gate and the system recommendation.
 */
export function AnalysisForm({ app, busy, onCancel, onSave }: { app: CreditApplication; busy: boolean; onCancel: () => void; onSave: (body: { inputs: AnalysisInputs; notes: string | null }) => void }) {
  const prev = app.analysis?.inputs;
  const [rar, setRar] = useState({
    internal: String(prev?.rar.internal ?? ""),
    comparative: String(prev?.rar.comparative ?? ""),
    industry: String(prev?.rar.industry ?? ""),
    macro: String(prev?.rar.macro ?? ""),
  });
  const [grade, setGrade] = useState(String(prev?.riskGrade ?? ""));
  const [cover, setCover] = useState(String(prev?.securityCoverPct ?? ""));
  const [watchlist, setWatchlist] = useState(prev?.watchlist ?? false);
  const [bureauAdverse, setBureauAdverse] = useState(prev?.bureauAdverse ?? false);
  const [cop, setCop] = useState(prev?.copRatio == null ? "" : String(prev.copRatio));
  const [copExplained, setCopExplained] = useState(prev?.copExplained ?? false);
  const [notes, setNotes] = useState(app.analysis?.notes ?? "");
  const bureauFixed = app.bureauCheck?.adverse != null;
  const copFixed = app.cop != null;
  const scores = [rar.internal, rar.comparative, rar.industry, rar.macro].map(num);
  const valid = scores.every((s) => s != null) && num(grade) != null && num(cover) != null;
  const score = (k: keyof typeof rar, label: string) => (
    <Field label={label} htmlFor={`an-${k}`} required description="1–10">
      <Input id={`an-${k}`} inputMode="decimal" value={rar[k]} onChange={(e) => setRar((r) => ({ ...r, [k]: e.target.value }))} />
    </Field>
  );
  return (
    <Stack gap="medium">
      <Text variant="small" tone="muted">The server computes the limit gate from the exposure book and runs the recommendation engine on these inputs.</Text>
      <Grid columns={{ base: 1, md: 4 }} gap="medium">
        {score("internal", "Internal Risk Assessment")}
        {score("comparative", "Comparative Assessment")}
        {score("industry", "Operating Industry")}
        {score("macro", "Macro-Economic")}
      </Grid>
      <Grid columns={{ base: 1, md: 3 }} gap="medium">
        <Field label="Internal risk grade" htmlFor="an-grade" required description="1 (best) – 10">
          <Input id="an-grade" inputMode="numeric" value={grade} onChange={(e) => setGrade(e.target.value)} />
        </Field>
        <Field label="Security cover (%)" htmlFor="an-cover" required description="Collateral lending value as % of the amount.">
          <Input id="an-cover" inputMode="decimal" value={cover} onChange={(e) => setCover(e.target.value)} />
        </Field>
        <Field label="COP Ratio" htmlFor="an-cop" optional description={copFixed ? "From the COP assessment." : "Until statements are reconciled here."}>
          <Input id="an-cop" inputMode="decimal" disabled={copFixed} value={copFixed ? app.cop!.ratio.toFixed(2) : cop} onChange={(e) => setCop(e.target.value)} />
        </Field>
      </Grid>
      <Stack direction="horizontal" gap="medium" wrap>
        <Checkbox label="Obligor on the watchlist" checked={watchlist} onChange={(e) => setWatchlist(e.target.checked)} />
        <Checkbox label="Adverse bureau / CRMS finding" description={bureauFixed ? "From the bureau check." : undefined} disabled={bureauFixed} checked={bureauFixed ? Boolean(app.bureauCheck!.adverse) : bureauAdverse} onChange={(e) => setBureauAdverse(e.target.checked)} />
        <Checkbox label="Low COP explained" description={copFixed ? "From the COP assessment." : undefined} disabled={copFixed} checked={copFixed ? Boolean(app.cop!.explanation) : copExplained} onChange={(e) => setCopExplained(e.target.checked)} />
      </Stack>
      <Field label="Notes" htmlFor="an-notes" optional>
        <Textarea id="an-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Actions>
        <Button
          loading={busy}
          disabled={busy || !valid}
          onClick={() =>
            onSave({
              notes: notes.trim() || null,
              inputs: {
                rar: { internal: scores[0]!, comparative: scores[1]!, industry: scores[2]!, macro: scores[3]! },
                riskGrade: num(grade)!,
                securityCoverPct: num(cover)!,
                watchlist,
                bureauAdverse,
                copRatio: num(cop),
                copExplained,
              },
            })
          }
        >
          Save analysis
        </Button>
        <Button variant="tertiary" onClick={onCancel}>
          Cancel
        </Button>
      </Actions>
    </Stack>
  );
}

/** Limit gate figures (PRD §5.6, §8). */
export function GateFigures({ gate }: { gate: LimitGateDetail }) {
  return (
    <DescriptionList
      items={[
        { label: "Result", value: <Badge tone={isBreach(gate.result) ? "danger" : gate.nearBreaches.length ? "warning" : "success"}>{gate.result}</Badge> },
        { label: "Other breaches", value: gate.breaches.filter((b) => b !== gate.result).join(", ") || "—" },
        { label: "Near limits", value: gate.nearBreaches.join(", ") || "—" },
        { label: "Obligor exposure", value: `${money(gate.obligorTotalNgn)} of ${money(gate.singleObligorLimitNgn)} (${pct(gate.singleObligorUtilisationPct)})${gate.obligorLinked ? "" : " · request only (no obligor id)"}` },
        { label: "Large exposure", value: gate.largeExposure ? `Yes · all large exposures ${money(gate.aggregateLargeExposureNgn)} of ${money(gate.aggregateLargeExposureLimitNgn)}` : "No" },
        { label: "Sector", value: gate.sectorLimitNgn == null ? `${gate.sectorId ?? "—"} · no sector limit` : `${gate.sectorId} · ${money(gate.sectorExposureNgn)} of ${money(gate.sectorLimitNgn)} (${pct(gate.sectorUtilisationPct)})` },
        { label: "Book", value: `${money(gate.bookSizeNgn)}${gate.bookAsOf ? ` as of ${date(gate.bookAsOf)}` : " · no book imported"}` },
        { label: "Evaluated", value: dateTime(gate.evaluatedAt) },
      ]}
    />
  );
}

/** The recorded analysis: engine result and rationale, gate figures, and an on-demand gate run. */
export function AnalysisDetail({ app }: { app: CreditApplication }) {
  const canGate = useCan("origination.limit-gate.run");
  const [live, setLive] = useState<{ gate: LimitGateDetail | null; error: string | null; busy: boolean }>({ gate: null, error: null, busy: false });
  const a = app.analysis;
  const check = async () => {
    setLive({ gate: null, error: null, busy: true });
    try {
      setLive({ gate: await originationApi.limitGate(app.id), error: null, busy: false });
    } catch (e) {
      setLive({ gate: null, error: e instanceof Error ? e.message : String(e), busy: false });
    }
  };
  return (
    <Grid columns={{ base: 1, lg: 2 }} gap="large">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recommendation engine</CardTitle>
            <CardDescription>System recommendation and rationale (PRD §6.1.5).</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {a?.engine ? (
            <Stack gap="medium">
              <DescriptionList
                items={[
                  { label: "System recommendation", value: recommendationLabel[a.engine.recommendation] },
                  { label: "Adopted", value: app.recommendation ? recommendationLabel[app.recommendation] : "—" },
                  { label: "360 RAR posture", value: a.engine.position.label },
                  { label: "COP band", value: a.engine.copBand ?? "—" },
                  { label: "Recorded", value: `${dateTime(a.completedAt)} by ${a.completedBy.name}` },
                ]}
              />
              <Stack gap="xsmall">
                {a.engine.rationale.map((r, i) => (
                  <Text key={i} variant="small">
                    {r}
                  </Text>
                ))}
              </Stack>
            </Stack>
          ) : (
            <Text variant="small" tone="muted">{a ? "Recorded before the engine ran on the server." : "Not recorded yet."}</Text>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Portfolio-limit gate</CardTitle>
            <CardDescription>Single obligor, aggregate large exposure and sector (PRD §5.6). Re-checked before submission for approval.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Stack gap="medium">
            {live.gate ? <GateFigures gate={live.gate} /> : a?.gate ? <GateFigures gate={a.gate} /> : <Text variant="small" tone="muted">Computed when the analysis is recorded.</Text>}
            {live.error ? <Alert tone="danger">{live.error}</Alert> : null}
            {canGate && app.stage === "Analysis" ? (
              <Actions>
                <Button variant="secondary" loading={live.busy} disabled={live.busy} onClick={() => void check()}>
                  Check the limits now
                </Button>
              </Actions>
            ) : null}
            {live.gate ? <Text variant="caption" tone="muted">Shown: the gate as it stands now (not saved).</Text> : null}
          </Stack>
        </CardContent>
      </Card>
    </Grid>
  );
}

// ---------------------------------------------------------------- Covenants

/** Covenants and conditions for the offer letter (PRD §6.1.5, §7): tagged by the engine, amended by the analyst. */
export function Covenants({ app, run }: { app: CreditApplication; run: Run }) {
  const canUpdate = useCan("origination.covenants.update");
  const library = useBackend(() => originationApi.covenantLibrary(), []);
  const minComment = useRule<number>("operations.minCommentLength");
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const set = app.covenants;
  const editable = canUpdate && app.stage === "Analysis" && Boolean(set);
  const clause = (id: string) => library.data?.find((c) => c.id === id);
  const act = async (title: string, call: () => Promise<unknown>) => {
    setBusy(true);
    const ok = await run(title, call, () => "The covenant set is updated; the initiator is told.");
    setBusy(false);
    if (ok) {
      setAdd("");
      setRemoving(null);
      setReason("");
    }
  };
  if (!set) return <Alert tone="info">Covenants are tagged from the master library when the analysis is recorded.</Alert>;
  const effective = new Set(set.effective);
  const addable = (library.data ?? []).filter((c) => !effective.has(c.id));
  return (
    <Stack gap="large">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Covenants and conditions</CardTitle>
            <CardDescription>{`Tagged ${dateTime(set.taggedAt)}${set.updatedBy ? ` · changed by ${set.updatedBy.name} ${set.updatedAt ? dateTime(set.updatedAt) : ""}` : ""}. This set goes into the offer letter on approval.`}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Stack gap="medium">
            {set.tagged.filter((t) => effective.has(t.clauseId)).map((t) => (
              <Stack key={t.clauseId} direction="horizontal" justify="between" align="center" wrap gap="small">
                <div>
                  <Text className="font-semibold">{`${t.clauseId} · ${t.title}`}</Text>
                  <Text variant="caption" tone="muted">{`${t.library} · ${t.category} · ${t.reasons.join("; ")}`}</Text>
                </div>
                {editable ? (
                  <Button size="small" variant="tertiary" onClick={() => setRemoving(t.clauseId)}>
                    Remove
                  </Button>
                ) : null}
              </Stack>
            ))}
            {set.added.map((id) => (
              <Stack key={id} direction="horizontal" justify="between" align="center" wrap gap="small">
                <div>
                  <Text className="font-semibold">{`${id} · ${clause(id)?.title ?? ""}`}</Text>
                  <Text variant="caption" tone="muted">Added by the analyst</Text>
                </div>
                {editable ? (
                  <Button size="small" variant="tertiary" loading={busy} disabled={busy} onClick={() => void act("Clause removed", () => originationApi.updateCovenants(app.id, [], [{ clauseId: id, reason: "Addition withdrawn" }]))}>
                    Remove
                  </Button>
                ) : null}
              </Stack>
            ))}
            {removing ? (
              <Stack gap="small">
                <Field label={`Why remove ${removing}?`} htmlFor="cov-reason" required description={`At least ${minComment} characters; kept in the audit log.`}>
                  <Textarea id="cov-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Actions>
                  <Button variant="danger" loading={busy} disabled={busy || reason.trim().length < minComment} onClick={() => void act("Clause removed", () => originationApi.updateCovenants(app.id, [], [{ clauseId: removing, reason: reason.trim() }]))}>
                    Remove clause
                  </Button>
                  <Button variant="tertiary" onClick={() => setRemoving(null)}>
                    Cancel
                  </Button>
                </Actions>
              </Stack>
            ) : null}
            {editable && addable.length ? (
              <Grid columns={{ base: 1, md: 2 }} gap="small">
                <Field label="Add a library clause" htmlFor="cov-add">
                  <Select id="cov-add" value={add} onChange={(e) => setAdd(e.target.value)} options={[{ value: "", label: "Choose a clause" }, ...addable.map((c) => ({ value: c.id, label: `${c.id} · ${c.title}` }))]} />
                </Field>
                <div>
                  <Button loading={busy} disabled={busy || !add} onClick={() => void act("Clause added", () => originationApi.updateCovenants(app.id, [add], []))}>
                    Add clause
                  </Button>
                </div>
              </Grid>
            ) : null}
          </Stack>
        </CardContent>
      </Card>
      {set.removed.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Removed by the analyst</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList items={set.removed.map((r) => ({ label: r.clauseId, value: `${r.reason} — ${r.by.name}, ${dateTime(r.at)}` }))} />
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}

// ---------------------------------------------------------------- Due diligence

/** Legal's collateral search (PRD §6.1.1 steps 2–3; backend ADR-0023): the BDM can concur only once it is on record. */
export function DueDiligence({ app, run }: { app: CreditApplication; run: Run }) {
  const canRecord = useCan("origination.collateral-search.record");
  const minComment = useRule<number>("operations.minCommentLength");
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"Complete" | "Not required">("Complete");
  const [findings, setFindings] = useState("");
  const [busy, setBusy] = useState(false);
  const s = app.collateralSearch;
  const save = async () => {
    setBusy(true);
    const ok = await run("Collateral search recorded", () => originationApi.recordCollateralSearch(app.id, outcome, findings.trim()), () => "The search is on record; the BDM and initiator are told.");
    setBusy(false);
    if (ok) setOpen(false);
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Collateral due diligence</CardTitle>
          <CardDescription>Legal&apos;s collateral search. The BDM can concur only once it is on record.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          {s ? (
            <DescriptionList
              items={[
                { label: "Outcome", value: <Badge tone="success">{s.outcome}</Badge> },
                { label: "Findings", value: s.findings },
                { label: "Recorded", value: `${dateTime(s.at)} by ${s.by.name}` },
              ]}
            />
          ) : (
            <Text variant="small" tone="muted">Not recorded yet.</Text>
          )}
          {open ? (
            <Stack gap="small">
              <Field label="Outcome" htmlFor="dd-outcome" required>
                <Select id="dd-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} options={[{ value: "Complete", label: "Search complete" }, { value: "Not required", label: "Not required (nothing pledged)" }]} />
              </Field>
              <Field label={outcome === "Complete" ? "Findings" : "Why no search is required"} htmlFor="dd-findings" required description={`At least ${minComment} characters.`}>
                <Textarea id="dd-findings" rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} />
              </Field>
              <Actions>
                <Button loading={busy} disabled={busy || findings.trim().length < minComment} onClick={() => void save()}>
                  Record search
                </Button>
                <Button variant="tertiary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </Actions>
            </Stack>
          ) : canRecord && (app.stage === "Analysis" || app.stage === "Approval") ? (
            <Actions>
              <Button variant={s ? "secondary" : "primary"} onClick={() => setOpen(true)}>
                {s ? "Record the search again" : "Record collateral search"}
              </Button>
            </Actions>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
