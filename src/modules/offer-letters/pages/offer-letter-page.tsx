"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, FilePlus2, FileSearch, Pencil, Printer, RotateCcw, Send, ShieldCheck, Trash2 } from "lucide-react";
import {
  ActivityFeed,
  AiDraftPanel,
  Alert,
  Badge,
  Button,
  Card,
  ChecklistPanel,
  Checkbox,
  CommentThread,
  DataTable,
  DescriptionList,
  EmptyState,
  EntityHeader,
  Field,
  Heading,
  Input,
  Layout,
  Modal,
  PermissionGate,
  RagIndicator,
  SectionHeader,
  Select,
  Spinner,
  Stack,
  StatusBadge,
  Steps,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextLink,
  type ChecklistItem,
  type StepItem,
} from "@credigit/web-ui";
import { OutcomePopup, outcomeCopy } from "@/lib/ui/outcome-popup";
import { useCan } from "@/lib/auth/session";
import { useApplications, useCollateral, useFacilities, useObligors, useTenant, useUsers } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { newId } from "@/lib/data/store";
import type { Application, Collateral, Obligor } from "@/lib/data/types";
import { date, dateTime, money } from "@/lib/format";
import { canDecide, decideOperation, usePendingFor } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { daysBetween, demoNowIso, useActor } from "../../credit-admin/common";
import { useApplicationCps, useFacilityRow, type CpItem } from "../../credit-admin/logic";
import { PendingOperationNotice } from "../../credit-admin/operations-ui";
import { commentOnLetter, editLetter, recordAcceptance, submitForSignoff } from "../actions";
import { libraryMeta, type Clause, type ClauseLibrary } from "../library";
import { LetterDocument, Merged } from "../letter-document";
import { buildMergeContext, facilityTerms, mergeText, securityLines, type MergeContext } from "../merge";
import {
  OFFER_STAGES,
  displayStatus,
  expiresAt,
  letterCovenants,
  letterIdFor,
  letterStatusTones,
  tagContextFor,
  tagReason,
  useClauses,
  useOfferLetters,
  useTemplates,
  type CustomClause,
  type OfferLetter,
} from "../store";

export function OfferLetterPage() {
  return (
    <Suspense fallback={<Spinner label="Loading offer letter" />}>
      <LetterRoute />
    </Suspense>
  );
}

function LetterRoute() {
  const params = useSearchParams();
  const id = params.get("id");
  const applicationId = params.get("applicationId");
  const letters = useOfferLetters();
  const apps = useApplications();
  const allowed = useCan("offer-letters");
  const letter = letters.find((l) => (id ? l.id === id : applicationId ? l.id === letterIdFor(applicationId) : false));

  if (!allowed) return <PermissionGate allowed={false} description="Your role doesn't include the Offer Letter Engine. Switch role from the user menu to see it.">{null}</PermissionGate>;
  if (!letter) {
    const app = applicationId ? apps.find((a) => a.id === applicationId) : undefined;
    const eligible = apps.filter((a) => OFFER_STAGES.includes(a.stage));
    return (
      <EmptyState
        icon={<FileSearch aria-hidden />}
        title={app ? "No offer letter yet for this application" : "Offer letter not found"}
        description={
          app
            ? `${app.id} is at the "${app.stage}" stage. The Offer Letter Engine generates the letter automatically once the application is approved and reaches the customer-presentation step.`
            : id
              ? `No offer letter with ID ${id} exists in this tenant. It may have been removed or the demo data reset.`
              : `Open a letter from the list, or one of the ${eligible.length} approved applications.`
        }
        action={
          <Stack direction="horizontal" gap="small" wrap justify="center">
            <Button as={Link} href="/offer-letters/">
              Back to offer letters
            </Button>
            {app ? (
              <Button as={Link} href={`/origination/application/?id=${app.id}`} variant="tertiary">
                Open application
              </Button>
            ) : null}
          </Stack>
        }
      />
    );
  }
  return <LetterRecord letter={letter} />;
}

// ---------------------------------------------------------------------------------------------

function useLetterContext(letter: OfferLetter) {
  const apps = useApplications();
  const obligors = useObligors();
  const facilities = useFacilities();
  const collateral = useCollateral();
  const users = useUsers();
  const tenant = useTenant();
  const clauses = useClauses();
  const templates = useTemplates();
  return useMemo(() => {
    const app = apps.find((a) => a.id === letter.applicationId)!;
    const obligor = obligors.find((o) => o.id === app?.obligorId);
    const facility = facilities.find((f) => f.applicationId === letter.applicationId);
    const template = templates.find((t) => t.id === letter.templateId) ?? templates.find((t) => t.status === "Approved")!;
    const ctx = app ? buildMergeContext({ app, obligor, facility, collateral, tenant, users, letter }) : {};
    const tagCtx = app ? tagContextFor(app, obligor, collateral, facility?.currency) : undefined;
    return { app, obligor, facility, template, ctx, tagCtx, clauses, collateral: collateral.filter((c) => app?.collateralIds.includes(c.id)), users };
  }, [apps, obligors, facilities, collateral, users, tenant, clauses, templates, letter]);
}

