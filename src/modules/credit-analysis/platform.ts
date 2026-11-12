"use client";

/**
 * Platform registrations for the credit-analysis module (360 RAR, PRD §6.2): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md →
 * Platform services. The posture midpoint and intensity bands (`rar.*`) are core rules (src/lib/platform/core.ts).
 *
 * Operation types:
 *  - rar.enrichment-change  — analyst enrichment adjustments (second analyst / CCO approval).
 *  - rar.advisory-signoff   — advisory note sign-off before use in the credit memo / front office.
 *  - rar.gating-override    — CCO/CRO override of an Industry Life-Cycle hard exception (§6.2.6).
 */
import { sectors, DEMO_NOW } from "@/lib/data/seed";
import { useDb } from "@/lib/data/store";
import type { Obligor, RarScores } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";
import { rarPosition } from "@/lib/rar";
import { defineEvents, publish } from "@/lib/platform/events";
import { defineHookPoints, runHooks } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, getRule, type RuleDefinition } from "@/lib/platform/rules";
import type { Actor } from "@/lib/platform/scope";
import { lifeCycleStages, ngxMappingRuleKey, ngxSectors, NO_NGX_PROXY, sectorMapping } from "./data";
import { assess, type ParamOverride } from "./logic";
import { scoringBandDefaults, scoringRuleKey } from "./parameters";
import { useCreditAnalysis } from "./store";

export const MODULE = "credit-analysis";
const DEMO = "Tenant parameter (demo value)";

// ---------------------------------------------------------------- business rules
const r = (d: Omit<RuleDefinition, "module">): RuleDefinition => ({ module: MODULE, ...d });
const stageOptions = lifeCycleStages.map((s) => ({ value: s, label: s }));

