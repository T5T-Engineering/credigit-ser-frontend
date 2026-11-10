"use client";

import { useMemo } from "react";
import { useRole, useSession } from "@/lib/auth/session";
import { useUsers } from "@/lib/data/hooks";
import type { User } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";

/** The signed-in person as a spine User (falls back to the session identity). */
export function useMe(): { user: User; roleId: RoleId | undefined } {
  const session = useSession((s) => s.user);
  const role = useRole();
  const users = useUsers();
  return useMemo(() => {
    const seeded = users.find((u) => u.id === session?.id);
    const user: User = seeded ?? {
      id: session?.id ?? "USR-DEMO",
      name: session?.name ?? "Demo user",
      email: session?.email ?? "",
      roleId: role?.id ?? "account-officer",
      branch: "Victoria Island",
      status: "Active",
      mfa: true,
    };
    return { user, roleId: role?.id };
  }, [users, session, role]);
}
