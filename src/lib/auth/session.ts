"use client";

/**
 * Signed-in session for the prototype. Stored in sessionStorage (cleared when the browser tab closes).
 * Real authorisation will be enforced by the backend; the UI only hides what a role can't use.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { roleById, type ModuleKey, type Access, type RoleId, canAccess } from "../rbac/roles";
import { useDb } from "../data/store";
import { signOutOfMicrosoft } from "./msal";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  source: "microsoft" | "demo";
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
          action: user.source === "microsoft" ? "Signed in (Microsoft SSO)" : "Signed in (demo access)",
          entityType: "Session",
          entityId: "-",
        });
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

/** Whether the current role can use a module. */
export function useCan(module: ModuleKey, level: Access = "view"): boolean {
  const role = useRole();
  return canAccess(role, module, level);
}

/** True once persisted stores have loaded in the browser (avoids rendering seed data before stored data). */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const done = () => useSession.persist.hasHydrated() && useDb.persist.hasHydrated();
    if (done()) setHydrated(true);
    const unsubs = [useSession.persist.onFinishHydration(() => done() && setHydrated(true)), useDb.persist.onFinishHydration(() => done() && setHydrated(true))];
    return () => unsubs.forEach((u) => u());
  }, []);
  return hydrated;
}
