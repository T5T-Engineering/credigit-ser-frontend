"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, ShieldCheck, UserCheck, UserPlus, Users, UserX } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  buttonStyles,
  Card,
  CardContent,
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
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan, useSession } from "@/lib/auth/session";
import { useDbActions, useUsers } from "@/lib/data/hooks";
import { branches } from "@/lib/data/seed";
import { newId } from "@/lib/data/store";
import type { User } from "@/lib/data/types";
import { roleById, roleGroups, roles, type RoleId } from "@/lib/rbac/roles";
import { ago, dateTime } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { submitOperation, usePendingFor, type SubmitResult } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useAuditLog } from "@/modules/workspace/use-audit-log";
import { ConfigNotice } from "./config-notice";
import { AccessRequests } from "./access-requests";
import { changeDirectoryUserRole, deactivateDirectoryUser, directoryEnabled, inviteDirectoryUser, reactivateDirectoryUser, resetDirectoryUserMfa, useDirectoryUsers } from "./directory";
import { mfaMethodLabel } from "@/lib/auth/backend-mfa";
import { PendingBadge, submitWithHooks, SubmitOutcome } from "./operation-ui";
import { roleName } from "./rule-keys";
import { useConfiguredRoles } from "./store";
import type { UserInvitePayload, UserRoleChangePayload, UserStatusPayload } from "./platform";

const statusTone = { Active: "success", Pending: "info", Suspended: "danger" } as const;

/** Role options with configured names (rule admin.roleName.*). */
function useRoleOptions() {
  const configured = useConfiguredRoles();
  return useMemo(() => roleGroups.flatMap((g) => roles.filter((r) => r.group === g).map((r) => ({ value: r.id, label: `${configured.find((c) => c.id === r.id)?.name ?? r.name} (${g})` }))), [configured]);
}

type Pending = { kind: "deactivate" | "reactivate" | "role" | "mfa-reset"; user: User; to?: RoleId };

/** Admin → Users (PRD §4: named individuals, MFA-enforced). Invites, role changes and (de)activation route through Operations. */
export function UsersPage() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  );
}

function UsersView() {
  // The backend directory (users in the database) when the backend is configured; otherwise the app user list.
  const localUsers = useUsers();
  const directory = useDirectoryUsers();
  const users = directoryEnabled ? directory.users : localUsers;
  const canEdit = useCan("admin", "edit");
  const me = useSession((s) => s.user);
  const { update } = useDbActions();
  const log = useAuditLog();
  const params = useSearchParams();
  const [inviteOpen, setInviteOpen] = useState(false);
  // Deep link from notifications: /admin?user=USR-001
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("user"));
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [mfaNotice, setMfaNotice] = useState<string | null>(null);
  const selected = users.find((u) => u.id === selectedId) ?? null;

  const stats = useMemo(
    () => ({
      active: users.filter((u) => u.status === "Active").length,
      pending: users.filter((u) => u.status === "Pending").length,
      suspended: users.filter((u) => u.status === "Suspended").length,
      noMfa: users.filter((u) => !u.mfa && u.status !== "Suspended").length,
    }),
    [users],
  );

  /** MFA reset is a security action on the user's own enrolment — direct, audited, notified, published. */
  const resetMfa = async (u: User) => {
    const before = await runHooks("admin.user.change.before", { action: "mfa-reset", userId: u.id });
    if (!before.ok) return setMfaNotice(`Blocked by ${before.vetoedBy}: ${before.reason}`);
    notify({ templateId: "admin.user-mfa-reset", toUserIds: [u.id], href: "/settings", data: { name: u.name, by: me?.name ?? "System Admin" } });
    update("users", u.id, { mfa: false });
    log({ action: "Reset MFA enrolment", entityType: "User", entityId: u.id, before: "Enrolled", after: "Re-enrolment required" });
    publish("admin.user.mfa-reset", { module: "admin", subject: { type: "User", id: u.id, title: u.name, href: `/admin?user=${u.id}` } });
    await runHooks("admin.user.change.after", { action: "mfa-reset", userId: u.id });
    setMfaNotice(`MFA reset for ${u.name}. They'll enrol again at the next sign-in.`);
  };

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
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (u) => <Badge tone={statusTone[u.status]}>{u.status}</Badge> },
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
              u.status === "Suspended"
                ? { label: "Request reactivation", icon: <UserCheck aria-hidden className="size-4" />, onSelect: () => setConfirm({ kind: "reactivate", user: u }) }
                : { label: "Request deactivation", icon: <UserX aria-hidden className="size-4" />, danger: true, onSelect: () => setConfirm({ kind: "deactivate", user: u }) },
              // Backend: only an authenticator app can be reset (back to e-mailed codes); never your own (ADR-0017).
              ...(directoryEnabled
                ? u.mfaMethod === "authenticator" && u.id !== me?.id
                  ? [{ label: "Reset MFA", icon: <KeyRound aria-hidden className="size-4" />, onSelect: () => setConfirm({ kind: "mfa-reset", user: u }) }]
                  : []
                : [{ label: "Reset MFA", icon: <KeyRound aria-hidden className="size-4" />, onSelect: () => void resetMfa(u) }]),
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
        canEdit ? (
          <Button iconBefore={<UserPlus aria-hidden className="size-4" />} onClick={() => setInviteOpen(true)}>
            Invite user
          </Button>
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
        {mfaNotice ? <Alert tone="info">{mfaNotice}</Alert> : null}
        <AccessRequests canEdit={canEdit} />
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Active users" value={stats.active} icon={<Users aria-hidden className="size-5" />} tone="accent" hint={`${users.length} in directory`} />
          <StatCard label="Invitations pending" value={stats.pending} icon={<UserPlus aria-hidden className="size-5" />} tone="info" hint="Awaiting first sign-in" />
          <StatCard label="MFA not enrolled" value={stats.noMfa} icon={<ShieldCheck aria-hidden className="size-5" />} tone={stats.noMfa ? "warning" : "success"} hint="Blocked until enrolment" />
          <StatCard label="Deactivated" value={stats.suspended} icon={<UserX aria-hidden className="size-5" />} tone="neutral" hint="Access revoked, history kept" />
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
              exportFilename="users.csv"
              rowProps={(u) => ({ "aria-current": u.id === me?.id ? "true" : undefined })}
              mobileCard={(u) => (
                <button type="button" className="flex w-full flex-col items-start gap-1 text-start" onClick={() => setSelectedId(u.id)}>
                  <span className="font-semibold">{u.name}</span>
                  <span className="text-sm text-fg-muted">
                    {roleName(u.roleId)} · {u.branch}
                  </span>
                  <span className="flex gap-2">
                    <Badge tone={statusTone[u.status]}>{u.status}</Badge>
                    {u.mfa ? <Badge tone="success">MFA</Badge> : <Badge tone="warning">No MFA</Badge>}
                  </span>
                </button>
              )}
            />
          </CardContent>
        </Card>
      </Stack>

      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} existingEmails={users.map((u) => u.email.toLowerCase())} />

      <Drawer open={selected !== null} onOpenChange={(o) => !o && setSelectedId(null)} title={selected?.name ?? "User"} description={selected?.email}>
        {selected ? <UserDetails user={selected} canEdit={canEdit} isSelf={selected.id === me?.id} onAction={setConfirm} onResetMfa={() => void resetMfa(selected)} /> : null}
      </Drawer>

      {confirm ? <ConfirmModal key={`${confirm.kind}:${confirm.user.id}:${confirm.to ?? ""}`} pending={confirm} isSelf={confirm.user.id === me?.id} onClose={() => setConfirm(null)} /> : null}
    </ModulePage>
  );
}