defineRules([
  // Scoring & weighting
  r({ key: "credit-analysis.weightingScheme", label: "Parameter weighting", description: "How parameter scores combine into each cardinal-point average.", category: "360 RAR scoring", type: "enum", default: "equal", options: [{ value: "equal", label: "Equal weighting" }], source: "tenant-configurable weighting (demo: equal)" }),
  r({ key: "credit-analysis.band.lowMax", label: "Interpretive band — Low up to", description: "Highest whole score in the Low band of the 36-cell interpretive layer.", category: "360 RAR scoring", type: "number", default: 3, min: 1, max: 8, step: 1, source: "Platform default" }),
  r({ key: "credit-analysis.band.mediumMax", label: "Interpretive band — Medium up to", description: "Highest whole score in the Medium band; above is High.", category: "360 RAR scoring", type: "number", default: 7, min: 2, max: 9, step: 1, source: "Platform default" }),
  r({ key: "credit-analysis.qualitative.midFrom", label: "Qualitative reading — mid from", description: "Score from which an analyst-led parameter reads as the middle label.", category: "360 RAR scoring", type: "number", default: 4, min: 1, max: 10, step: 0.5, source: DEMO }),
  r({ key: "credit-analysis.qualitative.highFrom", label: "Qualitative reading — high from", description: "Score from which an analyst-led parameter reads as the high label.", category: "360 RAR scoring", type: "number", default: 8, min: 1, max: 10, step: 0.5, source: DEMO }),
  // Confidence overlay
  r({ key: "credit-analysis.cop.highFrom", label: "COP High Confidence from", description: "COP ratio at or above which declared financials are High Confidence.", category: "Confidence overlay", type: "number", default: 0.85, min: 0, max: 2, step: 0.01, source: "example banding (tenant-configurable)" }),
  r({ key: "credit-analysis.cop.mediumFrom", label: "COP Medium Confidence from", description: "COP ratio at or above which declared financials are Medium Confidence; below is Low (explanation required).", category: "Confidence overlay", type: "number", default: 0.6, min: 0, max: 2, step: 0.01, source: "example banding (tenant-configurable)" }),
  r({ key: "credit-analysis.cop.dampenHigh", label: "North dampening — High Confidence", description: "Points subtracted from the North (Internal Risk) average at High Confidence.", category: "Confidence overlay", type: "number", default: 0, min: 0, max: 5, step: 0.1, source: "amount not given (OPEN-QUESTIONS RAR3); demo value" }),
  r({ key: "credit-analysis.cop.dampenMedium", label: "North dampening — Medium Confidence", description: "Points subtracted from the North average at Medium Confidence.", category: "Confidence overlay", type: "number", default: 0.5, min: 0, max: 5, step: 0.1, source: "amount not given (OPEN-QUESTIONS RAR3); demo value" }),
  r({ key: "credit-analysis.cop.dampenLow", label: "North dampening — Low Confidence", description: "Points subtracted from the North average at Low Confidence.", category: "Confidence overlay", type: "number", default: 1, min: 0, max: 5, step: 0.1, source: "amount not given (OPEN-QUESTIONS RAR3); demo value" }),
  // Refresh cycle
  r({ key: "credit-analysis.staleAfterDays", label: "Refresh cycle", description: "An assessment older than this is stale and due for refresh.", category: "Refresh cycle", type: "duration", durationUnit: "days", default: 90, min: 1, max: 730, source: DEMO }),
  // Peer benchmarking
  r({ key: "credit-analysis.peer.minPeers", label: "Minimum book peers", description: "Peers needed before the comparison scope broadens (size band → sector → whole book).", category: "Peer benchmarking", type: "number", default: 3, min: 1, max: 50, step: 1, source: DEMO }),
  r({ key: "credit-analysis.peer.outlierSd", label: "Outlier distance", description: "Standard deviations from the sector mean that flag a ratio outlier.", category: "Peer benchmarking", type: "number", unit: "SD", default: 2, min: 0.5, max: 5, step: 0.1, source: DEMO }),
  r({ key: "credit-analysis.peer.topPercentile", label: "Top-decile outlier at", description: "Sector percentile at or above which a ratio is a top outlier.", category: "Peer benchmarking", type: "number", unit: "th percentile", default: 90, min: 50, max: 99, step: 1, source: "decile positioning" }),
  r({ key: "credit-analysis.peer.bottomPercentile", label: "Bottom-decile outlier at", description: "Sector percentile at or below which a ratio is a bottom outlier.", category: "Peer benchmarking", type: "number", unit: "th percentile", default: 10, min: 1, max: 50, step: 1, source: "decile positioning" }),
  // Trend
  r({ key: "credit-analysis.trend.flatBandPct", label: "Flat momentum band", description: "Average yearly movement, as % of the current level, treated as Flat/Stable.", category: "Trend & momentum", type: "percent", unit: "%", default: 2, min: 0, max: 50, step: 0.5, source: DEMO }),
  r({ key: "credit-analysis.trend.inLineTolerance", label: "In line with sector tolerance", description: "Difference in rate of change (pp or % p.a.) treated as in line with the sector.", category: "Trend & momentum", type: "number", default: 0.5, min: 0, max: 10, step: 0.1, source: DEMO }),
  // Share of wallet
  r({ key: "credit-analysis.sow.highSharePct", label: "High wallet share from", description: "Turnover or loan wallet share at or above which the share counts as high (quadrant split).", category: "Share of wallet", type: "percent", unit: "%", default: 50, min: 1, max: 99, step: 1, source: "tenant threshold (demo value)" }),
  // Life-cycle classification + scores
  r({ key: "credit-analysis.lifeCycle.introMaxCompanies", label: "Introduction — max listed companies", description: "Sectors with at most this many listed companies can classify as Introduction.", category: "Industry life-cycle", type: "number", default: 5, min: 1, max: 100, step: 1, source: "engine threshold (demo value)" }),
  r({ key: "credit-analysis.lifeCycle.introMinCagrPct", label: "Introduction — min real growth", description: "Trailing 5-year real revenue CAGR at or above which a thin sector is Introduction.", category: "Industry life-cycle", type: "percent", unit: "% p.a.", default: 8, min: -20, max: 50, step: 0.5, source: "engine threshold (demo value)" }),
  r({ key: "credit-analysis.lifeCycle.growthMinCagrPct", label: "Growth — min real growth", description: "Trailing 5-year real revenue CAGR at or above which a sector is Growth.", category: "Industry life-cycle", type: "percent", unit: "% p.a.", default: 4, min: -20, max: 50, step: 0.5, source: "engine threshold (demo value)" }),
  r({ key: "credit-analysis.lifeCycle.declineBelowCagrPct", label: "Decline — real growth below", description: "Real revenue CAGR below which (with falling margins) a sector is Decline.", category: "Industry life-cycle", type: "percent", unit: "% p.a.", default: 0, min: -20, max: 20, step: 0.5, source: "engine threshold (demo value)" }),
  r({ key: "credit-analysis.lifeCycle.declineBelowMarginTrendPp", label: "Decline — margin trend below", description: "Net-margin trend (pp a year) below which, with contracting revenue, a sector is Decline.", category: "Industry life-cycle", type: "number", unit: "pp/yr", default: 0, min: -10, max: 10, step: 0.05, source: "engine threshold (demo value)" }),
  ...lifeCycleStages.map((stage, i) =>
    r({ key: `credit-analysis.lifeCycleScore.${stage}`, label: `Life-Cycle Stage score — ${stage}`, description: `South "Life-Cycle Stage" parameter score for a ${stage}-stage industry.`, category: "Industry life-cycle", type: "number", default: [6.5, 8.5, 5, 2][i]!, min: 1, max: 10, step: 0.5, source: DEMO }),
  ),
  // Gating (§6.2.6)
  r({ key: "credit-analysis.gating.longTenorMonths", label: "Long-tenor threshold", description: "Expansion requests longer than this in a hard-exception-stage industry need a CCO/CRO override.", category: "Life-cycle gating", type: "number", unit: "months", default: 36, min: 1, max: 360, step: 1, source: "Platform default" }),
  r({ key: "credit-analysis.gating.hardExceptionStages", label: "Hard-exception stages", description: "Industry life-cycle stages where long-tenor expansion is a hard exception.", category: "Life-cycle gating", type: "list", default: ["Decline"], options: stageOptions, source: "Platform default" }),
  r({ key: "credit-analysis.gating.analystNoteStages", label: "Mandatory analyst-note stages", description: "Stages where a Conservative-posture expansion request needs a mandatory Credit Analyst note.", category: "Life-cycle gating", type: "list", default: ["Maturity", "Decline"], options: stageOptions, source: "Platform default" }),
  r({ key: "credit-analysis.gating.expansionKeywords", label: "Expansion purpose keywords", description: "A facility purpose containing any of these words counts as an expansion/capex request.", category: "Life-cycle gating", type: "list", default: ["expansion", "purchase of new", "construction", "production line"], source: DEMO }),
  r({ key: "credit-analysis.gating.closedStages", label: "Application stages excluded from gating", description: "Application stages no longer checked by life-cycle gating.", category: "Life-cycle gating", type: "list", default: ["Booked", "Declined", "Withdrawn"], source: DEMO }),
  // Enrichment & advisory
  r({ key: "credit-analysis.enrichment.minRationale", label: "Enrichment rationale minimum", description: "Characters required in the rationale for an analyst enrichment adjustment.", category: "Enrichment & advisory", type: "number", unit: "characters", default: 15, min: 0, max: 500, step: 1, source: DEMO }),
  r({ key: "credit-analysis.advisory.flipCandidates", label: "Flip candidates shown", description: "Parameters listed as closest to flipping a Marginal posture.", category: "Enrichment & advisory", type: "number", default: 3, min: 1, max: 10, step: 1, source: DEMO }),
  r({ key: "credit-analysis.advisory.maxOutlierPoints", label: "Peer outliers in the advisory note", description: "Maximum ratio outliers cited in the drafted advisory note.", category: "Enrichment & advisory", type: "number", default: 3, min: 0, max: 10, step: 1, source: DEMO }),
  r({ key: "credit-analysis.advisory.confidenceHigh", label: "Draft confidence — High COP", description: "Confidence shown on the AI-drafted note when COP is High Confidence (simulated model).", category: "Enrichment & advisory", type: "number", default: 0.86, min: 0, max: 1, step: 0.01, source: DEMO }),
  r({ key: "credit-analysis.advisory.confidenceMedium", label: "Draft confidence — Medium COP", description: "Confidence shown on the AI-drafted note when COP is Medium Confidence (simulated model).", category: "Enrichment & advisory", type: "number", default: 0.74, min: 0, max: 1, step: 0.01, source: DEMO }),
  r({ key: "credit-analysis.advisory.confidenceLow", label: "Draft confidence — Low COP", description: "Confidence shown on the AI-drafted note when COP is Low Confidence (simulated model).", category: "Enrichment & advisory", type: "number", default: 0.61, min: 0, max: 1, step: 0.01, source: DEMO }),
  // Notification routing
  r({ key: "credit-analysis.notify.postureChangeRoles", label: "Posture change — also notify", description: "Roles told when an obligor's posture changes (the relationship manager is always told).", category: "Notifications", type: "roles", default: ["loan-review-officer"], source: DEMO }),
  r({ key: "credit-analysis.notify.defensiveReferralRoles", label: "Defensive posture — referral to", description: "Roles referred when an obligor moves into the Defensive posture (mandatory CRO referral).", category: "Notifications", type: "roles", default: ["cro"], source: "Platform default" }),
  r({ key: "credit-analysis.notify.gatingOverrideRoles", label: "Gating override — also notify", description: "Roles told when a life-cycle gating override is approved.", category: "Notifications", type: "roles", default: ["credit-admin-officer"], source: DEMO }),
  // Tenant sector → NGX mapping (§6.2.8)
  ...sectors
    .filter((s) => sectorMapping[s.id])
    .map((s) =>
      r({
        key: ngxMappingRuleKey(s.id),
        label: `NGX benchmark — ${s.name}`,
        description: `Nearest NGX sector classification used as the South benchmark for ${s.name} obligors.`,
        category: "NGX sector mapping",
        type: "enum",
        default: sectorMapping[s.id]!.primary ?? NO_NGX_PROXY,
        options: [...ngxSectors.map((n) => ({ value: n.id, label: n.name })), { value: NO_NGX_PROXY, label: "No listed proxy" }],
        source: "tenant mapping (demo value)",
      }),
    ),
  // Parameter scoring bands (§8 "tenant-configurable bands")
  ...scoringBandDefaults.flatMap((b) =>
    (["worst", "best"] as const).map((end) =>
      r({
        key: scoringRuleKey(b.id, end),
        label: `${b.id} ${b.name} — value scored ${end === "worst" ? "1" : "10"}`,
        description: `${b.measure} (${b.unit}) that maps to a score of ${end === "worst" ? "1" : "10"}; linear in between.`,
        category: "Parameter scoring bands",
        type: "number",
        unit: b.unit,
        default: b[end],
        step: 0.1,
        source: "tenant-configurable bands (demo value)",
      }),
    ),
  ),
]);

