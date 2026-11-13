"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardContent, Field, Input, PermissionMatrix, Select, Stack, SubmitButton, Text, Textarea, diffGrants, type PermissionDefinition, type PermissionGrants } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { useSession } from "@/lib/auth/session";
import { dateTime } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { useDirectoryUsers } from "./directory";
import { failed, refreshOwnAccess, SaveOutcomeModal, type SaveOutcome } from "./save-outcome";
import { useAppliesOnSave } from "./workflow-mode";

type CatalogueDto = { protectedAdministratorPermissions: string[]; permissions: Array<PermissionDefinition & { area: string }> };
type Member = { userId: string; userName: string; addedAt: string; expiresAt?: string | null; reason: string };
type Group = { id: string; name: string; description: string; granted: string[]; members: Member[] };
type Submission = { operationId: string; applied: boolean };

const NEW = "__new__";
const groupWorkflows = ["permission-group.change", "permission-group.membership"] as const;
const matches = (patterns: readonly string[], key: string) => patterns.some((p) => (p.endsWith(".*") ? key.startsWith(p.slice(0, -1)) : p === key));
const has = (permissions: string[] | undefined, key: string) => permissions?.includes(key) ?? false;

/**
 * Admin → Permission groups (ADR-0014): additive permission bundles for special cases. Members get the group's permissions on top of their
 * role until the optional end date. Changes are saved at once when their workflow has no approval steps, otherwise approved by a second
 * person in Operations; identity-administration permissions can't be granted through a group.
 */
