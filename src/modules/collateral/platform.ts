"use client";

/**
 * Platform registrations for the Collateral & legal module (PRD §6.5, §6.7.3, §5.7): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md → Platform services.
 * Operation handlers load the module service lazily (no static store imports here).
 */
import type { CollateralType } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";
import { defineEvents } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineTemplates } from "@/lib/platform/notifications";
import { registerOperation, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, type RuleDefinition } from "@/lib/platform/rules";

const DEMO = "Tenant parameter (demo value)";
const M = "collateral";

/** Rule-key slug for a collateral type: "Cash / lien on deposit" → "cash-lien-on-deposit". */
export const typeSlug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Collateral types outside the PRD §6.7.3 table — tenant-configured haircuts (demo values). */
const tenantHaircuts: [CollateralType, number][] = [
  ["Equitable mortgage", 50],
  ["Debenture", 50],
  ["Vehicle", 40],
  ["Equipment", 45],
  ["Domiciliation of proceeds", 60],
  ["Personal guarantee", 100],
  ["Corporate guarantee", 70],
  ["Insurance policy", 50],
];

const haircut = (key: string, label: string, def: number, source: string): RuleDefinition => ({
  key: `collateral.haircut.${key}`,
  label: `Haircut — ${label}`,
  description: `Haircut weighting applied to ${label.toLowerCase()} (value × (1 − haircut)).`,
  module: M,
  category: "Haircut weightings",
  type: "percent",
  unit: "%",
  default: def,
  min: 0,
  max: 100,
  source,
});

// ---------------------------------------------------------------- business rules
defineRules([
  haircut("cash", "Cash / deposits with the lending bank", 0, "PRD §6.7.3"),
  haircut("quotedShares", "Quoted equities & other traded securities", 20, "PRD §6.7.3"),
  haircut("residentialMortgage", "Residential legal mortgage", 50, "PRD §6.7.3"),
  haircut("commercialMortgage", "Commercial legal mortgage", 50, "PRD §6.7.3"),
  ...tenantHaircuts.map(([t, v]) => haircut(typeSlug(t), t, v, `PRD §6.7.3 (type not listed) — ${DEMO}`)),
  { key: "collateral.haircut.residentialKeywords", label: "Residential mortgage keywords", description: "Words in a mortgage description that classify it as residential (else commercial).", module: M, category: "Haircut weightings", type: "list", default: ["duplex", "plot"], source: DEMO },
  { key: "collateral.perfection.stallDays", label: "Perfection stall alert", description: "Raise an alert when perfection on a live facility has not completed within this many days of valuation.", module: M, category: "Monitoring alerts", type: "duration", durationUnit: "days", default: 90, min: 1, max: 365, source: `PRD §6.4.2 — ${DEMO}` },
  { key: "collateral.revaluation.warningDays", label: "Revaluation due warning", description: "Warn when a revaluation falls due within this many days.", module: M, category: "Monitoring alerts", type: "duration", durationUnit: "days", default: 90, min: 1, max: 365, source: `PRD §6.4.2 — ${DEMO}` },
  { key: "collateral.revaluation.cycleMonths", label: "Revaluation cycle", description: "Months until the next revaluation after a valuation is recorded.", module: M, category: "Valuation", type: "number", unit: "months", default: 36, min: 1, max: 120, source: `PRD §6.5 — ${DEMO}` },
  { key: "collateral.insurance.warningDays", label: "Insurance expiry warning", description: "Warn when insurance cover expires within this many days.", module: M, category: "Monitoring alerts", type: "duration", durationUnit: "days", default: 30, min: 1, max: 180, source: `PRD §6.4.2 — ${DEMO}` },
  { key: "collateral.margin.minCoverPct", label: "Margin-call cover threshold", description: "Raise a margin call when haircut-adjusted mark-to-market covers less than this share of the exposure it secures.", module: M, category: "Share-backed collateral", type: "percent", unit: "%", default: 100, min: 1, max: 300, source: `PRD §5.7, §6.4.2 — ${DEMO}` },
  { key: "collateral.valuation.bases", label: "Valuation bases", description: "Valuation bases a valuer may report.", module: M, category: "Valuation", type: "list", default: ["Market comparison approach", "Depreciated replacement cost", "Investment (income) approach"], source: DEMO },
  { key: "collateral.legal.minOpinionLength", label: "Minimum opinion / reason length", description: "Characters required in a legal opinion, query or defect reason.", module: M, category: "Legal review", type: "number", unit: "characters", default: 5, min: 1, max: 500, source: DEMO },
  { key: "collateral.documents.maxSizeMb", label: "Collateral document size limit", description: "Largest document that can be uploaded to a collateral record.", module: M, category: "Documents", type: "number", unit: "MB", default: 20, min: 1, max: 200, source: DEMO },
  { key: "collateral.documents.accept", label: "Accepted document types", description: "File extensions accepted for collateral documents.", module: M, category: "Documents", type: "text", default: ".pdf,.jpg,.png,.docx", source: DEMO },
]);

