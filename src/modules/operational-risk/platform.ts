"use client";

/**
 * Platform registrations for the Operational Risk module (PRD §6.9): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md →
 * Platform services. Rule values are read at call time through `getRule`/`useRule` (never at module load).
 */
import { DEMO_NOW } from "@/lib/data/seed";
import { defineEvents, publish, subscribe } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineTemplates, notify } from "@/lib/platform/notifications";
import { registerOperation, submitOperation, type WorkflowStep } from "@/lib/platform/operations";
import { applyRuleValue, defineRules, getRule, type RuleDefinition } from "@/lib/platform/rules";
import type { RoleId } from "@/lib/rbac/roles";
import { kris, netLoss, seedBcmPlans, type LossEvent } from "./data";
import { useOpRisk } from "./store";
import { isoDaysAhead, logAudit } from "./shared";

export const OPRISK = "operational-risk";
const DEMO = "Tenant parameter";

/** Business-rule keys for the module. */
export const orKeys = {
  kriAmber: (kriId: string) => `operational-risk.kri.${kriId}.amber`,
  kriRed: (kriId: string) => `operational-risk.kri.${kriId}.red`,
  escalationRoles: (level: 1 | 2 | 3 | 4) => `operational-risk.kri.escalation.level${level}Roles`,
  annualNetLimit: "operational-risk.loss.annualNetLimitNgn",
  monthlyNetLimit: "operational-risk.loss.monthlyNetLimitNgn",
  singleEvent: "operational-risk.loss.singleEventThresholdNgn",
  boardMateriality: "operational-risk.loss.boardMaterialityNgn",
  limitWarningPct: "operational-risk.loss.limitWarningPct",
  lossEscalationRoles: "operational-risk.loss.escalationRoles",
  lossBoardRoles: "operational-risk.loss.boardNotifyRoles",
  rcsaLikelihoodLabels: "operational-risk.rcsa.likelihoodLabels",
  rcsaImpactLabels: "operational-risk.rcsa.impactLabels",
  rcsaMediumFrom: "operational-risk.rcsa.mediumFromScore",
  rcsaHighFrom: "operational-risk.rcsa.highFromScore",
  rcsaCriticalFrom: "operational-risk.rcsa.criticalFromScore",
  rcsaCycleMonths: "operational-risk.rcsa.cycleMonths",
  bcmRto: (planId: string) => `operational-risk.bcm.${planId}.rtoHours`,
  bcmRpo: (planId: string) => `operational-risk.bcm.${planId}.rpoMinutes`,
  bcmReviewCycleDays: "operational-risk.bcm.reviewCycleDays",
  bcmReviewDueWindowDays: "operational-risk.bcm.reviewDueWindowDays",
  bcmFireDrillsPerYear: "operational-risk.bcm.fireDrillsPerYear",
  bcmDrillTargetPct: "operational-risk.bcm.drillComplianceTargetPct",
  bcmReadinessRedBelow: "operational-risk.bcm.readinessRedBelow",
  bcmReadinessAmberBelow: "operational-risk.bcm.readinessAmberBelow",
  bcmWeightCurrency: "operational-risk.bcm.weightPlanCurrency",
  bcmWeightRto: "operational-risk.bcm.weightRtoMet",
  bcmWeightDrills: "operational-risk.bcm.weightDrillCompliance",
  bcmWeightCrisis: "operational-risk.bcm.weightCrisisChecklist",
  bcmEscalationRoles: "operational-risk.bcm.failureEscalationRoles",
} as const;

// ---------------------------------------------------------------- business rules
const kriRules: RuleDefinition[] = kris.flatMap((k) => [
  { key: orKeys.kriAmber(k.id), label: `${k.id} amber threshold`, description: `${k.name}: reading at which the KRI turns Amber (early warning). Unit: ${k.unit}.`, module: OPRISK, category: "KRI thresholds", type: "number", default: k.amber, min: 0, step: k.decimals ? 1 / 10 ** k.decimals : 1, unit: k.unit, source: "tenant-configurable G/A/R banding" },
  { key: orKeys.kriRed(k.id), label: `${k.id} red threshold`, description: `${k.name}: reading at which the KRI is Red (outside Board-approved tolerance). Unit: ${k.unit}.`, module: OPRISK, category: "KRI thresholds", type: "number", default: k.red, min: 0, step: k.decimals ? 1 / 10 ** k.decimals : 1, unit: k.unit, source: "tenant-configurable G/A/R banding" },
]);

