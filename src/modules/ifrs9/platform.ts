"use client";

/**
 * Platform registrations for the ifrs9 module (IFRS 9 ECL, staging, model governance, declassification, ICAAP):
 * business rules, operation types (Operations workflow), notification templates, events and hook points.
 * See docs/FRONTEND-CONVENTIONS.md → Platform services.
 */
import type { RoleId } from "@/lib/rbac/roles";
import type { Ifrs9Stage } from "@/lib/data/types";
import { useDb } from "@/lib/data/store";
import { defineEvents, publish, subscribe } from "@/lib/platform/events";
import { defineHookPoints, runHooks } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, useOperationsStore, type WorkflowStep } from "@/lib/platform/operations";
import { applyRuleValue, defineRules, type RuleDefinition, type RuleValue } from "@/lib/platform/rules";
import { currentActor, type Actor } from "@/lib/platform/scope";
import { MACRO, PD_SCALE, PILLAR2, POSTURES, POSTURE_DEFAULTS, SCENARIO_DEFAULTS, SCENARIO_FIELDS, SECTOR_MULTIPLIER_DEFAULTS } from "./data";
import { useIfrs9, type Declassification, type ReservePosting } from "./store";

const M = "ifrs9";
const DEMO = "Tenant parameter (demo value)";

// ---------------------------------------------------------------- business rules
const num = (key: string, label: string, category: string, def: number, source: string, extra: Partial<RuleDefinition> = {}): RuleDefinition => ({
  key: `ifrs9.${key}`,
  label,
  description: extra.description ?? "",
  module: M,
  category,
  type: "number",
  default: def,
  source,
  ...extra,
});
const pctRule = (key: string, label: string, category: string, def: number, source: string, extra: Partial<RuleDefinition> = {}) =>
  num(key, label, category, def, source, { type: "percent", unit: "%", min: 0, max: 100, step: 0.05, ...extra });
const days = (key: string, label: string, category: string, def: number, source: string, extra: Partial<RuleDefinition> = {}) =>
  num(key, label, category, def, source, { unit: "days", min: 0, max: 3650, ...extra });

