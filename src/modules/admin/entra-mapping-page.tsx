"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, CardContent, Field, Input, Select, Stack, Text, TextLink, Textarea } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { useSession } from "@/lib/auth/session";
import { dateTime } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { operationHref } from "./operation-ui";

type Mapping = { id: string; kind: "group" | "appRole"; value: string; label: string; roleId: string; createdAt: string; createdBy: string };
type RoleDto = { id: string; name: string; administrator: boolean };
type Submission = { operationId: string; applied: boolean };

const KINDS = [
  { value: "group", label: "Entra group (object id)" },
  { value: "appRole", label: "Entra app role (value)" },
];
const kindLabel = (kind: string) => KINDS.find((k) => k.value === kind)?.label ?? kind;
const has = (permissions: string[] | undefined, key: string) => permissions?.includes(key) ?? false;

/**
 * Admin → Entra role mapping (ADR-0016): maps the institution's Entra groups and app roles to platform roles. A person signing in with
 * Microsoft who isn't in the directory yet, but matches a mapping, gets an access request with the mapped roles. Every change is a request
 * approved by a second person in Operations.
 */
export function EntraMappingPage() {
  const permissions = useSession((s) => s.access?.permissions);
  const minReason = useRule<number>("operations.minCommentLength");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [kind, setKind] = useState("group");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [roleId, setRoleId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const canChange = has(permissions, "identity.entra-mappings.change");

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let cancelled = false;
    Promise.all([identityCall<Mapping[]>("/identity/entra-mappings"), identityCall<RoleDto[]>("/identity/roles")])
      .then(([m, r]) => {
        if (cancelled) return;
        setMappings(m);
        setRoles(r);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  const send = async (path: string, body: unknown) => {
    if (reason.trim().length < minReason) return setError(`Give a reason of at least ${minReason} characters.`);
    setBusy(true);
    setError(null);
    try {
      setResult(await identityCall<Submission>(path, { method: "POST", body: JSON.stringify({ ...(body as object), reason: reason.trim() }) }));
      setValue("");
      setLabel("");
      setReason("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage
      module="admin"
      title="Entra role mapping"
      description="Map your institution's Entra groups and app roles to platform roles. A person who signs in with Microsoft and matches a mapping gets an access request for the System Admin to approve."
    >
      <Stack gap="large">
        {!backendSsoEnabled ? <Alert tone="info">The Entra role mapping is managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {result ? (
          <Alert tone="success" title={result.applied ? "Applied" : "Sent for approval"}>
            {result.applied ? "The change is applied. " : "A second person approves the change in Operations. "}
            {!result.applied ? (
              <TextLink href={operationHref(result.operationId)} as={Link}>
                Track request {result.operationId}
              </TextLink>
            ) : null}
          </Alert>
        ) : null}

        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <Text variant="small" className="font-semibold">
              Mappings
            </Text>
            {mappings.length === 0 ? (
              <Text variant="small" tone="muted">
                No mappings yet.
              </Text>
            ) : (
              <ul className="flex flex-col gap-2">
                {mappings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{kindLabel(m.kind)}</Badge>
                      <span className="font-semibold">{m.label || m.value}</span>
                      <Text variant="caption" tone="muted">
                        {m.value}
                      </Text>
                      <span>→ {roleName(m.roleId)}</span>
                      <Text variant="caption" tone="muted">
                        {m.createdBy} · {dateTime(m.createdAt)}
                      </Text>
                    </span>
                    {canChange ? (
                      <Button size="small" variant="tertiary" disabled={busy} onClick={() => void send(`/identity/entra-mappings/${encodeURIComponent(m.id)}/removal`, {})}>
                        Request removal
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {canChange ? (
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <Text variant="small" className="font-semibold">
                Add a mapping
              </Text>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Entra source" htmlFor="map-kind">
                  <Select id="map-kind" value={kind} options={KINDS} onChange={(e) => setKind(e.target.value)} />
                </Field>
                <Field
                  label={kind === "group" ? "Group object id" : "App role value"}
                  htmlFor="map-value"
                  required
                  description={kind === "group" ? "From Entra admin center → Groups → the group's Object ID." : "The app role's Value in the app registration (case-sensitive)."}
                >
                  <Input id="map-value" value={value} onChange={(e) => setValue(e.target.value)} />
                </Field>
                <Field label="Display name" htmlFor="map-label" description="How the group or role is called in your organisation, e.g. Regional Managers.">
                  <Input id="map-label" value={label} onChange={(e) => setLabel(e.target.value)} />
                </Field>
                <Field label="Platform role" htmlFor="map-role" required>
                  <Select
                    id="map-role"
                    value={roleId}
                    options={[{ value: "", label: "Choose a role" }, ...roles.filter((r) => !r.administrator).map((r) => ({ value: r.id, label: r.name }))]}
                    onChange={(e) => setRoleId(e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {canChange ? (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Field label="Reason for the change" htmlFor="map-reason" required description="Shown to approvers and kept in the audit log.">
                <Textarea id="map-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!value.trim() || !roleId || busy} loading={busy} onClick={() => void send("/identity/entra-mappings", { kind, value: value.trim(), label: label.trim() || null, roleId })}>
                  Request mapping
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </ModulePage>
  );
}