// ---------------------------------------------------------------- events & hook points
defineEvents([
  { name: "credit-analysis.enrichment.submitted", module: MODULE, description: "Analyst enrichment adjustments submitted for approval.", payloadExample: { obligorId: "OBL-0012", changes: 2, operationId: "OPS-…" } },
  { name: "credit-analysis.enrichment.applied", module: MODULE, description: "Approved enrichment adjustments applied; scores recomputed.", payloadExample: { obligorId: "OBL-0012", before: "Moderately Aggressive (Internally-Led)", after: "Strongly Aggressive (Internally-Led)" } },
  { name: "credit-analysis.enrichment.rejected", module: MODULE, description: "Enrichment adjustments rejected in Operations.", payloadExample: { obligorId: "OBL-0012" } },
  { name: "credit-analysis.assessment.refreshed", module: MODULE, description: "360 RAR assessment refreshed (all feeds re-read, posture recomputed).", payloadExample: { obligorId: "OBL-0012", posture: "Marginally Competitive (Externally-Led)" } },
  { name: "credit-analysis.posture.changed", module: MODULE, description: "An obligor's 360 RAR posture label changed.", payloadExample: { obligorId: "OBL-0012", before: "Neutral / Transitional", after: "Marginally Defensive (Internally-Led)", base: "Defensive" } },
  { name: "credit-analysis.advisory.submitted", module: MODULE, description: "Advisory note submitted for sign-off.", payloadExample: { obligorId: "OBL-0012", posture: "Moderately Conservative (Internally-Led)" } },
  { name: "credit-analysis.advisory.signed-off", module: MODULE, description: "Advisory note signed off and released to the relationship manager.", payloadExample: { obligorId: "OBL-0012", approvedBy: "Chinedu Okafor" } },
  { name: "credit-analysis.advisory.rejected", module: MODULE, description: "Advisory note sign-off rejected.", payloadExample: { obligorId: "OBL-0012" } },
  { name: "credit-analysis.gating-override.requested", module: MODULE, description: "CCO/CRO override requested for a life-cycle gating hard exception.", payloadExample: { obligorId: "OBL-0012", applicationId: "APP-0101" } },
  { name: "credit-analysis.gating-override.approved", module: MODULE, description: "Life-cycle gating hard exception overridden.", payloadExample: { obligorId: "OBL-0012", applicationId: "APP-0101" } },
  { name: "credit-analysis.gating-override.rejected", module: MODULE, description: "Life-cycle gating override rejected.", payloadExample: { obligorId: "OBL-0012", applicationId: "APP-0101" } },
]);

