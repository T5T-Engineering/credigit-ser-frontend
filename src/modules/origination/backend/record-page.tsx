"use client";

/**
 * Credit application record on the backend API: header, next step and actions (submit, analysis, limit exception, override, submit for
 * approval, withdraw), overview, documents (platform DMS, subject `Application`), approvals (backend Operations), comments.
 * Every action is permission-gated here and re-checked by the backend (endpoint key, rule role group, Operations eligibility).
 */
import { Suspense, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BriefcaseBusiness, FileSearch } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  EmptyState,
  EntityHeader,
  Field,
  Grid,
  Input,
  PermissionGate,
  Select,
  Spinner,
  Stack,
  StatusBadge,
  Tabs,
  Text,
  Textarea,
  TextLink,
} from "@credigit/web-ui";
import { date, dateTime, money } from "@/lib/format";
import { useCan } from "@/lib/iam/permissions";
import { useRule } from "@/lib/platform/rules";
import { OutcomePopup } from "@/lib/ui/outcome-popup";
import { backendItemHref } from "@/modules/operations/backend-operations";
import { SubjectDocuments, useDocumentVocabulary } from "@/modules/documents/subject-documents";
import { useMasterDataValues, type MasterDataValue } from "@/modules/master-data/api";
import { requiredKinds } from "../params";
import { recommendationLabel } from "../logic";
import {
  LIMIT_GATE_RESULTS,
  RECOMMENDATIONS,
  errorText,
  isBreach,
  originationApi,
  useBackend,
  type ApplicationAck,
  type CreditApplication,
  type LimitGateResult,
  type Recommendation,
} from "./api";
import { backendNextAction, backendSlaState, backendStageTones, isOpenStage } from "./view";

/** DMS subject type of credit applications (backend `OriginationSubjects.Application`). */
const SUBJECT_TYPE = "Application";

/** Record sections that exist only in demo mode until their backend services are built (TD-980). */
const DEMO_ONLY_SECTIONS = [
  { title: "Financials & COP Ratio", detail: "Statement reconciliation and COP banding (PRD §6.1.4, §8). The analyst records the COP ratio with the analysis outcome." },
  { title: "Credit bureau / CRMS", detail: "Bureau and CRMS connectors (PRD §5.2)." },
  { title: "360 RAR", detail: "Obligor posture from Credit Analysis (PRD §6.2)." },
  { title: "Collateral", detail: "Pledged collateral and due diligence before BDM concurrence (PRD §6.1.1 step 3)." },
  { title: "Recommendation engine & covenants", detail: "Engine rationale and covenant tagging (PRD §6.1.5). The analyst records the system recommendation." },
  { title: "Credit memo", detail: "AI-drafted memo with sign-off (PRD §2.3)." },
  { title: "Release to offer", detail: "Hand-over to Offer Letters after final approval (PRD §6.1.1 step 13)." },
];

type Outcome = { tone: "success" | "info" | "danger"; title: string; text: string; operationId?: string | null };

export function BackendApplicationPage() {
  return (
    <Suspense fallback={<Spinner label="Loading application" />}>
      <Record />
    </Suspense>
  );
}

