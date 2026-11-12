"use client";

/**
 * Platform registrations for the disbursement module (Domestic Operations maker-checker, PRD §4.1 / §4.2):
 * business rules, operation types (Operations workflow), notification templates, events and hook points.
 * See docs/FRONTEND-CONVENTIONS.md → Platform services.
 *
 * The Maker prepares a disbursement and submits operation "disbursement.authorise"; the Checker step is the
 * Operations step. Segregation of duties: the engine bars the Maker (requester) from deciding; the hook
 * "disbursement.sod-and-step-up" bars the initiator/recommender of the facility and requires step-up
 * re-authentication above the core rule `approvals.stepUpThresholdNgn`.
 */
import { addMonths } from "date-fns";
import { useDb } from "@/lib/data/store";
import { money } from "@/lib/format";
import { defineEvents, publish, subscribe } from "@/lib/platform/events";
import { defineHookPoints, registerHook, runHooks } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, useOperationsStore, type OperationInstance } from "@/lib/platform/operations";
import { defineRules, getRule } from "@/lib/platform/rules";
import type { Actor } from "@/lib/platform/scope";
import { auditAs, demoNowIso, hash } from "../credit-admin/common";
import { conflictedPeople, useDisbursementStore, type Disbursement } from "./store";

const MODULE = "disbursement";

// ---------------------------------------------------------------- business rules
defineRules([
  { key: "disbursement.accountNumberLength", label: "Beneficiary account number length", description: "Digits in a beneficiary account number (NUBAN).", module: MODULE, category: "Validation", type: "number", unit: "digits", default: 10, min: 6, max: 20, source: "Tenant parameter (demo value) — CBN NUBAN is 10 digits" },
  { key: "disbursement.makerRoles", label: "Who prepares disbursements (Maker)", description: "Roles with execution authority within the approved amount.", module: MODULE, category: "Roles", type: "roles", default: ["disbursement-maker"], source: "Domestic Operations — Disbursement Maker" },
]);

// ---------------------------------------------------------------- operations
export type AuthorisePayload = { requestId: string; snapshot: Disbursement; facilityId: string; applicationId?: string };

const requestOf = (p: AuthorisePayload): Disbursement => useDisbursementStore.getState().requests[p.requestId] ?? p.snapshot;
const href = (facilityId: string) => `/disbursement/?facility=${facilityId}`;

