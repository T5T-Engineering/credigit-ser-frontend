"use client";

/**
 * Platform registrations for the Portfolio & MIS module (invariants 8 & 9): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md →
 * Platform services.
 *
 * Approval flows routed through Operations:
 *  - portfolio.report.release    — MIS officer validates an AI-drafted run and submits it; Head of Risk / CRO releases.
 *  - portfolio.plan.approve      — a plan version is submitted; Head of Risk review → CRO / MD (ALCO) approval.
 *  - portfolio.projection.adopt  — AI projection commentary submitted for adoption by Credit Analyst / Head of Risk / CRO.
 */
import { useDb } from "@/lib/data/store";
import type { RoleId } from "@/lib/rbac/roles";
import { defineEvents, publish, subscribe } from "@/lib/platform/events";
import { defineHookPoints, registerHook, runHooks } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, type OperationInstance, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, getRule, type RuleDefinition } from "@/lib/platform/rules";
import { currentActor, type Actor } from "@/lib/platform/scope";
import { REPORT_CADENCES, reportCadenceRuleKey, reportCatalogue } from "./data";
import { ccfRuleKey, OBLIGOR_TYPES, PARAM_RULES, PORTFOLIO_RULES as R, PRODUCT_TYPES, riskWeightRuleKey } from "./rule-keys";
import { usePortfolioStore, type ReportRun } from "./store";

const MODULE = "portfolio";
const DEMO = "Tenant parameter (demo value)";
const P = PARAM_RULES;

// ---------------------------------------------------------------- business rules
const pctRule = (key: string, label: string, description: string, category: string, value: number, source: string, extra: Partial<RuleDefinition> = {}): RuleDefinition => ({
  key, label, description, module: MODULE, category, type: "percent", unit: "%", default: value, min: 0, max: 100, step: 0.1, source, ...extra,
});

/** PRD §9.1 CCF categories; products the PRD doesn't classify are demo tenant values. */
const ccfDefaults: Record<string, { pct: number; basis: string; source: string }> = {
  "Bank guarantee": { pct: 100, basis: "Financial guarantee — direct credit substitute", source: "(100%)" },
  "Advance payment guarantee": { pct: 50, basis: "Transaction-related contingency", source: "(50%)" },
  "Trade finance (LC)": { pct: 20, basis: "Trade-related instrument", source: "(20%)" },
  Overdraft: { pct: 0, basis: "Unconditionally cancellable (classification is a demo choice)", source: "(0%) — demo classification" },
  "Revolving credit": { pct: 0, basis: "Unconditionally cancellable (classification is a demo choice)", source: "(0%) — demo classification" },
  "Term loan": { pct: 50, basis: "Committed undrawn", source: DEMO },
  "Lease finance": { pct: 50, basis: "Committed undrawn", source: DEMO },
  "Invoice discounting": { pct: 50, basis: "Committed undrawn", source: DEMO },
  Mortgage: { pct: 50, basis: "Committed undrawn", source: DEMO },
  "Asset finance": { pct: 50, basis: "Committed undrawn", source: DEMO },
};
const riskWeightDefaults: Record<string, number> = { Corporate: 100, Commercial: 100, SME: 75, Retail: 75, "Public sector": 20 };