defineRules([
  // PD calibration (§6.7.2 — demo calibration until the model register supplies it)
  ...PD_SCALE.map((v, i) => num(`pd.grade${i + 1}`, `12-month PD — grade ${i + 1}`, "PD calibration", v, `PD master scale (${DEMO})`, { min: 0, max: 1, step: 0.0001, description: `Through-the-cycle 12-month PD for internal risk grade ${i + 1}.` })),
  ...Object.entries(SECTOR_MULTIPLIER_DEFAULTS).map(([id, v]) => num(`pdMultiplier.sector.${id}`, `Sector PD multiplier — ${id}`, "PD calibration", v, `segmentation by sector (${DEMO})`, { min: 0.1, max: 5, step: 0.05, unit: "×" })),
  ...POSTURES.map((p, i) => num(`pdMultiplier.posture.${p}`, `360 RAR posture PD multiplier — ${p}`, "PD calibration", POSTURE_DEFAULTS[i]!, `segmentation by 360 RAR posture (${DEMO})`, { min: 0.1, max: 5, step: 0.05, unit: "×" })),
  num("pd.floor", "PD floor", "PD calibration", 0.0005, DEMO, { min: 0, max: 0.1, step: 0.0001, description: "Minimum 12-month PD applied." }),
  num("pd.cap", "PD cap (performing)", "PD calibration", 0.95, DEMO, { min: 0.1, max: 1, step: 0.01, description: "Maximum 12-month PD for performing exposures." }),
  num("pd.minTenorYears", "Minimum tenor for PD term structure", "PD calibration", 0.25, DEMO, { min: 0, max: 5, step: 0.05, unit: "years" }),
  ...MACRO.flatMap((s) => [
    pctRule(`fli.${s.id}.weight`, `Macro scenario weight — ${s.name}`, "Forward-looking overlay", s.weight, `external data feed (${DEMO})`, { description: "Probability weight of the scenario; weights should sum to 100%." }),
    num(`fli.${s.id}.pdFactor`, `Macro scenario PD factor — ${s.name}`, "Forward-looking overlay", s.pdFactor, `(${DEMO})`, { min: 0.1, max: 5, step: 0.01, unit: "×" }),
  ]),
  // LGD / EAD
  pctRule("lgd.floor", "LGD floor", "LGD & EAD", 10, DEMO),
  pctRule("lgd.unsecuredCap", "LGD cap (performing)", "LGD & EAD", 75, DEMO, { description: "Upper bound on LGD for Stage 1/2 exposures." }),
  pctRule("lgd.recoveryRate", "Collateral recovery after work-out", "LGD & EAD", 85, `work-out recovery (${DEMO})`, { description: "Share of haircut-adjusted collateral value recovered after time-to-recover and work-out cost." }),
  pctRule("ccf.revolving", "CCF — overdraft / revolving undrawn limit", "LGD & EAD", 75, `undrawn-limit CCF (${DEMO})`),
  pctRule("ccf.guarantee", "CCF — guarantees (transaction-related contingencies)", "LGD & EAD", 50, "CCF category"),
  days("accrual.dpdCap", "Accrued-interest DPD cap", "LGD & EAD", 90, DEMO, { description: "Accrued interest counts at most this many days past due." }),
  days("accrual.windowDays", "Accrued-interest window", "LGD & EAD", 30, DEMO, { description: "Days of current-period accrual added to EAD." }),
  num("usdNgnSpot", "USD/NGN spot rate", "LGD & EAD", 1535, `Rules & Parameters Engine spot-rate feed (${DEMO})`, { type: "money", unit: "₦ per US$", min: 1, max: 100000 }),
  // Staging & SICR (§6.7.1)
  days("stage2DpdTrigger", "Stage 2 DPD backstop", "Staging & SICR", 30, "(Watchlist typically 30–89 days)"),
  days("stage3DpdTrigger", "Stage 3 default definition (DPD)", "Staging & SICR", 90, "(Sub-Standard 90–179 days)"),
  num("sicr.gradeTrigger", "SICR risk-grade trigger", "Staging & SICR", 7, DEMO, { min: 1, max: 10, description: "Internal grade at or above which SICR is flagged (proxy for downgrade since origination)." }),
  num("sicr.notchDowngrade", "SICR notch downgrade", "Staging & SICR", 3, DEMO, { min: 1, max: 9, unit: "notches" }),
  { key: "ifrs9.sicr.watchlistTrigger", label: "SICR — Loan Review watchlist flag", description: "Obligors on the watchlist move to Stage 2.", module: M, category: "Staging & SICR", type: "boolean", default: true, source: "qualitative triggers" },
  { key: "ifrs9.sicr.defensiveTrigger", label: "SICR — Defensive 360 RAR posture", description: "Obligors whose posture moved to Defensive are flagged.", module: M, category: "Staging & SICR", type: "boolean", default: true, source: `(${DEMO})` },
  // CBN prudential provisioning (§6.7.1, §6.7.3)
  pctRule("cbn.generalProvisionRate", "CBN general provision (performing)", "CBN provisioning", 1, `general provision (${DEMO})`),
  pctRule("cbn.generalProvisionCapRwa", "General provision cap (% of RWA)", "CBN provisioning", 1.25, "(CBN 3.16(d))"),
  pctRule("cbn.substandardRate", "Specific provision — Sub-Standard", "CBN provisioning", 10, "(CBN 12.2(a)(2)(i))"),
  pctRule("cbn.doubtfulRate", "Specific provision — Doubtful", "CBN provisioning", 50, "(CBN 12.2(a)(2)(ii))"),
  pctRule("cbn.lostRate", "Specific provision — Lost", "CBN provisioning", 100, "(CBN 12.2(a)(2)(iii))"),
  days("cbn.dpd.watchlist", "CBN Watchlist from (DPD)", "CBN provisioning", 30, "Platform default"),
  days("cbn.dpd.substandard", "CBN Sub-Standard from (DPD)", "CBN provisioning", 90, "Platform default"),
  days("cbn.dpd.doubtful", "CBN Doubtful from (DPD)", "CBN provisioning", 180, "Platform default"),
  days("cbn.dpd.lost", "CBN Lost from (DPD)", "CBN provisioning", 360, "Platform default"),
  pctRule("cbn.haircut.cash", "Lost haircut weighting — cash / deposits", "CBN provisioning", 0, "(CBN 12.13(a)(5))"),
  pctRule("cbn.haircut.quotedShares", "Lost haircut weighting — quoted equities", "CBN provisioning", 20, "(CBN 12.13(a)(5))"),
  pctRule("cbn.haircut.legalMortgage", "Lost haircut weighting — legal mortgage", "CBN provisioning", 50, "(CBN 12.13(a)(5))"),
  days("cbn.haircutLapseDays", "Haircut adjustment lapses after (in Lost)", "CBN provisioning", 365, "(CBN 12.13(b)(3)-(4): max 1 year)"),
  // Declassification (§6.7.5)
  days("cure.stage3DpdThreshold", "Stage 3 → 2: arrears cured below", "Declassification", 90, "configurable DPD threshold (demo default)"),
  num("cure.periods", "Cure period (consecutive timely repayments)", "Declassification", 3, "configurable cure period (demo default)", { min: 1, max: 24, unit: "periods" }),
  num("cure.stage2ProbationMonths", "Stage 2 → 1 probation", "Declassification", 3, "configurable probation (demo default)", { min: 0, max: 36, unit: "months" }),
  num("cure.restructuredProbationMonths", "Restructured / modified probation", "Declassification", 12, "configurable probation (demo default)", { min: 0, max: 60, unit: "months" }),
  num("cure.watchlistExtraPeriods", "Extra timely periods while on watchlist", "Declassification", 3, DEMO, { min: 0, max: 24, unit: "periods" }),
  {
    key: "ifrs9.cure.suspendedInterestPolicy",
    label: "Suspended-interest write-back",
    description: "When interest suspended in Stage 3 is written back to income.",
    module: M,
    category: "Declassification",
    type: "enum",
    default: "On cash receipt",
    options: [
      { value: "On cash receipt", label: "On cash receipt" },
      { value: "On declassification", label: "On declassification" },
    ],
    source: "tenant policy",
  },
  // Model governance
  num("model.reviewIntervalMonths", "Model refresh interval", "Model governance", 12, "(CBN 12.15: at least annually)", { min: 1, max: 12, unit: "months" }),
  // ICAAP (§6.7.4, §9.1)
  {
    key: "ifrs9.icaap.licenceCategory",
    label: "Licence category (minimum CAR)",
    description: "Selects the applicable minimum CAR.",
    module: M,
    category: "ICAAP — capital adequacy",
    type: "enum",
    default: "international",
    options: [
      { value: "other", label: "Other banks" },
      { value: "international", label: "International / SIB" },
    ],
    source: "tenant licence category",
  },
  pctRule("icaap.minCarOther", "Minimum CAR — other banks", "ICAAP — capital adequacy", 10, "Platform default"),
  pctRule("icaap.minCarInternational", "Minimum CAR — international / SIB", "ICAAP — capital adequacy", 15, "Platform default"),
  pctRule("icaap.tier2CapPctOfTier1", "Tier 2 cap (% of Tier 1)", "ICAAP — capital adequacy", 33.3333, "one-third of Tier 1", { step: 0.0001 }),
  pctRule("icaap.band.significantly", "Significantly under-capitalised below", "ICAAP — capital adequacy", 5, "(CBN 3.16(f)-(g))"),
  pctRule("icaap.band.critically", "Critically under-capitalised below", "ICAAP — capital adequacy", 2, "(CBN 3.16(f)-(g))"),
  pctRule("icaap.taxShield", "Tax shield on ECL increase", "ICAAP — capital adequacy", 30, DEMO),
  ...PILLAR2.map((p) => pctRule(`icaap.pillar2.${p.id}`, `Pillar 2 add-on — ${p.risk}`, "ICAAP — Pillar 2", p.def, `Tenant ICAAP policy (${DEMO})`, { description: `${p.basis}. % of RWA.`, max: 20 })),
  // Capital base demo calibration (GL connector not yet live) — TD in TECH-DEBT.md
  pctRule("capital.rw.publicSector", "Risk weight — public sector", "ICAAP — capital base", 20, `risk weights (${DEMO})`, { max: 1250 }),
  pctRule("capital.rw.retail", "Risk weight — retail", "ICAAP — capital base", 75, `risk weights (${DEMO})`, { max: 1250 }),
  pctRule("capital.rw.defaulted", "Risk weight — Stage 3 / defaulted", "ICAAP — capital base", 150, `risk weights (${DEMO})`, { max: 1250 }),
  pctRule("capital.rw.corporate", "Risk weight — other exposures", "ICAAP — capital base", 100, `risk weights (${DEMO})`, { max: 1250 }),
  pctRule("capital.loanBookShareOfCreditRwa", "Loan book share of credit RWA", "ICAAP — capital base", 69, `Demo calibration until the GL connector is live (${DEMO})`, { min: 1 }),
  pctRule("capital.marketRwaPct", "Market RWA (% of credit RWA)", "ICAAP — capital base", 8, `Demo calibration (${DEMO})`),
  pctRule("capital.operationalRwaPct", "Operational RWA (% of credit RWA)", "ICAAP — capital base", 16, `Demo calibration (${DEMO})`),
  pctRule("capital.tier1Pct", "Tier 1 gross (% of RWA)", "ICAAP — capital base", 16.8, `Demo calibration (${DEMO})`),
  pctRule("capital.deductionsPct", "Regulatory deductions (% of RWA)", "ICAAP — capital base", 1.2, `Demo calibration (${DEMO})`),
  pctRule("capital.tier2Pct", "Tier 2 gross (% of RWA)", "ICAAP — capital base", 4.1, `Demo calibration (${DEMO})`),
  pctRule("capital.fxMarketRwaSensitivity", "Market RWA sensitivity to FX devaluation", "ICAAP — capital base", 50, DEMO),
  // ICAAP stress scenarios (§6.7.4)
  ...Object.entries(SCENARIO_DEFAULTS).flatMap(([id, values]) =>
    SCENARIO_FIELDS.map((f) =>
      num(`scenario.${id}.${f.field}`, `${id[0]!.toUpperCase()}${id.slice(1)} scenario — ${f.label}`, "ICAAP — stress scenarios", values[f.field]!, `macro scenarios (${DEMO})`, {
        unit: f.unit,
        min: f.min,
        max: f.max,
        step: f.step,
      }),
    ),
  ),
]);

