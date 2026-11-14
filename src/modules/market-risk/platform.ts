"use client";

// Workflow step SLA hours in defaultSteps are literals (TD-127); RAS keys also changeable via generic rule.change (TD-128).

/**
 * Platform registrations for the market-risk module (PRD §6.8 Market & Liquidity Risk, ILAAP, stress testing):
 * business rules, operation types (Operations workflow), notification templates, events and hook points.
 * See docs/FRONTEND-CONVENTIONS.md → Platform services.
 */
import type { RoleId } from "@/lib/rbac/roles";
import { useDb } from "@/lib/data/store";
import { defineEvents, publish } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, type WorkflowStep } from "@/lib/platform/operations";
import { applyRuleValue, defineRules, getRule, type RuleDefinition } from "@/lib/platform/rules";
import { currentActor } from "@/lib/platform/scope";
import { DESK_IDS, FX_CCYS, FUNDING_IDS, STRESS_BANDS, STRESS_FIELDS, type StressAssumptions } from "./data";
import { RAS_METRICS, useMarketRisk, type RasVersion } from "./store";

const M = "market-risk";
const DEMO = "Tenant parameter";

type Def = Omit<RuleDefinition, "module">;
const rule = (d: Def): RuleDefinition => ({ module: M, ...d });

const deskNames: Record<(typeof DESK_IDS)[number], string> = { FX: "FX trading desk", FI: "Fixed income — trading", MM: "Money market", INV: "Investment book (FVOCI)" };
const deskDefaults: Record<(typeof DESK_IDS)[number], { varLimit: number; stopLoss: number }> = {
  FX: { varLimit: 0.3, stopLoss: 0.4 },
  FI: { varLimit: 0.6, stopLoss: 0.5 },
  MM: { varLimit: 0.15, stopLoss: 0.2 },
  INV: { varLimit: 0.8, stopLoss: 0.6 },
};
const ccyLimit: Record<(typeof FX_CCYS)[number], number> = { USD: 15, EUR: 5, GBP: 5, CNY: 3 };
const fundingDefaults: Record<(typeof FUNDING_IDS)[number], { label: string; runOff: number; asf: number }> = {
  retail: { label: "Retail", runOff: 7.5, asf: 90 },
  corporate: { label: "Corporate", runOff: 25, asf: 50 },
  interbank: { label: "Interbank", runOff: 100, asf: 0 },
  wholesale: { label: "Wholesale / market funding", runOff: 40, asf: 50 },
};
const bandDefaults: Record<(typeof STRESS_BANDS)[number]["id"], Record<(typeof STRESS_FIELDS)[number]["key"], number>> = {
  bau: { retailRunOff: 3, corporateRunOff: 8, wholesaleWithdrawal: 10, undrawnDrawdown: 5, hqlaHaircut: 2, fxDevaluation: 0, rateShockBps: 0, inflowRate: 90 },
  adverse: { retailRunOff: 10, corporateRunOff: 25, wholesaleWithdrawal: 40, undrawnDrawdown: 20, hqlaHaircut: 8, fxDevaluation: 20, rateShockBps: 200, inflowRate: 60 },
  severe: { retailRunOff: 18, corporateRunOff: 40, wholesaleWithdrawal: 75, undrawnDrawdown: 40, hqlaHaircut: 15, fxDevaluation: 45, rateShockBps: 400, inflowRate: 40 },
  reverse: { retailRunOff: 30, corporateRunOff: 55, wholesaleWithdrawal: 100, undrawnDrawdown: 60, hqlaHaircut: 20, fxDevaluation: 60, rateShockBps: 600, inflowRate: 25 },
};
const rasDefaults: Record<string, { earlyWarning: number; buffer: number }> = {
  lcr: { earlyWarning: 120, buffer: 135 },
  nsfr: { earlyWarning: 110, buffer: 118 },
  ldr: { earlyWarning: 68, buffer: 85 },
  lr: { earlyWarning: 35, buffer: 40 },
  top20: { earlyWarning: 22, buffer: 25 },
  survival: { earlyWarning: 45, buffer: 30 },
};

