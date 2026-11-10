/**
 * Market & Liquidity Risk (PRD §6.8) — prototype data and calculations.
 *
 * Balances are derived from the shared loan book (via the IFRS 9 engine's NGN-equivalent EAD rows) and the
 * demo capital base, so figures stay consistent across modules. Treasury positions, deposit ledger, market
 * data and run-off assumptions are DEMO values standing in for the CBA/Treasury connectors and the
 * Rules & Parameters Engine. Formulas are as stated in PRD §6.8.1–§6.8.4.
 */
import { Faker, en, en_NG } from "@faker-js/faker";
import { DEMO_NOW } from "@/lib/data/seed";
import { USD_NGN, type EclRow } from "../ifrs9/data";
import { round, sum } from "../ifrs9/common";

// ---------------------------------------------------------------- balance sheet (demo, derived from the loan book)

export type BalanceSheet = {
  totalLoans: number;
  qualifyingLoans: number;
  fcyLoans: number;
  deposits: number;
  fcyDeposits: number;
  capital: number;
  undrawn: number;
};

export function balanceSheet(rows: EclRow[], capital: number): BalanceSheet {
  const totalLoans = sum(rows.map((r) => r.outstanding));
  const qualifyingLoans = sum(rows.filter((r) => r.obligor?.type === "SME" || r.obligor?.type === "Retail" || r.facility.product === "Mortgage").map((r) => r.outstanding));
  const fcyLoans = sum(rows.filter((r) => r.facility.currency === "USD").map((r) => r.outstanding));
  const deposits = totalLoans / 0.71; // demo: gross LDR ≈ 71%
  const undrawn = sum(rows.map((r) => Math.max(0, r.facility.approvedAmount - r.outstanding)));
  return { totalLoans, qualifyingLoans, fcyLoans, deposits, fcyDeposits: deposits * 0.17, capital, undrawn };
}

// ---------------------------------------------------------------- FX & NOP (§6.8.1)

