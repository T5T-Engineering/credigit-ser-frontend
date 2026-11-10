/**
 * IFRS 9 ECL engine (prototype) — PRD §6.7, §8 calc rows "IFRS 9 Stage 1 ECL" / "Stage 2/3 ECL".
 *
 * Inputs come from the shared Risk Data Spine (facilities, obligors, collateral). PD/LGD/EAD parameters
 * below are DEMO MODEL PARAMETERS — in production they come from the Predictive Analytics model registry
 * (§6.7.2) and the Rules & Parameters Engine. Every figure is computed, never typed in.
 */
import { DEMO_NOW } from "@/lib/data/seed";
import type { CbnClass, Collateral, CollateralType, Facility, Ifrs9Stage, Obligor, Sector } from "@/lib/data/types";
import { rarPosition } from "@/lib/rar";
import { clamp, hash01, sum } from "./common";

// ---------------------------------------------------------------- parameters

/** 12-month PD by internal risk grade 1 (best) – 10 (worst). Demo calibration. */
export const PD_BY_GRADE = [0.0012, 0.0022, 0.0035, 0.0055, 0.008, 0.012, 0.018, 0.027, 0.04, 0.06];

/** Sector PD multipliers (demo segmentation per §6.7.2 "segmented by product, sector and 360 RAR posture"). */
export const SECTOR_PD_MULTIPLIER: Record<string, number> = {
  "SEC-OGU": 1.25,
  "SEC-OGD": 1.15,
  "SEC-CON": 1.2,
  "SEC-RES": 1.15,
  "SEC-AGR": 1.1,
  "SEC-COM": 1.1,
  "SEC-MIN": 1.2,
  "SEC-GOV": 0.6,
  "SEC-FIN": 0.8,
};

/** 360 RAR posture PD multiplier (demo). */
export const POSTURE_PD_MULTIPLIER = { Aggressive: 1.1, Competitive: 1.0, Conservative: 0.95, Defensive: 1.2 } as const;

/** Forward-looking macro scenarios (from the §5.5 external data feed) and probability weights. Demo values. */
export const MACRO_SCENARIOS = [
  { id: "upside", name: "Upside", weight: 0.15, pdFactor: 0.85 },
  { id: "base", name: "Base", weight: 0.6, pdFactor: 1.0 },
  { id: "downside", name: "Downside", weight: 0.25, pdFactor: 1.35 },
];
export const FLI_OVERLAY = sum(MACRO_SCENARIOS.map((s) => s.weight * s.pdFactor));

export const LGD_FLOOR = 0.1;
export const LGD_CAP_UNSECURED = 0.75;
/** Discount on collateral recovery for time-to-recover and work-out cost (demo). */
export const RECOVERY_DISCOUNT = 0.85;
/** Undrawn-limit credit-conversion factor for overdraft / revolving facilities (§6.7.2). Demo value. */
export const CCF_REVOLVING = 0.75;
/** CCF for transaction-related contingencies (guarantees) — §9.1 CCF category (50%). */
export const CCF_GUARANTEE = 0.5;
/** CBN general provision on performing book — tenant parameter (demo 1%); PRD caps it at 1.25% of RWA (CBN 3.16(d)). */
export const GENERAL_PROVISION_RATE = 0.01;
/** CBN specific provision rates (PRD §6.7.1 / CBN 12.2(a)(2)). */
export const CBN_SPECIFIC_RATE: Record<CbnClass, number> = { Performing: 0, Watchlist: 0, Substandard: 0.1, Doubtful: 0.5, Lost: 1 };
/** Haircut weightings for Lost-facility provisioning (PRD §6.7.3 / CBN 12.13(a)(5)). Types not listed get no adjustment. */
export const LOST_HAIRCUT_WEIGHTING: Partial<Record<CollateralType, number>> = {
  "Cash / lien on deposit": 0,
  "Quoted shares": 0.2,
  "Legal mortgage": 0.5,
};
/** USD/NGN spot from the Rules & Parameters Engine spot-rate feed (demo). */
export const USD_NGN = 1_535;

// ---------------------------------------------------------------- engine