/** Rule-key groups for the governance page and inline panels. */
export const IFRS9_RULE_GROUPS = {
  staging: ["stage2DpdTrigger", "stage3DpdTrigger", "sicr.gradeTrigger", "sicr.notchDowngrade", "sicr.watchlistTrigger", "sicr.defensiveTrigger"].map((k) => `ifrs9.${k}`),
  provisioning: ["cbn.generalProvisionRate", "cbn.generalProvisionCapRwa", "cbn.substandardRate", "cbn.doubtfulRate", "cbn.lostRate", "cbn.dpd.watchlist", "cbn.dpd.substandard", "cbn.dpd.doubtful", "cbn.dpd.lost", "cbn.haircut.cash", "cbn.haircut.quotedShares", "cbn.haircut.legalMortgage", "cbn.haircutLapseDays"].map((k) => `ifrs9.${k}`),
  cure: ["cure.stage3DpdThreshold", "cure.periods", "cure.stage2ProbationMonths", "cure.restructuredProbationMonths", "cure.watchlistExtraPeriods", "cure.suspendedInterestPolicy"].map((k) => `ifrs9.${k}`),
  pd: [
    ...PD_SCALE.map((_, i) => `ifrs9.pd.grade${i + 1}`),
    ...Object.keys(SECTOR_MULTIPLIER_DEFAULTS).map((id) => `ifrs9.pdMultiplier.sector.${id}`),
    ...POSTURES.map((p) => `ifrs9.pdMultiplier.posture.${p}`),
    "ifrs9.pd.floor",
    "ifrs9.pd.cap",
    "ifrs9.pd.minTenorYears",
    ...MACRO.flatMap((s) => [`ifrs9.fli.${s.id}.weight`, `ifrs9.fli.${s.id}.pdFactor`]),
  ],
  lgdEad: ["lgd.floor", "lgd.unsecuredCap", "lgd.recoveryRate", "ccf.revolving", "ccf.guarantee", "accrual.dpdCap", "accrual.windowDays", "usdNgnSpot"].map((k) => `ifrs9.${k}`),
  models: ["ifrs9.model.reviewIntervalMonths"],
  capital: ["icaap.licenceCategory", "icaap.minCarOther", "icaap.minCarInternational", "icaap.tier2CapPctOfTier1", "icaap.band.significantly", "icaap.band.critically", "icaap.taxShield", ...PILLAR2.map((p) => `icaap.pillar2.${p.id}`)].map((k) => `ifrs9.${k}`),
  capitalBase: ["rw.publicSector", "rw.retail", "rw.defaulted", "rw.corporate", "loanBookShareOfCreditRwa", "marketRwaPct", "operationalRwaPct", "tier1Pct", "deductionsPct", "tier2Pct", "fxMarketRwaSensitivity"].map((k) => `ifrs9.capital.${k}`),
  scenarios: Object.keys(SCENARIO_DEFAULTS).flatMap((id) => SCENARIO_FIELDS.map((f) => `ifrs9.scenario.${id}.${f.field}`)),
};

