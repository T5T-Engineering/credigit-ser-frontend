"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  Field,
  Grid,
  PermissionMatrix,
  Select,
  Stack,
  StatCard,
  Text,
  TextLink,
  diffRoleGrants,
  type PermissionDefinition,
  type PermissionGrants,
  type PermissionModule,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { apiEnabled } from "@/lib/api/config";
import { problemText } from "@/lib/api/client";
import { identityApi, type ApiRole } from "@/lib/iam/api";
import { isAdministratorRole, isProtectedFor, permissionCatalogue, protectedAdministratorPatterns, type PermissionKey } from "@/lib/iam/catalogue";
import { roleGrants, useGrantsStore } from "@/lib/iam/grants-store";
import { useCan } from "@/lib/iam/permissions";
import { allNavItems } from "@/lib/nav";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { operationHref } from "./operation-ui";
import { requestRolePermissionChanges, type RoleGrantChange } from "./iam-service";
import { useConfiguredRoles } from "./store";

const definitions: PermissionDefinition[] = permissionCatalogue.map((p) => ({ key: p.key, label: p.label, description: p.description, module: p.module, group: p.group, sensitive: p.sensitive, level: p.level }));

/** Module headings: the nav label where a nav module has the same id, else the id in sentence case. */
const modules: PermissionModule[] = [...new Set(permissionCatalogue.map((p) => p.module))].map((id) => ({
  id,
  label: allNavItems.find((i) => i.module === id)?.label ?? id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
}));

type RoleRow = { id: string; name: string; description: string; administrator: boolean; grants: string[] };

/** Demo roles (configured names + custom roles) with their effective grants. */
function useDemoRoles(): RoleRow[] {
  const configured = useConfiguredRoles();
  const overrides = useGrantsStore((s) => s.overrides);
  return useMemo(
    () =>
      configured.map((r) => {
        const source = (r.custom?.clonedFrom ?? r.id) as RoleId;
        return { id: r.id, name: r.name, description: r.description, administrator: isAdministratorRole(r.id), grants: [...roleGrants(r.id, roleById[source]?.modules, overrides)] };
      }),
    [configured, overrides],
  );
}

