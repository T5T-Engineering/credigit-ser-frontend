"use client";

/**
 * Platform registrations for the origination module: business rules, operation types (Operations workflow),
 * notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md → Platform services.
 *
 * The credit chart-flow rules (`origination.chartFlow.*`, `origination.fastTrack.*`) are defined in
 * src/lib/workflow.ts (imported below) because the demo seed needs them before module registrations load.
 */
import type { CollateralType } from "@/lib/data/types";
import { useDb } from "@/lib/data/store";
import { defineEvents, subscribe } from "@/lib/platform/events";
import { defineHookPoints, registerHook } from "@/lib/platform/hooks";
import { defineTemplates, type NotificationTemplate } from "@/lib/platform/notifications";
import { currentStep, registerOperation, useOperationsStore, type OperationInstance, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, getRule, type RuleDefinition } from "@/lib/platform/rules";
import type { Actor } from "@/lib/platform/scope";
import { approvalStepsFor, getChartFlow, getFastTrackTier, TIER_SLOTS } from "@/lib/workflow";
import {
  applyLimitException,
  applyOverride,
  CREDIT_OP_PREFIX,
  hasStepUp,
  isCreditOp,
  LIMIT_EXCEPTION_OP,
  onCreditApproved,
  onCreditCancelled,
  onCreditRejected,
  onCreditReturned,
  OVERRIDE_OP,
  seedCreditOperations,
  syncFromOperation,
  type CreditPayload,
  type OverridePayload,
} from "./actions";
import { useOriginationStore } from "./data";
import { slug } from "./params";

const M = "origination";
const DEMO = "Tenant parameter (demo value)";

// ---------------------------------------------------------------- business rules

const collateralTypes: { type: CollateralType; haircut: number }[] = [
  { type: "Legal mortgage", haircut: 30 },
  { type: "Equitable mortgage", haircut: 40 },
  { type: "Debenture", haircut: 50 },
  { type: "Quoted shares", haircut: 40 },
  { type: "Cash / lien on deposit", haircut: 0 },
  { type: "Vehicle", haircut: 40 },
  { type: "Equipment", haircut: 45 },
  { type: "Domiciliation of proceeds", haircut: 60 },
  { type: "Personal guarantee", haircut: 100 },
  { type: "Corporate guarantee", haircut: 70 },
  { type: "Insurance policy", haircut: 50 },
];

const rule = (r: Omit<RuleDefinition, "module">): RuleDefinition => ({ module: M, ...r });

