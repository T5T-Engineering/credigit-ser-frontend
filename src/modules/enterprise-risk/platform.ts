"use client";

/**
 * Platform registrations for the Enterprise Risk module (PRD §6.10–6.11): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md →
 * Platform services. Rule values are read at call time (never at module load).
 */
import { DEMO_NOW } from "@/lib/data/seed";
import { defineEvents, publish, subscribe } from "@/lib/platform/events";
import { defineHookPoints, registerHook } from "@/lib/platform/hooks";
import { defineTemplates, notify } from "@/lib/platform/notifications";
import { registerOperation, submitOperation, useOperationsStore, type WorkflowStep } from "@/lib/platform/operations";
import { applyRuleValue, defineRules, getRule, type RuleDefinition } from "@/lib/platform/rules";
import type { RoleId } from "@/lib/rbac/roles";
import { logAudit } from "../operational-risk/shared";
import { rasMetricDefaults } from "./data";
import { ermKeys } from "./keys";
import { useErm } from "./store";

export { ermKeys };
export const ERM = "enterprise-risk";
export const BRC_HREF = "/enterprise-risk/brc-pack";
const DEMO = "Tenant parameter";
const BOARD_RAS = "Board RAS — tenant parameter";

/** Source of each RAS limit (regulatory floors cited from the PRD) and its unit. */
const rasMeta: Record<string, { unit: string; limitSource: string }> = {
  "RA-01": { unit: "%", limitSource: "CBN 3.2(a) single-obligor limit 20% of shareholders' funds" },
  "RA-02": { unit: "%", limitSource: "tenant internal sector limits (utilisation)" },
  "RA-03": { unit: "%", limitSource: "CBN 3.2(c) all-tiers-of-government ceiling 10%" },
  "RA-04": { unit: "×", limitSource: "CBN 3.2(d)–(e) aggregate large exposures 8× shareholders' funds" },
  "RA-05": { unit: "%", limitSource: BOARD_RAS },
  "RA-06": { unit: "%", limitSource: "CAR minimum 10% or 15% by licence" },
  "RA-07": { unit: "%", limitSource: "Board RAS (CBN prescribes the floor)" },
  "RA-08": { unit: "%", limitSource: "LCR regulatory floor 100%" },
  "RA-09": { unit: "%", limitSource: BOARD_RAS },
  "RA-10": { unit: "%", limitSource: "Loss Limit Framework — utilisation ceiling" },
  "RA-11": { unit: "%", limitSource: BOARD_RAS },
};

const rasRules: RuleDefinition[] = rasMetricDefaults.flatMap((m) => [
  { key: ermKeys.rasLimit(m.id), label: `${m.id} appetite limit`, description: `${m.name}: Board-approved appetite limit.`, module: ERM, category: "Risk Appetite Statement", type: "number", default: m.limit, min: 0, step: 0.1, unit: rasMeta[m.id]?.unit, source: rasMeta[m.id]?.limitSource ?? BOARD_RAS },
  { key: ermKeys.rasTolerance(m.id), label: `${m.id} early-warning tolerance`, description: `${m.name}: early-warning (Amber) level.`, module: ERM, category: "Risk Appetite Statement", type: "number", default: m.tolerance, min: 0, step: 0.1, unit: rasMeta[m.id]?.unit, source: BOARD_RAS },
]);

const roleRule = (key: string, label: string, description: string, def: RoleId[], source: string): RuleDefinition => ({ key, label, description, module: ERM, category: "Escalation & distribution", type: "roles", default: def, source });

