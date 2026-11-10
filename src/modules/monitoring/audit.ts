"use client";

/**
 * Audit helper shared by the monitoring, collateral and connectors modules.
 * Every state-changing action writes to the shared immutable audit log (who / what / before / after) — from components
 * with `useAuditLog()`, from services and Operations `apply` handlers with `auditAs(actor, …)`.
 */
import { useCallback } from "react";
import { useDb } from "@/lib/data/store";
import { currentActor, useScope, type Actor } from "@/lib/platform/scope";

export type { Actor };

/** The signed-in user as an actor (comments, assignments, audit). */
export function useActor(): Actor {
  return useScope().actor;
}

export type AuditInput = { action: string; entityType: string; entityId: string; before?: string; after?: string };

/** Write one audit event as `actor` (defaults to the signed-in user / System). Safe outside React. */
export function auditAs(actor: Pick<Actor, "id" | "name" | "roleId"> | undefined, e: AuditInput) {
  const a = actor ?? currentActor();
  useDb.getState().log({ actorId: a.id, actorName: a.name, roleId: a.roleId, ...e });
}

/** Returns a function that writes one audit event as the signed-in user. */
export function useAuditLog() {
  const { actor } = useScope();
  return useCallback((e: AuditInput) => auditAs(actor, e), [actor]);
}
