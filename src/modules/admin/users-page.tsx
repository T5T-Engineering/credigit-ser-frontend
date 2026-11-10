"use client";

import { useMemo, useState } from "react";
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
import { useAuditLog } from "@/modules/workspace/use-audit-log";
import { ConfigNotice } from "./config-notice";
import { AccessRequests } from "./access-requests";

const statusTone = { Active: "success", Pending: "info", Suspended: "danger" } as const;
const roleOptions = roleGroups.flatMap((g) => roles.filter((r) => r.group === g).map((r) => ({ value: r.id, label: `${r.name} (${g})` })));

/** Admin → Users (PRD §4: named individuals, MFA-enforced; System Admin creates/deactivates users). */
export function UsersPage() {
  const users = useUsers();
  const canEdit = useCan("admin", "edit");
  const me = useSession((s) => s.user);
  const { upsert, update } = useDbActions();
  const log = useAuditLog();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [confirm, setConfirm] = useState<{ user: User; to: User["status"] } | null>(null);

  const stats = useMemo(
    () => ({
      active: users.filter((u) => u.status === "Active").length,
      pending: users.filter((u) => u.status === "Pending").length,
      suspended: users.filter((u) => u.status === "Suspended").length,
      noMfa: users.filter((u) => !u.mfa && u.status !== "Suspended").length,
    }),
    [users],
  );

  const setStatus = (u: User, status: User["status"]) => {
    update("users", u.id, { status });
    log({ action: status === "Suspended" ? "Deactivated user" : "Reactivated user", entityType: "User", entityId: u.id, before: u.status, after: status });
    setSelected((s) => (s && s.id === u.id ? { ...s, status } : s));
  };
  const setRole = (u: User, roleId: RoleId) => {
    update("users", u.id, { roleId });
    log({ action: "Changed user role", entityType: "User", entityId: u.id, before: roleById[u.roleId].name, after: roleById[roleId].name });
    setSelected((s) => (s && s.id === u.id ? { ...s, roleId } : s));
  };
  const resetMfa = (u: User) => {
    update("users", u.id, { mfa: false });
    log({ action: "Reset MFA enrolment", entityType: "User", entityId: u.id, before: "Enrolled", after: "Re-enrolment required" });
    setSelected((s) => (s && s.id === u.id ? { ...s, mfa: false } : s));
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
            <span className="font-semibold text-fg">{u.name}</span>
            <span className="truncate text-sm text-fg-muted">{u.email}</span>
          </span>
        </span>
      ),
    },
    { id: "email", header: "Email", accessor: "email", hidden: true },
    { id: "role", header: "Role", accessor: (u) => roleById[u.roleId]?.name, sortable: true },
    { id: "group", header: "Group", accessor: (u) => roleById[u.roleId]?.group, hidden: true },
    { id: "branch", header: "Branch", accessor: "branch", sortable: true },
    { id: "mfa", header: "MFA", accessor: (u) => (u.mfa ? "Enrolled" : "Not enrolled"), cell: (u) => (u.mfa ? <Badge tone="success">Enrolled</Badge> : <Badge tone="warning">Not enrolled</Badge>) },
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
              { label: "View details", onSelect: () => setSelected(u) },
              u.status === "Suspended"
                ? { label: "Reactivate", icon: <UserCheck aria-hidden className="size-4" />, onSelect: () => setConfirm({ user: u, to: "Active" }) }
                : { label: "Deactivate", icon: <UserX aria-hidden className="size-4" />, danger: true, onSelect: () => setConfirm({ user: u, to: "Suspended" }) },
              { label: "Reset MFA", icon: <KeyRound aria-hidden className="size-4" />, onSelect: () => resetMfa(u) },
            ]}
          />
        ) : (
          <Button size="small" variant="text" onClick={() => setSelected(u)}>
            View
          </Button>
        ),
    },
  ];

  return (
    <ModulePage
      module="admin"
      description="Named users only — no shared logins. MFA is enforced on every sign-in and every change is written to the audit log."
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
                <button type="button" className="flex w-full flex-col items-start gap-1 text-start" onClick={() => setSelected(u)}>
                  <span className="font-semibold">{u.name}</span>
                  <span className="text-sm text-fg-muted">
                    {roleById[u.roleId].name} · {u.branch}
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

      <InviteModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        existingEmails={users.map((u) => u.email.toLowerCase())}
        onInvite={(u) => {
          upsert("users", u);
          log({ action: "Invited user", entityType: "User", entityId: u.id, after: `${u.name} · ${roleById[u.roleId].name} · ${u.branch}` });
        }}
      />

      <Drawer open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} title={selected?.name ?? "User"} description={selected?.email}>
        {selected ? (
          <Stack gap="large">
            <DescriptionList
              columns={1}
              items={[
                { label: "User ID", value: selected.id, mono: true, copyValue: selected.id },
                { label: "Role", value: roleById[selected.roleId].name, hint: roleById[selected.roleId].authority },
                { label: "Branch", value: selected.branch },
                { label: "Status", status: selected.status, statusTones: statusTone },
                { label: "MFA", value: selected.mfa ? "Enrolled (Microsoft Authenticator)" : "Not enrolled — sign-in blocked until enrolment" },
                { label: "Last sign-in", value: selected.lastLogin ? dateTime(selected.lastLogin) : "Never" },
                { label: "Sign-in method", value: "Microsoft Entra ID (SSO)" },
              ]}
            />
            {canEdit ? (
              <Stack gap="medium">
                <Field label="Role" htmlFor="user-role" description="Role changes take effect at the user's next sign-in.">
                  <Select id="user-role" value={selected.roleId} options={roleOptions} onChange={(e) => setRole(selected, e.target.value as RoleId)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {selected.status === "Suspended" ? (
                    <Button variant="secondary" onClick={() => setConfirm({ user: selected, to: "Active" })}>
                      Reactivate
                    </Button>
                  ) : (
                    <Button variant="danger" onClick={() => setConfirm({ user: selected, to: "Suspended" })}>
                      Deactivate
                    </Button>
                  )}
                  <Button variant="tertiary" onClick={() => resetMfa(selected)}>
                    Reset MFA
                  </Button>
                </div>
              </Stack>
            ) : (
              <Alert tone="info">View only — user changes need the System Admin role.</Alert>
            )}
          </Stack>
        ) : null}
      </Drawer>

      <Modal
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        size="small"
        title={confirm?.to === "Suspended" ? "Deactivate user?" : "Reactivate user?"}
        description={
          confirm?.to === "Suspended"
            ? `${confirm.user.name} will be signed out and blocked. Their history and audit trail are kept.`
            : `${confirm?.user.name} will be able to sign in again with MFA.`
        }
        footer={
          <>
            <Button variant="tertiary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.to === "Suspended" ? "danger" : "primary"}
              onClick={() => {
                if (confirm) setStatus(confirm.user, confirm.to);
                setConfirm(null);
              }}
            >
              {confirm?.to === "Suspended" ? "Deactivate" : "Reactivate"}
            </Button>
          </>
        }
      >
        {confirm?.user.id === me?.id ? <Alert tone="warning">This is your own account.</Alert> : <Text tone="muted">This change is recorded in the audit log.</Text>}
      </Modal>
    </ModulePage>
  );
}

function InviteModal({ open, onOpenChange, onInvite, existingEmails }: { open: boolean; onOpenChange: (o: boolean) => void; onInvite: (u: User) => void; existingEmails: string[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<RoleId>("account-officer");
  const [branch, setBranch] = useState(branches[0]!);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (name.trim().split(/\s+/).length < 2) return setError("Enter the person's full name — shared or generic logins aren't allowed.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid work email address.");
    if (existingEmails.includes(email.toLowerCase())) return setError("A user with this email already exists.");
    onInvite({ id: newId("USR"), name: name.trim(), email: email.trim(), roleId, branch, status: "Pending", mfa: false });
    setName("");
    setEmail("");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Invite user"
      description="The user signs in with their Microsoft work account and must enrol in MFA on first sign-in."
      footer={
        <>
          <Button variant="tertiary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Send invitation</Button>
        </>
      }
    >
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
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
      </Form>
    </Modal>
  );
}
