/**
 * Portfolio & MIS module data: deterministic synthetic history, prior-period grades, projection scenarios,
 * annual plan and report catalogue — all derived from the shared Risk Data Spine so figures reconcile.
 *
 * PROTOTYPE: the spine only holds the current book. Period history (12-month trend, opening grades at
 * 31 Dec 2025, opening exposure) is generated deterministically from the current book with `hash01` so it is
 * stable across machines. BACKEND SEAM: replace with month-end snapshots from the reporting store.
 */
import { format, subMonths, addMonths } from "date-fns";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Facility, Obligor, Sector } from "@/lib/data/types";
import { getRule } from "@/lib/platform/rules";
import { computeWarr, hash01, liveFacilities, nplRatio, onBalance, portfolioTotals, sum, warrExposure, type WarrResult } from "./selectors";
import { PORTFOLIO_RULES } from "./rule-keys";

/** Start of the reporting period used for new-business split and WARR decomposition (YTD) — business rule. */
export function periodStart(): Date {
  const iso = getRule<string>(PORTFOLIO_RULES.periodStartDate);
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date(`${DEMO_NOW.getFullYear()}-01-01T00:00:00`) : d;
}
export const periodLabel = () => `YTD ${format(periodStart(), "d MMM")} – ${format(DEMO_NOW, "d MMM yyyy")}`;
export const openingLabel = () => getRule<string>(PORTFOLIO_RULES.openingDateLabel);

export const isNewBusiness = (f: Facility) => new Date(f.startDate) >= periodStart();

// ---------------------------------------------------------------------------------------------------------------
// Prior grades and opening exposure (synthetic, deterministic)
// ---------------------------------------------------------------------------------------------------------------

/** Obligor grade at the opening date (prior year-end). null = not a customer then. */
export function priorGrade(o: Obligor): number | null {
  if (new Date(o.customerSince) >= periodStart()) return null;
  const r = hash01(`${o.id}:prior-grade`);
  let g = o.riskGrade;
  if (o.watchlist) g = o.riskGrade - (r < 0.55 ? 2 : r < 0.9 ? 1 : 0);
  else if (r < 0.13) g = o.riskGrade + 1; // upgraded during the period
  else if (r < 0.27) g = o.riskGrade - 1; // downgraded during the period
  return Math.min(10, Math.max(1, g));
}

/** Facility exposure at the opening date: current exposure grossed up for repayments / run-off since. */
export function openingExposure(f: Facility): number {
  if (isNewBusiness(f)) return 0;
  const revolving = f.product === "Overdraft" || f.product === "Revolving credit";
  const factor = revolving ? 0.92 + 0.2 * hash01(`${f.id}:open`) : 1.04 + 0.14 * hash01(`${f.id}:open`);
  return warrExposure(f) * factor;
}

export type WarrDecomposition = {
  opening: number;
  runoff: number;
  migration: number;
  newBusiness: number;
  writeOffs: number;
  closing: number;
};

/**
 * Period-on-period WARR movement decomposed into drivers (§6.6.9), sequentially:
 * opening → repayments & run-off (exposure change at opening grades) → rating migration (grade change on the
 * existing book) → new disbursements (adding new-business facilities) → write-offs/exits (none in period) → closing.
 */
export function warrDecomposition(all: Facility[], obligors: Obligor[]): WarrDecomposition {
  const byId = new Map(obligors.map((o) => [o.id, o]));
  const live = liveFacilities(all).filter((f) => byId.has(f.obligorId));
  const existing = live.filter((f) => !isNewBusiness(f) && priorGrade(byId.get(f.obligorId)!) != null);
  const w = (rows: Array<{ exposure: number; grade: number | null }>) => computeWarr(rows).warr;
  const opening = w(existing.map((f) => ({ exposure: openingExposure(f), grade: priorGrade(byId.get(f.obligorId)!) })));
  const w1 = w(existing.map((f) => ({ exposure: warrExposure(f), grade: priorGrade(byId.get(f.obligorId)!) })));
  const w2 = w(existing.map((f) => ({ exposure: warrExposure(f), grade: byId.get(f.obligorId)!.riskGrade })));
  const closing = w(live.map((f) => ({ exposure: warrExposure(f), grade: byId.get(f.obligorId)!.riskGrade })));
  return { opening, runoff: w1 - opening, migration: w2 - w1, newBusiness: closing - w2, writeOffs: 0, closing };
}