export const FX_RATES = [
  { ccy: "USD", spot: USD_NGN, history: [1468, 1474, 1490, 1502, 1497, 1505, 1511, 1509, 1520, 1526, 1531, USD_NGN] },
  { ccy: "EUR", spot: 1668, history: [1590, 1596, 1611, 1622, 1618, 1630, 1641, 1638, 1652, 1657, 1662, 1668] },
  { ccy: "GBP", spot: 1972, history: [1890, 1902, 1915, 1931, 1922, 1936, 1944, 1940, 1956, 1961, 1966, 1972] },
  { ccy: "CNY", spot: 214, history: [204, 205, 207, 208, 208, 209, 210, 210, 212, 213, 213, 214] },
];
export const MONTHS = ["Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];

/** NOP limit as % of total capital — tenant parameter (PRD gives the ratio, not the limit). */
export const NOP_LIMIT_PCT = 20;

export type FxPosition = { ccy: string; spot: number; longFcy: number; shortFcy: number; netFcy: number; longNgn: number; shortNgn: number; netNgn: number; limitPct: number };

export function fxPositions(capital: number): FxPosition[] {
  // Net positions as a share of capital (demo), gross long/short around them.
  const spec = [
    { ccy: "USD", netPct: 9.4, gross: 1.9, limitPct: 15 },
    { ccy: "EUR", netPct: -2.1, gross: 0.35, limitPct: 5 },
    { ccy: "GBP", netPct: 1.3, gross: 0.22, limitPct: 5 },
    { ccy: "CNY", netPct: 0.6, gross: 0.08, limitPct: 3 },
  ];
  return spec.map((s) => {
    const rate = FX_RATES.find((r) => r.ccy === s.ccy)!.spot;
    const netNgn = (capital * s.netPct) / 100;
    const longNgn = capital * s.gross * 0.5 + Math.max(0, netNgn);
    const shortNgn = longNgn - netNgn;
    return { ccy: s.ccy, spot: rate, longFcy: longNgn / rate, shortFcy: shortNgn / rate, netFcy: netNgn / rate, longNgn, shortNgn, netNgn, limitPct: s.limitPct };
  });
}

// ---------------------------------------------------------------- VaR & stop-loss (§6.8.1)

export type Desk = { id: string; name: string; varNgn: number; limitNgn: number; mtmLossNgn: number; stopLossNgn: number; method: string };

export function desks(capital: number): Desk[] {
  return [
    {
      id: "FX",
      name: "FX trading desk",
      varNgn: capital * 0.0031,
      limitNgn: capital * 0.003,
      mtmLossNgn: capital * 0.0011,
      stopLossNgn: capital * 0.004,
      method: "Historical simulation",
    },
    {
      id: "FI",
      name: "Fixed income — trading",
      varNgn: capital * 0.0042,
      limitNgn: capital * 0.006,
      mtmLossNgn: capital * 0.0019,
      stopLossNgn: capital * 0.005,
      method: "Historical simulation",
    },
    {
      id: "MM",
      name: "Money market",
      varNgn: capital * 0.0009,
      limitNgn: capital * 0.0015,
      mtmLossNgn: 0,
      stopLossNgn: capital * 0.002,
      method: "Parametric (variance-covariance)",
    },
    {
      id: "INV",
      name: "Investment book (FVOCI)",
      varNgn: capital * 0.0058,
      limitNgn: capital * 0.008,
      mtmLossNgn: capital * 0.0036,
      stopLossNgn: capital * 0.006,
      method: "Historical simulation",
    },
  ];
}

/** 20 business days of total VaR as % of limit (deterministic). */
export const VAR_TREND = [71, 74, 69, 73, 78, 80, 77, 83, 85, 82, 86, 88, 84, 87, 90, 93, 89, 92, 95, 94];

// ---------------------------------------------------------------- repricing gap, NII & EVE (§6.8.1)

export const REPRICING_BUCKETS = [
  { id: "0-1m", label: "0–1m", mid: 0.5, dur: 0.04 },
  { id: "1-3m", label: "1–3m", mid: 2, dur: 0.16 },
  { id: "3-6m", label: "3–6m", mid: 4.5, dur: 0.36 },
  { id: "6-12m", label: "6–12m", mid: 9, dur: 0.71 },
  { id: "1-5y", label: "1–5y", mid: 36, dur: 2.5 },
  { id: ">5y", label: "> 5y", mid: 84, dur: 6 },
];

export type GapRow = { bucket: string; rsa: number; rsl: number; gap: number; cumulative: number };

export function repricingGap(rows: EclRow[], bs: BalanceSheet): GapRow[] {
  const loans = REPRICING_BUCKETS.map(() => 0);
  for (const r of rows) {
    const floating = r.facility.product === "Overdraft" || r.facility.product === "Revolving credit";
    const months = floating ? 0.5 : (new Date(r.facility.maturityDate).getTime() - DEMO_NOW.getTime()) / (30.4 * 864e5);
    const idx = months <= 1 ? 0 : months <= 3 ? 1 : months <= 6 ? 2 : months <= 12 ? 3 : months <= 60 ? 4 : 5;
    loans[idx] = (loans[idx] ?? 0) + r.outstanding;
  }
  const securities = [0.06, 0.07, 0.05, 0.04, 0.09, 0.03].map((p) => p * bs.deposits);
  const liabilities = [0.34, 0.17, 0.12, 0.08, 0.05, 0.01].map((p) => p * bs.deposits);
  let cum = 0;
  return REPRICING_BUCKETS.map((b, i) => {
    const rsa = loans[i]! + securities[i]!;
    const rsl = liabilities[i]!;
    cum += rsa - rsl;
    return { bucket: b.label, rsa, rsl, gap: rsa - rsl, cumulative: cum };
  });
}

/** ΔNII over 12 months = Σ gap(b) × shock × (12 − midpoint(b)) / 12, for buckets repricing within 12 months. */
export function niiAtRisk(gap: GapRow[], shockBps: number) {
  return sum(
    gap.map((g, i) => {
      const b = REPRICING_BUCKETS[i]!;
      return b.mid < 12 ? g.gap * (shockBps / 10000) * ((12 - b.mid) / 12) : 0;
    }),
  );
}

/** ΔEVE ≈ −Σ gap(b) × modified duration(b) × shock (duration approximation). */
export function eveSensitivity(gap: GapRow[], shockBps: number) {
  return -sum(gap.map((g, i) => g.gap * REPRICING_BUCKETS[i]!.dur * (shockBps / 10000)));
}

// ---------------------------------------------------------------- interbank (§6.8.1)

export const INTERBANK_QUOTES = [
  { counterparty: "Counterparty A", rate: 27.25 },
  { counterparty: "Counterparty B", rate: 27.6 },
  { counterparty: "Counterparty C", rate: 28.1 },
  { counterparty: "Counterparty D", rate: 26.9 },
  { counterparty: "Counterparty E", rate: 29.4 },
  { counterparty: "Counterparty F", rate: 27.8 },
];
export const INTERBANK_SPREAD_TREND = [1.6, 1.9, 1.7, 2.1, 2.4, 2.2, 2.0, 2.3, 2.6, 2.5];

// ---------------------------------------------------------------- liquidity (§6.8.2)

/** Liquidity ratio minimum — tenant parameter (PRD does not state the CBN figure). */
export const LIQUIDITY_RATIO_MIN = 30;
export const LCR_FLOOR = 100;
export const NSFR_FLOOR = 100;
export const LDR_MIN = 65;

export const LIQUID_ASSETS = [
  { id: "cash", label: "Cash", pctOfDeposits: 3.4, hqla: "Level 1" },
  { id: "cbn", label: "Balances with CBN", pctOfDeposits: 6.1, hqla: "Level 1" },
  { id: "tbills", label: "Treasury bills / certificates", pctOfDeposits: 16.8, hqla: "Level 1" },
  { id: "interbank", label: "Interbank placements", pctOfDeposits: 5.2, hqla: "Not HQLA" },
  { id: "fgn", label: "FGN bonds", pctOfDeposits: 9.3, hqla: "Level 1" },
  { id: "stab", label: "Stabilisation securities", pctOfDeposits: 1.9, hqla: "Level 1" },
];

export const FUNDING_MIX = [
  { id: "retail", label: "Retail", pct: 47, runOff: 7.5, asf: 0.9 },
  { id: "corporate", label: "Corporate", pct: 33, runOff: 25, asf: 0.5 },
  { id: "interbank", label: "Interbank", pct: 8, runOff: 100, asf: 0 },
  { id: "wholesale", label: "Wholesale / market funding", pct: 12, runOff: 40, asf: 0.5 },
];

export function liquidityMetrics(bs: BalanceSheet) {
  const liquid = sum(LIQUID_ASSETS.map((a) => (a.pctOfDeposits / 100) * bs.deposits));
  const hqla = sum(LIQUID_ASSETS.filter((a) => a.hqla === "Level 1").map((a) => (a.pctOfDeposits / 100) * bs.deposits));
  const outflows = sum(FUNDING_MIX.map((f) => (f.pct / 100) * bs.deposits * (f.runOff / 100))) + bs.undrawn * 0.1;
  const inflows = Math.min(bs.totalLoans * 0.045 * 0.5 + 0.052 * bs.deposits, 0.75 * outflows);
  const netOutflows = outflows - inflows;
  const asf = bs.capital + sum(FUNDING_MIX.map((f) => (f.pct / 100) * bs.deposits * f.asf));
  const rsf = bs.totalLoans * 0.72 + hqla * 0.05 + bs.deposits * 0.12;
  return {
    liquid,
    hqla,
    outflows,
    inflows,
    netOutflows,
    asf,
    rsf,
    liquidityRatio: (liquid / bs.deposits) * 100,
    lcr: (hqla / netOutflows) * 100,
    nsfr: (asf / rsf) * 100,
    ldrGross: (bs.totalLoans / bs.deposits) * 100,
    ldrWeighted: ((bs.totalLoans + 0.5 * bs.qualifyingLoans) / bs.deposits) * 100,
  };
}

export const LADDER = ["≤ 7d", "8d–1m", "1–3m", "3–6m", "6–12m", "1–3y", "> 3y"];

export function maturityLadder(bs: BalanceSheet, liquid: number) {
  const assets = [0.3, 0.12, 0.13, 0.1, 0.1, 0.13, 0.12].map((p) => p * (bs.totalLoans + liquid));
  const liabilities = [0.27, 0.19, 0.18, 0.12, 0.09, 0.08, 0.07].map((p) => p * (bs.deposits + bs.capital));
  let cum = 0;
  return LADDER.map((bucket, i) => {
    const gap = assets[i]! - liabilities[i]!;
    cum += gap;
    return { bucket, assets: assets[i]!, liabilities: liabilities[i]!, gap, cumulative: cum };
  });
}

export type Depositor = { rank: number; name: string; segment: string; balance: number };

export function topDepositors(bs: BalanceSheet): Depositor[] {
  const f = new Faker({ locale: [en_NG, en] });
  f.seed(6802);
  const raw = Array.from({ length: 200 }, (_, i) => (i + 1) ** -0.9);
  const scale = (bs.deposits * 0.36) / sum(raw); // top 200 ≈ 36% of deposits (demo)
  return raw.map((v, i) => ({
    rank: i + 1,
    name:
      i % 7 === 3
        ? `${f.person.lastName()} Family Trust`
        : `${f.company.name().replace(/,? (LLC|Inc|Group|and Sons)$/u, "")} ${f.helpers.arrayElement(["Ltd", "Plc", "Nigeria Ltd"])}`,
    segment: f.helpers.weightedArrayElement([
      { value: "Corporate", weight: 6 },
      { value: "Public sector", weight: 2 },
      { value: "Interbank", weight: 1 },
      { value: "High-net-worth", weight: 1 },
    ]),
    balance: v * scale,
  }));
}

export const CONCENTRATION_CUTOFFS = [5, 10, 25, 50, 100, 200];

/** Illiquidity early-warning triggers per CBN 3.13(c). Current counters are demo values. */
export const EARLY_WARNING = [
  { id: "EW1", trigger: "CBN current account overdrawn and uncovered", threshold: "5 consecutive working days", current: 0, unit: "days", status: "green" as const },
  { id: "EW2", trigger: "Clearing-operation deficit", threshold: "5 consecutive days", current: 1, unit: "days", status: "green" as const },
  { id: "EW3", trigger: "Unable to pay maturing obligations", threshold: "5 consecutive days", current: 0, unit: "days", status: "green" as const },
  { id: "EW4", trigger: "Net taker of interbank deposits ≥ 25% of total deposits", threshold: "90 consecutive days", current: 34, unit: "days at 18.6%", status: "amber" as const },
];

// ---------------------------------------------------------------- liquidity stress testing (§6.8.2, §6.8.4)

export type StressAssumptions = {
  band: "Business as usual" | "Adverse" | "Severe" | "Reverse stress";
  retailRunOff: number;
  corporateRunOff: number;
  wholesaleWithdrawal: number;
  undrawnDrawdown: number;
  hqlaHaircut: number;
  fxDevaluation: number;
  rateShockBps: number;
  inflowRate: number;
  dynamic: boolean;
  dynRetailAdd: number;
  dynCorporateAdd: number;
  dynHaircutAdd: number;
};

export const BANDS: Record<StressAssumptions["band"], Omit<StressAssumptions, "band" | "dynamic" | "dynRetailAdd" | "dynCorporateAdd" | "dynHaircutAdd">> = {
  "Business as usual": { retailRunOff: 3, corporateRunOff: 8, wholesaleWithdrawal: 10, undrawnDrawdown: 5, hqlaHaircut: 2, fxDevaluation: 0, rateShockBps: 0, inflowRate: 90 },
  Adverse: { retailRunOff: 10, corporateRunOff: 25, wholesaleWithdrawal: 40, undrawnDrawdown: 20, hqlaHaircut: 8, fxDevaluation: 20, rateShockBps: 200, inflowRate: 60 },
  Severe: { retailRunOff: 18, corporateRunOff: 40, wholesaleWithdrawal: 75, undrawnDrawdown: 40, hqlaHaircut: 15, fxDevaluation: 45, rateShockBps: 400, inflowRate: 40 },
  "Reverse stress": { retailRunOff: 30, corporateRunOff: 55, wholesaleWithdrawal: 100, undrawnDrawdown: 60, hqlaHaircut: 20, fxDevaluation: 60, rateShockBps: 600, inflowRate: 25 },
};

/** §6.8.4 dynamic adjustment derived from the macro/sector-cycle engine (§6.6.7) — demo signal. */
export const DYNAMIC_SIGNAL = {
  sector: "Oil & gas — upstream",
  phase: "Contraction",
  justification:
    "Sector-cycle engine (§6.6.7) shows a contraction phase in Oil & gas — upstream, where the bank's corporate depositor base is concentrated (21% of corporate deposits).",
  retailAdd: 2,
  corporateAdd: 6,
  haircutAdd: 3,
};

export type StressResult = {
  lcr: number;
  survivalDays: number | null;
  minBuffer: number;
  outflows30: number;
  buffer0: number;
  path: { day: number; buffer: number }[];
};

const HORIZON = 90;

export function runLiquidityStress(bs: BalanceSheet, hqla: number, a: StressAssumptions): StressResult {
  const retail = a.retailRunOff + (a.dynamic ? a.dynRetailAdd : 0);
  const corporate = a.corporateRunOff + (a.dynamic ? a.dynCorporateAdd : 0);
  const haircut = a.hqlaHaircut + (a.dynamic ? a.dynHaircutAdd : 0);
  const fgnShare = 9.3 / (3.4 + 6.1 + 16.8 + 9.3 + 1.9);
  const rateLoss = hqla * fgnShare * 4 * (a.rateShockBps / 10000); // FGN bond MTM loss, 4-year duration (demo)
  const buffer0 = hqla * (1 - haircut / 100) - rateLoss;
  const dep = (id: string) => (FUNDING_MIX.find((f) => f.id === id)!.pct / 100) * bs.deposits;
  const fcyUplift = 1 + (0.17 * a.fxDevaluation) / 100; // FCY deposits revalue in naira
  const runOff30 = (dep("retail") * retail + dep("corporate") * corporate + (dep("interbank") + dep("wholesale")) * a.wholesaleWithdrawal) / 100;
  const drawdown30 = (bs.undrawn * a.undrawnDrawdown) / 100;
  const inflowDaily = ((bs.totalLoans * 0.045) / 30) * (a.inflowRate / 100);
  const cumOut = (t: number) => {
    const front = Math.min(1, t / 30) ** 0.7;
    const tail = t > 30 ? (0.45 * (t - 30)) / 60 : 0;
    return (runOff30 * fcyUplift + drawdown30) * (front + tail);
  };
  const path: { day: number; buffer: number }[] = [];
  let survival: number | null = null;
  let minBuffer = buffer0;
  for (let t = 0; t <= HORIZON; t++) {
    const b = buffer0 + inflowDaily * t - cumOut(t);
    if (b < minBuffer) minBuffer = b;
    if (survival === null && b < 0) survival = t;
    path.push({ day: t, buffer: b });
  }
  const outflows30 = cumOut(30);
  const inflows30 = Math.min(inflowDaily * 30, 0.75 * outflows30);
  return { lcr: (buffer0 / Math.max(1, outflows30 - inflows30)) * 100, survivalDays: survival, minBuffer, outflows30, buffer0, path };
}

/** Reverse stress: the retail + corporate run-off multiplier at which survival falls below the target. */
export function reverseStress(bs: BalanceSheet, hqla: number, base: StressAssumptions, targetDays: number) {
  let lo = 0.1;
  let hi = 6;
  const survives = (k: number) => {
    const r = runLiquidityStress(bs, hqla, { ...base, retailRunOff: base.retailRunOff * k, corporateRunOff: base.corporateRunOff * k });
    return r.survivalDays === null || r.survivalDays >= targetDays;
  };
  if (!survives(lo)) return { retail: base.retailRunOff * lo, corporate: base.corporateRunOff * lo };
  if (survives(hi)) return null;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (survives(mid)) lo = mid;
    else hi = mid;
  }
  return { retail: round(base.retailRunOff * lo, 1), corporate: round(base.corporateRunOff * lo, 1) };
}

