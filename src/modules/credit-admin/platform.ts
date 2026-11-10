"use client";

/**
 * Platform registrations for the credit-admin module (PRD §6.3): business rules, operation types (Operations
 * workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md → Platform services.
 *
 * Approvals routed through Operations:
 *  - "credit-admin.waiver"    Waiver / deferral of an approved condition — approved at the tier that approved the
 *                             facility (or higher), or by Credit Administration within its delegated tolerance (§6.3.2).
 *                             The tier rule is enforced by the hook "credit-admin.waiver-tier-check".
 *  - "credit-admin.sanction"  Sanction for breach → disciplinary / escalation workflow → Operational Risk (§6.3.2).
 *  - "credit-admin.release"   Release of a file for disbursement once every CP is cleared (§6.1.1 step 15).
 *  - "credit-admin.crms-batch" CRMS reporting batch submission (no approval step by default — tenant may add one).
 */
import { useDb } from "@/lib/data/store";
import { date } from "@/lib/format";
import { defineEvents, publish, subscribe } from "@/lib/platform/events";
import { defineHookPoints, registerHook } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, useOperationsStore, type OperationInstance, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, getRule } from "@/lib/platform/rules";
import type { Actor } from "@/lib/platform/scope";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { chartFlow } from "@/lib/workflow";
import { auditAs, demoNowIso, hash } from "./common";
import { canApproveAtTier } from "./logic";
import { useCreditAdminStore, type CrmsBatch, type WaiverRequest } from "./store";

const DEMO = "Tenant parameter (demo value)";
const MODULE = "credit-admin";