// ---------------------------------------------------------------- operations (approvals)
// TD-602: default approvers are proposals (OPEN-QUESTIONS MON1–3 / COL1–2); tenants edit them in Operations → Workflows.
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });
const service = () => import("./service");

export type VerifyPayload = { collateralId: string; marketValue: number; forcedSaleValue: number; valuer: string; reference?: string };
export type LegalSignoffPayload = { collateralId: string; opinion: string };
export type PerfectionPayload = { collateralId: string; from: string };
export type MarginReleasePayload = { collateralId: string; exceptionId?: string; evidence: string; topUp: number };

registerOperation<VerifyPayload>({
  type: "collateral.valuation.verify",
  name: "Collateral valuation verification",
  module: M,
  description: "Independent Middle Office verification of a recorded valuation before it is relied on (PRD §4.1). Rejecting queries the valuation.",
  defaultSteps: [step("mo", "Middle Office verification", ["middle-office-officer"], 48)],
  apply: async (p, { actor, instance }) => (await service()).applyVerification(p, actor, instance.id),
  onReject: (p, { actor, instance }) => void service().then((s) => s.verificationQueried(p, actor, instance)),
});

registerOperation<LegalSignoffPayload>({
  type: "collateral.legal.signoff",
  name: "Legal sufficiency sign-off",
  module: M,
  description: "Legal Officer's opinion that the security is genuine, perfected and legally sufficient, accepted by Credit Administration (PRD §6.5).",
  defaultSteps: [step("accept", "Credit Administration acceptance", ["credit-admin-officer", "cco"], 48)],
  apply: async (p, { actor, instance }) => (await service()).applyLegalSignoff(p, actor, instance.id),
});

registerOperation<PerfectionPayload>({
  type: "collateral.perfection.complete",
  name: "Perfection completion",
  module: M,
  description: "Mark security perfected (registration complete, documents vaulted) — makes the haircut adjustment eligible (CBN 12.13(a)(1)).",
  defaultSteps: [step("legal", "Legal confirmation", ["legal-officer"], 48)],
  apply: async (p, { actor, instance }) => (await service()).applyPerfectionComplete(p, actor, instance.id),
});

registerOperation<MarginReleasePayload>({
  type: "collateral.margin.release",
  name: "Margin-call release",
  module: M,
  description: "Release a share-collateral margin call once the top-up is received or cover is restored; closes the linked exception.",
  defaultSteps: [step("verify", "Cover verification", ["middle-office-officer", "head-of-risk"], 24)],
  apply: async (p, { actor, instance }) => (await service()).applyMarginRelease(p, actor, instance.id),
});

