"use client";

/**
 * Loan-origination services (invariant 9). Every state change here:
 *  - runs hook points `origination.<action>.before` (vetoes honoured) and `.after`,
 *  - writes the audit log, publishes a domain event and notifies the relevant roles/users,
 *  - routes anything needing approval through the Operations engine (credit approval, limit exception,
 *    recommendation override).
 * Services read the signed-in actor with `currentActor()` and the data with `useDb.getState()`, so they work
 * from components, operation handlers and event subscribers alike.
 */
import { useDb, newId } from "@/lib/data/store";
import type { Application, ApplicationStage, DocumentRecord } from "@/lib/data/types";
import { money } from "@/lib/format";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { publish, type EventSubject } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { decideOperation, getDefinition, submitOperation, useOperationsStore, type OperationInstance, type StepDecision } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import { currentActor, type Actor } from "@/lib/platform/scope";
import { buildApprovalChain, chainFromOperation, creditOperationType, type Flow } from "@/lib/workflow";
import { useOriginationStore } from "./data";
import { recommendationLabel } from "./logic";

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string };

export const CREDIT_OP_PREFIX = "credit.facility-approval";
export const LIMIT_EXCEPTION_OP = "origination.limit-exception";
export const OVERRIDE_OP = "origination.recommendation-override";
/** Operation subject types (distinct so `usePendingFor` finds the right operation per record). */
export const SUBJECT = { approval: "Application", exception: "Application limit exception", override: "Recommendation override" } as const;

export const isCreditOp = (type: string) => type.startsWith(CREDIT_OP_PREFIX);

// ---------------------------------------------------------------- helpers

const db = () => useDb.getState();
const findApp = (id: string) => db().applications.find((a) => a.id === id);
const obligorName = (app: Application) => db().obligors.find((o) => o.id === app.obligorId)?.name ?? app.obligorId;

export const appHref = (id: string, tab?: string) => `/origination/application/?id=${id}${tab ? `&tab=${tab}` : ""}`;
export const appSubject = (app: Application, tab?: string): EventSubject => ({ type: "Application", id: app.id, title: `${app.id} · ${obligorName(app)}`, href: appHref(app.id, tab) });

function audit(actor: Actor, app: Application, action: string, before?: string, after?: string, entityType = "Application", entityId = app.id) {
  db().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType, entityId, before, after });
}

/** Base template data for an application. */
function vars(app: Application, extra: Record<string, unknown> = {}) {
  return { appId: app.id, obligor: obligorName(app), amount: money(app.amount), product: app.product, flow: app.flow, stage: app.stage, ...extra };
}

function update(app: Application, changes: Partial<Application>) {
  db().update("applications", app.id, { ...changes, updatedAt: new Date().toISOString() });
}

/** Run before-hooks (veto → blocked), the change, then after-hooks. */
async function guarded<C extends object>(point: string, ctx: C, run: (ctx: C) => void | Promise<void>): Promise<ActionResult> {
  const before = await runHooks(`origination.${point}.before`, ctx);
  if (!before.ok) return { ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` };
  await run(before.ctx);
  await runHooks(`origination.${point}.after`, before.ctx);
  return { ok: true };
}

const notFound: ActionResult = { ok: false, reason: "Application not found." };

/** Fresh pending chain for an application's flow and amount. */
export const freshChain = (app: Pick<Application, "flow" | "amount">) => buildApprovalChain(app.amount, db().users, app.flow as Flow);

// ---------------------------------------------------------------- lifecycle

/** Create a request: `persist` writes the records (wizard) and returns the new application id. */
export async function createApplication(persist: () => string | undefined): Promise<ActionResult & { appId?: string }> {
  const actor = currentActor();
  const before = await runHooks("origination.application.create.before", { actor });
  if (!before.ok) return { ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` };
  const appId = persist();
  const app = appId ? findApp(appId) : undefined;
  if (!app) return { ok: false, reason: "The request could not be saved." };
  publish("origination.application.created", { module: "origination", subject: appSubject(app), payload: { stage: app.stage, amount: app.amount, flow: app.flow, product: app.product } });
  await runHooks("origination.application.create.after", { actor, app });
  return { ok: true, appId };
}