// ---------------------------------------------------------------- business rules
defineRules([
  // Market limits (§6.8.1)
  rule({ key: "market-risk.nopLimitPct", label: "Aggregate NOP limit", description: "Net open position limit as % of total capital.", category: "Market limits", type: "percent", default: 20, min: 0, max: 100, source: "(NOP / Total Capital ratio; limit is a tenant parameter)" }),
  ...FX_CCYS.map((c) => rule({ key: `market-risk.nopLimitPct.${c}`, label: `NOP limit — ${c}`, description: `Net open position limit for ${c} as % of total capital.`, category: "Market limits", type: "percent", default: ccyLimit[c], min: 0, max: 100, source: DEMO })),
  ...DESK_IDS.flatMap((d) => [
    rule({ key: `market-risk.varLimitPct.${d}`, label: `VaR limit — ${deskNames[d]}`, description: "Board-approved 99% 1-day VaR limit as % of total capital.", category: "Market limits", type: "percent", default: deskDefaults[d].varLimit, min: 0, max: 10, step: 0.01, source: "(Market Risk Policy Manual)" }),
    rule({ key: `market-risk.stopLossPct.${d}`, label: `Stop-loss trigger — ${deskNames[d]}`, description: "Cumulative MTM loss trigger as % of total capital.", category: "Market limits", type: "percent", default: deskDefaults[d].stopLoss, min: 0, max: 10, step: 0.01, source: "" }),
  ]),
  rule({ key: "market-risk.stopLossEarlyWarningPct", label: "Stop-loss early warning", description: "Amber when cumulative MTM loss reaches this % of the stop-loss trigger.", category: "Market limits", type: "percent", default: 60, min: 1, max: 100, source: DEMO }),
  rule({ key: "market-risk.limitWarningPct", label: "Limit utilisation warning", description: "Amber when utilisation of any market limit reaches this %.", category: "Market limits", type: "percent", default: 80, min: 1, max: 100, source: DEMO }),
  rule({ key: "market-risk.interbankSpreadLimitPp", label: "Interbank spread limit", description: "Highest − lowest interbank quote, in percentage points.", category: "Market limits", type: "number", unit: "pp", default: 2.5, min: 0, max: 20, step: 0.1, source: DEMO }),
  rule({ key: "market-risk.irrbbShockBps", label: "Headline IRRBB shock", description: "Parallel rate shock used for headline NII-at-Risk and ΔEVE.", category: "IRRBB", type: "number", unit: "bps", default: 200, min: 0, max: 1000, source: "(+200 bps)" }),
  rule({ key: "market-risk.irrbbShockLadderBps", label: "IRRBB shock ladder", description: "Parallel shocks shown in the sensitivity table (bps).", category: "IRRBB", type: "list", default: ["-200", "-100", "100", "200"], source: DEMO }),
  // Liquidity ratios (§6.8.2)
  rule({ key: "market-risk.liquidityRatioMinPct", label: "Minimum liquidity ratio", description: "Liquid assets / deposit liabilities floor.", category: "Liquidity ratios", type: "percent", default: 30, min: 0, max: 100, source: "CBN 3.13" }),
  rule({ key: "market-risk.lcrFloorPct", label: "LCR floor", description: "Liquidity Coverage Ratio regulatory floor.", category: "Liquidity ratios", type: "percent", default: 100, min: 0, max: 300, source: "(Basel III)" }),
  rule({ key: "market-risk.nsfrFloorPct", label: "NSFR floor", description: "Net Stable Funding Ratio regulatory floor.", category: "Liquidity ratios", type: "percent", default: 100, min: 0, max: 300, source: "(Basel III)" }),
  rule({ key: "market-risk.ldrMinPct", label: "Minimum loan-to-deposit ratio", description: "CBN minimum weighted LDR.", category: "Liquidity ratios", type: "percent", default: 65, min: 0, max: 200, source: "(CBN)" }),
  rule({ key: "market-risk.ldrQualifyingUpliftPct", label: "LDR qualifying-lending uplift", description: "Extra weighting on SME / retail / mortgage / consumer lending (150% weighting = 50% uplift).", category: "Liquidity ratios", type: "percent", default: 50, min: 0, max: 200, source: "(150% weighting)" }),
  rule({ key: "market-risk.ratioWarningMarginPct", label: "Ratio warning margin", description: "Amber zone above a regulatory floor, as % of the floor.", category: "Liquidity ratios", type: "percent", default: 10, min: 0, max: 100, source: DEMO }),
  // LCR / NSFR factors
  ...FUNDING_IDS.flatMap((f) => [
    rule({ key: `market-risk.runOffPct.${f}`, label: `LCR run-off — ${fundingDefaults[f].label}`, description: "30-day stressed outflow rate for this funding segment.", category: "LCR / NSFR factors", type: "percent", default: fundingDefaults[f].runOff, min: 0, max: 100, step: 0.5, source: "Basel III LCR taxonomy — tenant parameter" }),
    rule({ key: `market-risk.asfPct.${f}`, label: `NSFR ASF factor — ${fundingDefaults[f].label}`, description: "Available-stable-funding factor for this funding segment.", category: "LCR / NSFR factors", type: "percent", default: fundingDefaults[f].asf, min: 0, max: 100, source: "Basel III NSFR — tenant parameter" }),
  ]),
  rule({ key: "market-risk.undrawnOutflowPct", label: "LCR undrawn-facility outflow", description: "Share of undrawn commitments treated as 30-day outflow.", category: "LCR / NSFR factors", type: "percent", default: 10, min: 0, max: 100, source: DEMO }),
  rule({ key: "market-risk.inflowCapPct", label: "LCR inflow cap", description: "Inflows recognised up to this % of outflows.", category: "LCR / NSFR factors", type: "percent", default: 75, min: 0, max: 100, source: "Basel III LCR (75% cap)" }),
  rule({ key: "market-risk.monthlyRepaymentPct", label: "Monthly contractual loan repayment", description: "Share of the loan book repaid each month (inflow assumption).", category: "LCR / NSFR factors", type: "percent", default: 4.5, min: 0, max: 100, step: 0.1, source: DEMO }),
  rule({ key: "market-risk.lcrInflowRecognitionPct", label: "LCR inflow recognition", description: "Share of contractual loan inflows recognised in the LCR.", category: "LCR / NSFR factors", type: "percent", default: 50, min: 0, max: 100, source: "Basel III LCR (50% of performing inflows)" }),
  rule({ key: "market-risk.interbankInflowPct", label: "Interbank placements maturing (30d)", description: "Interbank placements maturing within 30 days, as % of deposits.", category: "LCR / NSFR factors", type: "percent", default: 5.2, min: 0, max: 100, step: 0.1, source: DEMO }),
  rule({ key: "market-risk.rsfLoansPct", label: "NSFR RSF factor — loans", description: "Required-stable-funding factor on the loan book.", category: "LCR / NSFR factors", type: "percent", default: 72, min: 0, max: 100, source: "Basel III NSFR — tenant parameter" }),
  rule({ key: "market-risk.rsfHqlaPct", label: "NSFR RSF factor — HQLA", description: "Required-stable-funding factor on Level 1 HQLA.", category: "LCR / NSFR factors", type: "percent", default: 5, min: 0, max: 100, source: "Basel III NSFR — tenant parameter" }),
  rule({ key: "market-risk.rsfOtherPct", label: "NSFR RSF — other assets", description: "Other assets requiring stable funding, as % of deposits.", category: "LCR / NSFR factors", type: "percent", default: 12, min: 0, max: 100, source: DEMO }),
  // Early warning (CBN 3.13(c))
  rule({ key: "market-risk.ew.overdrawnDays", label: "CBN account overdrawn — trigger", description: "Consecutive working days the CBN current account is overdrawn and uncovered.", category: "Early warning", type: "number", unit: "days", default: 5, min: 1, max: 60, source: "(CBN 3.13(c))" }),
  rule({ key: "market-risk.ew.clearingDeficitDays", label: "Clearing deficit — trigger", description: "Consecutive days of clearing-operation deficit.", category: "Early warning", type: "number", unit: "days", default: 5, min: 1, max: 60, source: "(CBN 3.13(c))" }),
  rule({ key: "market-risk.ew.unableToPayDays", label: "Unable to pay maturing obligations — trigger", description: "Consecutive days unable to meet maturing obligations.", category: "Early warning", type: "number", unit: "days", default: 5, min: 1, max: 60, source: "(CBN 3.13(c))" }),
  rule({ key: "market-risk.ew.interbankTakerPct", label: "Net interbank taker — share", description: "Net taker of interbank deposits at or above this % of total deposits…", category: "Early warning", type: "percent", default: 25, min: 1, max: 100, source: "(CBN 3.13(c))" }),
  rule({ key: "market-risk.ew.interbankTakerDays", label: "Net interbank taker — duration", description: "…for this many consecutive days.", category: "Early warning", type: "number", unit: "days", default: 90, min: 1, max: 365, source: "(CBN 3.13(c))" }),
  rule({ key: "market-risk.ew.watchPct", label: "Early-warning watch level", description: "Amber when a counter reaches this % of its trigger.", category: "Early warning", type: "percent", default: 30, min: 1, max: 100, source: DEMO }),
  // Concentration
  rule({ key: "market-risk.concentrationCutoffs", label: "Depositor concentration bands", description: "Top-N cut-offs for depositor concentration.", category: "Concentration", type: "list", default: ["5", "10", "25", "50", "100", "200"], source: "Platform default" }),
  // Stress model (§6.8.2–§6.8.4)
  ...STRESS_BANDS.flatMap((b) =>
    STRESS_FIELDS.map((f) =>
      rule({
        key: `market-risk.stress.${b.id}.${f.key}`,
        label: `${b.label} — ${f.label}`,
        description: `${f.hint} under the ${b.label} severity band.`,
        category: `Stress band — ${b.label}`,
        type: f.suffix === "bps" ? "number" : "percent",
        unit: f.suffix === "bps" ? "bps" : undefined,
        default: bandDefaults[b.id][f.key],
        min: 0,
        max: f.suffix === "bps" ? 2000 : 100,
        source: "(severity bands are tenant-configurable)",
      }),
    ),
  ),
  rule({ key: "market-risk.dyn.retailAddPp", label: "Dynamic add-on — retail run-off", description: "Added to retail run-off when the sector-cycle engine signals contraction.", category: "Stress model", type: "number", unit: "pp", default: 2, min: 0, max: 50, source: "" }),
  rule({ key: "market-risk.dyn.corporateAddPp", label: "Dynamic add-on — corporate run-off", description: "Added to corporate run-off on a contraction signal.", category: "Stress model", type: "number", unit: "pp", default: 6, min: 0, max: 50, source: "" }),
  rule({ key: "market-risk.dyn.haircutAddPp", label: "Dynamic add-on — HQLA haircut", description: "Added to the HQLA haircut on a contraction signal.", category: "Stress model", type: "number", unit: "pp", default: 3, min: 0, max: 50, source: "" }),
  rule({ key: "market-risk.stress.horizonDays", label: "Stress horizon", description: "Days projected in the survival-horizon path.", category: "Stress model", type: "number", unit: "days", default: 90, min: 30, max: 365, source: DEMO }),
  rule({ key: "market-risk.stress.fgnDurationYears", label: "FGN bond modified duration", description: "Duration used for the HQLA MTM loss under a rate shock.", category: "Stress model", type: "number", unit: "years", default: 4, min: 0, max: 30, step: 0.1, source: DEMO }),
  rule({ key: "market-risk.stress.frontLoadExponent", label: "Run-off front-loading exponent", description: "Shape of the outflow curve within the first 30 days (lower = more front-loaded).", category: "Stress model", type: "number", default: 0.7, min: 0.1, max: 2, step: 0.05, source: DEMO }),
  rule({ key: "market-risk.stress.tailRunOffPct", label: "Run-off after day 30", description: "Additional outflows from day 30 to day 90, as % of the 30-day outflows.", category: "Stress model", type: "percent", default: 45, min: 0, max: 200, source: DEMO }),
  rule({ key: "market-risk.stress.reverseMaxMultiplier", label: "Reverse stress search ceiling", description: "Largest run-off multiplier searched by the reverse stress test.", category: "Stress model", type: "number", default: 6, min: 1, max: 20, step: 0.5, source: DEMO }),
  // Risk appetite statement (ILAAP) — changed only through the RAS change operation (Board approval).
  ...RAS_METRICS.flatMap((m) => [
    rule({ key: `market-risk.ras.${m.id}.earlyWarning`, label: `RAS early warning — ${m.metric}`, description: "Risk Appetite Statement early-warning trigger.", category: "Risk appetite", type: m.unit === "%" ? "percent" : "number", unit: m.unit === "%" ? undefined : m.unit, default: rasDefaults[m.id]!.earlyWarning, min: 0, max: 400, source: "(Board-approved RAS)" }),
    rule({ key: `market-risk.ras.${m.id}.buffer`, label: `RAS buffer / limit — ${m.metric}`, description: "Risk Appetite Statement management buffer or limit.", category: "Risk appetite", type: m.unit === "%" ? "percent" : "number", unit: m.unit === "%" ? undefined : m.unit, default: rasDefaults[m.id]!.buffer, min: 0, max: 400, source: "(Board-approved RAS)" }),
  ]),
  // Escalation & recipients (§6.4.4)
  rule({ key: "market-risk.escalationRoles", label: "Breach escalation ladder", description: "Roles a limit breach escalates through, in order.", category: "Escalation", type: "roles", default: ["market-risk-analyst", "head-of-risk", "cro", "board"], source: "escalation protocol" }),
  rule({ key: "market-risk.alertRoles", label: "Market & liquidity alert recipients", description: "Roles notified of breaches, early warnings and approvals.", category: "Escalation", type: "roles", default: ["market-risk-analyst", "head-of-risk", "cro"], source: "(auto-escalated to Market Risk Analyst, Head of Risk and CRO)" }),
  rule({ key: "market-risk.ilaapRoles", label: "ILAAP sign-off recipients", description: "Roles notified when the ILAAP is approved.", category: "Escalation", type: "roles", default: ["market-risk-analyst", "head-of-risk", "cro", "md", "board"], source: DEMO }),
]);

