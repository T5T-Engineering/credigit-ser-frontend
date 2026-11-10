"use client";

/**
 * Credit Administration state changes (PRD §6.3). Each action: `.before` hook (veto/enrich) → change → audit →
 * domain event → `.after` hook. Approvals go through the Operations workflow (see ./platform.ts).
 * BACKEND SEAM: replace the store writes with API mutations; keep the hook/event calls server-side.
 */
import type { ChecklistStatus } from "@credigit/web-ui";
import { newId } from "@/lib/data/store";
import { date, money } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { submitOperation } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import { currentActor } from "@/lib/platform/scope";
import { auditAs, demoNowIso } from "./common";
import { daysToExpiry, waiverStatus, type FacilityRow } from "./logic";
import type { CrmsBatchPayload, ReleasePayload, WaiverPayload } from "./platform";
import { useCreditAdminStore, type CrmsBatch, type CrmsSearch, type WaiverRequest } from "./store";

export type ActionResult = { ok: true; message: string } | { ok: false; reason: string };

const MODULE = "credit-admin";
const facilityHref = (id: string) => `/credit-admin/facility/?id=${id}`;
const blocked = (r: { vetoedBy: string; reason: string }): ActionResult => ({ ok: false, reason: `Blocked by ${r.vetoedBy}: ${r.reason}` });

/** Confirm a condition precedent met (or reopen it). */
export async function setConditionStatus(row: FacilityRow, conditionId: string, status: ChecklistStatus): Promise<ActionResult> {
  const actor = currentActor();
  const before = row.cps.find((c) => c.id === conditionId)?.status;
  const hook = await runHooks("credit-admin.cp.confirm.before", { row, conditionId, status, actor });
  if (!hook.ok) return blocked(hook);
  useCreditAdminStore.getState().setCp(row.cpKey, conditionId, { status, byName: actor.name, at: demoNowIso() });
  auditAs(actor, status === "met" ? "Confirmed condition precedent met" : "Reopened condition precedent", "Facility", row.facility.id, `${conditionId}: ${before}`, `${conditionId}: ${status}`);
  publish(status === "met" ? "credit-admin.cp.confirmed" : "credit-admin.cp.reopened", { module: MODULE, subject: { type: "Facility", id: row.facility.id, title: row.obligor?.name, href: facilityHref(row.facility.id) }, payload: { conditionId, before, after: status } });
  await runHooks("credit-admin.cp.confirm.after", { row, conditionId, status });
  return { ok: true, message: `${conditionId} ${status === "met" ? "confirmed" : "reopened"}.` };
}

/** Submit a waiver / deferral / sanction to Operations (new request, or re-submission of a returned / legacy one). */
export async function submitWaiver(request: WaiverRequest): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("credit-admin.waiver.submit.before", { request, actor });
  if (!hook.ok) return blocked(hook);
  const w: WaiverRequest = { ...hook.ctx.request, status: "Pending approval", decidedAt: undefined, decidedByName: undefined, decisionComment: undefined };
  const store = useCreditAdminStore.getState();
  const previous = store.waivers[w.id];
  store.saveWaiver(w);
  const sanction = w.kind === "Sanction for breach";
  const res = await submitOperation<WaiverPayload>(sanction ? "credit-admin.sanction" : "credit-admin.waiver", {
    title: `${w.kind} ${w.id} — ${w.facilityId} · ${w.conditionId} ${w.conditionTitle}`,
    subject: { type: "Waiver", id: w.id, title: `${w.kind} ${w.id}`, href: `/credit-admin/waivers/?facility=${w.facilityId}` },
    payload: { waiverId: w.id, snapshot: w },
    summary: [
      { label: "Type", value: w.kind },
      { label: "Facility", value: w.facilityId },
      { label: "Condition", value: `${w.conditionId} — ${w.conditionTitle} (${w.conditionCategory})` },
      ...(w.expiryDate ? [{ label: sanction ? "Date" : "Expiry / deferred to", value: date(w.expiryDate) }] : []),
      { label: "Routing", value: sanction ? "Disciplinary / escalation workflow" : w.withinTolerance ? "Within Credit Administration's delegated tolerance" : "Tier that approved the facility (or higher)" },
      ...(w.breachDetail ? [{ label: "Breach detail", value: w.breachDetail }] : []),
      { label: "Reason", value: w.reason },
    ],
  });
  if (!res.ok) {
    if (previous) store.saveWaiver(previous);
    else useCreditAdminStore.setState((s) => ({ waivers: Object.fromEntries(Object.entries(s.waivers).filter(([id]) => id !== w.id)) }));
    return { ok: false, reason: res.reason };
  }
  if (!res.applied) store.saveWaiver({ ...w, operationId: res.instance.id });
  auditAs(actor, `Raised ${w.kind.toLowerCase()} request`, "Waiver", w.id, previous?.status, `Pending approval (${res.instance.id})`);
  publish("credit-admin.waiver.requested", { module: MODULE, subject: { type: "Waiver", id: w.id, title: `${w.kind} ${w.id}`, href: `/credit-admin/waivers/?facility=${w.facilityId}` }, payload: { facilityId: w.facilityId, conditionId: w.conditionId, kind: w.kind, withinTolerance: w.withinTolerance, operationId: res.instance.id } });
  await runHooks("credit-admin.waiver.submit.after", { request: w, instance: res.instance });
  return { ok: true, message: res.applied ? "Applied — the workflow has no approval steps configured." : `Submitted for approval (${res.instance.id}).` };
}

