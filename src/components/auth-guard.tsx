"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Spinner } from "@credigit/web-ui";
import { useHydrated, useSession } from "@/lib/auth/session";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { useDb } from "@/lib/data/store";

export const demoAccessEnabled = process.env.NEXT_PUBLIC_DEMO_ACCESS !== "false";

/** Sign a demo user in for a role (uses the seeded user for that role). */
export function demoSignIn(roleId: RoleId) {
  const user = useDb.getState().users.find((u) => u.roleId === roleId);
  useSession.getState().signIn(
    { id: user?.id ?? "USR-DEMO", name: user?.name ?? roleById[roleId].name, email: user?.email ?? "demo@harbourline.example", source: "demo" },
    roleId,
  );
}

/**
 * Protects the app: waits for stored data to load, then requires a session.
 * With demo access on, `?demoRole=<role-id>` signs in directly (used for screenshots and shared demo links).
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const user = useSession((s) => s.user);
  const roleId = useSession((s) => s.roleId);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("demoRole") as RoleId | null;
    if (demoAccessEnabled && requested && requested in roleById) {
      // Consume the parameter: left in the URL, signing out (or an idle timeout) would sign straight back in.
      params.delete("demoRole");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      if (requested !== roleId) {
        demoSignIn(requested);
        return;
      }
    }
    if (!user) router.replace(`/login/?next=${encodeURIComponent(pathname)}`);
  }, [hydrated, user, roleId, router, pathname]);

  if (!hydrated || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Loading your workspace" />
      </div>
    );
  }
  return <>{children}</>;
}