const bcmRules: RuleDefinition[] = seedBcmPlans.flatMap((p) => [
  { key: orKeys.bcmRto(p.id), label: `${p.id} RTO target`, description: `Recovery Time Objective for “${p.process}” (Tier ${p.tier}).`, module: OPRISK, category: "BCM targets", type: "duration", durationUnit: "hours", default: p.rtoTargetHrs, min: 0.5, max: 720, step: 0.5, source: "BCM Framework — tenant target" },
  { key: orKeys.bcmRpo(p.id), label: `${p.id} RPO target`, description: `Recovery Point Objective for “${p.process}” (Tier ${p.tier}).`, module: OPRISK, category: "BCM targets", type: "duration", durationUnit: "minutes", default: p.rpoTargetMins, min: 1, max: 10_080, source: "BCM Framework — tenant target" },
]);

const roleRule = (key: string, label: string, description: string, def: RoleId[], source: string): RuleDefinition => ({ key, label, description, module: OPRISK, category: "Escalation", type: "roles", default: def, source });

defineRules([
  ...kriRules,
  roleRule(orKeys.escalationRoles(1), "KRI escalation — Level 1", "Notified on the first Amber/Red reading (with the control owner).", ["operational-risk-analyst"], "Platform default"),
  roleRule(orKeys.escalationRoles(2), "KRI escalation — Level 2", "Red uncured after the Level 1 SLA.", ["head-of-risk"], "Platform default"),
  roleRule(orKeys.escalationRoles(3), "KRI escalation — Level 3", "Red uncured after the Level 2 SLA.", ["cro"], "Platform default"),
  roleRule(orKeys.escalationRoles(4), "KRI escalation — Level 4", "Board Risk Committee notification for material breaches.", ["board"], "Platform default"),
  { key: orKeys.annualNetLimit, label: "Annual net operational loss limit", description: "Loss Limit Framework: net loss allowed per financial year.", module: OPRISK, category: "Loss Limit Framework", type: "money", default: 1_200_000_000, min: 0, source: `Loss Limit Framework — ${DEMO}` },
  { key: orKeys.monthlyNetLimit, label: "Monthly net operational loss limit", description: "Loss Limit Framework: net loss allowed per month (drives KRI-LE-01).", module: OPRISK, category: "Loss Limit Framework", type: "money", default: 100_000_000, min: 1, source: `Loss Limit Framework — ${DEMO}` },
  { key: orKeys.singleEvent, label: "Single-event escalation threshold", description: "A loss event with net loss at or above this is escalated to the loss escalation roles on logging.", module: OPRISK, category: "Loss Limit Framework", type: "money", default: 25_000_000, min: 0, source: `Loss Limit Framework — ${DEMO}` },
  { key: orKeys.boardMateriality, label: "Board materiality threshold", description: "Loss events at or above this are notified to the Board Risk Committee roles.", module: OPRISK, category: "Loss Limit Framework", type: "money", default: 100_000_000, min: 0, source: `(BRC notification for material breaches) — ${DEMO}` },
  { key: orKeys.limitWarningPct, label: "Loss-limit early warning", description: "Share of the annual loss limit at which utilisation shows as a warning.", module: OPRISK, category: "Loss Limit Framework", type: "percent", default: 75, min: 1, max: 100, unit: "%", source: DEMO },
  roleRule(orKeys.lossEscalationRoles, "Loss above threshold — notify", "Roles notified when a loss event is at or above the single-event threshold.", ["head-of-risk", "operational-risk-analyst"], "tenant mapping"),
  roleRule(orKeys.lossBoardRoles, "Material loss — notify", "Roles notified when a loss event is at or above the Board materiality threshold.", ["cro", "board"], "tenant mapping"),
  { key: orKeys.rcsaLikelihoodLabels, label: "RCSA likelihood scale", description: "Likelihood scale labels, lowest first. The number of labels sets the scale size.", module: OPRISK, category: "RCSA", type: "list", default: ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"], source: DEMO },
  { key: orKeys.rcsaImpactLabels, label: "RCSA impact scale", description: "Impact scale labels, lowest first. The number of labels sets the scale size.", module: OPRISK, category: "RCSA", type: "list", default: ["Insignificant", "Minor", "Moderate", "Major", "Severe"], source: DEMO },
  { key: orKeys.rcsaMediumFrom, label: "Risk score — Medium from", description: "Likelihood × impact score at which a risk is Medium.", module: OPRISK, category: "RCSA", type: "number", default: 5, min: 1, max: 100, source: DEMO },
  { key: orKeys.rcsaHighFrom, label: "Risk score — High from", description: "Likelihood × impact score at which a risk is High.", module: OPRISK, category: "RCSA", type: "number", default: 10, min: 1, max: 100, source: DEMO },
  { key: orKeys.rcsaCriticalFrom, label: "Risk score — Critical from", description: "Likelihood × impact score at which a risk is Critical.", module: OPRISK, category: "RCSA", type: "number", default: 15, min: 1, max: 100, source: DEMO },
  { key: orKeys.rcsaCycleMonths, label: "RCSA cycle", description: "Months between Risk & Control Self-Assessment cycles.", module: OPRISK, category: "RCSA", type: "number", default: 6, min: 1, max: 36, unit: "months", source: "(configurable cycle)" },
  ...bcmRules,
  { key: orKeys.bcmReviewCycleDays, label: "BCM plan review cycle", description: "Days between approved BCM plan reviews.", module: OPRISK, category: "BCM", type: "duration", durationUnit: "days", default: 365, min: 30, max: 1095, source: DEMO },
  { key: orKeys.bcmReviewDueWindowDays, label: "BCM review due window", description: "Days before the next review at which a plan shows as due.", module: OPRISK, category: "BCM", type: "duration", durationUnit: "days", default: 60, min: 0, max: 365, source: DEMO },
  { key: orKeys.bcmFireDrillsPerYear, label: "Fire drills required per year", description: "Fire Drill & Evacuation Framework: drills each branch must complete a year.", module: OPRISK, category: "BCM", type: "number", default: 2, min: 1, max: 12, source: DEMO },
  { key: orKeys.bcmDrillTargetPct, label: "Fire-drill compliance target", description: "Compliance at or above this shows green.", module: OPRISK, category: "BCM", type: "percent", default: 90, min: 1, max: 100, unit: "%", source: DEMO },
  { key: orKeys.bcmReadinessRedBelow, label: "Readiness index — red below", description: "Operational resilience readiness below this is red.", module: OPRISK, category: "BCM", type: "number", default: 60, min: 0, max: 100, source: DEMO },
  { key: orKeys.bcmReadinessAmberBelow, label: "Readiness index — amber below", description: "Readiness below this (and at or above red) is amber.", module: OPRISK, category: "BCM", type: "number", default: 80, min: 0, max: 100, source: DEMO },
  { key: orKeys.bcmWeightCurrency, label: "Readiness weight — plan currency", description: "Weight of plan currency in the readiness index.", module: OPRISK, category: "BCM readiness weights", type: "percent", default: 25, min: 0, max: 100, unit: "%", source: DEMO },
  { key: orKeys.bcmWeightRto, label: "Readiness weight — RTO met", description: "Weight of RTO achievement in the readiness index.", module: OPRISK, category: "BCM readiness weights", type: "percent", default: 25, min: 0, max: 100, unit: "%", source: DEMO },
  { key: orKeys.bcmWeightDrills, label: "Readiness weight — drill compliance", description: "Weight of fire-drill compliance in the readiness index.", module: OPRISK, category: "BCM readiness weights", type: "percent", default: 25, min: 0, max: 100, unit: "%", source: DEMO },
  { key: orKeys.bcmWeightCrisis, label: "Readiness weight — crisis checklist", description: "Weight of the crisis-management checklist in the readiness index.", module: OPRISK, category: "BCM readiness weights", type: "percent", default: 25, min: 0, max: 100, unit: "%", source: DEMO },
  roleRule(orKeys.bcmEscalationRoles, "Tier 1 test failure — notify", "Roles notified when a Tier 1 BCM/DR test fails.", ["head-of-risk", "cro"], "BCM — tenant mapping"),
]);

// ---------------------------------------------------------------- operations (approvals)
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });

