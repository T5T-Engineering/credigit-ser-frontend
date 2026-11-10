/**
 * 360 RAR parameter catalogue — the four cardinal points and their parameter tables, transcribed from
 * PRD §6.2.1–6.2.4 (parameter, scoring direction, system data source, analyst enrichment / survey source).
 *
 * `observed` describes the measurable reading behind a system-fed parameter and the demo scoring band used to
 * turn it into a 1–10 score. The PRD leaves the bands to the tenant's Rules & Parameters Engine ("scored against
 * tenant-configurable bands", §8), so the ranges below are illustrative demo bands, not product rules.
 */

export type CardinalKey = "internal" | "industry" | "comparative" | "macro";

export type CardinalPoint = {
  key: CardinalKey;
  direction: "North" | "South" | "East" | "West";
  label: string;
  short: string;
  prd: string;
  /** Internal (obligor-driven) or external (environment-driven) point, per PRD §6.2. */
  nature: "Internal" | "External";
  composite: "X" | "Y";
};

export const cardinalPoints: CardinalPoint[] = [
  {
    key: "internal",
    direction: "North",
    label: "Internal Risk Assessment",
    short: "Internal Risk",
    prd: "§6.2.1",
    nature: "Internal",
    composite: "Y",
  },
  {
    key: "comparative",
    direction: "East",
    label: "Comparative Assessment",
    short: "Comparative",
    prd: "§6.2.3",
    nature: "Internal",
    composite: "X",
  },
  {
    key: "industry",
    direction: "South",
    label: "Operating Industry Assessment",
    short: "Operating Industry",
    prd: "§6.2.2",
    nature: "External",
    composite: "X",
  },
  {
    key: "macro",
    direction: "West",
    label: "Macro-Economic Assessment",
    short: "Macro-Economic",
    prd: "§6.2.4",
    nature: "External",
    composite: "Y",
  },
];

export const cardinalByKey = Object.fromEntries(cardinalPoints.map((c) => [c.key, c])) as Record<CardinalKey, CardinalPoint>;

/** How a measured value maps onto the 1–10 score (demo band; linear between `worst` and `best`). */
export type ObservedSpec = {
  unit: "%" | "x" | "days" | "pp" | "score" | "count";
  /** Value scored 1. */
  worst: number;
  /** Value scored 10. */
  best: number;
  digits?: number;
  /** What the figure is. */
  measure: string;
};

export type RarParameter = {
  id: string;
  point: CardinalKey;
  name: string;
  /** PRD scoring direction, e.g. "Low → High". */
  direction: string;
  /** PRD "System Data Source" column; null where the PRD gives "—" (no reliable systems feed). */
  systemSource: string | null;
  /** PRD "Analyst Enrichment / Survey Source" column; null where the PRD gives "—". */
  enrichmentSource: string | null;
  observed?: ObservedSpec;
  /** Qualitative reading labels by score band (for analyst-led parameters). */
  qualitative?: [low: string, mid: string, high: string];
  /** Parameter value comes from the NGX sector corpus (same for every obligor in a sector). */
  sectorPinned?: "growth" | "lifecycle";
  /** Corpus metric used for peer benchmarking / trend (§6.2.10–6.2.11). */
  corpusMetric?: CorpusMetricKey;
};

export type CorpusMetricKey = "realRevenueGrowth" | "grossMargin" | "netMargin" | "roa" | "currentRatio" | "debtToAssets" | "interestCover" | "cashConversionDays";

