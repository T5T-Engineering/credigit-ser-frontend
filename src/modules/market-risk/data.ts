/**
 * Market & Liquidity Risk (PRD §6.8) — prototype data and calculations.
 *
 * Balances are derived from the shared loan book (via the IFRS 9 engine's NGN-equivalent EAD rows) and the
 * demo capital base, so figures stay consistent across modules. Limits, thresholds, run-off rates, factors
 * and stress severities are BUSINESS RULES (src/modules/market-risk/platform.ts) read with `getRule` at call
 * time. Treasury positions, the deposit ledger and market data are DEMO values standing in for the
 * CBA/Treasury connectors (TD-126). Formulas are as stated in PRD §6.8.1–§6.8.4.
 */
import { Faker, en, en_NG } from "@faker-js/faker";
import { DEMO_NOW } from "@/lib/data/seed";
import { getRule } from "@/lib/platform/rules";
import { usdNgn, type EclRow } from "../ifrs9/data";
import { round, sum } from "../ifrs9/common";

const num = (key: string) => getRule<number>(`market-risk.${key}`);
const frac = (key: string) => num(key) / 100;

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

/** Demo calibration of the deposit ledger until the CBA deposit connector is live (TECH-DEBT: market-risk demo calibrations). */
const DEMO_GROSS_LDR = 0.71;
const DEMO_FCY_DEPOSIT_SHARE = 0.17;

export function balanceSheet(rows: EclRow[], capital: number): BalanceSheet {
  const totalLoans = sum(rows.map((r) => r.outstanding));
  const qualifyingLoans = sum(rows.filter((r) => r.obligor?.type === "SME" || r.obligor?.type === "Retail" || r.facility.product === "Mortgage").map((r) => r.outstanding));
  const fcyLoans = sum(rows.filter((r) => r.facility.currency === "USD").map((r) => r.outstanding));
  const deposits = totalLoans / DEMO_GROSS_LDR;
  const undrawn = sum(rows.map((r) => Math.max(0, r.facility.approvedAmount - r.outstanding)));
  return { totalLoans, qualifyingLoans, fcyLoans, deposits, fcyDeposits: deposits * DEMO_FCY_DEPOSIT_SHARE, capital, undrawn };
}

// ---------------------------------------------------------------- FX & NOP (§6.8.1)

export const FX_CCYS = ["USD", "EUR", "GBP", "CNY"] as const;
export type Ccy = (typeof FX_CCYS)[number];