/** Draft → Documents / Analysis (PRD §6.1.1 step 2: flows in parallel to the BDM and to Legal). */
export async function submitApplication(appId: string): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  const docs = db().documents.filter((d) => app.documentIds.includes(d.id));
  const next: ApplicationStage = docs.length && docs.every((d) => d.status === "Extracted" || d.status === "Verified") ? "Analysis" : "Documents";
  return guarded("application.submit", { app, actor, next }, ({ next: to }) => {
    update(app, { stage: to });
    audit(actor, app, "Submitted application", app.stage, to);
    publish("origination.application.submitted", { module: "origination", subject: appSubject(app), payload: { stage: to, amount: app.amount, flow: app.flow } });
    notify({ templateId: "origination.application-submitted", toRoles: ["bdm", "legal-officer"], href: appHref(app.id), data: vars(app, { submittedBy: actor.name }) });
  });
}

export async function sendToAnalysis(appId: string): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  return guarded("application.analysis-start", { app, actor }, () => {
    update(app, { stage: "Analysis" });
    audit(actor, app, "Documents complete — sent to analysis", app.stage, "Analysis");
    publish("origination.application.sent-to-analysis", { module: "origination", subject: appSubject(app) });
    notify({ templateId: "origination.ready-for-analysis", toRoles: ["credit-analyst"], href: appHref(app.id, "financials"), data: vars(app, { sentBy: actor.name }) });
  });
}

/** Credit Analyst completes analysis; the initiator then submits the request for approval. */
export async function completeAnalysis(appId: string, next: ApplicationStage): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  return guarded("application.analysis-complete", { app, actor, next }, ({ next: to }) => {
    update(app, { stage: to, approvals: freshChain(app) });
    audit(actor, app, "Completed credit analysis", "Analysis", to);
    publish("origination.application.analysis-completed", { module: "origination", subject: appSubject(app), payload: { next: to, recommendation: app.recommendation } });
    notify({ templateId: "origination.analysis-complete", toUserIds: [app.createdById], href: appHref(app.id, "approvals"), data: vars(app, { analyst: actor.name, recommendation: app.recommendation ? recommendationLabel[app.recommendation] : "—" }) });
  });
}

/** Submit the credit request into the Operations workflow (chart-flow steps for its amount and flow). */
export async function submitForApproval(appId: string): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  const type = creditOperationType(app.flow, app.amount);
  let result: ActionResult = { ok: true };
  const outer = await guarded("approval.submit", { app, actor, operationType: type }, async ({ operationType }) => {
    const def = getDefinition(operationType);
    const res = await submitOperation(operationType, {
      title: `Credit approval — ${app.id} · ${obligorName(app)} · ${money(app.amount)}`,
      subject: { type: SUBJECT.approval, id: app.id, title: `${app.id} · ${obligorName(app)}`, href: appHref(app.id, "approvals") },
      payload: { applicationId: app.id, flow: app.flow, amount: app.amount },
      summary: [
        { label: "Application", value: app.id },
        { label: "Obligor", value: obligorName(app) },
        { label: "Amount", value: money(app.amount) },
        { label: "Product", value: `${app.product} · ${app.tenorMonths} months` },
        { label: "Chart-flow", value: `${app.flow} · ${def.steps.length} step(s)` },
        { label: "Recommendation", value: app.recommendation ? recommendationLabel[app.recommendation] : "—" },
        { label: "Limit gate", value: app.limitGate },
      ],
    });
    if (!res.ok) {
      result = { ok: false, reason: res.reason };
      return;
    }
    syncFromOperation(res.instance);
    audit(actor, app, `Submitted for credit approval (${def.name})`, undefined, res.instance.id);
    publish("origination.approval.submitted", { module: "origination", subject: appSubject(app, "approvals"), payload: { operationId: res.instance.id, operationType, steps: def.steps.map((s) => s.id) } });
    result = { ok: true, message: res.applied ? "Approved directly — the workflow has no steps." : `Routed to ${def.steps[0]?.name ?? "approvers"}.` };
  });
  return outer.ok ? result : outer;
}

/** Decide the current step of an application's operation (credit approval / exception / override) inline. */
export async function decideApplicationOperation(operationId: string, decision: "approve" | "reject" | "return", comment: string): Promise<ActionResult> {
  const res = await decideOperation(operationId, decision, comment);
  if (!res.ok) return res;
  if (isCreditOp(res.instance.operationType)) syncFromOperation(res.instance);
  return { ok: true };
}