/** Close an approved waiver/deferral because the condition has been regularised. */
export function closeWaiver(w: WaiverRequest): ActionResult {
  const actor = currentActor();
  const store = useCreditAdminStore.getState();
  store.saveWaiver({ ...w, status: "Closed", decisionComment: `${w.decisionComment ?? ""} Regularised — condition met.`.trim() });
  store.setCp(w.cpKey, w.conditionId, { status: "met", byName: actor.name, at: demoNowIso(), note: `Regularised (${w.id})` });
  auditAs(actor, `Closed ${w.kind.toLowerCase()} — condition regularised`, "Waiver", w.id, "Approved", "Closed");
  publish("credit-admin.waiver.closed", { module: MODULE, subject: { type: "Waiver", id: w.id, title: `${w.kind} ${w.id}`, href: `/credit-admin/waivers/?facility=${w.facilityId}` }, payload: { facilityId: w.facilityId, conditionId: w.conditionId } });
  return { ok: true, message: `${w.id} closed — condition regularised.` };
}

/** Reminder sweep: notify requesters and relationship managers of waivers/deferrals lapsing within the reminder window. */
export function sendExpiryReminders(waivers: WaiverRequest[]): ActionResult {
  const actor = currentActor();
  const window = getRule<number>("credit-admin.waiverReminderDays");
  const due = waivers.filter((w) => w.kind !== "Sanction for breach" && waiverStatus(w) === "Approved" && (daysToExpiry(w.expiryDate) ?? Infinity) <= window);
  for (const w of due) {
    notify({
      templateId: "credit-admin.waiver-expiring",
      toUserIds: [w.requestedById],
      toRoles: ["credit-admin-officer"],
      href: `/credit-admin/waivers/?facility=${w.facilityId}`,
      data: { kind: w.kind, id: w.id, facility: w.facilityId, condition: `${w.conditionId} — ${w.conditionTitle}`, expiry: w.expiryDate ? date(w.expiryDate) : "—", daysLeft: String(daysToExpiry(w.expiryDate) ?? "—") },
    });
    publish("credit-admin.waiver.reminded", { module: MODULE, subject: { type: "Waiver", id: w.id, title: `${w.kind} ${w.id}` }, payload: { expiryDate: w.expiryDate } });
  }
  auditAs(actor, "Ran waiver/deferral expiry reminder sweep", "Waiver", "-", undefined, `${due.length} reminder(s) within ${window} days`);
  return { ok: true, message: due.length ? `${due.length} reminder(s) sent.` : `Nothing lapses within ${window} days.` };
}