/** 12 months of FX rates (demo market-data feed); USD spot comes from the IFRS 9 spot-rate rule. */
export function fxRates(): { ccy: Ccy; spot: number; history: number[] }[] {
  const usd = usdNgn();
  return [
    { ccy: "USD", spot: usd, history: [1468, 1474, 1490, 1502, 1497, 1505, 1511, 1509, 1520, 1526, 1531, usd] },
    { ccy: "EUR", spot: 1668, history: [1590, 1596, 1611, 1622, 1618, 1630, 1641, 1638, 1652, 1657, 1662, 1668] },
    { ccy: "GBP", spot: 1972, history: [1890, 1902, 1915, 1931, 1922, 1936, 1944, 1940, 1956, 1961, 1966, 1972] },
    { ccy: "CNY", spot: 214, history: [204, 205, 207, 208, 208, 209, 210, 210, 212, 213, 213, 214] },
  ];
}
export const MONTHS = ["Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];

export const nopLimitPct = () => num("nopLimitPct");
export const limitWarning = () => frac("limitWarningPct");

export type FxPosition = { ccy: Ccy; spot: number; longFcy: number; shortFcy: number; netFcy: number; longNgn: number; shortNgn: number; netNgn: number; limitPct: number };

export function fxPositions(capital: number): FxPosition[] {
  // Net positions as a share of capital (demo Treasury feed), gross long/short around them.
  const spec: { ccy: Ccy; netPct: number; gross: number }[] = [
    { ccy: "USD", netPct: 9.4, gross: 1.9 },
    { ccy: "EUR", netPct: -2.1, gross: 0.35 },
    { ccy: "GBP", netPct: 1.3, gross: 0.22 },
    { ccy: "CNY", netPct: 0.6, gross: 0.08 },
  ];
  const rates = fxRates();
  return spec.map((s) => {
    const rate = rates.find((r) => r.ccy === s.ccy)!.spot;
    const netNgn = (capital * s.netPct) / 100;
    const longNgn = capital * s.gross * 0.5 + Math.max(0, netNgn);
    const shortNgn = longNgn - netNgn;
    return { ccy: s.ccy, spot: rate, longFcy: longNgn / rate, shortFcy: shortNgn / rate, netFcy: netNgn / rate, longNgn, shortNgn, netNgn, limitPct: num(`nopLimitPct.${s.ccy}`) };
  });
}

// ---------------------------------------------------------------- VaR & stop-loss (§6.8.1)

export const DESK_IDS = ["FX", "FI", "MM", "INV"] as const;
export type DeskId = (typeof DESK_IDS)[number];
export type Desk = { id: DeskId; name: string; varNgn: number; limitNgn: number; mtmLossNgn: number; stopLossNgn: number; method: string };

export function desks(capital: number): Desk[] {
  // VaR and MTM loss are demo Treasury-feed values (share of capital); limits and triggers are business rules.
  const feed: { id: DeskId; name: string; varPct: number; mtmPct: number; method: string }[] = [
    { id: "FX", name: "FX trading desk", varPct: 0.31, mtmPct: 0.11, method: "Historical simulation" },
    { id: "FI", name: "Fixed income — trading", varPct: 0.42, mtmPct: 0.19, method: "Historical simulation" },
    { id: "MM", name: "Money market", varPct: 0.09, mtmPct: 0, method: "Parametric (variance-covariance)" },
    { id: "INV", name: "Investment book (FVOCI)", varPct: 0.58, mtmPct: 0.36, method: "Historical simulation" },
  ];
  return feed.map((d) => ({
    id: d.id,
    name: d.name,
    method: d.method,
    varNgn: (capital * d.varPct) / 100,
    mtmLossNgn: (capital * d.mtmPct) / 100,
    limitNgn: capital * frac(`varLimitPct.${d.id}`),
    stopLossNgn: capital * frac(`stopLossPct.${d.id}`),
  }));
}

/** 20 business days of total VaR as % of limit (deterministic demo feed). */
export const VAR_TREND = [71, 74, 69, 73, 78, 80, 77, 83, 85, 82, 86, 88, 84, 87, 90, 93, 89, 92, 95, 94];

/** RAG for a utilisation ratio (1 = at limit) using the limit-warning rule. */
export function utilisationTone(u: number): "danger" | "warning" | "success" {
  return u >= 1 ? "danger" : u >= limitWarning() ? "warning" : "success";
}

// ---------------------------------------------------------------- repricing gap, NII & EVE (§6.8.1)

export const REPRICING_BUCKETS = [
  { id: "0-1m", label: "0–1m", mid: 0.5, dur: 0.04, maxMonths: 1 },
  { id: "1-3m", label: "1–3m", mid: 2, dur: 0.16, maxMonths: 3 },
  { id: "3-6m", label: "3–6m", mid: 4.5, dur: 0.36, maxMonths: 6 },
  { id: "6-12m", label: "6–12m", mid: 9, dur: 0.71, maxMonths: 12 },
  { id: "1-5y", label: "1–5y", mid: 36, dur: 2.5, maxMonths: 60 },
  { id: ">5y", label: "> 5y", mid: 84, dur: 6, maxMonths: Number.POSITIVE_INFINITY },
];

export type GapRow = { bucket: string; rsa: number; rsl: number; gap: number; cumulative: number };

export function repricingGap(rows: EclRow[], bs: BalanceSheet): GapRow[] {
  const loans = REPRICING_BUCKETS.map(() => 0);
  for (const r of rows) {
    const floating = r.facility.product === "Overdraft" || r.facility.product === "Revolving credit";
    const months = floating ? 0.5 : (new Date(r.facility.maturityDate).getTime() - DEMO_NOW.getTime()) / (30.4 * 864e5);
    const idx = REPRICING_BUCKETS.findIndex((b) => months <= b.maxMonths);
    loans[idx] = (loans[idx] ?? 0) + r.outstanding;
  }
  // Demo treasury/deposit repricing profile (TECH-DEBT: market-risk demo calibrations).
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

export const irrbbShock = () => num("irrbbShockBps");
export const irrbbLadder = () => getRule<string[]>("market-risk.irrbbShockLadderBps").map(Number).filter(Number.isFinite);

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
export const interbankSpreadLimit = () => num("interbankSpreadLimitPp");

// ---------------------------------------------------------------- liquidity (§6.8.2)

export const liquidityRatioMin = () => num("liquidityRatioMinPct");
export const lcrFloor = () => num("lcrFloorPct");
export const nsfrFloor = () => num("nsfrFloorPct");
export const ldrMin = () => num("ldrMinPct");
export const ratioWarningMargin = () => frac("ratioWarningMarginPct");

/** Liquid-asset holdings as % of deposits (demo treasury ledger). */
export const LIQUID_ASSETS = [
  { id: "cash", label: "Cash", pctOfDeposits: 3.4, hqla: "Level 1" },
  { id: "cbn", label: "Balances with CBN", pctOfDeposits: 6.1, hqla: "Level 1" },
  { id: "tbills", label: "Treasury bills / certificates", pctOfDeposits: 16.8, hqla: "Level 1" },
  { id: "interbank", label: "Interbank placements", pctOfDeposits: 5.2, hqla: "Not HQLA" },
  { id: "fgn", label: "FGN bonds", pctOfDeposits: 9.3, hqla: "Level 1" },
  { id: "stab", label: "Stabilisation securities", pctOfDeposits: 1.9, hqla: "Level 1" },
];

export const FUNDING_IDS = ["retail", "corporate", "interbank", "wholesale"] as const;
export type FundingId = (typeof FUNDING_IDS)[number];
/** Funding mix (demo deposit ledger) with run-off and ASF factors from business rules. */
export function fundingMix(): { id: FundingId; label: string; pct: number; runOff: number; asf: number }[] {
  const mix: { id: FundingId; label: string; pct: number }[] = [
    { id: "retail", label: "Retail", pct: 47 },
    { id: "corporate", label: "Corporate", pct: 33 },
    { id: "interbank", label: "Interbank", pct: 8 },
    { id: "wholesale", label: "Wholesale / market funding", pct: 12 },
  ];
  return mix.map((m) => ({ ...m, runOff: num(`runOffPct.${m.id}`), asf: frac(`asfPct.${m.id}`) }));
}

export function liquidityMetrics(bs: BalanceSheet) {
  const mix = fundingMix();
  const liquid = sum(LIQUID_ASSETS.map((a) => (a.pctOfDeposits / 100) * bs.deposits));
  const hqla = sum(LIQUID_ASSETS.filter((a) => a.hqla === "Level 1").map((a) => (a.pctOfDeposits / 100) * bs.deposits));
  const outflows = sum(mix.map((f) => (f.pct / 100) * bs.deposits * (f.runOff / 100))) + bs.undrawn * frac("undrawnOutflowPct");
  const inflows = Math.min(bs.totalLoans * frac("monthlyRepaymentPct") * frac("lcrInflowRecognitionPct") + frac("interbankInflowPct") * bs.deposits, frac("inflowCapPct") * outflows);
  const netOutflows = outflows - inflows;
  const asf = bs.capital + sum(mix.map((f) => (f.pct / 100) * bs.deposits * f.asf));
  const rsf = bs.totalLoans * frac("rsfLoansPct") + hqla * frac("rsfHqlaPct") + bs.deposits * frac("rsfOtherPct");
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
    ldrWeighted: ((bs.totalLoans + frac("ldrQualifyingUpliftPct") * bs.qualifyingLoans) / bs.deposits) * 100,
  };
}

export const LADDER = ["≤ 7d", "8d–1m", "1–3m", "3–6m", "6–12m", "1–3y", "> 3y"];

export function maturityLadder(bs: BalanceSheet, liquid: number) {
  // Demo contractual maturity profile (TECH-DEBT: market-risk demo calibrations).
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
  const scale = (bs.deposits * 0.36) / sum(raw); // top 200 ≈ 36% of deposits
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

export const concentrationCutoffs = () =>
  getRule<string[]>("market-risk.concentrationCutoffs")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);

export type EarlyWarning = { id: string; trigger: string; threshold: string; limit: number; current: number; unit: string; status: "green" | "amber" | "red" };

/** Illiquidity early-warning triggers per CBN 3.13(c); thresholds are rules, current counters are demo values. */
export function earlyWarnings(): EarlyWarning[] {
  const watch = frac("ew.watchPct");
  const takerPct = num("ew.interbankTakerPct");
  const spec = [
    { id: "EW1", trigger: "CBN current account overdrawn and uncovered", limit: num("ew.overdrawnDays"), threshold: (n: number) => `${n} consecutive working days`, current: 0 },
    { id: "EW2", trigger: "Clearing-operation deficit", limit: num("ew.clearingDeficitDays"), threshold: (n: number) => `${n} consecutive days`, current: 1 },
    { id: "EW3", trigger: "Unable to pay maturing obligations", limit: num("ew.unableToPayDays"), threshold: (n: number) => `${n} consecutive days`, current: 0 },
    {
      id: "EW4",
      trigger: `Net taker of interbank deposits ≥ ${takerPct}% of total deposits`,
      limit: num("ew.interbankTakerDays"),
      threshold: (n: number) => `${n} consecutive days`,
      current: 34,
    },
  ];
  return spec.map((s) => ({
    id: s.id,
    trigger: s.trigger,
    threshold: s.threshold(s.limit),
    limit: s.limit,
    current: s.current,
    unit: "days",
    status: s.current >= s.limit ? "red" : s.current >= s.limit * watch ? "amber" : "green",
  }));
}

// ---------------------------------------------------------------- liquidity stress testing (§6.8.2, §6.8.4)

export type BandName = "Business as usual" | "Adverse" | "Severe" | "Reverse stress";
export const STRESS_BANDS = [
  { id: "bau", label: "Business as usual" },
  { id: "adverse", label: "Adverse" },
  { id: "severe", label: "Severe" },
  { id: "reverse", label: "Reverse stress" },
] as const satisfies readonly { id: string; label: BandName }[];

export const STRESS_FIELDS = [
  { key: "retailRunOff", label: "Retail deposit run-off", suffix: "%", hint: "30-day stressed outflow" },
  { key: "corporateRunOff", label: "Corporate deposit run-off", suffix: "%", hint: "30-day stressed outflow" },
  { key: "wholesaleWithdrawal", label: "Wholesale / interbank withdrawal", suffix: "%", hint: "Non-renewal of market funding" },
  { key: "undrawnDrawdown", label: "Undrawn-facility drawdown surge", suffix: "%", hint: "Of undrawn commitments" },
  { key: "hqlaHaircut", label: "HQLA haircut", suffix: "%", hint: "Market-liquidity discount" },
  { key: "fxDevaluation", label: "FX devaluation", suffix: "%", hint: "Naira depreciation vs USD" },
  { key: "rateShockBps", label: "Interest-rate shock", suffix: "bps", hint: "Parallel shift" },
  { key: "inflowRate", label: "Contractual inflow rate", suffix: "%", hint: "Share of loan repayments received" },
] as const;
export type StressField = (typeof STRESS_FIELDS)[number]["key"];

export type StressAssumptions = Record<StressField, number> & {
  band: BandName;
  dynamic: boolean;
  dynRetailAdd: number;
  dynCorporateAdd: number;
  dynHaircutAdd: number;
};

/** Severity-band assumptions from business rules. */
export function bandAssumptions(band: BandName): Record<StressField, number> {
  const id = STRESS_BANDS.find((b) => b.label === band)!.id;
  return Object.fromEntries(STRESS_FIELDS.map((f) => [f.key, num(`stress.${id}.${f.key}`)])) as Record<StressField, number>;
}

/** §6.8.4 dynamic adjustment derived from the macro/sector-cycle engine (§6.6.7) — demo signal; add-ons are rules. */
export function dynamicSignal() {
  return {
    sector: "Oil & gas — upstream",
    phase: "Contraction",
    justification:
      "Sector-cycle engine shows a contraction phase in Oil & gas — upstream, where the bank's corporate depositor base is concentrated (21% of corporate deposits).",
    retailAdd: num("dyn.retailAddPp"),
    corporateAdd: num("dyn.corporateAddPp"),
    haircutAdd: num("dyn.haircutAddPp"),
  };
}

export function defaultAssumptions(band: BandName = "Adverse"): StressAssumptions {
  const sig = dynamicSignal();
  return { band, ...bandAssumptions(band), dynamic: false, dynRetailAdd: sig.retailAdd, dynCorporateAdd: sig.corporateAdd, dynHaircutAdd: sig.haircutAdd };
}

export type StressResult = {
  lcr: number;
  survivalDays: number | null;
  minBuffer: number;
  outflows30: number;
  buffer0: number;
  horizon: number;
  path: { day: number; buffer: number }[];
};

export const stressHorizon = () => num("stress.horizonDays");

export function runLiquidityStress(bs: BalanceSheet, hqla: number, a: StressAssumptions): StressResult {
  const horizon = stressHorizon();
  const frontExp = num("stress.frontLoadExponent");
  const tailPct = frac("stress.tailRunOffPct");
  const retail = a.retailRunOff + (a.dynamic ? a.dynRetailAdd : 0);
  const corporate = a.corporateRunOff + (a.dynamic ? a.dynCorporateAdd : 0);
  const haircut = a.hqlaHaircut + (a.dynamic ? a.dynHaircutAdd : 0);
  const level1 = LIQUID_ASSETS.filter((x) => x.hqla === "Level 1");
  const fgnShare = (LIQUID_ASSETS.find((x) => x.id === "fgn")?.pctOfDeposits ?? 0) / sum(level1.map((x) => x.pctOfDeposits));
  const rateLoss = hqla * fgnShare * num("stress.fgnDurationYears") * (a.rateShockBps / 10000); // FGN bond MTM loss
  const buffer0 = hqla * (1 - haircut / 100) - rateLoss;
  const mix = fundingMix();
  const dep = (id: FundingId) => (mix.find((f) => f.id === id)!.pct / 100) * bs.deposits;
  const fcyUplift = 1 + ((bs.fcyDeposits / bs.deposits) * a.fxDevaluation) / 100; // FCY deposits revalue in naira
  const runOff30 = (dep("retail") * retail + dep("corporate") * corporate + (dep("interbank") + dep("wholesale")) * a.wholesaleWithdrawal) / 100;
  const drawdown30 = (bs.undrawn * a.undrawnDrawdown) / 100;
  const inflowDaily = ((bs.totalLoans * frac("monthlyRepaymentPct")) / 30) * (a.inflowRate / 100);
  const tailDays = Math.max(1, horizon - 30);
  const cumOut = (t: number) => {
    const front = Math.min(1, t / 30) ** frontExp;
    const tail = t > 30 ? (tailPct * (t - 30)) / tailDays : 0;
    return (runOff30 * fcyUplift + drawdown30) * (front + tail);
  };
  const path: { day: number; buffer: number }[] = [];
  let survival: number | null = null;
  let minBuffer = buffer0;
  for (let t = 0; t <= horizon; t++) {
    const b = buffer0 + inflowDaily * t - cumOut(t);
    if (b < minBuffer) minBuffer = b;
    if (survival === null && b < 0) survival = t;
    path.push({ day: t, buffer: b });
  }
  const outflows30 = cumOut(30);
  const inflows30 = Math.min(inflowDaily * 30, frac("inflowCapPct") * outflows30);
  return { lcr: (buffer0 / Math.max(1, outflows30 - inflows30)) * 100, survivalDays: survival, minBuffer, outflows30, buffer0, horizon, path };
}

/** Reverse stress: the retail + corporate run-off multiplier at which survival falls below the target. */
export function reverseStress(bs: BalanceSheet, hqla: number, base: StressAssumptions, targetDays: number) {
  let lo = 0.1;
  let hi = num("stress.reverseMaxMultiplier");
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

export type Breach = {
  id: string;
  at: string;
  metric: string;
  desk: string;
  actual: string;
  limit: string;
  utilisation: number;
  /** Role the breach currently sits with on the §6.4.4 escalation ladder (rule market-risk.escalationRoles). */
  levelRole: string;
  status: "Open" | "Escalated" | "Closed";
  note?: string;
  raisedBy?: string;
  closedBy?: string;
  closedAt?: string;
};

export const escalationRoles = () => getRule<string[]>("market-risk.escalationRoles");

export const seedBreaches: Breach[] = [
  {
    id: "BR-2611-04",
    at: "2026-11-09T16:40:00+01:00",
    metric: "VaR limit utilisation",
    desk: "FX trading desk",
    actual: "103%",
    limit: "100%",
    utilisation: 103,
    levelRole: "market-risk-analyst",
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
    levelRole: "head-of-risk",
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
    levelRole: "market-risk-analyst",
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
    levelRole: "head-of-risk",
    status: "Closed",
    note: "Month-end liquidity squeeze; normalised within 2 days.",
  },
];