export type EclRow = {
  id: string;
  facility: Facility;
  obligor?: Obligor;
  sector: string;
  stage: Ifrs9Stage;
  cbnClass: CbnClass;
  /** NGN equivalents. */
  outstanding: number;
  accrued: number;
  undrawnCcf: number;
  ead: number;
  pd12: number;
  pdLifetime: number;
  /** PD used for this stage's basis. */
  pd: number;
  lgd: number;
  recovery: number;
  remainingYears: number;
  basis: "12-month" | "Lifetime" | "Lifetime (credit-impaired)";
  ecl: number;
  prudential: number;
  prudentialBasis: string;
};

export type EngineInput = { facilities: Facility[]; obligors: Obligor[]; collateral: Collateral[]; sectors: Sector[] };
export type Shock = { pdMultiplier?: number; lgdAddOn?: number; fxDevaluationPct?: number };

/** Facility amounts in the data spine are NGN-equivalent (USD facilities revalued at spot by the CBA connector); a devaluation shock re-prices USD exposures. */
const fx = (f: Facility, shock?: Shock) => (f.currency === "USD" ? 1 + (shock?.fxDevaluationPct ?? 0) / 100 : 1);

export function inScope(f: Facility) {
  return f.status === "Active" || f.status === "Restructured";
}

export function remainingYears(f: Facility) {
  return Math.max(0, (new Date(f.maturityDate).getTime() - DEMO_NOW.getTime()) / (365 * 864e5));
}

/** Facility-level ECL for a given stage (also used to price stage transfers / write-backs). */
export function eclFor(f: Facility, input: Omit<EngineInput, "facilities">, stage: Ifrs9Stage = f.stage, shock?: Shock, maps?: Maps): EclRow {
  const m = maps ?? buildMaps(input);
  const o = m.obligor.get(f.obligorId);
  const rate = fx(f, shock);
  const outstanding = f.outstanding * rate;
  const accrued = (outstanding * (f.ratePct / 100) * (Math.min(f.dpd, 90) + 30)) / 365;
  const isRevolving = f.product === "Overdraft" || f.product === "Revolving credit";
  const isGuarantee = f.product.includes("guarantee");
  const undrawn = Math.max(0, f.approvedAmount * rate - outstanding);
  const undrawnCcf = isRevolving ? undrawn * CCF_REVOLVING : isGuarantee ? f.approvedAmount * rate * CCF_GUARANTEE : 0;
  const ead = outstanding + accrued + undrawnCcf;

  const grade = clamp(o?.riskGrade ?? 5, 1, 10);
  const posture = o ? rarPosition(o.rar).base : "Competitive";
  const pdRaw = PD_BY_GRADE[grade - 1]! * (SECTOR_PD_MULTIPLIER[o?.sectorId ?? ""] ?? 1) * POSTURE_PD_MULTIPLIER[posture] * FLI_OVERLAY * (shock?.pdMultiplier ?? 1);
  const pd12Base = clamp(pdRaw, 0.0005, 0.95);
  const years = remainingYears(f);
  const pd12 = 1 - (1 - pd12Base) ** Math.min(1, Math.max(years, 0.25));
  const pdLifetime = 1 - (1 - pd12Base) ** Math.max(years, 0.25);
  const pd = stage === 1 ? pd12 : stage === 2 ? Math.max(pdLifetime, pd12) : 1;

  const recovery = sum(
    (m.collateralByFacility.get(f.id) ?? []).map((c) => {
      if (c.perfection !== "Perfected") return 0;
      const value = c.type === "Quoted shares" ? c.marketValue : c.forcedSaleValue;
      return (value * (1 - c.haircutPct / 100) * RECOVERY_DISCOUNT) / Math.max(1, c.facilityIds.length);
    }),
  );
  const lgd = clamp((ead > 0 ? 1 - recovery / ead : LGD_CAP_UNSECURED) + (shock?.lgdAddOn ?? 0), LGD_FLOOR, stage === 3 ? 1 : LGD_CAP_UNSECURED + (shock?.lgdAddOn ?? 0));
  const ecl = pd * lgd * ead;

  // CBN prudential provision (parallel basis, §6.7.1).
  const cls = f.cbnClass;
  let prudential = 0;
  let prudentialBasis = "";
  if (cls === "Performing" || cls === "Watchlist") {
    prudential = outstanding * GENERAL_PROVISION_RATE;
    prudentialBasis = `General provision ${(GENERAL_PROVISION_RATE * 100).toFixed(0)}% (tenant parameter)`;
  } else if (cls === "Lost" && f.dpd < 360 + 365) {
    // §6.7.3 haircut-adjusted provision; lapses after 1 year non-performing in Lost (CBN 12.13(b)(3)-(4)).
    const eligible = sum(
      (m.collateralByFacility.get(f.id) ?? []).map((c) => {
        const w = LOST_HAIRCUT_WEIGHTING[c.type];
        if (w === undefined || c.perfection !== "Perfected") return 0;
        const value = c.type === "Quoted shares" ? c.marketValue : c.forcedSaleValue;
        return (value * (1 - w)) / Math.max(1, c.facilityIds.length);
      }),
    );
    prudential = Math.max(0, outstanding - eligible);
    prudentialBasis = eligible > 0 ? "Lost — haircut-adjusted (§6.7.3)" : "Lost — 100%";
  } else {
    prudential = outstanding * CBN_SPECIFIC_RATE[cls];
    prudentialBasis = `${cls} — ${(CBN_SPECIFIC_RATE[cls] * 100).toFixed(0)}% of outstanding`;
  }

  return {
    id: f.id,
    facility: f,
    obligor: o,
    sector: m.sector.get(o?.sectorId ?? "")?.name ?? "—",
    stage,
    cbnClass: cls,
    outstanding,
    accrued,
    undrawnCcf,
    ead,
    pd12,
    pdLifetime,
    pd,
    lgd,
    recovery,
    remainingYears: years,
    basis: stage === 1 ? "12-month" : stage === 2 ? "Lifetime" : "Lifetime (credit-impaired)",
    ecl,
    prudential,
    prudentialBasis,
  };
}

