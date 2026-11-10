"use client";

/**
 * Offer-letter state changes (PRD §7). Each action: `.before` hook (veto/enrich) → change → audit →
 * domain event → `.after` hook. Approvals go through the Operations workflow (see ./platform.ts).
 * BACKEND SEAM: replace the store writes with API mutations; keep the hook/event calls server-side.
 */
import { useDb } from "@/lib/data/store";
import type { Application } from "@/lib/data/types";
import { date } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { submitOperation } from "@/lib/platform/operations";
import { currentActor } from "@/lib/platform/scope";
import { auditAs, demoNowIso } from "../credit-admin/common";
import { useCreditAdminStore } from "../credit-admin/store";
import type { Clause } from "./library";
import type { ClauseChangePayload, LetterSignoffPayload, TemplateApprovalPayload } from "./platform";
import { useOfferLetterStore, type OfferLetter } from "./store";
import type { HouseTemplate } from "./template";

export type ActionResult = { ok: true; message: string } | { ok: false; reason: string };

const MODULE = "offer-letters";
const letterHref = (id: string) => `/offer-letters/letter/?id=${id}`;

function withVersion(letter: OfferLetter, changes: Partial<OfferLetter>, byName: string, summary: string): OfferLetter {
  const at = demoNowIso();
  const version = (letter.versions[letter.versions.length - 1]?.version ?? 0) + 1;
  return { ...letter, ...changes, updatedAt: at, versions: [...letter.versions, { version, at, byName, summary }] };
}