/** API mode: `GET /identity/roles` (effective permissions per role). */
function useApiRoles(): { roles: RoleRow[] | null; error: string | null } {
  const [state, setState] = useState<{ roles: RoleRow[] | null; error: string | null }>({ roles: null, error: null });
  useEffect(() => {
    if (!apiEnabled) return;
    let live = true;
    identityApi.roles().then(
      (list: ApiRole[]) => live && setState({ roles: list.map((r) => ({ id: r.id, name: r.name, description: r.description, administrator: r.administrator, grants: r.permissions })), error: null }),
      (e) => live && setState({ roles: null, error: problemText(e) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** Admin → Permissions (ADM-FR-18): roles × catalogue permissions; changes go to Operations as `role.permissions-change`. */
export function PermissionsPage() {
  return (
    <Suspense>
      <PermissionsView />
    </Suspense>
  );
}

function PermissionsView() {
  const router = useRouter();
  const params = useSearchParams();
  const canChange = useCan("identity.roles.change-permissions");
  const demoRoles = useDemoRoles();
  const api = useApiRoles();
  const roles = apiEnabled ? (api.roles ?? []) : demoRoles;
  const minReason = useRule<number>("operations.minCommentLength");
  const instances = useOperationsStore((s) => s.instances);
  const pendingByRole = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of instances) if (i.operationType === "role.permissions-change" && (i.status === "Pending" || i.status === "In progress")) map.set(i.subject.id, i.id);
    return map;
  }, [instances]);

  const roleId = params.get("role") ?? roles[0]?.id ?? "";
  const role = roles.find((r) => r.id === roleId);
  const saved: PermissionGrants = useMemo(() => (role ? { [role.id]: role.grants } : {}), [role]);
  const [draft, setDraft] = useState<{ roleId: string; grants: PermissionGrants } | null>(null);
  const grants = draft && draft.roleId === roleId ? draft.grants : saved;
  const diff = diffRoleGrants(saved, grants)[roleId];
  const changes = diff ? diff.grant.length + diff.revoke.length : 0;
  const pendingOp = role ? pendingByRole.get(role.id) : undefined;
  const editable = canChange && Boolean(role) && !pendingOp;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string; operationId?: string } | null>(null);

  const pick = (id: string) => {
    setDraft(null);
    setOutcome(null);
    router.replace(`/admin/permissions?role=${encodeURIComponent(id)}`);
  };

  const submit = async (reason: string) => {
    if (!role || !diff) return false;
    const change: RoleGrantChange = { roleId: role.id, roleName: role.name, grant: diff.grant as PermissionKey[], revoke: diff.revoke as PermissionKey[] };
    const [result] = await requestRolePermissionChanges([change], reason);
    if (!result || !result.outcome.ok) throw new Error(result && !result.outcome.ok ? result.outcome.reason : "The request failed.");
    setDraft(null);
    setOutcome(
      result.outcome.applied
        ? { ok: true, text: `Applied — the workflow for permission changes has no approval steps.` }
        : { ok: true, text: `Sent for approval: ${changes} change(s) to ${role.name}.`, operationId: result.outcome.operationId },
    );
  };

  return (
    <ModulePage module="admin" description="Every action in the app is guarded by a permission from the catalogue. Changes to a role's permissions are approved by a second person in Operations; holding a permission never bypasses approver eligibility, four-eyes or segregation of duties.">
      <Stack gap="large">
        {api.error ? <Alert tone="danger" title="Couldn't load roles">{api.error}</Alert> : null}
        <Grid columns={{ base: 1, sm: 3 }} gap="medium">
          <StatCard label="Permissions in the catalogue" value={definitions.length} icon={<KeyRound aria-hidden className="size-5" />} tone="accent" hint="Synced from the backend catalogue" />
          <StatCard label="Roles" value={roles.length} icon={<ShieldCheck aria-hidden className="size-5" />} tone="info" hint="System and cloned roles" />
          <StatCard label="Changes awaiting approval" value={pendingByRole.size} tone={pendingByRole.size ? "warning" : "neutral"} hint="role.permissions-change requests" />
        </Grid>
        <Card>
          <CardContent>
            <Stack gap="medium">
              <div className="flex flex-wrap items-end gap-4">
                <Field label="Role" htmlFor="perm-role" className="min-w-64">
                  <Select id="perm-role" value={roleId} options={roles.map((r) => ({ value: r.id, label: r.name }))} onChange={(e) => pick(e.target.value)} />
                </Field>
                {role ? (
                  <Text variant="small" tone="muted">
                    {role.grants.length} of {definitions.length} permissions
                    {role.administrator ? " · administrator role: holds every permission by default; identity administration can't be revoked" : ""}
                  </Text>
                ) : null}
              </div>
              {pendingOp ? (
                <Alert tone="warning" title="A change is awaiting approval">
                  This role can&apos;t be edited until the open request is decided.{" "}
                  <TextLink href={operationHref(pendingOp)} as={Link}>
                    Open request {pendingOp}
                  </TextLink>
                </Alert>
              ) : null}
              {outcome ? (
                <Alert tone={outcome.ok ? "success" : "danger"} title={outcome.operationId ? "Sent for approval" : undefined}>
                  {outcome.text}{" "}
                  {outcome.operationId ? (
                    <TextLink href={operationHref(outcome.operationId)} as={Link}>
                      Track request {outcome.operationId}
                    </TextLink>
                  ) : null}
                </Alert>
              ) : null}
              {!canChange ? <Alert tone="info">View only — your permissions don&apos;t include changing role permissions.</Alert> : null}
              {role ? (
                <PermissionMatrix
                  label={`Permissions of ${role.name}`}
                  permissions={definitions}
                  roles={[{ id: role.id, label: role.name, description: role.description, readOnly: !editable }]}
                  grants={grants}
                  initialGrants={saved}
                  onGrantsChange={editable ? (next) => setDraft({ roleId, grants: next }) : undefined}
                  readOnly={!editable}
                  modules={modules}
                  isLocked={(r, key) => isProtectedFor(r, key) || (apiEnabled && role.administrator && protectedAdministratorPatterns.some((p) => (p.endsWith("*") ? key.startsWith(p.slice(0, -1)) : p === key)))}
                  maxHeight={640}
                  actions={
                    editable ? (
                      <span className="flex gap-2">
                        <Button variant="tertiary" disabled={changes === 0} onClick={() => setDraft(null)}>
                          Discard
                        </Button>
                        <Button disabled={changes === 0} onClick={() => setConfirmOpen(true)}>
                          Request change{changes ? ` (${changes})` : ""}
                        </Button>
                      </span>
                    ) : undefined
                  }
                />
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Request permission change for ${role?.name ?? "role"}?`}
        description="A second person approves the change in Operations. It applies to everyone holding the role at their next sign-in or page refresh."
        reason="required"
        minReasonLength={minReason}
        reasonDescription="Shown to the approver and kept in the audit log."
        confirmLabel="Send for approval"
        onConfirm={async (reason) => {
          await submit(reason);
        }}
      >
        <Stack gap="small">
          <Text variant="small">
            Grant: {diff?.grant.length ? diff.grant.join(", ") : "—"}
          </Text>
          <Text variant="small">
            Revoke: {diff?.revoke.length ? diff.revoke.join(", ") : "—"}
          </Text>
        </Stack>
      </ConfirmDialog>
    </ModulePage>
  );
}