export type KriThresholdPayload = { kriId: string; amber: number; red: number; before: { amber: number; red: number }; reason: string };
registerOperation<KriThresholdPayload>({
  type: "operational-risk.kri.threshold-change",
  name: "KRI threshold change",
  module: OPRISK,
  description: "Change a KRI's Amber/Red thresholds (Board-approved tolerance). Head of Risk / CRO approval.",
  defaultSteps: [step("approve", "Head of Risk / CRO approval", ["head-of-risk", "cro"], 48)],
  apply: (p, { instance, actor }) => {
    applyRuleValue(orKeys.kriAmber(p.kriId), p.amber, actor, { reason: p.reason, operationId: instance.id });
    applyRuleValue(orKeys.kriRed(p.kriId), p.red, actor, { reason: p.reason, operationId: instance.id });
    logAudit("Applied KRI threshold change", "KRI", p.kriId, `${p.before.amber}/${p.before.red}`, `${p.amber}/${p.red}`);
    publish("operational-risk.kri.thresholds-changed", { module: OPRISK, subject: { type: "KRI", id: p.kriId, href: "/operational-risk" }, payload: { before: p.before, after: { amber: p.amber, red: p.red }, operationId: instance.id } });
  },
});

export type LossClosurePayload = { eventId: string; title: string; netLoss: number; writeOff: number; reason: string };
registerOperation<LossClosurePayload>({
  type: "operational-risk.loss-event.closure",
  name: "Loss-event closure & write-off",
  module: OPRISK,
  description: "Close a loss event after remediation and write off the unrecovered amount. Second-line approval.",
  defaultSteps: [step("approve", "Head of Risk approval", ["head-of-risk", "cro"], 72)],
  apply: (p, { actor }) => {
    const e = useOpRisk.getState().lossEvents.find((x) => x.id === p.eventId);
    useOpRisk.getState().updateLossEvent(p.eventId, { status: "Closed", writeOff: p.writeOff, closedBy: actor.name });
    logAudit("Closed loss event (approved)", "Loss event", p.eventId, e?.status, `Closed · written off ${p.writeOff}`);
    publish("operational-risk.loss-event.closed", { module: OPRISK, subject: { type: "LossEvent", id: p.eventId, title: p.title, href: "/operational-risk/loss-events" }, payload: { writeOff: p.writeOff, netLoss: p.netLoss } });
  },
});

