"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, Lock, LockOpen, ShieldCheck, UserCheck, UserPlus, Users, UserX } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  buttonStyles,
  Card,
  CardContent,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  Form,
  Grid,
  Input,
  Menu,
  Modal,
  Select,
  Stack,
  StatCard,
  SubmitButton,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useSession } from "@/lib/auth/session";
import { useCan } from "@/lib/iam/permissions";
import { apiEnabled } from "@/lib/api/config";
import { useAccounts } from "@/lib/auth/accounts";
import { identityApi } from "@/lib/iam/api";
import { problemText } from "@/lib/api/client";
import { useUsers } from "@/lib/data/hooks";
import { branches } from "@/lib/data/seed";
import { newId } from "@/lib/data/store";
import type { User } from "@/lib/data/types";
import { roleById, roleGroups, roles, type RoleId } from "@/lib/rbac/roles";
import { ago, dateTime } from "@/lib/format";
import { submitOperation, usePendingFor, type SubmitResult } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { ConfigNotice } from "./config-notice";
import { AccessRequests } from "./access-requests";
import { changeDirectoryUserRole, deactivateDirectoryUser, directoryEnabled, inviteDirectoryUser, reactivateDirectoryUser, resetDirectoryUserMfa, useDirectoryUsers } from "./directory";
import { mfaMethodLabel } from "@/lib/auth/backend-mfa";
import { PendingBadge, submitWithHooks, SubmitOutcome } from "./operation-ui";
import { roleName } from "./rule-keys";
import { useConfiguredRoles } from "./store";
import type { UserInvitePayload, UserMfaResetPayload, UserRoleChangePayload, UserStatusPayload } from "./platform";
import { adminExport, apiUserCommand, setUserLock, useApiDirectory } from "./iam-service";

const statusTone = { Active: "success", Pending: "info", Suspended: "danger", Locked: "warning" } as const;

/** Displayed status: a locked sign-in (demo account store / API `Locked`) shows as Locked. */
type DisplayStatus = keyof typeof statusTone;

/** Role options with configured names (rule admin.roleName.*). */
function useRoleOptions() {
  const configured = useConfiguredRoles();
  return useMemo(() => roleGroups.flatMap((g) => roles.filter((r) => r.group === g).map((r) => ({ value: r.id, label: `${configured.find((c) => c.id === r.id)?.name ?? r.name} (${g})` }))), [configured]);
}

type Pending = { kind: "deactivate" | "reactivate" | "role" | "mfa-reset"; user: User; to?: RoleId };
type Security = { kind: "lock" | "unlock" | "mfa"; user: User };

/** Permission keys of the user-admin actions (invariant 12). Lock / unlock use the closest keys until TD-972. */
function useUserPermissions() {
  return {
    invite: useCan("identity.users.invite"),
    changeRoles: useCan("identity.users.change-roles"),
    deactivate: useCan("identity.users.deactivate"),
    reactivate: useCan("identity.users.reactivate"),
    resetMfa: useCan("identity.users.reset-mfa"),
    lock: useCan("identity.users.deactivate"),
    unlock: useCan("identity.users.reactivate"),
    exportUsers: useCan("identity.users.export"),
    reviewAccess: useCan("identity.access-requests.review"),
  };
}
type UserPermissions = ReturnType<typeof useUserPermissions>;

/** Admin → Users (PRD §4: named individuals, MFA-enforced). Invites, role changes and (de)activation route through Operations. */
export function UsersPage() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  );
}