registerOperation<AuthorisePayload>({
  type: "disbursement.authorise",
  name: "Disbursement authorisation (Checker)",
  module: MODULE,
  description: "A Disbursement Checker, different from the Maker and from the facility's initiator/recommender, authorises a prepared disbursement; step-up re-authentication above the high-value threshold.",
  defaultSteps: [{ id: "checker", name: "Checker authorisation", approverRoles: ["disbursement-checker"], mode: "any", slaHours: 8 }],
  apply: async (p, { instance, actor }) => {
    const d = requestOf(p);
    const at = demoNowIso();
    const threshold = getRule<number>("approvals.stepUpThresholdNgn");
    // TD-857: CBA posting reference is simulated until the CBA connector (§5.1) is live.
    const cbaReference = `CBA/DSB/${String(hash(d.id + at) % 1_000_000).padStart(6, "0")}`;
    const authorised: Disbursement = { ...d, status: "Authorised", checkerId: actor.id, checkerName: actor.name, decidedAt: at, comment: instance.reason, stepUpVerified: d.amount > threshold, cbaReference, operationId: instance.id };
    useDisbursementStore.getState().saveRequest(authorised);
    auditAs(actor, "Authorised disbursement", "Disbursement", d.id, "Awaiting authorisation", `Authorised · ${cbaReference}${authorised.stepUpVerified ? " · step-up verified" : ""}`);
    const db = useDb.getState();
    const facility = db.facilities.find((f) => f.id === d.facilityId);
    if (facility) {
      const outstanding = facility.outstanding + d.amount;
      db.update("facilities", facility.id, { status: "Active", outstanding, startDate: at, maturityDate: addMonths(new Date(at), facility.tenorMonths).toISOString() });
      auditAs(actor, "Facility activated on disbursement", "Facility", facility.id, `${facility.status} · outstanding ${money(facility.outstanding)}`, `Active · outstanding ${money(outstanding)}`);
      publish("disbursement.facility.activated", { module: MODULE, subject: { type: "Facility", id: facility.id, href: `/credit-admin/facility/?id=${facility.id}` }, payload: { outstanding } });
    }
    const app = p.applicationId ? db.applications.find((a) => a.id === p.applicationId) : undefined;
    if (app && app.stage !== "Booked") {
      db.update("applications", app.id, { stage: "Booked", updatedAt: at });
      auditAs(actor, "Application booked", "Application", app.id, app.stage, "Booked");
    }
    publish("disbursement.request.authorised", { module: MODULE, subject: { type: "Disbursement", id: d.id, title: `${d.id} · ${money(d.amount, d.currency)}`, href: href(d.facilityId) }, payload: { facilityId: d.facilityId, amount: d.amount, cbaReference, stepUpVerified: authorised.stepUpVerified, operationId: instance.id } });
    const obligor = db.obligors.find((o) => o.id === d.obligorId);
    const rm = obligor?.relationshipManagerId ?? app?.createdById;
    notify({
      templateId: "disbursement.authorised",
      toUserIds: [d.makerId, ...(rm ? [rm] : [])],
      toRoles: ["credit-admin-officer"],
      href: href(d.facilityId),
      data: { id: d.id, facility: d.facilityId, obligor: d.accountName, amount: money(d.amount, d.currency), account: d.accountNumber, cbaReference, checker: actor.name },
    });
    await runHooks("disbursement.authorise.after", { request: authorised, instance });
  },
  onReject: (p, { instance, actor }) => close(p, instance, actor, "Rejected"),
});

function close(p: AuthorisePayload, instance: OperationInstance, actor: Actor, status: Disbursement["status"]) {
  const d = requestOf(p);
  const checker = status === "Withdrawn" ? {} : { checkerId: actor.id, checkerName: actor.name };
  useDisbursementStore.getState().saveRequest({ ...d, ...checker, status, decidedAt: demoNowIso(), comment: instance.reason, operationId: instance.id });
  auditAs(actor, status === "Returned to maker" ? "Returned disbursement to maker" : status === "Rejected" ? "Rejected disbursement" : "Withdrew disbursement", "Disbursement", d.id, "Awaiting authorisation", `${status}${instance.reason ? `: ${instance.reason}` : ""}`);
  const event = status === "Returned to maker" ? "disbursement.request.returned" : status === "Rejected" ? "disbursement.request.rejected" : "disbursement.request.withdrawn";
  publish(event, { module: MODULE, subject: { type: "Disbursement", id: d.id, href: href(d.facilityId) }, payload: { facilityId: d.facilityId, operationId: instance.id } });
}

// Returned / withdrawn requests go back to the Maker.
subscribe({
  id: "disbursement.on-operation-closed",
  name: "Disbursement — mark requests returned to maker or withdrawn",
  pattern: "operations.request.*",
  handler: (event) => {
    const outcome = event.name.split(".").pop();
    if (outcome !== "returned" && outcome !== "cancelled") return;
    const instance = useOperationsStore.getState().instances.find((i) => i.id === event.subject?.id);
    if (!instance || instance.operationType !== "disbursement.authorise") return;
    const last = instance.decisions[instance.decisions.length - 1];
    const by: Actor = outcome === "returned" && last ? { id: last.actorId, name: last.actorName, roleId: last.roleId, tenantId: "-" } : { ...instance.requestedBy, tenantId: "-" };
    close(instance.payload as AuthorisePayload, instance, by, outcome === "returned" ? "Returned to maker" : "Withdrawn");
  },
});

