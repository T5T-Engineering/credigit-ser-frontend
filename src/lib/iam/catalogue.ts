/**
 * Identity & Access permission catalogue (invariant 12, backend ADR-0012).
 *
 * The data is a generated copy of the backend `config/permissions.json` + `config/roles.json`
 * (`scripts/sync-permissions.mjs`); keys are never hand-typed. In API mode the signed-in user's effective permissions
 * come from `GET /identity/me`; the catalogue still drives labels, menus and the admin permission matrix.
 */
import generated from "./permission-catalogue.json";
import type { PermissionKey } from "./permission-keys";

export type { PermissionKey } from "./permission-keys";

export type PermissionLevel = "view" | "edit";

export type Permission = {
  key: PermissionKey;
  label: string;
  description: string;
  module: string;
  group: string;
  sensitive: boolean;
  /** Frontend nav module (`src/lib/nav.ts` `module`). */
  area: string;
  level: PermissionLevel;
};

export type RoleDefault = { id: string; modules: Record<string, PermissionLevel>; grantsAllPermissions: boolean; extraPermissions: PermissionKey[] };

type Generated = {
  version: string;
  permissions: Permission[];
  baseline: PermissionKey[];
  protectedAdministratorPermissions: string[];
  roleDefaults: RoleDefault[];
};

const data = generated as unknown as Generated;

export const catalogueVersion = data.version;
export const permissionCatalogue: readonly Permission[] = data.permissions;
export const baselinePermissions: readonly PermissionKey[] = data.baseline;
export const protectedAdministratorPatterns: readonly string[] = data.protectedAdministratorPermissions;
export const allPermissionKeys: readonly PermissionKey[] = data.permissions.map((p) => p.key);

const byKey = new Map(data.permissions.map((p) => [p.key as string, p]));
const roleDefaultById = new Map(data.roleDefaults.map((r) => [r.id, r]));

export function permissionFor(key: string): Permission | undefined {
  return byKey.get(key);
}

export function isPermissionKey(key: string): key is PermissionKey {
  return byKey.has(key);
}

/** Every permission whose nav area is `area` (used for menu visibility: any one held shows the module). */
export function areaPermissions(area: string): PermissionKey[] {
  return data.permissions.filter((p) => p.area === area).map((p) => p.key);
}

/** `identity.users.*` style pattern match (exact key or trailing `*`). */
export function matchesPattern(pattern: string, key: string): boolean {
  return pattern.endsWith("*") ? key.startsWith(pattern.slice(0, -1)) : pattern === key;
}

/** Whether a role is the administrator role (holds every permission by default). */
export function isAdministratorRole(roleId: string): boolean {
  return roleDefaultById.get(roleId)?.grantsAllPermissions ?? false;
}

/** Protected permissions can't be revoked from an administrator role (lockout guard, backend BE-33). */
export function isProtectedFor(roleId: string, key: string): boolean {
  return isAdministratorRole(roleId) && protectedAdministratorPatterns.some((p) => matchesPattern(p, key));
}

/**
 * Default grants of a role (ADR-0012): every permission whose area the role holds at that level (edit ⇒ view),
 * plus its extra permissions and the Baseline. The administrator role holds every permission, including ones added later.
 * `modules` falls back to the role's area map when the backend role list doesn't know the role (e.g. a cloned role).
 */
export function defaultGrants(roleId: string, fallbackModules?: Record<string, PermissionLevel | undefined>): Set<PermissionKey> {
  const def = roleDefaultById.get(roleId);
  if (def?.grantsAllPermissions) return new Set(allPermissionKeys);
  const modules = def?.modules ?? fallbackModules ?? {};
  const grants = new Set<PermissionKey>(baselinePermissions);
  for (const p of data.permissions) {
    const access = modules[p.area];
    if (access && (p.level === "view" || access === "edit")) grants.add(p.key);
  }
  for (const k of def?.extraPermissions ?? []) grants.add(k);
  return grants;
}