defineRules([
  // Capital & statutory limits
  { key: P.totalQualifyingCapital, label: "Total qualifying capital (Tier 1 + Tier 2)", description: "Denominator of Large Exposures to Capital.", module: MODULE, category: "Capital", type: "money", default: 52e9, min: 1, source: "regulatory capital return (demo value)" },
  pctRule(P.singleObligorLimitPct, "Single-obligor limit (% of shareholders' funds)", "Maximum weighted exposure to one obligor / connected group.", "Statutory limits", 20, "CBN 3.2(a)"),
  pctRule(P.offBalanceSolWeight, "Off-balance-sheet weighting for single-obligor limit", "Share of off-balance-sheet engagements counted in the single-obligor limit.", "Statutory limits", 100 / 3, "CBN 3.2(b) (33⅓%)", { step: 0.01 }),
  pctRule(P.largeExposurePct, "Large exposure threshold (% of shareholders' funds)", "Obligors at or above this share of SHF are large exposures.", "Statutory limits", 10, "CBN 3.2(d)"),
  { key: P.aggregateLargeExposureMultiple, label: "Aggregate large-exposure ceiling (× shareholders' funds)", description: "Ceiling on the sum of large exposures.", module: MODULE, category: "Statutory limits", type: "number", unit: "×", default: 8, min: 1, max: 20, step: 0.5, source: "CBN 3.2(e)" },
  pctRule(P.governmentCeilingPct, "All tiers of government (% of total credit portfolio)", "Statutory ceiling on public-sector lending (applies to the government sector).", "Statutory limits", 10, "CBN 3.2(c)"),
  pctRule(P.earlyWarningPct, "Near-breach early-warning threshold (% of limit)", "Utilisation at which a limit is flagged as near breach.", "Limit monitoring", 90, "(e.g. 90%) — tenant parameter (demo value)"),
  pctRule(P.minCarPct, "Minimum CAR — national authorisation", "Capital charge used for capital consumption (RWA × min CAR).", "Capital", 10, "CBN Regulatory Capital 2021 (15% international / SIBs)"),
  // Risk appetite
  { key: P.warrCeiling, label: "Board-approved WARR ceiling (whole book)", description: "WARR at or above this is a breach of appetite.", module: MODULE, category: "Risk appetite", type: "number", default: 4.5, min: 1, max: 10, step: 0.05, source: "tenant parameter (demo value)" },
  { key: P.warrEarlyWarning, label: "WARR early-warning band", description: "WARR at or above this (below the ceiling) is an early warning.", module: MODULE, category: "Risk appetite", type: "number", default: 4.3, min: 1, max: 10, step: 0.05, source: "tenant parameter (demo value)" },
  pctRule(P.nplAppetitePct, "NPL ratio appetite (Risk Appetite Statement)", "Maximum NPL / gross loans.", "Risk appetite", 5, "tenant parameter (demo value)"),
  // RAROC inputs
  pctRule(P.costOfFundsPct, "Average cost of funds (interest expense rate)", "Interest expense rate applied to funded balances.", "RAROC inputs", 13.5, "CBA GL (demo value)"),
  pctRule(P.feeIncomePct, "Fee income (% of approved amount, annual)", "Annual fee income per facility.", "RAROC inputs", 1, "product sub-ledger (demo value)"),
  pctRule(P.opexAllocationPct, "Operating cost allocation (% of outstanding)", "Cost-allocation key for operating expense.", "RAROC inputs", 2.5, "cost-allocation key (demo value)"),
  pctRule(P.rarocHurdlePct, "RAROC hurdle rate", "Segments below this RAROC are flagged.", "RAROC inputs", 20, "tenant parameter (demo value)"),
  pctRule(R.eclStage1Pct, "ECL proxy — Stage 1 (% of outstanding)", "Used for RAROC until the IFRS 9 engine feeds ECL.", "RAROC inputs", 1, "proxy until the IFRS 9 feed (demo value)"),
  pctRule(R.eclStage2Pct, "ECL proxy — Stage 2 (% of outstanding)", "Used for RAROC until the IFRS 9 engine feeds ECL.", "RAROC inputs", 6, "proxy until the IFRS 9 feed (demo value)"),
  pctRule(R.eclSubstandardPct, "ECL proxy — Stage 3 Substandard", "CBN prudential provisioning rate used as the Stage 3 proxy.", "RAROC inputs", 10, "CBN provisioning table"),
  pctRule(R.eclDoubtfulPct, "ECL proxy — Stage 3 Doubtful", "CBN prudential provisioning rate used as the Stage 3 proxy.", "RAROC inputs", 50, "CBN provisioning table"),
  pctRule(R.eclLostPct, "ECL proxy — Stage 3 Lost", "CBN prudential provisioning rate used as the Stage 3 proxy.", "RAROC inputs", 100, "CBN provisioning table"),
  // CCF & risk weights
  ...PRODUCT_TYPES.map((p) => pctRule(ccfRuleKey(p), `Credit-conversion factor — ${p}`, `${ccfDefaults[p]!.basis}. Applied to undrawn / contingent amounts (WARR and RWA exposure).`, "Credit-conversion factors", ccfDefaults[p]!.pct, ccfDefaults[p]!.source)),
  ...OBLIGOR_TYPES.map((t) => pctRule(riskWeightRuleKey(t), `Risk weight — ${t}`, "Asset-classification risk weight for RWA (tenant table).", "Risk weights", riskWeightDefaults[t]!, "tenant asset-classification table (demo value)", { max: 1250 })),
  // Reporting
  { key: R.periodStartDate, label: "Reporting period start", description: "Start of the YTD period for new-business split and WARR decomposition (ISO date).", module: MODULE, category: "Reporting", type: "text", default: "2026-01-01", source: "financial year start (demo value)" },
  { key: R.openingDateLabel, label: "Opening balance date label", description: "Label of the opening snapshot (prior year-end).", module: MODULE, category: "Reporting", type: "text", default: "31 Dec 2025", source: DEMO },
  pctRule(R.obligorReportFloorPct, "Single-obligor report floor (% of limit)", "Obligors below this utilisation are left out of the single-obligor table.", "Reporting", 25, DEMO),
  { key: R.blockReleaseOnReconBreak, label: "Block report release on reconciliation break", description: "Runs generated while a CBA reconciliation break is open cannot be submitted for release.", module: MODULE, category: "Reporting", type: "boolean", default: true, source: "reconciliation layer (tenant choice, demo on)" },
  { key: R.reportReleaseNotifyRoles, label: "Report release — notify roles", description: "Roles notified when a report run is released.", module: MODULE, category: "Notifications", type: "roles", default: ["portfolio-mis-officer", "head-of-risk", "cro"], source: DEMO },
  { key: R.limitAlertRoles, label: "Limit alerts — notify roles", description: "Roles notified when a limit enters near-breach or breach (escalation).", module: MODULE, category: "Notifications", type: "roles", default: ["head-of-risk", "cro", "portfolio-mis-officer"], source: "recipients are tenant configuration (demo)" },
  { key: R.planApprovedNotifyRoles, label: "Plan approval — notify roles", description: "Roles notified when a plan version is approved.", module: MODULE, category: "Notifications", type: "roles", default: ["portfolio-mis-officer", "head-of-risk", "cro", "md"], source: DEMO },
  ...reportCatalogue.map((r): RuleDefinition => ({ key: reportCadenceRuleKey(r.id), label: `Cadence — ${r.name}`, description: "How often the report is generated (scheduled run).", module: MODULE, category: "Report cadence", type: "enum", default: r.cadence, options: REPORT_CADENCES.map((c) => ({ value: c, label: c })), source: `(${r.prd}) — cadence configured per tenant (demo value)` })),
  // Plan guidance & projection calibration
  { key: R.planDeterioratingFactor, label: "Cycle adjustment — deteriorating sector", description: "Multiplier on planned share where the 12m projection deteriorates.", module: MODULE, category: "Plan guidance", type: "number", default: 0.8, min: 0, max: 2, step: 0.05, source: "calibration (demo value)" },
  { key: R.planImprovingFactor, label: "Cycle adjustment — improving sector", description: "Multiplier on planned share where the 12m projection improves.", module: MODULE, category: "Plan guidance", type: "number", default: 1.15, min: 0, max: 2, step: 0.05, source: "calibration (demo value)" },
  pctRule(R.projectionDeterioratingAbovePct, "Projection — deteriorating above (% rise)", "12m projected NPL above current × (1 + this) is Deteriorating.", "Projection", 8, "calibration (demo value)"),
  pctRule(R.projectionImprovingBelowPct, "Projection — improving below (% fall)", "12m projected NPL below current × (1 − this) is Improving.", "Projection", 5, "calibration (demo value)"),
]);