defineRules([
  // Limits & exposure (PRD §5.6 / CBN prudential guidelines)
  rule({ key: "origination.singleObligorPct", label: "Single-obligor limit", description: "Maximum exposure to one obligor as % of unimpaired shareholders' funds.", category: "Limits & exposure", type: "percent", default: 20, min: 0, max: 100, step: 0.5, source: "CBN 3.2(a)" }),
  rule({ key: "origination.largeExposurePct", label: "Large-exposure threshold", description: "Exposure at or above this % of shareholders' funds is a large exposure.", category: "Limits & exposure", type: "percent", default: 10, min: 0, max: 100, step: 0.5, source: "CBN 3.2(d)" }),
  rule({ key: "origination.offBalanceWeightPct", label: "Off-balance-sheet weighting", description: "Weight applied to contingent (off-balance-sheet) products in the single-obligor test.", category: "Limits & exposure", type: "percent", default: 33.33, min: 0, max: 100, step: 0.01, source: "CBN 3.2(b)" }),
  rule({ key: "origination.offBalanceProducts", label: "Off-balance-sheet products", description: "Catalogue products treated as contingent for the single-obligor weighting.", category: "Limits & exposure", type: "list", default: ["Bank guarantee", "Advance payment guarantee", "Trade finance (LC)"], source: "CBN 3.2(b)" }),
  rule({ key: "origination.limitGate.warnUtilisationPct", label: "Limit utilisation warning", description: "Utilisation (% of limit) above which the limit gate shows amber.", category: "Limits & exposure", type: "percent", default: 85, min: 0, max: 100, source: DEMO }),
  rule({ key: "origination.coverage.warnPct", label: "Security cover warning", description: "Lending-value cover (%) below which security cover shows red; below 100% it shows amber.", category: "Limits & exposure", type: "percent", default: 70, min: 0, max: 100, source: DEMO }),
  // COP Ratio (PRD §6.1.4)
  rule({ key: "origination.cop.highBand", label: "COP Ratio — high confidence from", description: "COP Ratio at or above this is High confidence (declared financials at full weight).", category: "COP Ratio", type: "number", default: 0.85, min: 0, max: 2, step: 0.01, source: "(example banding)" }),
  rule({ key: "origination.cop.mediumBand", label: "COP Ratio — medium confidence from", description: "COP Ratio at or above this (and below High) is Medium confidence; below it is Low and needs an explanation.", category: "COP Ratio", type: "number", default: 0.6, min: 0, max: 2, step: 0.01, source: "(example banding)" }),
  rule({ key: "origination.cop.gaugeMax", label: "COP Ratio — gauge maximum", description: "Upper end of the COP Ratio gauge.", category: "COP Ratio", type: "number", default: 1.2, min: 1, max: 3, step: 0.05, source: DEMO }),
  rule({ key: "origination.cop.explanationMinLength", label: "COP explanation — minimum length", description: "Characters required in the customer explanation for a Low COP Ratio.", category: "COP Ratio", type: "number", default: 10, min: 1, max: 500, source: DEMO }),
  // Recommendation engine (PRD §6.1.5 names the outputs, not the rules — tenant parameters)
  rule({ key: "origination.engine.declineGradeAtOrAbove", label: "Decline at risk grade", description: "Internal risk grade (1–10) at or above which the engine recommends Decline.", category: "Recommendation engine", type: "number", default: 8, min: 1, max: 10, source: DEMO }),
  rule({ key: "origination.engine.conditionsGradeAtOrAbove", label: "Conditions at risk grade", description: "Internal risk grade at or above which the engine adds conditions.", category: "Recommendation engine", type: "number", default: 6, min: 1, max: 10, source: DEMO }),
  rule({ key: "origination.engine.minCoverPct", label: "Minimum security cover", description: "Security cover (%) below which the engine adds conditions.", category: "Recommendation engine", type: "percent", default: 100, min: 0, max: 500, source: DEMO }),
  rule({ key: "origination.override.minReasonLength", label: "Override reason — minimum length", description: "Characters required when overriding the system recommendation.", category: "Recommendation engine", type: "number", default: 10, min: 1, max: 500, source: DEMO }),
  // SLAs
  rule({ key: "origination.sla.standardDays", label: "SLA — Standard credit", description: "Calendar days from initiation to final approval (Standard chart-flow).", category: "SLA", type: "duration", durationUnit: "days", default: 10, min: 1, max: 120, source: DEMO }),
  rule({ key: "origination.sla.fastTrackDays", label: "SLA — Fast-Track credit", description: "Calendar days from initiation to final approval (Fast-Track chart-flow).", category: "SLA", type: "duration", durationUnit: "days", default: 3, min: 1, max: 60, source: DEMO }),
  rule({ key: "origination.sla.dueSoonDays", label: "SLA — due-soon window", description: "Days before the SLA date when a request shows as due soon.", category: "SLA", type: "duration", durationUnit: "days", default: 2, min: 0, max: 30, source: DEMO }),
  rule({ key: "origination.sla.warnWithinHours", label: "SLA — amber warning window", description: "Hours before a step's SLA when the countdown turns amber.", category: "SLA", type: "duration", durationUnit: "hours", default: 4, min: 0, max: 168, source: DEMO }),
  rule({ key: "origination.sla.limitExceptionHours", label: "SLA — limit exception decision", description: "Hours the CRO / Board have to decide a limit exception.", category: "SLA", type: "duration", durationUnit: "hours", default: 48, min: 1, max: 720, source: DEMO }),
  rule({ key: "origination.sla.overrideHours", label: "SLA — recommendation override review", description: "Hours to review a recommendation override.", category: "SLA", type: "duration", durationUnit: "hours", default: 24, min: 1, max: 720, source: DEMO }),
  // Products
  rule({ key: "origination.products", label: "Origination products", description: "Catalogue products offered in a new credit request.", category: "Products", type: "list", default: ["Term loan", "Overdraft", "Revolving credit", "Lease finance", "Trade finance (LC)", "Bank guarantee", "Advance payment guarantee", "Invoice discounting", "Mortgage", "Asset finance"], source: DEMO }),
  rule({ key: "origination.fastTrack.variants", label: "Fast-Track product variants", description: "Fast-Track eligible variants as “Label = Catalogue product”.", category: "Products", type: "list", default: ["APG issuance = Advance payment guarantee", "Bid bond = Bank guarantee", "Custom bond = Bank guarantee", "Temporary overdraft (TOD) = Overdraft", "Cash-backed facility = Term loan"], source: "(see docs/OPEN-QUESTIONS.md O2)" }),
  rule({ key: "origination.defaultTenorMonths", label: "Default tenor", description: "Tenor pre-filled on a new request (months).", category: "Products", type: "number", unit: "months", default: 12, min: 1, max: 360, source: DEMO }),
  // Documents (PRD §5.4)
  rule({ key: "origination.docs.required", label: "Required documents — all obligors", description: "Document kinds every application needs.", category: "Documents", type: "list", default: ["Audited financials", "Bank statement", "KYC"], source: DEMO }),
  rule({ key: "origination.docs.requiredNonRetail", label: "Required documents — non-retail", description: "Additional document kinds for corporate, commercial, SME and public-sector obligors.", category: "Documents", type: "list", default: ["Board resolution"], source: DEMO }),
  rule({ key: "origination.docs.acceptedTypes", label: "Accepted file types", description: "File extensions accepted for upload (comma-separated).", category: "Documents", type: "text", default: ".pdf,.doc,.docx,.xlsx,.png,.jpg,.jpeg,.tif", source: DEMO }),
  rule({ key: "origination.docs.maxUploadMb", label: "Maximum file size", description: "Largest file accepted for upload (MB).", category: "Documents", type: "number", unit: "MB", default: 25, min: 1, max: 500, source: DEMO }),
  rule({ key: "origination.ocr.reviewBelowPct", label: "OCR review threshold", description: "Extracted fields below this OCR confidence (%) are flagged for review.", category: "Documents", type: "percent", default: 90, min: 0, max: 100, source: DEMO }),
  // Role mappings
  rule({ key: "origination.roles.initiators", label: "Roles that initiate applications", description: "Who may create, submit, withdraw and submit for approval.", category: "Role mappings", type: "roles", default: ["account-officer", "bdm"], source: "Platform default" }),
  rule({ key: "origination.roles.analysts", label: "Roles that perform credit analysis", description: "Who runs bureau / CRMS, the limit gate, verifies documents and completes analysis.", category: "Role mappings", type: "roles", default: ["credit-analyst"], source: "Platform default" }),
  rule({ key: "origination.roles.recommenders", label: "Roles that adopt the recommendation", description: "Who adopts or overrides the engine recommendation and tags covenants.", category: "Role mappings", type: "roles", default: ["credit-analyst", "cco"], source: "Platform default" }),
  rule({ key: "origination.roles.releasers", label: "Roles that release to offer letter", description: "Who releases a fully approved request to offer-letter generation.", category: "Role mappings", type: "roles", default: ["account-officer", "bdm", "cco", "credit-analyst"], source: DEMO }),
  rule({ key: "origination.roles.uploaders", label: "Roles that upload documents", description: "Who uploads documents and new versions.", category: "Role mappings", type: "roles", default: ["account-officer", "bdm", "credit-analyst"], source: DEMO }),
  // Collateral pledged at origination
  ...collateralTypes.map((c) =>
    rule({ key: `origination.haircut.${slug(c.type)}`, label: `Haircut — ${c.type}`, description: `Haircut (%) applied to a newly pledged ${c.type.toLowerCase()} to get its lending value. TD-111: consolidate with the collateral module.`, category: "Collateral (new pledges)", type: "percent", default: c.haircut, min: 0, max: 100, source: DEMO }),
  ),
  rule({ key: "origination.collateral.forcedSalePct", label: "Forced-sale value", description: "Provisional forced-sale value of a new pledge (% of market value) until independently valued.", category: "Collateral (new pledges)", type: "percent", default: 70, min: 0, max: 100, source: DEMO }),
  rule({ key: "origination.collateral.revaluationDays", label: "First revaluation due", description: "Days after pledging when the first revaluation falls due.", category: "Collateral (new pledges)", type: "duration", durationUnit: "days", default: 365, min: 1, max: 1825, source: DEMO }),
]);

