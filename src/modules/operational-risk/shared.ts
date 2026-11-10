"use client";

/** Small helpers shared by the Operational Risk, ERM and AI modules (deterministic RNG, audit logging). */
import { useCallback } from "react";
import { addMonths, format } from "date-fns";
import type { Tone } from "@credigit/web-ui";
import { DEMO_NOW } from "@/lib/data/seed";
import { useDbActions } from "@/lib/data/hooks";
import { useSession } from "@/lib/auth/session";
import { useDb } from "@/lib/data/store";
import { currentActor } from "@/lib/platform/scope";
import { useRulesStore } from "@/lib/platform/rules";
import { roleById, type RoleId } from "@/lib/rbac/roles";

/** Deterministic PRNG (mulberry32) so module data is identical on every machine. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (min: number, max: number) => min + (max - min) * next(),
    int: (min: number, max: number) => Math.floor(min + (max - min + 1) * next()),
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)]!,
  };
}

/** Last complete month before DEMO_NOW is October 2026. */
export const LAST_MONTH = new Date(2026, 9, 1);

/** `n` monthly labels ending at the last complete month ("Nov 22" … "Oct 26"). */
export function monthLabels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => format(addMonths(LAST_MONTH, i - n + 1), "MMM yy"));
}

export function isoDaysAgo(days: number): string {
  return new Date(DEMO_NOW.getTime() - days * 86_400_000).toISOString();
}
export function isoDaysAhead(days: number): string {
  return new Date(DEMO_NOW.getTime() + days * 86_400_000).toISOString();
}
export function daysBetween(fromIso: string, to: Date = DEMO_NOW): number {
  return Math.round((to.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

export const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export type Rag = "green" | "amber" | "red";
export const ragTone: Record<Rag, Tone> = { green: "success", amber: "warning", red: "danger" };
export const ragLabel: Record<Rag, string> = { green: "Green", amber: "Amber", red: "Red" };

/** Pearson correlation coefficient. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/** Best lead/lag (months, 0–max) of series b behind series a. */
export function bestLag(a: number[], b: number[], max = 6): { lag: number; r: number } {
  let best = { lag: 0, r: pearson(a, b) };
  for (let lag = 1; lag <= max; lag++) {
    const r = pearson(a.slice(0, a.length - lag), b.slice(lag));
    if (r > best.r) best = { lag, r };
  }
  return best;
}

/** Audit logger bound to the signed-in user and role (PRD §10.1: who, what, entity, before/after). */
export function useAuditLog() {
  const { log } = useDbActions();
  const user = useSession((s) => s.user);
  const roleId = useSession((s) => s.roleId);
  return useCallback(
    (action: string, entityType: string, entityId: string, before?: string, after?: string) => {
      if (!user || !roleId) return;
      log({ actorId: user.id, actorName: user.name, roleId, action, entityType, entityId, before, after });
    },
    [log, user, roleId],
  );
}

/** Audit entry for code outside React (operation `apply` handlers, platform services). */
export function logAudit(action: string, entityType: string, entityId: string, before?: string, after?: string) {
  const a = currentActor();
  useDb.getState().log({ actorId: a.id, actorName: a.name, roleId: a.roleId, action, entityType, entityId, before, after });
}

/** Readable list of role names ("Head of Risk, Chief Risk Officer"). */
export function roleNames(ids: readonly string[]): string {
  return ids.map((r) => roleById[r as RoleId]?.name ?? r).join(", ");
}

/** Tenant rule overrides — use as a memo dependency so derived figures recompute when a rule changes. */
export function useRuleValues() {
  return useRulesStore((s) => s.values);
}

/** Current actor's display name (for "signed off by"). */
export function useActorName(): string {
  return useSession((s) => s.user?.name ?? "Unknown user");
}
