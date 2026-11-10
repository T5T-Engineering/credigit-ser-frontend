"use client";

/**
 * Loan Review & Monitoring commands (PRD §6.4). Every state change here: hook points (before can veto), store update,
 * audit log, domain event, notification. Approvals (resolution sign-off, manual escalation, guarantee release) are
 * submitted to the Operations workflow; their `apply` handlers (platform.ts) call back into this file.
 * BACKEND SEAM: each function becomes an API command; keep the signatures.
 */
import { addMonths } from "date-fns";
import { useDb } from "@/lib/data/store";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { submitOperation } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import { currentActor, type Actor } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { dateTime, moneyShort } from "@/lib/format";
import { auditAs } from "./audit";
import type { Apg, Covenant, Tod } from "./data";
import { addBusinessDays, daysBetween, evidenceRequired, ladderRoles, rolesUpTo, slaBusinessDays, type EscalationLevel } from "./logic";
import type { ApgReleasePayload, EscalatePayload, ResolvePayload } from "./platform";
import { useMonitoring, type MonitoringException } from "./store";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

const M = "monitoring";
const get = (id: string) => useMonitoring.getState().exceptions.find((x) => x.id === id);
const obligorName = (id: string) => useDb.getState().obligors.find((o) => o.id === id)?.name ?? id;
export const exceptionHref = (id: string) => `/monitoring/exceptions?id=${encodeURIComponent(id)}`;
const subjectOf = (e: MonitoringException) => ({ type: "Exception", id: e.id, title: `${e.id} · ${e.type}`, href: exceptionHref(e.id) });

/** True when the exception's cure SLA has lapsed. */
export function slaLapsed(e: MonitoringException, now = new Date()): boolean {
  return e.status !== "Resolved" && new Date(e.slaDueAt) < now;
}

// TD-604: per-template recipient roles outside the ladder are code lists.
function notifyLevel(e: MonitoringException, templateId: string, roles: RoleId[], data: Record<string, unknown>) {
  notify({
    templateId,
    toRoles: roles,
    toUserIds: e.assigneeId ? [e.assigneeId] : undefined,
    href: exceptionHref(e.id),
    data: { exceptionId: e.id, type: e.type, obligor: obligorName(e.obligorId), amount: e.amount ? moneyShort(e.amount) : "—", ...data },
  });
}

/* ---------------- Raise ---------------- */

export type RaiseInput = Omit<MonitoringException, "id" | "history" | "comments" | "level" | "status" | "slaDueAt" | "raisedAt">;