function UsersView() {
  // The backend directory (users in the database) when the backend is configured; otherwise the API gateway or app user list.
  const localUsers = useUsers();
  const apiDirectory = useApiDirectory();
  const backendDirectory = useDirectoryUsers();
  const users = directoryEnabled ? backendDirectory.users : (apiDirectory.users ?? localUsers);
  const directory = { ...apiDirectory, error: directoryEnabled ? backendDirectory.error : apiDirectory.error };
  const can = useUserPermissions();
  const canEdit = can.changeRoles || can.deactivate || can.reactivate || can.lock || can.unlock || can.resetMfa;
  const accounts = useAccounts((s) => s.accounts);
  const statusOf = (u: User): DisplayStatus => (directory.locked.has(u.id) || accounts[u.email.toLowerCase()]?.status === "Locked" ? "Locked" : u.status);
  const me = useSession((s) => s.user);
  const params = useSearchParams();
  const [inviteOpen, setInviteOpen] = useState(false);
  // Deep link from notifications: /admin?user=USR-001
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("user"));
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [security, setSecurity] = useState<Security | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = users.find((u) => u.id === selectedId) ?? null;

  const stats = useMemo(
    () => ({
      active: users.filter((u) => u.status === "Active").length,
      pending: users.filter((u) => u.status === "Pending").length,
      suspended: users.filter((u) => u.status === "Suspended").length,
      locked: users.filter((u) => directory.locked.has(u.id) || accounts[u.email.toLowerCase()]?.status === "Locked").length,
      noMfa: users.filter((u) => !u.mfa && u.status !== "Suspended").length,
    }),
    [users, directory.locked, accounts],
  );

  /** MFA reset goes through Operations (`user.mfa-reset`); not offered in API mode until BE-31 (TD-036). */
  const openSecurity = (kind: Security["kind"], u: User) => setSecurity({ kind, user: u });

  const columns: DataTableColumn<User>[] = [
    {
      id: "name",
      header: "User",
      accessor: "name",
      sortable: true,
      cell: (u) => (
        <span className="flex items-center gap-3">
          <Avatar name={u.name} size="small" />
          <span className="flex min-w-0 flex-col">
            <span className="flex flex-wrap items-center gap-2 font-semibold text-fg">
              {u.name} <PendingBadge subjectType="User" subjectId={u.id} />
            </span>
            <span className="truncate text-sm text-fg-muted">{u.email}</span>
          </span>
        </span>
      ),
    },
    { id: "email", header: "Email", accessor: "email", hidden: true },
    { id: "role", header: "Role", accessor: (u) => roleName(u.roleId), sortable: true },
    { id: "group", header: "Group", accessor: (u) => roleById[u.roleId]?.group, hidden: true },
    { id: "branch", header: "Branch", accessor: "branch", sortable: true },
    directoryEnabled
      ? { id: "mfa", header: "MFA", accessor: (u) => mfaMethodLabel(u.mfaMethod), cell: (u) => <Badge tone="success">{mfaMethodLabel(u.mfaMethod)}</Badge> }
      : { id: "mfa", header: "MFA", accessor: (u) => (u.mfa ? "Enrolled" : "Not enrolled"), cell: (u) => (u.mfa ? <Badge tone="success">Enrolled</Badge> : <Badge tone="warning">Not enrolled</Badge>) },
    {
      id: "lastLogin",
      header: "Last sign-in",
      accessor: (u) => u.lastLogin ?? "",
      sortable: true,
      csv: (u) => (u.lastLogin ? dateTime(u.lastLogin) : "Never"),
      cell: (u) => (u.lastLogin ? <span title={dateTime(u.lastLogin)}>{ago(u.lastLogin)}</span> : <span className="text-fg-subtle">Never</span>),
    },
    { id: "status", header: "Status", accessor: (u) => statusOf(u), sortable: true, cell: (u) => <Badge tone={statusTone[statusOf(u)]}>{statusOf(u)}</Badge> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      align: "end",
      cell: (u) =>
        canEdit ? (
          <Menu
            align="end"
            trigger="Manage"
            triggerLabel={`Manage ${u.name}`}
            triggerClassName={buttonStyles({ variant: "tertiary", size: "small" })}
            items={[
              { label: "View details", onSelect: () => setSelectedId(u.id) },
              ...(u.status === "Suspended"
                ? can.reactivate
                  ? [{ label: "Request reactivation", icon: <UserCheck aria-hidden className="size-4" />, onSelect: () => setConfirm({ kind: "reactivate", user: u }) }]
                  : []
                : can.deactivate
                  ? [{ label: "Request deactivation", icon: <UserX aria-hidden className="size-4" />, danger: true, onSelect: () => setConfirm({ kind: "deactivate", user: u }) }]
                  : []),
              // Backend: only an authenticator app can be reset (back to e-mailed codes); never your own (ADR-0017).
              ...(directoryEnabled
                ? can.resetMfa && u.mfaMethod === "authenticator" && u.id !== me?.id
                  ? [{ label: "Reset MFA", icon: <KeyRound aria-hidden className="size-4" />, onSelect: () => setConfirm({ kind: "mfa-reset", user: u }) }]
                  : []
                : [
                  ...(apiEnabled
                    ? []
                    : statusOf(u) === "Locked"
                      ? can.unlock
                        ? [{ label: "Unlock sign-in", icon: <LockOpen aria-hidden className="size-4" />, onSelect: () => openSecurity("unlock", u) }]
                        : []
                      : can.lock && u.status === "Active"
                        ? [{ label: "Lock sign-in", icon: <Lock aria-hidden className="size-4" />, danger: true, onSelect: () => openSecurity("lock", u) }]
                        : []),
                  ...(can.resetMfa && !apiEnabled ? [{ label: "Request MFA reset", icon: <KeyRound aria-hidden className="size-4" />, onSelect: () => openSecurity("mfa", u) }] : []),
                  ]),
            ]}
          />
        ) : (
          <Button size="small" variant="text" onClick={() => setSelectedId(u.id)}>
            View
          </Button>
        ),
    },
  ];

  return (
    <ModulePage
      module="admin"
      description="Named users only — no shared logins. MFA is enforced on every sign-in. Invitations, role changes and deactivations are approved by a second person in Operations."
      actions={
        can.invite ? (
          <SubmitButton iconBefore={<UserPlus aria-hidden className="size-4" />} onClick={() => setInviteOpen(true)}>
            Invite user
          </SubmitButton>
        ) : null
      }
    >
      <Stack gap="large">
        <ConfigNotice canEdit={canEdit} />
        {directory.error ? (
          <Alert tone="warning" title="The user directory couldn't be loaded">
            {directory.error}
          </Alert>
        ) : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {can.reviewAccess ? <AccessRequests canEdit={can.reviewAccess} apiRequests={apiEnabled ? directory.accessRequests : undefined} /> : null}
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Active users" value={stats.active} icon={<Users aria-hidden className="size-5" />} tone="accent" hint={`${users.length} in directory`} />
          <StatCard label="Invitations pending" value={stats.pending} icon={<UserPlus aria-hidden className="size-5" />} tone="info" hint="Awaiting first sign-in" />
          <StatCard label="MFA not enrolled" value={stats.noMfa} icon={<ShieldCheck aria-hidden className="size-5" />} tone={stats.noMfa ? "warning" : "success"} hint="Blocked until enrolment" />
          <StatCard label="Deactivated / locked" value={stats.suspended + stats.locked} icon={<UserX aria-hidden className="size-5" />} tone="neutral" hint={`${stats.suspended} deactivated · ${stats.locked} locked`} />
        </Grid>
        <Card>
          <CardContent>
            <DataTable
              columns={columns}
              data={users}
              getRowId={(u) => u.id}
              label="Users"
              searchable
              searchPlaceholder="Search name, email or branch…"
              filters={[
                { id: "role", label: "Role", columnId: "role" },
                { id: "branch", label: "Branch", columnId: "branch" },
                { id: "status", label: "Status", columnId: "status" },
                { id: "mfa", label: "MFA", columnId: "mfa" },
              ]}
              defaultSort={{ id: "name", direction: "asc" }}
              exportFilename={can.exportUsers ? "users.csv" : undefined}
              onExport={adminExport("users")}
              rowProps={(u) => ({ "aria-current": u.id === me?.id ? "true" : undefined })}
              mobileCard={(u) => (
                <button type="button" className="flex w-full flex-col items-start gap-1 text-start" onClick={() => setSelectedId(u.id)}>
                  <span className="font-semibold">{u.name}</span>
                  <span className="text-sm text-fg-muted">
                    {roleName(u.roleId)} · {u.branch}
                  </span>
                  <span className="flex gap-2">
                    <Badge tone={statusTone[statusOf(u)]}>{statusOf(u)}</Badge>
                    {u.mfa ? <Badge tone="success">MFA</Badge> : <Badge tone="warning">No MFA</Badge>}
                  </span>
                </button>
              )}
            />
          </CardContent>
        </Card>
      </Stack>

      {security ? (
        <SecurityDialog
          key={`${security.kind}:${security.user.id}`}
          security={security}
          onClose={() => setSecurity(null)}
          onDone={(message) => {
            setNotice(message);
            setSecurity(null);
          }}
        />
      ) : null}

      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} existingEmails={users.map((u) => u.email.toLowerCase())} />

      <Drawer open={selected !== null} onOpenChange={(o) => !o && setSelectedId(null)} title={selected?.name ?? "User"} description={selected?.email}>
        {selected ? <UserDetails user={selected} status={statusOf(selected)} can={can} isSelf={selected.id === me?.id} onAction={setConfirm} onSecurity={(kind) => openSecurity(kind, selected)} /> : null}
      </Drawer>

      {confirm ? <ConfirmModal key={`${confirm.kind}:${confirm.user.id}:${confirm.to ?? ""}`} pending={confirm} isSelf={confirm.user.id === me?.id} onClose={() => setConfirm(null)} /> : null}
    </ModulePage>
  );
}