function LetterRecord({ letter }: { letter: OfferLetter }) {
  const c = useLetterContext(letter);
  const actor = useActor();
  const { actor: scopeActor } = useScope();
  const roleId = scopeActor.roleId;
  const canEdit = useCan("offer-letters", "edit");
  const canView = useCan("offer-letters");
  const editorRoles = useRule<RoleId[]>("offer-letters.legalEditorRoles");
  const requesterRoles = useRule<RoleId[]>("offer-letters.signoffRequesterRoles");
  const recorderRoles = useRule<RoleId[]>("offer-letters.acceptanceRecorderRoles");
  const pending = usePendingFor("OfferLetter", letter.id);
  const isLegal = editorRoles.includes(roleId);
  const canRequest = canView && requesterRoles.includes(roleId);
  const canRecordAcceptance = canView && recorderRoles.includes(roleId);
  const mayDecide = pending ? canDecide(pending, scopeActor).ok : false;
  const status = displayStatus(letter);
  const editable = canEdit && isLegal && (letter.status === "Draft" || letter.status === "Legal review");
  const [tab, setTab] = useState("preview");
  const [highlight, setHighlight] = useState(false);
  const [modal, setModal] = useState<null | "signoff" | "accept" | "custom" | { edit: string }>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  if (!c.app) return <EmptyState icon={<FileSearch aria-hidden />} title="Application missing" description={`The application ${letter.applicationId} behind this letter no longer exists.`} />;
  const { app, obligor, facility, template, ctx, clauses } = c;
  const info = { obligorName: obligor?.name ?? app.obligorId, amount: money(app.amount, facility?.currency), rmUserId: obligor?.relationshipManagerId ?? app.createdById };
  const reissuePending = (pending?.payload as { mode?: string } | undefined)?.mode === "reissue";

  const report = (r: { ok: true; message: string } | { ok: false; reason: string }) => setNotice(r.ok ? { tone: "success", text: r.message } : { tone: "danger", text: r.reason });

  /** Save with a version entry + audit event + domain event (PRD §7: every change tracked). */
  const commit = (changes: Partial<OfferLetter>, summary: string, action: string, before?: string, after?: string) => {
    void editLetter(letter, changes, summary, action, before, after).then(report);
  };

  const toggleClause = (clause: Clause, on: boolean) => {
    const clauseIds = on ? [...letter.clauseIds, clause.id] : letter.clauseIds.filter((x) => x !== clause.id);
    commit({ clauseIds }, `${on ? "Added" : "Removed"} clause ${clause.id} "${clause.title}"`, on ? "Added offer-letter clause" : "Removed offer-letter clause", on ? undefined : clause.id, on ? clause.id : undefined);
  };

  const actions = (
    <Stack direction="horizontal" gap="small" wrap className="print:hidden">
      {canRequest && !pending && (letter.status === "Draft" || letter.status === "Legal review") ? (
        <Button iconBefore={<Send aria-hidden className="size-4" />} onClick={() => void submitForSignoff(letter, info, "issue").then(report)}>
          Send to Legal for sign-off
        </Button>
      ) : null}
      {pending && mayDecide ? (
        <Button iconBefore={<ShieldCheck aria-hidden className="size-4" />} onClick={() => setModal("signoff")}>
          {reissuePending ? "Sign off re-issue" : "Legal sign-off & issue"}
        </Button>
      ) : null}
      {canRequest && !pending && status === "Expired" ? (
        <Button iconBefore={<RotateCcw aria-hidden className="size-4" />} onClick={() => void submitForSignoff(letter, info, "reissue").then(report)}>
          Request re-issue
        </Button>
      ) : null}
      {canRecordAcceptance && status === "Issued" ? (
        <Button iconBefore={<CheckCircle2 aria-hidden className="size-4" />} onClick={() => setModal("accept")}>
          Record customer acceptance
        </Button>
      ) : null}
      <Button variant="tertiary" iconBefore={<Printer aria-hidden className="size-4" />} onClick={() => window.print()}>
        Print
      </Button>
    </Stack>
  );

  const lastAt = letter.versions[letter.versions.length - 1]?.at;

  return (
    <Stack gap="large">
      <div className="print:hidden">
        <EntityHeader
          back={{ href: "/offer-letters/", label: "Offer letters" }}
          linkComponent={Link}
          eyebrow="Offer letter"
          title={obligor?.name ?? app.obligorId}
          subtitle={`${app.product} · ${app.purpose}`}
          identifier={letter.ref}
          identifierLabel="Letter reference"
          status={{ status, tones: letterStatusTones }}
          facts={[
            { label: "Amount", value: money(app.amount, facility?.currency), mono: true },
            { label: "Application", value: app.id, mono: true },
            { label: "House template", value: `${template.name} v${letter.templateVersion}` },
            { label: "Validity", value: `${letter.validityDays} days` },
            { label: status === "Expired" ? "Lapsed" : "Issued", value: letter.issuedAt ? date(status === "Expired" ? expiresAt(letter)! : letter.issuedAt) : "Not issued", mono: true },
            { label: "Accepted", value: letter.acceptedAt ? date(letter.acceptedAt) : "—", mono: true },
          ]}
          actions={actions}
        />
      </div>

      <OutcomePopup value={notice} map={outcomeCopy.toneText({ success: "Saved", danger: "Not saved" })} />
      {pending ? (
        <div className="print:hidden">
          <PendingOperationNotice instance={pending} title={reissuePending ? "Re-issue awaiting Legal sign-off" : "Awaiting Legal sign-off & issue"}>
            {mayDecide ? "You can decide it here or in Operations. " : ""}
          </PendingOperationNotice>
        </div>
      ) : null}
      {status === "Expired" ? (
        <Alert tone="danger" title="This offer has lapsed">
          It was issued on {date(letter.issuedAt!)} with a {letter.validityDays}-day validity and was not accepted by {date(expiresAt(letter)!)} (Acceptance validity). {canRequest ? "Request a re-issue to restart the validity period — Legal signs it off through Operations." : "The Account Officer can request a re-issue, signed off by Legal."}
        </Alert>
      ) : null}
      {!editable && (letter.status === "Draft" || letter.status === "Legal review") ? (
        <div className="print:hidden">
          <Alert tone="info" title={letter.status === "Draft" ? "Draft — not yet sent to Legal" : "Legal is reviewing this letter"}>
            Clauses can only be added, removed or edited by Legal before release. You can view the letter and comment.
          </Alert>
        </div>
      ) : null}

      <div className="hidden print:block">
        <LetterDocument template={template} letter={letter} clauses={clauses} ctx={ctx} terms={facilityTerms()} security={securityLines(app, c.collateral)} draft={letter.status === "Draft" || letter.status === "Legal review"} />
      </div>

      <div className="print:hidden">
        <Layout asideWidth="medium" aside={<Aside letter={letter} c={c} editable={editable} commit={commit} lastAt={lastAt} />}>
          <Tabs
            label="Offer letter sections"
            value={tab}
            onValueChange={setTab}
            items={[
              {
                id: "preview",
                label: "Letter",
                content: (
                  <Stack gap="medium">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Text variant="small" tone="muted">
                        Merged into &ldquo;{template.name}&rdquo; v{letter.templateVersion} on {date(letter.createdAt)}.
                      </Text>
                      <Switch label="Highlight merge fields" checked={highlight} onCheckedChange={setHighlight} size="small" />
                    </div>
                    <LetterDocument template={template} letter={letter} clauses={clauses} ctx={ctx} terms={facilityTerms()} security={securityLines(app, c.collateral)} highlight={highlight} draft={letter.status === "Draft" || letter.status === "Legal review"} />
                  </Stack>
                ),
              },
              {
                id: "clauses",
                label: "Clauses",
                badge: String(letter.clauseIds.length + letter.customClauses.length),
                content: <ClausePicker letter={letter} clauses={clauses} ctx={ctx} tagCtx={c.tagCtx} editable={editable} onToggle={toggleClause} onEdit={(id) => setModal({ edit: id })} onAddCustom={() => setModal("custom")} commit={commit} />,
              },
              { id: "conditions", label: "Conditions precedent", content: <ConditionsTab letter={letter} app={app} facilityId={facility?.id} /> },
              { id: "covenants", label: "Covenants", content: <CovenantsTab letter={letter} clauses={clauses} ctx={ctx} app={app} /> },
              {
                id: "history",
                label: "Version history",
                badge: String(letter.versions.length),
                content: (
                  <ActivityFeed
                    label="Version history"
                    items={[...letter.versions].reverse().map((v) => ({ id: `${letter.id}-v${v.version}`, actor: v.byName, action: `v${v.version} — ${v.summary}`, timestamp: v.at }))}
                    emptyMessage="No changes yet."
                  />
                ),
              },
              {
                id: "comments",
                label: "Comments",
                badge: letter.comments.length ? String(letter.comments.length) : undefined,
                content: (
                  <CommentThread
                    title="Review comments"
                    comments={letter.comments.map((m) => ({ id: m.id, author: { name: m.authorName, role: m.role }, body: m.body, time: dateTime(m.at), internal: true }))}
                    currentUser={{ name: actor.actorName, role: roleById[actor.roleId]?.name }}
                    onSubmit={(body) => commentOnLetter(letter, { id: newId("CMT"), authorName: actor.actorName, role: roleById[actor.roleId]?.name ?? "", body, at: demoNowIso() })}
                    placeholder="Add an internal review note… use @name to mention"
                    emptyMessage="No comments yet."
                  />
                ),
              },
            ]}
          />
        </Layout>
      </div>

      {modal === "signoff" && pending ? (
        <SignOffModal
          letter={letter}
          c={c}
          reissue={reissuePending}
          onClose={() => setModal(null)}
          onConfirm={async (decision, validityDays, comment) => {
            if (decision === "approve" && validityDays !== letter.validityDays) {
              const r = await editLetter(letter, { validityDays }, `Acceptance validity set to ${validityDays} days`, "Changed offer-letter validity", `${letter.validityDays} days`, `${validityDays} days`);
              if (!r.ok) return r.reason;
            }
            const res = await decideOperation(pending.id, decision, comment);
            if (!res.ok) return res.reason;
            setNotice({ tone: "success", text: decision === "approve" ? "Signed off and issued" : "Returned to the requester" });
            setModal(null);
            return null;
          }}
        />
      ) : null}
      {modal === "accept" ? (
        <AcceptModal
          letter={letter}
          onClose={() => setModal(null)}
          onConfirm={(acceptedOn) => {
            const at = new Date(`${acceptedOn}T12:00:00+01:00`).toISOString(); // TD-859: tenant time zone
            void recordAcceptance(letter, app, at, info).then(report);
            setModal(null);
          }}
        />
      ) : null}
      {modal === "custom" ? (
        <CustomClauseModal
          onClose={() => setModal(null)}
          onSave={(cl) => {
            commit({ customClauses: [...letter.customClauses, { ...cl, id: newId("CL"), source: "Legal drafted", addedByName: actor.actorName, addedAt: demoNowIso() }] }, `Added bespoke clause "${cl.title}" (${libraryMeta[cl.library].short})`, "Added bespoke offer-letter clause");
            setModal(null);
          }}
        />
      ) : null}
      {modal && typeof modal === "object" ? (
        <EditClauseModal
          clause={clauses.find((x) => x.id === modal.edit)!}
          current={letter.clauseEdits[modal.edit]}
          ctx={ctx}
          onClose={() => setModal(null)}
          onSave={(text) => {
            const clause = clauses.find((x) => x.id === modal.edit)!;
            const clauseEdits = { ...letter.clauseEdits };
            if (text === clause.text) delete clauseEdits[clause.id];
            else clauseEdits[clause.id] = text;
            commit({ clauseEdits }, `Edited wording of ${clause.id} "${clause.title}" for this letter`, "Edited offer-letter clause", letter.clauseEdits[clause.id] ?? clause.text, text);
            setModal(null);
          }}
        />
      ) : null}
    </Stack>
  );
}