export type RcsaSignOffPayload = { riskId: string; title: string; residual: number; comment: string };
registerOperation<RcsaSignOffPayload>({
  type: "operational-risk.rcsa.sign-off",
  name: "RCSA second-line sign-off",
  module: OPRISK,
  description: "Second-line review and sign-off of a submitted Risk & Control Self-Assessment (COSO identify-assess-respond-monitor).",
  defaultSteps: [step("review", "Second-line review", ["head-of-risk", "operational-risk-analyst"], 120)],
  apply: (p, { actor }) => {
    useOpRisk.getState().updateRcsa(p.riskId, { status: "Reviewed", reviewedBy: actor.name, assessedAt: DEMO_NOW.toISOString() });
    logAudit("Signed off RCSA self-assessment", "RCSA", p.riskId, "Submitted", "Reviewed");
    publish("operational-risk.rcsa.signed-off", { module: OPRISK, subject: { type: "RcsaRisk", id: p.riskId, title: p.title, href: "/operational-risk/rcsa" }, payload: { residual: p.residual } });
  },
  onReject: (p) => {
    useOpRisk.getState().updateRcsa(p.riskId, { status: "In progress" });
    logAudit("RCSA sign-off rejected — returned to control owner", "RCSA", p.riskId, "Submitted", "In progress");
    publish("operational-risk.rcsa.returned", { module: OPRISK, subject: { type: "RcsaRisk", id: p.riskId, title: p.title, href: "/operational-risk/rcsa" } });
  },
});