// ---------------------------------------------------------------- helpers
// Step SLA hours below are default workflow definitions, editable via "workflow.change" (TD-127).
// Scenario severities can also change via the generic rule.change (TD-128).
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number, mode: "any" | "all" = "any", adjudicatorRole?: RoleId): WorkflowStep => ({ id, name, approverRoles, mode, slaHours, adjudicatorRole });

function audit(actor: Actor, action: string, entityType: string, entityId: string, before?: string, after?: string) {
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType, entityId, before, after });
}
const ngn = (v: number) => `₦${Math.round(v).toLocaleString("en-NG")}`;
const stamp = (a: Actor) => `${a.name} (${a.roleId})`;

// ---------------------------------------------------------------- operations

/** Declassification (§6.7.5): the engine proposes, the tenant-configured approving officer approves (via §6.4.4). */
registerOperation<Declassification>({
  type: "ifrs9.declassification",
  name: "IFRS 9 declassification & write-back",
  module: M,
  description: "Stage reversal with ECL and suspended-interest write-back. Proposed by Predictive Analytics, approved by the approving officer.",
  defaultSteps: [step("approve", "Approving officer", ["head-of-risk", "cro"], 48)],
  apply: async (d, { instance, actor }) => {
    const hook = await runHooks("ifrs9.declassification.apply.before", { declassification: d, actor });
    if (!hook.ok) {
      useIfrs9.getState().updateDeclassification(d.id, { status: "Rejected", decidedBy: stamp(actor), decidedAt: new Date().toISOString(), comment: `Blocked by ${hook.vetoedBy}: ${hook.reason}` });
      audit(actor, "IFRS 9 declassification blocked by hook", "Facility", d.facilityId, undefined, hook.reason);
      return;
    }
    const writeBack = (d.eclBefore - d.eclAfter) * d.performingPortion;
    useIfrs9.getState().updateDeclassification(d.id, { status: "Approved", decidedBy: stamp(actor), decidedAt: new Date().toISOString(), comment: instance.decisions.at(-1)?.comment });
    if (d.performingPortion >= 1) {
      const fac = useDb.getState().facilities.find((f) => f.id === d.facilityId);
      if (fac) {
        useDb.getState().update("facilities", fac.id, { stage: d.to as Ifrs9Stage, cbnClass: d.to === 1 ? "Performing" : "Watchlist", dpd: d.currentDpd ?? fac.dpd });
        audit(actor, "Facility stage changed by declassification", "Facility", fac.id, `Stage ${fac.stage} · ${fac.cbnClass} · ${fac.dpd} DPD`, `Stage ${d.to}`);
      }
    }
    audit(actor, "Approved IFRS 9 declassification", "Facility", d.facilityId, `Stage ${d.from}, ECL ${ngn(d.eclBefore)}`, `Stage ${d.to} (${Math.round(d.performingPortion * 100)}%), ECL write-back ${ngn(writeBack)}, interest write-back ${ngn(d.interestWriteBack)}`);
    publish("ifrs9.declassification.approved", { module: M, subject: { type: "Facility", id: d.facilityId, title: d.obligorName, href: "/ifrs9/declassification" }, payload: { declassificationId: d.id, from: d.from, to: d.to, writeBack, interestWriteBack: d.interestWriteBack } });
    notify({
      templateId: "ifrs9.declassification-approved",
      toRoles: ["predictive-analytics-officer", "head-of-risk"],
      toUserIds: d.proposedById ? [d.proposedById] : undefined,
      href: "/ifrs9/declassification",
      data: { facility: d.facilityId, obligor: d.obligorName, from: d.from, to: d.to, portion: `${Math.round(d.performingPortion * 100)}%`, writeBack: ngn(writeBack), interest: ngn(d.interestWriteBack), approver: actor.name },
    });
    await runHooks("ifrs9.declassification.apply.after", { declassification: d, actor });
  },
  onReject: (d, { actor, instance }) => {
    useIfrs9.getState().updateDeclassification(d.id, { status: "Rejected", decidedBy: stamp(actor), decidedAt: new Date().toISOString(), comment: instance.reason });
    audit(actor, "Rejected IFRS 9 declassification", "Facility", d.facilityId, `Stage ${d.from}`, `Rejected: ${instance.reason ?? ""}`);
    publish("ifrs9.declassification.rejected", { module: M, subject: { type: "Facility", id: d.facilityId, title: d.obligorName, href: "/ifrs9/declassification" }, payload: { declassificationId: d.id } });
  },
});

