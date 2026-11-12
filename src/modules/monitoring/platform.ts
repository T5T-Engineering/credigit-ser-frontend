"use client";

/**
 * Platform registrations for the Loan review & monitoring module (PRD §6.4): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md → Platform services.
 *
 * This file must not statically import the module store/service (they read these rules while seeding) — operation
 * handlers load the service lazily.
 */
import type { RoleId } from "@/lib/rbac/roles";
import { defineEvents } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineTemplates } from "@/lib/platform/notifications";
import { registerOperation, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, type RuleDefinition } from "@/lib/platform/rules";

const DEMO = "Tenant parameter (demo value)";
const M = "monitoring";

/** Exception types that may only close with curing evidence (PRD §6.4.4). Default for `monitoring.exceptions.evidenceRequiredTypes`. */
const EVIDENCE_REQUIRED_DEFAULT = ["Past-due obligation", "Covenant breach", "Limit near-breach"];

/** Default Nature-of-Business classification per sector (PRD §6.4.3). Tenant configuration — one rule per sector. */
const NATURE_DEFAULTS: Record<string, string> = {
  "SEC-AGR": "Seasonal",
  "SEC-EDU": "Seasonal",
  "SEC-CON": "Project / Milestone-based",
  "SEC-RES": "Project / Milestone-based",
  "SEC-GOV": "Project / Milestone-based",
  "SEC-PWR": "Project / Milestone-based",
  "SEC-MFG": "Cyclical",
  "SEC-OGU": "Cyclical",
  "SEC-OGD": "Cyclical",
  "SEC-MIN": "Cyclical",
  "SEC-COM": "Steady / Regular",
  "SEC-ICT": "Steady / Regular",
  "SEC-HLT": "Steady / Regular",
  "SEC-FIN": "Steady / Regular",
  "SEC-TRN": "Steady / Regular",
};
export const natureSectorIds = Object.keys(NATURE_DEFAULTS);
const natureOptions = ["Steady / Regular", "Seasonal", "Project / Milestone-based", "Cyclical"].map((v) => ({ value: v, label: v }));

const ladderDefaults: { level: 1 | 2 | 3 | 4; roles: RoleId[] }[] = [
  { level: 1, roles: ["account-officer", "loan-review-officer"] },
  { level: 2, roles: ["group-head", "bdm", "credit-admin-officer"] },
  { level: 3, roles: ["cco", "head-of-risk"] },
  { level: 4, roles: ["cro"] },
];

