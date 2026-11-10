"use client";

/**
 * Collateral & legal commands (PRD §6.5, §5.7). Every state change: hook points, store update, audit log, domain event,
 * notification where relevant. Approvals — Middle Office valuation verification, legal sufficiency sign-off, perfection
 * completion, margin-call release — go through the Operations workflow; their `apply` handlers call back into here.
 * BACKEND SEAM: each function becomes an API command.
 */
import { addMonths } from "date-fns";
import { newId, useDb } from "@/lib/data/store";
import type { Collateral, CollateralType, PerfectionStatus } from "@/lib/data/types";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { submitOperation, useOperationsStore, type OperationInstance } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import { currentActor, type Actor } from "@/lib/platform/scope";
import { date, money, moneyShort, pct } from "@/lib/format";
import { auditAs } from "@/modules/monitoring/audit";
import { applyResolution, raiseException } from "@/modules/monitoring/service";
import { useMonitoring } from "@/modules/monitoring/store";
import type { LegalRecord, ValuationEntry } from "./data";
import { haircutFor, type CollateralAlert } from "./logic";
import type { LegalSignoffPayload, MarginReleasePayload, PerfectionPayload, VerifyPayload } from "./platform";
import { useCollateralStore, type CollateralView } from "./store";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

const M = "collateral";
export const collateralHref = (id: string, tab?: string) => `/collateral/item?id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ""}`;
const subject = (c: Pick<Collateral, "id" | "type">, tab?: string) => ({ type: "Collateral", id: c.id, title: `${c.id} · ${c.type}`, href: collateralHref(c.id, tab) });
const getCollateral = (id: string) => useDb.getState().collateral.find((c) => c.id === id);
const obligorName = (id: string) => useDb.getState().obligors.find((o) => o.id === id)?.name ?? id;
const minText = () => getRule<number>("collateral.legal.minOpinionLength");

function setPerfectionRaw(c: Pick<Collateral, "id" | "perfection">, to: PerfectionStatus, actor: Actor, action: string) {
  useDb.getState().update("collateral", c.id, { perfection: to });
  auditAs(actor, { action, entityType: "Collateral", entityId: c.id, before: c.perfection, after: to });
}

/* ---------------- Register ---------------- */

export function registerCollateral(input: { facilityId: string; type: CollateralType; description: string; marketValue: number; forcedSaleValue: number; valuer: string }): Result<{ id: string }> {
  const db = useDb.getState();
  const fac = db.facilities.find((f) => f.id === input.facilityId);
  if (!fac) return { ok: false, reason: "Choose a live facility." };
  const actor = currentActor();
  const id = newId("COL");
  const c: Collateral = {
    id,
    obligorId: fac.obligorId,
    type: input.type,
    description: input.description.trim(),
    marketValue: input.marketValue,
    forcedSaleValue: input.forcedSaleValue,
    haircutPct: haircutFor({ type: input.type, description: input.description }).pct,
    valuedAt: new Date().toISOString(),
    valuer: input.valuer.trim(),
    nextRevaluation: addMonths(new Date(), getRule<number>("collateral.revaluation.cycleMonths")).toISOString(),
    perfection: "Not started",
    facilityIds: [fac.id],
    location: db.obligors.find((o) => o.id === fac.obligorId)?.state,
  };
  db.upsert("collateral", c);
  db.update("facilities", fac.id, { collateralIds: [...fac.collateralIds, id] });
  auditAs(actor, { action: "Registered collateral", entityType: "Collateral", entityId: id, after: `${c.type} · ${moneyShort(c.marketValue)} · linked to ${fac.id}` });
  publish("collateral.collateral.registered", { module: M, subject: subject(c), payload: { facilityId: fac.id, type: c.type, marketValue: c.marketValue } });
  return { ok: true, id };
}

/* ---------------- Valuation → Middle Office verification (Operations) ---------------- */

async function submitVerification(c: Collateral, p: VerifyPayload): Promise<Result<{ operationId: string }>> {
  const res = await submitOperation<VerifyPayload>("collateral.valuation.verify", {
    title: `Verify valuation: ${c.id} — ${obligorName(c.obligorId)}`,
    subject: subject(c, "valuation"),
    payload: p,
    summary: [
      { label: "Collateral", value: `${c.id} · ${c.type}` },
      { label: "Obligor", value: obligorName(c.obligorId) },
      { label: "Market value", value: money(p.marketValue) },
      { label: "Forced-sale value", value: money(p.forcedSaleValue) },
      { label: "Valuer", value: p.valuer },
      ...(p.reference ? [{ label: "Report reference", value: p.reference }] : []),
    ],
  });
  if (!res.ok) return res;
  return { ok: true, operationId: res.instance.id };
}