// ---------------------------------------------------------------- operation types

const step = (id: string, name: string, approverRoles: WorkflowStep["approverRoles"], slaHours: number, mode: WorkflowStep["mode"] = "any", adjudicatorRole?: WorkflowStep["adjudicatorRole"]): WorkflowStep => ({ id, name, approverRoles, mode, slaHours, adjudicatorRole });

const creditHandler = {
  module: M,
  // PRD §6.1.2: the CCO adjudicates tier-2 dissent and also co-signs tier 3, so one person may decide two steps.
  allowRepeatApprover: true,
  apply: (p: CreditPayload, ctx: { instance: OperationInstance; actor: Actor }) => onCreditApproved(p, ctx.instance, ctx.actor),
  onReject: (p: CreditPayload, ctx: { instance: OperationInstance; actor: Actor }) => onCreditRejected(p, ctx.instance, ctx.actor),
};

// One operation type per route length (TD-113): the steps are generated from the chart-flow rules each time they're read.
TIER_SLOTS.forEach((_slot, i) => {
  const n = i + 1;
  registerOperation<CreditPayload>({
    ...creditHandler,
    type: `${CREDIT_OP_PREFIX}.t${n}`,
    name: `Credit facility approval — ${n} tier${n > 1 ? "s" : ""}`,
    description: `Standard Credit chart-flow up to tier ${n}. Steps are generated from Business rules → Credit chart-flow; co-signers sign together and dissent goes to the adjudicator.`,
    get defaultSteps() {
      return approvalStepsFor(getChartFlow().slice(0, n));
    },
  });
});
registerOperation<CreditPayload>({
  ...creditHandler,
  type: `${CREDIT_OP_PREFIX}.fast-track`,
  name: "Credit facility approval — Fast-Track",
  description: "Fast-Track Credit within the Fast-Track ceiling: the co-signer pair signs together; dissent goes to the adjudicator.",
  get defaultSteps() {
    return approvalStepsFor([getFastTrackTier()]);
  },
});