defineHookPoints([
  { point: "credit-analysis.enrichment.submit.before", module: MODULE, kind: "before", description: "Before enrichment adjustments are submitted — veto, or enrich the payload (ctx: { obligor, payload, actor })." },
  { point: "credit-analysis.enrichment.submit.after", module: MODULE, kind: "after", description: "After enrichment adjustments are submitted (ctx: { obligor, payload, operationId })." },
  { point: "credit-analysis.enrichment.apply.after", module: MODULE, kind: "after", description: "After approved adjustments are applied (ctx: { obligorId, scores, posture })." },
  { point: "credit-analysis.assessment.refresh.before", module: MODULE, kind: "before", description: "Before an assessment refresh — veto (e.g. feed outage) (ctx: { obligor, actor })." },
  { point: "credit-analysis.assessment.refresh.after", module: MODULE, kind: "after", description: "After an assessment refresh (ctx: { obligorId, scores, posture })." },
  { point: "credit-analysis.advisory.submit.before", module: MODULE, kind: "before", description: "Before an advisory note is submitted for sign-off — veto or enrich the text (ctx: { obligor, payload, actor })." },
  { point: "credit-analysis.advisory.submit.after", module: MODULE, kind: "after", description: "After an advisory note is submitted (ctx: { obligor, payload, operationId })." },
  { point: "credit-analysis.gating-override.submit.before", module: MODULE, kind: "before", description: "Before a life-cycle gating override is requested — veto (ctx: { obligor, payload, actor })." },
  { point: "credit-analysis.gating-override.submit.after", module: MODULE, kind: "after", description: "After a life-cycle gating override is requested (ctx: { obligor, payload, operationId })." },
  { point: "credit-analysis.posture.change.after", module: MODULE, kind: "after", description: "After an obligor's posture changes (ctx: { obligorId, before, after })." },
]);

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "credit-analysis.posture-changed",
    name: "360 RAR posture changed",
    module: MODULE,
    trigger: "credit-analysis.posture.changed",
    subject: "{{obligor}}: 360 RAR posture now {{after}}",
    inApp: "{{obligor}} moved from {{before}} to {{after}} ({{reason}}).",
    body: "<p>The 360 RAR posture of <strong>{{obligor}}</strong> ({{obligorId}}) has changed.</p><ul><li>Before: {{before}}</li><li>Now: <strong>{{after}}</strong></li><li>Why: {{reason}}</li><li>Composite: X {{x}} · Y {{y}} · magnitude {{magnitude}}</li></ul><p>{{guidance}}</p>",
    tone: "warning",
    variables: [
      { name: "obligor", description: "Obligor name", example: "Delta Agro Processing Ltd" },
      { name: "obligorId", description: "Obligor ID", example: "OBL-0012" },
      { name: "before", description: "Previous posture label", example: "Moderately Aggressive (Internally-Led)" },
      { name: "after", description: "New posture label", example: "Marginally Competitive (Externally-Led)" },
      { name: "reason", description: "What changed it", example: "Analyst enrichment approved by Chinedu Okafor" },
      { name: "x", description: "X-Composite", example: "6.10" },
      { name: "y", description: "Y-Composite", example: "5.20" },
      { name: "magnitude", description: "Distance from the midpoint", example: "0.95" },
      { name: "guidance", description: "Next step for the reader", example: "Review the advisory note before the next customer conversation." },
    ],
  }),
  tpl({
    id: "credit-analysis.advisory-ready",
    name: "Advisory note signed off",
    module: MODULE,
    trigger: "credit-analysis.advisory.signed-off",
    subject: "Advisory note ready: {{obligor}}",
    inApp: "The 360 RAR advisory note for {{obligor}} ({{posture}}) is signed off.",
    body: "<p>The 360 RAR advisory note for <strong>{{obligor}}</strong> ({{obligorId}}) has been signed off and is ready for the front-office conversation.</p><ul><li>Posture: <strong>{{posture}}</strong></li><li>Prepared by: {{preparedBy}}</li><li>Approved by: {{approvedBy}}</li></ul><p>{{excerpt}}</p>",
    tone: "success",
    variables: [
      { name: "obligor", description: "Obligor name", example: "Delta Agro Processing Ltd" },
      { name: "obligorId", description: "Obligor ID", example: "OBL-0012" },
      { name: "posture", description: "Posture at sign-off", example: "Moderately Conservative (Internally-Led)" },
      { name: "preparedBy", description: "Credit Analyst who drafted it", example: "Adegoke Agnes" },
      { name: "approvedBy", description: "Reviewer who approved it", example: "Chinedu Okafor" },
      { name: "excerpt", description: "First lines of the note", example: "Moderately Conservative, Internally-Led. Interpretive cell “Sector-Led”…" },
    ],
  }),
  tpl({
    id: "credit-analysis.defensive-referral",
    name: "Defensive posture — CRO referral",
    module: MODULE,
    trigger: "credit-analysis.posture.changed (into Defensive)",
    subject: "CRO referral: {{obligor}} is now {{after}}",
    inApp: "{{obligor}} moved into a Defensive posture — mandatory CRO referral.",
    body: "<p><strong>{{obligor}}</strong> ({{obligorId}}) is now <strong>{{after}}</strong> (was {{before}}).</p><p>A Defensive posture needs a mandatory CRO referral regardless of facility size; existing exposure moves to enhanced monitoring with a remediation or exit plan requested from the obligor.</p>",
    tone: "danger",
    variables: [
      { name: "obligor", description: "Obligor name", example: "Kano Textiles Ltd" },
      { name: "obligorId", description: "Obligor ID", example: "OBL-0031" },
      { name: "before", description: "Previous posture label", example: "Marginally Conservative (Externally-Led)" },
      { name: "after", description: "New posture label", example: "Moderately Defensive (Internally-Led)" },
    ],
  }),
  tpl({
    id: "credit-analysis.gating-override-approved",
    name: "Life-cycle gating override approved",
    module: MODULE,
    trigger: "credit-analysis.gating-override.approved",
    subject: "Gating override approved: {{applicationId}} ({{obligor}})",
    inApp: "{{approvedBy}} approved the life-cycle gating override for {{applicationId}}.",
    body: "<p>The Industry Life-Cycle hard exception on <strong>{{applicationId}}</strong> for {{obligor}} has been overridden.</p><ul><li>Request: {{tenorMonths}}-month {{purpose}}</li><li>Industry stage: {{stage}}</li><li>Approved by: {{approvedBy}}</li><li>Rationale: {{rationale}}</li></ul><p>The application can now pass the Credit Analyst tier.</p>",
    tone: "info",
    variables: [
      { name: "applicationId", description: "Application ID", example: "APP-0101" },
      { name: "obligor", description: "Obligor name", example: "Kano Textiles Ltd" },
      { name: "tenorMonths", description: "Requested tenor", example: "60" },
      { name: "purpose", description: "Facility purpose", example: "factory expansion" },
      { name: "stage", description: "Industry life-cycle stage", example: "Decline" },
      { name: "approvedBy", description: "CCO/CRO who approved", example: "Ifeoma Nwosu" },
      { name: "rationale", description: "Documented rationale", example: "Export off-take contract de-risks the decline-stage exposure." },
    ],
  }),
]);