export type BcmPlanPayload = { planId: string; process: string; rtoHours: number; rpoMinutes: number; before: { rtoHours: number; rpoMinutes: number }; comment: string };
registerOperation<BcmPlanPayload>({
  type: "operational-risk.bcm.plan-approval",
  name: "BCM plan review approval",
  module: OPRISK,
  description: "Approve a reviewed BCM plan (and any change to its RTO/RPO targets). BCM Framework / ISO 22301.",
  defaultSteps: [step("approve", "Head of Risk approval", ["head-of-risk", "cro"], 72)],
  apply: (p, { instance, actor }) => {
    if (p.rtoHours !== p.before.rtoHours) applyRuleValue(orKeys.bcmRto(p.planId), p.rtoHours, actor, { reason: p.comment, operationId: instance.id });
    if (p.rpoMinutes !== p.before.rpoMinutes) applyRuleValue(orKeys.bcmRpo(p.planId), p.rpoMinutes, actor, { reason: p.comment, operationId: instance.id });
    const plan = useOpRisk.getState().bcmPlans.find((x) => x.id === p.planId);
    useOpRisk.getState().updatePlan(p.planId, { lastReviewed: DEMO_NOW.toISOString(), nextReview: isoDaysAhead(getRule<number>(orKeys.bcmReviewCycleDays)), approvedBy: actor.name });
    logAudit("Approved BCM plan review", "BCM plan", p.planId, plan ? `Reviewed ${plan.lastReviewed.slice(0, 10)} · RTO ${p.before.rtoHours}h · RPO ${p.before.rpoMinutes}m` : undefined, `Reviewed ${DEMO_NOW.toISOString().slice(0, 10)} · RTO ${p.rtoHours}h · RPO ${p.rpoMinutes}m`);
    publish("operational-risk.bcm.plan-approved", { module: OPRISK, subject: { type: "BcmPlan", id: p.planId, title: p.process, href: "/operational-risk/bcm" }, payload: { rtoHours: p.rtoHours, rpoMinutes: p.rpoMinutes } });
  },
});

/** Submit a KRI threshold change for approval. */
export function requestKriThresholdChange(p: KriThresholdPayload, kriName: string) {
  return submitOperation<KriThresholdPayload>("operational-risk.kri.threshold-change", {
    title: `${p.kriId} thresholds: ${p.before.amber}/${p.before.red} → ${p.amber}/${p.red}`,
    subject: { type: "KRI", id: p.kriId, title: kriName, href: "/operational-risk" },
    payload: p,
    summary: [
      { label: "KRI", value: `${p.kriId} — ${kriName}` },
      { label: "Amber", value: `${p.before.amber} → ${p.amber}` },
      { label: "Red", value: `${p.before.red} → ${p.red}` },
      { label: "Reason", value: p.reason },
    ],
  });
}