export const alertRoles = () => getRule<string[]>("market-risk.alertRoles") as RoleId[];

// ---------------------------------------------------------------- helpers
function audit(action: string, entityType: string, entityId: string, before?: string, after?: string) {
  const a = currentActor();
  useDb.getState().log({ actorId: a.id, actorName: a.name, roleId: a.roleId, action, entityType, entityId, before, after });
}

const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number, mode: "any" | "all" = "any"): WorkflowStep => ({ id, name, approverRoles, mode, slaHours });

// ---------------------------------------------------------------- operations
export type BreachClosePayload = { breachId: string; note: string };
registerOperation<BreachClosePayload>({
  type: "market-risk.breach.close",
  name: "Close market-risk limit breach",
  module: M,
  description: "Closure of a market or liquidity limit breach with its resolution note.",
  defaultSteps: [step("confirm", "Head of Risk / CRO confirmation", ["head-of-risk", "cro"], 24)],
  apply: (p, { actor }) => {
    const b = useMarketRisk.getState().breaches.find((x) => x.id === p.breachId);
    if (!b) return;
    useMarketRisk.getState().setBreach(b.id, { status: "Closed", note: p.note, closedBy: actor.name, closedAt: new Date().toISOString() });
    audit("Closed market-risk limit breach", "LimitBreach", b.id, b.status, `Closed: ${p.note}`);
    publish("market-risk.breach.closed", { module: M, subject: { type: "LimitBreach", id: b.id, title: b.metric, href: "/market-risk" }, payload: { note: p.note } });
    notify({ templateId: "market-risk.breach-closed", toRoles: alertRoles(), href: "/market-risk", data: { metric: b.metric, desk: b.desk, note: p.note, approvedBy: actor.name } });
  },
});

