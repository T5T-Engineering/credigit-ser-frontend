"use client";

/**
 * Demo-mode role grants (no backend): each role's effective permissions are its catalogue defaults
 * (`defaultGrants`) plus / minus the deltas approved through the `role.permissions-change` Operations workflow.
 * Storing deltas (not full lists) keeps the administrator role holding permissions added to the catalogue later,
 * like the backend's startup sync.
 *
 * Only the `role.permissions-change` operation's `apply` writes here (`applyRolePermissionChange`).
 * BACKEND SEAM: in API mode roles and grants come from `GET /identity/roles`; this store is unused.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultGrants, isPermissionKey, isProtectedFor, type PermissionKey, type PermissionLevel } from "./catalogue";

export type GrantDelta = { grant: PermissionKey[]; revoke: PermissionKey[] };

type GrantsState = { overrides: Record<string, GrantDelta>; version: number };

/**
 * Demo tenant data: grants this tenant approved on top of the shipped role defaults.
 * Board, MCC, BCC and the Portfolio & MIS Officer read the Board Risk Committee pack (cockpit and report links point to
 * /enterprise-risk/brc-pack) without holding the enterprise-risk area (was TD-964; backend change listed in
 * docs/modules/admin/IMPLEMENTATION.md — add `ExtraPermissions` to these roles in config/roles.json).
 */
const brcReaders: [string, PermissionKey[]][] = ["board", "mcc", "bcc", "portfolio-mis-officer"].map((roleId) => [roleId, ["enterprise-risk.brc-pack.view"]]);
/**
 * The Account Officer presents offer letters and the Credit Administration Officer handles them (PRD §6.1.1 steps 13–14)
 * without holding the offer-letters area at edit level: they send letters to Legal, request re-issues and record
 * acceptance. Backend change listed in docs/modules/admin/IMPLEMENTATION.md (ExtraPermissions in config/roles.json).
 */
const letterPresenters: [string, PermissionKey[]][] = ["account-officer", "credit-admin-officer"].map((roleId) => [
  roleId,
  ["offer-letters.letters.submit", "offer-letters.letters.request-reissue", "offer-letters.letters.record-acceptance"],
]);
const seededOverrides: Record<string, GrantDelta> = Object.fromEntries([...brcReaders, ...letterPresenters].map(([roleId, grant]) => [roleId, { grant, revoke: [] }]));

export const useGrantsStore = create<GrantsState>()(
  persist((): GrantsState => ({ overrides: seededOverrides, version: 0 }), {
    name: "credigit.ser.iam",
    version: 1,
    storage: createJSONStorage(() => localStorage),
  }),
);

/** Effective grants of a role in demo mode. `fallbackModules` = area map of a role the catalogue doesn't know (cloned role). */
export function roleGrants(roleId: string, fallbackModules?: Record<string, PermissionLevel | undefined>, overrides = useGrantsStore.getState().overrides): Set<PermissionKey> {
  const grants = defaultGrants(roleId, fallbackModules);
  const delta = overrides[roleId];
  if (delta) {
    for (const k of delta.grant) if (isPermissionKey(k)) grants.add(k);
    for (const k of delta.revoke) if (!isProtectedFor(roleId, k)) grants.delete(k);
  }
  return grants;
}

/**
 * Apply an approved permission change (called only from the `role.permissions-change` operation).
 * Protected administrator permissions are never revoked.
 */
export function applyRolePermissionChange(roleId: string, grant: PermissionKey[], revoke: PermissionKey[], fallbackModules?: Record<string, PermissionLevel | undefined>) {
  useGrantsStore.setState((s) => {
    const defaults = defaultGrants(roleId, fallbackModules);
    const current = roleGrants(roleId, fallbackModules, s.overrides);
    for (const k of grant) current.add(k);
    for (const k of revoke) if (!isProtectedFor(roleId, k)) current.delete(k);
    // Store the minimal delta against the defaults.
    const delta: GrantDelta = { grant: [...current].filter((k) => !defaults.has(k)), revoke: [...defaults].filter((k) => !current.has(k)) };
    return { overrides: { ...s.overrides, [roleId]: delta }, version: s.version + 1 };
  });
}