type Ctx = ReturnType<typeof useLetterContext>;
type Commit = (changes: Partial<OfferLetter>, summary: string, action: string, before?: string, after?: string) => void;

// ---------------------------------------------------------------------------------------------

function Aside({ letter, c, editable, commit, lastAt }: { letter: OfferLetter; c: Ctx; editable: boolean; commit: Commit; lastAt?: string }) {
  const status = displayStatus(letter);
  const order = ["Draft", "Legal review", "Issued", "Accepted"];
  const idx = order.indexOf(letter.status);
  const st = (i: number): StepItem["status"] => (i < idx || (i === idx && letter.status === "Accepted") ? "complete" : i === idx ? "current" : "upcoming");
  const steps: StepItem[] = [
    { title: "Auto-generated", description: "House template + auto-tagged clauses", status: st(0), meta: date(letter.createdAt) },
    { title: "Legal review", description: letter.legalReviewerName ? `Reviewer: ${letter.legalReviewerName}` : letter.status === "Draft" ? "Sent by the Account Officer" : "With Legal (Operations workflow)", status: st(1) },
    { title: "Legal sign-off & issue", description: letter.legalSignedOffByName ? `Signed off by ${letter.legalSignedOffByName}` : "Conditions & covenants text approved", status: st(2), meta: letter.legalSignedOffAt ? date(letter.legalSignedOffAt) : undefined },
    { title: "Customer acceptance", description: letter.acceptedAt ? `Accepted ${date(letter.acceptedAt)}` : status === "Expired" ? "Lapsed — not accepted in time" : `Within ${letter.validityDays} days of issue`, status: st(3), meta: letter.acceptedAt ? date(letter.acceptedAt) : undefined },
  ];
  return (
    <Stack gap="medium">
      <Card padding="medium">
        <Stack gap="medium">
          <Stack gap="none">
            <Heading level={2} size="xsmall">
              Workflow
            </Heading>
            {lastAt ? <Text variant="small" tone="muted">Last change {dateTime(lastAt)}</Text> : null}
          </Stack>
          <Steps items={steps} />
        </Stack>
      </Card>
      <PreReleaseChecks letter={letter} c={c} />
      <AiSuggestion letter={letter} c={c} editable={editable} commit={commit} />
    </Stack>
  );
}