// ---------------------------------------------------------------- helpers
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });

function audit(actor: Actor, action: string, entityType: string, entityId: string, before?: string, after?: string) {
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType, entityId, before, after });
}

const runHref = (id: string) => `/portfolio/reports?run=${encodeURIComponent(id)}`;

// ---------------------------------------------------------------- operations
export type ReportReleasePayload = { runId: string; reportId: string; reportName: string; period: string };

registerOperation<ReportReleasePayload>({
  type: "portfolio.report.release",
  name: "Report release",
  module: MODULE,
  description: "Release a validated report run (CBN return, board pack or MIS). The MIS officer validates and submits; a second person releases.",
  defaultSteps: [step("release", "Head of Risk / CRO release", ["head-of-risk", "cro"], 24)],
  apply: async (p, { instance, actor }) => {
    const store = usePortfolioStore.getState();
    const before = store.runs.find((r) => r.id === p.runId);
    store.updateRun(p.runId, { status: "Released", releasedBy: actor.name, releasedAt: new Date().toISOString(), operationId: instance.id, returnReason: undefined });
    audit(actor, "Released report", "Report", p.runId, before?.status, "Released");
    publish("portfolio.report.released", { module: MODULE, subject: { type: "ReportRun", id: p.runId, title: `${p.reportName} — ${p.period}`, href: runHref(p.runId) }, payload: { reportId: p.reportId, period: p.period, operationId: instance.id } });
    notify({ templateId: "portfolio.report-released", toRoles: getRule<RoleId[]>(R.reportReleaseNotifyRoles), href: runHref(p.runId), data: { report: p.reportName, period: p.period, run: p.runId, releasedBy: actor.name, validatedBy: before?.validatedBy ?? instance.requestedBy.name } });
    await runHooks("portfolio.report.release.after", { runId: p.runId, operationId: instance.id });
  },
  onReject: (p, { instance, actor }) => returnRun(p, instance, actor, "rejected"),
});

