/**
 * 360 RAR composite position and posture (PRD §6.2.5).
 *
 * X-Composite = Operating Industry + Comparative; Y-Composite = Internal Risk + Macro-Economic.
 * OPEN QUESTION (logged in docs/OPEN-QUESTIONS.md): the PRD writes each composite as "average + average"
 * but maps postures around a 5.5 midpoint on the 1–10 scale. We take each composite as the MEAN of the two
 * cardinal-point averages so it stays on the 1–10 scale the midpoint refers to.
 *
 * Intensity bands (Strong / Moderate / Marginal) and the Neutral/Transitional threshold are tenant parameters
 * in the Rules & Parameters Engine — the values below are demo defaults, not product rules.
 */
import type { Posture, RarScores } from "./data/types";

export const RAR_MIDPOINT = 5.5;

export type IntensityThresholds = { neutralBelow: number; marginalBelow: number; moderateBelow: number };

/** Demo-tenant defaults (configurable in Admin → Rules & parameters). */
export const defaultIntensityThresholds: IntensityThresholds = { neutralBelow: 0.4, marginalBelow: 1.2, moderateBelow: 2.4 };

export type Intensity = "Strongly" | "Moderately" | "Marginally";

export type RarPosition = {
  x: number;
  y: number;
  magnitude: number;
  base: Posture;
  /** null = Neutral / Transitional (the 13th posture state). */
  intensity: Intensity | null;
  neutral: boolean;
  /** Which composite contributes more to the magnitude. */
  lead: "Internally-Led" | "Externally-Led";
  /** e.g. "Moderately Aggressive (Internally-Led)" or "Neutral / Transitional". */
  label: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function rarPosition(s: RarScores, t: IntensityThresholds = defaultIntensityThresholds): RarPosition {
  const x = round2((s.industry + s.comparative) / 2);
  const y = round2((s.internal + s.macro) / 2);
  const dx = x - RAR_MIDPOINT;
  const dy = y - RAR_MIDPOINT;
  const magnitude = round2(Math.sqrt(dx * dx + dy * dy));
  const base: Posture = x > RAR_MIDPOINT ? (y > RAR_MIDPOINT ? "Aggressive" : "Competitive") : y > RAR_MIDPOINT ? "Conservative" : "Defensive";
  const neutral = magnitude < t.neutralBelow;
  const intensity: Intensity | null = neutral ? null : magnitude < t.marginalBelow ? "Marginally" : magnitude < t.moderateBelow ? "Moderately" : "Strongly";
  const lead = Math.abs(dy) >= Math.abs(dx) ? "Internally-Led" : "Externally-Led";
  return { x, y, magnitude, base, intensity, neutral, lead, label: neutral ? "Neutral / Transitional" : `${intensity} ${base} (${lead})` };
}

export const postureTone: Record<Posture, "success" | "info" | "warning" | "danger"> = {
  Aggressive: "success",
  Competitive: "info",
  Conservative: "warning",
  Defensive: "danger",
};