function PreReleaseChecks({ letter, c }: { letter: OfferLetter; c: Ctx }) {
  const insuranceDays = useRule<number>("offer-letters.insuranceWarningDays");
  const checks: Array<{ status: "red" | "amber" | "green"; label: string }> = [];
  const selected = c.clauses.filter((x) => letter.clauseIds.includes(x.id));
  const pendingText = selected.filter((x) => x.status !== "Legal-approved");
  const neverApproved = pendingText.filter((x) => !x.approvedAt);
  if (neverApproved.length) checks.push({ status: "red", label: `${neverApproved.length} selected clause(s) have never been Legal-approved` });
  else if (pendingText.length) checks.push({ status: "amber", label: `${pendingText.length} selected clause(s) have a library change pending — the approved version is used` });
  else checks.push({ status: "green", label: `All ${selected.length} library clauses are on their Legal-approved version` });
  for (const col of c.collateral) {
    if (col.perfection !== "Perfected") checks.push({ status: col.perfection === "Defective" ? "red" : "amber", label: `${col.id} ${col.type}: perfection "${col.perfection}" — keep the perfection CP open` });
    if (col.insuranceExpiry && daysBetween(DEMO_NOW, col.insuranceExpiry) < insuranceDays) checks.push({ status: "amber", label: `${col.id} insurance expires ${date(col.insuranceExpiry)}` });
  }
  checks.push(c.app.limitGate.startsWith("Breach") ? { status: "red", label: `Portfolio-limit gate: ${c.app.limitGate} (exception decision on file)` } : { status: "green", label: `Portfolio-limit gate: ${c.app.limitGate}` });
  const params = Object.entries(c.ctx).filter(([, v]) => v.startsWith("[")).map(([k]) => k);
  const texts = [...selected.map((x) => letter.clauseEdits[x.id] ?? x.text), ...letter.customClauses.map((x) => x.text)].join(" ");
  const used = params.filter((p) => texts.includes(`{{${p}}}`));
  if (used.length) checks.push({ status: "amber", label: `${used.length} tenant parameter(s) still to be set: ${used.join(", ")}` });
  return (
    <Card padding="medium">
      <Stack gap="small">
        <Stack gap="none">
          <Heading level={2} size="xsmall">
            Pre-release checks
          </Heading>
          <Text variant="small" tone="muted">Cross-checks against the collateral register, clause library and limit gate.</Text>
        </Stack>
        <ul className="flex flex-col gap-2.5">
          {checks.map((x, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-fg">
              <RagIndicator status={x.status} size="small" className="mt-0.5 shrink-0" />
              <span>{x.label}</span>
            </li>
          ))}
        </ul>
      </Stack>
    </Card>
  );
}

