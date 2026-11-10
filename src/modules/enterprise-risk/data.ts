/**
 * Enterprise Risk Management data (PRD §6.10, §6.11, §9.2). ERM is an enterprise-level aggregation of the
 * Risk Data Spine — appetite actuals are computed from shared facilities/obligors plus the Operational Risk
 * module; figures owned by Phase 2 engines not yet in the spine (CAR, liquidity, NOP) are simulated feeds.
 */
import type { Facility, Obligor, Sector } from "@/lib/data/types";
import { DEMO_NOW } from "@/lib/data/seed";
import { getRule } from "@/lib/platform/rules";
import { isoDaysAgo, isoDaysAhead, monthLabels, rng, round } from "../operational-risk/shared";
import { ermKeys } from "./keys";

// Tenant parameters are business rules (./platform.ts), read at call time. Shareholders' funds = core rule
// `platform.shareholdersFundsNgn`.
const shareholdersFunds = () => getRule<number>("platform.shareholdersFundsNgn");

/** Risk Appetite Statement version in force (business rules — versioned configuration, §6.10). */
export function rasVersion() {
  return { version: getRule<string>(ermKeys.rasVersion), approvedBy: getRule<string>(ermKeys.rasApprovedBy), approvedAt: getRule<string>(ermKeys.rasApprovedAt), nextReview: getRule<string>(ermKeys.rasNextReview) };
}

export type RiskType = "Credit" | "Concentration" | "Capital" | "Liquidity" | "Market" | "Operational";

export type AppetiteMetric = {
  id: string;
  name: string;
  type: RiskType;
  /** Board-approved appetite limit. */
  limit: number;
  /** Early-warning tolerance (amber). */
  tolerance: number;
  /** "max": actual must stay ≤ limit; "min": actual must stay ≥ limit. */
  direction: "max" | "min";
  unit: "%" | "x" | "count";
  actual: number;
  history: number[];
  formula: string;
  source: string;
  basis: string;
  owner: string;
};

const months = monthLabels(12);
export const APPETITE_MONTHS = months;

function trail(seed: number, end: number, drift: number, noise: number): number[] {
  const r = rng(seed);
  return Array.from({ length: 12 }, (_, i) => (i === 11 ? end : round(end - drift * (11 - i) / 11 + (r.next() * 2 - 1) * noise, 2)));
}

export type SpineFigures = {
  totalBook: number;
  npl: number;
  largestObligor: { name: string; exposure: number };
  largeExposures: number;
  government: number;
  sectorBreaches: { sector: Sector; share: number }[];
  worstSector: { sector: Sector; share: number };
};