function returnRun(p: ReportReleasePayload, instance: OperationInstance, actor: Actor, outcome: string) {
  const store = usePortfolioStore.getState();
  const reason = instance.reason ?? "";
  store.updateRun(p.runId, { status: "Returned for correction", returnReason: reason, operationId: instance.id });
  audit(actor, `Report release ${outcome}`, "Report", p.runId, "Submitted for release", "Returned for correction");
  publish("portfolio.report.returned", { module: MODULE, subject: { type: "ReportRun", id: p.runId, title: `${p.reportName} — ${p.period}`, href: runHref(p.runId) }, payload: { outcome, reason } });
  notify({ templateId: "portfolio.report-returned", toUserIds: [instance.requestedBy.id], href: runHref(p.runId), data: { report: p.reportName, period: p.period, run: p.runId, outcome, decidedBy: actor.name, reason } });
}

export type PlanApprovalPayload = { planId: string; planName: string; version: number; fileName: string };

registerOperation<PlanApprovalPayload>({
  type: "portfolio.plan.approve",
  name: "Annual portfolio plan approval",
  module: MODULE,
  description: "Approve a portfolio plan version so it becomes the operative plan for variance reporting. Earlier versions are retained, never overwritten.",
  defaultSteps: [step("review", "Head of Risk review", ["head-of-risk"], 48), step("alco", "ALCO approval (CRO / MD)", ["cro", "md"], 72)],
  apply: (p, { instance, actor }) => {
    const store = usePortfolioStore.getState();
    const previous = store.operativePlanId;
    if (previous && previous !== p.planId) store.setPlanStatus(previous, "Superseded");
    store.setPlanStatus(p.planId, "Approved");
    store.setOperativePlan(p.planId);
    audit(actor, "Approved portfolio plan version", "PortfolioPlan", p.planId, previous, `v${p.version} operative`);
    publish("portfolio.plan.approved", { module: MODULE, subject: { type: "PortfolioPlan", id: p.planId, title: p.planName, href: "/portfolio/annual-plan" }, payload: { version: p.version, supersedes: previous, operationId: instance.id } });
    notify({ templateId: "portfolio.plan-approved", toRoles: getRule<RoleId[]>(R.planApprovedNotifyRoles), href: "/portfolio/annual-plan", data: { plan: p.planName, version: p.version, approvedBy: actor.name, requester: instance.requestedBy.name } });
  },
  onReject: (p, { instance, actor }) => {
    usePortfolioStore.getState().setPlanStatus(p.planId, "Rejected");
    audit(actor, "Rejected portfolio plan version", "PortfolioPlan", p.planId, "Submitted for approval", "Rejected");
    publish("portfolio.plan.rejected", { module: MODULE, subject: { type: "PortfolioPlan", id: p.planId, title: p.planName, href: "/portfolio/annual-plan" }, payload: { version: p.version, reason: instance.reason } });
    notify({ templateId: "portfolio.plan-rejected", toUserIds: [instance.requestedBy.id], href: "/portfolio/annual-plan", data: { plan: p.planName, version: p.version, decidedBy: actor.name, reason: instance.reason ?? "" } });
  },
});

