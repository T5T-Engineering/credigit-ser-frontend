/**
 * 360 RAR assessment logic for the Credit Analysis module (PRD §6.2).
 *
 * Score derivation (prototype):
 * 1. Each obligor's stored cardinal-point scores (Risk Data Spine, `obligor.rar`) are the system of record.
 * 2. Parameter-level scores are generated deterministically from the obligor id so that, with equal weighting
 *    ("tenant-configurable weighting (demo: equal)"), they average exactly to the stored cardinal score. For North,
 *    parameters average to the PRE-overlay score; the Confidence Overlay (COP band) then dampens it to the stored score.
 *    South's Industry Growth Rate and Life-Cycle Stage are pinned to the NGX corpus for the obligor's sector.
 * 3. Analyst adjustments override individual parameter scores; cardinal averages, composites and posture are
 *    recomputed with the shared formula in `@/lib/rar` (never forked here).
 */
import { createSeed } from "@/lib/data/seed";
import { getRule } from "@/lib/platform/rules";
import type { Application } from "@/lib/data/types";
import { rarPosition, rarMidpoint, type RarPosition } from "@/lib/rar";
import type { Obligor, Posture, RarScores } from "@/lib/data/types";
import {
  cardinalByKey,
  cardinalPoints,
  formatObserved,
  observedFromScore,
  parameters,
  qualitativeLabel,
  scoreFromObserved,
  type CardinalKey,
  type RarParameter,
} from "./parameters";
import {
  corpusMetricByKey,
  lifeCycleScore,
  ngxForSector,
  percentileRank,
  REFRESH_LABELS,
  rngFor,
  round,
  sectorDistribution,
  type LifeCycleStage,
  type NgxSector,
  type WalletData,
} from "./data";

// ---------------- Seed baseline ----------------

let seedRarCache: Map<string, RarScores> | null = null;
/** Baseline (pre-adjustment) cardinal scores from the deterministic seed. */
export function seedRar(id: string): RarScores | undefined {
  if (!seedRarCache) seedRarCache = new Map(createSeed().obligors.map((o) => [o.id, o.rar]));
  return seedRarCache.get(id);
}

// ---------------- Confidence Overlay (§6.1.4, §6.2.1) ----------------

export type CopBand = "High Confidence" | "Medium Confidence" | "Low Confidence";

/**
 * COP bands from business rules (PRD §6.1.4 example banding ≥0.85 High, 0.60–0.84 Medium, <0.60 Low) and the
 * Confidence-Overlay dampening of the North average per band (RAR3 — demo values).
 */
export function copBands() {
  return [
    { band: "High Confidence" as const, from: getRule<number>("credit-analysis.cop.highFrom"), tone: "success" as const, penalty: getRule<number>("credit-analysis.cop.dampenHigh") },
    { band: "Medium Confidence" as const, from: getRule<number>("credit-analysis.cop.mediumFrom"), tone: "warning" as const, penalty: getRule<number>("credit-analysis.cop.dampenMedium") },
    { band: "Low Confidence" as const, from: 0, tone: "danger" as const, penalty: getRule<number>("credit-analysis.cop.dampenLow") },
  ];
}

export function copBandFor(cop: number) {
  const list = copBands();
  return list.find((b) => cop >= b.from) ?? list[list.length - 1]!;
}

export const copRatio = (o: Pick<Obligor, "verifiedTurnover" | "declaredTurnover">) => (o.declaredTurnover ? o.verifiedTurnover / o.declaredTurnover : 0);

// ---------------- Parameter scores ----------------

export type ParamOverride = {
  score: number;
  rationale: string;
  by: string;
  at: string;
  /** Second analyst / CCO who approved the change in Operations. */
  approvedBy?: string;
  operationId?: string;
};

export type ParameterReading = {
  param: RarParameter;
  /** System/baseline score (1–10). */
  base: number;
  /** Effective score after any analyst adjustment. */
  score: number;
  override?: ParamOverride;
  /** Observed reading, e.g. "14.2%" or "Growth". */
  observed?: string;
  updatedAt: string;
};

// PRD §6.2 fixed 1–10 score scale (TD-120).
const clamp = (n: number, lo = 1, hi = 10) => Math.min(hi, Math.max(lo, n));

