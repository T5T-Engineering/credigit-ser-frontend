/**
 * Portfolio & MIS selectors (PRD §6.6, §8, §9.1) — pure functions over the Risk Data Spine.
 *
 * Exported for reuse by other modules (dashboard, IFRS 9, executive). Every function is deterministic and
 * side-effect free, so the same figures appear wherever they are shown.
 *
 * Every limit, threshold, rate and table is a business rule (./platform.ts, read at call time): PRD-stated values
 * (CBN 3.2(a)–(e), §9.1 CAR and CCF categories) carry their PRD section; the rest are labelled demo values.
 */
import type { Application, CbnClass, Facility, Ifrs9Stage, Obligor, ProductType, Sector } from "@/lib/data/types";
import { getRule, ruleDefinition, useRulesStore } from "@/lib/platform/rules";
import { rarPosition } from "@/lib/rar";
import { ccfRuleKey, OBLIGOR_TYPES, PARAM_RULES, PORTFOLIO_RULES, PRODUCT_TYPES, riskWeightRuleKey, type PortfolioParamName } from "./rule-keys";

// ---------------------------------------------------------------------------------------------------------------
// Parameters — business rules (registered in ./platform.ts; shareholders' funds is the core platform rule).
// Values are read with getRule at call time, so an approved rule change applies everywhere immediately.
// ---------------------------------------------------------------------------------------------------------------

export type ParamSource = "Platform default" | "Tenant parameter (demo value)";
export type Param = { key: string; value: number; label: string; source: ParamSource; ref: string };

/** Current value of a portfolio parameter (business rule). */
export function param(name: PortfolioParamName): number {
  return getRule<number>(PARAM_RULES[name]);
}

/** All portfolio parameters with their rule metadata (PRD-stated vs demo). */
export function getPortfolioParams(): Record<PortfolioParamName, Param> {
  const out = {} as Record<PortfolioParamName, Param>;
  for (const name of Object.keys(PARAM_RULES) as PortfolioParamName[]) {
    const key = PARAM_RULES[name];
    const def = ruleDefinition(key);
    const src = def?.source ?? "";
    out[name] = { key, value: getRule<number>(key), label: def?.label ?? key, source: !/demo/i.test(src) ? "Platform default" : "Tenant parameter (demo value)", ref: src };
  }
  return out;
}

/** Reactive portfolio parameters for components (re-renders when any rule changes). */
export function usePortfolioParams() {
  useRulesStore((s) => s.values);
  return getPortfolioParams();
}

/** Credit-conversion factors for undrawn / contingent amounts (WARR exposure basis, §6.6.9 → §9.1 categories). */
export function ccfTable(): Record<ProductType, { pct: number; basis: string }> {
  return Object.fromEntries(PRODUCT_TYPES.map((p) => [p, { pct: getRule<number>(ccfRuleKey(p)), basis: ruleDefinition(ccfRuleKey(p))?.source ?? "" }])) as Record<ProductType, { pct: number; basis: string }>;
}
export const ccfPct = (p: ProductType) => getRule<number>(ccfRuleKey(p));

/** Risk-weight table by obligor type (tenant asset-classification table, §6.6.5). */
export function riskWeightTable(): Record<Obligor["type"], number> {
  return Object.fromEntries(OBLIGOR_TYPES.map((t) => [t, getRule<number>(riskWeightRuleKey(t))])) as Record<Obligor["type"], number>;
}

