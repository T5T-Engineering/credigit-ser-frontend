"use client";

/**
 * Admin-side Identity & Access actions (ADM-FR-18…22). API mode calls `/api/v1/identity/*` (commands answer 202 with
 * the Operations id); demo mode submits the same operation types locally. Pages call these functions only.
 */
import { useEffect, useState } from "react";
import { apiEnabled } from "@/lib/api/config";
import { problemText } from "@/lib/api/client";
import { lockAccount, unlockAccount } from "@/lib/auth/accounts";
import { useDb } from "@/lib/data/store";
import type { User } from "@/lib/data/types";
import { identityApi, type ApiUser } from "@/lib/iam/api";
import type { PermissionKey } from "@/lib/iam/catalogue";
import { hasPermission } from "@/lib/iam/permissions";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { submitOperation } from "@/lib/platform/operations";
import { currentActor } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import type { RolePermissionChangePayload } from "./platform";

/** Outcome of one request: an Operations id to track, or why it failed. */
export type RequestOutcome = { ok: true; operationId: string; applied: boolean } | { ok: false; reason: string };

const audit = (action: string, entityType: string, entityId: string, before?: string, after?: string) => {
  const a = currentActor();
  useDb.getState().log({ actorId: a.id, actorName: a.name, roleId: a.roleId, action, entityType, entityId, before, after });
};

// ---------------------------------------------------------------- role permissions

export type RoleGrantChange = { roleId: string; roleName: string; grant: PermissionKey[]; revoke: PermissionKey[] };

/**
 * Send one `role.permissions-change` request per changed role (body = `diffRoleGrants` output + reason).
 * Hooks `identity.role.permissions-change.before/after` wrap each request.
 */