/** Save a change on a letter with a version entry, audit event and domain event. */
export async function editLetter(letter: OfferLetter, changes: Partial<OfferLetter>, summary: string, action: string, before?: string, after?: string): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("offer-letters.letter.edit.before", { letter, changes, summary, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const updated = withVersion(letter, hook.ctx.changes, actor.name, summary);
  useOfferLetterStore.getState().saveLetter(updated);
  auditAs(actor, action, "Offer letter", letter.id, before, after);
  publish("offer-letters.letter.edited", { module: MODULE, subject: { type: "OfferLetter", id: letter.id, title: letter.ref, href: letterHref(letter.id) }, payload: { summary } });
  await runHooks("offer-letters.letter.edit.after", { letter: updated, summary });
  return { ok: true, message: summary };
}

/** Add an internal review comment. */
export function commentOnLetter(letter: OfferLetter, comment: OfferLetter["comments"][number]) {
  const actor = currentActor();
  useOfferLetterStore.getState().saveLetter({ ...letter, comments: [...letter.comments, comment] });
  auditAs(actor, "Commented on offer letter", "Offer letter", letter.id, undefined, comment.body.slice(0, 120));
  publish("offer-letters.letter.commented", { module: MODULE, subject: { type: "OfferLetter", id: letter.id, title: letter.ref, href: letterHref(letter.id) }, payload: { commentId: comment.id } });
}

/** Send a letter to Legal for sign-off & issue (or request a re-issue after lapse) through Operations. */
export async function submitForSignoff(letter: OfferLetter, info: Omit<LetterSignoffPayload, "letterId" | "mode" | "snapshot" | "ref">, mode: LetterSignoffPayload["mode"]): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("offer-letters.signoff.submit.before", { letter, mode, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const staged = mode === "issue" ? withVersion(letter, { status: "Legal review" }, actor.name, "Sent to Legal for sign-off & issue") : letter;
  useOfferLetterStore.getState().saveLetter(staged);
  const res = await submitOperation<LetterSignoffPayload>("offer-letters.letter.signoff", {
    title: `${mode === "reissue" ? "Re-issue" : "Sign off & issue"} offer letter ${letter.ref} — ${info.obligorName}`,
    subject: { type: "OfferLetter", id: letter.id, title: letter.ref, href: letterHref(letter.id) },
    payload: { ...info, letterId: letter.id, mode, ref: letter.ref, snapshot: staged },
    summary: [
      { label: "Letter", value: letter.ref },
      { label: "Obligor", value: info.obligorName },
      { label: "Amount", value: info.amount },
      { label: "Clauses", value: `${letter.clauseIds.length} library · ${letter.customClauses.length} bespoke · ${Object.keys(letter.clauseEdits).length} edited` },
      { label: "Validity", value: `${letter.validityDays} days` },
    ],
  });
  if (!res.ok) {
    useOfferLetterStore.getState().saveLetter(letter);
    return { ok: false, reason: res.reason };
  }
  auditAs(actor, mode === "reissue" ? "Requested offer-letter re-issue" : "Sent offer letter to Legal for sign-off", "Offer letter", letter.id, letter.status, mode === "issue" ? "Legal review" : letter.status);
  publish("offer-letters.letter.submitted", { module: MODULE, subject: { type: "OfferLetter", id: letter.id, title: letter.ref, href: letterHref(letter.id) }, payload: { mode, operationId: res.instance.id } });
  await runHooks("offer-letters.signoff.submit.after", { letter: staged, instance: res.instance });
  return { ok: true, message: res.applied ? "Issued — the workflow has no approval steps configured." : `Sent to Legal for sign-off (${res.instance.id}).` };
}

/** Record the customer's acceptance; clears the "Signed acceptance" CP and moves the application to Conditions. */
export async function recordAcceptance(letter: OfferLetter, app: Application, acceptedAt: string, info: { obligorName: string; rmUserId?: string }): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("offer-letters.acceptance.record.before", { letter, app, acceptedAt, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const updated = withVersion(letter, { status: "Accepted", acceptedAt, acceptanceRecordedByName: actor.name }, actor.name, `Customer acceptance recorded — signed duplicate dated ${date(acceptedAt)}`);
  useOfferLetterStore.getState().saveLetter(updated);
  auditAs(actor, "Recorded customer acceptance", "Offer letter", letter.id, "Issued", "Accepted");
  // TD-853: the "Signed acceptance" CP id is the library clause id CP-02 (should be a clause flag).
  useCreditAdminStore.getState().setCp(app.id, "CP-02", { status: "met", byName: actor.name, at: demoNowIso(), note: `Signed acceptance dated ${date(acceptedAt)}` });
  auditAs(actor, "Condition precedent met (signed acceptance)", "Application", app.id, "CP-02: pending", "CP-02: met");
  if (app.stage === "Offer") {
    useDb.getState().update("applications", app.id, { stage: "Conditions", updatedAt: demoNowIso() });
    auditAs(actor, "Moved application to Conditions", "Application", app.id, "Offer", "Conditions");
  }
  publish("offer-letters.letter.accepted", { module: MODULE, subject: { type: "OfferLetter", id: letter.id, title: letter.ref, href: letterHref(letter.id) }, payload: { applicationId: app.id, acceptedAt } });
  notify({
    templateId: "offer-letters.acceptance-recorded",
    toRoles: ["credit-admin-officer", "legal-officer"],
    toUserIds: info.rmUserId ? [info.rmUserId] : undefined,
    href: letterHref(letter.id),
    data: { ref: letter.ref, obligor: info.obligorName, acceptedOn: date(acceptedAt), recordedBy: actor.name },
  });
  await runHooks("offer-letters.acceptance.record.after", { letter: updated, app });
  return { ok: true, message: "Customer acceptance recorded." };
}

/** Propose a clause-library change (new, wording, retire, reinstate) for approval through Operations. */
export async function submitClauseChange(clause: Clause, change: ClauseChangePayload["change"], note: string, text?: string): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("offer-letters.clause.submit.before", { clause, change, text, note, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const at = demoNowIso();
  const staged: Clause =
    change === "wording"
      ? { ...clause, proposedText: text, status: "Pending Legal approval", history: [...clause.history, { version: clause.version + 1, text: text ?? clause.text, at, byName: actor.name, note: `Proposed: ${note || "wording change"}` }] }
      : change === "new"
        ? { ...clause, status: "Pending Legal approval" }
        : clause;
  const store = useOfferLetterStore.getState();
  const previous = store.clauses[clause.id];
  store.saveClause(staged);
  const res = await submitOperation<ClauseChangePayload>("offer-letters.clause.change", {
    title: `${{ new: "New clause", wording: "Wording change", retire: "Retire clause", reinstate: "Reinstate clause" }[change]} ${clause.id} — ${clause.title}`,
    subject: { type: "Clause", id: clause.id, title: clause.title, href: "/offer-letters/library/" },
    payload: { clauseId: clause.id, change, title: clause.title, text, note, snapshot: staged },
    summary: [
      { label: "Clause", value: `${clause.id} — ${clause.title}` },
      { label: "Change", value: change },
      ...(text ? [{ label: "Proposed text", value: text }] : []),
      ...(change === "wording" ? [{ label: "Current text", value: clause.text }] : []),
      { label: "Reason", value: note || "—" },
    ],
  });
  if (!res.ok) {
    if (previous) store.saveClause(previous);
    else if (change === "new") useOfferLetterStore.setState((s) => ({ clauses: Object.fromEntries(Object.entries(s.clauses).filter(([id]) => id !== clause.id)) }));
    else store.saveClause(clause);
    return { ok: false, reason: res.reason };
  }
  auditAs(actor, `Proposed clause change (${change})`, "Offer-letter clause", clause.id, change === "wording" ? clause.text : clause.status, text ?? change);
  publish("offer-letters.clause.proposed", { module: MODULE, subject: { type: "Clause", id: clause.id, title: clause.title, href: "/offer-letters/library/" }, payload: { change, operationId: res.instance.id } });
  await runHooks("offer-letters.clause.submit.after", { clause: staged, instance: res.instance });
  return { ok: true, message: res.applied ? "Applied — the workflow has no approval steps configured." : `Submitted for approval (${res.instance.id}).` };
}

/** Save a house-template draft change (create / discard), with audit and event. Section edits are captured at submission. */
export function saveTemplateDraft(template: HouseTemplate, action?: { label: string; before?: string; after?: string }) {
  useOfferLetterStore.getState().saveTemplate(template);
  if (!action) return;
  const actor = currentActor();
  auditAs(actor, action.label, "Offer-letter template", template.id, action.before, action.after);
  publish("offer-letters.template.drafted", { module: MODULE, subject: { type: "HouseTemplate", id: template.id, title: `${template.name} v${template.version}`, href: "/offer-letters/template/" }, payload: { action: action.label } });
}

/** Submit a house-template draft for Legal sign-off through Operations. */
export async function submitTemplate(template: HouseTemplate, current: HouseTemplate | undefined): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("offer-letters.template.submit.before", { template, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const staged: HouseTemplate = { ...template, status: "Pending Legal sign-off" };
  useOfferLetterStore.getState().saveTemplate(staged);
  const res = await submitOperation<TemplateApprovalPayload>("offer-letters.template.approve", {
    title: `House template ${template.name} v${template.version}`,
    subject: { type: "HouseTemplate", id: template.id, title: `${template.name} v${template.version}`, href: "/offer-letters/template/" },
    payload: { templateId: template.id, name: template.name, version: template.version, productLine: template.productLine, changeNote: template.changeNote, snapshot: staged },
    summary: [
      { label: "Template", value: `${template.name} v${template.version}` },
      { label: "Product line", value: template.productLine },
      { label: "Replaces", value: current ? `v${current.version}` : "—" },
      { label: "Sections enabled", value: `${template.sections.filter((s) => s.enabled).length} of ${template.sections.length}` },
      { label: "Change note", value: template.changeNote },
    ],
  });
  if (!res.ok) {
    useOfferLetterStore.getState().saveTemplate(template);
    return { ok: false, reason: res.reason };
  }
  auditAs(actor, "Submitted house template for Legal sign-off", "Offer-letter template", template.id, "Draft", "Pending Legal sign-off");
  publish("offer-letters.template.submitted", { module: MODULE, subject: { type: "HouseTemplate", id: template.id, title: `${template.name} v${template.version}`, href: "/offer-letters/template/" }, payload: { operationId: res.instance.id } });
  await runHooks("offer-letters.template.submit.after", { template: staged, instance: res.instance });
  return { ok: true, message: res.applied ? "Approved — the workflow has no approval steps configured." : `v${template.version} submitted for Legal sign-off (${res.instance.id}).` };
}