export type RasChangePayload = { version: string; note: string; values: RasVersion["values"] };
registerOperation<RasChangePayload>({
  type: "market-risk.ras.change",
  name: "Risk Appetite Statement change (liquidity)",
  module: M,
  description: "New version of the liquidity Risk Appetite Statement thresholds. Board-approved.",
  defaultSteps: [step("review", "Head of Risk review", ["head-of-risk"], 48), step("cro", "CRO endorsement", ["cro"], 48), step("board", "Board approval", ["board"], 168)],
  apply: (p, { instance, actor }) => {
    const changes: string[] = [];
    for (const [id, v] of Object.entries(p.values)) {
      for (const k of ["earlyWarning", "buffer"] as const) {
        const key = `market-risk.ras.${id}.${k}`;
        const before = getRule<number>(key);
        if (before !== v[k]) {
          applyRuleValue(key, v[k], { id: actor.id, name: actor.name }, { reason: p.note, operationId: instance.id });
          changes.push(`${id}.${k} ${before} → ${v[k]}`);
        }
      }
    }
    useMarketRisk.getState().addRasVersion({ version: p.version, at: new Date().toISOString(), by: `${instance.requestedBy.name} · approved by ${actor.name}`, note: p.note, values: p.values, operationId: instance.id });
    audit("Approved Risk Appetite Statement version", "IlaapRas", `RAS v${p.version}`, undefined, changes.join("; ") || "No threshold changes");
    publish("market-risk.ras.approved", { module: M, subject: { type: "IlaapRas", id: p.version, title: `RAS v${p.version}`, href: "/market-risk/ilaap" }, payload: { changes } });
    notify({ templateId: "market-risk.ras-approved", toRoles: alertRoles(), href: "/market-risk/ilaap", data: { version: p.version, note: p.note, changes: changes.join("; ") || "No threshold changes" } });
  },
});