// ---------------------------------------------------------------- shared helpers
function audit(actor: Pick<Actor, "id" | "name" | "roleId">, action: string, entityId: string, before?: string, after?: string) {
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType: "Obligor", entityId, before, after });
}

const assessmentHref = (id: string) => `/credit-analysis/assessment?id=${encodeURIComponent(id)}`;
const subjectOf = (o: Pick<Obligor, "id" | "name">) => ({ type: "Obligor", id: o.id, title: o.name, href: assessmentHref(o.id) });

/** Write recomputed scores to the obligor; publish/notify a posture change. Used by apply handlers and refresh. */
export async function commitScores(obligor: Obligor, scores: RarScores, reason: string, at = DEMO_NOW.toISOString()) {
  const before = rarPosition(obligor.rar);
  const after = rarPosition(scores);
  useDb.getState().update("obligors", obligor.id, { rar: scores, rarUpdatedAt: at });
  if (before.label !== after.label) {
    publish("credit-analysis.posture.changed", { module: MODULE, subject: subjectOf(obligor), payload: { obligorId: obligor.id, before: before.label, after: after.label, base: after.neutral ? "Neutral" : after.base, reason } });
    notify({
      templateId: "credit-analysis.posture-changed",
      toUserIds: [obligor.relationshipManagerId],
      toRoles: getRule<RoleId[]>("credit-analysis.notify.postureChangeRoles"),
      href: assessmentHref(obligor.id),
      data: { obligor: obligor.name, obligorId: obligor.id, before: before.label, after: after.label, reason, x: after.x.toFixed(2), y: after.y.toFixed(2), magnitude: after.magnitude.toFixed(2), guidance: "Review the refreshed advisory note before the next customer conversation." },
    });
    const wasDefensive = !before.neutral && before.base === "Defensive";
    if (!after.neutral && after.base === "Defensive" && !wasDefensive) {
      notify({
        templateId: "credit-analysis.defensive-referral",
        toRoles: getRule<RoleId[]>("credit-analysis.notify.defensiveReferralRoles"),
        toUserIds: [obligor.relationshipManagerId],
        href: assessmentHref(obligor.id),
        data: { obligor: obligor.name, obligorId: obligor.id, before: before.label, after: after.label },
      });
    }
    await runHooks("credit-analysis.posture.change.after", { obligorId: obligor.id, before: before.label, after: after.label });
  }
  return { before, after };
}