// ---------------------------------------------------------------- business rules
defineRules([
  // CBN days-past-due ladder (PRD §6.4.1, §6.7.1)
  { key: "monitoring.dpd.watchlistFromDays", label: "Watchlist from (DPD)", description: "Days past due at which a facility moves to Watchlist / IFRS 9 Stage 2.", module: M, category: "Days-past-due ladder", type: "number", unit: "days", default: 30, min: 1, max: 89, source: "(CBN prudential guidelines)" },
  { key: "monitoring.dpd.substandardFromDays", label: "Sub-Standard / non-performing from (DPD)", description: "Days past due at which a facility is non-performing (Sub-Standard, Stage 3).", module: M, category: "Days-past-due ladder", type: "number", unit: "days", default: 90, min: 30, max: 179, source: "(CBN prudential guidelines)" },
  { key: "monitoring.dpd.doubtfulFromDays", label: "Doubtful from (DPD)", description: "Days past due at which a facility is classified Doubtful.", module: M, category: "Days-past-due ladder", type: "number", unit: "days", default: 180, min: 90, max: 359, source: "(CBN prudential guidelines)" },
  { key: "monitoring.dpd.lostFromDays", label: "Lost from (DPD)", description: "Days past due at which a facility is classified Lost.", module: M, category: "Days-past-due ladder", type: "number", unit: "days", default: 360, min: 180, max: 1000, source: "(CBN prudential guidelines)" },
  { key: "monitoring.cbn.substandardProvisionPct", label: "CBN specific provision — Sub-Standard", description: "Specific provision shown for the Sub-Standard bucket.", module: M, category: "Days-past-due ladder", type: "percent", unit: "%", default: 10, min: 0, max: 100, source: "(CBN prudential guidelines)" },
  { key: "monitoring.cbn.doubtfulProvisionPct", label: "CBN specific provision — Doubtful", description: "Specific provision shown for the Doubtful bucket.", module: M, category: "Days-past-due ladder", type: "percent", unit: "%", default: 50, min: 0, max: 100, source: "(CBN prudential guidelines)" },
  { key: "monitoring.cbn.lostProvisionPct", label: "CBN specific provision — Lost", description: "Specific provision shown for the Lost bucket.", module: M, category: "Days-past-due ladder", type: "percent", unit: "%", default: 100, min: 0, max: 100, source: "(CBN prudential guidelines)" },

  // Exception escalation protocol (PRD §6.4.4)
  ...ladderDefaults.flatMap(({ level, roles }): RuleDefinition[] => [
    {
      key: `monitoring.escalation.l${level}SlaBusinessDays`,
      label: `Level ${level} cure SLA`,
      description: level < 4 ? `Business days an exception may sit at Level ${level} before it escalates to Level ${level + 1}.` : "Business days between Level 4 re-timestamps and re-notifications until cured.",
      module: M,
      category: "Escalation protocol",
      type: "duration",
      durationUnit: "days",
      unit: "business days",
      default: 5,
      min: 1,
      max: 60,
      source: `${DEMO}`,
    },
    {
      key: `monitoring.escalation.l${level}Roles`,
      label: `Level ${level} notified roles`,
      description: `Roles notified (dashboard + email) when an exception reaches Level ${level}.`,
      module: M,
      category: "Escalation protocol",
      type: "roles",
      default: roles,
      source: "Platform default",
    },
  ]),
  { key: "monitoring.escalation.boardRoles", label: "Board Risk Committee roles (Level 4, material)", description: "Additional roles notified at Level 4 for exceptions above the materiality threshold.", module: M, category: "Escalation protocol", type: "roles", default: ["board"], source: "Platform default" },
  { key: "monitoring.escalation.boardMaterialityNgn", label: "Board materiality threshold", description: "Exception exposure above which Level 4 also notifies the Board Risk Committee.", module: M, category: "Escalation protocol", type: "money", default: 1_000_000_000, min: 0, source: `${DEMO}` },
  { key: "monitoring.exceptions.evidenceRequiredTypes", label: "Types that close only with evidence", description: "Exception types for which a manual “mark as resolved” without curing evidence is not permitted.", module: M, category: "Exceptions", type: "list", default: EVIDENCE_REQUIRED_DEFAULT, source: "Platform default" },
  { key: "monitoring.exceptions.minEvidenceLength", label: "Minimum evidence reference length", description: "Characters required in the curing-evidence reference.", module: M, category: "Exceptions", type: "number", unit: "characters", default: 3, min: 1, max: 200, source: DEMO },
  { key: "monitoring.exceptions.minDetailLength", label: "Minimum exception detail length", description: "Characters required when raising an exception manually.", module: M, category: "Exceptions", type: "number", unit: "characters", default: 5, min: 1, max: 500, source: DEMO },
  { key: "monitoring.exceptions.minReasonLength", label: "Minimum escalation / release reason", description: "Characters required in a manual escalation or release reason.", module: M, category: "Exceptions", type: "number", unit: "characters", default: 10, min: 1, max: 500, source: DEMO },

  // Account inflows (PRD §6.4.3)
  { key: "monitoring.inflow.envelopeBandPct", label: "Inflow envelope half-width", description: "Expected inflow ± this percentage forms the floor / ceiling of the envelope.", module: M, category: "Account inflows", type: "percent", unit: "%", default: 25, min: 1, max: 100, source: `${DEMO}` },
  { key: "monitoring.inflow.offSeasonIndexBelow", label: "Off-season seasonal index", description: "Seasonal obligors whose 3-month seasonal index is below this value are treated as off-season (silence is not an exception).", module: M, category: "Account inflows", type: "number", step: 0.05, default: 0.9, min: 0, max: 2, source: `${DEMO}` },
  ...natureSectorIds.map(
    (sectorId): RuleDefinition => ({
      key: `monitoring.nature.${sectorId}`,
      label: `Nature of business — ${sectorId}`,
      description: `Inflow profile applied to obligors in sector ${sectorId}.`,
      module: M,
      category: "Nature-of-Business profile",
      type: "enum",
      options: natureOptions,
      default: NATURE_DEFAULTS[sectorId]!,
      source: `${DEMO}`,
    }),
  ),
  { key: "monitoring.nature.default", label: "Nature of business — other sectors", description: "Inflow profile for sectors without a specific classification.", module: M, category: "Nature-of-Business profile", type: "enum", options: natureOptions, default: "Steady / Regular", source: `${DEMO}` },

  // Covenants, APGs, TODs (PRD §6.4.2, §6.4.3)
  { key: "monitoring.covenant.dueSoonDays", label: "Covenant test due window", description: "Covenant tests falling due within this many days are shown as due.", module: M, category: "Covenants", type: "duration", durationUnit: "days", default: 30, min: 1, max: 180, source: DEMO },
  { key: "monitoring.periodic.nextDueDays", label: "Periodic financials cycle", description: "Days until the next periodic financials are due after a submission is analysed.", module: M, category: "Periodic analysis", type: "duration", durationUnit: "days", default: 92, min: 1, max: 400, source: `${DEMO}` },
  { key: "monitoring.apg.expiryWarningDays", label: "APG expiry warning", description: "Advance payment guarantees expiring within this many days are flagged.", module: M, category: "Guarantees & overdrafts", type: "duration", durationUnit: "days", default: 30, min: 1, max: 180, source: DEMO },
  { key: "monitoring.tod.regularisationDays", label: "TOD regularisation window", description: "Days within which a temporary overdraft / excess must be regularised.", module: M, category: "Guarantees & overdrafts", type: "duration", durationUnit: "days", default: 30, min: 1, max: 89, source: DEMO },
  { key: "monitoring.tod.nonPerformingDays", label: "Unregularised TOD non-performing after", description: "Excess-over-limit, matured-without-renewal and undocumented facilities not regularised within this period are classified non-performing.", module: M, category: "Guarantees & overdrafts", type: "duration", durationUnit: "days", default: 90, min: 1, max: 365, source: "(CBN 12.10)" },
  { key: "monitoring.assignment.roles", label: "Assignable monitoring roles", description: "Roles that can be assigned as the monitoring officer of a facility.", module: M, category: "Assignments", type: "roles", default: ["loan-review-officer", "account-officer"], source: DEMO },
]);