export async function recordValuation(
  c: Collateral,
  input: { marketValue: number; forcedSaleValue?: number; valuer: string; basis?: string; assumptions?: string; reference?: string },
): Promise<Result<{ operationId: string }>> {
  const actor = currentActor();
  const hook = await runHooks("collateral.valuation.record.before", { collateral: c, input, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const v = hook.ctx.input;
  const shares = c.type === "Quoted shares";
  // Quoted shares: no FSV — the PRD §6.7.3 haircut stands in for the forced-sale discount.
  const fsv = shares ? Math.round(v.marketValue * (1 - haircutFor(c).pct / 100)) : (v.forcedSaleValue ?? 0);
  const valuer = shares ? "CSCS market data" : v.valuer;
  const now = new Date().toISOString();
  const entry: ValuationEntry = {
    id: newId("VAL"),
    at: now,
    marketValue: v.marketValue,
    forcedSaleValue: fsv,
    valuer,
    basis: v.basis || getRule<string[]>("collateral.valuation.bases")[0] || "—",
    assumptions: v.assumptions || "As stated in the valuation report",
    fsvMethod: shares ? "Haircut applied per PRD §6.7.3" : "Per valuer's report",
    reference: v.reference || "—",
    source: "Recorded in prototype",
  };
  useCollateralStore.getState().addValuation(c.id, entry);
  useDb.getState().update("collateral", c.id, { marketValue: v.marketValue, forcedSaleValue: fsv, valuedAt: now, valuer, nextRevaluation: addMonths(new Date(), getRule<number>("collateral.revaluation.cycleMonths")).toISOString() });
  useCollateralStore.getState().setVerification(c.id, { status: "Pending" });
  auditAs(actor, { action: "Recorded revaluation", entityType: "Collateral", entityId: c.id, before: `${moneyShort(c.marketValue)} / FSV ${moneyShort(c.forcedSaleValue)}`, after: `${moneyShort(v.marketValue)} / FSV ${moneyShort(fsv)} · ${valuer}` });
  publish("collateral.valuation.recorded", { module: M, subject: subject(c, "valuation"), payload: { marketValue: v.marketValue, forcedSaleValue: fsv, valuer } });
  const op = await submitVerification(c, { collateralId: c.id, marketValue: v.marketValue, forcedSaleValue: fsv, valuer, reference: v.reference });
  await runHooks("collateral.valuation.record.after", { collateral: c, entry, actor });
  return op;
}

/** Send the current (unverified) valuation for Middle Office verification — e.g. a valuation recorded before this workflow. */
export async function requestVerification(c: Collateral): Promise<Result<{ operationId: string }>> {
  const res = await submitVerification(c, { collateralId: c.id, marketValue: c.marketValue, forcedSaleValue: c.forcedSaleValue, valuer: c.valuer });
  if (res.ok) auditAs(undefined, { action: "Sent valuation for Middle Office verification", entityType: "Collateral", entityId: c.id, after: res.operationId });
  return res;
}

export function applyVerification(p: VerifyPayload, actor: Actor, operationId: string) {
  const c = getCollateral(p.collateralId);
  if (!c) return;
  useCollateralStore.getState().setVerification(c.id, { status: "Verified", by: actor.name, at: new Date().toISOString(), note: `Verified through Operations (${operationId})` });
  auditAs(actor, { action: "Verified collateral valuation (Middle Office)", entityType: "Collateral", entityId: c.id, before: "Pending", after: `Verified · ${operationId}` });
  publish("collateral.valuation.verified", { module: M, subject: subject(c, "valuation"), payload: { operationId, marketValue: p.marketValue } });
}

export function verificationQueried(p: VerifyPayload, actor: Actor, instance: OperationInstance) {
  const c = getCollateral(p.collateralId);
  if (!c) return;
  const reason = instance.reason || instance.decisions[instance.decisions.length - 1]?.comment || "Queried by Middle Office";
  useCollateralStore.getState().setVerification(c.id, { status: "Queried", by: actor.name, at: new Date().toISOString(), note: reason });
  auditAs(actor, { action: "Queried collateral valuation (Middle Office)", entityType: "Collateral", entityId: c.id, before: "Pending", after: `Queried: ${reason}` });
  publish("collateral.valuation.queried", { module: M, subject: subject(c, "valuation"), payload: { operationId: instance.id, reason } });
  notify({ templateId: "collateral.valuation-queried", toRoles: ["collateral-officer"], toUserIds: [instance.requestedBy.id], href: collateralHref(c.id), data: { collateralId: c.id, obligor: obligorName(c.obligorId), reason, by: actor.name } });
}

/* ---------------- Perfection ---------------- */

export async function advancePerfection(c: Collateral, to: PerfectionStatus, label: string): Promise<Result<{ operationId?: string }>> {
  const actor = currentActor();
  const hook = await runHooks("collateral.perfection.advance.before", { collateral: c, to, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  if (to === "Perfected") {
    const res = await submitOperation<PerfectionPayload>("collateral.perfection.complete", {
      title: `Perfection complete: ${c.id} — ${obligorName(c.obligorId)}`,
      subject: subject(c, "perfection"),
      payload: { collateralId: c.id, from: c.perfection },
      summary: [
        { label: "Collateral", value: `${c.id} · ${c.type}` },
        { label: "Obligor", value: obligorName(c.obligorId) },
        { label: "Current step", value: c.perfection },
      ],
    });
    if (!res.ok) return res;
    if (!res.applied) auditAs(actor, { action: "Requested perfection completion", entityType: "Collateral", entityId: c.id, after: res.instance.id });
    return { ok: true, operationId: res.instance.id };
  }
  setPerfectionRaw(c, to, actor, label);
  publish("collateral.perfection.advanced", { module: M, subject: subject(c, "perfection"), payload: { from: c.perfection, to } });
  await runHooks("collateral.perfection.advance.after", { collateral: c, to, actor });
  return { ok: true };
}

export async function applyPerfectionComplete(p: PerfectionPayload, actor: Actor, operationId: string) {
  const c = getCollateral(p.collateralId);
  if (!c) return;
  setPerfectionRaw(c, "Perfected", actor, `Perfection completed (approved · ${operationId})`);
  publish("collateral.perfection.completed", { module: M, subject: subject(c, "perfection"), payload: { operationId } });
  await runHooks("collateral.perfection.advance.after", { collateral: c, to: "Perfected", actor });
}

export function reportDefect(c: Collateral, reason: string): Result {
  if (reason.trim().length < minText()) return { ok: false, reason: `Describe the defect in at least ${minText()} characters.` };
  const actor = currentActor();
  useDb.getState().update("collateral", c.id, { perfection: "Defective" });
  useCollateralStore.getState().patchLegal(c.id, { genuineness: "Doubtful" });
  auditAs(actor, { action: "Reported perfection defect", entityType: "Collateral", entityId: c.id, before: c.perfection, after: `Defective: ${reason}` });
  publish("collateral.perfection.defect-reported", { module: M, subject: subject(c, "perfection"), payload: { reason } });
  notify({ templateId: "collateral.perfection-defect", toRoles: ["collateral-officer", "credit-admin-officer"], href: collateralHref(c.id, "perfection"), data: { collateralId: c.id, obligor: obligorName(c.obligorId), reason, reportedBy: actor.name } });
  return { ok: true };
}

export function cureDefect(c: Collateral) {
  const actor = currentActor();
  setPerfectionRaw(c, "Documentation", actor, "Defect cured — returned to documentation");
  publish("collateral.perfection.defect-cured", { module: M, subject: subject(c, "perfection") });
}

/* ---------------- Legal review ---------------- */

export function recordSearch(c: Collateral, before: LegalRecord["searchStatus"], result: "Clean" | "Encumbrance found") {
  const actor = currentActor();
  useCollateralStore.getState().patchLegal(c.id, { searchStatus: result, searchAt: new Date().toISOString() });
  auditAs(actor, { action: "Recorded legal search result", entityType: "Collateral", entityId: c.id, before, after: result });
  if (c.perfection === "Not started") setPerfectionRaw(c, "Search in progress", actor, "Perfection started — legal search");
  if (result === "Encumbrance found") setPerfectionRaw({ id: c.id, perfection: "Search in progress" }, "Defective", actor, "Encumbrance found — perfection defective");
  publish("collateral.legal.search-recorded", { module: M, subject: subject(c, "perfection"), payload: { result } });
}

export function confirmGenuineness(c: Collateral, before: LegalRecord["genuineness"]) {
  const actor = currentActor();
  useCollateralStore.getState().patchLegal(c.id, { genuineness: "Confirmed" });
  auditAs(actor, { action: "Confirmed genuineness of security documents", entityType: "Collateral", entityId: c.id, before, after: "Confirmed" });
  publish("collateral.legal.genuineness-confirmed", { module: M, subject: subject(c, "perfection") });
}

export function vaultDocuments(c: Collateral, reference?: string): string {
  const actor = currentActor();
  const ref = reference?.trim() || newId("VLT");
  useCollateralStore.getState().patchLegal(c.id, { vaultRef: ref, vaultedAt: new Date().toISOString() });
  auditAs(actor, { action: "Vaulted security documents", entityType: "Collateral", entityId: c.id, after: ref });
  publish("collateral.legal.vaulted", { module: M, subject: subject(c, "perfection"), payload: { vaultRef: ref } });
  return ref;
}

export function checkOutDocuments(c: Collateral, vaultRef: string | undefined, purpose: string) {
  const actor = currentActor();
  useCollateralStore.getState().patchLegal(c.id, { checkedOut: { by: actor.name, at: new Date().toISOString(), purpose } });
  auditAs(actor, { action: "Checked out vaulted documents", entityType: "Collateral", entityId: c.id, after: `${vaultRef ?? "—"} · ${purpose}` });
  publish("collateral.legal.checked-out", { module: M, subject: subject(c, "perfection"), payload: { purpose, out: true } });
}

export function returnDocuments(c: Collateral, vaultRef: string | undefined) {
  const actor = currentActor();
  useCollateralStore.getState().patchLegal(c.id, { checkedOut: undefined });
  auditAs(actor, { action: "Returned documents to vault", entityType: "Collateral", entityId: c.id, after: vaultRef });
  publish("collateral.legal.checked-out", { module: M, subject: subject(c, "perfection"), payload: { out: false } });
}

/** Legal Officer's sufficiency opinion — accepted through Operations before it is recorded. */
export async function requestLegalSignoff(c: Collateral, opinion: string): Promise<Result<{ operationId: string }>> {
  if (opinion.trim().length < minText()) return { ok: false, reason: `Write the opinion in at least ${minText()} characters.` };
  const actor = currentActor();
  const hook = await runHooks("collateral.legal.signoff.before", { collateral: c, opinion, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const res = await submitOperation<LegalSignoffPayload>("collateral.legal.signoff", {
    title: `Legal sufficiency: ${c.id} — ${obligorName(c.obligorId)}`,
    subject: subject(c, "perfection"),
    payload: { collateralId: c.id, opinion: hook.ctx.opinion.trim() },
    summary: [
      { label: "Collateral", value: `${c.id} · ${c.type}` },
      { label: "Obligor", value: obligorName(c.obligorId) },
      { label: "Perfection", value: c.perfection },
      { label: "Opinion", value: hook.ctx.opinion.trim() },
    ],
  });
  if (!res.ok) return res;
  if (!res.applied) auditAs(actor, { action: "Submitted legal sufficiency opinion for acceptance", entityType: "Collateral", entityId: c.id, after: res.instance.id });
  return { ok: true, operationId: res.instance.id };
}

export async function applyLegalSignoff(p: LegalSignoffPayload, actor: Actor, operationId: string) {
  const c = getCollateral(p.collateralId);
  if (!c) return;
  const ops = useOperationsStore.getState().instances.find((i) => i.id === operationId);
  const by = ops?.requestedBy.name ?? actor.name;
  useCollateralStore.getState().patchLegal(c.id, { signOff: { by: `${by} (accepted by ${actor.name})`, at: new Date().toISOString(), opinion: p.opinion } });
  auditAs(actor, { action: "Legal sufficiency sign-off accepted", entityType: "Collateral", entityId: c.id, after: `${p.opinion} · ${operationId}` });
  publish("collateral.legal.signed-off", { module: M, subject: subject(c, "perfection"), payload: { operationId } });
  await runHooks("collateral.legal.signoff.after", { collateral: c, opinion: p.opinion, actor });
}

/* ---------------- Insurance & documents ---------------- */

export function recordInsuranceRenewal(c: Collateral, before: string | undefined, expiry: string) {
  const actor = currentActor();
  useCollateralStore.getState().renewInsurance(c.id, { expiry: new Date(expiry).toISOString(), by: actor.name });
  auditAs(actor, { action: "Recorded insurance renewal", entityType: "Collateral", entityId: c.id, before: before ? date(before) : "—", after: date(expiry) });
  publish("collateral.insurance.renewed", { module: M, subject: subject(c, "perfection"), payload: { expiry } });
}

export function uploadDocuments(c: Collateral, files: { name: string; size: number }[]) {
  const actor = currentActor();
  for (const f of files) {
    useDb.getState().upsert("documents", {
      id: newId("DOC"),
      ownerType: "collateral",
      ownerId: c.id,
      name: f.name,
      kind: /valu/i.test(f.name) ? "Valuation report" : "Title document",
      sizeKb: Math.max(1, Math.round(f.size / 1024)),
      version: 1,
      uploadedById: actor.id,
      uploadedAt: new Date().toISOString(),
      status: "Processing OCR",
    });
    auditAs(actor, { action: "Uploaded collateral document", entityType: "Collateral", entityId: c.id, after: f.name });
    publish("collateral.document.uploaded", { module: M, subject: subject(c, "documents"), payload: { name: f.name } });
  }
}

/** Send insurance / revaluation reminders for alerts not yet reminded (dedupe per alert). */
export function sendReminders(alerts: CollateralAlert[], view: Pick<CollateralView, "id" | "description" | "obligorId">[]): number {
  const sent = useCollateralStore.getState().reminders;
  const byId = new Map(view.map((v) => [v.id, v]));
  const due = alerts.filter((a) => !sent[a.id] && ["Insurance expired", "Insurance expiring soon", "Revaluation overdue", "Revaluation due soon"].includes(a.kind));
  for (const a of due) {
    const c = byId.get(a.collateralId);
    const base = { collateralId: a.collateralId, description: c?.description ?? "", obligor: obligorName(a.obligorId) };
    if (a.kind.startsWith("Insurance"))
      notify({ templateId: "collateral.insurance-expiring", toRoles: ["collateral-officer", "credit-admin-officer"], href: collateralHref(a.collateralId, "perfection"), data: { ...base, state: a.kind === "Insurance expired" ? "expired" : "expires", expiry: a.dueAt ? date(a.dueAt) : "—" } });
    else notify({ templateId: "collateral.revaluation-due", toRoles: ["collateral-officer"], href: collateralHref(a.collateralId, "valuation"), data: { ...base, state: a.kind === "Revaluation overdue" ? "was due" : "is due", dueAt: a.dueAt ? date(a.dueAt) : "—" } });
  }
  if (due.length) {
    useCollateralStore.getState().markReminders(due.map((a) => a.id));
    auditAs(undefined, { action: "Sent collateral reminders", entityType: "Collateral", entityId: "-", after: `${due.length} reminder(s)` });
    publish("collateral.reminder.sent", { module: M, payload: { count: due.length } });
  }
  return due.length;
}

/* ---------------- Share collateral: prices & margin calls ---------------- */

export function setSimulatedPrices(next: Record<string, number>) {
  useCollateralStore.getState().setPrices(next);
  const reset = Object.keys(next).length === 0;
  auditAs(undefined, { action: reset ? "Reset simulated share prices to reference close" : "Refreshed share prices (simulated CSCS feed)", entityType: "Connector", entityId: "CON-CSCS", after: reset ? undefined : `${Object.keys(next).length} counters` });
  publish("collateral.prices.refreshed", { module: M, subject: { type: "Connector", id: "CON-CSCS", href: "/collateral/shares" }, payload: { counters: Object.keys(next).length, reset } });
}

export async function raiseMarginCall(r: CollateralView & { obligorName: string; shortfall: number; topUp: number }): Promise<Result<{ exceptionId: string }>> {
  const actor = currentActor();
  const hook = await runHooks("collateral.margin-call.raise.before", { collateral: r, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const threshold = `${getRule<number>("collateral.margin.minCoverPct")}%`;
  const raised = await raiseException(
    {
      type: "Share-collateral margin shortfall",
      title: `Margin call — ${r.ticker}`,
      detail: `${r.obligorName}: haircut-adjusted MTM of ${r.ticker} (${money(r.adjusted)}) covers ${pct(r.cover * 100, 0)} of the ${money(r.exposure)} exposure (threshold ${threshold}). Top-up of ${money(r.topUp)} market value required.`,
      obligorId: r.obligorId,
      facilityId: r.facilityIds[0],
      collateralId: r.id,
      amount: r.shortfall,
      source: "Rule",
    },
    actor,
  );
  if (!raised.ok) return raised;
  const ex = raised.exception;
  useCollateralStore.getState().recordMarginCall(r.id, { by: actor.name, exceptionId: ex.id, topUp: r.topUp });
  auditAs(actor, { action: "Raised margin call / top-up request", entityType: "Collateral", entityId: r.id, after: `${ex.id} · top-up ${moneyShort(r.topUp)}` });
  publish("collateral.margin-call.raised", { module: M, subject: subject(r), payload: { exceptionId: ex.id, topUp: r.topUp, cover: r.cover } });
  notify({
    templateId: "collateral.margin-call",
    toRoles: ["collateral-officer", "account-officer", "middle-office-officer", "loan-review-officer"],
    href: "/collateral/shares",
    data: { collateralId: r.id, ticker: r.ticker, obligor: r.obligorName, cover: pct(r.cover * 100, 0), threshold, exposure: moneyShort(r.exposure), topUp: moneyShort(r.topUp), exceptionId: ex.id },
  });
  await runHooks("collateral.margin-call.raise.after", { collateral: r, exceptionId: ex.id, actor });
  return { ok: true, exceptionId: ex.id };
}

/** Release an open margin call once the top-up is received / cover restored — routed through Operations. */
export async function requestMarginRelease(c: Pick<Collateral, "id" | "type" | "obligorId">, evidence: string): Promise<Result<{ operationId: string }>> {
  if (evidence.trim().length < minText()) return { ok: false, reason: `Describe the top-up evidence in at least ${minText()} characters.` };
  const call = useCollateralStore.getState().marginCalls[c.id];
  if (!call || call.releasedAt) return { ok: false, reason: "No open margin call on this collateral." };
  const res = await submitOperation<MarginReleasePayload>("collateral.margin.release", {
    title: `Release margin call: ${c.id} — ${obligorName(c.obligorId)}`,
    subject: subject(c),
    payload: { collateralId: c.id, exceptionId: call.exceptionId, evidence: evidence.trim(), topUp: call.topUp },
    summary: [
      { label: "Collateral", value: c.id },
      { label: "Exception", value: call.exceptionId },
      { label: "Top-up requested", value: moneyShort(call.topUp) },
      { label: "Evidence", value: evidence.trim() },
    ],
  });
  if (!res.ok) return res;
  if (!res.applied) auditAs(undefined, { action: "Requested margin-call release", entityType: "Collateral", entityId: c.id, after: res.instance.id });
  return { ok: true, operationId: res.instance.id };
}

export async function applyMarginRelease(p: MarginReleasePayload, actor: Actor, operationId: string) {
  useCollateralStore.getState().releaseMarginCall(p.collateralId, { by: actor.name, operationId });
  auditAs(actor, { action: "Released margin call (approved)", entityType: "Collateral", entityId: p.collateralId, after: `${p.evidence} · ${operationId}` });
  if (p.exceptionId && useMonitoring.getState().exceptions.some((e) => e.id === p.exceptionId && e.status !== "Resolved"))
    await applyResolution({ exceptionId: p.exceptionId, evidence: p.evidence, note: `Margin call released (${operationId})` }, actor, operationId);
  const c = getCollateral(p.collateralId);
  publish("collateral.margin-call.released", { module: M, subject: c ? subject(c) : { type: "Collateral", id: p.collateralId }, payload: { operationId, exceptionId: p.exceptionId } });
  notify({ templateId: "collateral.margin-call-released", toRoles: ["collateral-officer", "account-officer", "loan-review-officer"], href: "/collateral/shares", data: { collateralId: p.collateralId, obligor: c ? obligorName(c.obligorId) : "—", evidence: p.evidence, approvedBy: actor.name } });
}