type Maps = {
  obligor: Map<string, Obligor>;
  sector: Map<string, Sector>;
  collateralByFacility: Map<string, Collateral[]>;
};

function buildMaps(input: Omit<EngineInput, "facilities">): Maps {
  const collateralByFacility = new Map<string, Collateral[]>();
  for (const c of input.collateral) for (const fid of c.facilityIds) collateralByFacility.set(fid, [...(collateralByFacility.get(fid) ?? []), c]);
  return { obligor: new Map(input.obligors.map((o) => [o.id, o])), sector: new Map(input.sectors.map((s) => [s.id, s])), collateralByFacility };
}

export function runEcl(input: EngineInput, shock?: Shock): EclRow[] {
  const maps = buildMaps(input);
  return input.facilities.filter(inScope).map((f) => eclFor(f, input, f.stage, shock, maps));
}

export type StageSummary = { stage: Ifrs9Stage; count: number; ead: number; ecl: number; coverage: number; prudential: number };

export function summariseByStage(rows: EclRow[]): StageSummary[] {
  return ([1, 2, 3] as Ifrs9Stage[]).map((stage) => {
    const r = rows.filter((x) => x.stage === stage);
    const ead = sum(r.map((x) => x.ead));
    const ecl = sum(r.map((x) => x.ecl));
    return { stage, count: r.length, ead, ecl, coverage: ead ? ecl / ead : 0, prudential: sum(r.map((x) => x.prudential)) };
  });
}

export const stageTone = { 1: "success", 2: "warning", 3: "danger" } as const;
export const stageLabel = (s: Ifrs9Stage) => `Stage ${s}`;

// ---------------------------------------------------------------- stage transfers & movement

export type StageTransfer = {
  id: string;
  facilityId: string;
  obligorName: string;
  from: Ifrs9Stage;
  to: Ifrs9Stage;
  date: string;
  trigger: string;
  eclBefore: number;
  eclAfter: number;
};