export type IlaapSignOffPayload = { period: string; rasVersion: string };
registerOperation<IlaapSignOffPayload>({
  type: "market-risk.ilaap.signoff",
  name: "ILAAP sign-off",
  module: M,
  description: "Governance sign-off chain for the ILAAP document (CBN Guidelines on Liquidity Risk Management and ILAAP, 2021).",
  defaultSteps: [
    step("review", "Reviewed — Head of Risk", ["head-of-risk"], 72),
    step("cro", "Endorsed — Chief Risk Officer", ["cro"], 72),
    step("alco", "ALCO (chaired by MD/CEO)", ["md"], 120),
    step("board", "Board approval", ["board"], 336),
  ],
  apply: (p, { instance, actor }) => {
    useMarketRisk.getState().setIlaap({ status: "Approved", approvedAt: new Date().toISOString(), approvedBy: actor.name, operationId: instance.id });
    audit("ILAAP approved by the Board", "IlaapDocument", `ILAAP-${p.period}`, "In review", `Approved (RAS v${p.rasVersion})`);
    publish("market-risk.ilaap.signed", { module: M, subject: { type: "IlaapDocument", id: p.period, title: `ILAAP ${p.period}`, href: "/market-risk/ilaap" }, payload: { rasVersion: p.rasVersion } });
    notify({ templateId: "market-risk.ilaap-signed", toRoles: getRule<string[]>("market-risk.ilaapRoles") as RoleId[], href: "/market-risk/ilaap", data: { period: p.period, rasVersion: p.rasVersion, approvedBy: actor.name } });
  },
  onReject: (p, { instance }) => {
    useMarketRisk.getState().setIlaap({ status: "Returned", operationId: instance.id });
    audit("ILAAP sign-off rejected", "IlaapDocument", `ILAAP-${p.period}`, "In review", "Rejected");
    publish("market-risk.ilaap.returned", { module: M, subject: { type: "IlaapDocument", id: p.period, title: `ILAAP ${p.period}` }, payload: {} });
  },
});