export type ModelApprovalPayload = { modelId: string; modelName: string; currentVersion: string; version: string; change: string; note?: string };

/** Model governance (§6.7.2): owner submits → independent validation (2nd line) → approval for production. */
registerOperation<ModelApprovalPayload>({
  type: "ifrs9.model.approval",
  name: "PD / LGD / EAD model version approval",
  module: M,
  description: "Model change governance: submitted by the model owner, independently validated, then approved for production.",
  defaultSteps: [step("validate", "Independent validation (2nd line)", ["head-of-risk"], 120), step("approve", "Approval for production", ["cro"], 72)],
  apply: (p, { actor }) => {
    if (p.version !== p.currentVersion) useIfrs9.getState().setModelVersion(p.modelId, p.version);
    useIfrs9.getState().setModelStatus(p.modelId, "Approved", { by: stamp(actor), action: `Approved v${p.version} for production`, note: p.change });
    audit(actor, "Model governance: approved for production", "RiskModel", `${p.modelId} v${p.version}`, "Pending approval", "Approved");
    publish("ifrs9.model.approved", { module: M, subject: { type: "RiskModel", id: p.modelId, title: p.modelName, href: "/ifrs9/models" }, payload: { version: p.version } });
    notify({ templateId: "ifrs9.model-approved", toRoles: ["predictive-analytics-officer", "head-of-risk"], href: "/ifrs9/models", data: { model: p.modelName, version: p.version, change: p.change, approver: actor.name } });
  },
  onReject: (p, { actor, instance }) => modelFindings(p, actor, instance.reason ?? "Rejected"),
});

function modelFindings(p: ModelApprovalPayload, actor: Actor, reason: string) {
  useIfrs9.getState().setModelStatus(p.modelId, "Validation findings", { by: stamp(actor), action: "Validation findings raised", note: reason });
  audit(actor, "Model governance: validation findings", "RiskModel", `${p.modelId} v${p.version}`, undefined, reason);
  publish("ifrs9.model.findings-raised", { module: M, subject: { type: "RiskModel", id: p.modelId, title: p.modelName, href: "/ifrs9/models" }, payload: { version: p.version, reason } });
  notify({ templateId: "ifrs9.model-findings", toRoles: ["predictive-analytics-officer"], href: "/ifrs9/models", data: { model: p.modelName, version: p.version, reviewer: actor.name, findings: reason } });
}

/** CBN 12.4 regulatory-risk-reserve transfer posted to the Finance module (§6.7.1). */
registerOperation<Omit<ReservePosting, "id" | "at" | "by">>({
  type: "ifrs9.ecl.post",
  name: "Post ECL / regulatory-reserve entry to Finance",
  module: M,
  description: "Prudential-vs-IFRS 9 reserve-transfer entry (CBN 12.4) posted to the Finance module after review.",
  defaultSteps: [step("review", "Head of Risk review", ["head-of-risk"], 24), step("approve", "CRO approval", ["cro"], 24)],
  apply: async (p, { actor, instance }) => {
    const hook = await runHooks("ifrs9.reserve.post.before", { posting: p, actor });
    if (!hook.ok) {
      audit(actor, "Reserve-transfer posting blocked by hook", "Ifrs9ReserveTransfer", p.period, undefined, hook.reason);
      return;
    }
    const posting: ReservePosting = { ...hook.ctx.posting, id: instance.id, at: new Date().toISOString(), by: actor.name };
    useIfrs9.getState().addPosting(posting);
    audit(actor, "Posted CBN 12.4 reserve-transfer entry to Finance", "Ifrs9ReserveTransfer", p.period, undefined, `${p.direction}: ${ngn(p.amount)}`);
    publish("ifrs9.reserve.posted", { module: M, subject: { type: "Ifrs9ReserveTransfer", id: p.period, title: `Reserve transfer ${p.period}`, href: "/ifrs9" }, payload: { amount: p.amount, direction: p.direction, ifrs: p.ifrs, prudential: p.prudential } });
    notify({ templateId: "ifrs9.reserve-posted", toRoles: ["head-of-risk", "cro", "predictive-analytics-officer"], href: "/ifrs9", data: { period: p.period, direction: p.direction, amount: ngn(p.amount), ifrs: ngn(p.ifrs), prudential: ngn(p.prudential), approver: actor.name } });
    await runHooks("ifrs9.reserve.post.after", { posting, actor });
  },
});

export type ScenarioChangePayload = { changes: { key: string; label: string; before: RuleValue; after: RuleValue }[]; reason: string };