export async function requestRolePermissionChanges(changes: RoleGrantChange[], reason: string): Promise<{ role: RoleGrantChange; outcome: RequestOutcome }[]> {
  if (!hasPermission("identity.roles.change-permissions")) return changes.map((role) => ({ role, outcome: { ok: false, reason: "Your permissions don't include changing role permissions." } }));
  const results: { role: RoleGrantChange; outcome: RequestOutcome }[] = [];
  for (const change of changes) {
    const before = await runHooks("identity.role.permissions-change.before", { ...change, reason });
    if (!before.ok) {
      results.push({ role: change, outcome: { ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` } });
      continue;
    }
    const ctx = before.ctx as RoleGrantChange & { reason: string };
    let outcome: RequestOutcome;
    if (apiEnabled) {
      try {
        const r = await identityApi.changeRolePermissions(ctx.roleId, ctx.grant, ctx.revoke, ctx.reason);
        outcome = { ok: true, operationId: r.operationId, applied: r.applied };
      } catch (e) {
        outcome = { ok: false, reason: problemText(e) };
      }
    } else {
      const r = await submitOperation<RolePermissionChangePayload>("role.permissions-change", {
        title: `Permissions of ${ctx.roleName}: +${ctx.grant.length} / −${ctx.revoke.length}`,
        subject: { type: "Role", id: ctx.roleId, title: ctx.roleName, href: `/admin/permissions?role=${encodeURIComponent(ctx.roleId)}` },
        payload: { roleId: ctx.roleId, roleName: ctx.roleName, grant: ctx.grant, revoke: ctx.revoke, reason: ctx.reason },
        summary: [
          { label: "Role", value: ctx.roleName },
          { label: "Grant", value: ctx.grant.join(", ") || "—" },
          { label: "Revoke", value: ctx.revoke.join(", ") || "—" },
          { label: "Reason", value: ctx.reason },
        ],
      });
      outcome = r.ok ? { ok: true, operationId: r.instance.id, applied: r.applied } : { ok: false, reason: r.reason };
    }
    await runHooks("identity.role.permissions-change.after", { ...ctx, outcome });
    results.push({ role: change, outcome });
  }
  return results;
}

// ---------------------------------------------------------------- lock / unlock (demo; backend endpoint requested)

/**
 * Lock or unlock a user's sign-in (ADM-FR-19). Guarded by `identity.users.deactivate` / `identity.users.reactivate`
 * until the backend adds `identity.users.lock` / `.unlock` (TD-972). API mode: not available yet.
 */
export async function setUserLock(user: Pick<User, "id" | "email" | "name">, lock: boolean, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (apiEnabled) return { ok: false, error: "Locking and unlocking aren't available from the backend yet (TD-972)." };
  if (!hasPermission(lock ? "identity.users.deactivate" : "identity.users.reactivate")) return { ok: false, error: "Your permissions don't include this action." };
  const action = lock ? "lock" : "unlock";
  const before = await runHooks("admin.user.change.before", { action, userId: user.id, reason });
  if (!before.ok) return { ok: false, error: `Blocked by ${before.vetoedBy}: ${before.reason}` };
  const a = currentActor();
  const r = lock ? await lockAccount(user.email, reason, a) : await unlockAccount(user.email, reason, a);
  await runHooks("admin.user.change.after", { action, userId: user.id, reason, ok: r.ok });
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------- exports

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * `DataTable onExport` handler for the users / roles exports (ADM-FR-20). API mode downloads the server CSV
 * (`GET /identity/users/export` · `/identity/roles/export`, audited by the backend) and cancels the client CSV;
 * demo mode audits and publishes, then lets the table download its rows.
 */
export function adminExport(kind: "users" | "roles") {
  return async (rows: unknown[]): Promise<boolean> => {
    const key: PermissionKey = kind === "users" ? "identity.users.export" : "identity.roles.export";
    if (!hasPermission(key)) return false;
    if (apiEnabled) {
      try {
        const file = kind === "users" ? await identityApi.exportUsers() : await identityApi.exportRoles();
        download(file.blob, file.filename);
      } catch (e) {
        window.alert(problemText(e));
      }
      return false;
    }
    audit(`Exported ${kind} (CSV)`, kind === "users" ? "UserDirectory" : "RoleCatalogue", "-", undefined, `${rows.length} rows`);
    publish(kind === "users" ? "admin.users.exported" : "admin.roles.exported", { module: "admin", subject: { type: kind === "users" ? "UserDirectory" : "RoleCatalogue", id: "-" }, payload: { rows: rows.length } });
    return true;
  };
}

// ---------------------------------------------------------------- directory (API mode)

/** API user → the app's `User` shape (first known role). */
export function toUser(u: ApiUser): User {
  const status = u.status === "Deactivated" ? "Suspended" : u.status === "Pending" ? "Pending" : "Active";
  return { id: u.id, name: u.name, email: u.email ?? "", roleId: (u.roles[0] ?? "account-officer") as RoleId, branch: u.branch ?? "—", status, mfa: u.mfaEnrolled ?? true, lastLogin: u.lastSignInAt };
}

/** API mode: `GET /identity/users` (+ `GET /identity/access-requests`). Demo mode returns null (use the local stores). */
export function useApiDirectory(): { users: User[] | null; locked: Set<string>; accessRequests: ApiUser[]; error: string | null } {
  const [state, setState] = useState<{ users: User[] | null; locked: Set<string>; accessRequests: ApiUser[]; error: string | null }>({ users: null, locked: new Set(), accessRequests: [], error: null });
  useEffect(() => {
    if (!apiEnabled) return;
    let live = true;
    void (async () => {
      try {
        const list = await identityApi.users();
        const requests = hasPermission("identity.access-requests.review") ? await identityApi.accessRequests() : [];
        if (live) setState({ users: list.map(toUser), locked: new Set(list.filter((u) => u.status === "Locked").map((u) => u.id)), accessRequests: requests, error: null });
      } catch (e) {
        if (live) setState((s) => ({ ...s, error: problemText(e) }));
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** API mode commands for the users page (202 → Operations). */
export async function apiUserCommand(kind: "deactivate" | "reactivate" | "role", userId: string, reason: string, roleId?: string): Promise<RequestOutcome> {
  try {
    const r =
      kind === "deactivate" ? await identityApi.deactivateUser(userId, reason) : kind === "reactivate" ? await identityApi.reactivateUser(userId, reason) : await identityApi.changeUserRoles(userId, [roleId!], reason);
    return { ok: true, operationId: r.operationId, applied: r.applied };
  } catch (e) {
    return { ok: false, reason: problemText(e) };
  }
}