defineRules([
  ...rasRules,
  { key: ermKeys.rasVersion, label: "RAS version in force", description: "Version label of the Board-approved Risk Appetite Statement.", module: ERM, category: "Risk Appetite Statement", type: "text", default: "RAS 2026.1", source: "versioned configuration" },
  { key: ermKeys.rasApprovedBy, label: "RAS approved by", description: "Body that approved the RAS in force.", module: ERM, category: "Risk Appetite Statement", type: "text", default: "Board of Directors", source: DEMO },
  { key: ermKeys.rasApprovedAt, label: "RAS approval date", description: "ISO date the RAS in force was approved.", module: ERM, category: "Risk Appetite Statement", type: "text", default: "2026-01-28", source: DEMO },
  { key: ermKeys.rasNextReview, label: "RAS next review", description: "ISO date the RAS is next due for Board review.", module: ERM, category: "Risk Appetite Statement", type: "text", default: "2027-01-31", source: DEMO },
  { key: ermKeys.largeExposurePct, label: "Large-exposure definition", description: "An obligor exposure at or above this share of shareholders' funds is a large exposure.", module: ERM, category: "Concentration", type: "percent", default: 10, min: 1, max: 100, unit: "%", source: "CBN 3.2(d) (10% of shareholders' funds)" },
  { key: ermKeys.policyCycleYears, label: "Policy review cycle", description: "Credit, project-finance, real-estate, SME, agriculture and retail-financing policies must be reviewed at least this often.", module: ERM, category: "Policy currency", type: "number", default: 3, min: 1, max: 10, unit: "years", source: "Platform default" },
  { key: ermKeys.policyDueSoonDays, label: "Policy review — due-soon window", description: "Days before the cycle ends at which a policy shows as due soon.", module: ERM, category: "Policy currency", type: "duration", durationUnit: "days", default: 182, min: 0, max: 730, source: DEMO },
  { key: ermKeys.significantShareholdingPct, label: "Significant shareholder threshold", description: "Holding at or above which a shareholder is an insider for related-party disclosure.", module: ERM, category: "Insider & related party", type: "percent", default: 5, min: 0.1, max: 100, unit: "%", source: "Platform default" },
  roleRule(ermKeys.amberEscalationRoles, "Appetite early warning — escalate to", "Roles an Amber appetite metric is escalated to.", ["cro"], "(automated breach escalation)"),
  roleRule(ermKeys.redEscalationRoles, "Appetite breach — escalate to", "Roles a Red appetite breach is escalated to (CRO and Board Risk Committee).", ["cro", "board"], "Tenant mapping"),
  { key: ermKeys.brcRequiresAdoptedSummary, label: "BRC pack needs an adopted summary", description: "The Board Risk Committee pack can't be submitted until its AI-drafted executive summary is reviewed and adopted.", module: ERM, category: "Board reporting", type: "boolean", default: true, source: "AI-drafted, human-approved (tenant choice)" },
  roleRule(ermKeys.brcNotifyRoles, "BRC pack ready — notify", "Roles notified when the Board Risk Committee pack is approved for circulation.", ["board", "head-of-risk", "cro"], "Tenant mapping"),
]);

// ---------------------------------------------------------------- operations
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });

export type RasChangePayload = { metricId: string; name: string; limit: number; tolerance: number; before: { limit: number; tolerance: number }; reason: string };
registerOperation<RasChangePayload>({
  type: "enterprise-risk.ras.change",
  name: "Risk appetite limit change",
  module: ERM,
  description: "Change a Risk Appetite Statement limit or early-warning tolerance. CRO review, then Board approval.",
  defaultSteps: [step("cro", "CRO review", ["cro"], 72), step("board", "Board approval", ["board"], 168)],
  apply: (p, { instance, actor }) => {
    applyRuleValue(ermKeys.rasLimit(p.metricId), p.limit, actor, { reason: p.reason, operationId: instance.id });
    applyRuleValue(ermKeys.rasTolerance(p.metricId), p.tolerance, actor, { reason: p.reason, operationId: instance.id });
    logAudit("Applied risk appetite change", "Risk appetite metric", p.metricId, `${p.before.limit} / ${p.before.tolerance}`, `${p.limit} / ${p.tolerance}`);
    publish("enterprise-risk.ras.changed", { module: ERM, subject: { type: "AppetiteMetric", id: p.metricId, title: p.name, href: "/enterprise-risk" }, payload: { before: p.before, after: { limit: p.limit, tolerance: p.tolerance } } });
  },
});

export type RiskAcceptancePayload = { riskId: string; title: string; residual: number; rationale: string; previousResponse: string };
registerOperation<RiskAcceptancePayload>({
  type: "enterprise-risk.risk.acceptance",
  name: "Risk acceptance",
  module: ERM,
  description: "Accept (tolerate) an enterprise risk at its residual level. CRO approval; the MD decides when the CRO requested it (ISO 31000 treatment).",
  defaultSteps: [step("approve", "CRO / MD approval", ["cro", "md"], 72)],
  apply: (p, { actor }) => {
    useErm.getState().updateRisk(p.riskId, { response: "Tolerate", acceptedBy: actor.name, acceptedAt: DEMO_NOW.toISOString(), acceptanceRationale: p.rationale });
    logAudit("Accepted enterprise risk (approved)", "Enterprise risk", p.riskId, p.previousResponse, "Tolerate");
    publish("enterprise-risk.risk.accepted", { module: ERM, subject: { type: "EnterpriseRisk", id: p.riskId, title: p.title, href: "/enterprise-risk/register" }, payload: { residual: p.residual } });
  },
});

