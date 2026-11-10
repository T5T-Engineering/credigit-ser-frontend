/**
 * Credit Analysis module data — deterministic demo generators (no backend yet).
 *
 * - NGX Historical Sector Financials Corpus (PRD §6.2.8): 15 financial years per NGX sector classification,
 *   with the tenant-sector → NGX-sector mapping and the Industry Life-Cycle classification.
 * - Macro-economic snapshot used by the West cardinal point (§6.2.4).
 * - Other-bank statement / bureau per-bank data for Share of Business Wallet (§6.2.9).
 *
 * All figures are fictional demo data. BACKEND SEAM: replace these generators with API reads
 * (External Data Feeds layer §5.5, Other-bank statements connector §5.3, Bureau/CRMS connector §5.2).
 */
import { getRule } from "@/lib/platform/rules";
import type { CorpusMetricKey } from "./parameters";

// ---------------- Deterministic random ----------------

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG seeded from a string. */
export function rngFor(key: string): () => number {
  let a = hashString(key);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// ---------------- NGX corpus ----------------

export type LifeCycleStage = "Introduction" | "Growth" | "Maturity" | "Decline";

export const corpusMetrics: {
  key: CorpusMetricKey;
  label: string;
  unit: "%" | "x" | "days";
  higherIsBetter: boolean;
  digits: number;
}[] = [
  {
    key: "realRevenueGrowth",
    label: "Real revenue growth",
    unit: "%",
    higherIsBetter: true,
    digits: 1,
  },
  {
    key: "grossMargin",
    label: "Gross margin",
    unit: "%",
    higherIsBetter: true,
    digits: 1,
  },
  {
    key: "netMargin",
    label: "Net margin",
    unit: "%",
    higherIsBetter: true,
    digits: 1,
  },
  {
    key: "roa",
    label: "Return on assets",
    unit: "%",
    higherIsBetter: true,
    digits: 1,
  },
  {
    key: "currentRatio",
    label: "Current ratio",
    unit: "x",
    higherIsBetter: true,
    digits: 2,
  },
  {
    key: "debtToAssets",
    label: "Debt / total assets",
    unit: "%",
    higherIsBetter: false,
    digits: 1,
  },
  {
    key: "interestCover",
    label: "Interest cover",
    unit: "x",
    higherIsBetter: true,
    digits: 2,
  },
  {
    key: "cashConversionDays",
    label: "Cash conversion cycle",
    unit: "days",
    higherIsBetter: false,
    digits: 0,
  },
];
export const corpusMetricByKey = Object.fromEntries(corpusMetrics.map((m) => [m.key, m])) as Record<CorpusMetricKey, (typeof corpusMetrics)[number]>;

export function formatMetric(key: CorpusMetricKey, v: number): string {
  const m = corpusMetricByKey[key];
  if (Math.abs(v) < 0.5 / 10 ** m.digits) v = 0;
  const s = v.toLocaleString("en-NG", {
    minimumFractionDigits: m.digits,
    maximumFractionDigits: m.digits,
  });
  return m.unit === "%" ? `${s}%` : m.unit === "x" ? `${s}x` : `${s} days`;
}

type SectorProfile = {
  id: string;
  name: string;
  companies: number;
  /** Real revenue growth early (FY2011) → late (FY2025), % */
  growth: [number, number];
  grossMargin: number;
  netMargin: number;
  /** Net-margin drift per year, pp. */
  marginDrift: number;
  roa: number;
  currentRatio: number;
  debtToAssets: number;
  interestCover: number;
  cashConversionDays: number;
  /** Dispersion multiplier for quartile bands. */
  spread: number;
};

const ngxProfiles: SectorProfile[] = [
  {
    id: "NGX-AGR",
    name: "Agriculture",
    companies: 6,
    growth: [3, 6.2],
    grossMargin: 31,
    netMargin: 9.5,
    marginDrift: 0.15,
    roa: 6.8,
    currentRatio: 1.35,
    debtToAssets: 41,
    interestCover: 3.6,
    cashConversionDays: 118,
    spread: 1.2,
  },
  {
    id: "NGX-CNG",
    name: "Conglomerates",
    companies: 6,
    growth: [2.5, 1.4],
    grossMargin: 24,
    netMargin: 4.2,
    marginDrift: -0.05,
    roa: 3.1,
    currentRatio: 1.18,
    debtToAssets: 52,
    interestCover: 2.1,
    cashConversionDays: 96,
    spread: 1.0,
  },
  {
    id: "NGX-CRE",
    name: "Construction / Real Estate",
    companies: 9,
    growth: [4, -2.6],
    grossMargin: 22,
    netMargin: 3.1,
    marginDrift: -0.32,
    roa: 1.6,
    currentRatio: 1.05,
    debtToAssets: 58,
    interestCover: 1.4,
    cashConversionDays: 172,
    spread: 1.4,
  },
  {
    id: "NGX-CSG",
    name: "Consumer Goods",
    companies: 20,
    growth: [4.5, 1.1],
    grossMargin: 29,
    netMargin: 5.4,
    marginDrift: -0.12,
    roa: 5.2,
    currentRatio: 1.02,
    debtToAssets: 49,
    interestCover: 2.8,
    cashConversionDays: 64,
    spread: 1.0,
  },
  {
    id: "NGX-FIN",
    name: "Financial Services",
    companies: 48,
    growth: [3.2, 5.4],
    grossMargin: 58,
    netMargin: 18.5,
    marginDrift: 0.2,
    roa: 2.4,
    currentRatio: 1.12,
    debtToAssets: 82,
    interestCover: 2.4,
    cashConversionDays: 22,
    spread: 1.1,
  },
  {
    id: "NGX-HLT",
    name: "Healthcare",
    companies: 9,
    growth: [2.8, 2.1],
    grossMargin: 36,
    netMargin: 6.1,
    marginDrift: -0.04,
    roa: 4.4,
    currentRatio: 1.42,
    debtToAssets: 38,
    interestCover: 3.9,
    cashConversionDays: 131,
    spread: 1.1,
  },
  {
    id: "NGX-ICT",
    name: "ICT",
    companies: 7,
    growth: [7, 9.4],
    grossMargin: 47,
    netMargin: 13.8,
    marginDrift: 0.18,
    roa: 9.6,
    currentRatio: 1.21,
    debtToAssets: 46,
    interestCover: 5.8,
    cashConversionDays: 38,
    spread: 1.3,
  },
  {
    id: "NGX-IND",
    name: "Industrial Goods",
    companies: 11,
    growth: [5, 2.6],
    grossMargin: 38,
    netMargin: 11.2,
    marginDrift: 0.05,
    roa: 8.1,
    currentRatio: 1.31,
    debtToAssets: 36,
    interestCover: 6.2,
    cashConversionDays: 84,
    spread: 1.0,
  },
  {
    id: "NGX-NAT",
    name: "Natural Resources",
    companies: 4,
    growth: [2, 10.8],
    grossMargin: 33,
    netMargin: 7.4,
    marginDrift: 0.3,
    roa: 5.0,
    currentRatio: 1.26,
    debtToAssets: 44,
    interestCover: 3.2,
    cashConversionDays: 102,
    spread: 1.5,
  },
  {
    id: "NGX-OAG",
    name: "Oil and Gas",
    companies: 10,
    growth: [3.5, 0.9],
    grossMargin: 21,
    netMargin: 4.8,
    marginDrift: -0.08,
    roa: 4.1,
    currentRatio: 1.08,
    debtToAssets: 55,
    interestCover: 2.6,
    cashConversionDays: 58,
    spread: 1.3,
  },
  {
    id: "NGX-SVC",
    name: "Services",
    companies: 18,
    growth: [3, 3.1],
    grossMargin: 34,
    netMargin: 5.8,
    marginDrift: 0.02,
    roa: 4.6,
    currentRatio: 1.15,
    debtToAssets: 47,
    interestCover: 3.0,
    cashConversionDays: 71,
    spread: 1.2,
  },
  {
    id: "NGX-UTL",
    name: "Utilities",
    companies: 3,
    growth: [1, 11.5],
    grossMargin: 28,
    netMargin: 8.9,
    marginDrift: 0.25,
    roa: 4.9,
    currentRatio: 1.1,
    debtToAssets: 57,
    interestCover: 2.3,
    cashConversionDays: 92,
    spread: 1.4,
  },
];

/**
 * Tenant sector → nearest NGX sector classification(s) (§6.2.8). `null` = no listed proxy.
 * `primary` is the DEFAULT of business rule `credit-analysis.ngxMapping.<sectorId>` — read it with `ngxPrimaryFor()`.
 */
export const sectorMapping: Record<string, { primary: string | null; secondary?: string; note?: string }> = {
  "SEC-AGR": { primary: "NGX-AGR" },
  "SEC-MIN": { primary: "NGX-NAT" },
  "SEC-MFG": { primary: "NGX-IND", secondary: "NGX-CSG" },
  "SEC-OGU": { primary: "NGX-OAG", secondary: "NGX-NAT" },
  "SEC-OGD": { primary: "NGX-OAG" },
  "SEC-PWR": { primary: "NGX-UTL" },
  "SEC-CON": { primary: "NGX-CRE", secondary: "NGX-IND" },
  "SEC-RES": { primary: "NGX-CRE" },
  "SEC-COM": { primary: "NGX-SVC", secondary: "NGX-CSG" },
  "SEC-TRN": { primary: "NGX-SVC" },
  "SEC-ICT": { primary: "NGX-ICT" },
  "SEC-FIN": { primary: "NGX-FIN" },
  "SEC-EDU": {
    primary: "NGX-SVC",
    note: "Thin listed proxy — analyst research note weighted more heavily.",
  },
  "SEC-HLT": { primary: "NGX-HLT" },
  "SEC-GOV": {
    primary: null,
    note: "No NGX-listed proxy for public-sector obligors — Operating Industry Assessment relies on analyst research notes and NBS data.",
  },
};

/** Quarterly 360 RAR refresh points shown in trend views (oldest first; last = current). */
export const REFRESH_LABELS = ["Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"];

export const CORPUS_YEARS = Array.from({ length: 15 }, (_, i) => 2011 + i);
export const CORPUS_VERSION = "NGX-SFC v2026.2";
export const CORPUS_REFRESHED = "2026-07-31";

export type CorpusYear = { year: number } & Record<CorpusMetricKey, number>;

/** Economy-wide shocks (recession 2016, COVID 2020, FX unification 2023–24) applied to every sector. */
const shock: Record<number, { growth: number; margin: number }> = {
  2015: { growth: -1.5, margin: -0.5 },
  2016: { growth: -5, margin: -1.8 },
  2017: { growth: -1.5, margin: -0.6 },
  2020: { growth: -4.5, margin: -1.4 },
  2023: { growth: -1, margin: -2.2 },
  2024: { growth: -0.5, margin: -1.2 },
};

export type NgxSector = SectorProfile & {
  series: CorpusYear[];
  /** Mean real revenue growth over FY2021–FY2025. */
  trailingCagr: number;
  /** Net-margin slope over FY2021–FY2025, pp / year. */
  marginTrend: number;
  lifeCycle: LifeCycleStage;
  lifeCycleReason: string;
};

function slope(values: number[]): number {
  const n = values.length;
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    num += (i - mx) * (v - my);
    den += (i - mx) ** 2;
  });
  return den ? num / den : 0;
}