export async function releaseToOffer(appId: string): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  return guarded("application.release", { app, actor }, () => {
    update(app, { stage: "Offer" });
    audit(actor, app, "Released to offer letter", app.stage, "Offer");
    publish("origination.application.released-to-offer", { module: "origination", subject: appSubject(app) });
    notify({ templateId: "origination.released-to-offer", toUserIds: [app.createdById], href: `/offer-letters/letter/?applicationId=${app.id}`, data: vars(app, { releasedBy: actor.name }) });
  });
}

export async function withdrawApplication(appId: string, reason = ""): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  return guarded("application.withdraw", { app, actor, reason }, () => {
    update(app, { stage: "Withdrawn" });
    audit(actor, app, "Withdrew application", app.stage, "Withdrawn");
    publish("origination.application.withdrawn", { module: "origination", subject: appSubject(app), payload: { from: app.stage, reason } });
    notify({ templateId: "origination.application-withdrawn", toRoles: ["credit-analyst", "bdm"], href: appHref(app.id), data: vars(app, { withdrawnBy: actor.name, reason: reason || "No reason given." }) });
  });
}

/** Generic audited change with an event (bureau pull, covenant tagging, COP explanation, memo sign-off, comments…). */
export async function recordChange(appId: string, input: { point: string; event: string; action: string; changes?: Partial<Application>; before?: string; after?: string; payload?: Record<string, unknown> }): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  return guarded(input.point, { app, actor, changes: input.changes }, ({ changes }) => {
    if (changes) update(app, changes);
    audit(actor, app, input.action, input.before, input.after);
    publish(input.event, { module: "origination", subject: appSubject(app), payload: input.payload ?? {} });
  });
}

/** Add a comment; people @mentioned by first name are notified. */
export async function addComment(appId: string, body: string, users: { id: string; name: string }[]): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  const mentioned = users.filter((u) => u.id !== actor.id && new RegExp(`@${u.name.split(" ")[0]}\\b`, "i").test(body)).map((u) => u.id);
  return guarded("comment.add", { app, actor, body, mentioned }, (ctx) => {
    audit(actor, app, "Added comment", undefined, ctx.body.slice(0, 80));
    publish("origination.comment.added", { module: "origination", subject: appSubject(app, "comments"), payload: { mentioned: ctx.mentioned } });
    if (ctx.mentioned.length) notify({ templateId: "origination.comment-mention", toUserIds: ctx.mentioned, href: appHref(app.id, "comments"), data: vars(app, { author: actor.name, excerpt: ctx.body.slice(0, 160) }) });
  });
}

// ---------------------------------------------------------------- limit gate (PRD §5.6, §6.1.5)

export async function recordLimitGate(appId: string, result: Application["limitGate"]): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  return guarded("limit-gate.check", { app, actor, result }, ({ result: r }) => {
    update(app, { limitGate: r });
    audit(actor, app, "Ran portfolio-limit gate", app.limitGate, r);
    publish("origination.limit-gate.checked", { module: "origination", subject: appSubject(app, "recommendation"), payload: { before: app.limitGate, result: r } });
    if (r.startsWith("Breach")) {
      publish("origination.limit-gate.breached", { module: "origination", subject: appSubject(app, "recommendation"), payload: { result: r } });
      notify({ templateId: "origination.limit-breach", toRoles: ["credit-analyst", "cro"], toUserIds: [app.createdById], href: appHref(app.id, "recommendation"), data: vars(app, { breach: r }) });
    }
  });
}

/** Ask the CRO / Board for an informed exception decision on a limit breach (Operations workflow). */
export async function requestLimitException(appId: string, justification: string): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  let result: ActionResult = { ok: true };
  const outer = await guarded("limit-exception.request", { app, actor, justification }, async ({ justification: j }) => {
    const res = await submitOperation(LIMIT_EXCEPTION_OP, {
      title: `Limit exception — ${app.id} · ${obligorName(app)} (${app.limitGate})`,
      subject: { type: SUBJECT.exception, id: app.id, title: `${app.id} · ${obligorName(app)}`, href: appHref(app.id, "recommendation") },
      payload: { applicationId: app.id, breach: app.limitGate, justification: j },
      summary: [
        { label: "Application", value: app.id },
        { label: "Obligor", value: obligorName(app) },
        { label: "Amount", value: money(app.amount) },
        { label: "Breach", value: app.limitGate },
        { label: "Justification", value: j },
      ],
    });
    if (!res.ok) {
      result = { ok: false, reason: res.reason };
      return;
    }
    audit(actor, app, `Requested limit exception (${app.limitGate})`, undefined, res.instance.id);
    publish("origination.limit-exception.requested", { module: "origination", subject: appSubject(app, "recommendation"), payload: { operationId: res.instance.id, breach: app.limitGate } });
  });
  return outer.ok ? result : outer;
}