// ---------------------------------------------------------------- notifications
defineTemplates([
  {
    id: "operational-risk.kri-red-breach",
    name: "KRI breach escalation",
    module: OPRISK,
    trigger: "operational-risk.kri.escalated",
    subject: "KRI {{rag}} — {{kri}} escalated to Level {{level}}",
    inApp: "{{kri}} is {{rag}} at {{value}} (Amber {{amber}} · Red {{red}}) — escalated to Level {{level}} by {{by}}.",
    body: "<p><strong>{{kri}}</strong> ({{kriId}}) is <strong>{{rag}}</strong> at {{value}}.</p><ul><li>Thresholds: Amber {{amber}} · Red {{red}}</li><li>Outside green for {{persistence}} month(s)</li><li>Control owner: {{owner}}</li><li>Escalation: Level {{level}} ({{levelRoles}})</li></ul><p>Review the KRI and record the remediation under the escalation protocol.</p>",
    tone: "danger",
    variables: [
      { name: "kri", description: "KRI name", example: "Core banking downtime (% of scheduled uptime)" },
      { name: "kriId", description: "KRI id", example: "KRI-SYS-01" },
      { name: "rag", description: "Current band", example: "Red" },
      { name: "value", description: "Current reading", example: "1.18%" },
      { name: "amber", description: "Amber threshold", example: "0.50%" },
      { name: "red", description: "Red threshold", example: "1.00%" },
      { name: "persistence", description: "Months outside green", example: "3" },
      { name: "owner", description: "Control owner", example: "Olumide Bakare — Chief Information Officer" },
      { name: "level", description: "Escalation level reached", example: "2" },
      { name: "levelRoles", description: "Roles at that level", example: "Head of Risk" },
      { name: "by", description: "Who escalated", example: "Adegoke Agnes" },
    ],
  },
  {
    id: "operational-risk.loss-above-threshold",
    name: "Loss event above threshold",
    module: OPRISK,
    trigger: "operational-risk.loss-event.logged (net loss ≥ single-event or Board materiality threshold)",
    subject: "Loss event {{eventId}} above {{thresholdName}}: {{netLoss}}",
    inApp: "{{title}} — net loss {{netLoss}} is at or above the {{thresholdName}} ({{threshold}}).",
    body: "<p>A loss event has been logged with a net loss of <strong>{{netLoss}}</strong>, at or above the {{thresholdName}} of {{threshold}}.</p><ul><li>Event: {{eventId}} — {{title}}</li><li>Event type: {{eventType}}</li><li>Business line: {{businessLine}}</li><li>Reported by: {{reportedBy}}</li></ul><p>The event is escalated under the protocol.</p>",
    tone: "danger",
    variables: [
      { name: "eventId", description: "Loss event id", example: "OLE-1ABC" },
      { name: "title", description: "Event title", example: "Fraudulent transfer via compromised mobile credentials" },
      { name: "netLoss", description: "Net loss (formatted)", example: "₦32,000,000.00" },
      { name: "threshold", description: "Threshold crossed (formatted)", example: "₦25,000,000.00" },
      { name: "thresholdName", description: "Which threshold", example: "single-event escalation threshold" },
      { name: "eventType", description: "Basel event type", example: "External fraud" },
      { name: "businessLine", description: "Business line", example: "Retail banking" },
      { name: "reportedBy", description: "Reporter", example: "Adegoke Agnes" },
    ],
  },
  {
    id: "operational-risk.bcm-test-failed",
    name: "Tier 1 BCM test failed",
    module: OPRISK,
    trigger: "operational-risk.bcm.exercise-recorded (Tier 1, Failed)",
    subject: "Tier 1 BCM test failed: {{process}}",
    inApp: "{{exercise}} for {{process}} failed — recovered in {{achieved}} against a {{target}} RTO.",
    body: "<p>The <strong>{{exercise}}</strong> for <strong>{{process}}</strong> ({{planId}}) failed.</p><ul><li>Recovery time: {{achieved}} against an RTO of {{target}}</li><li>Findings: {{findings}}</li></ul><p>A re-test is required.</p>",
    tone: "danger",
    variables: [
      { name: "exercise", description: "Exercise type", example: "DR failover" },
      { name: "process", description: "Business process", example: "Digital channels (mobile, internet, USSD)" },
      { name: "planId", description: "BCM plan id", example: "BCP-303" },
      { name: "achieved", description: "Recovery time achieved", example: "6h" },
      { name: "target", description: "RTO target", example: "4h" },
      { name: "findings", description: "Number of findings", example: "4" },
    ],
  },
]);