export type BrcPackPayload = { packId: string; meeting: string; sections: number };
registerOperation<BrcPackPayload>({
  type: "enterprise-risk.brc-pack.approval",
  name: "Board Risk Committee pack approval",
  module: ERM,
  description: "The Head of Risk compiles and submits the BRC pack; the CRO approves it for circulation.",
  defaultSteps: [step("approve", "CRO approval", ["cro"], 72)],
  apply: (p, { actor }) => {
    useErm.getState().updatePack(p.packId, { status: "Approved for BRC", approvedBy: actor.name });
    logAudit("Approved BRC pack for circulation", "BRC pack", p.packId, "Submitted to CRO", "Approved for BRC");
    publish("enterprise-risk.brc-pack.approved", { module: ERM, subject: { type: "BrcPack", id: p.packId, href: "/enterprise-risk/brc-pack" }, payload: { meeting: p.meeting } });
    notify({ templateId: "enterprise-risk.brc-pack-ready", toRoles: getRule<RoleId[]>(ermKeys.brcNotifyRoles), href: "/enterprise-risk/brc-pack", data: { packId: p.packId, meeting: p.meeting, sections: p.sections, approvedBy: actor.name } });
  },
  onReject: (p, { instance, actor }) => reopenPack(p.packId, "Rejected", instance.requestedBy.id, actor.name, instance.reason),

});

/** A rejected / returned / withdrawn / failed pack request puts the pack back to Draft (and tells the requester when an approver sent it back). */
function reopenPack(packId: string, outcome: "Rejected" | "Returned" | "Withdrawn" | "Failed", requesterId: string, decidedBy: string, reason?: string) {
  const pack = useErm.getState().packs.find((x) => x.id === packId);
  if (!pack || pack.status !== "Submitted to CRO") return;
  useErm.getState().updatePack(packId, { status: "Draft" });
  logAudit(`BRC pack back to Draft (${outcome.toLowerCase()})`, "BRC pack", packId, "Submitted to CRO", "Draft");
  publish("enterprise-risk.brc-pack.returned", { module: ERM, subject: { type: "BrcPack", id: packId, href: BRC_HREF }, payload: { outcome, reason } });
  // Withdrawn: the requester did it. Failed: the requester already got operations.apply-failed.
  if (outcome === "Rejected" || outcome === "Returned") notify({ templateId: "enterprise-risk.brc-pack-returned", toUserIds: [requesterId], href: BRC_HREF, data: { packId, meeting: pack.meeting, outcome: outcome.toLowerCase(), decidedBy, reason: reason ?? "" } });
}

// Returned / withdrawn requests don't call apply / onReject — put the pack back to Draft.
subscribe({
  id: "enterprise-risk.brc-pack-reopen",
  name: "Enterprise risk: reopen BRC pack on returned / withdrawn request",
  pattern: "operations.request.*",
  handler: (e) => {
    if (!["operations.request.returned", "operations.request.cancelled", "operations.request.failed"].includes(e.name)) return;
    const { operationType, subject } = e.payload as { operationType: string; subject: { id: string } };
    if (operationType !== "enterprise-risk.brc-pack.approval") return;
    const outcome = e.name.endsWith("cancelled") ? "Withdrawn" : e.name.endsWith("failed") ? "Failed" : "Returned";
    const op = useOperationsStore.getState().instances.find((i) => i.id === e.subject?.id);
    reopenPack(subject.id, outcome, op?.requestedBy.id ?? "", e.actorName, op?.reason);
  },
});