const signInMethodLabel = (method?: string) => (method === "microsoft" ? "Microsoft (Entra ID)" : method === "password" ? "E-mail and password + one-time code" : "Not signed in yet");

function UserDetails({ user, status, can, isSelf, onAction, onSecurity }: { user: User; status: DisplayStatus; can: UserPermissions; isSelf: boolean; onAction: (p: Pending) => void; onSecurity: (kind: Security["kind"]) => void }) {
  const canEdit = can.changeRoles || can.deactivate || can.reactivate || can.lock || can.unlock || can.resetMfa;
  const roleOptions = useRoleOptions();
  const pending = usePendingFor("User", user.id);
  return (
    <Stack gap="large">
      <PendingBadge subjectType="User" subjectId={user.id} />
      <DescriptionList
        columns={1}
        items={[
          { label: "Role", value: roleName(user.roleId), hint: roleById[user.roleId]?.authority },
          { label: "Branch", value: user.branch },
          { label: "Status", status, statusTones: statusTone },
          {
            label: "MFA",
            value: directoryEnabled
              ? `${mfaMethodLabel(user.mfaMethod)}${user.signInMethod === "microsoft" ? " — Microsoft sign-in uses the organisation's Entra ID MFA" : ""}`
              : user.mfa
                ? "Enrolled"
                : "Not enrolled — sign-in blocked until enrolment",
          },
          { label: "Last sign-in", value: user.lastLogin ? dateTime(user.lastLogin) : "Never" },
          ...(directoryEnabled ? [{ label: "Last sign-in method", value: signInMethodLabel(user.signInMethod) }] : []),
        ]}
      />
      {canEdit ? (
        <Stack gap="medium">
          {can.changeRoles ? (
            <Field label="Role" htmlFor="user-role" description={pending ? "A change for this user is awaiting approval." : "Choosing a role sends a role-change request for approval. It applies at the user's next sign-in."}>
              <Select id="user-role" value={user.roleId} options={roleOptions} disabled={Boolean(pending)} onChange={(e) => onAction({ kind: "role", user, to: e.target.value as RoleId })} />
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {user.status === "Suspended" ? (
              can.reactivate ? (
                <Button variant="secondary" disabled={Boolean(pending)} onClick={() => onAction({ kind: "reactivate", user })}>
                  Request reactivation
                </Button>
              ) : null
            ) : can.deactivate ? (
              <SubmitButton variant="danger" disabled={Boolean(pending)} onClick={() => onAction({ kind: "deactivate", user })}>
                Request deactivation
              </SubmitButton>
            ) : null}
            {directoryEnabled ? (
              can.resetMfa && user.mfaMethod === "authenticator" && !isSelf ? (
                <Button variant="tertiary" onClick={() => onAction({ kind: "mfa-reset", user })}>
                  Reset MFA
                </Button>
              ) : null
            ) : can.resetMfa ? (
              <Button variant="tertiary" disabled={apiEnabled || Boolean(pending)} title={apiEnabled ? "Not available yet — the backend has no MFA reset endpoint (BE-31, TD-036)." : undefined} onClick={() => onSecurity("mfa")}>
                Request MFA reset
              </Button>
            ) : null}
            {!apiEnabled && !directoryEnabled && status === "Locked" && can.unlock ? (
              <Button variant="secondary" iconBefore={<LockOpen aria-hidden className="size-4" />} onClick={() => onSecurity("unlock")}>
                Unlock sign-in
              </Button>
            ) : null}
            {!apiEnabled && !directoryEnabled && status === "Active" && can.lock ? (
              <Button variant="tertiary" iconBefore={<Lock aria-hidden className="size-4" />} onClick={() => onSecurity("lock")}>
                Lock sign-in
              </Button>
            ) : null}
          </div>
          {apiEnabled ? (
            <Text variant="caption" tone="subtle">
              Lock / unlock and MFA reset aren&apos;t available from the backend yet (TD-972, BE-31).
            </Text>
          ) : null}
        </Stack>
      ) : (
        <Alert tone="info">View only — your permissions don&apos;t include changing users.</Alert>
      )}
    </Stack>
  );
}

const copy = {
  deactivate: { title: "Request deactivation?", button: "Request deactivation", type: "user.deactivate", verb: "Deactivate" },
  reactivate: { title: "Request reactivation?", button: "Request reactivation", type: "user.reactivate", verb: "Reactivate" },
  role: { title: "Request role change?", button: "Request role change", type: "user.role-change", verb: "Change role of" },
  "mfa-reset": { title: "Reset sign-in steps?", button: "Reset MFA", type: "user.mfa-reset", verb: "Reset sign-in steps of" },
} as const;

function ConfirmModal({ pending, isSelf, onClose }: { pending: Pending; isSelf: boolean; onClose: () => void }) {
  const minReason = useRule<number>("operations.minCommentLength");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiOutcome, setApiOutcome] = useState<Awaited<ReturnType<typeof apiUserCommand>> | null>(null);
  const { user, kind, to } = pending;
  const c = copy[kind];

  const submit = async () => {
    if (reason.trim().length < minReason) return setResult({ ok: false, reason: `Give a reason of at least ${minReason} characters.` });
    setBusy(true);
    const subject = { type: "User", id: user.id, title: user.name, href: `/admin?user=${user.id}` };
    if (apiEnabled && kind !== "mfa-reset") {
      // API mode: the backend routes the command through Operations (202 → operationId).
      const outcome = await apiUserCommand(kind, user.id, reason.trim(), to);
      setBusy(false);
      setApiOutcome(outcome);
      return;
    }
    const r = await submitWithHooks("admin.user.change", { action: kind, userId: user.id, to, reason: reason.trim() }, (ctx) =>
      directoryEnabled
        ? kind === "mfa-reset"
          ? resetDirectoryUserMfa(user.id, ctx.reason)
          : kind === "role"
          ? changeDirectoryUserRole(user.id, ctx.to!, ctx.reason)
          : kind === "deactivate"
            ? deactivateDirectoryUser(user.id, ctx.reason)
            : reactivateDirectoryUser(user.id, ctx.reason)
        : kind === "role"
        ? submitOperation<UserRoleChangePayload>(c.type, {
            title: `${c.verb} ${user.name}: ${roleName(user.roleId)} → ${roleName(ctx.to!)}`,
            subject,
            payload: { userId: user.id, from: user.roleId, to: ctx.to!, reason: ctx.reason },
            summary: [
              { label: "User", value: `${user.name} (${user.email})` },
              { label: "Current role", value: roleName(user.roleId) },
              { label: "New role", value: roleName(ctx.to!) },
              { label: "Reason", value: ctx.reason },
            ],
          })
        : submitOperation<UserStatusPayload>(c.type, {
            title: `${c.verb} ${user.name}`,
            subject,
            payload: { userId: user.id, reason: ctx.reason },
            summary: [
              { label: "User", value: `${user.name} (${user.email})` },
              { label: "Role", value: roleName(user.roleId) },
              { label: "Status", value: `${user.status} → ${kind === "deactivate" ? "Suspended" : "Active"}` },
              { label: "Reason", value: ctx.reason },
            ],
          }),
    );
    setBusy(false);
    setResult(r);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      size="small"
      title={c.title}
      description={
        kind === "deactivate"
          ? `${user.name} will be signed out and blocked once a second person approves. Their history and audit trail are kept.`
          : kind === "reactivate"
            ? `${user.name} will be able to sign in again with MFA once approved.`
            : kind === "mfa-reset"
            ? `${user.name} goes back to codes sent by e-mail (for example after losing their phone) and every open session is signed out. They can set up an authenticator app again in Settings → Security.`
            : `${user.name}: ${roleName(user.roleId)} → ${roleName(to!)}. Applies at the next sign-in once approved.`
      }
      footer={
        result?.ok ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant={kind === "deactivate" ? "danger" : "primary"} loading={busy} onClick={() => void submit()}>
              {c.button}
            </Button>
          </>
        )
      }
    >
      <Stack gap="medium">
        {isSelf ? <Alert tone="warning">This is your own account.</Alert> : null}
        <Field label="Reason" htmlFor="user-change-reason" required description="Shown to the approver and the user; kept in the audit log.">
          <Textarea id="user-change-reason" rows={3} value={reason} disabled={Boolean(result?.ok)} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <SubmitOutcome result={result} />
        {apiOutcome ? apiOutcome.ok ? <Alert tone="success" title="Sent for approval">Track request {apiOutcome.operationId} in Operations.</Alert> : <Alert tone="danger">{apiOutcome.reason}</Alert> : null}
      </Stack>
    </Modal>
  );
}