export type StressApprovePayload = { runId: string; name: string; assumptions: StressAssumptions; lcr: number; survivalDays: number | null };
registerOperation<StressApprovePayload>({
  type: "market-risk.stress.approve",
  name: "Liquidity stress scenario approval",
  module: M,
  description: "Approve a liquidity stress scenario and its full assumption set for use in the ILAAP stress-testing chapter.",
  defaultSteps: [step("review", "Head of Risk review", ["head-of-risk"], 48), step("cro", "CRO approval", ["cro"], 48)],
  apply: (p, { actor }) => {
    useMarketRisk.getState().setRun(p.runId, { approval: { status: "Approved", by: actor.name, at: new Date().toISOString() } });
    audit("Approved liquidity stress scenario", "LiquidityStressRun", p.runId, "Pending approval", "Approved");
    publish("market-risk.stress-run.approved", { module: M, subject: { type: "LiquidityStressRun", id: p.runId, title: p.name, href: "/market-risk/stress-testing" }, payload: { lcr: p.lcr, survivalDays: p.survivalDays } });
    notify({
      templateId: "market-risk.stress-approved",
      toRoles: alertRoles(),
      href: "/market-risk/stress-testing",
      data: { name: p.name, lcr: `${p.lcr.toFixed(0)}%`, survival: p.survivalDays === null ? "beyond the horizon" : `${p.survivalDays} days`, approvedBy: actor.name },
    });
  },
  onReject: (p, { actor }) => {
    useMarketRisk.getState().setRun(p.runId, { approval: { status: "Rejected", by: actor.name, at: new Date().toISOString() } });
    audit("Rejected liquidity stress scenario", "LiquidityStressRun", p.runId, "Pending approval", "Rejected");
  },
});

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "market-risk.breach-raised",
    name: "Market / liquidity limit breach raised",
    module: M,
    trigger: "market-risk.breach.raised",
    subject: "Limit breach: {{metric}} — {{desk}}",
    inApp: "{{metric}} on {{desk}}: {{actual}} vs limit {{limit}}. With {{level}}.",
    body: "<p>A limit breach was raised.</p><ul><li>Metric: <strong>{{metric}}</strong></li><li>Desk / portfolio: {{desk}}</li><li>Actual: <strong>{{actual}}</strong> vs limit {{limit}}</li><li>Now with: {{level}}</li></ul><p>Review the position and record the resolution.</p>",
    tone: "danger",
    variables: [
      { name: "metric", description: "Limit metric", example: "VaR limit utilisation" },
      { name: "desk", description: "Desk or portfolio", example: "FX trading desk" },
      { name: "actual", description: "Actual value", example: "103%" },
      { name: "limit", description: "Limit", example: "100%" },
      { name: "level", description: "Escalation level (role)", example: "Market Risk Analyst" },
    ],
  }),
  tpl({
    id: "market-risk.breach-escalated",
    name: "Limit breach escalated",
    module: M,
    trigger: "market-risk.breach.escalated",
    subject: "Escalated to you: {{metric}} — {{desk}}",
    inApp: "{{by}} escalated {{metric}} ({{actual}} vs {{limit}}) to {{level}}.",
    body: "<p><strong>{{by}}</strong> escalated a limit breach to <strong>{{level}}</strong>.</p><ul><li>Metric: {{metric}}</li><li>Desk / portfolio: {{desk}}</li><li>Actual: {{actual}} vs limit {{limit}}</li></ul>",
    tone: "warning",
    variables: [
      { name: "metric", description: "Limit metric", example: "NOP — USD intraday" },
      { name: "desk", description: "Desk or portfolio", example: "FX trading desk" },
      { name: "actual", description: "Actual value", example: "16.2% of capital" },
      { name: "limit", description: "Limit", example: "15%" },
      { name: "level", description: "Role it is escalated to", example: "Chief Risk Officer" },
      { name: "by", description: "Who escalated", example: "Ngozi Eze" },
    ],
  }),
  tpl({
    id: "market-risk.breach-closed",
    name: "Limit breach closed",
    module: M,
    trigger: "market-risk.breach.closed",
    subject: "Breach closed: {{metric}} — {{desk}}",
    inApp: "{{metric}} on {{desk}} was closed (approved by {{approvedBy}}).",
    body: "<p>The limit breach <strong>{{metric}}</strong> on {{desk}} was closed after approval by {{approvedBy}}.</p><p>Resolution: {{note}}</p>",
    tone: "success",
    variables: [
      { name: "metric", description: "Limit metric", example: "VaR limit utilisation" },
      { name: "desk", description: "Desk or portfolio", example: "FX trading desk" },
      { name: "note", description: "Resolution note", example: "Position reduced below limit on 10 Nov." },
      { name: "approvedBy", description: "Approver", example: "Chinedu Okafor" },
    ],
  }),
  tpl({
    id: "market-risk.early-warning-triggered",
    name: "Illiquidity early-warning triggered",
    module: M,
    trigger: "market-risk.early-warning.triggered",
    subject: "Liquidity early warning: {{trigger}}",
    inApp: "{{trigger}} — current {{current}} against trigger {{threshold}}.",
    body: "<p>An illiquidity early-warning indicator (CBN 3.13(c)) needs attention.</p><ul><li>Indicator: <strong>{{trigger}}</strong></li><li>Trigger: {{threshold}}</li><li>Current: <strong>{{current}}</strong></li></ul><p>Follow the Contingency Funding Plan communication protocol.</p>",
    tone: "danger",
    variables: [
      { name: "trigger", description: "Early-warning indicator", example: "Net taker of interbank deposits ≥ 25% of total deposits" },
      { name: "threshold", description: "Trigger threshold", example: "90 consecutive days" },
      { name: "current", description: "Current counter", example: "34 days" },
    ],
  }),
  tpl({
    id: "market-risk.ras-approved",
    name: "Risk Appetite Statement approved",
    module: M,
    trigger: "market-risk.ras.approved",
    subject: "Liquidity RAS v{{version}} is in force",
    inApp: "RAS v{{version}} approved: {{changes}}",
    body: "<p>The Board approved liquidity Risk Appetite Statement <strong>v{{version}}</strong>.</p><p>Changes: {{changes}}</p><p>Rationale: {{note}}</p>",
    tone: "info",
    variables: [
      { name: "version", description: "RAS version", example: "1.1" },
      { name: "changes", description: "Threshold changes", example: "lcr.buffer 135 → 140" },
      { name: "note", description: "Change rationale", example: "Board RMC raised LCR buffer after Q3 review" },
    ],
  }),
  tpl({
    id: "market-risk.ilaap-signed",
    name: "ILAAP signed off",
    module: M,
    trigger: "market-risk.ilaap.signed",
    subject: "ILAAP {{period}} approved by the Board",
    inApp: "ILAAP {{period}} (RAS v{{rasVersion}}) approved — final sign-off by {{approvedBy}}.",
    body: "<p>The ILAAP for <strong>{{period}}</strong> completed its sign-off chain and was approved by the Board.</p><ul><li>RAS version in force: v{{rasVersion}}</li><li>Final sign-off: {{approvedBy}}</li></ul>",
    tone: "success",
    variables: [
      { name: "period", description: "ILAAP period", example: "2026" },
      { name: "rasVersion", description: "RAS version in force", example: "1.0" },
      { name: "approvedBy", description: "Final approver", example: "Board Chair" },
    ],
  }),
  tpl({
    id: "market-risk.stress-approved",
    name: "Liquidity stress scenario approved",
    module: M,
    trigger: "market-risk.stress-run.approved",
    subject: "Stress scenario approved: {{name}}",
    inApp: "{{name}} approved by {{approvedBy}} — stressed LCR {{lcr}}, survival {{survival}}.",
    body: "<p>The liquidity stress scenario <strong>{{name}}</strong> was approved by {{approvedBy}} for the ILAAP stress-testing chapter.</p><ul><li>Stressed LCR: {{lcr}}</li><li>Survival horizon: {{survival}}</li></ul>",
    tone: "success",
    variables: [
      { name: "name", description: "Scenario name", example: "Adverse (dynamic)" },
      { name: "lcr", description: "Stressed LCR", example: "112%" },
      { name: "survival", description: "Survival horizon", example: "47 days" },
      { name: "approvedBy", description: "Approver", example: "Chinedu Okafor" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "market-risk.breach.raised", module: M, description: "A market or liquidity limit breach was raised.", payloadExample: { metric: "VaR limit utilisation", utilisation: 103 } },
  { name: "market-risk.breach.escalated", module: M, description: "A limit breach moved up the escalation ladder.", payloadExample: { from: "market-risk-analyst", to: "head-of-risk" } },
  { name: "market-risk.breach.close-requested", module: M, description: "Closure of a breach was submitted for approval." },
  { name: "market-risk.breach.closed", module: M, description: "A breach closure was approved." },
  { name: "market-risk.early-warning.triggered", module: M, description: "An illiquidity early-warning indicator was raised as a breach." },
  { name: "market-risk.ras.change-requested", module: M, description: "A new RAS version was submitted for approval." },
  { name: "market-risk.ras.approved", module: M, description: "A RAS version was approved and its thresholds applied." },
  { name: "market-risk.risk-factor.rescored", module: M, description: "An ILAAP risk factor's relevance changed." },
  { name: "market-risk.ilaap-chapter.updated", module: M, description: "An ILAAP chapter review status changed." },
  { name: "market-risk.ilaap.compiled", module: M, description: "The ILAAP report was compiled." },
  { name: "market-risk.ilaap.submitted", module: M, description: "The ILAAP was submitted into its sign-off chain." },
  { name: "market-risk.ilaap.signed", module: M, description: "The ILAAP completed sign-off (Board approval)." },
  { name: "market-risk.ilaap.returned", module: M, description: "The ILAAP sign-off was rejected." },
  { name: "market-risk.stress-run.saved", module: M, description: "A liquidity stress run was saved with its assumptions." },
  { name: "market-risk.stress-run.submitted", module: M, description: "A stress scenario was submitted for approval." },
  { name: "market-risk.stress-run.approved", module: M, description: "A stress scenario was approved for the ILAAP." },
]);

defineHookPoints(
  (
    [
      ["breach.raise", "raising a limit breach"],
      ["breach.escalate", "escalating a limit breach"],
      ["breach.close", "submitting a breach closure"],
      ["ras.change", "submitting a RAS version"],
      ["risk-factor.rescore", "changing a risk factor's relevance"],
      ["ilaap.compile", "compiling the ILAAP report"],
      ["ilaap.submit", "submitting the ILAAP for sign-off"],
      ["stress.run", "saving a liquidity stress run"],
      ["stress.approve", "submitting a stress scenario for approval"],
    ] as const
  ).flatMap(([p, what]) => [
    { point: `market-risk.${p}.before`, module: M, kind: "before" as const, description: `Before ${what}. Veto to block it, or enrich the context.` },
    { point: `market-risk.${p}.after`, module: M, kind: "after" as const, description: `After ${what}.` },
  ]),
);
