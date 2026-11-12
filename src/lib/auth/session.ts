"use client";

/**
 * Signed-in session. Stored in sessionStorage (cleared when the browser tab closes).
 * API mode: `permissions`, `roles` and `tenantId` come from `GET /identity/me`; the access token stays in memory
 * (`src/lib/api/tokens.ts`). Demo mode: permissions derive from the role (`src/lib/iam/permissions.ts`).
 * The backend enforces authorisation; the UI mirrors it with permission keys (invariant 12).
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { roleById, type RoleId } from "../rbac/roles";
import { useDb } from "../data/store";
import { signOutOfMicrosoft } from "./msal";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  source: "microsoft" | "demo" | "password";
};

export type AuthMode = "Local" | "MicrosoftEntra";

/** Extra identity facts from the backend (`GET /identity/me`). */
export type SessionIdentity = { permissions?: string[]; roles?: string[]; tenantId?: string; authMode?: AuthMode };

type SessionState = {
  user: SessionUser | null;
  roleId: RoleId | null;
  /** Effective permissions from `/identity/me` (API mode); null = derive from the role (demo). */
  permissions: string[] | null;
  /** Every role id held (API mode can hold several). */
  roles: string[];
  tenantId: string | null;
  authMode: AuthMode | null;
  signedInAt: string | null;
  signIn: (user: SessionUser, roleId: RoleId, identity?: SessionIdentity) => void;
  /** Refresh identity facts (e.g. after `/identity/me` is re-read) without a new sign-in. */
  setIdentity: (identity: SessionIdentity) => void;
  switchRole: (roleId: RoleId) => void;
  signOut: () => Promise<void>;
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      roleId: null,
      permissions: null,
      roles: [],
      tenantId: null,
      authMode: null,
      signedInAt: null,
      signIn: (user, roleId, identity) => {
        set({
          user,
          roleId,
          permissions: identity?.permissions ?? null,
          roles: identity?.roles ?? [roleId],
          tenantId: identity?.tenantId ?? null,
          authMode: identity?.authMode ?? null,
          signedInAt: new Date().toISOString(),
        });
        useDb.getState().log({
          actorId: user.id,
          actorName: user.name,
          roleId,
          action: user.source === "microsoft" ? "Signed in (Microsoft SSO)" : user.source === "password" ? "Signed in (email + password + one-time code)" : "Signed in (demo access)",
          entityType: "Session",
          entityId: "-",
        });
      },
      setIdentity: (identity) =>
        set((s) => ({ permissions: identity.permissions ?? s.permissions, roles: identity.roles ?? s.roles, tenantId: identity.tenantId ?? s.tenantId, authMode: identity.authMode ?? s.authMode })),
      switchRole: (roleId) => {
        const { user, roleId: before, permissions } = get();
        // Demo only: an API session's permissions come from the backend, so its role can't be switched here.
        if (!user || permissions) return;
        set({ roleId, roles: [roleId] });
        useDb.getState().log({ actorId: user.id, actorName: user.name, roleId, action: "Switched demo role", entityType: "Session", entityId: "-", before: before ?? undefined, after: roleId });
      },
      signOut: async () => {
        const { user, roleId } = get();
        if (user && roleId) useDb.getState().log({ actorId: user.id, actorName: user.name, roleId, action: "Signed out", entityType: "Session", entityId: "-" });
        set({ user: null, roleId: null, permissions: null, roles: [], tenantId: null, authMode: null, signedInAt: null });
        if (user?.source === "microsoft") await signOutOfMicrosoft().catch(() => undefined);
      },
    }),
    { name: "credigit.ser.session", storage: createJSONStorage(() => sessionStorage) },
  ),
);

/** The current role object (undefined when signed out). */
export function useRole() {
  const roleId = useSession((s) => s.roleId);
  return roleId ? roleById[roleId] : undefined;
}

/** True once persisted stores have loaded in the browser (avoids rendering seed data before stored data). */
const hydrationDone = () => useSession.persist.hasHydrated() && useDb.persist.hasHydrated();
function subscribeHydration(onChange: () => void) {
  const unsubs = [useSession.persist.onFinishHydration(onChange), useDb.persist.onFinishHydration(onChange)];
  return () => unsubs.forEach((u) => u());
}
export function useHydrated(): boolean {
  // Server render: false. Browser: true once both persisted stores have loaded.
  return useSyncExternalStore(subscribeHydration, hydrationDone, () => false);
}