const securityCopy = {
  lock: { title: "Lock sign-in?", confirm: "Lock sign-in", tone: "danger" as const, describe: (u: User) => `${u.name} can't sign in until an admin unlocks the account or they reset their password. Takes effect immediately.` },
  unlock: { title: "Unlock sign-in?", confirm: "Unlock sign-in", tone: "default" as const, describe: (u: User) => `${u.name} can sign in again — a one-time code is still required.` },
  mfa: { title: "Request MFA reset?", confirm: "Request MFA reset", tone: "default" as const, describe: (u: User) => `${u.name} will enrol in MFA again at the next sign-in once a second person approves in Operations.` },
};

/** Lock / unlock (immediate, reason required — AUTH-OQ2) and MFA reset (Operations `user.mfa-reset`). */
function SecurityDialog({ security, onClose, onDone }: { security: Security; onClose: () => void; onDone: (message: string) => void }) {
  const minReason = useRule<number>("operations.minCommentLength");
  const { kind, user } = security;
  const c = securityCopy[kind];
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={c.title}
      description={c.describe(user)}
      tone={c.tone}
      reason="required"
      minReasonLength={minReason}
      reasonDescription="Shown to the user and kept in the audit log."
      confirmLabel={c.confirm}
      onConfirm={async (reason) => {
        if (kind === "mfa") {
          const r = await submitWithHooks("admin.user.change", { action: "mfa-reset", userId: user.id, reason }, (ctx) =>
            submitOperation<UserMfaResetPayload>("user.mfa-reset", {
              title: `Reset MFA of ${user.name}`,
              subject: { type: "User", id: user.id, title: user.name, href: `/admin?user=${user.id}` },
              payload: { userId: user.id, reason: ctx.reason },
              summary: [
                { label: "User", value: `${user.name} (${user.email})` },
                { label: "Reason", value: ctx.reason },
              ],
            }),
          );
          if (!r.ok) throw new Error(r.reason);
          onDone(r.applied ? `MFA reset for ${user.name}.` : `MFA reset for ${user.name} sent for approval (${r.instance.id}).`);
          return;
        }
        const r = await setUserLock(user, kind === "lock", reason);
        if (!r.ok) throw new Error(r.error);
        onDone(kind === "lock" ? `Sign-in locked for ${user.name}.` : `Sign-in unlocked for ${user.name}.`);
      }}
    >
      <Text variant="small" tone="muted">
        {user.email} · {roleName(user.roleId)}
      </Text>
    </ConfirmDialog>
  );
}

