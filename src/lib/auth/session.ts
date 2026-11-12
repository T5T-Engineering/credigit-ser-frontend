"use client";

/**
 * Signed-in session for the prototype. Stored in sessionStorage (cleared when the browser tab closes).
 * Real authorisation will be enforced by the backend; the UI only hides what a role can't use.
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { roleById, type ModuleKey, type Access, type RoleId, canAccess } from "../rbac/roles";
import { useDb } from "../data/store";
import { onSignedIn } from "../data/workspace-storage";
import { signOutOfBackend } from "./backend-sso";
import { signOutOfMicrosoft } from "./msal";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  source: "microsoft" | "demo" | "password";
};

type SessionState = {
  user: SessionUser | null;
  roleId: RoleId | null;
  signedInAt: string | null;
  signIn: (user: SessionUser, roleId: RoleId) => void;
  switchRole: (roleId: RoleId) => void;
  signOut: () => Promise<void>;
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      roleId: null,
      signedInAt: null,
      signIn: (user, roleId) => {
        set({ user, roleId, signedInAt: new Date().toISOString() });
        useDb.getState().log({
          actorId: user.id,
          actorName: user.name,
          roleId,
          action: user.source === "microsoft" ? "Signed in (Microsoft SSO)" : user.source === "password" ? "Signed in (email + password + one-time code)" : "Signed in (demo access)",
          entityType: "Session",
          entityId: "-",
        });
        // Database-backed stores that waited for an identity load now (ADR-0015).
        onSignedIn();
      },
      switchRole: (roleId) => {
        const { user, roleId: before } = get();
        if (!user) return;
        set({ roleId });
        useDb.getState().log({ actorId: user.id, actorName: user.name, roleId, action: "Switched demo role", entityType: "Session", entityId: "-", before: before ?? undefined, after: roleId });
      },
      signOut: async () => {
        const { user, roleId } = get();
        if (user && roleId) useDb.getState().log({ actorId: user.id, actorName: user.name, roleId, action: "Signed out", entityType: "Session", entityId: "-" });
        set({ user: null, roleId: null, signedInAt: null });
        if (user?.source === "microsoft") {
          await signOutOfBackend();
          await signOutOfMicrosoft().catch(() => undefined);
        }
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

/** Whether the current role can use a module. */
export function useCan(module: ModuleKey, level: Access = "view"): boolean {
  const role = useRole();
  return canAccess(role, module, level);
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