/** ICAAP stress-scenario severities (rules) — changed as one approved set. */
registerOperation<ScenarioChangePayload>({
  type: "ifrs9.icaap.scenario.change",
  name: "ICAAP stress scenario change",
  module: M,
  description: "Change macro shock severities of the ICAAP stress scenarios. Applied to the business rules on approval.",
  defaultSteps: [step("review", "Head of Risk review", ["head-of-risk"], 48), step("approve", "CRO approval", ["cro"], 48)],
  apply: async (p, { actor, instance }) => {
    const hook = await runHooks("ifrs9.scenario.change.before", { ...p, actor });
    if (!hook.ok) {
      audit(actor, "ICAAP scenario change blocked by hook", "IcaapScenarioSet", "icaap-scenarios", undefined, hook.reason);
      return;
    }
    for (const c of hook.ctx.changes) applyRuleValue(c.key, c.after, { id: actor.id, name: actor.name }, { reason: p.reason, operationId: instance.id });
    audit(actor, "Changed ICAAP stress scenarios", "IcaapScenarioSet", "icaap-scenarios", p.changes.map((c) => `${c.label}=${String(c.before)}`).join("; "), p.changes.map((c) => `${c.label}=${String(c.after)}`).join("; "));
    publish("ifrs9.scenario.changed", { module: M, subject: { type: "IcaapScenarioSet", id: "icaap-scenarios", title: "ICAAP stress scenarios", href: "/ifrs9/icaap" }, payload: { changes: p.changes } });
    notify({ templateId: "ifrs9.scenario-approved", toRoles: ["predictive-analytics-officer", "head-of-risk", "cro"], href: "/ifrs9/icaap", data: { count: p.changes.length, changes: p.changes.map((c) => `${c.label}: ${String(c.before)} → ${String(c.after)}`).join("; "), reason: p.reason, approver: actor.name } });
    await runHooks("ifrs9.scenario.change.after", { ...p, actor });
  },
});

export type IcaapSubmission = { id: string; period: string; car: number; minimumCar: number; classification: string; internalTarget: number; results: { scenario: string; car: number; classification: string }[] };

/** ICAAP report sign-off: Head of Risk → CRO → Board (PRD §6.7.4; annual ICAAP submission). */
registerOperation<IcaapSubmission>({
  type: "ifrs9.icaap.approval",
  name: "ICAAP report sign-off",
  module: M,
  description: "Annual ICAAP (capital adequacy, Pillar 2, stress results) reviewed by the Head of Risk, endorsed by the CRO and approved by the Board.",
  defaultSteps: [step("review", "Head of Risk review", ["head-of-risk"], 72), step("endorse", "CRO endorsement", ["cro"], 72), step("board", "Board approval", ["board"], 240)],
  apply: (p, { actor }) => {
    useIfrs9.getState().addIcaapApproval({ ...p, approvedAt: new Date().toISOString(), approvedBy: actor.name });
    audit(actor, "ICAAP report approved", "IcaapReport", p.id, undefined, `CAR ${p.car.toFixed(2)}% · ${p.classification}`);
    publish("ifrs9.icaap.approved", { module: M, subject: { type: "IcaapReport", id: p.id, title: `ICAAP ${p.period}`, href: "/ifrs9/icaap" }, payload: { car: p.car, classification: p.classification } });
    notify({ templateId: "ifrs9.icaap-approved", toRoles: ["head-of-risk", "cro", "predictive-analytics-officer", "md"], href: "/ifrs9/icaap", data: { period: p.period, car: `${p.car.toFixed(2)}%`, classification: p.classification, approver: actor.name } });
  },
});

// Returned / withdrawn operations: keep module records in step with the workflow outcome.
subscribe({
  id: "ifrs9.sync-closed-operations",
  name: "IFRS 9: sync returned / withdrawn approvals",
  pattern: "operations.request.*",
  handler: (e) => {
    const p = e.payload as { operationType?: string; subject?: { type: string; id: string } };
    const status = e.name.split(".").pop();
    if (status !== "returned" && status !== "cancelled") return;
    const instance = useOperationsStore.getState().instances.find((i) => i.id === e.subject?.id);
    if (p.operationType === "ifrs9.declassification" && p.subject) {
      useIfrs9.getState().updateDeclassification(p.subject.id, { status: status === "returned" ? "Returned" : "Withdrawn", decidedAt: e.at, comment: instance?.reason });
    }
    if (p.operationType === "ifrs9.model.approval" && instance) {
      const payload = instance.payload as ModelApprovalPayload;
      if (status === "returned") modelFindings(payload, currentActor(), instance.reason ?? "Returned to the model owner");
      else useIfrs9.getState().setModelStatus(payload.modelId, "Approved", { by: e.actorName, action: "Submission withdrawn", note: instance.reason });
    }
  },
});