function InviteModal({ open, onOpenChange, existingEmails }: { open: boolean; onOpenChange: (o: boolean) => void; existingEmails: string[] }) {
  const roleOptions = useRoleOptions();
  const minNameParts = useRule<number>("admin.user.minNameParts");
  const defaultRole = useRule<string>("admin.user.defaultInviteRole") as RoleId;
  const minReason = useRule<number>("operations.minCommentLength");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<RoleId>(defaultRole);
  const [branch, setBranch] = useState(branches[0]!);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    setName("");
    setEmail("");
    setReason("");
    setError(null);
    setResult(null);
  };

  const submit = async () => {
    if (name.trim().split(/\s+/).length < minNameParts) return setError("Enter the person's full name — shared or generic logins aren't allowed.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid work email address.");
    if (existingEmails.includes(email.toLowerCase())) return setError("A user with this email already exists.");
    if (reason.trim().length < minReason) return setError(`Give a reason of at least ${minReason} characters.`);
    setError(null);
    const user: User = { id: newId("USR"), name: name.trim(), email: email.trim(), roleId, branch, status: "Pending", mfa: false };
    if (apiEnabled) {
      try {
        const accepted = await identityApi.inviteUser({ email: user.email, name: user.name, roleIds: [user.roleId], branch: user.branch, reason: reason.trim() });
        setError(null);
        setApiNotice(`Sent for approval — track request ${accepted.operationId} in Operations.`);
      } catch (e) {
        setError(problemText(e));
      }
      return;
    }
    const r = await submitWithHooks("admin.user.change", { action: "invite", user, reason: reason.trim() }, (ctx) =>
      directoryEnabled
        ? inviteDirectoryUser({ email: ctx.user.email, name: ctx.user.name, roleId: ctx.user.roleId, branch: ctx.user.branch, reason: ctx.reason })
        : submitOperation<UserInvitePayload>("user.invite", {
        title: `Invite ${ctx.user.name} as ${roleName(ctx.user.roleId)}`,
        subject: { type: "User", id: ctx.user.id, title: ctx.user.name, href: `/admin?user=${ctx.user.id}` },
        payload: { user: ctx.user, reason: ctx.reason },
        summary: [
          { label: "Name", value: ctx.user.name },
          { label: "Email", value: ctx.user.email },
          { label: "Role", value: roleName(ctx.user.roleId) },
          { label: "Branch", value: ctx.user.branch },
          { label: "Reason", value: ctx.reason },
        ],
      }),
    );
    setResult(r);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Invite user"
      description="The invitation is approved by a second person in Operations. The user then signs in with their Microsoft work account and enrols in MFA."
      footer={
        result?.ok ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="tertiary" onClick={close}>
              Cancel
            </Button>
            <SubmitButton onClick={() => void submit()}>Request invitation</SubmitButton>
          </>
        )
      }
    >
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {apiNotice ? <Alert tone="success">{apiNotice}</Alert> : null}
        <SubmitOutcome result={result} />
        <Field label="Full name" htmlFor="inv-name" required>
          <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Work email" htmlFor="inv-email" required description="Must match the user's Microsoft Entra ID account.">
          <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@harbourline.example" />
        </Field>
        <Grid columns={{ base: 1, sm: 2 }} gap="medium">
          <Field label="Role" htmlFor="inv-role">
            <Select id="inv-role" value={roleId} options={roleOptions} onChange={(e) => setRoleId(e.target.value as RoleId)} />
          </Field>
          <Field label="Branch" htmlFor="inv-branch">
            <Select id="inv-branch" value={branch} options={branches.map((b) => ({ value: b, label: b }))} onChange={(e) => setBranch(e.target.value)} />
          </Field>
        </Grid>
        <Field label="Reason" htmlFor="inv-reason" required>
          <Textarea id="inv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New hire, Credit Risk — Lagos" />
        </Field>
        <Text variant="caption" tone="subtle">
          System Admins are notified when the invitation is approved.
        </Text>
      </Form>
    </Modal>
  );
}
