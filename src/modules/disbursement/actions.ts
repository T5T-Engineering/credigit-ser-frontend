"use client";

/**
 * Disbursement state changes (PRD §4.1 / §4.2). The Maker's submission creates an Operations request whose
 * Checker step authorises it (see ./platform.ts). Hooks: disbursement.prepare.before/after.
 * BACKEND SEAM: replace the store writes with API mutations; authorisation posts to the CBA connector (§5.1).
 */
import { money } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { cancelOperation, decideOperation, submitOperation } from "@/lib/platform/operations";
import { currentActor } from "@/lib/platform/scope";
import { auditAs } from "../credit-admin/common";
import { recordStepUp, type AuthorisePayload } from "./platform";
import { useDisbursementStore, type Disbursement } from "./store";

export type ActionResult = { ok: true; message: string } | { ok: false; reason: string };

/** Maker submits a prepared disbursement for Checker authorisation. */
export async function prepareDisbursement(request: Disbursement, applicationId: string | undefined): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("disbursement.prepare.before", { request, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const d = hook.ctx.request;
  const store = useDisbursementStore.getState();
  store.saveRequest(d);
  const res = await submitOperation<AuthorisePayload>("disbursement.authorise", {
    title: `Authorise ${d.id} — ${money(d.amount, d.currency)} to ${d.accountName} (${d.facilityId})`,
    subject: { type: "Disbursement", id: d.id, title: `${d.id} · ${money(d.amount, d.currency)}`, href: `/disbursement/?facility=${d.facilityId}` },
    payload: { requestId: d.id, snapshot: d, facilityId: d.facilityId, applicationId },
    summary: [
      { label: "Facility", value: d.facilityId },
      { label: "Amount", value: money(d.amount, d.currency) },
      { label: "Beneficiary", value: `${d.accountName} · ${d.accountNumber}` },
      { label: "Value date", value: d.valueDate.slice(0, 10) },
      { label: "Narration", value: d.narration },
    ],
  });
  if (!res.ok) {
    useDisbursementStore.setState((s) => ({ requests: Object.fromEntries(Object.entries(s.requests).filter(([id]) => id !== d.id)) }));
    return { ok: false, reason: res.reason };
  }
  if (!res.applied) store.saveRequest({ ...d, operationId: res.instance.id });
  auditAs(actor, "Prepared disbursement", "Disbursement", d.id, undefined, `${money(d.amount, d.currency)} to ${d.accountNumber} (${d.facilityId}) · ${res.instance.id}`);
  publish("disbursement.request.prepared", { module: "disbursement", subject: { type: "Disbursement", id: d.id, href: `/disbursement/?facility=${d.facilityId}` }, payload: { facilityId: d.facilityId, amount: d.amount, operationId: res.instance.id } });
  await runHooks("disbursement.prepare.after", { request: d, instance: res.instance });
  return { ok: true, message: `Disbursement ${d.id} prepared and sent to a Checker for authorisation (${res.instance.id}).` };
}

/** Checker decision on the Operations step. `stepUpVerified` records a successful OTP for this decision. */
export async function decideDisbursement(operationId: string, decision: "approve" | "return" | "reject", comment: string, stepUpVerified: boolean): Promise<ActionResult> {
  if (stepUpVerified) recordStepUp(operationId, currentActor().id);
  const r = await decideOperation(operationId, decision, comment);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, message: decision === "approve" ? "Authorised — posted to the CBA (simulated); the facility is now Active." : decision === "return" ? "Returned to the Maker with your comment." : "Disbursement rejected." };
}

/** Maker withdraws a request still awaiting authorisation. */
export async function withdrawDisbursement(operationId: string, reason: string): Promise<ActionResult> {
  const r = await cancelOperation(operationId, reason);
  return r.ok ? { ok: true, message: "Request withdrawn." } : { ok: false, reason: r.reason };
}
