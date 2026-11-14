"use client";

/**
 * Helpers shared by the post-approval modules (Offer letters §7, Credit administration §6.3, Disbursement §4.1/4.2).
 */
import { useCallback } from "react";
import type { Tone } from "@credigit/web-ui";
import { useSession } from "@/lib/auth/session";
import { useDbActions } from "@/lib/data/hooks";
import { DEMO_NOW, createSeed, type SeedData } from "@/lib/data/seed";
import { useDb } from "@/lib/data/store";
import type { Actor as PlatformActor } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";

/** Deterministic 32-bit hash of a string (stable mock variation per record). */
export function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 0–1 value for a record + salt. */
export function rand(id: string, salt = ""): number {
  return (hash(`${id}:${salt}`) % 10_000) / 10_000;
}

export const DAY_MS = 86_400_000;

export function daysBetween(from: string | Date, to: string | Date = DEMO_NOW): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);
}

export function addDaysIso(from: string | Date, days: number): string {
  return new Date(new Date(from).getTime() + days * DAY_MS).toISOString();
}

/**
 * "Now" for records created in the prototype: the demo clock (DEMO_NOW) plus the real time elapsed today,
 * so new records sort after seeded ones while ageing logic stays stable.
 */
export function demoNowIso(): string {
  const now = new Date();
  const base = new Date(DEMO_NOW);
  base.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  return base.toISOString();
}

let pristine: SeedData | undefined;
/**
 * The original demo seed (memoised). Module seeds (letters, waivers, disbursement history) derive from this
 * snapshot so they stay stable while live records change stage.
 */
export function pristineSeed(): SeedData {
  pristine ??= createSeed();
  return pristine;
}

export type Actor = { actorId: string; actorName: string; roleId: RoleId };

/** The signed-in person as an audit actor. */
export function useActor(): Actor {
  const user = useSession((s) => s.user);
  const roleId = useSession((s) => s.roleId);
  return { actorId: user?.id ?? "USR-UNKNOWN", actorName: user?.name ?? "Unknown user", roleId: roleId ?? "system-admin" };
}

/** Audit logger bound to the current actor. */
export function useAuditLog() {
  const { log } = useDbActions();
  const actor = useActor();
  return useCallback(
    (action: string, entityType: string, entityId: string, before?: string, after?: string) =>
      log({ ...actor, action, entityType, entityId, before, after }),
    [log, actor],
  );
}

/** Audit outside React (Operations `apply` handlers, event subscribers): who, what, before/after. */
export function auditAs(actor: PlatformActor, action: string, entityType: string, entityId: string, before?: string, after?: string) {
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType, entityId, before, after });
}

export const facilityStatusTones: Record<string, Tone> = {
  Active: "success",
  "Pending disbursement": "info",
  Closed: "neutral",
  Restructured: "warning",
  "Written off": "danger",
};

export const cbnClassTones: Record<string, Tone> = {
  Performing: "success",
  Watchlist: "warning",
  Substandard: "warning",
  Doubtful: "danger",
  Lost: "danger",
};

/** Contingent (off-balance-sheet) products — disbursement = issuance of the instrument. */
export const contingentProducts = ["Bank guarantee", "Advance payment guarantee", "Trade finance (LC)"] as const;