export const parameters: RarParameter[] = [
  // ---------------- North — Internal Risk Assessment (§6.2.1) ----------------
  {
    id: "N01",
    point: "internal",
    name: "Sales Growth",
    direction: "Low → High",
    systemSource: "Audited financial statements (OCR-parsed) + CBA turnover, prior-period comparison",
    enrichmentSource: "Where financials are unaudited/provisional, in-house analyst desk review against the sector revenue-growth benchmark (NGX Corpus, §6.2.8)",
    observed: {
      unit: "%",
      worst: -12,
      best: 36,
      digits: 1,
      measure: "Revenue growth, FY2025 vs FY2024",
    },
  },
  {
    id: "N02",
    point: "internal",
    name: "Gross Profit Margin",
    direction: "Low → High",
    systemSource: "Audited financial statements — Income Statement",
    enrichmentSource: "Analyst sector-margin benchmark note (NGX Corpus) used to sense-check an outlier margin",
    observed: {
      unit: "%",
      worst: 6,
      best: 52,
      digits: 1,
      measure: "Gross profit / revenue",
    },
    corpusMetric: "grossMargin",
  },
  {
    id: "N03",
    point: "internal",
    name: "Net Profit Margin",
    direction: "Low → High",
    systemSource: "Audited financial statements — Income Statement",
    enrichmentSource: "Analyst sector-margin benchmark note (NGX Corpus) used to sense-check an outlier margin",
    observed: {
      unit: "%",
      worst: -6,
      best: 24,
      digits: 1,
      measure: "Profit after tax / revenue",
    },
    corpusMetric: "netMargin",
  },
  {
    id: "N04",
    point: "internal",
    name: "Return on Assets / Return on Investment",
    direction: "Low → High",
    systemSource: "Audited financial statements — Income Statement / Balance Sheet",
    enrichmentSource: "Analyst peer-set comparison where the obligor is unlisted and has no direct public comparator",
    observed: {
      unit: "%",
      worst: -3,
      best: 16,
      digits: 1,
      measure: "Profit after tax / average total assets",
    },
    corpusMetric: "roa",
  },
  {
    id: "N05",
    point: "internal",
    name: "Cash Flow (operating)",
    direction: "Poor → Good",
    systemSource: "CBA reconciled account turnover (net of inter-branch/suspense, in-and-out and reversal entries, §5.1) + audited Cash Flow Statement",
    enrichmentSource: "Analyst review of cash-flow quality where turnover is cash-intensive (informal-sector exposure)",
    observed: {
      unit: "%",
      worst: -8,
      best: 22,
      digits: 1,
      measure: "Operating cash flow / revenue",
    },
  },
  {
    id: "N06",
    point: "internal",
    name: "Current Ratio / Quick Ratio",
    direction: "Weak → Strong",
    systemSource: "Audited financial statements — Balance Sheet",
    enrichmentSource: null,
    observed: {
      unit: "x",
      worst: 0.55,
      best: 2.6,
      digits: 2,
      measure: "Current assets / current liabilities",
    },
    corpusMetric: "currentRatio",
  },
  {
    id: "N07",
    point: "internal",
    name: "Debt-Asset Ratio / Capital Gearing Ratio",
    direction: "High → Low",
    systemSource: "Audited financial statements — Balance Sheet",
    enrichmentSource: null,
    observed: {
      unit: "%",
      worst: 88,
      best: 15,
      digits: 1,
      measure: "Total debt / total assets",
    },
    corpusMetric: "debtToAssets",
  },
  {
    id: "N08",
    point: "internal",
    name: "Interest Cover (times)",
    direction: "Low → High",
    systemSource: "Audited financial statements — Income Statement (EBIT / Interest Expense)",
    enrichmentSource: null,
    observed: {
      unit: "x",
      worst: 0.4,
      best: 9,
      digits: 2,
      measure: "EBIT / interest expense",
    },
    corpusMetric: "interestCover",
  },
  {
    id: "N09",
    point: "internal",
    name: "Capital Required vs Available",
    direction: "High (unmet) → Low",
    systemSource: "Facility request amount vs obligor's own equity contribution evidence",
    enrichmentSource: "Analyst review of the business plan/board resolution for expansion facilities",
    observed: {
      unit: "%",
      worst: 4,
      best: 48,
      digits: 0,
      measure: "Own equity contribution to the funding need",
    },
  },
  {
    id: "N10",
    point: "internal",
    name: "Stock Holding / Debtors Collection / Creditors Payment Period",
    direction: "High → Low",
    systemSource: "Audited financial statements / Notes to Accounts + CBA reconciled receivables ageing",
    enrichmentSource: "Analyst working-capital-cycle note benchmarked to the Nature-of-Business profile (§6.4.3)",
    observed: {
      unit: "days",
      worst: 190,
      best: 15,
      digits: 0,
      measure: "Cash conversion cycle (stock + debtor − creditor days)",
    },
    corpusMetric: "cashConversionDays",
  },
  {
    id: "N11",
    point: "internal",
    name: "Financial Performance Trend (3–5 year)",
    direction: "Declining → Improving",
    systemSource: "Multi-year audited financial statements held on the Risk Data Spine",
    enrichmentSource: "Analyst trend commentary, cross-referenced to the obligor's Industry Life-Cycle Stage (§6.2.8)",
    observed: {
      unit: "%",
      worst: -10,
      best: 26,
      digits: 1,
      measure: "4-year revenue CAGR (FY2021–FY2025)",
    },
  },
  {
    id: "N12",
    point: "internal",
    name: "Financial Volatility / Risk",
    direction: "High → Low",
    systemSource: "Standard deviation of quarterly turnover/earnings from the CBA + management accounts",
    enrichmentSource: "Analyst seasonality note (ties to Nature-of-Business inflow pattern, §6.4.3)",
    observed: {
      unit: "%",
      worst: 62,
      best: 6,
      digits: 1,
      measure: "Coefficient of variation, quarterly credit turnover (8 qtrs)",
    },
  },
  {
    id: "N13",
    point: "internal",
    name: "Ease of Exit / Redeployment of Assets",
    direction: "Difficult → Easy",
    systemSource: "Collateral register — asset type and marketability, incl. CSCS mark-to-market for quoted-share collateral (§5.7, §6.5)",
    enrichmentSource: "Analyst/valuer commentary on secondary-market depth for the specific asset class",
    observed: {
      unit: "%",
      worst: 25,
      best: 90,
      digits: 0,
      measure: "Forced-sale value / market value of pledged assets",
    },
  },
  {
    id: "N14",
    point: "internal",
    name: "Credit Bureau / CRMS Standing",
    direction: "Adverse → Clean",
    systemSource: "Bureau credit score, per-bank facility/outstanding breakdown, delinquency flags (§5.2)",
    enrichmentSource: "Analyst review where bureau/CRMS data conflicts with CBA-observed conduct",
    observed: {
      unit: "score",
      worst: 380,
      best: 840,
      digits: 0,
      measure: "Consolidated bureau score (300–850)",
    },
  },

  // ---------------- South — Operating Industry Assessment (§6.2.2) ----------------
  {
    id: "S01",
    point: "industry",
    name: "Industry Growth Rate",
    direction: "Low → High",
    systemSource: "NGX-listed sector aggregate revenue CAGR (§6.2.8), National Bureau of Statistics sector GDP data",
    enrichmentSource: "Analyst quarterly sector-note, reconciling official statistics with field observation",
    observed: {
      unit: "%",
      worst: -4,
      best: 12,
      digits: 1,
      measure: "Sector real revenue CAGR, trailing 5 years (NGX Corpus)",
    },
    sectorPinned: "growth",
    corpusMetric: "realRevenueGrowth",
  },
  {
    id: "S02",
    point: "industry",
    name: "Life-Cycle Stage",
    direction: "Declining → Growing",
    systemSource: "Computed from the 10–15 year NGX sector-revenue trend (§6.2.8): Introduction / Growth / Maturity / Decline",
    enrichmentSource: "Analyst override with documented rationale where a sector is structurally shifting faster than the trailing data shows",
    sectorPinned: "lifecycle",
  },
  {
    id: "S03",
    point: "industry",
    name: "Competitive Intensity",
    direction: "High → Low",
    systemSource: "Sector concentration computed from NGX-listed peer count/market-share data (§6.2.8)",
    enrichmentSource: "Analyst market-structure survey covering unlisted/informal competitors the NGX data cannot see",
    observed: {
      unit: "%",
      worst: 18,
      best: 78,
      digits: 0,
      measure: "Top-3 listed peers' share of sector revenue",
    },
  },
  {
    id: "S04",
    point: "industry",
    name: "Differentiation / Value-Added Levels",
    direction: "Low → High",
    systemSource: "Sector gross-margin dispersion from the NGX Corpus",
    enrichmentSource: "Analyst product/service differentiation questionnaire, completed with the obligor at origination",
    observed: {
      unit: "pp",
      worst: 3,
      best: 24,
      digits: 1,
      measure: "Inter-quartile spread of sector gross margins",
    },
  },
  {
    id: "S05",
    point: "industry",
    name: "Capital Requirement / Barriers to Entry & Exit",
    direction: "Low → High",
    systemSource: "Sector capital-intensity ratio (Fixed Assets / Revenue) from the NGX Corpus",
    enrichmentSource: "Analyst desk research on regulatory licensing and entry barriers specific to the sector",
    observed: {
      unit: "%",
      worst: 8,
      best: 120,
      digits: 0,
      measure: "Sector fixed assets / revenue",
    },
  },
  {
    id: "S06",
    point: "industry",
    name: "Buyer Power / Supplier Power / Relationship",
    direction: "High → Low",
    systemSource: "Sector customer/supplier-concentration proxy from NGX segment disclosures",
    enrichmentSource: "Analyst structured interview with the obligor on its top-5 customer/supplier concentration",
    observed: {
      unit: "%",
      worst: 85,
      best: 15,
      digits: 0,
      measure: "Top-5 customers' share of obligor revenue",
    },
  },
  {
    id: "S07",
    point: "industry",
    name: "Availability of Substitutes",
    direction: "High → Low",
    systemSource: null,
    enrichmentSource: "In-house analyst competitive-landscape survey, refreshed at least annually (no reliable systems feed)",
    qualitative: ["Many close substitutes", "Some substitutes", "Few substitutes"],
  },
  {
    id: "S08",
    point: "industry",
    name: "Historic Profitability / Price-Cost Trend / Profit Potential",
    direction: "Low → High",
    systemSource: "Sector aggregate margin and price-trend history from the NGX Corpus (10–15 years)",
    enrichmentSource: "Analyst forward-looking sector outlook note",
    observed: {
      unit: "%",
      worst: -2,
      best: 16,
      digits: 1,
      measure: "Sector 10-year average net margin",
    },
  },
  {
    id: "S09",
    point: "industry",
    name: "Cyclicality",
    direction: "High → Low",
    systemSource: "Statistical seasonality/cyclicality measure computed by the AI trend engine (§6.12) on the NGX Corpus",
    enrichmentSource: "Analyst commentary distinguishing cyclicality from a structural life-cycle decline",
    observed: {
      unit: "x",
      worst: 2.2,
      best: 0.3,
      digits: 2,
      measure: "Sector revenue beta to GDP",
    },
  },
  {
    id: "S10",
    point: "industry",
    name: "Financial Stability (of the sector)",
    direction: "Low → High",
    systemSource: "Sector-aggregate leverage and default-rate trend from the NGX Corpus + the Platform's own portfolio NPL-by-sector history (§6.6)",
    enrichmentSource: null,
    observed: {
      unit: "%",
      worst: 22,
      best: 1.5,
      digits: 1,
      measure: "Sector NPL ratio (tenant book + NGX default trend)",
    },
  },

  // ---------------- East — Comparative Assessment (§6.2.3) ----------------
  {
    id: "E01",
    point: "comparative",
    name: "Margin / Price Relative to Competitors",
    direction: "Low → High",
    systemSource: "Obligor margin (financial statements) benchmarked to the NGX sector-margin distribution",
    enrichmentSource: "Analyst peer-positioning note where the obligor is unlisted",
    observed: {
      unit: "pp",
      worst: -9,
      best: 9,
      digits: 1,
      measure: "Obligor net margin minus sector median",
    },
  },
  {
    id: "E02",
    point: "comparative",
    name: "Market Share / Relative Market Share / Share Trend",
    direction: "Low → High",
    systemSource: "Obligor revenue vs sector aggregate revenue (NGX Corpus, where the sector is dominated by listed peers)",
    enrichmentSource: "In-house analyst market-share survey (structured questionnaire cross-checked against trade-association data) for sectors with no listed proxy",
    observed: {
      unit: "%",
      worst: 0.1,
      best: 12,
      digits: 2,
      measure: "Obligor revenue / sector aggregate revenue",
    },
  },
  {
    id: "E03",
    point: "comparative",
    name: "Relative Product / Service Quality",
    direction: "Inferior → Superior",
    systemSource: null,
    enrichmentSource: "Analyst/account-officer field assessment questionnaire; customer-reference checks",
    qualitative: ["Below peers", "In line with peers", "Superior to peers"],
  },
  {
    id: "E04",
    point: "comparative",
    name: "Customer Loyalty / Predictable & Recurring Revenue",
    direction: "Low → High",
    systemSource: "CBA transaction-history regularity (recurring-payer pattern detection, net of in-and-out and reversal entries, §5.1)",
    enrichmentSource: "Analyst review of contract terms/off-take agreements submitted at origination",
    observed: {
      unit: "%",
      worst: 15,
      best: 88,
      digits: 0,
      measure: "Share of credits from recurring payers (12 months)",
    },
  },
  {
    id: "E05",
    point: "comparative",
    name: "Relative Cost / Labour & Asset Productivity",
    direction: "High → Low",
    systemSource: "Obligor cost ratios (financial statements) vs NGX sector cost-structure benchmark",
    enrichmentSource: "Analyst operational-efficiency questionnaire",
    observed: {
      unit: "pp",
      worst: 14,
      best: -12,
      digits: 1,
      measure: "Obligor cost-to-income minus sector median",
    },
  },
  {
    id: "E06",
    point: "comparative",
    name: "Technological Capability / Patent Position",
    direction: "Low → High",
    systemSource: null,
    enrichmentSource: "Analyst technology/IP due-diligence note completed at origination and refreshed at annual review",
    qualitative: ["Lagging", "Adequate", "Leading"],
  },
  {
    id: "E07",
    point: "comparative",
    name: "Distinctiveness of Strategy / Strategic Control",
    direction: "Me-too → Distinctive",
    systemSource: null,
    enrichmentSource: "Analyst strategy assessment, drawing on the account officer's relationship-management notes and management interview",
    qualitative: ["Me-too", "Partly distinctive", "Distinctive"],
  },
  {
    id: "E08",
    point: "comparative",
    name: "Implementation Ability (leadership, systems, staff, culture)",
    direction: "Weak → Strong",
    systemSource: null,
    enrichmentSource: "Analyst management-quality questionnaire (succession plan, track record through cycles, governance quality, financial discipline)",
    qualitative: ["Weak", "Adequate", "Strong"],
  },

  // ---------------- West — Macro-Economic Assessment (§6.2.4) ----------------
  {
    id: "W01",
    point: "macro",
    name: "Political Influence / Regulatory Influence",
    direction: "Unstable → Stable",
    systemSource: "CBN and other regulator circular feed (§5.5); policy-change frequency tracker",
    enrichmentSource: "Analyst regulatory-outlook note",
    observed: {
      unit: "count",
      worst: 22,
      best: 1,
      digits: 0,
      measure: "Regulatory circulars affecting the sector, last 12 months",
    },
  },
  {
    id: "W02",
    point: "macro",
    name: "Economic Climate (inflation, FX, interest rate, GDP)",
    direction: "Unstable → Stable",
    systemSource: "National Bureau of Statistics, CBN Monetary Policy Committee data feed",
    enrichmentSource: "Analyst macro-commentary tying the data to the specific sector's sensitivity",
    observed: {
      unit: "x",
      worst: 1.8,
      best: 0.2,
      digits: 2,
      measure: "Sector sensitivity to the macro composite (inflation, FX, MPR, GDP)",
    },
  },
  {
    id: "W03",
    point: "macro",
    name: "Social Trends",
    direction: "Unstable → Stable",
    systemSource: null,
    enrichmentSource: "Analyst research note (demographic/consumer-behaviour shifts relevant to the sector)",
    qualitative: ["Adverse shift", "Neutral", "Supportive"],
  },
  {
    id: "W04",
    point: "macro",
    name: "Technological Change",
    direction: "Unstable → Stable",
    systemSource: null,
    enrichmentSource: "Analyst technology-disruption research note",
    qualitative: ["High disruption risk", "Moderate", "Stable"],
  },
  {
    id: "W05",
    point: "macro",
    name: "Environmental / Climate Outlook",
    direction: "Unstable → Stable",
    systemSource: "Where available, national climate/agro-meteorological data feed (particularly relevant to Agriculture Finance)",
    enrichmentSource: "Analyst note on physical/transition climate risk for the sector",
    qualitative: ["Elevated climate risk", "Moderate", "Low climate risk"],
  },
  {
    id: "W06",
    point: "macro",
    name: "International Influence",
    direction: "Unstable → Stable",
    systemSource: "Global commodity-price and trade-data feed, where the sector is import/export exposed",
    enrichmentSource: "Analyst note on supply-chain/FX exposure",
    observed: {
      unit: "%",
      worst: 70,
      best: 5,
      digits: 0,
      measure: "FX-denominated share of input costs",
    },
  },
];