/**
 * Industry Life-Cycle classification — simulated AI trend engine (§6.2.8, §6.12). Demo rule on the trailing
 * 5-year real revenue CAGR and net-margin trend shape; the production engine and its thresholds are not set
 * by the PRD.
 */
export function classifyLifeCycle(companies: number, cagr: number, marginTrend: number): { stage: LifeCycleStage; reason: string } {
  const introMaxCompanies = getRule<number>("credit-analysis.lifeCycle.introMaxCompanies");
  const introMinCagr = getRule<number>("credit-analysis.lifeCycle.introMinCagrPct");
  const growthMinCagr = getRule<number>("credit-analysis.lifeCycle.growthMinCagrPct");
  const declineBelowCagr = getRule<number>("credit-analysis.lifeCycle.declineBelowCagrPct");
  const declineBelowMargin = getRule<number>("credit-analysis.lifeCycle.declineBelowMarginTrendPp");
  if (companies <= introMaxCompanies && cagr >= introMinCagr)
    return {
      stage: "Introduction",
      reason: `Few listed companies (${companies}) and fast real growth (${cagr.toFixed(1)}% p.a.)`,
    };
  if (cagr >= growthMinCagr)
    return {
      stage: "Growth",
      reason: `Sustained real revenue growth of ${cagr.toFixed(1)}% p.a. over five years`,
    };
  if (cagr < declineBelowCagr && marginTrend < declineBelowMargin)
    return {
      stage: "Decline",
      reason: `Real revenue contracting (${cagr.toFixed(1)}% p.a.) with net margins falling ${Math.abs(marginTrend).toFixed(2)} pp a year`,
    };
  return {
    stage: "Maturity",
    reason: `Low real growth (${cagr.toFixed(1)}% p.a.) with a ${marginTrend >= 0 ? "stable-to-rising" : "flat-to-easing"} margin trend`,
  };
}