type ExceptionPayload = { applicationId: string; breach: string; justification: string };
export function applyLimitException(p: ExceptionPayload, instance: OperationInstance, actor: Actor, granted: boolean) {
  const app = findApp(p.applicationId);
  if (!app) return;
  const comment = instance.decisions.at(-1)?.comment ?? instance.reason ?? "";
  useOriginationStore.getState().patch(app.id, { exception: { decision: granted ? "granted" : "refused", by: actor.name, at: new Date().toISOString(), comment } });
  if (!granted) update(app, { stage: "Declined" });
  audit(actor, app, `${granted ? "Granted" : "Refused"} limit exception (${p.breach})`, p.breach, granted ? "Exception granted" : "Declined");
  publish(granted ? "origination.limit-exception.granted" : "origination.limit-exception.refused", { module: "origination", subject: appSubject(app, "recommendation"), payload: { operationId: instance.id, breach: p.breach } });
  notify({ templateId: "origination.limit-exception-decided", toRoles: ["credit-analyst"], toUserIds: [app.createdById], href: appHref(app.id, "recommendation"), data: vars(app, { breach: p.breach, outcome: granted ? "granted" : "refused", decidedBy: actor.name, comment }) });
}

// ---------------------------------------------------------------- recommendation (PRD §6.1.5)

type Rec = NonNullable<Application["recommendation"]>;
export type OverridePayload = { applicationId: string; from: Rec; to: Rec; reason: string; requestedBy: string };

/** Adopt the engine recommendation (direct, audited) or request an override (Operations approval). */
export async function adoptRecommendation(appId: string, engine: Rec, choice: Rec, reason: string): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  const override = choice !== engine;
  if (override && reason.trim().length < getRule<number>("origination.override.minReasonLength")) return { ok: false, reason: `Give an override reason of at least ${getRule<number>("origination.override.minReasonLength")} characters.` };
  let result: ActionResult = { ok: true };
  const outer = await guarded("recommendation.adopt", { app, actor, engine, choice, reason }, async (ctx) => {
    if (!override) {
      useOriginationStore.getState().patch(app.id, { override: undefined });
      update(app, { recommendation: ctx.choice });
      audit(actor, app, "Adopted system recommendation", app.recommendation ? recommendationLabel[app.recommendation] : undefined, recommendationLabel[ctx.choice]);
      publish("origination.recommendation.adopted", { module: "origination", subject: appSubject(app, "recommendation"), payload: { recommendation: ctx.choice } });
      result = { ok: true, message: recommendationLabel[ctx.choice] };
      return;
    }
    const res = await submitOperation<OverridePayload>(OVERRIDE_OP, {
      title: `Recommendation override — ${app.id}: ${recommendationLabel[engine]} → ${recommendationLabel[ctx.choice]}`,
      subject: { type: SUBJECT.override, id: app.id, title: `${app.id} · ${obligorName(app)}`, href: appHref(app.id, "recommendation") },
      payload: { applicationId: app.id, from: engine, to: ctx.choice, reason: ctx.reason.trim(), requestedBy: actor.name },
      summary: [
        { label: "Application", value: `${app.id} · ${obligorName(app)}` },
        { label: "System recommendation", value: recommendationLabel[engine] },
        { label: "Proposed", value: recommendationLabel[ctx.choice] },
        { label: "Reason", value: ctx.reason.trim() },
      ],
    });
    if (!res.ok) {
      result = { ok: false, reason: res.reason };
      return;
    }
    audit(actor, app, `Requested recommendation override — reason: ${ctx.reason.trim()}`, recommendationLabel[engine], recommendationLabel[ctx.choice]);
    publish("origination.recommendation.override-requested", { module: "origination", subject: appSubject(app, "recommendation"), payload: { operationId: res.instance.id, from: engine, to: ctx.choice } });
    result = { ok: true, message: res.applied ? "Override applied." : "Override sent for approval." };
  });
  return outer.ok ? result : outer;
}