function aiDraft(app: Application, obligor: Obligor | undefined, collateral: Collateral[], letter: OfferLetter): { title: string; library: ClauseLibrary; text: string; why: string } {
  const contract = ["Advance payment guarantee", "Invoice discounting", "Bank guarantee", "Trade finance (LC)"].includes(app.product);
  if (contract && !letter.clauseIds.includes("SC-02"))
    return {
      title: "Assignment of contract receivables",
      library: "special",
      text: "{{obligor.name}} shall assign to {{tenant.shortName}} all receivables under the underlying contract financed by this facility, and shall procure the paying party's written acknowledgement of the assignment before the first drawdown.",
      why: "Contract-backed facility without a domiciliation or assignment covenant.",
    };
  if (obligor && (obligor.watchlist || obligor.riskGrade >= 6))
    return {
      title: "Enhanced monitoring",
      library: "special",
      text: "{{obligor.name}} shall permit the Bank's officers to carry out site visits and inspect its books at reasonable notice, and shall provide monthly stock and debtors reports in a form acceptable to the Bank.",
      why: `Obligor risk grade ${obligor.riskGrade}${obligor.watchlist ? " and on the watchlist" : ""}.`,
    };
  if (collateral.some((c) => c.type === "Quoted shares"))
    return {
      title: "Share-cover top-up",
      library: "special",
      text: "Where the market value of the pledged shares, as reported by the SEC/CSCS connector, falls below the security cover approved for this facility, {{obligor.name}} shall within {{notice.days}} days pledge additional acceptable security or reduce the outstanding balance accordingly.",
      why: "Facility secured by quoted equities with daily market valuation.",
    };
  return {
    title: "Conduct of account",
    library: "special",
    text: "{{obligor.name}} shall route the proceeds of its business activities financed under this facility through its accounts with {{tenant.shortName}}, and shall not open new borrowing accounts with other banks during the tenor without the Bank's prior written consent.",
    why: `${app.product} for ${obligor?.type ?? "the obligor"}; no conduct-of-account covenant selected.`,
  };
}

function AiSuggestion({ letter, c, editable, commit }: { letter: OfferLetter; c: Ctx; editable: boolean; commit: Commit }) {
  const actor = useActor();
  const s = aiDraft(c.app, c.obligor, c.collateral, letter);
  const accepted = letter.customClauses.find((x) => x.source === "AI-drafted");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed && !accepted) return null;
  return (
    <AiDraftPanel
      title={accepted ? `Accepted: ${accepted.title}` : `Suggested clause: ${s.title}`}
      model="Credigit Risk Copilot (simulated)"
      generatedAt={dateTime(letter.createdAt)}
      confidence={0.72}
      draft={accepted ? accepted.text : mergeText(s.text, c.ctx)}
      sources={[
        { label: `Application ${c.app.id}`, detail: s.why },
        { label: "Clause library", detail: "Closest approved clauses used as style reference" },
      ]}
      signedOffBy={accepted ? `${accepted.addedByName} · ${date(accepted.addedAt)}` : undefined}
      signOffNote={editable ? "AI-drafted — Legal must review the wording; it is added to this letter only when you accept it." : "AI-drafted — only the Legal Officer can accept this clause into the letter."}
      onAccept={
        editable
          ? (text) =>
              commit(
                { customClauses: [...letter.customClauses, { id: newId("CL"), library: s.library, title: s.title, text, source: "AI-drafted", addedByName: actor.actorName, addedAt: demoNowIso() } satisfies CustomClause] },
                `Accepted AI-drafted clause "${s.title}" after Legal review`,
                "Accepted AI-drafted clause",
                undefined,
                s.title,
              )
          : undefined
      }
      onDismiss={editable && !accepted ? () => setDismissed(true) : undefined}
    />
  );
}