registerOperation<{ applicationId: string; breach: string; justification: string }>({
  type: LIMIT_EXCEPTION_OP,
  name: "Portfolio-limit exception",
  module: M,
  description: "Informed exception decision on a single-obligor or sectoral limit breach before the request can progress.",
  get defaultSteps() {
    return [step("decide", "CRO / Board exception decision", ["cro", "board"], getRule<number>("origination.sla.limitExceptionHours"))];
  },
  apply: (p, { instance, actor }) => applyLimitException(p, instance, actor, true),
  onReject: (p, { instance, actor }) => applyLimitException(p, instance, actor, false),
});

registerOperation<OverridePayload>({
  type: OVERRIDE_OP,
  name: "Recommendation override",
  module: M,
  description: "Overriding the system recommendation needs a reason and a second-line review.",
  get defaultSteps() {
    return [step("review", "CCO / CRO review", ["cco", "cro"], getRule<number>("origination.sla.overrideHours"))];
  },
  apply: (p, { instance, actor }) => applyOverride(p, instance, actor),
});

// ---------------------------------------------------------------- notification templates

const appVars = [
  { name: "appId", description: "Application reference", example: "APP-2026037" },
  { name: "obligor", description: "Obligor name", example: "Adamawa Agro Processors Ltd" },
  { name: "amount", description: "Requested amount", example: "₦750,000,000" },
  { name: "product", description: "Product", example: "Term loan" },
  { name: "flow", description: "Chart-flow", example: "Standard" },
];
const tpl = (t: Omit<NotificationTemplate, "module">): NotificationTemplate => ({ module: M, ...t });
const facts = "<ul><li>Application: {{appId}}</li><li>Obligor: {{obligor}}</li><li>Amount: {{amount}} ({{product}}, {{flow}})</li></ul>";