// Built-in policy hook: the pack needs its AI-drafted summary adopted before submission (PRD §6.12).
registerHook<{ pack: { summaryAdoptedBy?: string } }>({
  id: "enterprise-risk.brc-pack-needs-adopted-summary",
  name: "Adopted summary gate",
  point: "enterprise-risk.brc-pack.submit.before",
  priority: 10,
  run: ({ pack }) => (getRule<boolean>(ermKeys.brcRequiresAdoptedSummary) && !pack.summaryAdoptedBy ? { veto: "the AI-drafted executive summary hasn't been reviewed and adopted yet." } : undefined),
});

/** Submit a RAS limit/tolerance change. */
export function requestRasChange(p: RasChangePayload) {
  return submitOperation<RasChangePayload>("enterprise-risk.ras.change", {
    title: `${p.metricId} appetite: ${p.before.limit}/${p.before.tolerance} → ${p.limit}/${p.tolerance}`,
    subject: { type: "AppetiteMetric", id: p.metricId, title: p.name, href: "/enterprise-risk" },
    payload: p,
    summary: [
      { label: "Metric", value: `${p.metricId} — ${p.name}` },
      { label: "Appetite limit", value: `${p.before.limit} → ${p.limit}` },
      { label: "Early warning", value: `${p.before.tolerance} → ${p.tolerance}` },
      { label: "Reason", value: p.reason },
    ],
  });
}

// ---------------------------------------------------------------- notifications
defineTemplates([
  {
    id: "enterprise-risk.appetite-breach",
    name: "Risk appetite breach escalation",
    module: ERM,
    trigger: "enterprise-risk.appetite.breach-escalated",
    subject: "Risk appetite {{status}}: {{metric}}",
    inApp: "{{metric}} is {{actual}} against appetite {{limit}} ({{status}}) — escalated to {{escalatedTo}} by {{by}}.",
    body: "<p><strong>{{metric}}</strong> ({{metricId}}) is <strong>{{status}}</strong>.</p><ul><li>Actual: {{actual}}</li><li>Appetite: {{limit}} · Early warning: {{tolerance}}</li><li>Metric owner: {{owner}}</li><li>Escalated to: {{escalatedTo}} by {{by}}</li></ul><p>Review the breach and the owner's remediation plan against the Risk Appetite Statement {{rasVersion}}.</p>",
    tone: "danger",
    variables: [
      { name: "metric", description: "Appetite metric", example: "All-tiers-of-government exposure to total credit" },
      { name: "metricId", description: "Metric id", example: "RA-03" },
      { name: "status", description: "Breach / Early warning", example: "Breach" },
      { name: "actual", description: "Actual value", example: "11.2%" },
      { name: "limit", description: "Appetite limit", example: "≤ 10%" },
      { name: "tolerance", description: "Early-warning level", example: "9%" },
      { name: "owner", description: "Metric owner", example: "Chief Credit Officer" },
      { name: "escalatedTo", description: "Roles escalated to", example: "Chief Risk Officer, Board" },
      { name: "by", description: "Who escalated", example: "Chinedu Okafor" },
      { name: "rasVersion", description: "RAS version", example: "RAS 2026.1" },
    ],
  },
  {
    id: "enterprise-risk.brc-pack-returned",
    name: "BRC pack returned",
    module: ERM,
    trigger: "enterprise-risk.brc-pack.returned",
    subject: "Board Risk Committee pack {{packId}} was {{outcome}}",
    inApp: "BRC pack {{packId}} ({{meeting}} meeting) was {{outcome}} by {{decidedBy}} and is back in Draft.",
    body: "<p>The Board Risk Committee pack <strong>{{packId}}</strong> for the meeting on <strong>{{meeting}}</strong> was <strong>{{outcome}}</strong> by {{decidedBy}}.</p><p>{{reason}}</p><p>The pack is back in Draft. Revise it and submit it again.</p>",
    tone: "warning",
    variables: [
      { name: "packId", description: "Pack id", example: "BRC-20261126-01" },
      { name: "meeting", description: "Meeting date", example: "2026-11-26" },
      { name: "outcome", description: "rejected / returned", example: "returned" },
      { name: "decidedBy", description: "Approver", example: "Chinedu Okafor" },
      { name: "reason", description: "Approver comment", example: "Add the IFRS 9 stage-migration section." },
    ],
  },
  {
    id: "enterprise-risk.brc-pack-ready",
    name: "BRC pack ready",
    module: ERM,
    trigger: "enterprise-risk.brc-pack.approved",
    subject: "Board Risk Committee pack {{packId}} is ready",
    inApp: "BRC pack {{packId}} for the {{meeting}} meeting was approved by {{approvedBy}}.",
    body: "<p>The Board Risk Committee pack <strong>{{packId}}</strong> for the meeting on <strong>{{meeting}}</strong> has been approved for circulation by {{approvedBy}}.</p><ul><li>Sections: {{sections}}</li></ul><p>Open the pack to review the scorecard, breaches and the executive summary.</p>",
    tone: "success",
    variables: [
      { name: "packId", description: "Pack id", example: "BRC-20261126-01" },
      { name: "meeting", description: "Meeting date", example: "2026-11-26" },
      { name: "sections", description: "Number of sections", example: "10" },
      { name: "approvedBy", description: "Approver", example: "Chinedu Okafor" },
    ],
  },
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "enterprise-risk.ras.changed", module: ERM, description: "A Risk Appetite Statement limit/tolerance changed (after approval)." },
  { name: "enterprise-risk.appetite.breach-escalated", module: ERM, description: "An Amber/Red appetite metric was escalated.", payloadExample: { rag: "red", escalatedTo: ["cro", "board"] } },
  { name: "enterprise-risk.risk.reviewed", module: ERM, description: "An enterprise risk review was recorded." },
  { name: "enterprise-risk.risk.accepted", module: ERM, description: "An enterprise risk was accepted (tolerated) after approval." },
  { name: "enterprise-risk.brc-pack.compiled", module: ERM, description: "A Board Risk Committee pack was compiled." },
  { name: "enterprise-risk.brc-pack.submitted", module: ERM, description: "A BRC pack was submitted to the CRO for approval." },
  { name: "enterprise-risk.brc-pack.approved", module: ERM, description: "A BRC pack was approved for circulation." },
  { name: "enterprise-risk.brc-pack.returned", module: ERM, description: "A BRC pack request was rejected, returned or withdrawn; the pack is back in Draft." },
  { name: "enterprise-risk.brc-pack.summary-adopted", module: ERM, description: "The AI-drafted executive summary was signed off and adopted." },
  { name: "enterprise-risk.circular.assessed", module: ERM, description: "A CBN circular's impact assessment started." },
  { name: "enterprise-risk.circular.linked", module: ERM, description: "A CBN circular was linked to a policy (or closed — no action)." },
  { name: "enterprise-risk.policy.reviewed", module: ERM, description: "A policy review was recorded." },
]);