export function GroupsPage() {
  const permissions = useSession((s) => s.access?.permissions);
  const me = useSession((s) => s.user);
  const minReason = useRule<number>("operations.minCommentLength");
  const { users } = useDirectoryUsers();
  const applies = useAppliesOnSave(groupWorkflows);
  const savesChanges = applies.has(groupWorkflows[0]);
  const savesMembers = applies.has(groupWorkflows[1]);
  const [catalogue, setCatalogue] = useState<CatalogueDto | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [grants, setGrants] = useState<PermissionGrants>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberId, setMemberId] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let cancelled = false;
    Promise.all([identityCall<CatalogueDto>("/identity/permissions"), identityCall<Group[]>("/identity/groups")])
      .then(([c, g]) => {
        if (cancelled) return;
        setCatalogue(c);
        setGroups(g);
        setSelected((s) => s || g[0]?.id || NEW);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const group = groups.find((g) => g.id === selected);
  const column = group?.id ?? NEW;
  const initial = useMemo<PermissionGrants>(() => ({ [column]: group?.granted ?? [] }), [column, group]);
  const current = grants[column] ? grants : initial;
  const diff = diffGrants(initial[column] ?? [], current[column] ?? []);
  const modules = useMemo(
    () => [...new Set((catalogue?.permissions ?? []).map((p) => p.module))].map((id) => ({ id, label: id.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") })),
    [catalogue],
  );
  // Membership expiry is judged at page load (re-evaluated on reload).
  const [now] = useState(() => Date.now());

  const send = async (path: string, body: unknown, done: string) => {
    if (reason.trim().length < minReason) return setOutcome({ ok: false, message: `Give a reason of at least ${minReason} characters.` });
    setBusy(true);
    try {
      const r = await identityCall<Submission>(path, { method: "POST", body: JSON.stringify({ ...(body as object), reason: reason.trim() }) });
      setOutcome({ ok: true, applied: r.applied, operationId: r.operationId, message: r.applied ? done : "A second person approves the change in Operations before it applies." });
      setGrants({});
      setReason("");
      setVersion((v) => v + 1);
      if (r.applied) void refreshOwnAccess();
    } catch (e) {
      setOutcome(failed(e));
    } finally {
      setBusy(false);
    }
  };

  const select = (id: string) => {
    setSelected(id);
    setGrants({});
    setOutcome(null);
    setError(null);
  };

  return (
    <ModulePage module="admin" title="Permission groups" description={`Extra permissions for special cases (cover, audits, projects) on top of a person's role, with an optional end date. ${savesChanges && savesMembers ? "Changes apply when you save." : "Changes are approved by a second person in Operations."}`}>
      <Stack gap="large">
        {!backendSsoEnabled ? <Alert tone="info">Permission groups are managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <SaveOutcomeModal
          outcome={outcome}
          onClose={() => {
            setOutcome(null);
            // Re-read once more: the groups list is a read model updated a moment after a saved change (TD-954).
            setVersion((v) => v + 1);
          }}
        />
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <Field label="Group" htmlFor="group-select">
              <Select
                id="group-select"
                value={selected}
                options={[...groups.map((g) => ({ value: g.id, label: `${g.name} (${g.members.filter((m) => !m.expiresAt || Date.parse(m.expiresAt) > now).length} active members)` })), ...(has(permissions, "identity.groups.create") ? [{ value: NEW, label: "+ New group" }] : [])]}
                onChange={(e) => select(e.target.value)}
              />
            </Field>
            {selected === NEW ? (
              <>
                <Field label="Name" htmlFor="group-name" required>
                  <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 audit support" />
                </Field>
                <Field label="Description" htmlFor="group-description">
                  <Input id="group-description" value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>
              </>
            ) : group ? (
              <Text variant="small" tone="muted">
                {group.description || "No description."}
              </Text>
            ) : null}
          </CardContent>
        </Card>

        {group ? (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Text variant="small" className="font-semibold">
                Members
              </Text>
              {group.members.length === 0 ? (
                <Text variant="small" tone="muted">
                  No members yet.
                </Text>
              ) : (
                <ul className="flex flex-col gap-2">
                  {group.members.map((m) => {
                    const active = !m.expiresAt || Date.parse(m.expiresAt) > now;
                    return (
                      <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <span>{m.userName}</span>
                          <Badge tone={active ? "success" : "neutral"}>{active ? (m.expiresAt ? `until ${dateTime(m.expiresAt)}` : "no end date") : "expired"}</Badge>
                          <Text variant="caption" tone="muted">
                            {m.reason}
                          </Text>
                        </span>
                        {has(permissions, "identity.groups.change-members") ? (
                          <Button size="small" variant="tertiary" disabled={busy} onClick={() => void send(`/identity/groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(m.userId)}/removal`, {}, `${m.userName} was removed from ${group.name}.`)}>
                            {savesMembers ? "Remove" : "Request removal"}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {has(permissions, "identity.groups.change-members") ? (
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
                  <Field label="Add member" htmlFor="group-member">
                    <Select
                      id="group-member"
                      value={memberId}
                      options={[{ value: "", label: "Choose a user" }, ...users.filter((u) => u.status !== "Suspended" && u.id !== me?.id && !group.members.some((m) => m.userId === u.id)).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))]}
                      onChange={(e) => setMemberId(e.target.value)}
                    />
                  </Field>
                  <Field label="Until (optional)" htmlFor="group-until">
                    <Input id="group-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={!memberId || busy}
                    onClick={() => void send(`/identity/groups/${encodeURIComponent(group.id)}/members`, { userId: memberId, expiresAt: until ? new Date(`${until}T23:59:59`).toISOString() : null }, `${users.find((u) => u.id === memberId)?.name ?? "The user"} was added to ${group.name}. They get its permissions on their next page or when they return to the app.`)}
                  >
                    {savesMembers ? "Add member" : "Request membership"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {catalogue && (group || selected === NEW) ? (
          <PermissionMatrix
            permissions={catalogue.permissions}
            roles={[{ id: column, label: group?.name ?? (name || "New group") }]}
            grants={current}
            initialGrants={initial}
            modules={modules}
            readOnly={!has(permissions, selected === NEW ? "identity.groups.create" : "identity.groups.change-permissions")}
            isLocked={(_, key) => matches(catalogue.protectedAdministratorPermissions, key)}
            onGrantsChange={(next) => setGrants(next)}
          />
        ) : null}

        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <Field label="Reason for the change" htmlFor="group-reason" required description={savesChanges && savesMembers ? "Kept in the audit log." : "Shown to approvers and kept in the audit log."}>
              <Textarea id="group-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {selected === NEW ? (
                <SubmitButton disabled={!name.trim() || diff.grant.length === 0 || busy} loading={busy} onClick={() => void send("/identity/groups", { name: name.trim(), description: description.trim(), permissions: diff.grant }, `The group ${name.trim()} was created.`)}>
                  {savesChanges ? "Create group" : "Request new group"}
                </SubmitButton>
              ) : group ? (
                <>
                  <SubmitButton disabled={diff.grant.length + diff.revoke.length === 0 || busy} loading={busy} onClick={() => void send(`/identity/groups/${encodeURIComponent(group.id)}/permission-changes`, { grant: diff.grant, revoke: diff.revoke }, `${group.name}: ${diff.grant.length} granted, ${diff.revoke.length} revoked. Members see it on their next page or when they return to the app.`)}>
                    {savesChanges ? "Save" : "Request permission change"} ({diff.grant.length} + / {diff.revoke.length} −)
                  </SubmitButton>
                  {has(permissions, "identity.groups.delete") ? (
                    <Button variant="danger" disabled={busy} onClick={() => void send(`/identity/groups/${encodeURIComponent(group.id)}/deletion`, {}, `The group ${group.name} was deleted.`)}>
                      {savesChanges ? "Delete group" : "Request deletion"}
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </Stack>
    </ModulePage>
  );
}
