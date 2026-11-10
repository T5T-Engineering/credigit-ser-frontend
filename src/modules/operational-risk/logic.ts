/** Operational Risk derived figures (KRI readings, escalation levels, RCSA scores). */
import { kriRag, monthsOutsideGreen, type Kri } from "./data";
import type { KriEscalation, ThresholdChange } from "./store";
import { effectiveThresholds } from "./store";
import type { Rag } from "./shared";

export type KriReading = Kri & {
  current: number;
  previous: number;
  rag: Rag;
  /** Months outside green, ending now. */
  persistence: number;
  level: 0 | 1 | 2 | 3 | 4;
  acknowledged?: KriEscalation;
};

/** Escalation ladder for operational exceptions (PRD §6.9.1 / §6.4.4 applied to KRIs). */
export const escalationLevels = [
  { level: 1, title: "Level 1 — Operational Risk Analyst + control owner", note: "Raised on first Amber/Red reading" },
  { level: 2, title: "Level 2 — Head of Risk", note: "Red uncured after the Level 1 SLA" },
  { level: 3, title: "Level 3 — Chief Risk Officer", note: "Red uncured after the Level 2 SLA" },
  { level: 4, title: "Level 4 — Board Risk Committee notification", note: "Material breaches; re-notified until cured" },
] as const;

export function readKris(kris: Kri[], escalations: Record<string, KriEscalation>, changes: ThresholdChange[]): KriReading[] {
  return kris.map((k) => {
    const t = effectiveThresholds(k.id, k.amber, k.red, changes);
    const kk = { ...k, ...t };
    const current = k.history[k.history.length - 1]!;
    const rag = kriRag(kk, current);
    const persistence = monthsOutsideGreen(kk);
    const auto: KriReading["level"] = rag === "green" ? 0 : rag === "amber" ? 1 : (Math.min(3, Math.max(1, persistence)) as 1 | 2 | 3);
    const esc = escalations[k.id];
    const level = rag === "green" ? 0 : ((esc ? Math.max(esc.level, auto) : auto) as KriReading["level"]);
    return { ...kk, current, previous: k.history[k.history.length - 2]!, rag, persistence, level, acknowledged: esc };
  });
}

export const riskScore = (p: { likelihood: number; impact: number }) => p.likelihood * p.impact;

/** 5×5 heat-map band (demo banding; tenant-configurable). */
export function scoreBand(score: number): { label: "Low" | "Medium" | "High" | "Critical"; tone: "success" | "warning" | "danger" | "accent" } {
  if (score >= 15) return { label: "Critical", tone: "danger" };
  if (score >= 10) return { label: "High", tone: "accent" };
  if (score >= 5) return { label: "Medium", tone: "warning" };
  return { label: "Low", tone: "success" };
}

export const likelihoodLabels = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
export const impactLabels = ["Insignificant", "Minor", "Moderate", "Major", "Severe"];