defineHookPoints([
  { point: "enterprise-risk.appetite.escalate.before", module: ERM, kind: "before", description: "Before an appetite breach is escalated. Veto, or enrich the escalation targets." },
  { point: "enterprise-risk.appetite.escalate.after", module: ERM, kind: "after", description: "After an appetite breach is escalated and notified." },
  { point: "enterprise-risk.brc-pack.submit.before", module: ERM, kind: "before", description: "Before a BRC pack is submitted for approval. Veto or enrich. Built-in: adopted-summary gate." },
  { point: "enterprise-risk.brc-pack.submit.after", module: ERM, kind: "after", description: "After a BRC pack is submitted (operation created)." },
  { point: "enterprise-risk.brc-pack.compile.before", module: ERM, kind: "before", description: "Before a BRC pack is compiled. Veto, or enrich sections/summary (e.g. add an extension section)." },
  { point: "enterprise-risk.brc-pack.compile.after", module: ERM, kind: "after", description: "After a BRC pack is compiled (e.g. render to PDF, archive)." },
]);

/** AI-drafted BRC summary adopted through the AI sign-off operation → write the adopted text to the pack. */
subscribe({
  id: "enterprise-risk.adopt-brc-summary",
  name: "Enterprise risk: adopt signed-off BRC executive summary",
  pattern: "ai.output.signed-off",
  handler: (event) => {
    const p = event.payload as { activityId?: string; text?: string };
    if (!p.activityId?.startsWith("AIA-BRC-")) return;
    const packId = p.activityId.slice("AIA-BRC-".length);
    useErm.getState().updatePack(packId, { ...(p.text ? { summary: p.text } : {}), summaryAdoptedBy: event.actorName });
    publish("enterprise-risk.brc-pack.summary-adopted", { module: ERM, subject: { type: "BrcPack", id: packId, href: "/enterprise-risk/brc-pack" } });
  },
});