export function applyOverride(p: OverridePayload, instance: OperationInstance, actor: Actor) {
  const app = findApp(p.applicationId);
  if (!app) return;
  useOriginationStore.getState().patch(app.id, { override: { from: p.from, to: p.to, reason: p.reason, by: p.requestedBy, at: new Date().toISOString() } });
  update(app, { recommendation: p.to });
  audit(actor, app, `Overrode system recommendation (approved) — reason: ${p.reason}`, recommendationLabel[p.from], recommendationLabel[p.to]);
  publish("origination.recommendation.overridden", { module: "origination", subject: appSubject(app, "recommendation"), payload: { operationId: instance.id, from: p.from, to: p.to } });
  notify({ templateId: "origination.recommendation-overridden", toRoles: ["cco"], toUserIds: [app.createdById], href: appHref(app.id, "recommendation"), data: vars(app, { from: recommendationLabel[p.from], to: recommendationLabel[p.to], reason: p.reason, requestedBy: p.requestedBy, approvedBy: actor.name }) });
}

// ---------------------------------------------------------------- documents (PRD §5.4)

export async function uploadDocument(appId: string, file: { name: string; size: number }, kind: DocumentRecord["kind"], replaces?: DocumentRecord): Promise<ActionResult & { docId?: string }> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  let docId: string | undefined;
  const res = await guarded("document.upload", { app, actor, file, kind, replaces }, (ctx) => {
    const prior = db().documents.filter((d) => app.documentIds.includes(d.id) && d.kind === ctx.kind);
    const doc: DocumentRecord = {
      id: newId("DOC"),
      ownerType: "application",
      ownerId: app.id,
      name: ctx.replaces ? ctx.replaces.name : ctx.file.name,
      kind: ctx.kind,
      sizeKb: Math.max(1, Math.round(ctx.file.size / 1024)),
      version: ctx.replaces ? ctx.replaces.version + 1 : prior.length ? Math.max(...prior.map((d) => d.version)) + 1 : 1,
      uploadedById: actor.id,
      uploadedAt: new Date().toISOString(),
      status: "Processing OCR",
    };
    docId = doc.id;
    db().upsert("documents", doc);
    update(app, { documentIds: [...app.documentIds, doc.id] });
    audit(actor, app, ctx.replaces ? `Uploaded new version v${doc.version} of ${ctx.kind}` : `Uploaded document (${ctx.kind})`, ctx.replaces ? `v${ctx.replaces.version}` : undefined, `${doc.name} v${doc.version}`);
    publish("origination.document.uploaded", { module: "origination", subject: appSubject(app, "documents"), payload: { documentId: doc.id, kind: ctx.kind, version: doc.version, replaces: ctx.replaces?.id } });
    if (app.stage !== "Draft") notify({ templateId: "origination.document-uploaded", toRoles: ["credit-analyst"], href: appHref(app.id, "documents"), data: vars(app, { document: doc.name, kind: ctx.kind, version: `v${doc.version}`, uploadedBy: actor.name }) });
  });
  return res.ok ? { ...res, docId } : res;
}

export async function verifyDocuments(appId: string, ids: string[]): Promise<ActionResult> {
  const app = findApp(appId);
  if (!app) return notFound;
  const actor = currentActor();
  return guarded("document.verify", { app, actor, ids }, (ctx) => {
    ctx.ids.forEach((id) => db().update("documents", id, { status: "Verified" }));
    audit(actor, app, `Verified ${ctx.ids.length} extracted document(s)`, "Extracted", "Verified");
    publish("origination.document.verified", { module: "origination", subject: appSubject(app, "documents"), payload: { documentIds: ctx.ids } });
    notify({ templateId: "origination.documents-verified", toUserIds: [app.createdById], href: appHref(app.id, "documents"), data: vars(app, { count: ctx.ids.length, verifiedBy: actor.name }) });
  });
}

// ---------------------------------------------------------------- step-up authentication (PRD §4.2)