const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });
const findObligor = (id: string) => useDb.getState().obligors.find((o) => o.id === id);

// ---------------------------------------------------------------- operation: enrichment change
export type EnrichmentChange = { id: string; name: string; before: number; after: number };
export type EnrichmentPayload = {
  obligorId: string;
  obligorName: string;
  /** Full override set to apply (parameter id → override). */
  overrides: Record<string, ParamOverride>;
  changes: EnrichmentChange[];
  rationale: string;
  beforeLabel: string;
  previewLabel: string;
};

export const OP_ENRICHMENT = "rar.enrichment-change";
registerOperation<EnrichmentPayload>({
  type: OP_ENRICHMENT,
  name: "360 RAR enrichment adjustment",
  module: MODULE,
  description: "Analyst enrichment adjustments to 360 RAR parameter scores. Four-eyes: a second Credit Analyst or the CCO approves before scores and posture change.",
  defaultSteps: [step("review", "Second analyst / CCO review", ["credit-analyst", "cco"], 24)],
  apply: async (p, { instance, actor }) => {
    const obligor = findObligor(p.obligorId);
    if (!obligor) return;
    const at = DEMO_NOW.toISOString();
    const overrides = Object.fromEntries(Object.entries(p.overrides).map(([k, v]) => [k, p.changes.some((c) => c.id === k) ? { ...v, approvedBy: actor.name, operationId: instance.id } : v]));
    useCreditAnalysis.getState().setOverrides(p.obligorId, overrides);
    const a = assess(obligor, overrides, at);
    audit(actor, "Applied approved 360 RAR enrichment adjustments", obligor.id, `${p.beforeLabel}; ${p.changes.map((c) => `${c.id} ${c.before.toFixed(1)}`).join(", ")}`, `${a.position.label}; ${p.changes.map((c) => `${c.id} ${c.after.toFixed(1)}`).join(", ")} — ${p.rationale} (requested by ${instance.requestedBy.name}, ${instance.id})`);
    await commitScores(obligor, a.scores, `Analyst enrichment by ${instance.requestedBy.name}, approved by ${actor.name}`, at);
    publish("credit-analysis.enrichment.applied", { module: MODULE, subject: subjectOf(obligor), payload: { obligorId: obligor.id, operationId: instance.id, before: p.beforeLabel, after: a.position.label, changes: p.changes.length } });
    await runHooks("credit-analysis.enrichment.apply.after", { obligorId: obligor.id, scores: a.scores, posture: a.position.label });
  },
  onReject: (p, { instance }) => {
    publish("credit-analysis.enrichment.rejected", { module: MODULE, subject: { type: "Obligor", id: p.obligorId, title: p.obligorName, href: assessmentHref(p.obligorId) }, payload: { obligorId: p.obligorId, operationId: instance.id } });
  },
});