defineTemplates([
  tpl({ id: "origination.application-submitted", name: "Application submitted", trigger: "origination.application.submitted", subject: "New credit request {{appId}} — {{obligor}}", inApp: "{{submittedBy}} submitted {{appId}} ({{amount}}). BDM review and Legal collateral search start in parallel.", tone: "info", body: `<p><strong>{{submittedBy}}</strong> submitted a new credit request.</p>${facts}<p>BDM: review the request. Legal: start the collateral search — the BDM can't submit until due diligence is complete.</p>`, variables: [...appVars, { name: "submittedBy", description: "Initiator", example: "Tunde Bakare" }] }),
  tpl({ id: "origination.ready-for-analysis", name: "Ready for credit analysis", trigger: "origination.application.sent-to-analysis", subject: "Ready for analysis: {{appId}} — {{obligor}}", inApp: "{{appId}} is ready for credit analysis.", tone: "info", body: `<p>Documents for this request are extracted and it is ready for credit analysis.</p>${facts}<p>Validate the financials, run bureau / CRMS, the COP Ratio and the limit gate, then complete analysis.</p>`, variables: [...appVars, { name: "sentBy", description: "Who sent it", example: "Tunde Bakare" }] }),
  tpl({ id: "origination.analysis-complete", name: "Analysis complete — submit for approval", trigger: "origination.application.analysis-completed", subject: "Analysis complete: submit {{appId}} for approval", inApp: "{{analyst}} completed analysis of {{appId}} ({{recommendation}}). Submit it for approval.", tone: "success", body: `<p><strong>{{analyst}}</strong> completed the credit analysis.</p>${facts}<p>Recommendation: <strong>{{recommendation}}</strong>.</p><p>Submit the request for approval to start the chart-flow.</p>`, variables: [...appVars, { name: "analyst", description: "Credit Analyst", example: "Ngozi Eze" }, { name: "recommendation", description: "Adopted recommendation", example: "Proceed with conditions" }] }),
  tpl({ id: "origination.credit-approved", name: "Credit request approved", trigger: "origination.application.approved", subject: "Approved: {{appId}} — {{obligor}}", inApp: "{{appId}} ({{amount}}) is fully approved. Release it to the offer letter.", tone: "success", body: `<p>All required tiers have signed. Final decision by <strong>{{approvedBy}}</strong>.</p>${facts}<p>Release the request to offer-letter generation.</p>`, variables: [...appVars, { name: "approvedBy", description: "Final approver", example: "Chinedu Okafor" }] }),
  tpl({ id: "origination.credit-declined", name: "Credit request declined", trigger: "origination.application.declined", subject: "Declined: {{appId}} — {{obligor}}", inApp: "{{appId}} was declined by {{declinedBy}}.", tone: "danger", body: `<p>The request was <strong>declined</strong> by {{declinedBy}}.</p>${facts}<p>Reason: {{reason}}</p>`, variables: [...appVars, { name: "declinedBy", description: "Decision maker", example: "Amaka Nwosu" }, { name: "reason", description: "Decision comment", example: "Leverage above appetite for the sector." }] }),
  tpl({ id: "origination.returned-for-rework", name: "Returned for rework", trigger: "origination.application.returned", subject: "Returned for rework: {{appId}}", inApp: "{{returnedBy}} returned {{appId}} for rework: {{reason}}", tone: "warning", body: `<p><strong>{{returnedBy}}</strong> returned the request for rework. It is back with the Credit Analyst and the approval route restarts.</p>${facts}<p>Comment: {{reason}}</p>`, variables: [...appVars, { name: "returnedBy", description: "Approver who returned it", example: "Bola Adeyemi" }, { name: "reason", description: "Comment", example: "Obtain the latest quarter's management accounts." }] }),
  tpl({ id: "origination.limit-breach", name: "Portfolio-limit breach", trigger: "origination.limit-gate.breached", subject: "Limit breach on {{appId}}: {{breach}}", inApp: "{{appId}} breaches the portfolio-limit gate ({{breach}}). Progression is blocked pending an exception.", tone: "danger", body: `<p>The portfolio-limit gate found a <strong>{{breach}}</strong>.</p>${facts}<p>Progression is blocked until the CRO / Board grant an informed exception.</p>`, variables: [...appVars, { name: "breach", description: "Breach type", example: "Breach — sector" }] }),
  tpl({ id: "origination.limit-exception-decided", name: "Limit exception decided", trigger: "origination.limit-exception.granted / refused", subject: "Limit exception {{outcome}}: {{appId}}", inApp: "The limit exception on {{appId}} was {{outcome}} by {{decidedBy}}.", tone: "info", body: `<p>The exception for the <strong>{{breach}}</strong> was <strong>{{outcome}}</strong> by {{decidedBy}}.</p>${facts}<p>{{comment}}</p>`, variables: [...appVars, { name: "breach", description: "Breach type", example: "Breach — single obligor" }, { name: "outcome", description: "granted / refused", example: "granted" }, { name: "decidedBy", description: "Decision maker", example: "Folake Adebayo" }, { name: "comment", description: "Decision comment", example: "Board-approved strategic exposure." }] }),
  tpl({ id: "origination.recommendation-overridden", name: "Recommendation overridden", trigger: "origination.recommendation.overridden", subject: "Recommendation overridden on {{appId}}", inApp: "{{requestedBy}} overrode {{from}} → {{to}} on {{appId}} (approved by {{approvedBy}}).", tone: "warning", body: `<p>The system recommendation was overridden from <strong>{{from}}</strong> to <strong>{{to}}</strong>.</p>${facts}<ul><li>Requested by: {{requestedBy}}</li><li>Approved by: {{approvedBy}}</li><li>Reason: {{reason}}</li></ul>`, variables: [...appVars, { name: "from", description: "System recommendation", example: "Decline" }, { name: "to", description: "Adopted recommendation", example: "Proceed with conditions" }, { name: "reason", description: "Override reason", example: "Contract proceeds domiciled; risk mitigated." }, { name: "requestedBy", description: "Requester", example: "Ngozi Eze" }, { name: "approvedBy", description: "Reviewer", example: "Chinedu Okafor" }] }),
  tpl({ id: "origination.document-uploaded", name: "Document uploaded", trigger: "origination.document.uploaded", subject: "New document on {{appId}}: {{document}} {{version}}", inApp: "{{uploadedBy}} uploaded {{kind}} {{version}} to {{appId}}.", tone: "info", body: `<p><strong>{{uploadedBy}}</strong> uploaded <strong>{{document}}</strong> ({{kind}}, {{version}}). Earlier versions are retained.</p>${facts}<p>Review the OCR extraction and verify the document.</p>`, variables: [...appVars, { name: "document", description: "File name", example: "Management accounts Q3 2026.xlsx" }, { name: "kind", description: "Document type", example: "Management accounts" }, { name: "version", description: "Version", example: "v2" }, { name: "uploadedBy", description: "Uploader", example: "Tunde Bakare" }] }),
  tpl({ id: "origination.documents-verified", name: "Documents verified", trigger: "origination.document.verified", subject: "Documents verified on {{appId}}", inApp: "{{verifiedBy}} verified {{count}} document(s) on {{appId}}.", tone: "success", body: `<p><strong>{{verifiedBy}}</strong> verified {{count}} extracted document(s).</p>${facts}`, variables: [...appVars, { name: "count", description: "Documents verified", example: "3" }, { name: "verifiedBy", description: "Verifier", example: "Ngozi Eze" }] }),
  tpl({ id: "origination.released-to-offer", name: "Released to offer letter", trigger: "origination.application.released-to-offer", subject: "Offer letter ready: {{appId}} — {{obligor}}", inApp: "{{appId}} was released to offer-letter generation by {{releasedBy}}.", tone: "success", body: `<p>The approved request was released to offer-letter generation by {{releasedBy}}.</p>${facts}<p>Present the offer letter to the customer and collect acceptance documents.</p>`, variables: [...appVars, { name: "releasedBy", description: "Who released it", example: "Ngozi Eze" }] }),
  tpl({ id: "origination.comment-mention", name: "Mentioned in a comment", trigger: "origination.comment.added", subject: "{{author}} mentioned you on {{appId}}", inApp: "{{author}} mentioned you on {{appId}}: “{{excerpt}}”", tone: "info", body: `<p><strong>{{author}}</strong> mentioned you in the discussion of a credit request.</p>${facts}<p>“{{excerpt}}”</p>`, variables: [...appVars, { name: "author", description: "Comment author", example: "Ngozi Eze" }, { name: "excerpt", description: "Comment excerpt", example: "@Tunde please obtain the latest management accounts." }] }),
  tpl({ id: "origination.application-withdrawn", name: "Application withdrawn", trigger: "origination.application.withdrawn", subject: "Withdrawn: {{appId}} — {{obligor}}", inApp: "{{withdrawnBy}} withdrew {{appId}}.", tone: "info", body: `<p><strong>{{withdrawnBy}}</strong> withdrew the request. It is retained for audit.</p>${facts}<p>Reason: {{reason}}</p>`, variables: [...appVars, { name: "withdrawnBy", description: "Who withdrew it", example: "Tunde Bakare" }, { name: "reason", description: "Reason", example: "Customer withdrew the request." }] }),
]);