/** Stage transfers this quarter (derived from DPD / watchlist history; demo history). */
export function stageTransfers(rows: EclRow[], input: EngineInput): StageTransfer[] {
  const maps = buildMaps(input);
  const out: StageTransfer[] = [];
  for (const r of rows) {
    const f = r.facility;
    const h = hash01(f.id);
    let from: Ifrs9Stage | null = null;
    let trigger = "";
    if (r.stage === 3 && f.dpd < 180) {
      from = 2;
      trigger = "Default definition met — DPD ≥ 90 (CBN Sub-Standard)";
    } else if (r.stage === 2 && f.dpd >= 30) {
      from = 1;
      trigger = "Quantitative backstop — DPD ≥ 30";
    } else if (r.stage === 2 && h < 0.6) {
      from = 1;
      trigger = "Qualitative SICR — Loan Review watchlist flag";
    }
    if (!from) continue;
    const before = eclFor(f, input, from, undefined, maps).ecl;
    out.push({
      id: `TRF-${f.id}`,
      facilityId: f.id,
      obligorName: r.obligor?.name ?? f.obligorId,
      from,
      to: r.stage,
      date: new Date(DEMO_NOW.getTime() - Math.round(h * 85 + 3) * 864e5).toISOString(),
      trigger,
      eclBefore: before,
      eclAfter: r.ecl,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export type MovementStep = { label: string; value: number; caption: string };

/** ECL movement for the quarter (opening → closing). Components are a demo attribution of the computed closing ECL. */
export function eclMovement(rows: EclRow[], transfers: StageTransfer[]): { opening: number; steps: MovementStep[]; closing: number } {
  const closing = sum(rows.map((r) => r.ecl));
  const quarterStart = DEMO_NOW.getTime() - 90 * 864e5;
  const newAssets = sum(rows.filter((r) => new Date(r.facility.startDate).getTime() >= quarterStart).map((r) => r.ecl));
  const transfersNet = sum(transfers.map((t) => t.eclAfter - t.eclBefore));
  const cures = -0.12 * transfersNet;
  const remeasurement = 0.04 * closing;
  const derecognised = -0.07 * closing;
  const writeOffs = -0.025 * closing;
  const steps: MovementStep[] = [
    { label: "New assets", value: newAssets, caption: "ECL on facilities originated this quarter" },
    { label: "Transfers to S2/S3", value: transfersNet, caption: "12-month → lifetime basis on SICR / default" },
    { label: "Cures to S1/S2", value: cures, caption: "Approved declassifications (§6.7.5)" },
    { label: "Remeasurement", value: remeasurement, caption: "PD/LGD/FLI parameter update" },
    { label: "Repaid / derecognised", value: derecognised, caption: "Matured and repaid exposures" },
    { label: "Write-offs", value: writeOffs, caption: "Lost facilities written off" },
  ];
  const opening = closing - sum(steps.map((s) => s.value));
  return { opening, steps, closing };
}

// ---------------------------------------------------------------- SICR triggers

export type SicrTrigger = {
  id: string;
  name: string;
  kind: "Quantitative" | "Qualitative" | "Backstop" | "Default";
  rule: string;
  parameter: string;
  source: string;
  count: number;
};

export function sicrTriggers(rows: EclRow[]): SicrTrigger[] {
  return [
    {
      id: "T1",
      name: "Days-past-due backstop",
      kind: "Backstop",
      rule: "DPD ≥ 30 and < 90 → Stage 2",
      parameter: "30 days (tenant-configurable)",
      source: "CBA facility ledger · Loan Review past-due register (§6.4.1)",
      count: rows.filter((r) => r.facility.dpd >= 30 && r.facility.dpd < 90).length,
    },
    {
      id: "T2",
      name: "Watchlist flag",
      kind: "Qualitative",
      rule: "Obligor on Loan Review watchlist → Stage 2",
      parameter: "On / off",
      source: "Loan Review watchlist (§6.4.1)",
      count: rows.filter((r) => r.obligor?.watchlist && r.stage < 3).length,
    },
    {
      id: "T3",
      name: "Risk-grade deterioration",
      kind: "Quantitative",
      rule: "Internal grade ≥ 7 (proxy for ≥ 3-notch downgrade since origination)",
      parameter: "Grade 7 · 3 notches (demo)",
      source: "Internal rating (§6.2) — origination grade not yet in the data spine",
      count: rows.filter((r) => (r.obligor?.riskGrade ?? 0) >= 7).length,
    },
    {
      id: "T4",
      name: "360 RAR posture",
      kind: "Qualitative",
      rule: "Posture moved to Defensive",
      parameter: "Defensive quadrant (§6.2.5)",
      source: "360 RAR Engine",
      count: rows.filter((r) => r.obligor && rarPosition(r.obligor.rar).base === "Defensive").length,
    },
    {
      id: "T5",
      name: "Restructured / forborne",
      kind: "Qualitative",
      rule: "Held at minimum Stage 2 during probation",
      parameter: "12-month probation (demo)",
      source: "Origination request type · facility status",
      count: rows.filter((r) => r.facility.status === "Restructured").length,
    },
    {
      id: "T6",
      name: "Default definition",
      kind: "Default",
      rule: "DPD ≥ 90 or CBN Sub-Standard / Doubtful / Lost → Stage 3",
      parameter: "90 days (CBN)",
      source: "CBA facility ledger · CBN classification",
      count: rows.filter((r) => r.stage === 3).length,
    },
  ];
}

// ---------------------------------------------------------------- model register (§6.7.2)

export type ModelStatus = "Approved" | "Pending validation" | "Validation findings" | "Pending approval" | "Retired";

export type RiskModel = {
  id: string;
  name: string;
  parameter: "PD" | "LGD" | "EAD" | "Overlay" | "Behavioural";
  segment: string;
  method: string;
  version: string;
  owner: string;
  lastCalibrated: string;
  nextReview: string;
  status: ModelStatus;
  performance: string;
  inputs: string;
};

const d = (days: number) => new Date(DEMO_NOW.getTime() + days * 864e5).toISOString();

export const seedModels: RiskModel[] = [
  {
    id: "MDL-PD-CORP",
    name: "Corporate & commercial PD",
    parameter: "PD",
    segment: "Corporate · Commercial · Public sector",
    method: "Rating-to-PD master scale, through-the-cycle → point-in-time",
    version: "3.2",
    owner: "Predictive Analytics",
    lastCalibrated: d(-212),
    nextReview: d(153),
    status: "Approved",
    performance: "AUROC 0.81 · Gini 0.62",
    inputs: "Internal grade, sector, 360 RAR posture, default/cure history",
  },
  {
    id: "MDL-PD-SME",
    name: "SME & retail PD scorecard",
    parameter: "PD",
    segment: "SME · Retail",
    method: "Logistic scorecard on behavioural + bureau data",
    version: "2.4",
    owner: "Predictive Analytics",
    lastCalibrated: d(-301),
    nextReview: d(64),
    status: "Pending validation",
    performance: "AUROC 0.76 · Gini 0.52",
    inputs: "DPD history, bureau score, account inflows, product",
  },
  {
    id: "MDL-PD-TS",
    name: "Lifetime PD term structure",
    parameter: "PD",
    segment: "All Stage 2 exposures",
    method: "Constant-hazard extrapolation of 12-month PD",
    version: "1.3",
    owner: "Predictive Analytics",
    lastCalibrated: d(-212),
    nextReview: d(153),
    status: "Approved",
    performance: "Back-test within ±10%",
    inputs: "12-month PD, remaining tenor",
  },
  {
    id: "MDL-LGD-SEC",
    name: "Secured LGD (collateral recovery)",
    parameter: "LGD",
    segment: "Secured facilities",
    method: "Haircut-adjusted forced-sale value, discounted work-out",
    version: "2.1",
    owner: "Predictive Analytics",
    lastCalibrated: d(-140),
    nextReview: d(225),
    status: "Approved",
    performance: "Mean abs. error 6.8pp",
    inputs: "Collateral FSV / MTM, haircut, perfection, work-out history",
  },
  {
    id: "MDL-LGD-UNS",
    name: "Unsecured LGD",
    parameter: "LGD",
    segment: "Unsecured facilities",
    method: "Historical work-out recovery rate by product",
    version: "1.6",
    owner: "Predictive Analytics",
    lastCalibrated: d(-388),
    nextReview: d(-23),
    status: "Validation findings",
    performance: "Mean abs. error 11.2pp",
    inputs: "Loan Review work-out recoveries",
  },
  {
    id: "MDL-EAD-CCF",
    name: "EAD / credit-conversion factor",
    parameter: "EAD",
    segment: "Overdraft · Revolving · Guarantees",
    method: "Utilisation-at-default CCF",
    version: "1.4",
    owner: "Predictive Analytics",
    lastCalibrated: d(-175),
    nextReview: d(190),
    status: "Approved",
    performance: "CCF back-test 0.72 vs 0.75",
    inputs: "Limit, drawn balance, accrued interest",
  },
  {
    id: "MDL-FLI",
    name: "Forward-looking macro overlay",
    parameter: "Overlay",
    segment: "Portfolio",
    method: "Probability-weighted scenarios (upside / base / downside)",
    version: "4.0",
    owner: "Predictive Analytics",
    lastCalibrated: d(-35),
    nextReview: d(55),
    status: "Pending approval",
    performance: "Scenario weights 15 / 60 / 25",
    inputs: "GDP, inflation, MPR, FX — external data feed (§5.5)",
  },
  {
    id: "MDL-NMD",
    name: "Non-maturity deposit behaviour",
    parameter: "Behavioural",
    segment: "Current & savings deposits",
    method: "Core / volatile split with decay",
    version: "1.1",
    owner: "Predictive Analytics",
    lastCalibrated: d(-250),
    nextReview: d(115),
    status: "Approved",
    performance: "Core ratio 68%",
    inputs: "CBA deposit ledger history — used by NII-at-Risk (§6.8.1)",
  },
];

/** §6.7.2 source mapping, verbatim structure. */
export const sourceMapping = [
  {
    input: "Probability of Default (PD)",
    source:
      "Historical facility-level default/cure data from the CBA + Loan Review past-due register (§6.4.1), segmented by product, sector and 360 RAR posture (§6.2.5); refreshed at least annually per CBN 12.15.",
    connector: "CBA connector · Loan Review",
    refresh: "Annual (minimum)",
  },
  {
    input: "Loss Given Default (LGD)",
    source:
      "Collateral register (§6.5) forced-sale value and haircut-adjusted recovery value — for share-backed collateral, the SEC/CSCS mark-to-market value (§5.7) — combined with historical work-out recovery data from Loan Review.",
    connector: "Collateral register · SEC/CSCS",
    refresh: "Daily MTM · annual recalibration",
  },
  {
    input: "Exposure at Default (EAD)",
    source: "CBA facility book — outstanding principal plus accrued interest plus, for revolving/overdraft facilities, an undrawn-limit credit-conversion factor.",
    connector: "CBA connector (§5.1)",
    refresh: "Daily",
  },
  {
    input: "Specialised-loan overlays",
    source:
      "CBN Annexures 2–6 classification/provisioning grids (Project Finance, Object Finance, Real Estate, SME, Agriculture, Mortgage), configured in the Rules & Parameters Engine and applied by the facility's product-type tag from Origination.",
    connector: "Rules & Parameters Engine",
    refresh: "On circular change",
  },
];

// ---------------------------------------------------------------- ICAAP (§6.7.4, §9.1)

export type CapitalBase = { tier1Gross: number; deductions: number; tier2Gross: number; creditRwa: number; marketRwa: number; operationalRwa: number };

/** Demo capital base calibrated to the portfolio: GL capital accounts would supply this in production. */
export function capitalBase(rows: EclRow[]): CapitalBase {
  // Credit RWA: exposures × demo risk weight (retail 75%, public sector 0%/20%, others 100%; 150% FCY-collateral overlay out of scope here).
  const creditRwa = sum(
    rows.map((r) => {
      const t = r.obligor?.type;
      const w = t === "Public sector" ? 0.2 : t === "Retail" ? 0.75 : r.stage === 3 ? 1.5 : 1;
      return Math.max(0, r.ead - r.ecl) * w;
    }),
  );
  // The loan book is roughly 55% of total risk-weighted assets for a Nigerian DMB (demo calibration).
  const otherCreditRwa = creditRwa * 0.45;
  const totalCredit = creditRwa + otherCreditRwa;
  const marketRwa = totalCredit * 0.08;
  const operationalRwa = totalCredit * 0.16;
  const totalRwa = totalCredit + marketRwa + operationalRwa;
  return { tier1Gross: totalRwa * 0.168, deductions: totalRwa * 0.012, tier2Gross: totalRwa * 0.041, creditRwa: totalCredit, marketRwa, operationalRwa };
}

export function capitalMetrics(c: CapitalBase, eclIncrease = 0, rwaIncrease = 0) {
  const tier1 = c.tier1Gross - c.deductions - eclIncrease * 0.7; // ΔECL net of 30% tax shield (demo)
  const tier2 = Math.min(c.tier2Gross, tier1 / 3); // §9.1: Tier 2 capped at one-third of Tier 1
  const qualifying = tier1 + tier2;
  const rwa = c.creditRwa + c.marketRwa + c.operationalRwa + rwaIncrease;
  return { tier1, tier2, tier2Capped: c.tier2Gross > tier2, qualifying, rwa, car: (qualifying / rwa) * 100, tier1Ratio: (tier1 / rwa) * 100 };
}

export type CapitalClass = "Adequately capitalised" | "Under-capitalised" | "Significantly under-capitalised" | "Critically under-capitalised" | "Insolvent";

/** §6.7.4 classification engine (CBN 3.16(f)-(g)). */
export function classifyCar(car: number, minimum: number): CapitalClass {
  if (car < 0) return "Insolvent";
  if (car < 2) return "Critically under-capitalised";
  if (car < 5) return "Significantly under-capitalised";
  if (car < minimum) return "Under-capitalised";
  return "Adequately capitalised";
}
export const capitalClassTone: Record<CapitalClass, "success" | "warning" | "danger"> = {
  "Adequately capitalised": "success",
  "Under-capitalised": "warning",
  "Significantly under-capitalised": "danger",
  "Critically under-capitalised": "danger",
  Insolvent: "danger",
};

export type IcaapScenario = {
  id: string;
  name: string;
  description: string;
  gdpPct: number;
  inflationPct: number;
  fxDevaluationPct: number;
  mprBps: number;
  pdMultiplier: number;
  lgdAddOn: number;
};

export const seedScenarios: IcaapScenario[] = [
  {
    id: "base",
    name: "Base",
    description: "Consensus macro path from the external data feed",
    gdpPct: 3.2,
    inflationPct: 22,
    fxDevaluationPct: 0,
    mprBps: 0,
    pdMultiplier: 1,
    lgdAddOn: 0,
  },
  {
    id: "adverse",
    name: "Adverse",
    description: "Oil-price fall, FX pressure and tighter monetary policy",
    gdpPct: 0.8,
    inflationPct: 28,
    fxDevaluationPct: 25,
    mprBps: 300,
    pdMultiplier: 1.6,
    lgdAddOn: 0.05,
  },
  {
    id: "severe",
    name: "Severe",
    description: "Recession with sharp naira devaluation and sector contagion",
    gdpPct: -2.5,
    inflationPct: 35,
    fxDevaluationPct: 60,
    mprBps: 600,
    pdMultiplier: 2.4,
    lgdAddOn: 0.12,
  },
];

/** Pillar 2 capital add-ons (demo — tenant ICAAP policy). As % of RWA. */
export const pillar2AddOns = [
  { risk: "Credit concentration (single obligor & sector)", pct: 0.9, basis: "HHI-based add-on on sector exposures (§6.6.2)" },
  { risk: "Interest-rate risk in the banking book (IRRBB)", pct: 0.6, basis: "EVE sensitivity, +200 bps (§6.8.1)" },
  { risk: "Liquidity & funding risk", pct: 0.3, basis: "ILAAP survival-horizon outcome (§6.8.2)" },
  { risk: "Strategic & reputational risk", pct: 0.4, basis: "ERM risk register (§6.10)" },
];

export const supervisoryChecklist: Record<CapitalClass, string[]> = {
  "Adequately capitalised": ["Maintain monthly CAR monitoring", "Annual ICAAP submission to the Board and CBN"],
  "Under-capitalised": ["Notify the CBN and submit a capital restoration plan", "Restrict dividend payments", "Board approval for new business lines"],
  "Significantly under-capitalised": ["All Under-capitalised actions", "Restrict asset growth", "Recapitalisation within the CBN deadline"],
  "Critically under-capitalised": ["All prior actions", "Prepare for CBN intervention / resolution"],
  Insolvent: ["CBN resolution procedures"],
};

// ---------------------------------------------------------------- declassification (§6.7.5)

export type CureData = {
  facilityId: string;
  /** DPD today from the CBA repayment feed (the staging run uses month-end DPD). */
  currentDpd: number;
  consecutiveTimely: number;
  monthsInProbation: number;
  performingPortion: number;
};

/** Simulated CBA repayment feed for Stage 2/3 facilities since month-end staging. */
export function cureData(rows: EclRow[]): Map<string, CureData> {
  const m = new Map<string, CureData>();
  for (const r of rows) {
    if (r.stage === 1) continue;
    const h = hash01(`${r.id}-cure`);
    const curing = h < 0.55;
    m.set(r.id, {
      facilityId: r.id,
      currentDpd: curing ? (h < 0.3 ? 0 : Math.round(h * 40)) : r.facility.dpd,
      consecutiveTimely: curing ? 1 + Math.floor(h * 10) : 0,
      monthsInProbation: curing ? Math.floor(h * 16) : 0,
      performingPortion: h > 0.45 && curing ? 0.6 : 1,
    });
  }
  return m;
}

export type CureParams = {
  stage3DpdThreshold: number;
  curePeriods: number;
  stage2Probation: number;
  restructuredProbation: number;
  suspendedInterestPolicy: "On cash receipt" | "On declassification";
};
export const defaultCureParams: CureParams = { stage3DpdThreshold: 90, curePeriods: 3, stage2Probation: 3, restructuredProbation: 12, suspendedInterestPolicy: "On cash receipt" };

export type Eligibility = { target: Ifrs9Stage | null; status: "Eligible" | "In probation" | "Not eligible"; reason: string };

export function eligibility(r: EclRow, c: CureData | undefined, p: CureParams): Eligibility {
  if (!c) return { target: null, status: "Not eligible", reason: "No cure data" };
  if (r.stage === 3) {
    if (c.currentDpd >= p.stage3DpdThreshold) return { target: null, status: "Not eligible", reason: `Arrears ${c.currentDpd} DPD ≥ ${p.stage3DpdThreshold}` };
    if (c.consecutiveTimely < p.curePeriods) return { target: 2, status: "In probation", reason: `${c.consecutiveTimely} of ${p.curePeriods} timely repayment periods` };
    return { target: 2, status: "Eligible", reason: `Cured below ${p.stage3DpdThreshold} DPD · ${c.consecutiveTimely} timely periods` };
  }
  if (r.facility.status === "Restructured" && c.monthsInProbation < p.restructuredProbation)
    return { target: 1, status: "In probation", reason: `Restructured — ${c.monthsInProbation} of ${p.restructuredProbation} months probation at minimum Stage 2` };
  if (c.currentDpd >= 30) return { target: null, status: "Not eligible", reason: `SICR still met — ${c.currentDpd} DPD` };
  if (r.obligor?.watchlist && c.consecutiveTimely < p.stage2Probation + 3) return { target: 1, status: "In probation", reason: "Watchlist flag still active" };
  if (c.monthsInProbation < p.stage2Probation) return { target: 1, status: "In probation", reason: `${c.monthsInProbation} of ${p.stage2Probation} months probation` };
  return { target: 1, status: "Eligible", reason: `SICR reversed · ${c.monthsInProbation} months probation sustained` };
}

/** Suspended interest while in Stage 3 (demo: unpaid interest for DPD beyond 90). */
export function suspendedInterest(r: EclRow) {
  return r.stage === 3 ? (r.outstanding * (r.facility.ratePct / 100) * Math.max(0, r.facility.dpd - 90)) / 365 : 0;
}