// ---------------------------------------------------------------- notification templates
defineTemplates([
  {
    id: "collateral.margin-call",
    name: "Margin call raised",
    module: M,
    trigger: "collateral.margin-call.raised",
    subject: "Margin call — {{ticker}} pledged by {{obligor}}",
    inApp: "Margin call on {{collateralId}} ({{ticker}}): cover {{cover}} — top-up of {{topUp}} required.",
    body: "<p>The haircut-adjusted mark-to-market of <strong>{{ticker}}</strong> pledged by {{obligor}} has fallen below the margin threshold.</p><ul><li>Collateral: {{collateralId}}</li><li>Cover: {{cover}} (threshold {{threshold}})</li><li>Exposure: {{exposure}}</li><li>Top-up required: <strong>{{topUp}}</strong> market value</li><li>Exception: {{exceptionId}}</li></ul>",
    tone: "danger",
    variables: [
      { name: "collateralId", description: "Collateral reference", example: "COL-2041" },
      { name: "ticker", description: "NGX ticker", example: "ZENITHBANK" },
      { name: "obligor", description: "Pledgor", example: "Lagoon Foods Ltd" },
      { name: "cover", description: "Current cover", example: "84%" },
      { name: "threshold", description: "Margin threshold (rule)", example: "100%" },
      { name: "exposure", description: "Exposure secured", example: "₦250.0m" },
      { name: "topUp", description: "Top-up market value", example: "₦50.0m" },
      { name: "exceptionId", description: "Linked exception", example: "EXC-6120" },
    ],
  },
  {
    id: "collateral.margin-call-released",
    name: "Margin call released",
    module: M,
    trigger: "collateral.margin-call.released",
    subject: "Margin call released — {{collateralId}}",
    inApp: "Margin call on {{collateralId}} released after {{approvedBy}} verified restored cover.",
    body: "<p>The margin call on <strong>{{collateralId}}</strong> ({{obligor}}) was released.</p><ul><li>Evidence: {{evidence}}</li><li>Verified by: {{approvedBy}}</li></ul>",
    tone: "success",
    variables: [
      { name: "collateralId", description: "Collateral reference", example: "COL-2041" },
      { name: "obligor", description: "Pledgor", example: "Lagoon Foods Ltd" },
      { name: "evidence", description: "Top-up evidence", example: "CSCS statement — 120,000 additional units lien-marked" },
      { name: "approvedBy", description: "Verifier", example: "Bola Ade" },
    ],
  },
  {
    id: "collateral.insurance-expiring",
    name: "Insurance expiring",
    module: M,
    trigger: "collateral.reminder.sent (insurance)",
    subject: "Insurance {{state}} — {{collateralId}} ({{obligor}})",
    inApp: "Insurance on {{collateralId}} {{state}} {{expiry}} — request the renewal certificate noting the bank's interest.",
    body: "<p>Insurance cover on <strong>{{collateralId}}</strong> ({{description}}) for {{obligor}} {{state}} on <strong>{{expiry}}</strong>.</p><p>Request the renewal certificate, endorsed to note the bank's interest, and record it on the collateral record.</p>",
    tone: "warning",
    variables: [
      { name: "collateralId", description: "Collateral reference", example: "COL-2041" },
      { name: "description", description: "Collateral description", example: "Warehouse, 14 Creek Road, Apapa" },
      { name: "obligor", description: "Obligor", example: "Lagoon Foods Ltd" },
      { name: "state", description: "“expires” or “expired”", example: "expires" },
      { name: "expiry", description: "Expiry date", example: "28 Nov 2026" },
    ],
  },
  {
    id: "collateral.revaluation-due",
    name: "Revaluation due",
    module: M,
    trigger: "collateral.reminder.sent (revaluation)",
    subject: "Revaluation {{state}} — {{collateralId}} ({{obligor}})",
    inApp: "Revaluation of {{collateralId}} {{state}} {{dueAt}}.",
    body: "<p>The periodic revaluation of <strong>{{collateralId}}</strong> ({{description}}) for {{obligor}} {{state}} <strong>{{dueAt}}</strong>.</p><p>Instruct an independent valuer and record the new valuation for Middle Office verification.</p>",
    tone: "warning",
    variables: [
      { name: "collateralId", description: "Collateral reference", example: "COL-2041" },
      { name: "description", description: "Collateral description", example: "4-bedroom duplex, Lekki" },
      { name: "obligor", description: "Obligor", example: "Lagoon Foods Ltd" },
      { name: "state", description: "“is due” or “was due”", example: "is due" },
      { name: "dueAt", description: "Due date", example: "15 Jan 2027" },
    ],
  },
  {
    id: "collateral.perfection-defect",
    name: "Perfection defect reported",
    module: M,
    trigger: "collateral.perfection.defect-reported",
    subject: "Perfection defect — {{collateralId}} ({{obligor}})",
    inApp: "{{reportedBy}} reported a defect on {{collateralId}}: {{reason}}.",
    body: "<p>Legal reported a defect in the security documents for <strong>{{collateralId}}</strong> ({{obligor}}).</p><ul><li>Reason: {{reason}}</li><li>Reported by: {{reportedBy}}</li></ul><p>The haircut adjustment is not eligible until the defect is cured.</p>",
    tone: "danger",
    variables: [
      { name: "collateralId", description: "Collateral reference", example: "COL-2041" },
      { name: "obligor", description: "Obligor", example: "Lagoon Foods Ltd" },
      { name: "reason", description: "Defect", example: "Deed not stamped" },
      { name: "reportedBy", description: "Legal Officer", example: "Ngozi Eze" },
    ],
  },
  {
    id: "collateral.valuation-queried",
    name: "Valuation queried",
    module: M,
    trigger: "collateral.valuation.queried",
    subject: "Valuation queried — {{collateralId}}",
    inApp: "Middle Office queried the valuation of {{collateralId}}: {{reason}}.",
    body: "<p>Middle Office did not verify the valuation of <strong>{{collateralId}}</strong> ({{obligor}}).</p><ul><li>Query: {{reason}}</li><li>Raised by: {{by}}</li></ul><p>Confirm the assumptions with the valuer and record a revised valuation.</p>",
    tone: "warning",
    variables: [
      { name: "collateralId", description: "Collateral reference", example: "COL-2041" },
      { name: "obligor", description: "Obligor", example: "Lagoon Foods Ltd" },
      { name: "reason", description: "Query text", example: "FSV assumption looks optimistic" },
      { name: "by", description: "Middle Office officer", example: "Bola Ade" },
    ],
  },
]);

