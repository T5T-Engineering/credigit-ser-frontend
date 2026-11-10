"use client";

/** Operational Risk derived figures (KRI readings, escalation levels, RCSA scores). Rules are read at call time. */
import { useMemo } from "react";
import { getRule } from "@/lib/platform/rules";
import type { RoleId } from "@/lib/rbac/roles";
import { kriRag, kris as kriDefs, lossKriBackfill, monthlyNetLoss, monthsOutsideGreen, type Kri, type LossEvent } from "./data";
import { orKeys } from "./platform";
import type { KriEscalation } from "./store";
import { useOpRisk } from "./store";
import { roleNames, round, useRuleValues, type Rag } from "./shared";

export type KriReading = Kri & {
  current: number;
  previous: number;
  rag: Rag;
  /** Months outside green, ending now. */
  persistence: number;
  level: 0 | 1 | 2 | 3 | 4;
  acknowledged?: KriEscalation;
};

const levelNotes = {
  1: "Raised on first Amber/Red reading",
  2: "Red uncured after the Level 1 SLA",
  3: "Red uncured after the Level 2 SLA",
  4: "Material breaches; re-notified until cured",
} as const;

/** Escalation ladder for operational exceptions (PRD §6.9.1 / §6.4.4 applied to KRIs) — roles from business rules. */
export function escalationLevels(): { level: 1 | 2 | 3 | 4; roles: RoleId[]; title: string; note: string }[] {
  return ([1, 2, 3, 4] as const).map((level) => {
    const roles = getRule<RoleId[]>(orKeys.escalationRoles(level));
    const who = roleNames(roles) + (level === 1 ? " + control owner" : "");
    return { level, roles, title: `Level ${level} — ${who}`, note: levelNotes[level] };
  });
}

/** Thresholds in force for a KRI (business rules). */
export function kriThresholds(kriId: string): { amber: number; red: number } {
  return { amber: getRule<number>(orKeys.kriAmber(kriId)), red: getRule<number>(orKeys.kriRed(kriId)) };
}

/** KRI-LE-01 history: back-fill + net loss by month ÷ current monthly loss limit. */
function lossKriHistory(events: LossEvent[]): number[] {
  const limit = getRule<number>(orKeys.monthlyNetLimit);
  return [...lossKriBackfill, ...monthlyNetLoss(events, 12).slice(0, 12).map((m) => round((m.value / limit) * 100, 0))];
}

export function readKris(kris: Kri[], escalations: Record<string, KriEscalation>, lossEvents: LossEvent[]): KriReading[] {
  return kris.map((k) => {
    const kk: Kri = { ...k, ...kriThresholds(k.id), history: k.id === "KRI-LE-01" ? lossKriHistory(lossEvents) : k.history };
    const current = kk.history[kk.history.length - 1]!;
    const rag = kriRag(kk, current);
    const persistence = monthsOutsideGreen(kk);
    // TD-904: auto level = months outside green (no per-level SLA clock in the demo data).
    const auto: KriReading["level"] = rag === "green" ? 0 : rag === "amber" ? 1 : (Math.min(3, Math.max(1, persistence)) as 1 | 2 | 3);
    const esc = escalations[k.id];
    const level = rag === "green" ? 0 : ((esc ? Math.max(esc.level, auto) : auto) as KriReading["level"]);
    return { ...kk, current, previous: kk.history[kk.history.length - 2]!, rag, persistence, level, acknowledged: esc };
  });
}

/** Live KRI readings — recompute when escalations, loss events or any business rule changes. */
export function useKriReadings(): KriReading[] {
  const escalations = useOpRisk((s) => s.escalations);
  const lossEvents = useOpRisk((s) => s.lossEvents);
  const rules = useRuleValues();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `rules` is the change signal for getRule()
  return useMemo(() => readKris(kriDefs, escalations, lossEvents), [escalations, lossEvents, rules]);
}

export const riskScore = (p: { likelihood: number; impact: number }) => p.likelihood * p.impact;

export type ScoreBand = { label: "Low" | "Medium" | "High" | "Critical"; tone: "success" | "warning" | "danger" | "accent" };

/** Heat-map band from the RCSA scoring rules. */
export function scoreBand(score: number): ScoreBand {
  if (score >= getRule<number>(orKeys.rcsaCriticalFrom)) return { label: "Critical", tone: "danger" };
  if (score >= getRule<number>(orKeys.rcsaHighFrom)) return { label: "High", tone: "accent" };
  if (score >= getRule<number>(orKeys.rcsaMediumFrom)) return { label: "Medium", tone: "warning" };
  return { label: "Low", tone: "success" };
}

/** Likelihood / impact scale labels (rules); the scale size is the number of labels. */
export function riskScales(): { likelihood: string[]; impact: string[] } {
  return { likelihood: getRule<string[]>(orKeys.rcsaLikelihoodLabels), impact: getRule<string[]>(orKeys.rcsaImpactLabels) };
}

/** Legend for the heat map built from the banding rules. */
export function scoreLegend(): { label: string; tone: ScoreBand["tone"] }[] {
  const med = getRule<number>(orKeys.rcsaMediumFrom);
  const high = getRule<number>(orKeys.rcsaHighFrom);
  const crit = getRule<number>(orKeys.rcsaCriticalFrom);
  const { likelihood, impact } = riskScales();
  return [
    { label: `Low (1–${med - 1})`, tone: "success" },
    { label: `Medium (${med}–${high - 1})`, tone: "warning" },
    { label: `High (${high}–${crit - 1})`, tone: "accent" },
    { label: `Critical (${crit}–${likelihood.length * impact.length})`, tone: "danger" },
  ];
}

/** BCM targets in force for a plan (rules). */
export function planTargets(planId: string): { rtoHours: number; rpoMinutes: number } {
  return { rtoHours: getRule<number>(orKeys.bcmRto(planId)), rpoMinutes: getRule<number>(orKeys.bcmRpo(planId)) };
}