function buildSector(p: SectorProfile): NgxSector {
  const r = rngFor(p.id);
  const noise = (a: number) => (r() * 2 - 1) * a;
  const series: CorpusYear[] = CORPUS_YEARS.map((year, i) => {
    const t = i / (CORPUS_YEARS.length - 1);
    const s = shock[year] ?? { growth: 0, margin: 0 };
    const yearsFromEnd = CORPUS_YEARS.length - 1 - i;
    const nm = p.netMargin - p.marginDrift * yearsFromEnd + s.margin + noise(0.6);
    return {
      year,
      realRevenueGrowth: round(p.growth[0] + (p.growth[1] - p.growth[0]) * t + s.growth + noise(1.1)),
      grossMargin: round(p.grossMargin - p.marginDrift * 1.3 * yearsFromEnd + s.margin * 1.4 + noise(0.9)),
      netMargin: round(nm),
      roa: round(p.roa + (nm - p.netMargin) * 0.45 + noise(0.4)),
      currentRatio: round(p.currentRatio + noise(0.06) + (s.margin < -1 ? -0.05 : 0), 2),
      debtToAssets: round(p.debtToAssets - (s.margin < -1 ? s.margin * 1.5 : 0) + noise(1.4)),
      interestCover: round(Math.max(0.6, p.interestCover + (nm - p.netMargin) * 0.35 + noise(0.25)), 2),
      cashConversionDays: Math.round(p.cashConversionDays + noise(7) - s.margin * 3),
    };
  });
  const last5 = series.slice(-5);
  const trailingCagr = round(last5.reduce((a, y) => a + y.realRevenueGrowth, 0) / 5);
  const marginTrend = round(slope(last5.map((y) => y.netMargin)), 2);
  // Life-cycle stage is classified at read time so tenant thresholds (business rules) apply immediately.
  return {
    ...p,
    series,
    trailingCagr,
    marginTrend,
    get lifeCycle() {
      return classifyLifeCycle(p.companies, trailingCagr, marginTrend).stage;
    },
    get lifeCycleReason() {
      return classifyLifeCycle(p.companies, trailingCagr, marginTrend).reason;
    },
  };
}