// ---------------------------------------------------------------- events & hook points
defineEvents([
  { name: "collateral.collateral.registered", module: M, description: "Collateral was registered against a facility." },
  { name: "collateral.valuation.recorded", module: M, description: "A valuation was recorded and sent for Middle Office verification." },
  { name: "collateral.valuation.verified", module: M, description: "Middle Office verified a valuation (operation approved)." },
  { name: "collateral.valuation.queried", module: M, description: "Middle Office queried a valuation (operation rejected)." },
  { name: "collateral.perfection.advanced", module: M, description: "Perfection moved to the next step." },
  { name: "collateral.perfection.completed", module: M, description: "Perfection completed (operation approved)." },
  { name: "collateral.perfection.defect-reported", module: M, description: "Legal reported a defect." },
  { name: "collateral.perfection.defect-cured", module: M, description: "A reported defect was cured." },
  { name: "collateral.legal.search-recorded", module: M, description: "A legal search result was recorded." },
  { name: "collateral.legal.genuineness-confirmed", module: M, description: "Genuineness / authenticity of documents confirmed." },
  { name: "collateral.legal.vaulted", module: M, description: "Security documents were vaulted." },
  { name: "collateral.legal.checked-out", module: M, description: "Vaulted documents were checked out or returned." },
  { name: "collateral.legal.signed-off", module: M, description: "Legal sufficiency sign-off accepted (operation approved)." },
  { name: "collateral.insurance.renewed", module: M, description: "An insurance renewal was recorded." },
  { name: "collateral.document.uploaded", module: M, description: "A document was uploaded to a collateral record." },
  { name: "collateral.margin-call.raised", module: M, description: "A margin call / top-up request was raised on share collateral." },
  { name: "collateral.margin-call.released", module: M, description: "A margin call was released (operation approved)." },
  { name: "collateral.prices.refreshed", module: M, description: "Share prices were refreshed (simulated CSCS feed) or reset." },
  { name: "collateral.reminder.sent", module: M, description: "Insurance / revaluation reminders were sent." },
]);

defineHookPoints([
  { point: "collateral.valuation.record.before", module: M, kind: "before", description: "Before a valuation is recorded. Veto (e.g. valuer not on the panel) or enrich." },
  { point: "collateral.valuation.record.after", module: M, kind: "after", description: "After a valuation is recorded and sent for verification." },
  { point: "collateral.perfection.advance.before", module: M, kind: "before", description: "Before perfection advances or completion is requested. Veto to hold it." },
  { point: "collateral.perfection.advance.after", module: M, kind: "after", description: "After perfection advanced." },
  { point: "collateral.legal.signoff.before", module: M, kind: "before", description: "Before a legal sufficiency sign-off is submitted. Veto to block." },
  { point: "collateral.legal.signoff.after", module: M, kind: "after", description: "After a legal sign-off is accepted." },
  { point: "collateral.margin-call.raise.before", module: M, kind: "before", description: "Before a margin call is raised. Veto (e.g. corporate action pending) or enrich." },
  { point: "collateral.margin-call.raise.after", module: M, kind: "after", description: "After a margin call is raised." },
]);