// ---------------------------------------------------------------- limit breaches (§6.8, §6.4.4)

export type BreachLevel = "Market Risk Analyst" | "Head of Risk" | "CRO" | "Board Risk Committee";
export const ESCALATION: BreachLevel[] = ["Market Risk Analyst", "Head of Risk", "CRO", "Board Risk Committee"];

export type Breach = {
  id: string;
  at: string;
  metric: string;
  desk: string;
  actual: string;
  limit: string;
  utilisation: number;
  level: BreachLevel;
  status: "Open" | "Escalated" | "Closed";
  note?: string;
};

export const seedBreaches: Breach[] = [
  {
    id: "BR-2611-04",
    at: "2026-11-09T16:40:00+01:00",
    metric: "VaR limit utilisation",
    desk: "FX trading desk",
    actual: "103%",
    limit: "100%",
    utilisation: 103,
    level: "Market Risk Analyst",
    status: "Open",
  },
  {
    id: "BR-2611-02",
    at: "2026-11-04T11:15:00+01:00",
    metric: "NOP — USD intraday",
    desk: "FX trading desk",
    actual: "16.2% of capital",
    limit: "15%",
    utilisation: 108,
    level: "Head of Risk",
    status: "Escalated",
    note: "Customer import LC settlement; position squared next morning.",
  },
  {
    id: "BR-2610-11",
    at: "2026-10-22T14:05:00+01:00",
    metric: "Stop-loss trigger",
    desk: "Investment book (FVOCI)",
    actual: "₦ loss 61% of trigger",
    limit: "Early warning 60%",
    utilisation: 61,
    level: "Market Risk Analyst",
    status: "Closed",
    note: "Bond yields retraced; position reviewed by ALCO.",
  },
  {
    id: "BR-2610-03",
    at: "2026-10-03T09:30:00+01:00",
    metric: "Interbank spread",
    desk: "Money market",
    actual: "2.9 pp",
    limit: "2.5 pp (tenant)",
    utilisation: 116,
    level: "Head of Risk",
    status: "Closed",
    note: "Month-end liquidity squeeze; normalised within 2 days.",
  },
];