// ---------------------------------------------------------------- operations (approvals)
// TD-602: default approvers are proposals (OPEN-QUESTIONS MON1–3 / COL1–2); tenants edit them in Operations → Workflows.
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });
const service = () => import("./service");

export type ResolvePayload = { exceptionId: string; evidence: string; note?: string };
export type EscalatePayload = { exceptionId: string; reason: string };
export type ApgReleasePayload = { apgId: string; note: string; before: string };

registerOperation<ResolvePayload>({
  type: "monitoring.exception.resolve",
  name: "Exception resolution sign-off",
  module: M,
  description: "Close a monitoring exception as cured, with time-stamped curing evidence. The exception stays open until approved.",
  defaultSteps: [step("signoff", "Resolution sign-off", ["head-of-risk", "cco"], 24)],
  apply: async (p, { actor, instance }) => (await service()).applyResolution(p, actor, instance.id),
  onReject: (p, { actor, instance }) => void service().then((s) => s.resolutionRejected(p, actor, instance.id)),
});

registerOperation<EscalatePayload>({
  type: "monitoring.exception.escalate",
  name: "Manual exception escalation",
  module: M,
  description: "Escalate an exception ahead of its SLA (out-of-cycle). SLA-lapse escalations run automatically under the protocol.",
  defaultSteps: [step("signoff", "Escalation sign-off", ["head-of-risk", "cco"], 8)],
  apply: async (p, { actor, instance }) => {
    await (await service()).escalateException(p.exceptionId, { reason: p.reason, actor, operationId: instance.id });
  },
});

registerOperation<ApgReleasePayload>({
  type: "monitoring.apg.release",
  name: "Guarantee release",
  module: M,
  description: "Release an advance payment / bank guarantee on expiry or discharge — removes the contingent exposure.",
  defaultSteps: [step("approve", "Credit release approval", ["cco", "credit-admin-officer"], 24)],
  apply: async (p, { actor, instance }) => (await service()).applyApgRelease(p, actor, instance.id),
});