export type ProjectionAdoptPayload = { key: string; scenario: string; summary: string };

registerOperation<ProjectionAdoptPayload>({
  type: "portfolio.projection.adopt",
  name: "Projection commentary adoption",
  module: MODULE,
  description: "Adopt the AI-drafted forward-looking projection commentary so it can inform credit, allocation or provisioning decisions.",
  defaultSteps: [step("adopt", "Credit Analyst / Head of Risk / CRO review", ["credit-analyst", "head-of-risk", "cro"], 48)],
  apply: (p, { instance, actor }) => {
    usePortfolioStore.getState().signOff(p.key, { by: actor.name, role: actor.roleId, at: new Date().toISOString(), operationId: instance.id });
    audit(actor, "Adopted AI projection commentary", "Projection", p.key, "AI-drafted", "Adopted");
    publish("portfolio.projection.adopted", { module: MODULE, subject: { type: "ProjectionCommentary", id: p.key, title: `Projection commentary — ${p.scenario}`, href: "/portfolio/projections" }, payload: { scenario: p.scenario, operationId: instance.id } });
    notify({ templateId: "portfolio.projection-adopted", toUserIds: [instance.requestedBy.id], toRoles: ["portfolio-mis-officer"], href: "/portfolio/projections", data: { scenario: p.scenario, adoptedBy: actor.name, summary: p.summary } });
  },
});

// Returned / cancelled requests don't call apply/onReject — reset the subject so it can be resubmitted.
subscribe({
  id: "portfolio.operations-closed",
  name: "Portfolio: reset subjects of returned / withdrawn requests",
  pattern: "operations.request.*",
  handler: (e) => {
    if (!["operations.request.returned", "operations.request.cancelled"].includes(e.name)) return;
    const { operationType, subject } = e.payload as { operationType: string; subject: { id: string } };
    const store = usePortfolioStore.getState();
    if (operationType === "portfolio.report.release") {
      const run = store.runs.find((r) => r.id === subject.id);
      if (run?.status === "Submitted for release") store.updateRun(run.id, { status: "Returned for correction", returnReason: e.name.endsWith("cancelled") ? "Withdrawn by requester" : "Returned by approver" });
    }
    if (operationType === "portfolio.plan.approve" && store.planStatus[subject.id] === "Submitted for approval") store.setPlanStatus(subject.id, "Draft");
  },
});

// Built-in policy hook: a run with an open reconciliation break can't be submitted for release (PRD §5.1).
registerHook<{ run: ReportRun }>({
  id: "portfolio.recon-break-gate",
  name: "Reconciliation break gate",
  point: "portfolio.report.submit.before",
  priority: 10,
  run: ({ run }) => (getRule<boolean>(R.blockReleaseOnReconBreak) && !run.reconciled ? { veto: "the run was generated while a CBA reconciliation break was open. Clear the break and regenerate." } : undefined),
});