/** ECL proxy until the IFRS 9 engine (§6.7) feeds RAROC: % of outstanding by stage / CBN class. */
export function eclProxyPct(): { stage1: number; stage2: number; stage3: Record<"Substandard" | "Doubtful" | "Lost", number> } {
  const R = PORTFOLIO_RULES;
  return {
    stage1: getRule<number>(R.eclStage1Pct),
    stage2: getRule<number>(R.eclStage2Pct),
    stage3: { Substandard: getRule<number>(R.eclSubstandardPct), Doubtful: getRule<number>(R.eclDoubtfulPct), Lost: getRule<number>(R.eclLostPct) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Facility-level helpers
// ---------------------------------------------------------------------------------------------------------------

export const CONTINGENT_PRODUCTS: ProductType[] = ["Bank guarantee", "Advance payment guarantee"];
export const NPL_CLASSES: CbnClass[] = ["Substandard", "Doubtful", "Lost"];
export const CBN_CLASSES: CbnClass[] = ["Performing", "Watchlist", "Substandard", "Doubtful", "Lost"];

/** PRD §6.6.1 product grouping (Overdraft, Contingent Liability, Advance, Term Loan, Lease). */
export function productGroup(p: ProductType): "Overdraft" | "Contingent liability" | "Advance" | "Term loan" | "Lease" {
  if (p === "Overdraft" || p === "Revolving credit") return "Overdraft";
  if (CONTINGENT_PRODUCTS.includes(p) || p === "Trade finance (LC)") return "Contingent liability";
  if (p === "Lease finance" || p === "Asset finance") return "Lease";
  if (p === "Term loan" || p === "Mortgage") return "Term loan";
  return "Advance";
}

/** PRD §6.6.1 tenor ranges. */
export const TENOR_BANDS = ["≤1 month", "1–3 months", "3–6 months", "6–12 months", "12–36 months", "36–60 months", "60+ months"] as const;
export type TenorBand = (typeof TENOR_BANDS)[number];
export function tenorBand(months: number): TenorBand {
  if (months <= 1) return "≤1 month";
  if (months <= 3) return "1–3 months";
  if (months <= 6) return "3–6 months";
  if (months <= 12) return "6–12 months";
  if (months <= 36) return "12–36 months";
  if (months <= 60) return "36–60 months";
  return "60+ months";
}

/** Facilities on the live book (active or restructured). */
export function liveFacilities(facilities: Facility[]): Facility[] {
  return facilities.filter((f) => f.status === "Active" || f.status === "Restructured");
}

/** Funded (on-balance-sheet) outstanding. Contingent products carry 0 funded balance. */
export function onBalance(f: Facility): number {
  return CONTINGENT_PRODUCTS.includes(f.product) ? 0 : f.outstanding;
}
/** Off-balance-sheet engagement (guarantee face value). */
export function offBalance(f: Facility): number {
  return CONTINGENT_PRODUCTS.includes(f.product) ? f.approvedAmount : 0;
}
/** Undrawn commitment on funded lines. */
export function undrawn(f: Facility): number {
  return CONTINGENT_PRODUCTS.includes(f.product) ? 0 : Math.max(0, f.approvedAmount - f.outstanding);
}
/** WARR default exposure basis: gross outstanding + undrawn/contingent × CCF (§6.6.9). */
export function warrExposure(f: Facility): number {
  const ccf = ccfPct(f.product) / 100;
  return onBalance(f) + (undrawn(f) + offBalance(f)) * ccf;
}
/** Single-obligor limit exposure: on-balance + off-balance × statutory weighting (CBN 3.2(b), §8). */
export function solExposure(f: Facility): number {
  return onBalance(f) + (offBalance(f) * param("offBalanceSolWeight")) / 100;
}
export const isNpl = (f: Facility) => NPL_CLASSES.includes(f.cbnClass);

// ---------------------------------------------------------------------------------------------------------------
// Book totals
// ---------------------------------------------------------------------------------------------------------------

export type PortfolioTotals = {
  facilityCount: number;
  obligorCount: number;
  /** Gross loans = Σ funded outstanding (§8 Outstanding Amount). */
  grossLoans: number;
  approved: number;
  contingent: number;
  undrawn: number;
  npl: number;
  /** NPL / Gross loans × 100 (§6.6.5, CBN 12.1(b)). */
  nplRatio: number;
  pastDueCount: number;
  pastDueValue: number;
  byStage: Record<Ifrs9Stage, number>;
  stageShare: Record<Ifrs9Stage, number>;
  byClass: Record<CbnClass, number>;
};

/** Whole-book totals over the live facility book. */
export function portfolioTotals(all: Facility[]): PortfolioTotals {
  const fac = liveFacilities(all);
  const grossLoans = sum(fac, onBalance);
  const npl = sum(fac.filter(isNpl), onBalance);
  const byStage = { 1: 0, 2: 0, 3: 0 } as Record<Ifrs9Stage, number>;
  const byClass = Object.fromEntries(CBN_CLASSES.map((c) => [c, 0])) as Record<CbnClass, number>;
  for (const f of fac) {
    byStage[f.stage] += onBalance(f);
    byClass[f.cbnClass] += onBalance(f);
  }
  const pastDue = fac.filter((f) => f.dpd >= 1);
  return {
    facilityCount: fac.length,
    obligorCount: new Set(fac.map((f) => f.obligorId)).size,
    grossLoans,
    approved: sum(fac, (f) => f.approvedAmount),
    contingent: sum(fac, offBalance),
    undrawn: sum(fac, undrawn),
    npl,
    nplRatio: grossLoans ? (npl / grossLoans) * 100 : 0,
    pastDueCount: pastDue.length,
    pastDueValue: sum(pastDue, onBalance),
    byStage,
    stageShare: { 1: share(byStage[1], grossLoans), 2: share(byStage[2], grossLoans), 3: share(byStage[3], grossLoans) },
    byClass,
  };
}

/** NPL ratio (%) = NPL / Gross loans × 100 over any facility subset. */
export function nplRatio(facilities: Facility[]): number {
  const fac = liveFacilities(facilities);
  const gross = sum(fac, onBalance);
  return gross ? (sum(fac.filter(isNpl), onBalance) / gross) * 100 : 0;
}

export type Bucket = { key: string; label: string; count: number; value: number; share: number; npl: number; nplRatio: number };

/** Group the live book by any key; value = funded outstanding + contingent (so guarantees are visible). */
export function bookBy(all: Facility[], keyOf: (f: Facility) => string, labelOf: (key: string) => string = (k) => k): Bucket[] {
  const fac = liveFacilities(all);
  const total = sum(fac, (f) => onBalance(f) + offBalance(f));
  const map = new Map<string, Facility[]>();
  for (const f of fac) {
    const k = keyOf(f);
    map.set(k, [...(map.get(k) ?? []), f]);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const value = sum(list, (f) => onBalance(f) + offBalance(f));
      const gross = sum(list, onBalance);
      const npl = sum(list.filter(isNpl), onBalance);
      return { key, label: labelOf(key), count: list.length, value, share: share(value, total), npl, nplRatio: gross ? (npl / gross) * 100 : 0 };
    })
    .sort((a, b) => b.value - a.value);
}

// ---------------------------------------------------------------------------------------------------------------
// Pipeline (applications in process)
// ---------------------------------------------------------------------------------------------------------------

const CLOSED_STAGES: Application["stage"][] = ["Booked", "Declined", "Withdrawn"];
export const inPipeline = (a: Application) => !CLOSED_STAGES.includes(a.stage);

export function pipelineTotals(apps: Application[]) {
  const open = apps.filter(inPipeline);
  return { count: open.length, value: sum(open, (a) => a.amount), declined: apps.filter((a) => a.stage === "Declined").length };
}

// ---------------------------------------------------------------------------------------------------------------
// Obligor & sector exposures, limits, concentration
// ---------------------------------------------------------------------------------------------------------------

export type ObligorExposure = {
  obligor: Obligor;
  sector?: Sector;
  onBalance: number;
  offBalance: number;
  /** Total exposure = on-balance + off-balance (concentration ranking). */
  exposure: number;
  /** CBN 3.2(b) weighted exposure for single-obligor limit. */
  solExposure: number;
  solUtilisationPct: number;
  pctOfShf: number;
  products: ProductType[];
  worstStage: Ifrs9Stage;
  worstClass: CbnClass;
  posture: string;
  postureBase: string;
  facilityCount: number;
};

/** Aggregate exposure per obligor (connected groups not yet modelled in the spine — see OPEN-QUESTIONS). */
export function obligorExposures(all: Facility[], obligors: Obligor[], sectors: Sector[]): ObligorExposure[] {
  const fac = liveFacilities(all);
  const shf = param("shareholdersFunds");
  const sol = (shf * param("singleObligorLimitPct")) / 100;
  const sectorById = new Map(sectors.map((s) => [s.id, s]));
  const byObligor = new Map<string, Facility[]>();
  for (const f of fac) byObligor.set(f.obligorId, [...(byObligor.get(f.obligorId) ?? []), f]);
  const out: ObligorExposure[] = [];
  for (const o of obligors) {
    const list = byObligor.get(o.id);
    if (!list?.length) continue;
    const on = sum(list, onBalance);
    const off = sum(list, offBalance);
    const solExp = sum(list, solExposure);
    const pos = rarPosition(o.rar);
    out.push({
      obligor: o,
      sector: sectorById.get(o.sectorId),
      onBalance: on,
      offBalance: off,
      exposure: on + off,
      solExposure: solExp,
      solUtilisationPct: (solExp / sol) * 100,
      pctOfShf: (solExp / shf) * 100,
      products: [...new Set(list.map((f) => f.product))],
      worstStage: Math.max(...list.map((f) => f.stage)) as Ifrs9Stage,
      worstClass: CBN_CLASSES[Math.max(...list.map((f) => CBN_CLASSES.indexOf(f.cbnClass)))]!,
      posture: pos.label,
      postureBase: pos.base,
      facilityCount: list.length,
    });
  }
  return out.sort((a, b) => b.exposure - a.exposure);
}

export type LimitStatus = "Within limit" | "Near breach" | "Breach";
export function limitStatus(utilisationPct: number): LimitStatus {
  if (utilisationPct >= 100) return "Breach";
  if (utilisationPct >= param("earlyWarningPct")) return "Near breach";
  return "Within limit";
}
export const limitStatusTone: Record<LimitStatus, "success" | "warning" | "danger"> = { "Within limit": "success", "Near breach": "warning", Breach: "danger" };

export type SectorExposure = {
  sector: Sector;
  exposure: number;
  sharePct: number;
  limitPct: number;
  limitAmount: number;
  utilisationPct: number;
  status: LimitStatus;
  headroom: number;
  obligorCount: number;
  npl: number;
  nplRatio: number;
  statutory: boolean;
};

/** Sectoral exposure % = Sector outstanding / Total portfolio outstanding × 100 (§8), vs sector limit. */
export function sectorExposures(all: Facility[], obligors: Obligor[], sectors: Sector[]): SectorExposure[] {
  const fac = liveFacilities(all);
  const obligorById = new Map(obligors.map((o) => [o.id, o]));
  const total = sum(fac, onBalance);
  const governmentCeiling = param("governmentCeilingPct");
  return sectors
    .map((s) => {
      const list = fac.filter((f) => obligorById.get(f.obligorId)?.sectorId === s.id);
      const exposure = sum(list, onBalance);
      const sharePct = share(exposure, total);
      const statutory = s.id === "SEC-GOV";
      const limitPct = statutory ? governmentCeiling : s.limitPct;
      const limitAmount = (total * limitPct) / 100;
      const utilisationPct = limitPct ? (sharePct / limitPct) * 100 : 0;
      const npl = sum(list.filter(isNpl), onBalance);
      return {
        sector: s,
        exposure,
        sharePct,
        limitPct,
        limitAmount,
        utilisationPct,
        status: limitStatus(utilisationPct),
        headroom: limitAmount - exposure,
        obligorCount: new Set(list.map((f) => f.obligorId)).size,
        npl,
        nplRatio: exposure ? (npl / exposure) * 100 : 0,
        statutory,
      };
    })
    .sort((a, b) => b.utilisationPct - a.utilisationPct);
}

/** Large exposures (≥10% of SHF, CBN 3.2(d)) and the aggregate ceiling (8× SHF, CBN 3.2(e)). */
export function largeExposures(exposures: ObligorExposure[]) {
  const shf = param("shareholdersFunds");
  const threshold = param("largeExposurePct");
  const list = exposures.filter((e) => e.pctOfShf >= threshold);
  const aggregate = sum(list, (e) => e.solExposure);
  const ceiling = shf * param("aggregateLargeExposureMultiple");
  return {
    list,
    aggregate,
    ceiling,
    utilisationPct: (aggregate / ceiling) * 100,
    /** Large Exposures to Capital = Aggregate large exposures / Total qualifying capital × 100 (§6.6.5). */
    toCapitalPct: (aggregate / param("totalQualifyingCapital")) * 100,
  };
}

/** Top-N concentration (§6.6.3). */
export function concentration(exposures: ObligorExposure[], n: number, grossBook: number) {
  const top = exposures.slice(0, n);
  const exposure = sum(top, (e) => e.exposure);
  const totalExposure = sum(exposures, (e) => e.exposure);
  return {
    top,
    exposure,
    pctOfBook: share(exposure, totalExposure),
    pctOfShf: (exposure / param("shareholdersFunds")) * 100,
    grossBook,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// WARR (§6.6.9)
// ---------------------------------------------------------------------------------------------------------------

/** Grade-to-score table (Rules & Parameters Engine). Demo: numeric grade 1 (best) – 10 (worst) maps to itself. */
export const gradeScore = (grade: number) => grade;

export type WarrRow = { exposure: number; grade?: number | null; stage?: Ifrs9Stage };
export type WarrResult = { warr: number; warrExStage3: number; ratedExposure: number; unratedExposure: number; unratedPct: number; stage3Exposure: number };

/** WARR = Σ(exposure × grade score) / Σ rated exposure. Unrated reported separately; Stage 3 shown in and out. */
export function computeWarr(rows: WarrRow[]): WarrResult {
  let num = 0, den = 0, numX = 0, denX = 0, unrated = 0, s3 = 0;
  for (const r of rows) {
    if (r.grade == null) {
      unrated += r.exposure;
      continue;
    }
    num += r.exposure * gradeScore(r.grade);
    den += r.exposure;
    if (r.stage === 3) s3 += r.exposure;
    else {
      numX += r.exposure * gradeScore(r.grade);
      denX += r.exposure;
    }
  }
  return {
    warr: den ? num / den : 0,
    warrExStage3: denX ? numX / denX : 0,
    ratedExposure: den,
    unratedExposure: unrated,
    unratedPct: share(unrated, den + unrated),
    stage3Exposure: s3,
  };
}

/** WARR rows for the live book (one per facility, graded at obligor level). */
export function warrRows(all: Facility[], obligors: Obligor[]): Array<WarrRow & { facility: Facility; obligor: Obligor }> {
  const byId = new Map(obligors.map((o) => [o.id, o]));
  return liveFacilities(all)
    .map((f) => ({ facility: f, obligor: byId.get(f.obligorId)!, exposure: warrExposure(f), grade: byId.get(f.obligorId)?.riskGrade ?? null, stage: f.stage }))
    .filter((r) => r.obligor);
}

/** WARR per segment. */
export function warrBy<T extends WarrRow>(rows: T[], keyOf: (r: T) => string) {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const total = sum(rows, (r) => r.exposure);
  return [...groups.entries()]
    .map(([key, list]) => ({ key, exposure: sum(list, (r) => r.exposure), share: share(sum(list, (r) => r.exposure), total), count: list.length, ...computeWarr(list) }))
    .sort((a, b) => b.exposure - a.exposure);
}

// ---------------------------------------------------------------------------------------------------------------
// Sector performance — capital consumption & RAROC (§6.6.5)
// ---------------------------------------------------------------------------------------------------------------

export function eclProxy(f: Facility, rates = eclProxyPct()): number {
  const base = onBalance(f);
  if (f.stage === 1) return (base * rates.stage1) / 100;
  if (f.stage === 2) return (base * rates.stage2) / 100;
  const cls = (NPL_CLASSES.includes(f.cbnClass) ? f.cbnClass : "Substandard") as "Substandard" | "Doubtful" | "Lost";
  return (base * rates.stage3[cls]) / 100;
}

export type Profitability = {
  exposure: number;
  rwa: number;
  capital: number;
  interestIncome: number;
  interestExpense: number;
  nii: number;
  fees: number;
  opex: number;
  ecl: number;
  riskAdjustedReturn: number;
  /** (NII + Fees − Opex − ECL) / Capital consumption × 100. */
  raroc: number;
  /** (Interest income − interest expense) / average interest-earning assets × 100. */
  nim: number;
};

/** Annualised profitability of a facility set. RWA = exposure × risk weight; capital = RWA × min CAR. */
export function profitability(list: Facility[], obligorById: Map<string, Obligor>): Profitability {
  const p = getPortfolioParams();
  const ccf = ccfTable();
  const weights = riskWeightTable();
  const ecls = eclProxyPct();
  let exposure = 0, rwa = 0, ii = 0, ie = 0, fees = 0, opex = 0, ecl = 0, earning = 0;
  for (const f of list) {
    const o = obligorById.get(f.obligorId);
    const ead = onBalance(f) + offBalance(f) * (ccf[f.product].pct / 100);
    const rw = (o ? weights[o.type] : 100) / 100; // TD-501: unclassified obligor defaults to 100%
    exposure += onBalance(f) + offBalance(f);
    rwa += ead * rw;
    const funded = onBalance(f);
    earning += funded;
    ii += (funded * f.ratePct) / 100;
    ie += (funded * p.costOfFundsPct.value) / 100;
    fees += (f.approvedAmount * p.feeIncomePct.value) / 100;
    opex += (funded * p.opexAllocationPct.value) / 100;
    ecl += eclProxy(f, ecls);
  }
  const capital = (rwa * p.minCarPct.value) / 100;
  const nii = ii - ie;
  const rar = nii + fees - opex - ecl;
  return { exposure, rwa, capital, interestIncome: ii, interestExpense: ie, nii, fees, opex, ecl, riskAdjustedReturn: rar, raroc: capital ? (rar / capital) * 100 : 0, nim: earning ? (nii / earning) * 100 : 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------------------------------

export function sum<T>(list: T[], fn: (x: T) => number): number {
  let s = 0;
  for (const x of list) s += fn(x);
  return s;
}
export function share(part: number, whole: number): number {
  return whole ? (part / whole) * 100 : 0;
}
/** Deterministic pseudo-random in [0, 1) from a string — used for synthetic history so the demo is stable. */
export function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