export async function raiseException(input: RaiseInput, actor: Actor = currentActor()): Promise<Result<{ exception: MonitoringException }>> {
  const minDetail = getRule<number>("monitoring.exceptions.minDetailLength");
  if (input.detail.trim().length < minDetail) return { ok: false, reason: `Describe the exception in at least ${minDetail} characters.` };
  const before = await runHooks("monitoring.exception.raise.before", { input, actor });
  if (!before.ok) return { ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` };
  const ex = useMonitoring.getState().raise({ ...before.ctx.input, by: input.source === "Rule" ? "Rules engine" : actor.name });
  auditAs(actor, { action: "Raised exception", entityType: "Exception", entityId: ex.id, after: `${ex.type} · Level 1 · ${ex.facilityId ?? ex.collateralId ?? ex.obligorId}` });
  publish("monitoring.exception.raised", { module: M, subject: subjectOf(ex), payload: { type: ex.type, obligorId: ex.obligorId, facilityId: ex.facilityId, collateralId: ex.collateralId, amount: ex.amount, source: ex.source } });
  notifyLevel(ex, "monitoring.exception-raised", ladderRoles(1, ex.amount), { detail: ex.detail, slaDue: dateTime(ex.slaDueAt) });
  await runHooks("monitoring.exception.raise.after", { exception: ex, actor });
  return { ok: true, exception: ex };
}

/* ---------------- Escalate ---------------- */

/** Move an exception up one level (or re-notify at Level 4). Called by the SLA sweep and by the approved manual escalation. */
export async function escalateException(id: string, opts: { reason: string; actor?: Actor; operationId?: string; automatic?: boolean }): Promise<Result> {
  const e = get(id);
  if (!e) return { ok: false, reason: "Exception not found." };
  if (e.status === "Resolved") return { ok: false, reason: "Exception is already cured." };
  const actor = opts.actor ?? currentActor();
  const hook = await runHooks("monitoring.exception.escalate.before", { exception: e, reason: opts.reason, actor, automatic: !!opts.automatic });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const to = (e.level >= 4 ? 4 : e.level + 1) as EscalationLevel;
  const slaDueAt = addBusinessDays(new Date(), slaBusinessDays(to)).toISOString();
  const by = opts.automatic ? "Escalation protocol" : actor.name;
  const roles = ladderRoles(to, e.amount);
  const action =
    e.level >= 4
      ? `Level 4 — re-timestamped and re-notified (remains open until cured)${opts.operationId ? ` · ${opts.operationId}` : ""}`
      : `${opts.reason} — Level ${to} notified${opts.operationId ? ` · ${opts.operationId}` : ""}`;
  useMonitoring.getState().patchException(id, { level: to, status: "Escalated", slaDueAt }, { by, action, level: to, status: "Escalated" });
  auditAs(actor, { action: e.level >= 4 ? "Re-notified exception at Level 4" : "Escalated exception", entityType: "Exception", entityId: id, before: `Level ${e.level}`, after: `Level ${to} · ${opts.reason}` });
  const after = get(id)!;
  publish("monitoring.exception.escalated", { module: M, subject: subjectOf(after), payload: { from: e.level, to, reason: opts.reason, automatic: !!opts.automatic, operationId: opts.operationId } });
  notifyLevel(after, "monitoring.exception-escalated", roles, { level: String(to), reason: opts.reason, age: String(Math.max(0, daysBetween(e.raisedAt, new Date()))), slaDue: dateTime(slaDueAt) });
  await runHooks("monitoring.exception.escalate.after", { exception: after, actor });
  return { ok: true };
}

/** Escalate every exception whose SLA lapsed (the protocol — no approval). */
export async function runEscalationSweep(actor: Actor = currentActor()): Promise<{ escalated: number; held: number }> {
  const due = useMonitoring.getState().exceptions.filter((e) => slaLapsed(e));
  let escalated = 0;
  for (const e of due) {
    const r = await escalateException(e.id, { reason: `Level ${e.level} SLA lapsed uncured`, actor, automatic: true });
    if (r.ok) escalated++;
  }
  auditAs(actor, { action: "Ran escalation sweep", entityType: "Exception", entityId: "-", after: `${escalated} escalated / re-notified, ${due.length - escalated} held` });
  publish("monitoring.escalation.swept", { module: M, payload: { escalated, held: due.length - escalated } });
  return { escalated, held: due.length - escalated };
}

/** Manual (out-of-cycle) escalation — routed through Operations for sign-off. */
export async function requestEscalation(id: string, reason: string): Promise<Result<{ operationId: string }>> {
  const e = get(id);
  if (!e) return { ok: false, reason: "Exception not found." };
  const min = getRule<number>("monitoring.exceptions.minReasonLength");
  if (reason.trim().length < min) return { ok: false, reason: `Give a reason of at least ${min} characters.` };
  const to = Math.min(4, e.level + 1);
  const res = await submitOperation<EscalatePayload>("monitoring.exception.escalate", {
    title: `${e.level >= 4 ? "Re-notify Level 4" : `Escalate to Level ${to}`}: ${e.id} — ${obligorName(e.obligorId)}`,
    subject: subjectOf(e),
    payload: { exceptionId: id, reason: reason.trim() },
    summary: [
      { label: "Exception", value: `${e.id} · ${e.type}` },
      { label: "Obligor", value: obligorName(e.obligorId) },
      { label: "Level", value: `${e.level} → ${to}` },
      { label: "Reason", value: reason.trim() },
    ],
  });
  if (!res.ok) return res;
  if (!res.applied) {
    useMonitoring.getState().patchException(id, {}, { by: currentActor().name, action: `Manual escalation requested — awaiting sign-off (${res.instance.id})` });
    auditAs(undefined, { action: "Requested manual escalation", entityType: "Exception", entityId: id, after: `${res.instance.id} · ${reason.trim()}` });
  }
  return { ok: true, operationId: res.instance.id };
}

/* ---------------- Resolve (cure with evidence, sign-off via Operations) ---------------- */

export async function requestResolution(id: string, evidence: string, note?: string): Promise<Result<{ operationId: string; applied: boolean }>> {
  const e = get(id);
  if (!e) return { ok: false, reason: "Exception not found." };
  const min = getRule<number>("monitoring.exceptions.minEvidenceLength");
  if (evidenceRequired(e.type) && evidence.trim().length < min) return { ok: false, reason: `Curing evidence is mandatory for ${e.type.toLowerCase()} exceptions (at least ${min} characters).` };
  const actor = currentActor();
  const hook = await runHooks("monitoring.exception.resolve.before", { exception: e, evidence, note, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const ev = hook.ctx.evidence.trim() || "No evidence (non-regulatory type)";
  const res = await submitOperation<ResolvePayload>("monitoring.exception.resolve", {
    title: `Close as cured: ${e.id} — ${obligorName(e.obligorId)}`,
    subject: subjectOf(e),
    payload: { exceptionId: id, evidence: ev, note: hook.ctx.note },
    summary: [
      { label: "Exception", value: `${e.id} · ${e.type}` },
      { label: "Obligor", value: obligorName(e.obligorId) },
      { label: "Level", value: String(e.level) },
      { label: "Evidence", value: ev },
      ...(hook.ctx.note ? [{ label: "Note", value: hook.ctx.note }] : []),
    ],
  });
  if (!res.ok) return res;
  if (!res.applied) {
    useMonitoring.getState().patchException(id, {}, { by: actor.name, action: `Curing evidence submitted for sign-off: ${ev} (${res.instance.id})` });
    auditAs(actor, { action: "Submitted exception resolution for sign-off", entityType: "Exception", entityId: id, before: e.status, after: `${res.instance.id} · ${ev}` });
    publish("monitoring.exception.resolution-requested", { module: M, subject: subjectOf(e), payload: { operationId: res.instance.id, evidence: ev } });
  }
  return { ok: true, operationId: res.instance.id, applied: res.applied };
}

/** Operations `apply` — the resolution was signed off. */
export async function applyResolution(p: ResolvePayload, actor: Actor, operationId: string) {
  const e = get(p.exceptionId);
  if (!e || e.status === "Resolved") return;
  const at = new Date().toISOString();
  useMonitoring.getState().patchException(e.id, { status: "Resolved", evidence: { name: p.evidence, at, by: actor.name, note: p.note } }, { by: actor.name, action: `Cured — evidence signed off: ${p.evidence} (${operationId})`, status: "Resolved" });
  auditAs(actor, { action: "Resolved exception with evidence (signed off)", entityType: "Exception", entityId: e.id, before: e.status, after: `Resolved · ${p.evidence} · ${operationId}` });
  const after = get(e.id)!;
  publish("monitoring.exception.resolved", { module: M, subject: subjectOf(after), payload: { evidence: p.evidence, level: e.level, operationId } });
  notifyLevel(after, "monitoring.exception-resolved", rolesUpTo(e.level, e.amount), { evidence: p.evidence, level: String(e.level), approvedBy: actor.name });
  await runHooks("monitoring.exception.resolve.after", { exception: after, actor });
}

export function resolutionRejected(p: ResolvePayload, actor: Actor, operationId: string) {
  const e = get(p.exceptionId);
  if (!e) return;
  useMonitoring.getState().patchException(e.id, {}, { by: actor.name, action: `Resolution sign-off rejected (${operationId}) — exception stays open` });
  auditAs(actor, { action: "Rejected exception resolution", entityType: "Exception", entityId: e.id, after: operationId });
}

/* ---------------- Status, comments ---------------- */

export function changeExceptionStatus(id: string, to: "Raised" | "Under review") {
  const e = get(id);
  if (!e || e.status === to) return;
  const actor = currentActor();
  const reopened = e.status === "Resolved";
  useMonitoring.getState().patchException(
    id,
    { status: to, ...(reopened ? { evidence: undefined, slaDueAt: addBusinessDays(new Date(), slaBusinessDays(e.level)).toISOString() } : {}) },
    { by: actor.name, action: reopened ? "Re-opened" : `Moved to ${to}`, status: to },
  );
  auditAs(actor, { action: reopened ? "Re-opened exception" : "Changed exception status", entityType: "Exception", entityId: id, before: e.status, after: to });
  publish("monitoring.exception.status-changed", { module: M, subject: subjectOf(e), payload: { from: e.status, to } });
}

export function commentOnException(id: string, body: string, roleName?: string) {
  const actor = currentActor();
  useMonitoring.getState().comment(id, { authorName: actor.name, authorRole: roleName, body });
  auditAs(actor, { action: "Commented on exception", entityType: "Exception", entityId: id, after: body.slice(0, 120) });
  const e = get(id);
  if (e) publish("monitoring.exception.commented", { module: M, subject: subjectOf(e), payload: { length: body.length } });
}

/* ---------------- Covenants ---------------- */

const frequencyMonths: Record<Covenant["frequency"], number> = { Monthly: 1, Quarterly: 3, "Semi-annual": 6, Annual: 12 };

export async function recordCovenantTest(
  covenant: Pick<Covenant, "id" | "facilityId" | "obligorId" | "text" | "status" | "frequency" | "nextTestAt" | "ownerRole">,
  input: { outcome: "pass" | "fail"; evidence: string; note: string },
): Promise<Result> {
  const actor = currentActor();
  const hook = await runHooks("monitoring.covenant.test.before", { covenant, ...input, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const { outcome, evidence, note } = hook.ctx;
  const status = outcome === "pass" ? "Compliant" : "Breached";
  const result = outcome === "pass" ? `Passed${note ? ` — ${note}` : ""}` : `Failed — ${note || "covenant not met"}`;
  const nextTestAt = outcome === "pass" ? addMonths(new Date(), frequencyMonths[covenant.frequency]).toISOString() : covenant.nextTestAt;
  useMonitoring.getState().recordCovenantTest(covenant.id, { status, at: new Date().toISOString(), by: actor.name, result, evidence, nextTestAt });
  auditAs(actor, { action: "Recorded covenant test", entityType: "Covenant", entityId: covenant.id, before: covenant.status, after: `${status} · evidence: ${evidence || "—"}` });
  const subject = { type: "Covenant", id: covenant.id, title: covenant.text, href: "/monitoring/covenants" };
  publish("monitoring.covenant.tested", { module: M, subject, payload: { status, result, evidence } });
  if (outcome === "fail") {
    publish("monitoring.covenant.breached", { module: M, subject, payload: { facilityId: covenant.facilityId, obligorId: covenant.obligorId, result } });
    notify({
      templateId: "monitoring.covenant-breached",
      toRoles: [...new Set([covenant.ownerRole as RoleId, ...ladderRoles(1)])],
      href: "/monitoring/covenants",
      data: { obligor: obligorName(covenant.obligorId), facilityId: covenant.facilityId, covenant: covenant.text, result, evidence: evidence || "—", testedBy: actor.name },
    });
  }
  await runHooks("monitoring.covenant.test.after", { covenant, status, result, actor });
  return { ok: true };
}

/** Periodic financials received and analysed (PRD §6.4.5). */
export function recordPeriodicFinancials(obligorId: string, type: string, before: string) {
  const actor = currentActor();
  const nextTestAt = new Date(Date.now() + getRule<number>("monitoring.periodic.nextDueDays") * 864e5).toISOString();
  useMonitoring.getState().recordCovenantTest(`PR-${obligorId}`, { status: "Compliant", at: new Date().toISOString(), by: actor.name, result: `${type} received and analysed`, nextTestAt });
  auditAs(actor, { action: "Recorded periodic financials", entityType: "Obligor", entityId: obligorId, before, after: `Received · ${type}` });
  publish("monitoring.covenant.tested", { module: M, subject: { type: "Obligor", id: obligorId, href: "/monitoring/covenants?tab=periodic" }, payload: { kind: "periodic", type } });
}

/* ---------------- Guarantees & temporary overdrafts ---------------- */

export function setApgStatus(apg: Apg, status: "Crystallised" | "Called", note?: string) {
  const actor = currentActor();
  useMonitoring.getState().setApg(apg.id, { status, by: actor.name, note });
  auditAs(actor, { action: status === "Called" ? "Recorded call on guarantee" : "Confirmed advance payment received", entityType: "APG", entityId: apg.id, before: apg.status, after: status });
  publish("monitoring.apg.status-changed", { module: M, subject: { type: "APG", id: apg.id, href: "/monitoring/guarantees" }, payload: { from: apg.status, to: status } });
}

/** Guarantee release removes contingent exposure — routed through Operations. */
export async function requestApgRelease(apg: Apg, note: string): Promise<Result<{ operationId: string }>> {
  const min = getRule<number>("monitoring.exceptions.minReasonLength");
  if (note.trim().length < min) return { ok: false, reason: `Give a reason of at least ${min} characters.` };
  const res = await submitOperation<ApgReleasePayload>("monitoring.apg.release", {
    title: `Release guarantee ${apg.id} — ${obligorName(apg.obligorId)}`,
    subject: { type: "APG", id: apg.id, title: `${apg.id} · ${apg.beneficiary}`, href: "/monitoring/guarantees" },
    payload: { apgId: apg.id, note: note.trim(), before: apg.status },
    summary: [
      { label: "Guarantee", value: apg.id },
      { label: "Beneficiary", value: apg.beneficiary },
      { label: "Amount", value: moneyShort(apg.amount) },
      { label: "Status", value: apg.status },
      { label: "Reason", value: note.trim() },
    ],
  });
  if (!res.ok) return res;
  auditAs(undefined, { action: "Requested guarantee release", entityType: "APG", entityId: apg.id, after: res.instance.id });
  return { ok: true, operationId: res.instance.id };
}

export function applyApgRelease(p: ApgReleasePayload, actor: Actor, operationId: string) {
  useMonitoring.getState().setApg(p.apgId, { status: "Released", by: actor.name, note: `${p.note} (${operationId})` });
  auditAs(actor, { action: "Released guarantee (approved)", entityType: "APG", entityId: p.apgId, before: p.before, after: `Released · ${operationId}` });
  publish("monitoring.apg.released", { module: M, subject: { type: "APG", id: p.apgId, href: "/monitoring/guarantees" }, payload: { operationId } });
}

export function setTodStatus(tod: Tod, status: "Regularised" | "Converted to facility", note?: string) {
  const actor = currentActor();
  useMonitoring.getState().setTod(tod.id, { status, by: actor.name, note });
  auditAs(actor, { action: status === "Regularised" ? "Marked TOD regularised" : "Recorded conversion to an approved facility", entityType: "Temporary overdraft", entityId: tod.id, before: tod.status, after: status });
  publish("monitoring.tod.status-changed", { module: M, subject: { type: "Temporary overdraft", id: tod.id, href: "/monitoring/guarantees" }, payload: { from: tod.status, to: status } });
}

/* ---------------- Facility monitoring ---------------- */

export function assignFacility(facilityId: string, userId: string) {
  const actor = currentActor();
  const users = useDb.getState().users;
  const current = useMonitoring.getState().assignments[facilityId];
  useMonitoring.getState().assign(facilityId, userId);
  auditAs(actor, { action: "Assigned monitoring officer", entityType: "Facility", entityId: facilityId, before: current ? users.find((u) => u.id === current)?.name : "Unassigned", after: users.find((u) => u.id === userId)?.name });
  publish("monitoring.facility.assigned", { module: M, subject: { type: "Facility", id: facilityId, href: "/monitoring" }, payload: { userId } });
}

export function addFacilityNote(facilityId: string, body: string) {
  const actor = currentActor();
  useMonitoring.getState().addNote(facilityId, { by: actor.name, body });
  auditAs(actor, { action: "Added monitoring note", entityType: "Facility", entityId: facilityId, after: body.slice(0, 120) });
  publish("monitoring.facility.noted", { module: M, subject: { type: "Facility", id: facilityId, href: "/monitoring" } });
}

export function signOffAiFlag(key: string, decision: "accepted" | "dismissed") {
  const actor = currentActor();
  useMonitoring.getState().signOffAi(key, actor.name, decision);
  auditAs(actor, { action: decision === "accepted" ? "Signed off AI flag" : "Dismissed AI flag", entityType: "AI output", entityId: key, after: decision === "accepted" ? "Accepted — exceptions raised" : "Dismissed" });
  publish("monitoring.ai-flag.signed-off", { module: M, subject: { type: "AI output", id: key, href: "/monitoring/covenants?tab=inflows" }, payload: { decision } });
}