/** Notify parties about a newly logged loss event when it crosses a threshold (call after logging). */
export function notifyLossThresholds(e: LossEvent, fmt: (v: number) => string) {
  const net = netLoss(e);
  const single = getRule<number>(orKeys.singleEvent);
  const board = getRule<number>(orKeys.boardMateriality);
  const base = { eventId: e.id, title: e.title, netLoss: fmt(net), eventType: e.eventType, businessLine: e.businessLine, reportedBy: e.reportedBy };
  const href = "/operational-risk/loss-events";
  if (net >= board) notify({ templateId: "operational-risk.loss-above-threshold", toRoles: getRule<RoleId[]>(orKeys.lossBoardRoles), href, data: { ...base, threshold: fmt(board), thresholdName: "Board materiality threshold" } });
  if (net >= single) notify({ templateId: "operational-risk.loss-above-threshold", toRoles: getRule<RoleId[]>(orKeys.lossEscalationRoles), href, data: { ...base, threshold: fmt(single), thresholdName: "single-event escalation threshold" } });
}

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "operational-risk.kri.escalated", module: OPRISK, description: "A KRI breach was escalated to the next level.", payloadExample: { from: 1, to: 2, rag: "red" } },
  { name: "operational-risk.kri.acknowledged", module: OPRISK, description: "An Amber/Red KRI reading was acknowledged." },
  { name: "operational-risk.kri.thresholds-changed", module: OPRISK, description: "A KRI's Amber/Red thresholds changed (after approval)." },
  { name: "operational-risk.kri.commentary-adopted", module: OPRISK, description: "The AI-drafted KRI commentary was signed off." },
  { name: "operational-risk.loss-event.logged", module: OPRISK, description: "A loss event or near miss was logged.", payloadExample: { netLoss: 32000000, aboveThreshold: true } },
  { name: "operational-risk.loss-event.status-changed", module: OPRISK, description: "A loss event moved to the next investigation stage." },
  { name: "operational-risk.loss-event.recovery-recorded", module: OPRISK, description: "A recovery was recorded against a loss event." },
  { name: "operational-risk.loss-event.closed", module: OPRISK, description: "A loss event was closed and the remainder written off (after approval)." },
  { name: "operational-risk.rcsa.submitted", module: OPRISK, description: "A self-assessment was submitted for second-line sign-off." },
  { name: "operational-risk.rcsa.signed-off", module: OPRISK, description: "A self-assessment was signed off by the second line." },
  { name: "operational-risk.rcsa.returned", module: OPRISK, description: "A self-assessment sign-off was rejected and returned." },
  { name: "operational-risk.rcsa.action-completed", module: OPRISK, description: "An RCSA action plan was completed." },
  { name: "operational-risk.bcm.exercise-recorded", module: OPRISK, description: "A BCM test / exercise result was recorded." },
  { name: "operational-risk.bcm.plan-approved", module: OPRISK, description: "A BCM plan review was approved." },
]);

defineHookPoints([
  { point: "operational-risk.kri.escalate.before", module: OPRISK, kind: "before", description: "Before a KRI breach is escalated. Veto to block, or enrich the escalation note." },
  { point: "operational-risk.kri.escalate.after", module: OPRISK, kind: "after", description: "After a KRI breach is escalated and notified (e.g. open a ticket)." },
  { point: "operational-risk.loss-event.log.before", module: OPRISK, kind: "before", description: "Before a loss event is saved. Veto (e.g. duplicate check) or enrich the record." },
  { point: "operational-risk.loss-event.log.after", module: OPRISK, kind: "after", description: "After a loss event is saved, audited and notified." },
  { point: "operational-risk.bcm.exercise.before", module: OPRISK, kind: "before", description: "Before a BCM test result is recorded. Veto or enrich." },
  { point: "operational-risk.bcm.exercise.after", module: OPRISK, kind: "after", description: "After a BCM test result is recorded." },
]);

/** AI commentary adopted through the AI sign-off operation (ai.output.signed-off) → mark it on the KRI page. */
subscribe({
  id: "operational-risk.adopt-kri-commentary",
  name: "Operational risk: adopt signed-off KRI commentary",
  pattern: "ai.output.signed-off",
  handler: (event) => {
    const p = event.payload as { activityId?: string };
    if (p.activityId !== "AIA-KRI-COMMENTARY") return;
    useOpRisk.getState().signOffCommentary(event.actorName);
    publish("operational-risk.kri.commentary-adopted", { module: OPRISK, subject: { type: "AiOutput", id: "AIA-KRI-COMMENTARY", href: "/operational-risk" } });
  },
});