export const parametersByPoint = (point: CardinalKey) => parameters.filter((p) => p.point === point);

/** Parameters an analyst may adjust (the PRD lists an analyst enrichment / survey source). */
export const isEnrichable = (p: RarParameter) => p.enrichmentSource !== null;

/** Map an observed value onto 1–10 with the demo band (linear, clamped). */
export function scoreFromObserved(spec: ObservedSpec, value: number): number {
  const t = (value - spec.worst) / (spec.best - spec.worst);
  return Math.min(10, Math.max(1, 1 + 9 * t));
}

/** Inverse of {@link scoreFromObserved}: the value that produces a score. */
export function observedFromScore(spec: ObservedSpec, score: number): number {
  return spec.worst + ((score - 1) / 9) * (spec.best - spec.worst);
}

export function formatObserved(spec: ObservedSpec, value: number): string {
  const d = spec.digits ?? 1;
  if (Math.abs(value) < 0.5 / 10 ** d) value = 0;
  const v = value.toLocaleString("en-NG", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  switch (spec.unit) {
    case "%":
      return `${v}%`;
    case "x":
      return `${v}x`;
    case "days":
      return `${v} days`;
    case "pp":
      return `${value > 0 ? "+" : ""}${v} pp`;
    default:
      return v;
  }
}

export function qualitativeLabel(p: RarParameter, score: number): string {
  if (!p.qualitative) return "";
  return score < 4 ? p.qualitative[0] : score < 8 ? p.qualitative[1] : p.qualitative[2];
}