// ---------------------------------------------------------------- segregation of duties + step-up
/** One-time step-up proofs ("<operationId>:<actorId>") set by the disbursement workspace after OTP verification. */
const stepUpProofs = new Set<string>();
export function recordStepUp(operationId: string, actorId: string) {
  stepUpProofs.add(`${operationId}:${actorId}`);
}

registerHook<{ instance: OperationInstance; decision: string; actor: Actor; stepUpVerified?: boolean }>({
  id: "disbursement.sod-and-step-up",
  name: "Disbursement — initiator/recommender can't authorise; step-up above threshold",
  point: "operations.decide.before",
  priority: 10,
  run: ({ instance, decision, actor, stepUpVerified }) => {
    if (instance.operationType !== "disbursement.authorise") return;
    const p = instance.payload as AuthorisePayload;
    const app = p.applicationId ? useDb.getState().applications.find((a) => a.id === p.applicationId) : undefined;
    const conflict = conflictedPeople(app).get(actor.id);
    if (conflict) return { veto: `You ${conflict}.2 bars you from authorising its disbursement.` };
    if (decision === "approve" && requestOf(p).amount > getRule<number>("approvals.stepUpThresholdNgn")) {
      const key = `${instance.id}:${actor.id}`;
      if (!stepUpVerified && !stepUpProofs.has(key)) return { veto: "High-value disbursement — step-up re-authentication is required. Verify with your one-time code to authorise." };
      stepUpProofs.delete(key);
    }
  },
});

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "disbursement.authorised",
    name: "Disbursement authorised",
    module: MODULE,
    trigger: "disbursement.request.authorised",
    subject: "Disbursed: {{amount}} to {{obligor}} ({{facility}})",
    inApp: "{{checker}} authorised {{id}} — {{amount}} to {{obligor}}; CBA ref {{cbaReference}}.",
    body: "<p>Disbursement <strong>{{id}}</strong> on facility <strong>{{facility}}</strong> was authorised by {{checker}} and posted to the core banking application.</p><ul><li>Beneficiary: {{obligor}} · {{account}}</li><li>Amount: {{amount}}</li><li>CBA reference: {{cbaReference}}</li></ul><p>The facility is now active; covenant and repayment monitoring start from today.</p>",
    tone: "success",
    variables: [
      { name: "id", description: "Disbursement request ID", example: "DSB-51004" },
      { name: "facility", description: "Facility ID", example: "FAC-10021" },
      { name: "obligor", description: "Beneficiary account name", example: "Adeyemi Foods Ltd" },
      { name: "account", description: "Beneficiary account (NUBAN)", example: "0123456789" },
      { name: "amount", description: "Amount", example: "₦250,000,000" },
      { name: "cbaReference", description: "CBA posting reference (simulated)", example: "CBA/DSB/004211" },
      { name: "checker", description: "Checker who authorised", example: "Emeka Obi" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "disbursement.request.prepared", module: MODULE, description: "A Maker prepared a disbursement and submitted it for Checker authorisation." },
  { name: "disbursement.request.authorised", module: MODULE, description: "A Checker authorised a disbursement (posted to the CBA, simulated)." },
  { name: "disbursement.request.returned", module: MODULE, description: "A Checker returned a disbursement to the Maker." },
  { name: "disbursement.request.rejected", module: MODULE, description: "A Checker rejected a disbursement." },
  { name: "disbursement.request.withdrawn", module: MODULE, description: "The Maker withdrew a disbursement awaiting authorisation." },
  { name: "disbursement.facility.activated", module: MODULE, description: "A facility became Active on its first disbursement." },
]);

defineHookPoints([
  { point: "disbursement.prepare.before", module: MODULE, kind: "before", description: "Before a Maker submits a disbursement. Veto to block (e.g. sanctions screening, account validation) or enrich." },
  { point: "disbursement.prepare.after", module: MODULE, kind: "after", description: "After the disbursement is submitted for authorisation." },
  { point: "disbursement.authorise.after", module: MODULE, kind: "after", description: "After a disbursement is authorised and the facility activated (e.g. trigger CBA posting / repayment schedule)." },
]);