// Validation step passed → model moves to "Pending approval".
subscribe({
  id: "ifrs9.model-validation-passed",
  name: "IFRS 9: model validation step passed",
  pattern: "operations.step.decided",
  handler: (e) => {
    const p = e.payload as { stepId: string; decision: string };
    const instance = useOperationsStore.getState().instances.find((i) => i.id === e.subject?.id);
    if (!instance || instance.operationType !== "ifrs9.model.approval" || p.stepId !== "validate" || p.decision !== "approve") return;
    const payload = instance.payload as ModelApprovalPayload;
    useIfrs9.getState().setModelStatus(payload.modelId, "Pending approval", { by: e.actorName, action: "Validation passed (2nd line)" });
    publish("ifrs9.model.validated", { module: M, subject: { type: "RiskModel", id: payload.modelId, title: payload.modelName, href: "/ifrs9/models" }, payload: { version: payload.version } });
  },
});

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "ifrs9.declassification-approved",
    name: "Declassification approved",
    module: M,
    trigger: "ifrs9.declassification.approved",
    subject: "Declassification approved: {{facility}} Stage {{from}} → {{to}}",
    inApp: "{{obligor}} ({{facility}}) moved Stage {{from}} → {{to}}; ECL write-back {{writeBack}}.",
    body: "<p>The declassification of <strong>{{facility}}</strong> ({{obligor}}) was approved by {{approver}}.</p><ul><li>Migration: Stage {{from}} → Stage {{to}} ({{portion}} performing)</li><li>ECL write-back: <strong>{{writeBack}}</strong> (credit to impairment charge)</li><li>Suspended-interest write-back: {{interest}}</li></ul><p>The CBN 12.4 reserve reconciliation is recomputed in the same posting.</p>",
    tone: "success",
    variables: [
      { name: "facility", description: "Facility reference", example: "FAC-2026014" },
      { name: "obligor", description: "Obligor name", example: "Adewale Foods Ltd" },
      { name: "from", description: "Origin stage", example: "3" },
      { name: "to", description: "Destination stage", example: "2" },
      { name: "portion", description: "Performing portion migrated", example: "100%" },
      { name: "writeBack", description: "ECL write-back (NGN)", example: "₦12,400,000" },
      { name: "interest", description: "Suspended-interest write-back (NGN)", example: "₦0" },
      { name: "approver", description: "Approving officer", example: "Chinedu Okafor" },
    ],
  }),
  tpl({
    id: "ifrs9.model-approved",
    name: "Model approved for production",
    module: M,
    trigger: "ifrs9.model.approved",
    subject: "Model approved: {{model}} v{{version}}",
    inApp: "{{model}} v{{version}} was approved for production by {{approver}}.",
    body: "<p><strong>{{model}}</strong> version {{version}} passed independent validation and was approved for production by {{approver}}.</p><p>Change: {{change}}</p><p>The ECL engine uses this version from the next staging run.</p>",
    tone: "success",
    variables: [
      { name: "model", description: "Model name", example: "Forward-looking macro overlay" },
      { name: "version", description: "Version", example: "4.0" },
      { name: "change", description: "Change submitted", example: "Recalibrated scenario weights" },
      { name: "approver", description: "Approver", example: "Chief Risk Officer" },
    ],
  }),
  tpl({
    id: "ifrs9.model-findings",
    name: "Model validation findings",
    module: M,
    trigger: "ifrs9.model.findings-raised",
    subject: "Validation findings: {{model}} v{{version}}",
    inApp: "{{reviewer}} raised findings on {{model}} v{{version}}.",
    body: "<p>{{reviewer}} did not approve <strong>{{model}}</strong> version {{version}}.</p><p>Findings: {{findings}}</p><p>Address the findings and resubmit the model for validation.</p>",
    tone: "warning",
    variables: [
      { name: "model", description: "Model name", example: "Unsecured LGD" },
      { name: "version", description: "Version", example: "1.6" },
      { name: "reviewer", description: "Validator / approver", example: "Head of Risk" },
      { name: "findings", description: "Findings / reason", example: "Recovery data older than 3 years dominates the sample." },
    ],
  }),
  tpl({
    id: "ifrs9.reserve-posted",
    name: "Regulatory-reserve entry posted",
    module: M,
    trigger: "ifrs9.reserve.posted",
    subject: "Reserve-transfer entry posted for {{period}}",
    inApp: "{{direction}}: {{amount}} posted to Finance ({{period}}).",
    body: "<p>The CBN 12.4 reserve-transfer entry for <strong>{{period}}</strong> was approved by {{approver}} and posted to the Finance module.</p><ul><li>{{direction}}: <strong>{{amount}}</strong></li><li>IFRS 9 impairment: {{ifrs}}</li><li>CBN prudential provision: {{prudential}}</li></ul>",
    tone: "info",
    variables: [
      { name: "period", description: "Reporting period", example: "2026-10" },
      { name: "direction", description: "Entry direction", example: "Transfer from general reserve to regulatory risk reserve" },
      { name: "amount", description: "Amount (NGN)", example: "₦1,250,000,000" },
      { name: "ifrs", description: "IFRS 9 ECL (NGN)", example: "₦8,400,000,000" },
      { name: "prudential", description: "Prudential provision (NGN)", example: "₦9,650,000,000" },
      { name: "approver", description: "Final approver", example: "Chief Risk Officer" },
    ],
  }),
  tpl({
    id: "ifrs9.car-breach",
    name: "CAR below minimum (stress test)",
    module: M,
    trigger: "ifrs9.car.breached",
    subject: "Stress test: CAR below {{minimum}} under {{scenarios}}",
    inApp: "{{scenarios}} would take CAR below the {{minimum}} minimum (lowest {{lowest}}).",
    body: "<p>The ICAAP stress test run by {{runBy}} projects CAR below the licence minimum of <strong>{{minimum}}</strong>.</p><ul><li>Scenarios breaching: {{scenarios}}</li><li>Lowest stressed CAR: <strong>{{lowest}}</strong></li><li>Current CAR: {{current}}</li></ul><p>Document capital-planning actions in the ICAAP report.</p>",
    tone: "danger",
    variables: [
      { name: "scenarios", description: "Breaching scenarios", example: "Severe" },
      { name: "minimum", description: "Applicable minimum CAR", example: "15%" },
      { name: "lowest", description: "Lowest stressed CAR", example: "12.40%" },
      { name: "current", description: "Current CAR", example: "17.90%" },
      { name: "runBy", description: "Who ran the test", example: "Predictive Analytics Officer" },
    ],
  }),
  tpl({
    id: "ifrs9.scenario-approved",
    name: "ICAAP stress scenarios changed",
    module: M,
    trigger: "ifrs9.scenario.changed",
    subject: "ICAAP stress scenarios updated ({{count}} changes)",
    inApp: "{{approver}} approved {{count}} ICAAP scenario change(s).",
    body: "<p>{{approver}} approved changes to the ICAAP stress scenarios.</p><p>{{changes}}</p><p>Reason: {{reason}}</p>",
    tone: "info",
    variables: [
      { name: "count", description: "Number of changed parameters", example: "2" },
      { name: "changes", description: "Changes (label: before → after)", example: "Severe scenario — PD multiplier: 2.4 → 2.8" },
      { name: "reason", description: "Change reason", example: "Q4 macro review" },
      { name: "approver", description: "Final approver", example: "Chief Risk Officer" },
    ],
  }),
  tpl({
    id: "ifrs9.icaap-approved",
    name: "ICAAP approved by the Board",
    module: M,
    trigger: "ifrs9.icaap.approved",
    subject: "ICAAP {{period}} approved",
    inApp: "ICAAP {{period}} approved by {{approver}} — CAR {{car}} ({{classification}}).",
    body: "<p>The ICAAP report for <strong>{{period}}</strong> completed its sign-off chain and was approved by {{approver}}.</p><ul><li>CAR: <strong>{{car}}</strong></li><li>Classification: {{classification}}</li></ul><p>The report is ready for submission to the CBN.</p>",
    tone: "success",
    variables: [
      { name: "period", description: "ICAAP period", example: "2026" },
      { name: "car", description: "CAR at submission", example: "17.90%" },
      { name: "classification", description: "Capital classification", example: "Adequately capitalised" },
      { name: "approver", description: "Final approver", example: "Board of Directors" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "ifrs9.declassification.proposed", module: M, description: "A declassification was proposed and routed for approval.", payloadExample: { declassificationId: "DCL-1", from: 3, to: 2 } },
  { name: "ifrs9.declassification.approved", module: M, description: "A declassification was approved; ECL/interest written back.", payloadExample: { writeBack: 12_400_000 } },
  { name: "ifrs9.declassification.rejected", module: M, description: "A declassification was rejected." },
  { name: "ifrs9.model.submitted", module: M, description: "A model version was submitted for validation and approval." },
  { name: "ifrs9.model.validated", module: M, description: "A model passed independent validation." },
  { name: "ifrs9.model.findings-raised", module: M, description: "Validation findings were raised on a model (rejected or returned)." },
  { name: "ifrs9.model.approved", module: M, description: "A model version was approved for production." },
  { name: "ifrs9.reserve.post-requested", module: M, description: "A CBN 12.4 reserve-transfer posting was submitted for approval." },
  { name: "ifrs9.reserve.posted", module: M, description: "The reserve-transfer entry was posted to Finance." },
  { name: "ifrs9.stresstest.completed", module: M, description: "An ICAAP stress test was run.", payloadExample: { results: [{ scenario: "Severe", car: 12.4 }] } },
  { name: "ifrs9.car.breached", module: M, description: "A stress scenario projects CAR below the applicable minimum." },
  { name: "ifrs9.scenario.change-requested", module: M, description: "A change to the ICAAP stress scenarios was submitted." },
  { name: "ifrs9.scenario.changed", module: M, description: "ICAAP stress scenarios changed (after approval)." },
  { name: "ifrs9.icaap.submitted", module: M, description: "The ICAAP report was submitted for sign-off." },
  { name: "ifrs9.icaap.approved", module: M, description: "The ICAAP report was approved by the Board." },
  { name: "ifrs9.ai-finding.reviewed", module: M, description: "A human accepted or dismissed an AI-flagged model finding." },
]);

defineHookPoints([
  { point: "ifrs9.declassification.propose.before", module: M, kind: "before", description: "Before a declassification is proposed. Veto to block, or enrich the proposal." },
  { point: "ifrs9.declassification.propose.after", module: M, kind: "after", description: "After a declassification is routed for approval." },
  { point: "ifrs9.declassification.apply.before", module: M, kind: "before", description: "Before an approved declassification changes the facility stage. Veto blocks the write-back." },
  { point: "ifrs9.declassification.apply.after", module: M, kind: "after", description: "After the stage change and write-back." },
  { point: "ifrs9.model.submit.before", module: M, kind: "before", description: "Before a model version is submitted for validation." },
  { point: "ifrs9.model.submit.after", module: M, kind: "after", description: "After a model version is submitted." },
  { point: "ifrs9.reserve.post.before", module: M, kind: "before", description: "Before the reserve-transfer entry is posted to Finance (also at request time). Veto or enrich the entry." },
  { point: "ifrs9.reserve.post.after", module: M, kind: "after", description: "After the entry is posted to Finance." },
  { point: "ifrs9.stresstest.run.before", module: M, kind: "before", description: "Before an ICAAP stress test runs. Veto to block." },
  { point: "ifrs9.stresstest.run.after", module: M, kind: "after", description: "After an ICAAP stress test with its results." },
  { point: "ifrs9.scenario.change.before", module: M, kind: "before", description: "Before ICAAP scenario changes are requested / applied." },
  { point: "ifrs9.scenario.change.after", module: M, kind: "after", description: "After ICAAP scenario changes are applied." },
  { point: "ifrs9.icaap.submit.before", module: M, kind: "before", description: "Before the ICAAP report is submitted for sign-off." },
  { point: "ifrs9.icaap.submit.after", module: M, kind: "after", description: "After the ICAAP report is submitted." },
]);