/** Request release for disbursement (Operations). */
export async function requestRelease(row: FacilityRow): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("credit-admin.release.submit.before", { row, actor });
  if (!hook.ok) return blocked(hook);
  const { facility } = row;
  const payload: ReleasePayload = { facilityId: facility.id, obligorName: row.obligor?.name ?? facility.obligorId, amount: money(facility.approvedAmount, facility.currency), cleared: `${row.cleared} of ${row.cps.length} cleared` };
  const res = await submitOperation<ReleasePayload>("credit-admin.release", {
    title: `Release ${facility.id} (${payload.obligorName}) for disbursement`,
    subject: { type: "Facility", id: facility.id, title: payload.obligorName, href: facilityHref(facility.id) },
    payload,
    summary: [
      { label: "Facility", value: facility.id },
      { label: "Obligor", value: payload.obligorName },
      { label: "Approved amount", value: payload.amount },
      { label: "Conditions precedent", value: payload.cleared },
      { label: "Offer letter", value: row.letter ? `${row.letter.ref} (${row.letter.status})` : "—" },
    ],
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  auditAs(actor, "Requested release for disbursement", "Facility", facility.id, "Conditions cleared", `Release requested (${res.instance.id})`);
  publish("credit-admin.facility.release-requested", { module: MODULE, subject: { type: "Facility", id: facility.id, title: payload.obligorName, href: facilityHref(facility.id) }, payload: { operationId: res.instance.id } });
  await runHooks("credit-admin.release.submit.after", { row, instance: res.instance });
  return { ok: true, message: res.applied ? "Released for disbursement." : `Release requested — awaiting confirmation (${res.instance.id}).` };
}

/** Submit a CRMS batch through Operations (applies at once unless the tenant adds an approval step). */
export async function submitCrmsBatch(facilityIds: string[], label: string): Promise<ActionResult> {
  const actor = currentActor();
  const batch: CrmsBatch = { id: newId("CRMS-B"), label, submittedAt: demoNowIso(), submittedByName: actor.name, facilityIds, status: "Accepted by CBN", rejected: 0 };
  const hook = await runHooks("credit-admin.crms.batch.before", { batch, actor });
  if (!hook.ok) return blocked(hook);
  const res = await submitOperation<CrmsBatchPayload>("credit-admin.crms-batch", {
    title: `CRMS batch — ${label} (${facilityIds.length} facilities)`,
    subject: { type: "CrmsBatch", id: batch.id, title: label, href: "/credit-admin/crms/" },
    payload: { batch: hook.ctx.batch },
    summary: [
      { label: "Batch", value: batch.id },
      { label: "Facilities", value: String(facilityIds.length) },
    ],
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  await runHooks("credit-admin.crms.batch.after", { batch, instance: res.instance });
  return { ok: true, message: res.applied ? `Batch ${batch.id} submitted (${facilityIds.length} facilities).` : `Batch awaiting approval (${res.instance.id}).` };
}

/** Log a CRMS search request (result arrives from the simulated connector). */
export function logCrmsSearch(search: CrmsSearch, phase: "requested" | "received") {
  const actor = currentActor();
  useCreditAdminStore.getState().saveSearch(search);
  if (phase === "requested") auditAs(actor, "Requested CRMS search", "Obligor", search.obligorId, undefined, search.purpose);
  else auditAs(actor, "Received CRMS result (simulated)", "Obligor", search.obligorId, "Awaiting response", search.result);
  publish(phase === "requested" ? "credit-admin.crms.search-requested" : "credit-admin.crms.result-received", { module: MODULE, subject: { type: "Obligor", id: search.obligorId, href: "/credit-admin/crms/" }, payload: { searchId: search.id, purpose: search.purpose, result: search.result } });
}

export function resolveCrmsException(facilityId: string, reason: string | undefined) {
  const actor = currentActor();
  useCreditAdminStore.getState().resolveCrms(facilityId, actor.name, demoNowIso());
  auditAs(actor, "Resolved CRMS reporting exception", "Facility", facilityId, reason, "Pending submission");
  publish("credit-admin.crms.exception-resolved", { module: MODULE, subject: { type: "Facility", id: facilityId, href: facilityHref(facilityId) }, payload: { reason } });
}

/** Change a credit-file (CBN Annexure 1) item status. */
export async function setCreditFileItem(obligorId: string, itemId: string, before: ChecklistStatus | undefined, status: ChecklistStatus): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("credit-admin.credit-file.update.before", { obligorId, itemId, status, actor });
  if (!hook.ok) return blocked(hook);
  useCreditAdminStore.getState().setFileItem(obligorId, itemId, { status, byName: actor.name, at: demoNowIso() });
  auditAs(actor, status === "met" ? "Filed credit-file item" : "Marked credit-file item outstanding", "Credit file", obligorId, `${itemId}: ${before}`, `${itemId}: ${status}`);
  publish("credit-admin.credit-file.updated", { module: MODULE, subject: { type: "CreditFile", id: obligorId, href: `/credit-admin/credit-files/` }, payload: { itemId, before, after: status } });
  await runHooks("credit-admin.credit-file.update.after", { obligorId, itemId, status });
  return { ok: true, message: `${itemId} updated.` };
}
