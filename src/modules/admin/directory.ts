"use client";

/**
 * Backend user directory for Admin → Users (backend ADR-0007): the users in the database, and invite / role change / deactivate /
 * reactivate requests routed through the backend Operations engine (approved in Operations → Approvals by a second person).
 * Used when the backend is configured; otherwise the page keeps the app's own user list.
 */
import { useCallback, useEffect, useState } from "react";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import type { User } from "@/lib/data/types";
import type { OperationInstance, SubmitResult } from "@/lib/platform/operations";
import type { RoleId } from "@/lib/rbac/roles";

export const directoryEnabled = backendSsoEnabled;

type DirectoryUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  status: "Pending" | "Active" | "Deactivated" | "Locked";
  branch?: string | null;
  pendingOperationId?: string | null;
  source?: string;
  updatedAt?: string;
  lastSignInAt?: string | null;
  lastSignInMethod?: string | null;
  mfaMethod?: string | null;
};

type Submission = { operationId: string; status: string; applied: boolean };

function toUser(u: DirectoryUser): User & { pendingOperationId?: string | null } {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roleId: (u.roles[0] ?? "") as RoleId,
    branch: u.branch ?? "—",
    status: u.status === "Active" ? "Active" : u.status === "Pending" ? "Pending" : "Suspended",
    // Every backend sign-in is multi-factor: e-mailed one-time code (local) or Entra ID MFA.
    mfa: true,
    lastLogin: u.lastSignInAt ?? undefined,
    signInMethod: u.lastSignInMethod ?? undefined,
    mfaMethod: u.mfaMethod ?? undefined,
    pendingOperationId: u.pendingOperationId,
  };
}

/** Users of the tenant from the backend directory. */
export function useDirectoryUsers(): { users: User[]; loading: boolean; error: string | null; reload: () => void } {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(directoryEnabled);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!directoryEnabled) return;
    let cancelled = false;
    identityCall<DirectoryUser[]>("/identity/users")
      .then((list) => {
        if (!cancelled) {
          setUsers(list.map(toUser));
          setError(null);
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { users, loading, error, reload };
}

/** Side-menu module access per role from the backend (derived from each role's current permissions); null without a backend. */
export function useDirectoryRoleModules(): Record<string, Record<string, "view" | "edit">> | null {
  const [modules, setModules] = useState<Record<string, Record<string, "view" | "edit">> | null>(null);

  useEffect(() => {
    if (!directoryEnabled) return;
    let cancelled = false;
    identityCall<Array<{ id: string; modules: Record<string, "view" | "edit"> }>>("/identity/roles")
      .then((roles) => !cancelled && setModules(Object.fromEntries(roles.map((r) => [r.id, r.modules]))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return modules;
}

async function submit(path: string, body: unknown): Promise<SubmitResult> {
  try {
    const r = await identityCall<Submission>(path, { method: "POST", body: JSON.stringify(body) });
    // Only the id is used by the result panel ("Track request"); the request lives in the backend Operations engine.
    return { ok: true, applied: r.applied, instance: { id: r.operationId } as OperationInstance };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export const inviteDirectoryUser = (u: { email: string; name: string; roleId: RoleId; branch: string; reason: string }) =>
  submit("/identity/users/invitations", { email: u.email, name: u.name, roleIds: [u.roleId], branch: u.branch, reason: u.reason });

export const changeDirectoryUserRole = (userId: string, roleId: RoleId, reason: string) =>
  submit(`/identity/users/${encodeURIComponent(userId)}/role-changes`, { roleIds: [roleId], reason });

export const deactivateDirectoryUser = (userId: string, reason: string) => submit(`/identity/users/${encodeURIComponent(userId)}/deactivation`, { reason });

export const reactivateDirectoryUser = (userId: string, reason: string) => submit(`/identity/users/${encodeURIComponent(userId)}/reactivation`, { reason });

/** Back to e-mailed codes (lost phone; backend user.mfa-reset, ADR-0017). */
export const resetDirectoryUserMfa = (userId: string, reason: string) => submit(`/identity/users/${encodeURIComponent(userId)}/mfa-reset`, { reason });
