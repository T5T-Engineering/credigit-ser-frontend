"use client";

/**
 * Effective permissions of the signed-in user and the guards built on them (invariant 12).
 *
 * - API mode: `GET /identity/me` → `permissions` (kept in the session store at sign-in).
 * - Demo mode: the role's catalogue defaults ± approved `role.permissions-change` deltas (`grants-store.ts`).
 *
 * Guards fail closed: signed out, or a key not held → false. They are UI mirrors only; the backend re-checks every call.
 * Holding a permission never bypasses Operations approver eligibility, four-eyes or segregation of duties.
 */
import { useMemo } from "react";
import { useSession } from "../auth/session";
import { roleById } from "../rbac/roles";
import { baselinePermissions, isPermissionKey, type PermissionKey } from "./catalogue";
import { roleGrants, useGrantsStore } from "./grants-store";

export type { PermissionKey } from "./catalogue";

/** A required permission: one key, or several where any one is enough. */
export type PermissionRequirement = PermissionKey | readonly PermissionKey[];

function grantsForRole(roleId: string, overrides = useGrantsStore.getState().overrides): Set<PermissionKey> {
  return roleGrants(roleId, roleById[roleId as keyof typeof roleById]?.modules, overrides);
}

function compute(user: unknown, roleId: string | null, permissions: string[] | null, overrides = useGrantsStore.getState().overrides): Set<PermissionKey> {
  if (!user) return new Set();
  if (permissions) return new Set(permissions.filter(isPermissionKey));
  if (!roleId) return new Set(baselinePermissions);
  return grantsForRole(roleId, overrides);
}

/** Effective permissions now (non-React code: services, operation handlers). */
export function currentPermissions(): Set<PermissionKey> {
  const { user, roleId, permissions } = useSession.getState();
  return compute(user, roleId, permissions);
}

/** Whether the signed-in user holds the permission (any of, for a list). */
export function hasPermission(required: PermissionRequirement): boolean {
  const held = currentPermissions();
  return (typeof required === "string" ? [required] : required).some((k) => held.has(k));
}

/**
 * Whether an actor holds a permission. The signed-in actor uses the session's effective set; any other actor
 * (e.g. an approver evaluated for visibility) uses its role's grants (demo / role defaults).
 */
export function actorHasPermission(actor: { id: string; roleId: string }, key: PermissionKey): boolean {
  const session = useSession.getState();
  if (session.user?.id === actor.id) return currentPermissions().has(key);
  return grantsForRole(actor.roleId).has(key);
}

/** Reactive effective permission set (re-computed on sign-in, role switch and approved grant changes). */
export function usePermissionSet(): Set<PermissionKey> {
  const user = useSession((s) => s.user);
  const roleId = useSession((s) => s.roleId);
  const permissions = useSession((s) => s.permissions);
  const overrides = useGrantsStore((s) => s.overrides);
  return useMemo(() => compute(user, roleId, permissions, overrides), [user, roleId, permissions, overrides]);
}

/** Whether the signed-in user holds the permission (any of, for a list). Typed against the generated catalogue. */
export function useCan(required: PermissionRequirement): boolean {
  const held = usePermissionSet();
  return (typeof required === "string" ? [required] : required).some((k) => held.has(k));
}