// ---------------------------------------------------------------- operation: advisory sign-off
export type AdvisoryPayload = { obligorId: string; obligorName: string; text: string; postureLabel: string; editedByAnalyst: boolean };

export const OP_ADVISORY = "rar.advisory-signoff";
registerOperation<AdvisoryPayload>({
  type: OP_ADVISORY,
  name: "360 RAR advisory note sign-off",
  module: MODULE,
  description: "The AI-drafted, analyst-reviewed advisory note is signed off by a second Credit Analyst or the CCO before it is used in the credit memo or shared with the front office.",
  defaultSteps: [step("signoff", "Second analyst / CCO sign-off", ["credit-analyst", "cco"], 24)],
  apply: (p, { instance, actor }) => {
    const obligor = findObligor(p.obligorId);
    const previous = useCreditAnalysis.getState().advisory[p.obligorId];
    const at = new Date().toISOString();
    useCreditAnalysis.getState().signAdvisory(p.obligorId, { text: p.text, signedOffBy: instance.requestedBy.name, at, postureLabel: p.postureLabel, approvedBy: actor.name, operationId: instance.id });
    audit(actor, "Signed off 360 RAR advisory note", p.obligorId, previous ? `Previous sign-off ${previous.at.slice(0, 10)} (${previous.postureLabel})` : "AI-drafted (unsigned)", `${p.postureLabel} · ${p.text.length} chars${p.editedByAnalyst ? " · edited by analyst" : ""} · ${instance.id}`);
    publish("credit-analysis.advisory.signed-off", { module: MODULE, subject: { type: "Obligor", id: p.obligorId, title: p.obligorName, href: `${assessmentHref(p.obligorId)}&tab=advisory` }, payload: { obligorId: p.obligorId, operationId: instance.id, approvedBy: actor.name, posture: p.postureLabel } });
    if (obligor)
      notify({
        templateId: "credit-analysis.advisory-ready",
        toUserIds: [obligor.relationshipManagerId],
        href: `${assessmentHref(p.obligorId)}&tab=advisory`,
        data: { obligor: p.obligorName, obligorId: p.obligorId, posture: p.postureLabel, preparedBy: instance.requestedBy.name, approvedBy: actor.name, excerpt: p.text.split("\n")[0]!.slice(0, 280) },
      });
  },
  onReject: (p, { instance }) => {
    publish("credit-analysis.advisory.rejected", { module: MODULE, subject: { type: "Obligor", id: p.obligorId, title: p.obligorName, href: assessmentHref(p.obligorId) }, payload: { obligorId: p.obligorId, operationId: instance.id } });
  },
});

