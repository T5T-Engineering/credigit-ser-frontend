"use client";

/**
 * User scope (invariant 9: user-scoped). Services outside React read the actor with `currentActor()`;
 * components use `useScope()`.
 */
import { useSession } from "../auth/session";
import { useDb } from "../data/store";
import { roleById, type Role, type RoleId } from "../rbac/roles";

export type Actor = { id: string; name: string; roleId: RoleId; tenantId: string };

const SYSTEM_ACTOR: Actor = { id: "SYSTEM", name: "System", roleId: "system-admin", tenantId: "-" };

/** The signed-in actor, or the System actor for background/automatic work. */
export function currentActor(): Actor {
  const { user, roleId } = useSession.getState();
  const tenantId = useDb.getState().tenant.id;
  return user && roleId ? { id: user.id, name: user.name, roleId, tenantId } : { ...SYSTEM_ACTOR, tenantId };
}

export function useScope(): { actor: Actor; role: Role | undefined } {
  const user = useSession((s) => s.user);
  const roleId = useSession((s) => s.roleId);
  const tenantId = useDb((s) => s.tenant.id);
  const actor = user && roleId ? { id: user.id, name: user.name, roleId, tenantId } : { ...SYSTEM_ACTOR, tenantId };
  return { actor, role: roleId ? roleById[roleId] : undefined };
}