export type MigrationCell = { from: number; to: number; count: number; exposure: number };

/** Grade-migration matrix: opening grade (31 Dec 2025) × closing grade, by obligor count and exposure. */
export function migrationMatrix(all: Facility[], obligors: Obligor[]): MigrationCell[] {
  const fac = liveFacilities(all);
  const cells = new Map<string, MigrationCell>();
  for (const o of obligors) {
    const from = priorGrade(o);
    if (from == null) continue;
    const exposure = sum(
      fac.filter((f) => f.obligorId === o.id),
      warrExposure,
    );
    if (!exposure) continue;
    const key = `${from}-${o.riskGrade}`;
    const c = cells.get(key) ?? { from, to: o.riskGrade, count: 0, exposure: 0 };
    c.count += 1;
    c.exposure += exposure;
    cells.set(key, c);
  }
  return [...cells.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// 12-month history (synthetic)
// ---------------------------------------------------------------------------------------------------------------

export type HistoryPoint = { month: string; grossLoans: number; nplRatio: number; stage1: number; stage2: number; stage3: number; warr: number; pipeline: number };

/** Month-end history for the last 12 months, ending with the live (current) figures. */
export function portfolioHistory(all: Facility[], obligors: Obligor[], pipelineValue: number): HistoryPoint[] {
  const t = portfolioTotals(all);
  const byId = new Map(obligors.map((o) => [o.id, o]));
  const rows = liveFacilities(all).map((f) => ({ exposure: warrExposure(f), grade: byId.get(f.obligorId)?.riskGrade ?? null, stage: f.stage }));
  const warrNow = computeWarr(rows).warr;
  const warrOpen = warrDecomposition(all, obligors).opening;
  const out: HistoryPoint[] = [];
  for (let m = 11; m >= 0; m--) {
    const wiggle = Math.sin(m * 1.3) * 0.006;
    const s2 = Math.max(0, t.stageShare[2] + 1.6 * Math.sin(m / 2.2) + 0.12 * m);
    const s3 = Math.max(0, t.stageShare[3] + 0.06 * m + 0.15 * Math.sin(m));
    const progress = (11 - m) / 11;
    out.push({
      month: format(subMonths(DEMO_NOW, m), "MMM yy"),
      grossLoans: t.grossLoans * (1 - 0.011 * m + wiggle),
      nplRatio: m === 0 ? t.nplRatio : Math.max(0, t.nplRatio + 0.07 * m + 0.12 * Math.sin(m * 0.9)),
      stage1: 100 - s2 - s3,
      stage2: s2,
      stage3: s3,
      warr: m === 0 ? warrNow : warrOpen + (warrNow - warrOpen) * progress + 0.04 * Math.sin(m * 1.7),
      pipeline: pipelineValue * (0.75 + 0.35 * hash01(`pipe:${m}`)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// CBA reconciliation (simulated connector)
// ---------------------------------------------------------------------------------------------------------------

export type ReconLine = { id: string; ledger: string; spine: number; cba: number; difference: number; status: "Reconciled" | "Break — under review"; note?: string };

/** Reconciliation of spine totals to the (simulated) CBA general ledger, by product group. */
export function reconciliation(all: Facility[]): ReconLine[] {
  const fac = liveFacilities(all);
  const groups: Array<[string, (f: Facility) => boolean]> = [
    ["Overdrafts & revolving credit", (f) => f.product === "Overdraft" || f.product === "Revolving credit"],
    ["Term loans & advances", (f) => ["Term loan", "Invoice discounting", "Mortgage"].includes(f.product)],
    ["Leases & asset finance", (f) => f.product === "Lease finance" || f.product === "Asset finance"],
    ["Trade finance (LC)", (f) => f.product === "Trade finance (LC)"],
  ];
  return groups.map(([ledger, test], i) => {
    const spine = sum(fac.filter(test), onBalance);
    // TD-502: simulated suspense break on the overdraft ledger so the reconciliation workflow is visible.
    const diff = i === 0 ? Math.round(spine * 0.0004 / 1e5) * 1e5 : 0;
    return {
      id: `REC-${i + 1}`,
      ledger,
      spine,
      cba: spine + diff,
      difference: diff,
      status: diff ? "Break — under review" : "Reconciled",
      note: diff ? "Unposted suspense item (inter-branch) ageing 2 days — Section 5.1 clearance window" : undefined,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Forward-looking projection (§6.6.7) — simulated engine output
// ---------------------------------------------------------------------------------------------------------------

export type Scenario = "Base" | "Upside" | "Downside";
export const SCENARIOS: Scenario[] = ["Base", "Upside", "Downside"];

/** Macro variables carried in the External Data Feeds layer (§5.5). Values are demo feed values. */
export const macroVariables = [
  { id: "mpr", variable: "Monetary Policy Rate", source: "CBN publications", current: "27.25%", trend: "Easing", use: "Funding-cost trend; deposit repricing by sector" },
  { id: "crr", variable: "Cash Reserve Ratio", source: "CBN publications", current: "45.0%", trend: "Stable", use: "Funding-cost trend" },
  { id: "inf", variable: "Headline inflation (y/y)", source: "NBS / CBN", current: "18.4%", trend: "Easing", use: "Real-income and repayment capacity, consumer-facing sectors" },
  { id: "food", variable: "Food inflation (y/y)", source: "NBS / CBN", current: "21.1%", trend: "Easing", use: "Agriculture and retail repayment capacity" },
  { id: "fx", variable: "NGN/USD (official)", source: "CBN / FX market feed", current: "₦1,512", trend: "Stable", use: "Import-dependent cost pass-through; FX-exposed obligor stress" },
  { id: "oil", variable: "Brent crude (US$/bbl) & production (mbpd)", source: "Global commodity-price feed", current: "$71 · 1.62", trend: "Softening", use: "Oil & gas cash flow; government-linked liquidity" },
  { id: "gdp", variable: "Real GDP growth (y/y)", source: "NBS", current: "3.6%", trend: "Improving", use: "Demand-side confirmation of Life-Cycle direction" },
  { id: "pmi", variable: "Purchasing Managers' Index", source: "CBN Business Expectations Survey", current: "52.3", trend: "Expansion", use: "Leading indicator for corporate/SME turning points" },
  { id: "tb", variable: "364-day Treasury bill yield", source: "CBN / DMO", current: "19.8%", trend: "Easing", use: "HQLA valuation feeding liquidity metrics" },
];

export type CyclePhase = "Expansion" | "Peak" | "Contraction" | "Trough";
export type LifeCycle = "Emerging" | "Growth" | "Maturity" | "Decline";

const sectorDrivers: Record<string, string[]> = {
  "SEC-AGR": ["Food inflation", "NGN/USD"],
  "SEC-MIN": ["NGN/USD", "Real GDP growth"],
  "SEC-MFG": ["NGN/USD", "PMI", "Headline inflation"],
  "SEC-OGU": ["Brent crude & production", "NGN/USD"],
  "SEC-OGD": ["NGN/USD", "Brent crude"],
  "SEC-PWR": ["NGN/USD", "MPR"],
  "SEC-CON": ["MPR", "Real GDP growth"],
  "SEC-RES": ["MPR", "Headline inflation"],
  "SEC-COM": ["Headline inflation", "NGN/USD"],
  "SEC-TRN": ["NGN/USD", "Brent crude"],
  "SEC-ICT": ["NGN/USD", "PMI"],
  "SEC-FIN": ["MPR", "Treasury bill yield"],
  "SEC-EDU": ["Headline inflation"],
  "SEC-HLT": ["NGN/USD", "Headline inflation"],
  "SEC-GOV": ["Brent crude & production", "Treasury bill yield"],
};

export type SectorProjection = {
  sector: Sector;
  lifeCycle: LifeCycle;
  phase: CyclePhase;
  currentNpl: number;
  /** Projected NPL ratio [low, mid, high] at 3/6/12 months (base scenario). */
  m3: [number, number, number];
  m6: [number, number, number];
  m12: [number, number, number];
  rollRate12: number;
  drivers: string[];
  direction: "Improving" | "Stable" | "Deteriorating";
};

const lifeCycles: LifeCycle[] = ["Emerging", "Growth", "Maturity", "Decline"];
const phases: CyclePhase[] = ["Expansion", "Peak", "Contraction", "Trough"];

/** Scenario multipliers on the base drift (demo calibration of the simulated projection engine — TD-503). */
export const scenarioShift: Record<Scenario, number> = { Base: 0, Upside: -0.35, Downside: 0.9 };

/** Per-sector 3/6/12-month projected NPL range under a scenario. */
export function sectorProjections(all: Facility[], obligors: Obligor[], sectors: Sector[], scenario: Scenario = "Base"): SectorProjection[] {
  const byId = new Map(obligors.map((o) => [o.id, o]));
  const shift = scenarioShift[scenario];
  const worseAbove = 1 + getRule<number>(PORTFOLIO_RULES.projectionDeterioratingAbovePct) / 100;
  const betterBelow = 1 - getRule<number>(PORTFOLIO_RULES.projectionImprovingBelowPct) / 100;
  return sectors.map((s) => {
    const list = all.filter((f) => byId.get(f.obligorId)?.sectorId === s.id);
    const current = nplRatio(list);
    const h = hash01(`${s.id}:cycle`);
    const phase = phases[Math.floor(h * 4)]!;
    const lifeCycle = lifeCycles[Math.floor(hash01(`${s.id}:life`) * 4)]!;
    const phaseDrift = phase === "Contraction" ? 0.55 : phase === "Peak" ? 0.2 : phase === "Trough" ? 0.05 : -0.15;
    const lifeDrift = lifeCycle === "Decline" ? 0.35 : lifeCycle === "Maturity" ? 0.1 : lifeCycle === "Growth" ? -0.05 : 0.15;
    const base = Math.max(current, 0.6 + 2.2 * hash01(`${s.id}:npl`));
    const at = (months: number): [number, number, number] => {
      const mid = Math.max(0.2, base * (1 + (phaseDrift + lifeDrift + shift) * (months / 12)));
      const band = mid * (0.12 + 0.02 * months);
      return [Math.max(0, mid - band), mid, mid + band];
    };
    const m12 = at(12);
    return {
      sector: s,
      lifeCycle,
      phase,
      currentNpl: current,
      m3: at(3),
      m6: at(6),
      m12,
      rollRate12: Math.max(0.5, 2 + 6 * (phaseDrift + lifeDrift + shift) + 3 * hash01(`${s.id}:roll`)),
      drivers: sectorDrivers[s.id] ?? ["Real GDP growth"],
      direction: m12[1] > base * worseAbove ? "Deteriorating" : m12[1] < base * betterBelow ? "Improving" : "Stable",
    };
  });
}

/** Bank-wide projected NPL ratio path for each scenario, 12 months forward (simulated engine calibration — TD-503). */
export function bookProjection(currentNpl: number) {
  const months = Array.from({ length: 13 }, (_, m) => format(addMonths(DEMO_NOW, m), "MMM yy"));
  const drift: Record<Scenario, number> = { Base: 0.018, Upside: -0.012, Downside: 0.075 };
  return SCENARIOS.map((sc) => ({
    name: sc,
    points: months.map((x, m) => ({ x, y: currentNpl * (1 + drift[sc] * m + (sc === "Downside" ? 0.002 * m * m : 0)) })),
  }));
}

/** Projected WARR by scenario (forward-looking WARR, §6.6.9). */
export function projectedWarr(current: WarrResult["warr"]) {
  return SCENARIOS.map((sc) => ({ scenario: sc, m6: current + (sc === "Base" ? 0.06 : sc === "Upside" ? -0.08 : 0.32), m12: current + (sc === "Base" ? 0.11 : sc === "Upside" ? -0.14 : 0.61) }));
}

// ---------------------------------------------------------------------------------------------------------------
// Annual portfolio plan (§6.6.8) — seed plan versions
// ---------------------------------------------------------------------------------------------------------------

export type PlanLine = { sectorId: string; targetPct: number; budgetedDisbursement: number; targetYieldPct: number };
/** Seed status of a plan version; approval state afterwards lives in the store (set by the Operations workflow). */
export type PlanVersion = { id: string; name: string; version: number; status: "Board-approved" | "Draft" | "Uploaded — validating"; uploadedAt: string; uploadedBy: string; fileName: string; targetBook: number; lines: PlanLine[] };

/** FY2026 Board-approved plan (v1) and the mid-year revision (v2), derived from sector limits. */
export function seedPlanVersions(sectors: Sector[], grossLoans: number): PlanVersion[] {
  const target = Math.round((grossLoans * 1.12) / 1e9) * 1e9;
  const weights = sectors.map((s) => s.limitPct * (0.55 + 0.4 * hash01(`${s.id}:plan`)));
  const total = weights.reduce((a, b) => a + b, 0);
  const v1: PlanLine[] = sectors.map((s, i) => ({
    sectorId: s.id,
    targetPct: Math.round(((weights[i]! / total) * 100) * 10) / 10,
    budgetedDisbursement: Math.round(((weights[i]! / total) * target * 0.6) / 1e8) * 1e8,
    targetYieldPct: Math.round((21 + 6 * hash01(`${s.id}:yield`)) * 10) / 10,
  }));
  const v2 = v1.map((l) => (l.sectorId === "SEC-ICT" ? { ...l, targetPct: l.targetPct + 1.5 } : l.sectorId === "SEC-OGU" ? { ...l, targetPct: Math.max(0, l.targetPct - 1.5) } : l));
  return [
    { id: "PLAN-2026-V1", name: "FY2026 Annual Portfolio Plan", version: 1, status: "Board-approved", uploadedAt: "2026-01-14T10:20:00+01:00", uploadedBy: "Portfolio & MIS Officer", fileName: "FY2026_Portfolio_Plan_Board_Approved.xlsx", targetBook: target, lines: v1 },
    { id: "PLAN-2026-V2", name: "FY2026 Mid-year revision", version: 2, status: "Draft", uploadedAt: "2026-07-08T15:05:00+01:00", uploadedBy: "Portfolio & MIS Officer", fileName: "FY2026_Plan_MidYear_Revision.xlsx", targetBook: target, lines: v2 },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Report catalogue (§6.6.6)
// ---------------------------------------------------------------------------------------------------------------

export type ReportDef = {
  id: string;
  name: string;
  audience: "CBN return" | "Board pack" | "MIS";
  cadence: "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Annual";
  prd: string;
  description: string;
  phase: 1 | 2;
};

/**
 * Report catalogue. Cadence is a business rule per report (`portfolio.reportCadence.<id>`, read with `reportCadence`);
 * exact CBN return codes/templates are a tenant/regulator configuration (see OPEN-QUESTIONS, TD-505).
 */
export const reportCatalogue: ReportDef[] = [
  { id: "RPT-SOL", name: "Sectoral & single-obligor limit report", audience: "CBN return", cadence: "Monthly", prd: "§6.6.2, CBN 3.2–3.3", description: "Sector exposure vs internal limits, obligor exposure vs 20% SHF limit, government 10% ceiling.", phase: 1 },
  { id: "RPT-LEX", name: "Large exposures return", audience: "CBN return", cadence: "Monthly", prd: "§6.6.5, CBN 3.2(d)–(e)", description: "Obligors ≥10% of shareholders' funds and the 8× aggregate ceiling.", phase: 1 },
  { id: "RPT-PRU", name: "Credit portfolio by CBN prudential classification", audience: "CBN return", cadence: "Monthly", prd: "§6.6.6, CBN 12.1", description: "Performing / Watchlist / Substandard / Doubtful / Lost, re-aggregated on the CBN sector classification.", phase: 1 },
  { id: "RPT-NPL", name: "Non-performing loans & provisioning return", audience: "CBN return", cadence: "Quarterly", prd: "§6.6.5, CBN 12.2", description: "NPL to gross loans, provisioning level and specific provisions by class.", phase: 1 },
  { id: "RPT-TOP", name: "Top 10 / 20 / 50 / 100 concentration report", audience: "Board pack", cadence: "Monthly", prd: "§6.6.3", description: "Ranked obligor concentration with sector, product mix, IFRS 9 stage and 360 RAR posture.", phase: 1 },
  { id: "RPT-WARR", name: "WARR & rating migration", audience: "Board pack", cadence: "Quarterly", prd: "§6.6.9", description: "Whole-book and segment WARR, new vs existing book, migration matrix and drivers.", phase: 1 },
  { id: "RPT-BRC", name: "Board Risk Committee pack", audience: "Board pack", cadence: "Quarterly", prd: "§6.6.6, §6.11", description: "Risk appetite scorecard, concentration, WARR, IFRS 9 stage migration, KRIs.", phase: 1 },
  { id: "RPT-LSU", name: "Lending Support Update (MIS)", audience: "MIS", cadence: "Weekly", prd: "§6.6.1", description: "Application & portfolio dashboards: type, sector, stage, product, tenor, rating.", phase: 1 },
  { id: "RPT-DPD", name: "Daily past-due & exception register", audience: "MIS", cadence: "Daily", prd: "§6.4.1, §8", description: "Past-due facilities (value and number) by DPD bucket and branch.", phase: 1 },
  { id: "RPT-RAROC", name: "Sector performance — capital consumption & RAROC", audience: "MIS", cadence: "Quarterly", prd: "§6.6.4–6.6.5", description: "RWA, capital consumption, NIM and RAROC by sector.", phase: 2 },
  { id: "RPT-PLAN", name: "Annual plan variance report", audience: "Board pack", cadence: "Monthly", prd: "§6.6.8", description: "Actual vs original plan vs cycle-adjusted recommendation.", phase: 2 },
];

// ---------------------------------------------------------------------------------------------------------------
// Tenant sector → CBN classification mapping (§6.6.1) — percentage split where a tenant sector is broader
// ---------------------------------------------------------------------------------------------------------------

/** Mandatory mapping of each tenant sector code to one or more CBN standard industry classes (demo mapping — TD-504). */
export const cbnSectorMap: Record<string, Array<{ cbn: string; pct: number }>> = {
  "SEC-AGR": [{ cbn: "Agriculture", pct: 100 }],
  "SEC-MIN": [{ cbn: "Mining & Quarrying", pct: 100 }],
  "SEC-MFG": [{ cbn: "Manufacturing", pct: 100 }],
  "SEC-OGU": [{ cbn: "Oil & Gas", pct: 100 }],
  "SEC-OGD": [{ cbn: "Oil & Gas", pct: 100 }],
  "SEC-PWR": [{ cbn: "Power", pct: 100 }],
  "SEC-CON": [{ cbn: "Building & Construction", pct: 100 }],
  "SEC-RES": [{ cbn: "Real Estate", pct: 100 }],
  "SEC-COM": [{ cbn: "General Commerce", pct: 100 }],
  "SEC-TRN": [{ cbn: "Transportation", pct: 80 }, { cbn: "Maritime", pct: 20 }],
  "SEC-ICT": [{ cbn: "Information Technology", pct: 60 }, { cbn: "Telecommunication", pct: 40 }],
  "SEC-FIN": [{ cbn: "Financial Services", pct: 100 }],
  "SEC-EDU": [{ cbn: "Education & Educational Services", pct: 100 }],
  "SEC-HLT": [{ cbn: "Health & Medical Services", pct: 100 }],
  "SEC-GOV": [{ cbn: "Public Sector", pct: 100 }],
};

/** Re-aggregate tenant-sector exposure onto the CBN classification. */
export function reaggregateToCbn(rows: Array<{ sectorId: string; exposure: number; npl: number }>) {
  const map = new Map<string, { cbn: string; exposure: number; npl: number; sources: string[] }>();
  for (const r of rows) {
    for (const m of cbnSectorMap[r.sectorId] ?? [{ cbn: "Unmapped", pct: 100 }]) {
      const cur = map.get(m.cbn) ?? { cbn: m.cbn, exposure: 0, npl: 0, sources: [] };
      cur.exposure += (r.exposure * m.pct) / 100;
      cur.npl += (r.npl * m.pct) / 100;
      cur.sources.push(m.pct === 100 ? r.sectorId : `${r.sectorId} (${m.pct}%)`);
      map.set(m.cbn, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.exposure - a.exposure);
}

export const REPORT_CADENCES: ReportDef["cadence"][] = ["Daily", "Weekly", "Monthly", "Quarterly", "Annual"];
export const reportCadenceRuleKey = (id: string) => `portfolio.reportCadence.${id}`;
/** Effective cadence of a report (business rule; falls back to the catalogue default). */
export function reportCadence(rep: ReportDef): ReportDef["cadence"] {
  return getRule<ReportDef["cadence"]>(reportCadenceRuleKey(rep.id));
}