function Record() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const allowed = useCan(["origination.applications.view", "origination.applications.view-mine"]);
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const detail = useBackend(id ? () => originationApi.get(id) : null, [id]);

  const run = async (title: string, call: () => Promise<ApplicationAck | unknown>, text: (ack: ApplicationAck) => string) => {
    try {
      const ack = (await call()) as ApplicationAck;
      setOutcome({ tone: ack?.operationId ? "info" : "success", title, text: text(ack), operationId: ack?.operationId });
      detail.reload();
      return true;
    } catch (e) {
      setOutcome({ tone: "danger", title: `${title} — not done`, text: errorText(e) });
      return false;
    }
  };

  if (!allowed) return <PermissionGate allowed={false} description="You don't have access to loan origination.">{null}</PermissionGate>;
  if (detail.loading && !detail.data) return <Spinner label="Loading application" />;
  const app = detail.data?.application;
  if (!app) {
    return (
      <EmptyState
        icon={<FileSearch aria-hidden />}
        title="Application not found"
        description={detail.error ?? (id ? `No application with ID ${id} is visible to you.` : "No application ID was given.")}
        action={<Button as={Link} href="/origination/">Back to applications</Button>}
      />
    );
  }
  const operations = detail.data?.operations ?? [];
  const sla = backendSlaState(app);

  return (
    <Stack gap="large">
      <OutcomePopup
        value={outcome}
        map={(o) => ({
          tone: o.tone,
          title: o.title,
          description: o.text,
          action: o.operationId ? (
            <TextLink as={Link} href={backendItemHref(o.operationId)}>
              Track request {o.operationId}
            </TextLink>
          ) : undefined,
        })}
      />
      <EntityHeader
        back={{ href: "/origination/", label: "Applications" }}
        linkComponent={Link}
        eyebrow={`${app.flow} credit · ${app.facility.requestType}`}
        title={app.customer.name}
        subtitle={app.facility.purpose}
        identifier={app.id}
        identifierLabel="Application ID"
        media={<BriefcaseBusiness aria-hidden />}
        status={{ status: app.stage, tones: backendStageTones }}
        facts={[
          { label: "Amount", value: money(app.facility.amountNgn), mono: true },
          { label: "Product", value: app.facility.variant ? `${app.facility.product} · ${app.facility.variant}` : app.facility.product },
          { label: "Tenor", value: `${app.facility.tenorMonths} months`, mono: true },
          { label: "SLA due", value: sla === "Closed" ? "Closed" : `${date(app.slaDueAt)} · ${sla}` },
          { label: "Initiator", value: app.createdBy.name },
        ]}
      />

      <NextStep app={app} run={run} />

      <Tabs
        label="Application sections"
        variant="underline"
        value={tab}
        onValueChange={setTab}
        items={[
          { id: "overview", label: "Overview", content: <Overview app={app} /> },
          { id: "documents", label: "Documents", content: <Documents app={app} /> },
          { id: "approvals", label: "Approvals", badge: operations.length ? String(operations.length) : undefined, content: <Approvals app={app} operations={operations} /> },
          { id: "comments", label: "Comments", content: <Comments app={app} /> },
          { id: "more", label: "Not on the backend yet", content: <DemoOnly /> },
        ]}
      />
    </Stack>
  );
}

type Run = (title: string, call: () => Promise<unknown>, text: (ack: ApplicationAck) => string) => Promise<boolean>;