// ---------------------------------------------------------------- events & hook points

const ev = (name: string, description: string, payloadExample?: Record<string, unknown>) => ({ name, module: M, description, payloadExample });
defineEvents([
  ev("origination.application.created", "A credit request was created (draft or submitted).", { stage: "Draft", amount: 750000000 }),
  ev("origination.application.submitted", "The initiator submitted the request (BDM + Legal in parallel).", { stage: "Analysis", amount: 750000000, flow: "Standard" }),
  ev("origination.application.sent-to-analysis", "Documents complete — request sent to credit analysis."),
  ev("origination.application.analysis-completed", "The Credit Analyst completed analysis.", { next: "Recommendation" }),
  ev("origination.approval.submitted", "The request entered the Operations credit-approval workflow.", { operationId: "OPS-…", operationType: "credit.facility-approval.t3" }),
  ev("origination.approval.withdrawn", "The requester withdrew the approval request."),
  ev("origination.application.approved", "All required tiers signed.", { operationId: "OPS-…", amount: 750000000 }),
  ev("origination.application.declined", "The request was declined in the chart-flow."),
  ev("origination.application.returned", "An approver returned the request for rework.", { stepId: "T2", comment: "…" }),
  ev("origination.application.released-to-offer", "A fully approved request was released to offer-letter generation."),
  ev("origination.application.withdrawn", "The initiator withdrew the request."),
  ev("origination.limit-gate.checked", "The portfolio-limit gate ran.", { before: "Not checked", result: "Within limit" }),
  ev("origination.limit-gate.breached", "The limit gate found a single-obligor or sector breach."),
  ev("origination.limit-exception.requested", "A limit exception was requested from the CRO / Board."),
  ev("origination.limit-exception.granted", "The CRO / Board granted a limit exception."),
  ev("origination.limit-exception.refused", "The CRO / Board refused a limit exception (request declined)."),
  ev("origination.recommendation.adopted", "The system recommendation was adopted.", { recommendation: "Approve with conditions" }),
  ev("origination.recommendation.override-requested", "An override of the system recommendation was sent for review."),
  ev("origination.recommendation.overridden", "An approved override changed the recommendation.", { from: "Decline", to: "Approve with conditions" }),
  ev("origination.covenants.tagged", "Covenants and conditions were saved for the offer letter."),
  ev("origination.bureau.pulled", "Bureau and CRMS reports were pulled."),
  ev("origination.cop.explained", "The analyst documented a customer explanation for a Low COP Ratio."),
  ev("origination.memo.signed-off", "The AI-drafted credit memo was signed off."),
  ev("origination.comment.added", "A comment was added to a request."),
  ev("origination.document.uploaded", "A document or a new version was uploaded.", { kind: "Management accounts", version: 2 }),
  ev("origination.document.verified", "Extracted documents were verified."),
]);