export function spineFigures(facilities: Facility[], obligors: Obligor[], sectors: Sector[]): SpineFigures {
  const live = facilities.filter((f) => f.status !== "Closed" && f.status !== "Written off");
  const totalBook = live.reduce((s, f) => s + f.outstanding, 0) || 1;
  const npl = live.filter((f) => f.cbnClass === "Substandard" || f.cbnClass === "Doubtful" || f.cbnClass === "Lost").reduce((s, f) => s + f.outstanding, 0);
  const byOb = new Map<string, number>();
  live.forEach((f) => byOb.set(f.obligorId, (byOb.get(f.obligorId) ?? 0) + f.outstanding));
  const [topId, topExp] = [...byOb.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const obMap = new Map(obligors.map((o) => [o.id, o]));
  const largeFloor = (getRule<number>(ermKeys.largeExposurePct) / 100) * shareholdersFunds();
  const largeExposures = [...byOb.values()].filter((v) => v >= largeFloor).reduce((s, v) => s + v, 0);
  const bySector = new Map<string, number>();
  live.forEach((f) => {
    const sid = obMap.get(f.obligorId)?.sectorId ?? "";
    bySector.set(sid, (bySector.get(sid) ?? 0) + f.outstanding);
  });
  const shares = sectors.map((s) => ({ sector: s, share: ((bySector.get(s.id) ?? 0) / totalBook) * 100 }));
  const nonGov = shares.filter((s) => s.sector.id !== "SEC-GOV");
  const worst = [...nonGov].sort((a, b) => b.share / b.sector.limitPct - a.share / a.sector.limitPct)[0]!;
  return {
    totalBook,
    npl,
    largestObligor: { name: obMap.get(topId)?.name ?? "—", exposure: topExp },
    largeExposures,
    government: bySector.get("SEC-GOV") ?? 0,
    sectorBreaches: nonGov.filter((s) => s.share > s.sector.limitPct),
    worstSector: worst,
  };
}

/** Default Board RAS limits / early-warning tolerances — the DEFAULTS of rules enterprise-risk.ras.<id>.limit/.tolerance. */
export const rasMetricDefaults: { id: string; name: string; limit: number; tolerance: number }[] = [
  { id: "RA-01", name: "Single-obligor exposure (largest) to shareholders' funds", limit: 20, tolerance: 18 },
  { id: "RA-02", name: "Sectoral concentration — highest utilisation of internal limit", limit: 100, tolerance: 90 },
  { id: "RA-03", name: "All-tiers-of-government exposure to total credit", limit: 10, tolerance: 9 },
  { id: "RA-04", name: "Aggregate large exposures to shareholders' funds", limit: 8, tolerance: 6 },
  { id: "RA-05", name: "Non-performing loan (NPL) ratio", limit: 5, tolerance: 4 },
  { id: "RA-06", name: "Capital adequacy ratio (CAR)", limit: 15, tolerance: 16.5 },
  { id: "RA-07", name: "Liquidity ratio (CBN)", limit: 30, tolerance: 35 },
  { id: "RA-08", name: "Liquidity coverage ratio (LCR)", limit: 100, tolerance: 110 },
  { id: "RA-09", name: "Net open position to total capital", limit: 20, tolerance: 17 },
  { id: "RA-10", name: "Operational loss — YTD use of annual loss limit", limit: 100, tolerance: 75 },
  { id: "RA-11", name: "Operational KRIs in Red", limit: 20, tolerance: 10 },
];

/** Limit and tolerance in force for an appetite metric (business rules). */
export function rasLimits(id: string): { limit: number; tolerance: number } {
  return { limit: getRule<number>(ermKeys.rasLimit(id)), tolerance: getRule<number>(ermKeys.rasTolerance(id)) };
}

/** Risk Appetite Statement scorecard (§6.10). Regulatory floors cited from the PRD; other limits are Board RAS demo values. */
export function appetiteMetrics(f: SpineFigures, op: { netLossYtd: number; annualLossLimit: number; redKris: number; totalKris: number }): AppetiteMetric[] {
  const sf = shareholdersFunds();
  const so = (f.largestObligor.exposure / sf) * 100;
  const nplPct = (f.npl / f.totalBook) * 100;
  const gov = (f.government / f.totalBook) * 100;
  const worstUtil = (f.worstSector.share / f.worstSector.sector.limitPct) * 100;
  const opLoss = (op.netLossYtd / op.annualLossLimit) * 100;
  const redShare = (op.redKris / op.totalKris) * 100;
  return [
    { id: "RA-01", name: "Single-obligor exposure (largest) to shareholders' funds", type: "Concentration", ...rasLimits("RA-01"), direction: "max", unit: "%", actual: round(so, 1), history: trail(1, round(so, 1), 1.4, 0.4), formula: "Largest obligor/connected-group exposure ÷ shareholders' funds unimpaired by losses", source: `Risk Data Spine — Facility.outstanding (${f.largestObligor.name})`, basis: "Regulatory: 20% (CBN 3.2(a)); early warning at 90% of limit", owner: "Chief Credit Officer" },
    { id: "RA-02", name: "Sectoral concentration — highest utilisation of internal limit", type: "Concentration", ...rasLimits("RA-02"), direction: "max", unit: "%", actual: round(worstUtil, 0), history: trail(2, round(worstUtil, 0), 22, 4), formula: "Sector outstanding ÷ total book ÷ sector limit (tenant taxonomy)", source: `Risk Data Spine — ${f.worstSector.sector.name} ${round(f.worstSector.share, 1)}% vs ${f.worstSector.sector.limitPct}% limit`, basis: "Tenant internal sector limits (§6.6.2); early warning 90%", owner: "Chief Risk Officer" },
    { id: "RA-03", name: "All-tiers-of-government exposure to total credit", type: "Concentration", ...rasLimits("RA-03"), direction: "max", unit: "%", actual: round(gov, 1), history: trail(3, round(gov, 1), 3.5, 0.6), formula: "Government sector outstanding ÷ total credit portfolio", source: "Risk Data Spine — obligors in Government sector", basis: "Regulatory: 10% ceiling (CBN 3.2(c))", owner: "Chief Credit Officer" },
    { id: "RA-04", name: "Aggregate large exposures to shareholders' funds", type: "Concentration", ...rasLimits("RA-04"), direction: "max", unit: "x", actual: round(f.largeExposures / sf, 2), history: trail(4, round(f.largeExposures / sf, 2), 0.2, 0.05), formula: "Σ exposures ≥ 10% of shareholders' funds ÷ shareholders' funds", source: "Risk Data Spine — Facility.outstanding by obligor", basis: "Regulatory: 8× (CBN 3.2(d)–(e)); tolerance is a demo RAS value", owner: "Chief Credit Officer" },
    { id: "RA-05", name: "Non-performing loan (NPL) ratio", type: "Credit", ...rasLimits("RA-05"), direction: "max", unit: "%", actual: round(nplPct, 2), history: trail(5, round(nplPct, 2), -0.4, 0.15), formula: "Substandard + Doubtful + Lost outstanding ÷ total loans", source: "Risk Data Spine — Facility.cbnClass", basis: "Board RAS (demo value — tenant parameter)", owner: "Chief Credit Officer" },
    { id: "RA-06", name: "Capital adequacy ratio (CAR)", type: "Capital", ...rasLimits("RA-06"), direction: "min", unit: "%", actual: 17.4, history: trail(6, 17.4, 0.9, 0.3), formula: "Qualifying capital ÷ risk-weighted assets", source: "IFRS 9 & ICAAP module (§6.7) — simulated feed", basis: "Regulatory minimum 10% or 15% by licence (§9.1); management buffer is a demo RAS value", owner: "Chief Risk Officer" },
    { id: "RA-07", name: "Liquidity ratio (CBN)", type: "Liquidity", ...rasLimits("RA-07"), direction: "min", unit: "%", actual: 41.2, history: trail(7, 41.2, 3, 1.5), formula: "Liquid assets ÷ deposit liabilities", source: "Market & liquidity module (§6.8.2) — simulated feed", basis: "Board RAS (demo value — CBN prescribes the floor)", owner: "Market Risk Analyst" },
    { id: "RA-08", name: "Liquidity coverage ratio (LCR)", type: "Liquidity", ...rasLimits("RA-08"), direction: "min", unit: "%", actual: 128, history: trail(8, 128, -6, 4), formula: "HQLA ÷ total net cash outflows (30 days)", source: "Market & liquidity module (§6.8.2) — simulated feed", basis: "Regulatory floor 100% (§6.8.3); early warning is tenant-configurable", owner: "Market Risk Analyst" },
    { id: "RA-09", name: "Net open position to total capital", type: "Market", ...rasLimits("RA-09"), direction: "max", unit: "%", actual: 17.9, history: trail(9, 17.9, 4.2, 1), formula: "Net open FX position ÷ total capital", source: "Market & liquidity module (§6.8.1) — simulated feed", basis: "Board RAS (demo value — tenant parameter)", owner: "Market Risk Analyst" },
    { id: "RA-10", name: "Operational loss — YTD use of annual loss limit", type: "Operational", ...rasLimits("RA-10"), direction: "max", unit: "%", actual: round(opLoss, 1), history: trail(10, round(opLoss, 1), round(opLoss * 0.85, 1), 1.5), formula: "Net operational loss YTD ÷ annual loss limit", source: "Operational Risk loss-event register (§6.9)", basis: "Operational Risk Loss Limit Framework (demo value)", owner: "Head of Risk" },
    { id: "RA-11", name: "Operational KRIs in Red", type: "Operational", ...rasLimits("RA-11"), direction: "max", unit: "%", actual: round(redShare, 0), history: trail(11, round(redShare, 0), 6, 3), formula: "Red KRIs ÷ KRIs monitored", source: `Operational Risk KRI framework (§6.9.1) — ${op.redKris} of ${op.totalKris}`, basis: "Board RAS (demo value)", owner: "Head of Risk" },
  ];
}

export type Rag = "green" | "amber" | "red";
export function appetiteRag(m: Pick<AppetiteMetric, "actual" | "limit" | "tolerance" | "direction">): Rag {
  if (m.direction === "max") return m.actual > m.limit ? "red" : m.actual >= m.tolerance ? "amber" : "green";
  return m.actual < m.limit ? "red" : m.actual <= m.tolerance ? "amber" : "green";
}
export const fmtMetric = (m: Pick<AppetiteMetric, "unit">, v: number) => (m.unit === "x" ? `${v.toFixed(2)}×` : m.unit === "count" ? String(v) : `${v}%`);

// ---------------------------------------------------------------- Enterprise risk register

export type ErmCategory = "Credit" | "Market" | "Liquidity" | "Operational" | "Compliance" | "Strategic" | "Reputational" | "Cyber & technology";
export type Response = "Treat" | "Tolerate" | "Transfer" | "Terminate";
export type CosoStage = "Identify" | "Assess" | "Respond" | "Monitor";

export type EnterpriseRisk = {
  id: string;
  title: string;
  category: ErmCategory;
  owner: string;
  ownerRole: string;
  inherent: { likelihood: number; impact: number };
  residual: { likelihood: number; impact: number };
  trend: "Rising" | "Stable" | "Falling";
  response: Response;
  stage: CosoStage;
  keyControls: string;
  linkedMetric?: string;
  lastReviewed: string;
  /** Risk acceptance (Tolerate) approved through the Operations workflow. */
  acceptedBy?: string;
  acceptedAt?: string;
  acceptanceRationale?: string;
};

const ermSpecs: [string, ErmCategory, string, string, [number, number], [number, number], EnterpriseRisk["trend"], Response, CosoStage, string, string?][] = [
  ["Concentration in government and quasi-government obligors", "Credit", "Chief Credit Officer", "cco", [4, 5], [4, 4], "Rising", "Treat", "Respond", "Sector limits engine, limit gate at origination, BCC review of public-sector deals", "RA-03"],
  ["Deterioration in oil & gas downstream borrowers (FX pass-through)", "Credit", "Chief Credit Officer", "cco", [4, 4], [3, 4], "Rising", "Treat", "Monitor", "360 RAR macro pillar, watchlist reviews, covenant monitoring", "RA-05"],
  ["Single-obligor limit near-breach on top corporate names", "Credit", "Chief Risk Officer", "cro", [3, 5], [3, 4], "Stable", "Treat", "Monitor", "Single-obligor limit report, connected-group aggregation", "RA-01"],
  ["Naira depreciation widening net open position", "Market", "Market Risk Analyst", "market-risk-analyst", [4, 4], [3, 3], "Rising", "Treat", "Monitor", "NOP limits, daily revaluation, hedging policy", "RA-09"],
  ["Interest-rate repricing gap (IRRBB)", "Market", "Market Risk Analyst", "market-risk-analyst", [3, 3], [2, 3], "Stable", "Tolerate", "Monitor", "ALM gap limits, ALCO review"],
  ["Deposit concentration and funding run-off", "Liquidity", "Market Risk Analyst", "market-risk-analyst", [3, 5], [2, 4], "Stable", "Treat", "Monitor", "Contingency funding plan, LCR early warning", "RA-08"],
  ["Core banking outage beyond RTO", "Operational", "Operational Risk Analyst", "operational-risk-analyst", [3, 5], [3, 4], "Rising", "Treat", "Respond", "DR site, BCM testing, capacity monitoring", "RA-11"],
  ["Rising staff attrition degrading service quality", "Operational", "Head of Risk", "head-of-risk", [4, 3], [4, 3], "Rising", "Treat", "Assess", "Retention plan, succession planning, KRI-HC-01 monitoring", "RA-11"],
  ["Internal fraud via maker-checker bypass", "Operational", "Operational Risk Analyst", "operational-risk-analyst", [3, 4], [2, 3], "Falling", "Treat", "Monitor", "Segregation of duties, access recertification", "RA-10"],
  ["Ransomware attack on critical systems", "Cyber & technology", "Chief Information Security Officer", "it-support", [4, 5], [3, 4], "Stable", "Transfer", "Respond", "EDR, SIEM monitoring, offline backups, cyber insurance"],
  ["Late or inaccurate regulatory returns", "Compliance", "Chief Compliance Officer", "head-of-risk", [3, 4], [2, 3], "Falling", "Treat", "Monitor", "Auto-report generation, maker-checker on returns"],
  ["Insider/related-party lending not disclosed", "Compliance", "Head of Risk", "head-of-risk", [2, 5], [1, 4], "Stable", "Treat", "Monitor", "Insider-related flagging on the Risk Data Spine, Board disclosure"],
  ["AML/KYC screening failure", "Compliance", "Chief Compliance Officer", "head-of-risk", [3, 5], [2, 4], "Stable", "Treat", "Monitor", "Sanctions screening, BVN validation, periodic KYC refresh"],
  ["Capital buffer erosion from ECL growth", "Strategic", "Chief Risk Officer", "cro", [3, 4], [2, 4], "Stable", "Treat", "Monitor", "ICAAP stress testing, capital planning", "RA-06"],
  ["Digital-channel failures driving complaints and churn", "Reputational", "Head of Risk", "head-of-risk", [4, 3], [3, 3], "Rising", "Treat", "Respond", "Channel monitoring, complaint SLA, root-cause analysis"],
  ["Third-party (vendor) dependency for card processing", "Operational", "Operational Risk Analyst", "operational-risk-analyst", [3, 3], [3, 3], "Stable", "Transfer", "Assess", "Vendor SLAs, exit plans, contract reviews"],
  ["Climate and flood exposure of agricultural book", "Strategic", "Chief Risk Officer", "cro", [3, 3], [3, 3], "Rising", "Tolerate", "Identify", "Sector cycle analysis, collateral insurance"],
];

export const seedEnterpriseRisks: EnterpriseRisk[] = ermSpecs.map(([title, category, owner, ownerRole, inh, res, trend, response, stage, keyControls, linkedMetric], i) => ({
  id: `ERM-${String(i + 1).padStart(3, "0")}`,
  title,
  category,
  owner,
  ownerRole,
  inherent: { likelihood: inh[0], impact: inh[1] },
  residual: { likelihood: res[0], impact: res[1] },
  trend,
  response,
  stage,
  keyControls,
  linkedMetric,
  lastReviewed: isoDaysAgo([12, 30, 8, 20, 70, 45, 5, 18, 90, 25, 60, 40, 55, 33, 15, 110, 140][i]!),
}));

// ---------------------------------------------------------------- Insider / related-party lending

/** "Significant shareholder" = holding at or above the `enterprise-risk.insider.significantShareholdingPct` rule. */
export type Insider = { obligorId: string; insider: string; relationship: "Director" | "Significant shareholder" | "Related interest of director" | "Related interest of shareholder"; holdingPct?: number };

const insiderNames = ["Chief Babatunde Fashola-Ade", "Dr. Amina Yusuf-Garba", "Mr. Emeka Okafor", "Mrs. Toyin Bankole", "Alhaji Sani Musa"];

/** Deterministically flag a handful of spine obligors as insider-related (demo). */
export function insiderFlags(obligors: Obligor[], facilities: Facility[]): Insider[] {
  const corporates = obligors.filter((o) => o.type !== "Retail" && o.type !== "Public sector");
  // Include one obligor with a non-performing facility so the disclosure's non-performing component is exercised.
  const npl = corporates.findIndex((o) => facilities.some((f) => f.obligorId === o.id && (f.cbnClass === "Substandard" || f.cbnClass === "Doubtful")));
  const pickIdx = [2, 7, 13, 21, 26, npl >= 0 ? npl : 34];
  const rels: Insider["relationship"][] = ["Related interest of director", "Significant shareholder", "Related interest of shareholder", "Director", "Related interest of director", "Related interest of shareholder"];
  return pickIdx
    .map((idx) => corporates[idx % Math.max(1, corporates.length)])
    .filter((o): o is Obligor => !!o)
    .map((o, i) => ({ obligorId: o.id, insider: insiderNames[i % insiderNames.length]!, relationship: rels[i]!, holdingPct: rels[i]!.startsWith("Significant") ? 7.5 : undefined }));
}

// ---------------------------------------------------------------- Regulatory updates & policy currency

export type Circular = { id: string; ref: string; title: string; issuedAt: string; area: string; impact: "High" | "Medium" | "Low"; status: "New" | "Under assessment" | "Linked to policy" | "No action required"; policyId?: string };

/** Simulated CBN circulars feed (§5.5) — fictional titles for the demo. */
export const seedCirculars: Circular[] = [
  { id: "CIR-1", ref: "BSD/DIR/GEN/26/014", title: "Revised guidance on single-obligor limits for connected groups", issuedAt: isoDaysAgo(4), area: "Credit", impact: "High", status: "New" },
  { id: "CIR-2", ref: "FPR/DIR/GEN/26/009", title: "Updated reporting template for insider-related credit disclosures", issuedAt: isoDaysAgo(11), area: "Financial reporting", impact: "Medium", status: "Under assessment" },
  { id: "CIR-3", ref: "BSD/DIR/GEN/26/011", title: "Minimum standards for operational resilience and BCM testing", issuedAt: isoDaysAgo(26), area: "Operational risk", impact: "High", status: "Linked to policy", policyId: "POL-07" },
  { id: "CIR-4", ref: "TED/FEM/26/005", title: "Changes to the net open position computation methodology", issuedAt: isoDaysAgo(40), area: "Market risk", impact: "Medium", status: "Linked to policy", policyId: "POL-08" },
  { id: "CIR-5", ref: "DFD/DIR/26/003", title: "Intervention-fund lending to agriculture — eligibility update", issuedAt: isoDaysAgo(58), area: "Agriculture", impact: "Low", status: "No action required" },
  { id: "CIR-6", ref: "BSD/DIR/GEN/26/006", title: "Cybersecurity framework — incident reporting timelines", issuedAt: isoDaysAgo(83), area: "Cyber", impact: "High", status: "Linked to policy", policyId: "POL-09" },
];

export type Policy = { id: string; name: string; owner: string; lastReviewed: string; required: boolean };

/** Policies the Risk function must evidence are reviewed on the `enterprise-risk.policy.reviewCycleYears` cycle (§6.10). */
export const seedPolicies: Policy[] = [
  { id: "POL-01", name: "Credit policy", owner: "Chief Credit Officer", lastReviewed: isoDaysAgo(320), required: true },
  { id: "POL-02", name: "Project-finance policy", owner: "Chief Credit Officer", lastReviewed: isoDaysAgo(1010), required: true },
  { id: "POL-03", name: "Real-estate financing policy", owner: "Chief Credit Officer", lastReviewed: isoDaysAgo(1130), required: true },
  { id: "POL-04", name: "SME financing policy", owner: "Head of Risk", lastReviewed: isoDaysAgo(540), required: true },
  { id: "POL-05", name: "Agriculture financing policy", owner: "Head of Risk", lastReviewed: isoDaysAgo(890), required: true },
  { id: "POL-06", name: "Retail-financing policy", owner: "Head of Risk", lastReviewed: isoDaysAgo(210), required: true },
  { id: "POL-07", name: "Business Continuity Management Framework", owner: "Operational Risk Analyst", lastReviewed: isoDaysAgo(400), required: false },
  { id: "POL-08", name: "Market risk management policy", owner: "Market Risk Analyst", lastReviewed: isoDaysAgo(700), required: false },
  { id: "POL-09", name: "Information security policy", owner: "Chief Information Security Officer", lastReviewed: isoDaysAgo(150), required: false },
];

export type PolicyCurrency = "Current" | "Due soon" | "Overdue";
export function policyStatus(p: Pick<Policy, "lastReviewed">): { label: PolicyCurrency; dueAt: string } {
  const cycleDays = getRule<number>(ermKeys.policyCycleYears) * 365;
  const dueSoon = getRule<number>(ermKeys.policyDueSoonDays);
  const age = (DEMO_NOW.getTime() - Date.parse(p.lastReviewed)) / 86_400_000;
  const dueAt = isoDaysAhead(cycleDays - age);
  return { label: age > cycleDays ? "Overdue" : age > cycleDays - dueSoon ? "Due soon" : "Current", dueAt };
}

export type RegBreach = { id: string; area: "Credit" | "Prudential reporting" | "Market conduct" | "AML/KYC"; description: string; identifiedBy: "Internal" | "Examiner"; severity: "High" | "Medium" | "Low"; identifiedAt: string; status: "Open" | "Remediating" | "Closed"; penalty?: number };

export const seedBreaches: RegBreach[] = [
  { id: "RB-2611", area: "Prudential reporting", description: "Late submission of monthly prudential return (2 days)", identifiedBy: "Internal", severity: "Medium", identifiedAt: isoDaysAgo(9), status: "Remediating", penalty: 2_000_000 },
  { id: "RB-2610", area: "Credit", description: "Government-sector exposure above the 10% ceiling", identifiedBy: "Internal", severity: "High", identifiedAt: isoDaysAgo(16), status: "Open" },
  { id: "RB-2609", area: "AML/KYC", description: "Incomplete KYC on 14 corporate accounts", identifiedBy: "Examiner", severity: "High", identifiedAt: isoDaysAgo(48), status: "Remediating" },
  { id: "RB-2608", area: "Market conduct", description: "Unapproved fee charged on dormant accounts", identifiedBy: "Internal", severity: "Medium", identifiedAt: isoDaysAgo(75), status: "Closed", penalty: 5_000_000 },
  { id: "RB-2607", area: "Prudential reporting", description: "CRMS update outside the reporting window", identifiedBy: "Examiner", severity: "Low", identifiedAt: isoDaysAgo(120), status: "Closed" },
];

// ---------------------------------------------------------------- Board Risk Committee pack

export const packSections = [
  { id: "appetite", title: "Risk appetite scorecard", source: "ERM — RAS scorecard (§6.10)" },
  { id: "register", title: "Top enterprise risks & heat map", source: "ERM risk register" },
  { id: "credit", title: "Credit portfolio, NPL & concentration", source: "Portfolio & MIS (§6.6)" },
  { id: "ifrs9", title: "IFRS 9 ECL & stage migration", source: "IFRS 9 & ICAAP (§6.7)" },
  { id: "market", title: "Market & liquidity risk", source: "Market & liquidity (§6.8)" },
  { id: "oprisk", title: "Operational risk — KRIs & loss events", source: "Operational risk (§6.9)" },
  { id: "bcm", title: "Business continuity & crisis readiness", source: "Operational risk — BCM (§6.9)" },
  { id: "exceptions", title: "Exceptions escalated to Level 4", source: "Exception protocol (§6.4.4)" },
  { id: "regulatory", title: "Regulatory updates, breaches & policy currency", source: "ERM (§6.10)" },
  { id: "insider", title: "Insider/related-party lending disclosure", source: "ERM (§6.10)" },
] as const;

export type BrcPack = {
  id: string;
  meeting: string;
  sections: string[];
  compiledAt: string;
  compiledBy: string;
  pages: number;
  summary: string;
  status: "Draft" | "Submitted to CRO" | "Approved for BRC";
  approvedBy?: string;
  compiledById?: string;
  /** Who adopted the AI-drafted executive summary (AI sign-off operation). */
  summaryAdoptedBy?: string;
};