// ---------------------------------------------------------------- business rules
defineRules([
  { key: "credit-admin.delegatedMaxDeferralDays", label: "Delegated tolerance — max deferral", description: "Deferrals up to this many days on the delegated condition categories may be approved by Credit Administration.", module: MODULE, category: "Waivers & deferrals", type: "duration", durationUnit: "days", default: 30, min: 0, max: 365, source: "PRD §4.1 (CAD: waivers/deferrals within delegated tolerance) — demo value" },
  { key: "credit-admin.delegatedCategories", label: "Delegated tolerance — condition categories", description: "Condition categories Credit Administration may defer within its delegated tolerance.", module: MODULE, category: "Waivers & deferrals", type: "list", default: ["Documentation", "Fees", "Corporate authorisation"], source: "PRD §4.1 — demo value" },
  { key: "credit-admin.delegatedApproverRoles", label: "Delegated tolerance — approvers", description: "Roles that may approve a request that is within the delegated tolerance.", module: MODULE, category: "Waivers & deferrals", type: "roles", default: ["credit-admin-officer"], source: "PRD §4.1" },
  { key: "credit-admin.waiverReminderDays", label: "Waiver / deferral reminder window", description: "Reminders go out this many days before a waiver or deferral lapses.", module: MODULE, category: "Waivers & deferrals", type: "duration", durationUnit: "days", default: 7, min: 1, max: 90, source: "PRD §6.3.2 (auto-reminds before lapse) — demo value" },
  { key: "credit-admin.defaultDeferralDays", label: "Default deferral period", description: "Pre-filled expiry / deferred-to date on a new request.", module: MODULE, category: "Waivers & deferrals", type: "duration", durationUnit: "days", default: 14, min: 1, max: 365, source: DEMO },
  { key: "credit-admin.minReasonLength", label: "Minimum request reason", description: "Characters required in the reason for a waiver, deferral or sanction.", module: MODULE, category: "Waivers & deferrals", type: "number", unit: "characters", default: 10, min: 1, max: 500, source: DEMO },
  { key: "credit-admin.requesterRoles", label: "Who raises waivers, deferrals and sanctions", description: "Roles that may raise a request against an approved condition.", module: MODULE, category: "Roles", type: "roles", default: ["credit-admin-officer"], source: "PRD §6.3.2 (Credit Administration raises)" },
  { key: "credit-admin.cpConfirmerRoles", label: "Who confirms conditions precedent and releases files", description: "Roles that confirm CPs, request release for disbursement and maintain credit files.", module: MODULE, category: "Roles", type: "roles", default: ["credit-admin-officer"], source: "PRD §4.1 Credit Administration Officer" },
  { key: "credit-admin.crmsRecentWindowDays", label: "CRMS search KPI window", description: "Window for the “searches” and “adverse findings” KPIs on the CRMS desk.", module: MODULE, category: "CRMS", type: "duration", durationUnit: "days", default: 30, min: 1, max: 365, source: DEMO },
  { key: "credit-admin.crmsReportingCadence", label: "CRMS reporting cadence", description: "How often facilities are reported to the CBN CRMS.", module: MODULE, category: "CRMS", type: "enum", default: "monthly", options: [{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Month-end" }], source: "PRD §6.3.3 — cadence not stated; demo value (see OPEN-QUESTIONS CA-OPS-3)" },
  { key: "credit-admin.rarStalenessDays", label: "360 RAR staleness (credit file)", description: "Credit file flags the analysis item when the 360 RAR is older than this.", module: MODULE, category: "Credit files", type: "duration", durationUnit: "days", default: 180, min: 1, max: 730, source: DEMO },
  { key: "credit-admin.callReportStalenessDays", label: "Call report staleness (credit file)", description: "Credit file flags call reports / site visits older than this.", module: MODULE, category: "Credit files", type: "duration", durationUnit: "days", default: 180, min: 1, max: 730, source: DEMO },
]);

// ---------------------------------------------------------------- helpers
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });
const facilityHref = (id: string) => `/credit-admin/facility/?id=${id}`;
const waiverHref = (w: Pick<WaiverRequest, "facilityId">) => `/credit-admin/waivers/?facility=${w.facilityId}`;
/** Every role that can sit on an approving tier (the hook narrows it to the facility's tier). */
const tierRoles = [...new Set(chartFlow.flatMap((t) => t.roles))] as RoleId[];

function saveWaiver(w: WaiverRequest) {
  useCreditAdminStore.getState().saveWaiver(w);
}

function rmOf(facilityId: string): string | undefined {
  const db = useDb.getState();
  const f = db.facilities.find((x) => x.id === facilityId);
  return db.obligors.find((o) => o.id === f?.obligorId)?.relationshipManagerId;
}

function notifyDecision(w: WaiverRequest, outcome: string, by: string, comment: string) {
  const rm = rmOf(w.facilityId);
  notify({
    templateId: "credit-admin.waiver-decided",
    toUserIds: [w.requestedById, ...(rm ? [rm] : [])],
    toRoles: w.kind === "Sanction for breach" && outcome === "routed to Operational Risk" ? ["operational-risk-analyst"] : undefined,
    href: waiverHref(w),
    data: { kind: w.kind, id: w.id, facility: w.facilityId, condition: `${w.conditionId} — ${w.conditionTitle}`, outcome, decidedBy: by, comment: comment || "—", expiry: w.expiryDate ? date(w.expiryDate) : "—" },
  });
}

// ---------------------------------------------------------------- operations
export type WaiverPayload = { waiverId: string; snapshot: WaiverRequest };

registerOperation<WaiverPayload>({
  type: "credit-admin.waiver",
  name: "Waiver / deferral of a condition",
  module: MODULE,
  description: "Waive or defer an approved condition. Approved at the tier that approved the original facility or higher; Credit Administration may approve within its delegated tolerance (PRD §6.3.2, §4.1).",
  defaultSteps: [step("tier", "Approving tier (or delegated tolerance)", [...tierRoles, "credit-admin-officer"], 48)],
  apply: (p, { instance, actor }) => {
    const w = useCreditAdminStore.getState().waivers[p.waiverId] ?? p.snapshot;
    const at = demoNowIso();
    const comment = instance.reason ?? "";
    const delegated = w.withinTolerance && getRule<RoleId[]>("credit-admin.delegatedApproverRoles").includes(actor.roleId);
    saveWaiver({ ...w, status: "Approved", decidedByName: actor.name, decidedAt: at, decisionComment: comment, operationId: instance.id });
    const cpStatus = w.kind === "Waiver" ? "waived" : "deferred";
    useCreditAdminStore.getState().setCp(w.cpKey, w.conditionId, { status: cpStatus, byName: actor.name, at, note: w.kind === "Waiver" ? `Waived under ${w.id}` : `Deferred to ${w.expiryDate ? date(w.expiryDate) : "—"} under ${w.id}` });
    auditAs(actor, `Approved ${w.kind.toLowerCase()}${delegated ? " (within delegated tolerance)" : ""}`, "Waiver", w.id, "Pending approval", "Approved");
    auditAs(actor, `Condition ${cpStatus}`, "Facility", w.facilityId, `${w.conditionId}: pending`, `${w.conditionId}: ${cpStatus}`);
    publish("credit-admin.waiver.approved", { module: MODULE, subject: { type: "Waiver", id: w.id, title: `${w.kind} ${w.id}`, href: waiverHref(w) }, payload: { facilityId: w.facilityId, conditionId: w.conditionId, kind: w.kind, delegated, operationId: instance.id } });
    notifyDecision(w, "approved", actor.name, comment);
  },
  onReject: (p, { instance, actor }) => decline(p.waiverId, p.snapshot, instance, actor, "Declined"),
});

registerOperation<WaiverPayload>({
  type: "credit-admin.sanction",
  name: "Sanction for breach",
  module: MODULE,
  description: "Credit-policy breach (e.g. disbursed with an open CP) routed to the disciplinary / escalation workflow; on approval it is logged as an Operational Risk loss event (PRD §6.3.2, §6.9).",
  defaultSteps: [step("escalation", "Escalation decision", ["head-of-risk", "cro"], 72)],
  apply: (p, { instance, actor }) => {
    const w = useCreditAdminStore.getState().waivers[p.waiverId] ?? p.snapshot;
    const at = demoNowIso();
    // TD-854: loss-event reference is simulated until the Operational Risk register exposes an intake API.
    const ref = `LE-${new Date(at).getFullYear()}-${String(100 + (hash(w.id) % 800))}`;
    saveWaiver({ ...w, status: "Routed to Operational Risk", lossEventRef: ref, decidedByName: actor.name, decidedAt: at, decisionComment: instance.reason ?? "", operationId: instance.id });
    useCreditAdminStore.getState().setCp(w.cpKey, w.conditionId, { status: "breached", byName: actor.name, at, note: `Sanction ${w.id}` });
    auditAs(actor, "Routed sanction for breach to Operational Risk", "Waiver", w.id, "Pending approval", `Loss event ${ref}`);
    publish("credit-admin.sanction.routed", { module: MODULE, subject: { type: "Waiver", id: w.id, title: `Sanction ${w.id}`, href: waiverHref(w) }, payload: { facilityId: w.facilityId, conditionId: w.conditionId, lossEventRef: ref, breachDetail: w.breachDetail, operationId: instance.id } });
    notifyDecision(w, "routed to Operational Risk", actor.name, `Loss event ${ref}. ${instance.reason ?? ""}`.trim());
  },
  onReject: (p, { instance, actor }) => decline(p.waiverId, p.snapshot, instance, actor, "Declined"),
});

function decline(id: string, snapshot: WaiverRequest, instance: OperationInstance, actor: Actor, status: WaiverRequest["status"]) {
  const w = useCreditAdminStore.getState().waivers[id] ?? snapshot;
  saveWaiver({ ...w, status, decidedByName: actor.name, decidedAt: demoNowIso(), decisionComment: instance.reason ?? "", operationId: instance.id });
  auditAs(actor, `${status} ${w.kind.toLowerCase()}`, "Waiver", w.id, "Pending approval", status);
  publish("credit-admin.waiver.declined", { module: MODULE, subject: { type: "Waiver", id: w.id, title: `${w.kind} ${w.id}`, href: waiverHref(w) }, payload: { status, operationId: instance.id } });
  if (status === "Declined") notifyDecision(w, "declined", actor.name, instance.reason ?? "");
}

export type ReleasePayload = { facilityId: string; obligorName: string; amount: string; cleared: string };

registerOperation<ReleasePayload>({
  type: "credit-admin.release",
  name: "Release file for disbursement",
  module: MODULE,
  description: "Credit Administration confirms every condition precedent is met, waived or deferred and releases the file to Domestic Operations (PRD §6.1.1 step 15). Second-person confirmation by default (see OPEN-QUESTIONS CA-OPS-2).",
  defaultSteps: [step("confirm", "Release confirmation", ["credit-admin-officer", "head-of-risk"], 24)],
  apply: (p, { instance, actor }) => {
    const at = demoNowIso();
    useCreditAdminStore.getState().release(p.facilityId, actor.name, at);
    auditAs(actor, "Released file for disbursement", "Facility", p.facilityId, "Conditions cleared — awaiting release", `Released to Domestic Operations (${instance.id})`);
    publish("credit-admin.facility.released", { module: MODULE, subject: { type: "Facility", id: p.facilityId, title: p.obligorName, href: facilityHref(p.facilityId) }, payload: { operationId: instance.id } });
    const rm = rmOf(p.facilityId);
    notify({
      templateId: "credit-admin.file-released",
      toRoles: ["disbursement-maker", "disbursement-checker"],
      toUserIds: [instance.requestedBy.id, ...(rm ? [rm] : [])],
      href: `/disbursement/?facility=${p.facilityId}`,
      data: { facility: p.facilityId, obligor: p.obligorName, amount: p.amount, cleared: p.cleared, releasedBy: actor.name },
    });
  },
});

export type CrmsBatchPayload = { batch: CrmsBatch };

registerOperation<CrmsBatchPayload>({
  type: "credit-admin.crms-batch",
  name: "CRMS reporting batch",
  module: MODULE,
  description: "Submit a batch of facilities to the CBN CRMS (simulated connector). No approval step by default — add one in Workflows if the tenant requires review before submission (PRD §6.3.3).",
  defaultSteps: [],
  apply: (p, { instance, actor }) => {
    const b = { ...p.batch, submittedAt: demoNowIso(), submittedByName: actor.name };
    useCreditAdminStore.getState().saveBatch(b);
    auditAs(actor, "Submitted CRMS batch (simulated)", "CRMS batch", b.id, undefined, `${b.facilityIds.length} facilities (${instance.id})`);
    publish("credit-admin.crms.batch-submitted", { module: MODULE, subject: { type: "CrmsBatch", id: b.id, title: b.label, href: "/credit-admin/crms/" }, payload: { facilities: b.facilityIds.length, operationId: instance.id } });
    notify({ templateId: "credit-admin.crms-batch-submitted", toRoles: ["credit-admin-officer"], toUserIds: [instance.requestedBy.id], href: "/credit-admin/crms/", data: { batch: b.id, label: b.label, count: String(b.facilityIds.length), status: b.status, submittedBy: actor.name } });
  },
});

// Waiver approvals: the decider must sit at the facility's approving tier (or above), unless within delegated tolerance.
registerHook<{ instance: OperationInstance; decision: string; actor: Actor }>({
  id: "credit-admin.waiver-tier-check",
  name: "Credit Admin — waiver approved at the facility's approving tier (PRD §6.3.2)",
  point: "operations.decide.before",
  priority: 10,
  run: ({ instance, actor }) => {
    if (instance.operationType !== "credit-admin.waiver") return;
    const w = (instance.payload as WaiverPayload).snapshot;
    if (canApproveAtTier(actor.roleId, w.approverRoleIds)) return;
    if (w.withinTolerance && getRule<RoleId[]>("credit-admin.delegatedApproverRoles").includes(actor.roleId)) return;
    const need = w.approverRoleIds.map((r) => roleById[r]?.name ?? r).join(" / ");
    return { veto: w.withinTolerance ? `Needs Credit Administration (delegated tolerance) or the ${need} tier.` : `Outside Credit Administration's delegated tolerance — needs the ${need} tier (or higher) that approved the facility.` };
  },
});

// Returned / withdrawn requests: mark the record so the requester can act again.
subscribe({
  id: "credit-admin.on-operation-closed",
  name: "Credit Admin — update records when a request is returned or withdrawn",
  pattern: "operations.request.*",
  handler: (event) => {
    const outcome = event.name.split(".").pop();
    if (outcome !== "returned" && outcome !== "cancelled") return;
    const instance = useOperationsStore.getState().instances.find((i) => i.id === event.subject?.id);
    if (!instance || !["credit-admin.waiver", "credit-admin.sanction"].includes(instance.operationType)) return;
    const last = instance.decisions[instance.decisions.length - 1];
    const by: Actor = outcome === "returned" && last ? { id: last.actorId, name: last.actorName, roleId: last.roleId, tenantId: "-" } : { ...instance.requestedBy, tenantId: "-" };
    const p = instance.payload as WaiverPayload;
    decline(p.waiverId, p.snapshot, instance, by, outcome === "returned" ? "Returned to requester" : "Withdrawn");
  },
});

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "credit-admin.waiver-decided",
    name: "Waiver / deferral / sanction decided",
    module: MODULE,
    trigger: "credit-admin.waiver.approved / declined, credit-admin.sanction.routed",
    subject: "{{kind}} {{id}} {{outcome}}",
    inApp: "{{kind}} {{id}} on {{facility}} ({{condition}}) was {{outcome}} by {{decidedBy}}.",
    body: "<p>The {{kind}} request <strong>{{id}}</strong> on facility <strong>{{facility}}</strong> was <strong>{{outcome}}</strong> by {{decidedBy}}.</p><ul><li>Condition: {{condition}}</li><li>Expiry / deferred to: {{expiry}}</li><li>Comment: {{comment}}</li></ul>",
    tone: "info",
    variables: [
      { name: "kind", description: "Waiver / Deferral / Sanction for breach", example: "Deferral" },
      { name: "id", description: "Request ID", example: "WVR-3103" },
      { name: "facility", description: "Facility ID", example: "FAC-10021" },
      { name: "condition", description: "Condition", example: "CP-11 — Perfection of legal mortgage" },
      { name: "outcome", description: "approved / declined / routed to Operational Risk", example: "approved" },
      { name: "decidedBy", description: "Decision maker", example: "Chinedu Okafor" },
      { name: "comment", description: "Decision comment", example: "Track to expiry." },
      { name: "expiry", description: "Expiry / deferred-to date", example: "1 Dec 2026" },
    ],
  }),
  tpl({
    id: "credit-admin.waiver-expiring",
    name: "Waiver / deferral expiring",
    module: MODULE,
    trigger: "credit-admin.waiver.reminded (reminder sweep)",
    subject: "Reminder: {{kind}} {{id}} lapses on {{expiry}}",
    inApp: "{{kind}} {{id}} on {{facility}} lapses in {{daysLeft}} days — regularise “{{condition}}” or request an extension.",
    body: "<p>The {{kind}} <strong>{{id}}</strong> on facility <strong>{{facility}}</strong> lapses on <strong>{{expiry}}</strong> ({{daysLeft}} days).</p><ul><li>Condition: {{condition}}</li></ul><p>Regularise the condition before expiry, or raise a new request. A lapsed deferral counts as a breach.</p>",
    tone: "warning",
    variables: [
      { name: "kind", description: "Waiver / Deferral", example: "Deferral" },
      { name: "id", description: "Request ID", example: "WVR-3101" },
      { name: "facility", description: "Facility ID", example: "FAC-10021" },
      { name: "condition", description: "Condition", example: "CP-11 — Perfection of legal mortgage" },
      { name: "expiry", description: "Expiry date", example: "15 Nov 2026" },
      { name: "daysLeft", description: "Days until lapse", example: "5" },
    ],
  }),
  tpl({
    id: "credit-admin.file-released",
    name: "File released for disbursement",
    module: MODULE,
    trigger: "credit-admin.facility.released",
    subject: "Released for disbursement: {{facility}} ({{obligor}})",
    inApp: "{{facility}} ({{obligor}}, {{amount}}) was released for disbursement by {{releasedBy}} — the Maker can prepare it.",
    body: "<p>Credit Administration released facility <strong>{{facility}}</strong> for <strong>{{obligor}}</strong> for disbursement.</p><ul><li>Approved amount: {{amount}}</li><li>Conditions precedent: {{cleared}}</li><li>Released by: {{releasedBy}}</li></ul><p>A Disbursement Maker can now prepare the disbursement for a different Checker to authorise.</p>",
    tone: "success",
    variables: [
      { name: "facility", description: "Facility ID", example: "FAC-10021" },
      { name: "obligor", description: "Obligor", example: "Adeyemi Foods Ltd" },
      { name: "amount", description: "Approved amount", example: "₦250,000,000" },
      { name: "cleared", description: "CPs cleared", example: "9 of 9 cleared" },
      { name: "releasedBy", description: "Who confirmed the release", example: "Bola Ade" },
    ],
  }),
  tpl({
    id: "credit-admin.crms-batch-submitted",
    name: "CRMS batch submitted",
    module: MODULE,
    trigger: "credit-admin.crms.batch-submitted",
    subject: "CRMS batch {{batch}} submitted ({{count}} facilities)",
    inApp: "CRMS batch {{batch}} ({{label}}) — {{count}} facilities, status {{status}}.",
    body: "<p>CRMS batch <strong>{{batch}}</strong> ({{label}}) was submitted by {{submittedBy}}.</p><ul><li>Facilities: {{count}}</li><li>Status: {{status}}</li></ul><p>The CRMS connector is simulated in this prototype.</p>",
    tone: "info",
    variables: [
      { name: "batch", description: "Batch ID", example: "CRMS-B-2026-11" },
      { name: "label", description: "Period label", example: "Ad-hoc submission 10 Nov 2026" },
      { name: "count", description: "Facilities in batch", example: "42" },
      { name: "status", description: "CBN response", example: "Accepted by CBN" },
      { name: "submittedBy", description: "Submitter", example: "Bola Ade" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "credit-admin.cp.confirmed", module: MODULE, description: "A condition precedent was confirmed met." },
  { name: "credit-admin.cp.reopened", module: MODULE, description: "A condition precedent was reopened." },
  { name: "credit-admin.waiver.requested", module: MODULE, description: "A waiver, deferral or sanction was raised (Operations request created)." },
  { name: "credit-admin.waiver.approved", module: MODULE, description: "A waiver or deferral was approved and the condition waived/deferred." },
  { name: "credit-admin.waiver.declined", module: MODULE, description: "A request was declined, returned or withdrawn." },
  { name: "credit-admin.waiver.closed", module: MODULE, description: "A waiver/deferral was closed because the condition was regularised." },
  { name: "credit-admin.waiver.reminded", module: MODULE, description: "An expiry reminder was sent for a waiver/deferral." },
  { name: "credit-admin.sanction.routed", module: MODULE, description: "A sanction for breach was routed to Operational Risk (loss event)." },
  { name: "credit-admin.facility.release-requested", module: MODULE, description: "Release for disbursement was requested (Operations request created)." },
  { name: "credit-admin.facility.released", module: MODULE, description: "A file was released for disbursement." },
  { name: "credit-admin.crms.search-requested", module: MODULE, description: "A CRMS search was requested for an obligor." },
  { name: "credit-admin.crms.result-received", module: MODULE, description: "A CRMS search result was received (simulated)." },
  { name: "credit-admin.crms.batch-submitted", module: MODULE, description: "A CRMS reporting batch was submitted (simulated)." },
  { name: "credit-admin.crms.exception-resolved", module: MODULE, description: "A CRMS reporting exception was marked resolved." },
  { name: "credit-admin.credit-file.updated", module: MODULE, description: "A credit-file (CBN Annexure 1) item changed status." },
]);

defineHookPoints([
  { point: "credit-admin.cp.confirm.before", module: MODULE, kind: "before", description: "Before a CP is confirmed met or reopened. Veto to block (e.g. require evidence)." },
  { point: "credit-admin.cp.confirm.after", module: MODULE, kind: "after", description: "After a CP status changed." },
  { point: "credit-admin.waiver.submit.before", module: MODULE, kind: "before", description: "Before a waiver/deferral/sanction is submitted. Veto or enrich (e.g. adjust tolerance)." },
  { point: "credit-admin.waiver.submit.after", module: MODULE, kind: "after", description: "After a request is submitted to Operations." },
  { point: "credit-admin.release.submit.before", module: MODULE, kind: "before", description: "Before release for disbursement is requested. Veto to block (e.g. extra checks)." },
  { point: "credit-admin.release.submit.after", module: MODULE, kind: "after", description: "After release is requested." },
  { point: "credit-admin.crms.batch.before", module: MODULE, kind: "before", description: "Before a CRMS batch is submitted. Veto to block (e.g. validation)." },
  { point: "credit-admin.crms.batch.after", module: MODULE, kind: "after", description: "After a CRMS batch is submitted." },
  { point: "credit-admin.credit-file.update.before", module: MODULE, kind: "before", description: "Before a credit-file item changes status." },
  { point: "credit-admin.credit-file.update.after", module: MODULE, kind: "after", description: "After a credit-file item changed status." },
]);