const stepUps = new Set<string>();
const stepUpKey = (instance: Pick<OperationInstance, "id" | "stepIndex">, actorId: string) => `${instance.id}:${instance.stepIndex}:${actorId}`;
/** Record a verified step-up for the actor on the current step of an operation. */
export function markStepUp(instance: Pick<OperationInstance, "id" | "stepIndex">) {
  stepUps.add(stepUpKey(instance, currentActor().id));
}
export const hasStepUp = (instance: Pick<OperationInstance, "id" | "stepIndex">, actorId: string) => stepUps.has(stepUpKey(instance, actorId));

// ---------------------------------------------------------------- operation ↔ application sync

export type CreditPayload = { applicationId: string; flow: Flow; amount: number };

/** Mirror an operation instance onto `Application.approvals` (and move Recommendation → Approval after tier 1). */
export function syncFromOperation(instance: OperationInstance) {
  const p = instance.payload as CreditPayload;
  const app = findApp(p.applicationId);
  if (!app) return;
  const steps = getDefinition(instance.operationType).steps;
  const approvals = chainFromOperation(steps, instance, db().users);
  const changes: Partial<Application> = { approvals };
  if (app.stage === "Recommendation" && instance.stepIndex > 0) changes.stage = "Approval";
  if (instance.status === "Rejected") changes.stage = "Declined";
  if (JSON.stringify(app.approvals) !== JSON.stringify(approvals) || changes.stage) update(app, changes);
}

export function onCreditApproved(p: CreditPayload, instance: OperationInstance, actor: Actor) {
  const app = findApp(p.applicationId);
  if (!app) return;
  syncFromOperation(instance);
  audit(actor, app, "Credit approval complete — all tiers signed", "In progress", "Approved");
  publish("origination.application.approved", { module: "origination", subject: appSubject(app, "approvals"), payload: { operationId: instance.id, amount: app.amount, finalStep: instance.decisions.at(-1)?.stepId } });
  notify({ templateId: "origination.credit-approved", toRoles: ["credit-analyst"], toUserIds: [app.createdById], href: appHref(app.id, "approvals"), data: vars(app, { approvedBy: actor.name }) });
}

export function onCreditRejected(p: CreditPayload, instance: OperationInstance, actor: Actor) {
  const app = findApp(p.applicationId);
  if (!app) return;
  syncFromOperation(instance);
  const comment = instance.reason ?? instance.decisions.at(-1)?.comment ?? "";
  audit(actor, app, "Credit request declined", app.stage, "Declined");
  publish("origination.application.declined", { module: "origination", subject: appSubject(app, "approvals"), payload: { operationId: instance.id, stepId: instance.decisions.at(-1)?.stepId } });
  notify({ templateId: "origination.credit-declined", toRoles: ["credit-analyst"], toUserIds: [app.createdById], href: appHref(app.id, "approvals"), data: vars(app, { declinedBy: actor.name, reason: comment }) });
}

/** Return for rework: back to the Credit Analyst, route restarts (PRD §6.1.1 "returns for rework"). */
export function onCreditReturned(instance: OperationInstance) {
  const p = instance.payload as CreditPayload;
  const app = findApp(p.applicationId);
  if (!app) return;
  const last: StepDecision | undefined = instance.decisions.at(-1);
  const actor = currentActor();
  update(app, { stage: "Analysis", approvals: freshChain(app) });
  audit(actor, app, `Returned for rework at "${last?.stepId ?? "?"}" (${last ? roleById[last.roleId as RoleId]?.short : "—"})`, app.stage, "Analysis — rework");
  publish("origination.application.returned", { module: "origination", subject: appSubject(app), payload: { operationId: instance.id, stepId: last?.stepId, comment: last?.comment } });
  notify({ templateId: "origination.returned-for-rework", toRoles: ["credit-analyst"], toUserIds: [app.createdById], href: appHref(app.id), data: vars(app, { returnedBy: last?.actorName ?? actor.name, reason: last?.comment ?? "" }) });
}

/** The requester withdrew the approval request: route resets, application stays at its stage for resubmission. */
export function onCreditCancelled(instance: OperationInstance) {
  const p = instance.payload as CreditPayload;
  const app = findApp(p.applicationId);
  if (!app) return;
  update(app, { approvals: freshChain(app) });
  publish("origination.approval.withdrawn", { module: "origination", subject: appSubject(app, "approvals"), payload: { operationId: instance.id, reason: instance.reason } });
}

