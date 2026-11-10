"use client";

import { useCallback } from "react";
import { useDbActions } from "@/lib/data/hooks";
import { useSession } from "@/lib/auth/session";

export type AuditInput = { action: string; entityType: string; entityId: string; before?: string; after?: string };

/** Audit-log writer bound to the signed-in user and role (PRD §4, §10.1: who, what, before/after). */
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