// ---------------------------------------------------------------- limit alerts
export type LimitAlert = { id: string; kind: "Sector" | "Single obligor" | "Large exposures" | "WARR"; name: string; status: "Within limit" | "Near breach" | "Breach"; utilisation: string; limit: string };

/**
 * Raise a limit alert on a status transition (called by the limit monitor). Audited as the System actor;
 * `portfolio.limit.alert.before` hooks may suppress it (veto) or enrich it.
 */
export async function raiseLimitAlert(alert: LimitAlert, previous: string | undefined) {
  const store = usePortfolioStore.getState();
  store.setLimitState(alert.id, alert.status);
  const hook = await runHooks("portfolio.limit.alert.before", { alert, previous });
  if (!hook.ok) return;
  const a = hook.ctx.alert;
  const actor = currentActor();
  useDb.getState().log({ actorId: "SYSTEM", actorName: "Limit monitor (system)", roleId: "system-admin", action: `Limit status changed (${a.kind})`, entityType: "Limit", entityId: a.id, before: previous ?? "Not evaluated", after: a.status });
  const event = a.status === "Breach" ? "portfolio.limit.breached" : a.status === "Near breach" ? "portfolio.limit.nearBreached" : "portfolio.limit.restored";
  publish(event, { module: MODULE, subject: { type: "Limit", id: a.id, title: `${a.kind}: ${a.name}`, href: "/portfolio/limits" }, payload: { ...a, previous, observedBy: actor.id } });
  if (a.status !== "Within limit") {
    notify({ templateId: a.status === "Breach" ? "portfolio.limit-breach" : "portfolio.limit-near-breach", toRoles: getRule<RoleId[]>(R.limitAlertRoles), href: "/portfolio/limits", data: { kind: a.kind, name: a.name, utilisation: a.utilisation, limit: a.limit, earlyWarning: `${getRule<number>(P.earlyWarningPct)}%` } });
  }
  await runHooks("portfolio.limit.alert.after", { alert: a, previous });
}

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "portfolio.limit-breach",
    name: "Limit breach",
    module: MODULE,
    trigger: "portfolio.limit.breached",
    subject: "Limit breach: {{kind}} — {{name}}",
    inApp: "{{kind}} {{name}} is in breach at {{utilisation}} (limit {{limit}}).",
    body: "<p>A limit is now <strong>in breach</strong>.</p><ul><li>Limit: {{kind}} — <strong>{{name}}</strong></li><li>Utilisation: {{utilisation}}</li><li>Limit: {{limit}}</li></ul><p>New requests in scope are gated at origination. Escalate through the protocol and record the remediation plan.</p>",
    tone: "danger",
    variables: [
      { name: "kind", description: "Limit type (Sector, Single obligor, Large exposures, WARR)", example: "Sector" },
      { name: "name", description: "Sector, obligor or measure", example: "Oil & Gas — Upstream" },
      { name: "utilisation", description: "Current utilisation or value", example: "112% of limit" },
      { name: "limit", description: "Limit in force", example: "15% of book" },
      { name: "earlyWarning", description: "Early-warning threshold", example: "90%" },
    ],
  }),
  tpl({
    id: "portfolio.limit-near-breach",
    name: "Limit near breach",
    module: MODULE,
    trigger: "portfolio.limit.nearBreached",
    subject: "Near breach: {{kind}} — {{name}}",
    inApp: "{{kind}} {{name}} is at {{utilisation}} — above the {{earlyWarning}} early-warning threshold.",
    body: "<p>A limit has crossed the <strong>{{earlyWarning}}</strong> early-warning threshold.</p><ul><li>Limit: {{kind}} — <strong>{{name}}</strong></li><li>Utilisation: {{utilisation}}</li><li>Limit: {{limit}}</li></ul><p>Review headroom before approving new exposure in scope.</p>",
    tone: "warning",
    variables: [
      { name: "kind", description: "Limit type", example: "Single obligor" },
      { name: "name", description: "Sector, obligor or measure", example: "Dangote Cement Plc" },
      { name: "utilisation", description: "Current utilisation", example: "93% of limit" },
      { name: "limit", description: "Limit in force", example: "₦12bn (20% SHF)" },
      { name: "earlyWarning", description: "Early-warning threshold", example: "90%" },
    ],
  }),
  tpl({
    id: "portfolio.report-released",
    name: "Report released",
    module: MODULE,
    trigger: "portfolio.report.released",
    subject: "Released: {{report}} — {{period}}",
    inApp: "{{report}} ({{period}}) was released by {{releasedBy}}.",
    body: "<p><strong>{{report}}</strong> for <strong>{{period}}</strong> has been released.</p><ul><li>Run: {{run}}</li><li>Validated by: {{validatedBy}}</li><li>Released by: {{releasedBy}}</li></ul><p>The released version is locked and recorded in the audit log.</p>",
    tone: "success",
    variables: [
      { name: "report", description: "Report name", example: "Large exposures return" },
      { name: "period", description: "Reporting period", example: "Oct 2026" },
      { name: "run", description: "Run id", example: "RUN-0933" },
      { name: "validatedBy", description: "MIS officer who validated", example: "Bola Adeyemi" },
      { name: "releasedBy", description: "Approver who released", example: "Chinedu Okafor" },
    ],
  }),
  tpl({
    id: "portfolio.report-returned",
    name: "Report release returned",
    module: MODULE,
    trigger: "portfolio.report.returned",
    subject: "Not released: {{report}} — {{period}}",
    inApp: "{{report}} ({{period}}) was {{outcome}} by {{decidedBy}}.",
    body: "<p>Your release request for <strong>{{report}}</strong> ({{period}}, run {{run}}) was <strong>{{outcome}}</strong> by {{decidedBy}}.</p><p>{{reason}}</p><p>Correct the run and submit it again.</p>",
    tone: "warning",
    variables: [
      { name: "report", description: "Report name", example: "Large exposures return" },
      { name: "period", description: "Reporting period", example: "Oct 2026" },
      { name: "run", description: "Run id", example: "RUN-0933" },
      { name: "outcome", description: "rejected / returned", example: "rejected" },
      { name: "decidedBy", description: "Approver", example: "Chinedu Okafor" },
      { name: "reason", description: "Approver comment", example: "Connected-group aggregation missing for two obligors." },
    ],
  }),
  tpl({
    id: "portfolio.plan-approved",
    name: "Portfolio plan approved",
    module: MODULE,
    trigger: "portfolio.plan.approved",
    subject: "Plan approved: {{plan}} (v{{version}})",
    inApp: "{{plan}} v{{version}} is now the operative plan (approved by {{approvedBy}}).",
    body: "<p><strong>{{plan}}</strong> (version {{version}}) was approved by {{approvedBy}} and is now the operative plan for variance reporting.</p><p>Requested by {{requester}}. Earlier versions are retained for comparison.</p>",
    tone: "success",
    variables: [
      { name: "plan", description: "Plan name", example: "FY2026 Mid-year revision" },
      { name: "version", description: "Version number", example: "2" },
      { name: "approvedBy", description: "Final approver", example: "Ngozi Eze" },
      { name: "requester", description: "Who submitted it", example: "Bola Adeyemi" },
    ],
  }),
  tpl({
    id: "portfolio.plan-rejected",
    name: "Portfolio plan rejected",
    module: MODULE,
    trigger: "portfolio.plan.rejected",
    subject: "Plan not approved: {{plan}} (v{{version}})",
    inApp: "{{plan}} v{{version}} was rejected by {{decidedBy}}.",
    body: "<p><strong>{{plan}}</strong> (version {{version}}) was rejected by {{decidedBy}}.</p><p>{{reason}}</p>",
    tone: "warning",
    variables: [
      { name: "plan", description: "Plan name", example: "FY2026 Mid-year revision" },
      { name: "version", description: "Version number", example: "2" },
      { name: "decidedBy", description: "Approver", example: "Ngozi Eze" },
      { name: "reason", description: "Approver comment", example: "ICT allocation exceeds the sector limit." },
    ],
  }),
  tpl({
    id: "portfolio.projection-adopted",
    name: "Projection commentary adopted",
    module: MODULE,
    trigger: "portfolio.projection.adopted",
    subject: "Projection commentary adopted ({{scenario}} scenario)",
    inApp: "{{adoptedBy}} adopted the {{scenario}} projection commentary.",
    body: "<p>The AI-drafted projection commentary for the <strong>{{scenario}}</strong> scenario was reviewed and adopted by {{adoptedBy}}.</p><p>{{summary}}</p>",
    tone: "success",
    variables: [
      { name: "scenario", description: "Scenario", example: "Base" },
      { name: "adoptedBy", description: "Reviewer", example: "Ngozi Eze" },
      { name: "summary", description: "Commentary headline", example: "NPL ratio moves from 4.1% to 4.6% over 12 months." },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "portfolio.report.generated", module: MODULE, description: "A report run was generated (AI-drafted).", payloadExample: { reportId: "RPT-LEX", period: "Nov 2026 (to date)" } },
  { name: "portfolio.report.submitted", module: MODULE, description: "A validated run was submitted for release." },
  { name: "portfolio.report.released", module: MODULE, description: "A report run was released (after approval)." },
  { name: "portfolio.report.returned", module: MODULE, description: "A release request was rejected or returned." },
  { name: "portfolio.plan.uploaded", module: MODULE, description: "A plan version was ingested." },
  { name: "portfolio.plan.submitted", module: MODULE, description: "A plan version was submitted for approval." },
  { name: "portfolio.plan.approved", module: MODULE, description: "A plan version was approved and is operative." },
  { name: "portfolio.plan.rejected", module: MODULE, description: "A plan version was rejected." },
  { name: "portfolio.projection.submitted", module: MODULE, description: "Projection commentary was submitted for adoption." },
  { name: "portfolio.projection.adopted", module: MODULE, description: "Projection commentary was adopted." },
  { name: "portfolio.limit.breached", module: MODULE, description: "A sector, single-obligor, large-exposure or WARR limit entered breach.", payloadExample: { kind: "Sector", name: "Oil & Gas", utilisation: "112%" } },
  { name: "portfolio.limit.nearBreached", module: MODULE, description: "A limit crossed the early-warning threshold." },
  { name: "portfolio.limit.restored", module: MODULE, description: "A limit returned within limit." },
]);