const hp = (action: string, what: string) => [
  { point: `origination.${action}.before`, module: M, kind: "before" as const, description: `Before ${what}. Veto to block, or enrich the context.` },
  { point: `origination.${action}.after`, module: M, kind: "after" as const, description: `After ${what}.` },
];
defineHookPoints([
  ...hp("application.create", "a credit request is created"),
  ...hp("application.submit", "the initiator submits a request"),
  ...hp("application.analysis-start", "a request is sent to analysis"),
  ...hp("application.analysis-complete", "the Credit Analyst completes analysis"),
  ...hp("approval.submit", "a request is submitted into the credit-approval workflow (ctx.operationType may be changed)"),
  ...hp("application.release", "a request is released to the offer letter"),
  ...hp("application.withdraw", "a request is withdrawn"),
  ...hp("limit-gate.check", "the portfolio-limit gate result is recorded"),
  ...hp("limit-exception.request", "a limit exception is requested"),
  ...hp("recommendation.adopt", "a recommendation is adopted or an override requested"),
  ...hp("document.upload", "a document (or a new version) is uploaded"),
  ...hp("document.verify", "documents are verified"),
  ...hp("covenants.tag", "covenants are saved"),
  ...hp("bureau.pull", "bureau / CRMS reports are recorded"),
  ...hp("cop.explain", "a COP explanation is recorded"),
  ...hp("memo.sign-off", "the credit memo is signed off"),
  ...hp("comment.add", "a comment is added"),
]);