// ---------------------------------------------------------------- notification templates
defineTemplates([
  {
    id: "monitoring.exception-raised",
    name: "Exception raised",
    module: M,
    trigger: "monitoring.exception.raised",
    subject: "Exception {{exceptionId}}: {{type}} — {{obligor}}",
    inApp: "{{type}} raised for {{obligor}} at Level 1 — cure by {{slaDue}}.",
    body: "<p>A monitoring exception was raised and entered the escalation protocol at <strong>Level 1</strong>.</p><ul><li>Obligor: {{obligor}}</li><li>Type: {{type}}</li><li>Detail: {{detail}}</li><li>Exposure: {{amount}}</li><li>Cure by: {{slaDue}}</li></ul><p>The exception stays open until it is cured and evidenced.</p>",
    tone: "warning",
    variables: [
      { name: "exceptionId", description: "Exception reference", example: "EXC-6101" },
      { name: "type", description: "Exception type", example: "Past-due obligation" },
      { name: "obligor", description: "Obligor name", example: "Lagoon Foods Ltd" },
      { name: "detail", description: "What was detected", example: "Term loan FAC-1002 is 47 days past due." },
      { name: "amount", description: "Exposure (formatted, or —)", example: "₦420.0m" },
      { name: "slaDue", description: "Level 1 cure deadline", example: "17 Nov 2026, 09:00" },
    ],
  },
  {
    id: "monitoring.exception-escalated",
    name: "Exception escalated",
    module: M,
    trigger: "monitoring.exception.escalated",
    subject: "Escalated to Level {{level}}: {{type}} — {{obligor}}",
    inApp: "{{exceptionId}} escalated to Level {{level}} ({{reason}}). Cure by {{slaDue}}.",
    body: "<p>Exception <strong>{{exceptionId}}</strong> for {{obligor}} has been escalated to <strong>Level {{level}}</strong>.</p><ul><li>Type: {{type}}</li><li>Reason: {{reason}}</li><li>Open for: {{age}} days</li><li>Next cure deadline: {{slaDue}}</li></ul><p>You are named on the escalation ladder for this level.</p>",
    tone: "danger",
    variables: [
      { name: "exceptionId", description: "Exception reference", example: "EXC-6101" },
      { name: "type", description: "Exception type", example: "Covenant breach" },
      { name: "obligor", description: "Obligor name", example: "Lagoon Foods Ltd" },
      { name: "level", description: "New escalation level (1–4)", example: "3" },
      { name: "reason", description: "Why it escalated", example: "Level 2 SLA lapsed uncured" },
      { name: "age", description: "Days since raised", example: "12" },
      { name: "slaDue", description: "Next cure deadline", example: "24 Nov 2026, 09:00" },
    ],
  },
  {
    id: "monitoring.exception-resolved",
    name: "Exception cured",
    module: M,
    trigger: "monitoring.exception.resolved",
    subject: "Cured: {{exceptionId}} — {{obligor}}",
    inApp: "{{exceptionId}} ({{type}}) closed as cured — evidence: {{evidence}}.",
    body: "<p>Exception <strong>{{exceptionId}}</strong> ({{type}}) for {{obligor}} was closed as cured after sign-off by {{approvedBy}}.</p><ul><li>Evidence: {{evidence}}</li><li>Highest level reached: {{level}}</li></ul>",
    tone: "success",
    variables: [
      { name: "exceptionId", description: "Exception reference", example: "EXC-6101" },
      { name: "type", description: "Exception type", example: "Past-due obligation" },
      { name: "obligor", description: "Obligor name", example: "Lagoon Foods Ltd" },
      { name: "evidence", description: "Curing evidence reference", example: "CBA credit ref FT26314XK2" },
      { name: "level", description: "Level at closure", example: "2" },
      { name: "approvedBy", description: "Who signed off", example: "Chinedu Okafor" },
    ],
  },
  {
    id: "monitoring.covenant-breached",
    name: "Covenant breach",
    module: M,
    trigger: "monitoring.covenant.breached",
    subject: "Covenant breach — {{obligor}} ({{facilityId}})",
    inApp: "Covenant test failed for {{obligor}}: {{covenant}} — {{result}}.",
    body: "<p>A covenant test <strong>failed</strong> for {{obligor}} on facility {{facilityId}}.</p><ul><li>Covenant: {{covenant}}</li><li>Result: {{result}}</li><li>Evidence: {{evidence}}</li><li>Tested by: {{testedBy}}</li></ul><p>A covenant-breach exception enters the escalation protocol.</p>",
    tone: "danger",
    variables: [
      { name: "obligor", description: "Obligor name", example: "Lagoon Foods Ltd" },
      { name: "facilityId", description: "Facility", example: "FAC-1002" },
      { name: "covenant", description: "Covenant text", example: "Debt service cover ratio ≥ 1.25x" },
      { name: "result", description: "Test result", example: "Failed — DSCR 0.94x" },
      { name: "evidence", description: "Evidence reference", example: "Q3 2026 management accounts.pdf" },
      { name: "testedBy", description: "Officer who recorded the test", example: "Ada Obi" },
    ],
  },
]);

