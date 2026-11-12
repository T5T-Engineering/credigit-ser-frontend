"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, CardContent, Field, PermissionMatrix, Select, Stack, Text, TextLink, Textarea, diffGrants, type PermissionDefinition, type PermissionGrants } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { useSession } from "@/lib/auth/session";
import { useRule } from "@/lib/platform/rules";
import { operationHref } from "./operation-ui";

type CatalogueDto = { version: string; baseline: string[]; protectedAdministratorPermissions: string[]; permissions: Array<PermissionDefinition & { area: string }> };
type RoleDto = { id: string; name: string; group: string; description: string; modules: Record<string, "view" | "edit">; permissions: string[]; administrator: boolean; kind: string };
type Submission = { operationId: string; status: string; applied: boolean };

const changePermission = "identity.roles.change-permissions";

/** Matches a protected pattern such as "identity.users.*". */
const matches = (patterns: readonly string[], key: string) => patterns.some((p) => (p.endsWith(".*") ? key.startsWith(p.slice(0, -1)) : p === key));

/**
 * Admin → Permissions: what each role may do and see, from the backend catalogue and tenant role grants (ADR-0012). Changes are requests
 * (role.permissions-change) approved by a second person in Operations; the side menu follows the granted areas.
 */
export function PermissionsPage() {
  const permissions = useSession((s) => s.access?.permissions);
  const canChange = permissions?.includes(changePermission) ?? false;
  const minReason = useRule<number>("operations.minCommentLength");
  const [catalogue, setCatalogue] = useState<CatalogueDto | null>(null);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [roleId, setRoleId] = useState("");
  const [grants, setGrants] = useState<PermissionGrants>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let cancelled = false;
    Promise.all([identityCall<CatalogueDto>("/identity/permissions"), identityCall<RoleDto[]>("/identity/roles")])
      .then(([c, r]) => {
        if (cancelled) return;
        setCatalogue(c);
        setRoles(r);
        setRoleId((current) => current || r[0]?.id || "");
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const role = roles.find((r) => r.id === roleId);
  const initial = useMemo<PermissionGrants>(() => (role ? { [role.id]: role.permissions } : {}), [role]);
  const current = role && grants[role.id] ? grants : initial;
  const diff = role ? diffGrants(initial[role.id] ?? [], current[role.id] ?? []) : { grant: [], revoke: [] };
  const changes = diff.grant.length + diff.revoke.length;
  const modules = useMemo(() => {
    const ids = [...new Set((catalogue?.permissions ?? []).map((p) => p.module))];
    return ids.map((id) => ({ id, label: id.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") }));
  }, [catalogue]);

  const submit = async () => {
    if (!role) return;
    if (reason.trim().length < minReason) return setError(`Give a reason of at least ${minReason} characters.`);
    setBusy(true);
    setError(null);
    try {
      const r = await identityCall<Submission>(`/identity/roles/${encodeURIComponent(role.id)}/permission-changes`, {
        method: "POST",
        body: JSON.stringify({ grant: diff.grant, revoke: diff.revoke, reason: reason.trim() }),
      });
      setResult(r);
      setGrants({});
      setReason("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage module="admin" title="Permissions" description="What each role may do and see. Granted areas decide the side menu. Every change is approved by a second person in Operations.">
      <Stack gap="large">
        {!backendSsoEnabled ? <Alert tone="info">Permissions are managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {result ? (
          <Alert tone="success" title={result.applied ? "Applied" : "Sent for approval"}>
            {result.applied ? "The permission change is applied." : "A second person approves the change in Operations. "}
            {!result.applied ? (
              <TextLink href={operationHref(result.operationId)} as={Link}>
                Track request {result.operationId}
              </TextLink>
            ) : null}
          </Alert>
        ) : null}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <Field label="Role" htmlFor="perm-role">
              <Select
                id="perm-role"
                value={roleId}
                options={roles.map((r) => ({ value: r.id, label: `${r.name}${r.kind === "Custom" ? " (custom)" : ""}` }))}
                onChange={(e) => {
                  setRoleId(e.target.value);
                  setGrants({});
                  setResult(null);
                }}
              />
            </Field>
            {role ? (
              <Stack gap="small">
                <Text variant="small" tone="muted">
                  {role.description}
                </Text>
                <div className="flex flex-wrap items-center gap-2">
                  <Text variant="small" tone="muted">
                    Side menu:
                  </Text>
                  {Object.entries(role.modules)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([area, level]) => (
                      <Badge key={area} tone={level === "edit" ? "accent" : "neutral"}>
                        {area} · {level === "edit" ? "change" : "view"}
                      </Badge>
                    ))}
                </div>
              </Stack>
            ) : null}
          </CardContent>
        </Card>
        {catalogue && role ? (
          <PermissionMatrix
            permissions={catalogue.permissions}
            roles={[{ id: role.id, label: role.name, description: role.group }]}
            grants={current}
            initialGrants={initial}
            modules={modules}
            readOnly={!canChange}
            isLocked={(id, key) => roles.find((r) => r.id === id)?.administrator === true && matches(catalogue.protectedAdministratorPermissions, key)}
            onGrantsChange={(next) => setGrants(next)}
          />
        ) : null}
        {canChange && role ? (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Text variant="small">
                {changes === 0 ? "No changes yet." : `${diff.grant.length} to grant, ${diff.revoke.length} to revoke for ${role.name}.`}
              </Text>
              <Field label="Reason for the change" htmlFor="perm-reason" required description="Shown to approvers and kept in the audit log.">
                <Textarea id="perm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button disabled={changes === 0 || busy} loading={busy} onClick={() => void submit()}>
                  Request permission change
                </Button>
                <Button variant="tertiary" disabled={changes === 0 || busy} onClick={() => setGrants({})}>
                  Discard changes
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </ModulePage>
  );
}