defineHookPoints([
  { point: "portfolio.report.generate.before", module: MODULE, kind: "before", description: "Before a report run is generated. Veto to block; enrich the period." },
  { point: "portfolio.report.generate.after", module: MODULE, kind: "after", description: "After a run is generated." },
  { point: "portfolio.report.submit.before", module: MODULE, kind: "before", description: "Before a run is submitted for release. Built-in: reconciliation break gate." },
  { point: "portfolio.report.submit.after", module: MODULE, kind: "after", description: "After a run is submitted for release." },
  { point: "portfolio.report.release.after", module: MODULE, kind: "after", description: "After a run is released (e.g. file to the regulator portal)." },
  { point: "portfolio.plan.upload.before", module: MODULE, kind: "before", description: "Before a plan file is ingested. Veto to reject the file." },
  { point: "portfolio.plan.upload.after", module: MODULE, kind: "after", description: "After a plan version is stored." },
  { point: "portfolio.plan.submit.before", module: MODULE, kind: "before", description: "Before a plan version is submitted for approval." },
  { point: "portfolio.plan.submit.after", module: MODULE, kind: "after", description: "After a plan version is submitted." },
  { point: "portfolio.projection.submit.before", module: MODULE, kind: "before", description: "Before projection commentary is submitted for adoption." },
  { point: "portfolio.projection.submit.after", module: MODULE, kind: "after", description: "After projection commentary is submitted." },
  { point: "portfolio.limit.alert.before", module: MODULE, kind: "before", description: "Before a limit alert is notified. Veto to suppress; enrich the alert." },
  { point: "portfolio.limit.alert.after", module: MODULE, kind: "after", description: "After a limit alert is notified." },
]);