// ---------------------------------------------------------------- events & hook points
defineEvents([
  { name: "monitoring.exception.raised", module: M, description: "An exception entered the escalation protocol at Level 1.", payloadExample: { type: "Past-due obligation", obligorId: "OBL-1001", amount: 420000000 } },
  { name: "monitoring.exception.escalated", module: M, description: "An exception moved up a level (SLA lapse or approved manual escalation), or was re-notified at Level 4.", payloadExample: { from: 2, to: 3, reason: "Level 2 SLA lapsed uncured" } },
  { name: "monitoring.exception.status-changed", module: M, description: "An exception moved between Raised / Under review / re-opened." },
  { name: "monitoring.exception.resolution-requested", module: M, description: "Curing evidence was submitted for sign-off." },
  { name: "monitoring.exception.resolved", module: M, description: "An exception was closed as cured after sign-off." },
  { name: "monitoring.exception.commented", module: M, description: "A comment was added to an exception." },
  { name: "monitoring.escalation.swept", module: M, description: "The escalation sweep ran over lapsed SLAs.", payloadExample: { escalated: 3 } },
  { name: "monitoring.covenant.tested", module: M, description: "A covenant test result was recorded." },
  { name: "monitoring.covenant.breached", module: M, description: "A covenant test failed." },
  { name: "monitoring.apg.status-changed", module: M, description: "An APG was crystallised or called." },
  { name: "monitoring.apg.released", module: M, description: "An APG release was approved and applied." },
  { name: "monitoring.tod.status-changed", module: M, description: "A temporary overdraft was regularised or converted." },
  { name: "monitoring.facility.assigned", module: M, description: "A monitoring officer was assigned to a facility." },
  { name: "monitoring.facility.noted", module: M, description: "A monitoring note was added to a facility." },
  { name: "monitoring.ai-flag.signed-off", module: M, description: "A human accepted or dismissed an AI-flagged inflow deviation." },
]);

defineHookPoints([
  { point: "monitoring.exception.raise.before", module: M, kind: "before", description: "Before an exception is raised. Veto to suppress (e.g. duplicate detection) or enrich the detail." },
  { point: "monitoring.exception.raise.after", module: M, kind: "after", description: "After an exception is raised and Level 1 notified." },
  { point: "monitoring.exception.escalate.before", module: M, kind: "before", description: "Before an exception escalates (sweep or approved manual escalation). Veto to hold it at its level." },
  { point: "monitoring.exception.escalate.after", module: M, kind: "after", description: "After an exception escalated and the new level was notified." },
  { point: "monitoring.exception.resolve.before", module: M, kind: "before", description: "Before curing evidence is submitted for sign-off. Veto to reject weak evidence." },
  { point: "monitoring.exception.resolve.after", module: M, kind: "after", description: "After an exception is closed as cured." },
  { point: "monitoring.covenant.test.before", module: M, kind: "before", description: "Before a covenant test result is recorded. Veto or enrich the result." },
  { point: "monitoring.covenant.test.after", module: M, kind: "after", description: "After a covenant test result is recorded." },
]);
