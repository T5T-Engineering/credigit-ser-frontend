"use client";

/**
 * Audit helper shared by the monitoring, collateral and connectors modules.
 * Every state-changing action calls `useAuditLog()(...)` so the shared immutable audit log records who/what/before/after.
 */
import { useCallback } from "react";
import { useDbActions } from "@/lib/data/hooks";
import { useSession } from "@/lib/auth/session";

export type Actor = { id: string; name: string; roleId: string };

/** The signed-in user as an actor (for comments, assignments and audit). */
export function useActor(): Actor {
  const user = useSession((s) => s.user);
  const roleId = useSession((s) => s.roleId);
  return { id: user?.id ?? "USR-DEMO", name: user?.name ?? "Demo user", roleId: roleId ?? "system-admin" };
}

export type AuditInput = { action: string; entityType: string; entityId: string; before?: string; after?: string };

/** Returns a function that writes one audit event as the signed-in user. */
export function useAuditLog() {
  const { log } = useDbActions();
  const user = useSession((s) => s.user);
  const roleId = useSession((s) => s.roleId);
  return useCallback(
    (e: AuditInput) => {
      if (!user || !roleId) return;
      log({ actorId: user.id, actorName: user.name, roleId, ...e });
    },
    [log, user, roleId],
  );
}
