"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  PermissionMatrix,
  Select,
  Stack,
  SubmitButton,
  Text,
  Textarea,
  ValidationScope,
  diffGrants,
  useValidation,
  type PermissionDefinition,
  type PermissionGrants,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useUnsavedChangesWarning } from "@/lib/ui/unsaved-changes";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { useSession } from "@/lib/auth/session";
import { useRule } from "@/lib/platform/rules";
import { failed, refreshOwnAccess, SaveOutcomeModal, type SaveOutcome } from "./save-outcome";
import { useAppliesOnSave } from "./workflow-mode";

type CatalogueDto = { version: string; baseline: string[]; protectedAdministratorPermissions: string[]; permissions: Array<PermissionDefinition & { area: string }> };
type RoleDto = { id: string; name: string; group: string; description: string; modules: Record<string, "view" | "edit">; permissions: string[]; administrator: boolean; kind: string };
type Submission = { operationId: string; status: string; applied: boolean };

const changePermission = "identity.roles.change-permissions";
const changeWorkflow = ["role.permissions-change"] as const;

/** Matches a protected pattern such as "identity.users.*". */
const matches = (patterns: readonly string[], key: string) => patterns.some((p) => (p.endsWith(".*") ? key.startsWith(p.slice(0, -1)) : p === key));

/**
 * Admin → Permissions: what each role may do and see, from the backend catalogue and tenant role grants (ADR-0012). Changes go through
 * role.permissions-change: saved at once when its workflow has no approval steps, otherwise approved in Operations. The side menu
 * follows the granted areas.
 */
export function BackendPermissionsPage() {
  const permissions = useSession((s) => s.access?.permissions);
  const canChange = permissions?.includes(changePermission) ?? false;
  const saves = useAppliesOnSave(changeWorkflow).has(changeWorkflow[0]);
  const minReason = useRule<number>("operations.minCommentLength");
  const [catalogue, setCatalogue] = useState<CatalogueDto | null>(null);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [roleId, setRoleId] = useState("");
  const [grants, setGrants] = useState<PermissionGrants>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const validation = useValidation();

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
  useUnsavedChangesWarning(changes > 0);
  const modules = useMemo(() => {
    const ids = [...new Set((catalogue?.permissions ?? []).map((p) => p.module))];
    return ids.map((id) => ({ id, label: id.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") }));
  }, [catalogue]);

  const submit = async () => {
    if (!role) return;
    const tooShort = reason.trim().length > 0 && reason.trim().length < minReason;
    setReasonError(tooShort ? `Give a reason of at least ${minReason} characters.` : undefined);
    if (!validation.validate() || tooShort) return;
    setBusy(true);
    try {
      const r = await identityCall<Submission>(`/identity/roles/${encodeURIComponent(role.id)}/permission-changes`, {
        method: "POST",
        body: JSON.stringify({ grant: diff.grant, revoke: diff.revoke, reason: reason.trim() }),
      });
      setOutcome({
        ok: true,
        applied: r.applied,
        operationId: r.operationId,
        message: r.applied
          ? `${role.name}: ${diff.grant.length} granted, ${diff.revoke.length} revoked. People with this role see the change on their next page or when they return to the app.`
          : "A second person approves the change in Operations before it applies.",
      });
      setReason("");
      validation.reset();
      if (r.applied) void refreshOwnAccess();
      if (r.applied) {
        // The roles list is a read model updated a moment later; keep the saved grants instead of re-reading too early.
        const saved = current[role.id] ?? [];
        setRoles((list) => list.map((x) => (x.id === role.id ? { ...x, permissions: [...saved] } : x)));
        setGrants({});
      } else {
        setGrants({});
        setVersion((v) => v + 1);
      }
    } catch (e) {
      setOutcome(failed(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage
      module="admin"
      title="Permissions"
      description={`What each role may do and see. Granted areas decide the side menu. ${saves ? "Changes apply when you save." : "Every change is approved by a second person in Operations."}`}
    >
      <Stack gap="large">
        {!backendSsoEnabled ? <Alert tone="info">Permissions are managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <SaveOutcomeModal outcome={outcome} onClose={() => setOutcome(null)} />
        {changes > 0 ? (
          <Alert tone="warning" title="Unsaved changes">
            {`${changes} permission change${changes === 1 ? "" : "s"} for ${role?.name ?? "this role"}. Give a reason and ${saves ? "save" : "request the change"} below, or they are lost when you leave or refresh.`}
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
                  setOutcome(null);
                  validation.reset();
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
              <ValidationScope value={validation}>
                <Field
                  label="Reason for the change"
                  htmlFor="perm-reason"
                  required
                  error={reasonError}
                  description={saves ? "Kept in the audit log." : "Shown to approvers and kept in the audit log."}
                >
                  <Textarea
                    id="perm-reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      if (reasonError && e.target.value.trim().length >= minReason) setReasonError(undefined);
                    }}
                  />
                </Field>
              </ValidationScope>
              <div className="flex flex-wrap gap-2">
                <SubmitButton disabled={changes === 0 || busy} loading={busy} onClick={() => void submit()}>
                  {saves ? "Save" : "Request permission change"}
                </SubmitButton>
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
