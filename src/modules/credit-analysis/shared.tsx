"use client";

/** Small module-level compositions of @credigit/web-ui pieces shared by the Credit Analysis pages. */
import { Badge, Tooltip } from "@credigit/web-ui";
import { postureTone, type RarPosition } from "@/lib/rar";
import type { Posture } from "@/lib/data/types";

export const postureOrder: Posture[] = ["Aggressive", "Competitive", "Conservative", "Defensive"];

/** Tone for a position (Neutral / Transitional shows as neutral). */
export const positionTone = (p: RarPosition) => (p.neutral ? "neutral" : postureTone[p.base]);

/** Posture label badge: "Moderately Aggressive · Internally-Led" or "Neutral / Transitional". */
export function PostureBadge({ position, compact }: { position: RarPosition; compact?: boolean }) {
  const text = position.neutral ? "Neutral / Transitional" : `${position.intensity} ${position.base}`;
  const badge = (
    <Badge tone={positionTone(position)} dot>
      {text}
      {!compact && !position.neutral ? ` · ${position.lead}` : null}
    </Badge>
  );
  return compact && !position.neutral ? (
    <Tooltip content={`${position.label} — magnitude ${position.magnitude.toFixed(2)}`}>
      <span>{badge}</span>
    </Tooltip>
  ) : (
    badge
  );
}

export const assessmentHref = (id: string) => `/credit-analysis/assessment?id=${encodeURIComponent(id)}`;

export const score1 = (n: number) => n.toFixed(1);