const signInMethodLabel = (method?: string) => (method === "microsoft" ? "Microsoft (Entra ID)" : method === "password" ? "E-mail and password + one-time code" : "Not signed in yet");

function UserDetails({ user, canEdit, isSelf, onAction, onResetMfa }: { user: User; canEdit: boolean; isSelf: boolean; onAction: (p: Pending) => void; onResetMfa: () => void }) {
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
          { label: "Status", status: user.status, statusTones: statusTone },
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
          <Field label="Role" htmlFor="user-role" description={pending ? "A change for this user is awaiting approval." : "Choosing a role sends a role-change request for approval. It applies at the user's next sign-in."}>
            <Select id="user-role" value={user.roleId} options={roleOptions} disabled={Boolean(pending)} onChange={(e) => onAction({ kind: "role", user, to: e.target.value as RoleId })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {user.status === "Suspended" ? (
              <Button variant="secondary" disabled={Boolean(pending)} onClick={() => onAction({ kind: "reactivate", user })}>
                Request reactivation
              </Button>
            ) : (
              <Button variant="danger" disabled={Boolean(pending)} onClick={() => onAction({ kind: "deactivate", user })}>
                Request deactivation
              </Button>
            )}
            {directoryEnabled ? (
              user.mfaMethod === "authenticator" && !isSelf ? (
                <Button variant="tertiary" onClick={() => onAction({ kind: "mfa-reset", user })}>
                  Reset MFA
                </Button>
              ) : null
            ) : (
              <Button variant="tertiary" onClick={onResetMfa}>
                Reset MFA
              </Button>
            )}
          </div>
        </Stack>
      ) : (
        <Alert tone="info">View only — user changes need the System Admin role.</Alert>
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
  const { user, kind, to } = pending;
  const c = copy[kind];

  const submit = async () => {
    if (reason.trim().length < minReason) return setResult({ ok: false, reason: `Give a reason of at least ${minReason} characters.` });
    setBusy(true);
    const subject = { type: "User", id: user.id, title: user.name, href: `/admin?user=${user.id}` };
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
      </Stack>
    </Modal>
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
            <Button onClick={() => void submit()}>Request invitation</Button>
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