// ---------------------------------------------------------------- seeded demo applications

/**
 * Seeded applications in Recommendation / Approval have a settled chain but no operation. Create the matching
 * open operation (requested by the Account Officer) once, so approvals run through Operations from the start.
 * Demo seeding only — writes the operations store directly like other seeds (TD-114).
 */
export function seedCreditOperations() {
  if (typeof window === "undefined") return;
  const { applications, users } = db();
  const existing = new Set(useOperationsStore.getState().instances.filter((i) => isCreditOp(i.operationType)).map((i) => i.subject.id));
  const created: OperationInstance[] = [];
  for (const app of applications) {
    if (!["Recommendation", "Approval"].includes(app.stage) || existing.has(app.id)) continue;
    const type = creditOperationType(app.flow, app.amount);
    const steps = getDefinition(type).steps;
    if (!steps.length) continue;
    const ao = users.find((u) => u.id === app.createdById);
    // Tiers fully signed in the seeded chain (by tier number), capped so at least one step stays open.
    const signedTiers = new Set(app.approvals.filter((s) => !s.adjudicates).map((s) => s.tier).filter((t) => app.approvals.filter((s) => s.tier === t && !s.adjudicates).every((s) => s.decision === "approved" || s.decision === "recommended")));
    let stepIndex = 0;
    while (stepIndex < steps.length - 1 && signedTiers.has(stepIndex + 1)) stepIndex++;
    const at = app.updatedAt;
    const decisions: StepDecision[] = steps.slice(0, stepIndex).flatMap((step) =>
      step.approverRoles.map((roleId) => {
        const s = app.approvals.find((x) => x.roleId === roleId && !x.adjudicates);
        const u = users.find((x) => x.id === s?.assigneeId) ?? users.find((x) => x.roleId === roleId);
        return { stepId: step.id, actorId: u?.id ?? roleId, actorName: u?.name ?? roleById[roleId].name, roleId, decision: "approve" as const, comment: s?.comment ?? "Approved.", at: s?.decidedAt ?? at };
      }),
    );
    const current = steps[stepIndex]!;
    const dissent = app.approvals.some((s) => s.adjudicates && s.decision === "pending") && current.mode === "all" && Boolean(current.adjudicatorRole);
    if (dissent) {
      current.approverRoles.forEach((roleId, i) => {
        const u = users.find((x) => x.roleId === roleId);
        decisions.push({ stepId: current.id, actorId: u?.id ?? roleId, actorName: u?.name ?? roleById[roleId].name, roleId, decision: i === 0 ? "approve" : "reject", comment: i === 0 ? "Within appetite; approve subject to domiciliation." : "Leverage above appetite for the sector.", at });
      });
    }
    created.push({
      id: newId("OPS"),
      operationType: type,
      definitionVersion: getDefinition(type).version,
      title: `Credit approval — ${app.id} · ${obligorName(app)} · ${money(app.amount)}`,
      subject: { type: SUBJECT.approval, id: app.id, title: `${app.id} · ${obligorName(app)}`, href: appHref(app.id, "approvals") },
      payload: { applicationId: app.id, flow: app.flow, amount: app.amount } satisfies CreditPayload,
      summary: [
        { label: "Application", value: app.id },
        { label: "Obligor", value: obligorName(app) },
        { label: "Amount", value: money(app.amount) },
        { label: "Product", value: `${app.product} · ${app.tenorMonths} months` },
        { label: "Chart-flow", value: `${app.flow} · ${steps.length} step(s)` },
        { label: "Limit gate", value: app.limitGate },
      ],
      requestedBy: { id: ao?.id ?? app.createdById, name: ao?.name ?? "Account Officer", roleId: ao?.roleId ?? "account-officer" },
      requestedAt: app.createdAt,
      status: stepIndex > 0 || decisions.length ? "In progress" : "Pending",
      stepIndex,
      awaitingAdjudication: dissent || undefined,
      decisions,
      stepStartedAt: at,
    });
  }
  if (!created.length) return;
  useOperationsStore.setState((s) => ({ instances: [...s.instances, ...created] }));
  created.forEach(syncFromOperation);
}