/** n scores (1 decimal) whose mean is exactly `target`, with optional pinned values. */
function balancedScores(key: string, n: number, target: number, pinned: (number | undefined)[]): number[] {
  const r = rngFor(key);
  let vals = Array.from({ length: n }, (_, i) => pinned[i] ?? clamp(target + (r() * 2 - 1) * 2.6));
  const free = vals.map((_, i) => i).filter((i) => pinned[i] === undefined);
  for (let k = 0; k < 20; k++) {
    const diff = target * n - vals.reduce((a, b) => a + b, 0);
    if (Math.abs(diff) < 1e-9) break;
    const movable = free.filter((i) => (diff > 0 ? vals[i]! < 10 : vals[i]! > 1));
    if (!movable.length) break;
    vals = vals.map((v, i) => (movable.includes(i) ? clamp(v + diff / movable.length) : v));
  }
  vals = vals.map((v) => round(v));
  let residual = Math.round((target * n - vals.reduce((a, b) => a + b, 0)) * 10);
  for (let guard = 0; residual !== 0 && guard < 400; guard++) {
    const i = free[guard % free.length]!;
    const step = residual > 0 ? 0.1 : -0.1;
    const next = round(vals[i]! + step);
    if (next >= 1 && next <= 10) {
      vals[i] = next;
      residual += residual > 0 ? -1 : 1;
    }
  }
  return vals;
}

/** Baseline parameter scores for one obligor (deterministic). */
export function baselineScores(o: Obligor): Record<string, number> {
  const base = seedRar(o.id) ?? o.rar;
  const ngx = ngxForSector(o.sectorId);
  const penalty = copBandFor(copRatio(o)).penalty;
  const out: Record<string, number> = {};
  for (const cp of cardinalPoints) {
    const list = parameters.filter((p) => p.point === cp.key);
    const target = cp.key === "internal" ? Math.min(10, round(base.internal + penalty)) : base[cp.key];
    const pinned = list.map((p) => {
      if (!ngx || !p.sectorPinned) return undefined;
      if (p.sectorPinned === "lifecycle") return lifeCycleScore(ngx.lifeCycle);
      return round(scoreFromObserved(p.observed!, ngx.trailingCagr));
    });
    balancedScores(`${o.id}:${cp.key}`, list.length, target, pinned).forEach((v, i) => (out[list[i]!.id] = v));
  }
  return out;
}

function observedText(p: RarParameter, score: number, ngx: NgxSector | undefined): string | undefined {
  if (p.sectorPinned === "lifecycle") return ngx ? ngx.lifeCycle : "No listed proxy";
  if (p.sectorPinned === "growth" && ngx) return formatObserved(p.observed!, ngx.trailingCagr);
  if (p.observed) return formatObserved(p.observed, observedFromScore(p.observed, score));
  if (p.qualitative) return qualitativeLabel(p, score);
  return undefined;
}

// ---------------- Weighting (§6.2 "tenant-configurable weighting") ----------------

export const weightingLabels: Record<string, string> = { equal: "equal weighting within each cardinal point" };

/** Parameter weight (per parameter, once a weight table exists) under the tenant weighting scheme (business rule `credit-analysis.weightingScheme`). */
export function parameterWeight(): number {
  // Only "equal" is defined until the tenant weight table is specified (TD-121, docs/OPEN-QUESTIONS.md RAR4).
  return getRule<string>("credit-analysis.weightingScheme") === "equal" ? 1 : 1;
}

/** Weighted cardinal-point average (1 decimal). */
export function cardinalAverage(readings: { param: RarParameter; score: number }[]): number {
  const w = readings.map(() => parameterWeight());
  const total = w.reduce((a, b) => a + b, 0) || 1;
  return round(readings.reduce((a, r, i) => a + r.score * w[i]!, 0) / total);
}

export const weightingText = () => {
  const scheme = getRule<string>("credit-analysis.weightingScheme");
  return weightingLabels[scheme] ?? scheme;
};

// ---------------- Full assessment ----------------

export type CardinalResult = {
  key: CardinalKey;
  average: number;
  readings: ParameterReading[];
};

export type Assessment = {
  obligor: Obligor;
  ngx?: NgxSector;
  points: Record<CardinalKey, CardinalResult>;
  /** North parameter average before the Confidence Overlay. */
  internalRaw: number;
  cop: number;
  copBand: ReturnType<typeof copBandFor>;
  overlayPenalty: number;
  scores: RarScores;
  position: RarPosition;
  refreshedAt: string;
};

export function assess(o: Obligor, overrides: Record<string, ParamOverride> = {}, refreshedAt?: string): Assessment {
  const ngx = ngxForSector(o.sectorId);
  const baseline = baselineScores(o);
  const cop = copRatio(o);
  const band = copBandFor(cop);
  const at = refreshedAt ?? o.rarUpdatedAt;
  const points = {} as Record<CardinalKey, CardinalResult>;
  for (const cp of cardinalPoints) {
    const readings = parameters
      .filter((p) => p.point === cp.key)
      .map((p) => {
        const base = baseline[p.id]!;
        const ov = overrides[p.id];
        const score = ov ? ov.score : base;
        return {
          param: p,
          base,
          score,
          override: ov,
          observed: observedText(p, base, ngx),
          updatedAt: ov?.at ?? at,
        };
      });
    const average = cardinalAverage(readings);
    points[cp.key] = { key: cp.key, average, readings };
  }
  const internalRaw = points.internal.average;
  const internal = round(clamp(internalRaw - band.penalty));
  const scores: RarScores = {
    internal,
    industry: points.industry.average,
    comparative: points.comparative.average,
    macro: points.macro.average,
  };
  return {
    obligor: o,
    ngx,
    points,
    internalRaw,
    cop,
    copBand: band,
    overlayPenalty: band.penalty,
    scores,
    position: rarPosition(scores),
    refreshedAt: at,
  };
}