export const ngxSectors: NgxSector[] = ngxProfiles.map(buildSector);
export const ngxById = new Map(ngxSectors.map((s) => [s.id, s]));

/** Business-rule value meaning "no listed proxy" in `credit-analysis.ngxMapping.*`. */
export const NO_NGX_PROXY = "none";

export const ngxMappingRuleKey = (sectorId: string) => `credit-analysis.ngxMapping.${sectorId}`;

/** Primary NGX classification for a tenant sector (business rule; null = no listed proxy). */
export function ngxPrimaryFor(sectorId: string): string | null {
  if (!sectorMapping[sectorId]) return null;
  const v = getRule<string>(ngxMappingRuleKey(sectorId));
  return v && v !== NO_NGX_PROXY ? v : null;
}

export const ngxForSector = (sectorId: string): NgxSector | undefined => {
  const primary = ngxPrimaryFor(sectorId);
  return primary ? ngxById.get(primary) : undefined;
};

export const lifeCycleStages: LifeCycleStage[] = ["Introduction", "Growth", "Maturity", "Decline"];

/** Stage → Life-Cycle Stage parameter score (business rule `credit-analysis.lifeCycleScore.<stage>`). */
export const lifeCycleScore = (stage: LifeCycleStage) => getRule<number>(`credit-analysis.lifeCycleScore.${stage}`);
export const lifeCycleTone: Record<LifeCycleStage, "info" | "success" | "neutral" | "danger"> = {
  Introduction: "info",
  Growth: "success",
  Maturity: "neutral",
  Decline: "danger",
};

/** Sector distribution of a metric for one year — mean, median, quartiles, deciles (§6.2.10). */
export type Distribution = {
  mean: number;
  median: number;
  p10: number;
  q1: number;
  q3: number;
  p90: number;
  sd: number;
  n: number;
};