/** The next step for the signed-in user, with the actions their permissions allow at this stage. */
function NextStep({ app, run }: { app: CreditApplication; run: Run }) {
  const canUpdate = useCan("origination.applications.update");
  const canSubmit = useCan("origination.applications.submit");
  const canAnalyse = useCan("origination.analysis.record");
  const canException = useCan("origination.limit-exceptions.request");
  const canOverride = useCan("origination.recommendations.request-override");
  const canApproval = useCan("origination.approvals.submit");
  const canWithdraw = useCan("origination.applications.withdraw");
  const minReason = useRule<number>("origination.override.minReasonLength");
  const minComment = useRule<number>("operations.minCommentLength");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"analysis" | "exception" | "override" | "withdraw" | null>(null);

  const act = async (title: string, call: () => Promise<unknown>, text: (ack: ApplicationAck) => string) => {
    setBusy(true);
    const ok = await run(title, call, text);
    setBusy(false);
    if (ok) setPanel(null);
  };

  const a = app.analysis;
  const unresolvedBreach = Boolean(a && isBreach(a.limitGate) && app.limitException?.status !== "Granted");
  const pendingReview = app.limitException?.status === "Pending" || app.override?.status === "Pending";
  const actions: ReactNode[] = [];
  if (app.stage === "Draft" && canUpdate)
    actions.push(
      <Button key="edit" as={Link} href={`/origination/new/?id=${encodeURIComponent(app.id)}`} variant="secondary">
        Edit draft
      </Button>,
    );
  if (app.stage === "Draft" && canSubmit)
    actions.push(
      <Button key="submit" loading={busy} disabled={busy} onClick={() => void act("Submitted", () => originationApi.submit(app.id), () => "The request is with the Credit Analyst for analysis.")}>
        Submit for analysis
      </Button>,
    );
  if (app.stage === "Analysis" && canAnalyse)
    actions.push(
      <Button key="analysis" variant={a ? "secondary" : "primary"} onClick={() => setPanel("analysis")}>
        {a ? "Re-record analysis" : "Record analysis"}
      </Button>,
    );
  if (app.stage === "Analysis" && unresolvedBreach && app.limitException?.status !== "Pending" && canException)
    actions.push(
      <Button key="exception" onClick={() => setPanel("exception")}>
        Request limit exception
      </Button>,
    );
  if (app.stage === "Analysis" && a && !pendingReview && canOverride)
    actions.push(
      <Button key="override" variant="tertiary" onClick={() => setPanel("override")}>
        Request recommendation override
      </Button>,
    );
  if (app.stage === "Analysis" && a && !unresolvedBreach && !pendingReview && canApproval)
    actions.push(
      <Button
        key="approval"
        loading={busy}
        disabled={busy}
        onClick={() => void act("Submitted for approval", () => originationApi.submitForApproval(app.id), (ack) => `Chart-flow approval ${ack.operationId ?? ""} started. Approvers are notified.`)}
      >
        Submit for approval
      </Button>,
    );
  if ((app.stage === "Draft" || app.stage === "Analysis") && canWithdraw)
    actions.push(
      <Button key="withdraw" variant="danger" onClick={() => setPanel("withdraw")}>
        Withdraw
      </Button>,
    );
  if (app.stage === "Approval" && app.approval)
    actions.push(
      <Button key="op" as={Link} href={backendItemHref(app.approval.operationId)}>
        Open approval {app.approval.operationId}
      </Button>,
    );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Next step</CardTitle>
          <CardDescription>{backendNextAction(app)}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          {app.stage === "Withdrawn" && app.withdrawal ? (
            <Alert tone="info">
              Withdrawn by {app.withdrawal.by.name} on {dateTime(app.withdrawal.at)} from {app.withdrawal.from}: {app.withdrawal.reason}
            </Alert>
          ) : null}
          {actions.length ? <Stack direction="horizontal" gap="small" wrap>{actions}</Stack> : isOpenStage(app) ? <Text variant="small" tone="muted">No action for you at this stage.</Text> : null}
          {panel === "analysis" ? <AnalysisForm app={app} busy={busy} onCancel={() => setPanel(null)} onSave={(body) => act("Analysis recorded", () => originationApi.recordAnalysis(app.id, body), () => "The analysis outcome is recorded; the initiator is notified.")} /> : null}
          {panel === "exception" ? (
            <ReasonForm
              label="Justification"
              description="Why the exposure should be allowed despite the limit breach. Decided by CRO / Board in Operations."
              min={minComment}
              busy={busy}
              submit="Request exception"
              onCancel={() => setPanel(null)}
              onSave={(text) => act("Limit exception requested", () => originationApi.requestLimitException(app.id, text), (ack) => `Exception request ${ack.operationId ?? ""} sent for approval.`)}
            />
          ) : null}
          {panel === "override" ? <OverrideForm app={app} min={minReason} busy={busy} onCancel={() => setPanel(null)} onSave={(to, reason) => act("Override requested", () => originationApi.requestOverride(app.id, to, reason), (ack) => `Override request ${ack.operationId ?? ""} sent for approval.`)} /> : null}
          {panel === "withdraw" ? (
            <ReasonForm
              label="Reason for withdrawal"
              description="Kept with the request and in the audit log; the request closes."
              min={minComment}
              busy={busy}
              submit="Withdraw request"
              danger
              onCancel={() => setPanel(null)}
              onSave={(text) => act("Withdrawn", () => originationApi.withdraw(app.id, text), () => "The request is withdrawn and retained for audit.")}
            />
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function AnalysisForm({ app, busy, onCancel, onSave }: { app: CreditApplication; busy: boolean; onCancel: () => void; onSave: (body: { limitGate: LimitGateResult; systemRecommendation: Recommendation; copRatio: number | null; notes: string | null }) => void }) {
  const [limitGate, setLimitGate] = useState<LimitGateResult>(app.analysis?.limitGate ?? "Within limit");
  const [rec, setRec] = useState<Recommendation>(app.analysis?.systemRecommendation ?? "Approve");
  const [cop, setCop] = useState(app.analysis?.copRatio == null ? "" : String(app.analysis.copRatio));
  const [notes, setNotes] = useState(app.analysis?.notes ?? "");
  return (
    <Stack gap="medium">
      <Grid columns={{ base: 1, md: 3 }} gap="medium">
        <Field label="Limit gate" htmlFor="an-gate" required description="Single-obligor and sectoral check (PRD §5.6).">
          <Select id="an-gate" value={limitGate} onChange={(e) => setLimitGate(e.target.value as LimitGateResult)} options={LIMIT_GATE_RESULTS.map((r) => ({ value: r, label: r }))} />
        </Field>
        <Field label="System recommendation" htmlFor="an-rec" required>
          <Select id="an-rec" value={rec} onChange={(e) => setRec(e.target.value as Recommendation)} options={RECOMMENDATIONS.map((r) => ({ value: r, label: recommendationLabel[r] }))} />
        </Field>
        <Field label="COP ratio" htmlFor="an-cop" optional>
          <Input id="an-cop" inputMode="decimal" value={cop} onChange={(e) => setCop(e.target.value)} />
        </Field>
      </Grid>
      <Field label="Notes" htmlFor="an-notes" optional>
        <Textarea id="an-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Stack direction="horizontal" gap="small" wrap>
        <Button loading={busy} disabled={busy} onClick={() => onSave({ limitGate, systemRecommendation: rec, copRatio: cop.trim() ? Number(cop) : null, notes: notes.trim() || null })}>
          Save analysis
        </Button>
        <Button variant="tertiary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}

function OverrideForm({ app, min, busy, onCancel, onSave }: { app: CreditApplication; min: number; busy: boolean; onCancel: () => void; onSave: (to: Recommendation, reason: string) => void }) {
  const from = app.recommendation ?? app.analysis?.systemRecommendation;
  const options = RECOMMENDATIONS.filter((r) => r !== from);
  const [to, setTo] = useState<Recommendation>(options[0]!);
  const [reason, setReason] = useState("");
  const short = reason.trim().length < min;
  return (
    <Stack gap="medium">
      <Text variant="small" tone="muted">Current recommendation: {from ? recommendationLabel[from] : "—"}. An override is decided by CCO / CRO in Operations.</Text>
      <Field label="Recommend instead" htmlFor="ov-to" required>
        <Select id="ov-to" value={to} onChange={(e) => setTo(e.target.value as Recommendation)} options={options.map((r) => ({ value: r, label: recommendationLabel[r] }))} />
      </Field>
      <Field label="Reason" htmlFor="ov-reason" required description={`At least ${min} characters.`}>
        <Textarea id="ov-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Stack direction="horizontal" gap="small" wrap>
        <Button loading={busy} disabled={busy || short} onClick={() => onSave(to, reason.trim())}>
          Request override
        </Button>
        <Button variant="tertiary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}

function ReasonForm({ label, description, min, busy, submit, danger, onCancel, onSave }: { label: string; description: string; min: number; busy: boolean; submit: string; danger?: boolean; onCancel: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState("");
  const short = text.trim().length < min;
  return (
    <Stack gap="medium">
      <Field label={label} htmlFor="reason-text" required description={`${description} At least ${min} characters.`}>
        <Textarea id="reason-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Stack direction="horizontal" gap="small" wrap>
        <Button variant={danger ? "danger" : "primary"} loading={busy} disabled={busy || short} onClick={() => onSave(text.trim())}>
          {submit}
        </Button>
        <Button variant="tertiary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}

function Overview({ app }: { app: CreditApplication }) {
  const sectors = useMasterDataValues("sector").values;
  const branches = useMasterDataValues("branch").values;
  const label = (values: MasterDataValue[], code?: string | null) => (code ? (values.find((v) => v.code === code)?.label ?? code) : "—");
  const c = app.customer;
  const a = app.analysis;
  return (
    <Grid columns={{ base: 1, lg: 2 }} gap="large">
      <Card>
        <CardHeader>
          <CardTitle>Customer and facility</CardTitle>
        </CardHeader>
        <CardContent>
          <DescriptionList
            items={[
              { label: "Customer", value: c.name },
              { label: "Obligor type", value: c.type },
              { label: "Sector", value: label(sectors, c.sectorId) },
              { label: "Branch", value: label(branches, c.branch) },
              { label: "RC number", value: c.rcNumber ?? "—" },
              { label: "State", value: c.state ?? "—" },
              { label: "Declared turnover", value: c.declaredTurnoverNgn == null ? "—" : money(c.declaredTurnoverNgn) },
              { label: "Product", value: app.facility.product },
              { label: "Fast-Track variant", value: app.facility.variant ?? "—" },
              { label: "Amount", value: money(app.facility.amountNgn) },
              { label: "Tenor", value: `${app.facility.tenorMonths} months` },
              { label: "Request type", value: app.facility.requestType },
              { label: "Created", value: `${dateTime(app.createdAt)} by ${app.createdBy.name}` },
              { label: "Submitted", value: app.submittedAt ? dateTime(app.submittedAt) : "—" },
            ]}
          />
        </CardContent>
      </Card>
      <Stack gap="large">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Analysis</CardTitle>
              <CardDescription>Recorded by the Credit Analyst.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {a ? (
              <DescriptionList
                items={[
                  { label: "Limit gate", value: <Badge tone={isBreach(a.limitGate) ? "danger" : "success"}>{a.limitGate}</Badge> },
                  { label: "System recommendation", value: recommendationLabel[a.systemRecommendation] },
                  { label: "Adopted recommendation", value: app.recommendation ? recommendationLabel[app.recommendation] : "—" },
                  { label: "COP ratio", value: a.copRatio == null ? "—" : a.copRatio.toFixed(2) },
                  { label: "Notes", value: a.notes ?? "—" },
                  { label: "Recorded", value: `${dateTime(a.completedAt)} by ${a.completedBy.name}` },
                ]}
              />
            ) : (
              <Text variant="small" tone="muted">Not recorded yet.</Text>
            )}
          </CardContent>
        </Card>
        {app.limitException ? (
          <Card>
            <CardHeader>
              <CardTitle>Limit exception</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Status", value: <StatusBadge status={app.limitException.status} tones={{ Pending: "warning", Granted: "success", Refused: "danger" }} /> },
                  { label: "Breach", value: app.limitException.breach },
                  { label: "Justification", value: app.limitException.justification },
                  { label: "Requested", value: `${dateTime(app.limitException.requestedAt)} by ${app.limitException.requestedBy.name}` },
                  { label: "Decided", value: app.limitException.decidedAt ? `${dateTime(app.limitException.decidedAt)} by ${app.limitException.decidedBy ?? "—"}` : "—" },
                  { label: "Request", value: <TextLink as={Link} href={backendItemHref(app.limitException.operationId)}>{app.limitException.operationId}</TextLink> },
                ]}
              />
            </CardContent>
          </Card>
        ) : null}
        {app.override ? (
          <Card>
            <CardHeader>
              <CardTitle>Recommendation override</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Status", value: <StatusBadge status={app.override.status} tones={{ Pending: "warning", Granted: "success", Refused: "danger" }} /> },
                  { label: "From → to", value: `${recommendationLabel[app.override.from]} → ${recommendationLabel[app.override.to]}` },
                  { label: "Reason", value: app.override.reason },
                  { label: "Requested", value: `${dateTime(app.override.requestedAt)} by ${app.override.requestedBy.name}` },
                  { label: "Request", value: <TextLink as={Link} href={backendItemHref(app.override.operationId)}>{app.override.operationId}</TextLink> },
                ]}
              />
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </Grid>
  );
}

/** Platform DMS documents; required types come from rules `origination.docs.required` / `.requiredNonRetail` matched to master-data codes. */
function Documents({ app }: { app: CreditApplication }) {
  const vocab = useDocumentVocabulary();
  const rulesKey = (requiredKinds(app.customer.type) as string[]).join("\n");
  const required = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const t of vocab.types) {
      byKey.set(t.code.toLowerCase(), t.code);
      byKey.set(t.label.toLowerCase(), t.code);
    }
    return rulesKey
      .split("\n")
      .map((k) => byKey.get(k.toLowerCase()))
      .filter((c): c is string => Boolean(c));
  }, [vocab.types, rulesKey]);
  return <SubjectDocuments subjectType={SUBJECT_TYPE} subjectId={app.id} required={required} title="Application documents" />;
}

function Approvals({ app, operations }: { app: CreditApplication; operations: Array<{ id: string; title: string; operationType: string; status: string; requestedAt: string; requestedBy: { name: string } }> }) {
  const route = app.approval?.route;
  return (
    <Grid columns={{ base: 1, lg: 2 }} gap="large">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Approval route</CardTitle>
            <CardDescription>{route ? `Fixed when submitted on ${dateTime(app.approval!.submittedAt)} by ${app.approval!.submittedBy.name}.` : "Planned when the request is submitted for approval."}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {route ? (
            <DescriptionList
              items={route.steps.map((s) => ({
                label: s.name,
                value: `${s.approverRoles.join(s.coSign ? " + " : " or ")}${s.adjudicatorRole ? ` · adjudicator ${s.adjudicatorRole}` : ""} · ${s.slaHours} h`,
              }))}
            />
          ) : (
            <Text variant="small" tone="muted">No route yet.</Text>
          )}
          {app.approvalHistory.length ? (
            <Stack gap="xsmall" className="mt-4">
              <Text variant="small" className="font-semibold">Earlier attempts</Text>
              {app.approvalHistory.map((h) => (
                <Text key={h.operationId} variant="small">
                  {h.outcome} · {h.routeKey} · {dateTime(h.at)}
                  {h.by ? ` · ${h.by}` : ""}
                  {h.comment ? ` · “${h.comment}”` : ""}
                </Text>
              ))}
            </Stack>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Operations requests</CardTitle>
            <CardDescription>Credit approval, limit exception and override requests for this application.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {operations.length ? (
            <Stack gap="small">
              {operations.map((op) => (
                <Stack key={op.id} direction="horizontal" justify="between" align="center" wrap gap="small">
                  <div>
                    <TextLink as={Link} href={backendItemHref(op.id)}>
                      {op.title}
                    </TextLink>
                    <Text variant="caption" tone="muted">
                      {op.id} · {dateTime(op.requestedAt)} · {op.requestedBy.name}
                    </Text>
                  </div>
                  <Badge tone={op.status === "Approved" || op.status === "Applied" ? "success" : op.status === "Rejected" ? "danger" : op.status === "Returned" ? "warning" : "info"}>{op.status}</Badge>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Text variant="small" tone="muted">No requests yet.</Text>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}

function Comments({ app }: { app: CreditApplication }) {
  const canComment = useCan("origination.comments.create");
  const maxLength = useRule<number>("origination.comments.maxLength");
  const list = useBackend(() => originationApi.comments(app.id), [app.id]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      await originationApi.addComment(app.id, body.trim());
      setBody("");
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap="large">
      {list.error ? <Alert tone="danger">{list.error}</Alert> : null}
      {list.loading ? (
        <Spinner label="Loading comments" />
      ) : list.data?.length ? (
        <Stack gap="medium">
          {list.data.map((c) => (
            <Card key={c.id}>
              <CardContent className="pt-6">
                <Text variant="small" className="font-semibold">
                  {c.author.name} · {dateTime(c.at)}
                </Text>
                <Text className="whitespace-pre-wrap">{c.body}</Text>
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : (
        <Text variant="small" tone="muted">No comments yet.</Text>
      )}
      {canComment ? (
        <Stack gap="small">
          <Field label="Add a comment" htmlFor="comment-body" description={`Up to ${maxLength} characters.`} error={error ?? undefined}>
            <Textarea id="comment-body" rows={3} maxLength={maxLength} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div>
            <Button loading={busy} disabled={busy || !body.trim()} onClick={() => void post()}>
              Post comment
            </Button>
          </div>
        </Stack>
      ) : null}
    </Stack>
  );
}

function DemoOnly() {
  return (
    <Stack gap="medium">
      <Alert tone="info">These sections run on demo data only. They appear here when their backend services are built.</Alert>
      <Grid columns={{ base: 1, md: 2 }} gap="medium">
        {DEMO_ONLY_SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <div>
                <CardTitle>{s.title}</CardTitle>
                <CardDescription>{s.detail}</CardDescription>
              </div>
            </CardHeader>
          </Card>
        ))}
      </Grid>
    </Stack>
  );
}