/** Refresh cycle: an assessment older than this is stale (business rule `credit-analysis.staleAfterDays`). */
export const staleAfterDays = () => getRule<number>("credit-analysis.staleAfterDays");

export function ageDays(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

// ---------------- 36-cell interpretive layer (§6.2.12) ----------------

export type Band = "Low" | "Medium" | "High";
export const bands: Band[] = ["Low", "Medium", "High"];
/** Score range label per band, from business rules `credit-analysis.band.lowMax` / `.mediumMax` (PRD §6.2.12). */
export function bandRange(b: Band): string {
  const low = getRule<number>("credit-analysis.band.lowMax");
  const mid = getRule<number>("credit-analysis.band.mediumMax");
  return b === "Low" ? `1–${low}` : b === "Medium" ? `${low + 1}–${mid}` : `${mid + 1}–10`;
}

/** PRD bands are integer (1-3 / 4-7 / 8-10); decimal scores are rounded to the nearest whole point first. */
export function bandOf(score: number): Band {
  const s = Math.round(score);
  return s <= getRule<number>("credit-analysis.band.lowMax") ? "Low" : s <= getRule<number>("credit-analysis.band.mediumMax") ? "Medium" : "High";
}

export const interpretiveTables: Record<
  Posture,
  {
    rows: CardinalKey;
    columns: CardinalKey;
    cells: [string, string, string][];
    prd: string;
  }
> = {
  Aggressive: {
    rows: "internal",
    columns: "comparative",
    prd: "§6.2.12.1",
    cells: [
      ["Weakest Cell", "Fragile Lean", "Peer-Reliant"],
      ["Marginal Lean", "Balanced Moderate", "Peer-Led"],
      ["Isolated Strength", "Internally-Led", "Strong Conviction"],
    ],
  },
  Competitive: {
    rows: "comparative",
    columns: "industry",
    prd: "§6.2.12.2",
    cells: [
      ["Weakest Cell", "Cautious Watch", "Sector-Masked Weakness"],
      ["Marginal Position", "Balanced Moderate", "Sector-Carried"],
      ["Relative Outperformer", "Peer-Driven", "Sector Leader"],
    ],
  },
  Conservative: {
    rows: "industry",
    columns: "macro",
    prd: "§6.2.12.3",
    cells: [
      ["Weakest Cell", "Cautious Watch", "Macro-Masked Weakness"],
      ["Marginal Environment", "Balanced Moderate", "Macro-Led"],
      ["Sector Despite Macro", "Sector-Led", "Favourable Backdrop"],
    ],
  },
  Defensive: {
    rows: "macro",
    columns: "internal",
    prd: "§6.2.12.4",
    cells: [
      ["Weakest Cell", "Cautious Watch", "Internally-Led Despite Macro"],
      ["Marginal Resilience", "Balanced Moderate", "Internally Anchored"],
      ["Macro Reliant", "Macro-Supported", "Resilient Position"],
    ],
  },
};

const noun: Record<CardinalKey, string> = {
  internal: "internal risk profile",
  comparative: "comparative standing",
  industry: "operating-industry backdrop",
  macro: "macro-economic environment",
};

/** Narrative refinement for a (row band, column band) pair — drafting assistance, not a score. */
export function cellNarrative(rowKey: CardinalKey, rowBand: Band, colKey: CardinalKey, colBand: Band): string {
  const r = noun[rowKey];
  const c = noun[colKey];
  const k = `${rowBand[0]}${colBand[0]}`;
  const map: Record<string, string> = {
    HH: `Both the ${r} and the ${c} are strong — the reading is well supported on both drivers`,
    HM: `This obligor's position is driven primarily by a strong ${r}, with ${c} a secondary factor`,
    HL: `A strong ${r} stands largely alone — the ${c} is weak, so the result rests on a single driver`,
    MH: `The ${c} is doing most of the work; the ${r} is only adequate`,
    MM: `No single driver dominates — the ${r} and the ${c} are both mid-range`,
    ML: `The ${r} is adequate but the ${c} is weak, so the position leans on the other cardinal points`,
    LH: `The ${c} is strong but the ${r} is weak — the result relies on the ${c}`,
    LM: `The ${r} is weak and the ${c} only adequate — the position is fragile`,
    LL: `Both the ${r} and the ${c} are weak — the weakest combination for this posture`,
  };
  return map[k]!;
}

export type InterpretiveCell = {
  posture: Posture;
  rowKey: CardinalKey;
  colKey: CardinalKey;
  rowBand: Band;
  colBand: Band;
  name: string;
  narrative: string;
  prd: string;
};

export function interpretiveCell(posture: Posture, s: RarScores): InterpretiveCell {
  const t = interpretiveTables[posture];
  const rowBand = bandOf(s[t.rows]);
  const colBand = bandOf(s[t.columns]);
  const name = t.cells[bands.indexOf(rowBand)]![bands.indexOf(colBand)]!;
  return {
    posture,
    rowKey: t.rows,
    colKey: t.columns,
    rowBand,
    colBand,
    name,
    narrative: cellNarrative(t.rows, rowBand, t.columns, colBand),
    prd: t.prd,
  };
}

// ---------------- Recommended outcomes by posture (§6.2.6) ----------------

/** Quadrant rule text for a posture around the live midpoint (business rule `rar.midpoint`). */
export function postureRule(p: Posture): string {
  const m = rarMidpoint();
  const x = p === "Aggressive" || p === "Competitive" ? ">" : "<";
  const y = p === "Aggressive" || p === "Conservative" ? ">" : "<";
  return `X ${x} ${m} · Y ${y} ${m}`;
}

export const postureGuidance: Record<Posture, { recommendation: string; talkingPoints: string }> = {
  Aggressive: {
    recommendation:
      "Supports growth/expansion facilities, longer tenor, and higher single-obligor utilisation within limit; maintain momentum but require standard financial-reporting covenants to preserve visibility as exposure grows.",
    talkingPoints:
      "This is a business and a sector both performing well. Where the customer is also expanding capacity, this is the moment to discuss additional facilities or better pricing for loyalty — but confirm the expansion request is proportionate to the industry's actual growth runway (§6.2.8), not just the customer's ambition.",
  },
  Competitive: {
    recommendation:
      "Attractive industry but financially stretched or exposed to an unstable environment — favour secured structures, shorter tenor, tighter covenants (minimum-turnover, debt-service-coverage), and closer monitoring frequency; avoid open-ended overdraft growth.",
    talkingPoints:
      "The market opportunity is real, but the customer's balance sheet cannot yet fully capitalise on it alone. Advise on working-capital discipline and, where appropriate, discuss additional equity or subordinated funding from sponsors before extending further debt.",
  },
  Conservative: {
    recommendation:
      "Financially strong but operating in a less attractive or maturing/declining industry — favour capital preservation, selective/short-tenor facilities, and discourage large long-tenor expansion asks; a mandatory Credit Analyst note is required addressing why an expansion facility is justified if the industry life-cycle stage (§6.2.8) is Maturity or Decline.",
    talkingPoints:
      "This customer is a strong operator in a market that is not growing quickly. The right conversation is about protecting margin, diversification, or redeploying surplus cash — not aggressive capacity expansion in the existing line of business.",
  },
  Defensive: {
    recommendation:
      "Mandatory CRO referral regardless of facility size; presumption against new/incremental exposure; existing exposure moves to enhanced monitoring (Loan Review, §6.4) with a remediation or exit plan requested from the obligor.",
    talkingPoints:
      "This is a business under pressure in a difficult market. The advisory conversation should focus on early, honest engagement — restructuring options, additional security, or an orderly exit — rather than encouraging further borrowing.",
  },
};

export const overlayGuidance = {
  Strongly: "Proceed with the base posture's stance at full conviction; the advisory note is presented without a confidence caveat.",
  Moderately: "Proceed with the base posture's stance, but the position is not yet firmly entrenched and should be re-tested at the next 360 RAR refresh.",
  Marginally:
    "Provisional: the Credit Analyst records which parameter(s) are closest to flipping the posture, and the front-office conversation is framed around the trend (§6.2.11) rather than the label itself.",
  "Internally-Led":
    "Centre the conversation on how the customer deploys its own balance-sheet capacity — expansion, dividend policy, working-capital efficiency — since its own financial position, not its market, is driving the posture.",
  "Externally-Led":
    "Centre the conversation on whether the customer's execution is keeping pace with its industry/competitive tailwind or headwind, since the external environment is driving the posture more than its own financials.",
  Neutral:
    "No standard posture-driven stance is auto-generated; the Recommendation Engine requires a mandatory Credit Analyst narrative addressing why the request should proceed, referencing Comparative & Peer Benchmarking (§6.2.10) and Trend & Momentum (§6.2.11) insights in place of a posture label.",
} as const;

/** Parameters with the most leverage to flip the posture across the nearest composite midpoint (for Marginal readings). */
export function flipCandidates(a: Assessment, limit = getRule<number>("credit-analysis.advisory.flipCandidates")): { reading: ParameterReading; move: number; axis: "X" | "Y" }[] {
  const dx = a.position.x - rarMidpoint();
  const dy = a.position.y - rarMidpoint();
  const axis: "X" | "Y" = Math.abs(dx) <= Math.abs(dy) ? "X" : "Y";
  const d = Math.abs(axis === "X" ? dx : dy);
  const keys: CardinalKey[] = axis === "X" ? ["industry", "comparative"] : ["internal", "macro"];
  const sign = (axis === "X" ? dx : dy) > 0 ? -1 : 1;
  const out = keys.flatMap((k) =>
    a.points[k].readings.map((reading) => ({
      reading,
      move: round(sign * (d + 0.05) * 2 * a.points[k].readings.length),
      axis,
    })),
  );
  return out
    .filter((c) => {
      const next = c.reading.score + c.move;
      return next >= 1 && next <= 10;
    })
    .sort((p, q) => Math.abs(p.move) - Math.abs(q.move) || q.reading.score - p.reading.score)
    .slice(0, limit);
}

// ---------------- Trend & momentum (§6.2.11) ----------------

export type Momentum = "Accelerating" | "Steady Improving" | "Flat/Stable" | "Steady Deteriorating" | "Accelerating Deterioration";
export const momentumTone: Record<Momentum, "success" | "info" | "neutral" | "warning" | "danger"> = {
  Accelerating: "success",
  "Steady Improving": "info",
  "Flat/Stable": "neutral",
  "Steady Deteriorating": "warning",
  "Accelerating Deterioration": "danger",
};

/**
 * Momentum from the trend line's slope and second-derivative shape (§6.2.11). `higherIsBetter` orients the
 * series so "improving" always means better. `flatBand` = movement treated as flat (demo: 2% of level).
 */
export function momentumOf(values: number[], higherIsBetter = true): { momentum: Momentum; slope: number; accel: number; inflection: boolean } {
  const sgn = higherIsBetter ? 1 : -1;
  const d = values.slice(1).map((v, i) => (v - values[i]!) * sgn);
  const recent = d.slice(-2);
  const slope = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
  const accel = d.length >= 2 ? d[d.length - 1]! - d[d.length - 2]! : 0;
  const level = Math.max(Math.abs(values[values.length - 1] ?? 1), 1e-6);
  const flat = Math.abs(slope) < (getRule<number>("credit-analysis.trend.flatBandPct") / 100) * level;
  const earlier = d.slice(0, -1).reduce((a, b) => a + b, 0);
  const inflection = d.length >= 3 && Math.sign(d[d.length - 1]!) !== 0 && Math.sign(earlier) !== 0 && Math.sign(d[d.length - 1]!) !== Math.sign(earlier);
  const momentum: Momentum = flat
    ? "Flat/Stable"
    : slope > 0
      ? accel > 0
        ? "Accelerating"
        : "Steady Improving"
      : accel < 0
        ? "Accelerating Deterioration"
        : "Steady Deteriorating";
  return { momentum, slope, accel, inflection };
}

/** Annualised rate of change: CAGR where the series stays positive, otherwise pp per year. */
export function rateOfChange(values: number[]): {
  value: number;
  kind: "CAGR" | "pp/yr";
} {
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const years = values.length - 1;
  if (first > 0 && last > 0)
    return {
      value: (Math.pow(last / first, 1 / years) - 1) * 100,
      kind: "CAGR",
    };
  return { value: (last - first) / years, kind: "pp/yr" };
}

export const FY_LABELS = ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"];

export type RatioTrend = {
  reading: ParameterReading;
  metric: NonNullable<RarParameter["corpusMetric"]>;
  label: string;
  higherIsBetter: boolean;
  obligor: number[];
  sector?: number[];
  momentum: ReturnType<typeof momentumOf>;
  roc: ReturnType<typeof rateOfChange>;
  sectorRoc?: ReturnType<typeof rateOfChange>;
  yoy: number;
  relative?: "Gaining ground" | "Losing ground" | "In line with sector";
  format: (v: number) => string;
};

/** Five-year ratio history ending at the current observed value (obligor) next to the NGX sector series. */
export function ratioTrends(a: Assessment): RatioTrend[] {
  const inLine = getRule<number>("credit-analysis.trend.inLineTolerance");
  // Demo history generator (data, not policy): drift is centred on the scale midpoint.
  const trendScore = a.points.internal.readings.find((r) => r.param.id === "N11")?.score ?? 5.5;
  return a.points.internal.readings
    .filter((r) => r.param.corpusMetric && r.param.observed)
    .map((reading) => {
      const metric = reading.param.corpusMetric!;
      const meta = corpusMetricByKey[metric];
      const spec = reading.param.observed!;
      const current = observedFromScore(spec, reading.score);
      const r = rngFor(`${a.obligor.id}:${metric}:trend`);
      const span = Math.abs(spec.best - spec.worst);
      // Better trend score → history that improves into the current value.
      const drift = ((trendScore - 5.5) / 4.5) * span * 0.035 * (meta.higherIsBetter ? 1 : -1) + (r() * 2 - 1) * span * 0.02;
      const bend = (r() * 2 - 1) * span * 0.012;
      const obligor = [4, 3, 2, 1, 0].map((k) => round(current - drift * k - bend * k * k + (k ? (r() * 2 - 1) * span * 0.01 : 0), meta.digits));
      const sector = a.ngx ? a.ngx.series.slice(-5).map((y) => y[metric]) : undefined;
      const momentum = momentumOf(obligor, meta.higherIsBetter);
      const roc = rateOfChange(obligor);
      const sectorRoc = sector ? rateOfChange(sector) : undefined;
      const yoy = obligor[4]! - obligor[3]!;
      let relative: RatioTrend["relative"];
      if (sectorRoc && sectorRoc.kind === roc.kind) {
        const diff = (roc.value - sectorRoc.value) * (meta.higherIsBetter ? 1 : -1);
        relative = Math.abs(diff) < inLine ? "In line with sector" : diff > 0 ? "Gaining ground" : "Losing ground";
      } else if (sector) {
        const own = (obligor[4]! - obligor[0]!) * (meta.higherIsBetter ? 1 : -1);
        const sec = (sector[4]! - sector[0]!) * (meta.higherIsBetter ? 1 : -1);
        relative = Math.abs(own - sec) < inLine ? "In line with sector" : own > sec ? "Gaining ground" : "Losing ground";
      }
      return {
        reading,
        metric,
        label: meta.label,
        higherIsBetter: meta.higherIsBetter,
        obligor,
        sector,
        momentum,
        roc,
        sectorRoc,
        yoy,
        relative,
        format: (v: number) => formatObserved(spec, v),
      };
    });
}

/** Quarterly cardinal-point history ending at the current scores (deterministic). */
export function axisHistory(a: Assessment): { label: string; scores: RarScores; position: RarPosition }[] {
  const r = rngFor(`${a.obligor.id}:axis-history`);
  const drift = Object.fromEntries(cardinalPoints.map((c) => [c.key, (r() * 2 - 1) * 0.35])) as Record<CardinalKey, number>;
  return REFRESH_LABELS.map((label, i) => {
    const k = REFRESH_LABELS.length - 1 - i;
    const scores = Object.fromEntries(
      cardinalPoints.map((c) => [c.key, k ? round(clamp(a.scores[c.key] - drift[c.key] * k + (r() * 2 - 1) * 0.25)) : a.scores[c.key]]),
    ) as RarScores;
    return { label, scores, position: rarPosition(scores) };
  });
}

// ---------------- Peer benchmarking (§6.2.10) ----------------

/** Standard deviations from the sector mean that flag an outlier (business rule `credit-analysis.peer.outlierSd`). */
export const outlierSd = () => getRule<number>("credit-analysis.peer.outlierSd");

export type RatioBenchmark = {
  reading: ParameterReading;
  label: string;
  value: number;
  format: (v: number) => string;
  dist: ReturnType<typeof sectorDistribution>;
  percentile: number;
  higherIsBetter: boolean;
  outlier: null | "Top decile" | "Bottom decile" | `Beyond ${number} SD`;
  favourable: boolean;
};

export function ratioBenchmarks(a: Assessment): RatioBenchmark[] {
  if (!a.ngx) return [];
  const sdLimit = outlierSd();
  const top = getRule<number>("credit-analysis.peer.topPercentile");
  const bottom = getRule<number>("credit-analysis.peer.bottomPercentile");
  return a.points.internal.readings
    .filter((r) => r.param.corpusMetric && r.param.observed)
    .map((reading) => {
      const metric = reading.param.corpusMetric!;
      const meta = corpusMetricByKey[metric];
      const value = round(observedFromScore(reading.param.observed!, reading.score), meta.digits);
      const dist = sectorDistribution(a.ngx!, metric);
      const percentile = percentileRank(dist, value);
      const z = (value - dist.mean) / (dist.sd || 1);
      const outlier: RatioBenchmark["outlier"] = percentile >= top ? "Top decile" : percentile <= bottom ? "Bottom decile" : Math.abs(z) > sdLimit ? `Beyond ${sdLimit} SD` : null;
      const favourable = meta.higherIsBetter ? percentile >= 50 : percentile <= 50;
      return {
        reading,
        label: meta.label,
        value,
        format: (v: number) => formatObserved(reading.param.observed!, v),
        dist,
        percentile,
        higherIsBetter: meta.higherIsBetter,
        outlier,
        favourable,
      };
    });
}

/** Percentile of `value` within `values` (share at or below, 0–100). */
export function bookPercentile(values: number[], value: number): number {
  if (!values.length) return 50;
  const below = values.filter((v) => v < value).length;
  const equal = values.filter((v) => v === value).length;
  return Math.round(((below + equal / 2) / values.length) * 100);
}

/** Composite peer positioning against the tenant's own book (same sector and size band; broadens if thin). */
export function bookPeers(o: Obligor, all: Obligor[]): { scope: string; peers: Obligor[] } {
  const min = getRule<number>("credit-analysis.peer.minPeers");
  const sameSectorBand = all.filter((x) => x.sectorId === o.sectorId && x.type === o.type && x.id !== o.id);
  if (sameSectorBand.length >= min) return { scope: "Same sector and size band", peers: sameSectorBand };
  const sameSector = all.filter((x) => x.sectorId === o.sectorId && x.id !== o.id);
  if (sameSector.length >= min) return { scope: "Same sector (size band too thin)", peers: sameSector };
  return {
    scope: "Whole book (sector too thin)",
    peers: all.filter((x) => x.id !== o.id),
  };
}

// ---------------- Life-cycle credit gating (§6.2.6) ----------------

export type GatingCheck = {
  applicationId: string;
  tenorMonths: number;
  purpose: string;
  /** Long-tenor (> rule months) expansion/capex request in a hard-exception-stage industry (§6.2.6). */
  flagged: boolean;
  /** Conservative posture + expansion request + analyst-note stage — mandatory Credit Analyst note (§6.2.6). */
  analystNote: boolean;
  stage?: LifeCycleStage;
};

/** Whether a stated purpose is an expansion/capex request (business rule keyword list). */
export function isExpansionPurpose(purpose: string): boolean {
  const words = getRule<string[]>("credit-analysis.gating.expansionKeywords");
  const text = purpose.toLowerCase();
  return words.some((w) => w.trim() && text.includes(w.trim().toLowerCase()));
}

/** Industry Life-Cycle credit gating for an obligor's open applications (§6.2.6); thresholds from business rules. */
export function gatingChecks(a: Assessment, applications: Application[]): GatingCheck[] {
  const closed = getRule<string[]>("credit-analysis.gating.closedStages");
  const longTenor = getRule<number>("credit-analysis.gating.longTenorMonths");
  const hardStages = getRule<string[]>("credit-analysis.gating.hardExceptionStages");
  const noteStages = getRule<string[]>("credit-analysis.gating.analystNoteStages");
  const stage = a.ngx?.lifeCycle;
  return applications
    .filter((x) => x.obligorId === a.obligor.id && !closed.includes(x.stage))
    .map((x) => {
      const expansion = isExpansionPurpose(x.purpose);
      return {
        applicationId: x.id,
        tenorMonths: x.tenorMonths,
        purpose: x.purpose,
        stage,
        flagged: x.tenorMonths > longTenor && expansion && !!stage && hardStages.includes(stage),
        analystNote: !a.position.neutral && a.position.base === "Conservative" && expansion && !!stage && noteStages.includes(stage),
      };
    });
}

// ---------------- AI-drafted advisory note (§6.2.6 + overlays) ----------------

export type AdvisoryContext = {
  a: Assessment;
  cell: InterpretiveCell;
  wallet?: WalletData;
  benchmarks: RatioBenchmark[];
  trends: RatioTrend[];
  gating: GatingCheck[];
};

const pctText = (v: number) => `${Math.round(v * 100)}%`;

export function draftAdvisory({ a, cell, wallet, benchmarks, trends, gating }: AdvisoryContext): string {
  const p = a.position;
  const parts: string[] = [];
  if (p.neutral) {
    parts.push(
      `Neutral / Transitional (magnitude ${p.magnitude.toFixed(2)}). The obligor's internal risk position, industry backdrop, comparative standing and macro-economic exposure are close to net-neutral at the composite level (X ${p.x.toFixed(2)}, Y ${p.y.toFixed(2)}), so no standard posture-driven stance is generated.`,
    );
    parts.push(`MANDATORY CREDIT ANALYST NARRATIVE — explain why the request should proceed, drawing on the peer-benchmarking and trend points below. [Analyst to complete]`);
  } else {
    const g = postureGuidance[p.base];
    parts.push(
      `${p.intensity} ${p.base}, ${p.lead}. Interpretive cell "${cell.name}": ${cell.narrative} (${cardinalByKey[cell.rowKey].short} ${cell.rowBand}, ${cardinalByKey[cell.colKey].short} ${cell.colBand}).`,
    );
    parts.push(`Recommended credit stance: ${g.recommendation}`);
    const intensityNote =
      p.intensity === "Strongly"
        ? "The position is firmly entrenched (Strong intensity), so the stance applies at full conviction."
        : p.intensity === "Moderately"
          ? "Caution: the position is not yet firmly entrenched (Moderate intensity) and should be re-tested at the next 360 RAR refresh."
          : `PROVISIONAL (Marginal intensity, magnitude ${p.magnitude.toFixed(2)}): a small movement in a handful of parameters could flip this obligor into a neighbouring posture, so the conversation should be framed around the trend rather than the label.`;
    parts.push(intensityNote);
    if (p.intensity === "Marginally") {
      const flips = flipCandidates(a);
      if (flips.length)
        parts.push(
          flips
            .map(
              (f) =>
                `- Closest to flipping: ${f.reading.param.name} (${f.reading.score.toFixed(1)}; a move of ${f.move > 0 ? "+" : ""}${f.move.toFixed(1)} would cross the ${f.axis}-midpoint)`,
            )
            .join("\n"),
        );
    }
    parts.push(`Front-office conversation: ${g.talkingPoints} ${overlayGuidance[p.lead]}`);
  }

  const bullets: string[] = [];
  bullets.push(
    `- Confidence Overlay: COP Ratio ${a.cop.toFixed(2)} (${a.copBand.band})${a.overlayPenalty ? ` — declared financials only partly verified against account turnover; Internal Risk dampened from ${a.internalRaw.toFixed(1)} to ${a.scores.internal.toFixed(1)}` : " — declared turnover is well supported by verified account credits"}.${a.copBand.band === "Low Confidence" ? " A documented customer explanation is required before proceeding." : ""}`,
  );
  if (wallet?.available) {
    bullets.push(
      `- Share of Business Wallet: ${wallet.position} (turnover share ${pctText(wallet.turnoverShare)}, loan share ${pctText(wallet.loanShare)}, gap ${wallet.gap >= 0 ? "+" : ""}${Math.round(wallet.gap * 100)} pp). ${
        wallet.position === "Untapped Lending Opportunity" && !p.neutral && (p.base === "Aggressive" || p.base === "Competitive")
          ? "Stronger cross-sell candidate given the posture."
          : wallet.position === "Credit-Concentration Watch"
            ? "Seek proceeds domiciliation / minimum-turnover covenant."
            : ""
      }`.trim(),
    );
  }
  const outliers = benchmarks.filter((b) => b.outlier);
  for (const b of outliers.slice(0, getRule<number>("credit-analysis.advisory.maxOutlierPoints"))) {
    bullets.push(
      `- Peer benchmark: ${b.label} ${b.format(b.value)} vs sector median ${b.format(b.dist.median)} — ${b.percentile}th percentile (${b.outlier}); ${b.favourable ? "a genuine strength that supports a pricing-power or expansion conversation" : "a structural weakness that points to a working-capital-efficiency conversation rather than expansion"}.`,
    );
  }
  if (!outliers.length && benchmarks.length)
    bullets.push(`- Peer benchmark: no ratio sits in the top or bottom decile of the ${a.ngx?.name} corpus — in-line readings, not a discussion point.`);
  const deteriorating = trends.filter((t) => t.momentum.momentum === "Accelerating Deterioration");
  const improving = trends.filter((t) => t.momentum.momentum === "Accelerating" || t.momentum.momentum === "Steady Improving");
  if (deteriorating.length)
    bullets.push(
      `- Trend & momentum: Accelerating Deterioration on ${deteriorating.map((t) => t.label).join(", ")} — warrants an earlier, more candid conversation; auto-flagged to Loan Review for a monitoring-frequency review.`,
    );
  if (improving.length) {
    const gaining = improving.filter((t) => t.relative === "Gaining ground");
    bullets.push(
      `- Trend & momentum: improving on ${improving.map((t) => t.label).join(", ")}${gaining.length ? ` and gaining ground on the sector for ${gaining.map((t) => t.label).join(", ")}` : ""}.`,
    );
  }
  const inflections = trends.filter((t) => t.momentum.inflection);
  if (inflections.length) bullets.push(`- Inflection detected (AI trend engine): ${inflections.map((t) => t.label).join(", ")} changed direction in FY2025.`);
  if (a.ngx) bullets.push(`- Industry Life-Cycle: ${a.ngx.lifeCycle} (${a.ngx.name}, ${a.ngx.lifeCycleReason.toLowerCase()}).`);
  for (const g of gating.filter((x) => x.flagged))
    bullets.push(
      `- HARD EXCEPTION ${g.applicationId}: ${g.tenorMonths}-month ${g.purpose.toLowerCase()} in a ${g.stage}-stage industry — CCO/CRO override with documented rationale required before passing the Credit Analyst tier.`,
    );
  parts.push(bullets.join("\n"));
  parts.push(`Sector benchmark used: ${a.ngx ? `${a.ngx.name} (NGX corpus)` : "none — no listed proxy"}. Weighting: ${weightingText()} (tenant parameter).`);
  return parts.join("\n\n");
}