const spreadBase: Record<CorpusMetricKey, number> = {
  realRevenueGrowth: 4.5,
  grossMargin: 7,
  netMargin: 3.8,
  roa: 2.6,
  currentRatio: 0.28,
  debtToAssets: 9,
  interestCover: 1.4,
  cashConversionDays: 26,
};

export function sectorDistribution(sector: NgxSector, metric: CorpusMetricKey, year = 2025): Distribution {
  const y = sector.series.find((s) => s.year === year) ?? sector.series[sector.series.length - 1]!;
  const mean = y[metric];
  const sd = spreadBase[metric] * sector.spread;
  // Mild right skew for ratios bounded at zero.
  const skew = metric === "cashConversionDays" || metric === "interestCover" ? 0.12 : 0.04;
  const median = mean - sd * skew;
  const d = corpusMetricByKey[metric].digits;
  const floor = metric === "roa" || metric === "netMargin" || metric === "realRevenueGrowth" ? -Infinity : 0;
  const f = (n: number) => round(Math.max(floor, n), d);
  return {
    mean: round(mean, d),
    median: round(median, d),
    p10: f(median - 1.2816 * sd),
    q1: f(median - 0.6745 * sd),
    q3: f(median + 0.6745 * sd),
    p90: f(median + 1.2816 * sd),
    sd: round(sd, 2),
    n: sector.companies,
  };
}

/** Normal CDF (Abramowitz–Stegun) for percentile ranks. */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Percentile position of a value within the sector distribution (1–99). */
export function percentileRank(dist: Distribution, value: number): number {
  return Math.min(99, Math.max(1, Math.round(normCdf((value - dist.median) / (dist.sd || 1)) * 100)));
}

// ---------------- Macro-economic snapshot (West, §6.2.4) ----------------

export const macroSnapshot = {
  asAt: "2026-10-31",
  source: "NBS & CBN MPC data feed (demo values)",
  indicators: [
    { label: "Headline inflation (y/y)", value: "18.4%", trend: "Easing" },
    { label: "Monetary Policy Rate", value: "26.50%", trend: "Held" },
    { label: "NGN / USD (official window)", value: "₦1,538", trend: "Stable" },
    {
      label: "Real GDP growth (q/q annualised)",
      value: "3.6%",
      trend: "Improving",
    },
  ],
};

// ---------------- Share of Business Wallet (§6.2.9) ----------------

/** Fictional other banks used in the demo (other-bank statements via §5.3; per-bank breakdown via §5.2). */
const otherBanks = ["Meridian Trust Bank", "Kestrel Commercial Bank", "Atlas Union Bank", "Savanna Microfinance Bank", "Coastline Bank"];

/** Share (0–1) at or above which a wallet share counts as "high" — business rule `credit-analysis.sow.highSharePct`. */
export const walletHighThreshold = () => getRule<number>("credit-analysis.sow.highSharePct") / 100;

export type WalletPosition = "Primary Relationship" | "Untapped Lending Opportunity" | "Credit-Concentration Watch" | "Marginal Relationship";

export const walletPositionMeta: Record<
  WalletPosition,
  {
    tone: "success" | "info" | "warning" | "neutral";
    read: string;
    action: string;
  }
> = {
  "Primary Relationship": {
    tone: "success",
    read: "The bank sees most of this customer's cash flow and carries most of its borrowing; turnover data is highly reliable for ongoing monitoring and the COP Ratio confidence layer.",
    action: "Protect and deepen the relationship: relationship-based pricing, proactive review ahead of renewal, and first right of refusal on new facilities.",
  },
  "Untapped Lending Opportunity": {
    tone: "info",
    read: "The customer transacts mainly through the tenant bank but borrows mainly elsewhere; the bank has strong visibility over cash flow but limited earning assets against the relationship.",
    action:
      "Proactively pitch additional facilities or better-priced refinancing, using the bank's own verified turnover data (not declared figures) to support a faster, better-informed offer.",
  },
  "Credit-Concentration Watch": {
    tone: "warning",
    read: "The bank carries a large share of this customer's borrowing but sees only a small share of its transaction turnover; independent visibility over day-to-day cash flow is limited relative to the exposure.",
    action:
      "Enforce or negotiate a proceeds-domiciliation or minimum-turnover covenant (§6.4.3) to migrate transaction banking; Loan Review to apply closer monitoring frequency until turnover share improves.",
  },
  "Marginal Relationship": {
    tone: "neutral",
    read: "Limited relationship depth on both dimensions; cross-sell penetration is low and the relationship contributes little fee or interest income relative to its servicing cost.",
    action:
      "Evaluate whether a relationship-deepening campaign (transaction banking, trade finance, treasury products) is worthwhile, or serve the account on a standard, arm's-length basis.",
  },
};