// ---------------------------------------------------------------------------------------------

function ClausePicker({
  letter,
  clauses,
  ctx,
  tagCtx,
  editable,
  onToggle,
  onEdit,
  onAddCustom,
  commit,
}: {
  letter: OfferLetter;
  clauses: Clause[];
  ctx: MergeContext;
  tagCtx: Ctx["tagCtx"];
  editable: boolean;
  onToggle: (c: Clause, on: boolean) => void;
  onEdit: (id: string) => void;
  onAddCustom: () => void;
  commit: Commit;
}) {
  const [showAll, setShowAll] = useState(false);
  const libs: ClauseLibrary[] = ["pre", "special", "post", "general"];
  return (
    <Stack gap="medium">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text variant="small" tone="muted" className="max-w-xl">
          Clauses are drawn from the Legal-approved library and auto-tagged by product, obligor type, collateral and covenants tagged at origination. {editable ? "Tick to add or remove; edits apply to this letter only." : ""}
        </Text>
        <Stack direction="horizontal" gap="small" wrap>
          <Switch label="Show untagged library clauses" checked={showAll} onCheckedChange={setShowAll} size="small" />
          {editable ? (
            <Button size="small" variant="secondary" iconBefore={<FilePlus2 aria-hidden className="size-4" />} onClick={onAddCustom}>
              Bespoke clause
            </Button>
          ) : null}
        </Stack>
      </div>
      {libs.map((lib) => {
        const list = clauses.filter((x) => x.library === lib && x.status !== "Retired" && (showAll || letter.clauseIds.includes(x.id) || (tagCtx && tagReason(x, tagCtx))));
        const custom = letter.customClauses.filter((x) => x.library === lib);
        const selected = list.filter((x) => letter.clauseIds.includes(x.id)).length + custom.length;
        return (
          <Card key={lib} padding="medium">
            <Stack gap="medium">
              <SectionHeader as="h3" title={libraryMeta[lib].label} description={`${libraryMeta[lib].prd} · ${selected} selected · ${libraryMeta[lib].description}`} />
              <ul className="flex flex-col divide-y divide-line">
                {list.map((cl) => {
                  const on = letter.clauseIds.includes(cl.id);
                  const reason = tagCtx ? tagReason(cl, tagCtx) : undefined;
                  const text = letter.clauseEdits[cl.id] ?? cl.text;
                  return (
                    <li key={cl.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Checkbox checked={on} disabled={!editable} onChange={(e) => onToggle(cl, e.target.checked)} label={<span className="font-medium text-fg">{cl.title}</span>} />
                        <p className="pl-7 text-sm text-fg-muted">
                          <Merged text={text} ctx={ctx} />
                        </p>
                        <div className="flex flex-wrap gap-1.5 pl-7">
                          <Badge variant="outline">{cl.id} · v{cl.version}</Badge>
                          <Badge tone="neutral">{cl.category}</Badge>
                          {reason ? <Badge tone="accent">Auto-tagged · {reason}</Badge> : <Badge tone="neutral" variant="outline">Not auto-tagged</Badge>}
                          {cl.id in letter.clauseEdits ? <Badge tone="warning">Edited for this letter</Badge> : null}
                          {cl.status !== "Legal-approved" ? <Badge tone="danger">{cl.status}</Badge> : null}
                        </div>
                      </div>
                      {editable && on ? (
                        <Button size="small" variant="text" iconBefore={<Pencil aria-hidden className="size-3.5" />} onClick={() => onEdit(cl.id)} className="shrink-0 self-start">
                          Edit wording
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
                {custom.map((cl) => (
                  <li key={cl.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="font-medium text-fg">{cl.title}</span>
                      <p className="text-sm text-fg-muted">
                        <Merged text={cl.text} ctx={ctx} />
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={cl.source === "AI-drafted" ? "accent" : "info"}>{cl.source}</Badge>
                        <Badge variant="outline">
                          Added by {cl.addedByName} · {date(cl.addedAt)}
                        </Badge>
                      </div>
                    </div>
                    {editable ? (
                      <Button
                        size="small"
                        variant="text"
                        iconBefore={<Trash2 aria-hidden className="size-3.5" />}
                        className="shrink-0 self-start"
                        onClick={() => commit({ customClauses: letter.customClauses.filter((x) => x.id !== cl.id) }, `Removed bespoke clause "${cl.title}"`, "Removed bespoke offer-letter clause", cl.title)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
                {!list.length && !custom.length ? <li className="py-3 text-sm text-fg-muted">No clauses from this library apply to this facility.</li> : null}
              </ul>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}

function ConditionsTab({ letter, app, facilityId }: { letter: OfferLetter; app: Application; facilityId?: string }) {
  const row = useFacilityRow(facilityId);
  const appCps = useApplicationCps(app, letter);
  const cps: CpItem[] = row?.cps ?? appCps;
  const items: ChecklistItem[] = cps.map((x) => ({
    id: x.id,
    title: x.title,
    description: `${x.category}${x.note ? ` · ${x.note}` : ""}`,
    status: x.status,
    owner: x.id === "CP-02" ? "Account Officer" : x.category.startsWith("Legal") || x.category.includes("security") ? "Legal / Credit Admin" : "Credit Administration",
  }));
  return (
    <Stack gap="medium">
      <ChecklistPanel
        title="Conditions precedent to drawdown"
        description="Generated from the letter's clauses. Credit Administration confirms each one before releasing the file for disbursement."
        items={items}
        action={
          facilityId ? (
            <Button as={Link} href={`/credit-admin/facility/?id=${facilityId}`} size="small" variant="secondary">
              Open in Credit Admin
            </Button>
          ) : undefined
        }
      />
      {!facilityId ? (
        <Text variant="small" tone="muted">
          The facility record is created in Credit Administration when the application moves to disbursement. Acceptance of this letter clears the &ldquo;Signed acceptance&rdquo; condition automatically.
        </Text>
      ) : null}
    </Stack>
  );
}

function CovenantsTab({ letter, clauses, ctx, app }: { letter: OfferLetter; clauses: Clause[]; ctx: MergeContext; app: Application }) {
  const rows = letterCovenants(letter, clauses).map((x) => ({ ...x, merged: mergeText(x.text, ctx), source: x.id.startsWith("SC-") ? "Tagged at origination" : "id" in x && String(x.id).startsWith("GC-") ? "General covenant" : "Bespoke" }));
  return (
    <Stack gap="medium">
      <Text variant="small" tone="muted">
        Covenants tagged at origination on {app.id}: {app.covenants.length ? app.covenants.join(" · ") : "none"}. After drawdown they are monitored in Loan review &amp; monitoring.
      </Text>
      <DataTable
        label="Covenants in this letter"
        data={rows}
        getRowId={(r) => r.id}
        paginate={false}
        columns={[
          { id: "title", header: "Covenant", accessor: "title", cell: (r) => <span className="font-medium text-fg">{r.title}</span> },
          { id: "category", header: "Type", accessor: "category" },
          { id: "source", header: "Source", accessor: "source", cell: (r) => <Badge tone={r.source.startsWith("Tagged") ? "accent" : "neutral"}>{r.source}</Badge> },
          { id: "merged", header: "Obligation", accessor: "merged", cell: (r) => <span className="text-sm text-fg-muted">{r.merged}</span> },
        ]}
        emptyState={<Text tone="muted">No covenants selected.</Text>}
        mobileCard={(r) => (
          <Stack gap="xsmall">
            <span className="font-medium text-fg">{r.title}</span>
            <span className="text-sm text-fg-muted">{r.merged}</span>
          </Stack>
        )}
      />
      <TextLink as={Link} href="/monitoring/covenants/">
        Covenant monitoring
      </TextLink>
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------

function SignOffModal({
  letter,
  c,
  reissue,
  onClose,
  onConfirm,
}: {
  letter: OfferLetter;
  c: Ctx;
  reissue: boolean;
  onClose: () => void;
  /** Resolves to an error message, or null on success. */
  onConfirm: (decision: "approve" | "return", validityDays: number, comment: string) => Promise<string | null>;
}) {
  const min = useRule<number>("offer-letters.validityDaysMin");
  const max = useRule<number>("offer-letters.validityDaysMax");
  const [attest, setAttest] = useState(false);
  const [days, setDays] = useState(String(letter.validityDays));
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(days);
  const daysOk = Number.isInteger(n) && n >= min && n <= max;
  const run = async (decision: "approve" | "return") => {
    setBusy(true);
    setError(await onConfirm(decision, n, comment.trim()));
    setBusy(false);
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={reissue ? "Legal sign-off — re-issue" : "Legal sign-off"}
      description="Approve the conditions and covenants text and release the letter to the Account Officer for customer presentation. Your decision is recorded on the Operations request."
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" loading={busy} onClick={() => void run("return")}>
            Return to requester
          </Button>
          <Button disabled={!attest || !daysOk} loading={busy} onClick={() => void run("approve")}>
            Sign off & issue
          </Button>
        </>
      }
    >
      <Stack gap="medium">
        <DescriptionList
          columns={2}
          items={[
            { label: "Letter", value: letter.ref, mono: true },
            { label: "House template", value: `${c.template.name} v${letter.templateVersion}` },
            { label: "Library clauses", value: String(letter.clauseIds.length) },
            { label: "Bespoke / edited", value: `${letter.customClauses.length} bespoke · ${Object.keys(letter.clauseEdits).length} edited` },
          ]}
        />
        <Field label="Acceptance validity (days)" description={`commonly 7 days from communication to the customer. Allowed ${min}–${max} days (business rules).`} htmlFor="validity" error={daysOk ? undefined : `Enter ${min}–${max} days.`}>
          <Input id="validity" type="number" min={min} max={max} value={days} onChange={(e) => setDays(e.target.value)} numeric suffix="days" invalid={!daysOk} />
        </Field>
        <Field label="Comment" htmlFor="signoff-comment" description="Required when returning the letter." optional>
          <Textarea id="signoff-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <Checkbox checked={attest} onChange={(e) => setAttest(e.target.checked)} label="I confirm the conditions and covenants text is legally sufficient and consistent with the approved credit." />
        {error ? (
          <Alert tone="danger" title="Decision not recorded">
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Modal>
  );
}

function AcceptModal({ letter, onClose, onConfirm }: { letter: OfferLetter; onClose: () => void; onConfirm: (acceptedOn: string) => void }) {
  const today = DEMO_NOW.toISOString().slice(0, 10);
  const min = letter.issuedAt?.slice(0, 10) ?? today;
  const [on, setOn] = useState(today);
  const [dup, setDup] = useState(false);
  const [seal, setSeal] = useState(false);
  const invalidDate = on < min || on > today;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record customer acceptance"
      description="the Account Officer collects the signed duplicate and acceptance documents."
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!dup || !seal || invalidDate} onClick={() => onConfirm(on)}>
            Record acceptance
          </Button>
        </>
      }
    >
      <Stack gap="medium">
        <Field label="Customer acceptance date" htmlFor="accepted-on" error={invalidDate ? `Must be between the issue date (${date(min)}) and today.` : undefined} description={`Offer valid until ${date(expiresAt(letter)!)}.`}>
          <Input id="accepted-on" type="date" value={on} min={min} max={today} onChange={(e) => setOn(e.target.value)} invalid={invalidDate} />
        </Field>
        <Checkbox checked={dup} onChange={(e) => setDup(e.target.checked)} label="Signed duplicate copy of the offer letter received" />
        <Checkbox checked={seal} onChange={(e) => setSeal(e.target.checked)} label="Memorandum of Acceptance executed under seal and witnessed" />
        <Text variant="small" tone="muted">
          This clears the &ldquo;Signed acceptance of offer letter&rdquo; condition precedent and moves the application to the Conditions stage.
        </Text>
      </Stack>
    </Modal>
  );
}

function CustomClauseModal({ onClose, onSave }: { onClose: () => void; onSave: (c: { library: ClauseLibrary; title: string; text: string }) => void }) {
  const minText = useRule<number>("offer-letters.minClauseTextLength");
  const [library, setLibrary] = useState<ClauseLibrary>("special");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Bespoke clause"
      description="Legal-drafted clause for this letter only. To reuse it, add it to the library instead."
      size="large"
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || text.trim().length < minText} onClick={() => onSave({ library, title: title.trim(), text: text.trim() })}>
            Add to letter
          </Button>
        </>
      }
    >
      <Stack gap="medium">
        <Field label="Section" htmlFor="cl-lib">
          <Select id="cl-lib" value={library} onChange={(e) => setLibrary(e.target.value as ClauseLibrary)} options={(Object.keys(libraryMeta) as ClauseLibrary[]).map((k) => ({ value: k, label: `${libraryMeta[k].label} (${libraryMeta[k].prd})` }))} />
        </Field>
        <Field label="Clause title" htmlFor="cl-title">
          <Input id="cl-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Assignment of insurance proceeds" />
        </Field>
        <Field label="Clause text" htmlFor="cl-text" description="Use merge fields such as {{obligor.name}}, {{facility.amount}}, {{tenant.shortName}}.">
          <Textarea id="cl-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </Stack>
    </Modal>
  );
}

function EditClauseModal({ clause, current, ctx, onClose, onSave }: { clause: Clause; current?: string; ctx: MergeContext; onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(current ?? clause.text);
  const minText = useRule<number>("offer-letters.minClauseTextLength");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit wording — ${clause.title}`}
      description={`${clause.id} v${clause.version} (Legal-approved). The change applies to this letter only and is tracked in its version history.`}
      size="large"
      footer={
        <>
          <Button variant="text" onClick={() => setText(clause.text)}>
            Restore library text
          </Button>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={text.trim().length < minText} onClick={() => onSave(text.trim())}>

            Save wording
          </Button>
        </>
      }
    >
      <Stack gap="medium">
        <Field label="Clause text" htmlFor="edit-text">
          <Textarea id="edit-text" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Card variant="filled" padding="small">
          <Stack gap="xsmall">
            <Text variant="eyebrow">Preview</Text>
            <p className="text-sm leading-6 text-fg">
              <Merged text={text} ctx={ctx} highlight />
            </p>
          </Stack>
        </Card>
        {text !== clause.text ? <StatusBadge status="Edited for this letter" tones={{ "Edited for this letter": "warning" }} /> : null}
      </Stack>
    </Modal>
  );
}