// ---------------------------------------------------------------- operation: gating override
export type GatingOverridePayload = { obligorId: string; obligorName: string; applicationId: string; tenorMonths: number; purpose: string; stage: string; rationale: string };

export const OP_GATING = "rar.gating-override";
registerOperation<GatingOverridePayload>({
  type: OP_GATING,
  name: "Life-cycle gating override",
  module: MODULE,
  description: "CCO/CRO override, with documented rationale, of a long-tenor expansion request in a hard-exception-stage industry.",
  defaultSteps: [step("override", "CCO / CRO override", ["cco", "cro"], 48)],
  apply: (p, { instance, actor }) => {
    const at = new Date().toISOString();
    useCreditAnalysis.getState().setGatingOverride({ applicationId: p.applicationId, obligorId: p.obligorId, rationale: p.rationale, requestedBy: instance.requestedBy.name, approvedBy: actor.name, at, operationId: instance.id });
    audit(actor, `Overrode Industry Life-Cycle gating for ${p.applicationId}`, p.obligorId, "Hard exception", `Overridden — ${p.rationale} (${instance.id})`);
    publish("credit-analysis.gating-override.approved", { module: MODULE, subject: { type: "Application", id: p.applicationId, title: `${p.obligorName} · ${p.applicationId}`, href: assessmentHref(p.obligorId) }, payload: { obligorId: p.obligorId, applicationId: p.applicationId, operationId: instance.id } });
    const obligor = findObligor(p.obligorId);
    notify({
      templateId: "credit-analysis.gating-override-approved",
      toUserIds: obligor ? [obligor.relationshipManagerId] : [],
      toRoles: getRule<RoleId[]>("credit-analysis.notify.gatingOverrideRoles"),
      href: `${assessmentHref(p.obligorId)}&tab=advisory`,
      data: { applicationId: p.applicationId, obligor: p.obligorName, tenorMonths: p.tenorMonths, purpose: p.purpose.toLowerCase(), stage: p.stage, approvedBy: actor.name, rationale: p.rationale },
    });
  },
  onReject: (p, { instance }) => {
    publish("credit-analysis.gating-override.rejected", { module: MODULE, subject: { type: "Application", id: p.applicationId, title: `${p.obligorName} · ${p.applicationId}`, href: assessmentHref(p.obligorId) }, payload: { obligorId: p.obligorId, applicationId: p.applicationId, operationId: instance.id } });
  },
});

export const CREDIT_ANALYSIS_OPERATIONS = [OP_ENRICHMENT, OP_ADVISORY, OP_GATING];