export function walletPosition(turnoverShare: number, loanShare: number): WalletPosition {
  const high = walletHighThreshold();
  const ht = turnoverShare >= high;
  const hl = loanShare >= high;
  return ht && hl ? "Primary Relationship" : ht ? "Untapped Lending Opportunity" : hl ? "Credit-Concentration Watch" : "Marginal Relationship";
}

export type BankLine = {
  bank: string;
  tenant: boolean;
  creditTurnover: number;
  outstanding: number;
  source: string;
};

export type WalletData = {
  available: boolean;
  lines: BankLine[];
  turnoverShare: number;
  loanShare: number;
  gap: number;
  position: WalletPosition;
  /** Gap at the last five refreshes (oldest first), ending with the current value. */
  gapHistory: {
    at: string;
    gap: number;
    turnoverShare: number;
    loanShare: number;
  }[];
};

/**
 * Share of Business Wallet from verified turnover (CBA + other banks, same reconciliation standard) and the
 * bureau/CRMS per-bank facility breakdown. `tenantOutstanding` comes from the facility register.
 */
export function walletFor(obligorId: string, verifiedTurnover: number, tenantOutstanding: number): WalletData {
  const r = rngFor(`${obligorId}:sow`);
  const available = r() > 0.12;
  const tShare = round(0.18 + r() * 0.76, 3);
  const banks = 1 + Math.floor(r() * 3);
  const start = Math.floor(r() * otherBanks.length);
  const picks = Array.from({ length: banks }, (_, i) => otherBanks[(start + i) % otherBanks.length]!);
  const weights = picks.map(() => 0.3 + r());
  const wsum = weights.reduce((a, b) => a + b, 0);
  const tenantTurnover = Math.round(verifiedTurnover * tShare);
  const otherTurnover = verifiedTurnover - tenantTurnover;
  const lShareTarget = tenantOutstanding > 0 ? 0.12 + r() * 0.83 : 0;
  const otherOutstandingTotal = tenantOutstanding > 0 ? Math.round(tenantOutstanding * (1 / lShareTarget - 1)) : Math.round(verifiedTurnover * (0.05 + r() * 0.2));
  const lines: BankLine[] = [
    {
      bank: "Harbourline Bank (tenant)", // TD-122: should come from the tenant profile
      tenant: true,
      creditTurnover: tenantTurnover,
      outstanding: tenantOutstanding,
      source: "CBA reconciled turnover (§5.1) · facility register",
    },
    ...picks.map((bank, i) => ({
      bank,
      tenant: false,
      creditTurnover: Math.round((otherTurnover * weights[i]!) / wsum),
      outstanding: Math.round((otherOutstandingTotal * weights[(i + 1) % banks]!) / wsum),
      source: "Other-bank statement (§5.3) · bureau/CRMS per-bank breakdown (§5.2)",
    })),
  ];
  const totalT = lines.reduce((a, l) => a + l.creditTurnover, 0);
  const totalL = lines.reduce((a, l) => a + l.outstanding, 0);
  const turnoverShare = totalT ? tenantTurnover / totalT : 0;
  const loanShare = totalL ? tenantOutstanding / totalL : 0;
  const gap = turnoverShare - loanShare;
  const drift = (r() * 2 - 1) * 0.05;
  const gapHistory = [4, 3, 2, 1, 0].map((k) => {
    const ts = Math.min(0.98, Math.max(0.02, turnoverShare - drift * k + (k ? (r() * 2 - 1) * 0.02 : 0)));
    const ls = Math.min(0.98, Math.max(0, loanShare + drift * k * 0.4 + (k ? (r() * 2 - 1) * 0.02 : 0)));
    return {
      at: REFRESH_LABELS[4 - k]!,
      gap: k ? ts - ls : gap,
      turnoverShare: k ? ts : turnoverShare,
      loanShare: k ? ls : loanShare,
    };
  });
  return {
    available,
    lines,
    turnoverShare,
    loanShare,
    gap,
    position: walletPosition(turnoverShare, loanShare),
    gapHistory,
  };
}