// ---------------------------------------------------------------- built-in policy hooks (PRD controls)

type DecideCtx = { instance: OperationInstance; decision: "approve" | "reject" | "return"; comment: string; actor: Actor; stepUpVerified?: boolean };
registerHook<DecideCtx>({
  id: "origination.credit-approval-controls",
  name: "Credit approval controls (origination)",
  point: "operations.decide.before",
  priority: 10,
  run: ({ instance, decision, actor, stepUpVerified }) => {
    if (!isCreditOp(instance.operationType)) return;
    const p = instance.payload as CreditPayload;
    const app = useDb.getState().applications.find((a) => a.id === p.applicationId);
    if (!app) return;
    if (!["Recommendation", "Approval"].includes(app.stage)) return { veto: `Application ${app.id} is at "${app.stage}", not awaiting approval.` };
    // PRD §4.2: step-up authentication above the high-value threshold. Accepted from the engine flag
    // (Operations screen) or the application's Approvals tab.
    if (decision === "approve" && app.amount > getRule<number>("approvals.stepUpThresholdNgn") && !stepUpVerified && !hasStepUp(instance, actor.id)) {
      return { veto: "Step-up authentication is required above the high-value threshold. Verify with your one-time code to approve." };
    }
    if (decision !== "approve") return;
    // PRD §6.1.5: a limit breach blocks progression until an exception is granted.
    const exception = useOriginationStore.getState().extras[app.id]?.exception;
    if (app.limitGate.startsWith("Breach") && exception?.decision !== "granted") return { veto: `Blocked by the portfolio-limit gate (${app.limitGate}) until the CRO / Board grant an exception.` };
    // PRD §6.1.1 step 3: the BDM can't submit until collateral due diligence is complete.
    const step = currentStep(instance);
    if (instance.stepIndex === 0 && step?.approverRoles.includes("bdm") && actor.roleId === "bdm") {
      const pending = useDb.getState().collateral.filter((c) => app.collateralIds.includes(c.id) && (c.perfection === "Not started" || c.perfection === "Search in progress"));
      if (pending.length) return { veto: "Collateral due diligence is not complete — Legal must finish the search before the BDM can concur." };
    }
  },
});

// ---------------------------------------------------------------- operation → application sync

const findInstance = (id: string | undefined) => useOperationsStore.getState().instances.find((i) => i.id === id);
subscribe({
  id: "origination.credit-approval-sync",
  name: "Mirror credit approvals onto applications",
  pattern: "operations.*",
  priority: 10,
  handler: (event) => {
    const instance = findInstance(event.subject?.id);
    if (!instance || !isCreditOp(instance.operationType)) return;
    if (event.name === "operations.request.returned") onCreditReturned(instance);
    else if (event.name === "operations.request.cancelled") onCreditCancelled(instance);
    else syncFromOperation(instance);
  },
});

// Seeded demo applications already in Recommendation / Approval get their open operation once.
seedCreditOperations();
