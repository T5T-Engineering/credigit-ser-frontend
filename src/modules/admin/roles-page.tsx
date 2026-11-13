"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Lock, MonitorSmartphone, RotateCcw, Timer, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Chip,
  ChipInput,
  ChipList,
  DataTable,
  Drawer,
  Field,
  Grid,
  Input,
  Stack,
  StatCard,
  Switch,
  Text,
  Textarea,
  TextLink,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { allNavItems } from "@/lib/nav";
import { roleById, type ModuleKey, type RoleId } from "@/lib/rbac/roles";
import { moneyShort } from "@/lib/format";
import { requestRuleChange } from "@/lib/platform/core";
import { submitOperation, useOperationsStore, type SubmitResult } from "@/lib/platform/operations";
import { ruleDefinition, useRule, type RuleValue } from "@/lib/platform/rules";
import { ConfigNotice } from "./config-notice";
import { useDirectoryRoleModules } from "./directory";
import { operationHref, PendingBadge, submitWithHooks } from "./operation-ui";
import { IPV4_OR_CIDR, roleName, ruleKeys } from "./rule-keys";
import { useConfiguredRoles, type ConfiguredRole, type CustomRole } from "./store";
import type { CustomRolePayload } from "./platform";

/** Role cloning (PRD §4, ADM-FR-10) is hidden until cloned roles can be assigned to users (TD-805). */
const CLONE_ROLES_ENABLED = false;
const limitLabel = (n: number | null) => (n === null ? "—" : Number.isFinite(n) ? moneyShort(n) : "Apex (no ceiling)");
const moduleLabel = (m: ModuleKey) => allNavItems.find((i) => i.module === m)?.label ?? m;
const roleKeysOf = (id: string) => [ruleKeys.roleName(id), ruleKeys.limit(id), ruleKeys.idleTimeout(id), ruleKeys.deviceBinding(id), ruleKeys.ipAllowList(id)];
const isOpen = (s: string) => s === "Pending" || s === "In progress";

/** Admin → Roles & limits (PRD §4.0–4.2): default role set, tiers, sign-on limits, per-role session rules, clone role. */
export function RolesPage() {
  const canEdit = useCan("admin", "edit");
  const configured = useConfiguredRoles();
  const instances = useOperationsStore((s) => s.instances);
  const pendingSubjects = useMemo(() => new Set(instances.filter((i) => isOpen(i.status)).map((i) => `${i.subject.type}:${i.subject.id}`)), [instances]);
  const hasPending = (r: ConfiguredRole) => (r.custom ? pendingSubjects.has(`Role:${r.id}`) : roleKeysOf(r.id).some((k) => pendingSubjects.has(`Rule:${k}`)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = configured.find((r) => r.id === selectedId) ?? null;
  const tiered = configured.filter((r) => r.tier !== null);
  const directoryModules = useDirectoryRoleModules();

  const columns: DataTableColumn<ConfiguredRole>[] = [
    {
      id: "name",
      header: "Role",
      accessor: "name",
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-2 font-semibold text-fg">
            {r.name}
            {r.custom ? <Badge tone="info">Cloned</Badge> : r.edited ? <Badge tone="accent">Edited</Badge> : null}
            {hasPending(r) ? <Badge tone="warning">Awaiting approval</Badge> : null}
          </span>
          <span className="text-sm text-fg-muted">{r.authority}</span>
        </span>
      ),
    },
    { id: "group", header: "Group", accessor: "group", sortable: true },
    { id: "tier", header: "Tier", accessor: (r) => r.tier ?? "", sortable: true, align: "center", cell: (r) => (r.tier ? <Badge variant="outline">Tier {r.tier}</Badge> : <span className="text-fg-subtle">—</span>) },
    {
      id: "limit",
      header: "Sign-on limit",
      numeric: true,
      accessor: (r) => r.limitNgn ?? -1,
      sortable: true,
      csv: (r) => (r.limitNgn === null ? "" : Number.isFinite(r.limitNgn) ? r.limitNgn : "Apex"),
      cell: (r) => limitLabel(r.limitNgn),
    },
    { id: "timeout", header: "Session timeout", accessor: (r) => r.security.sessionTimeoutMin, sortable: true, cell: (r) => `${r.security.sessionTimeoutMin} min` },
    {
      id: "controls",
      header: "Device / IP",
      accessor: (r) => `${r.security.deviceBinding ? "Device bound" : "Any device"}; ${r.security.ipAllowList || "Any network"}`,
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.security.deviceBinding ? <Badge tone="warning">Device bound</Badge> : <Badge variant="outline">Any device</Badge>}
          {r.security.ipAllowList ? <Badge tone="warning">IP allow-list</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <ModulePage module="admin" description="The default role set is an illustrative configuration. Names, sign-on limits and per-role session rules are business rules; every change is approved in Operations.">
      <Stack gap="large">
        <ConfigNotice canEdit={canEdit} />
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Roles" value={configured.length} hint={`${configured.filter((r) => r.custom).length} cloned`} icon={<Lock aria-hidden className="size-5" />} tone="accent" />
          <StatCard label="Approval tiers" value={new Set(tiered.map((r) => r.tier)).size} hint="Chart-flow tiers with sign-on limits" icon={<Copy aria-hidden className="size-5" />} tone="info" />
          <StatCard label="Tighter session rules" value={configured.filter((r) => r.security.deviceBinding || r.security.ipAllowList).length} hint="Device binding or IP allow-list" icon={<MonitorSmartphone aria-hidden className="size-5" />} tone="warning" />
          <StatCard label="Awaiting approval" value={configured.filter(hasPending).length} hint="Roles with a change in Operations" icon={<Timer aria-hidden className="size-5" />} tone="neutral" />
        </Grid>
        <Card>
          <CardContent>
            <DataTable
              columns={columns}
              data={configured}
              getRowId={(r) => r.id}
              label="Roles and sign-on limits"
              searchable
              searchPlaceholder="Search roles…"
              filters={[{ id: "group", label: "Group", columnId: "group" }]}
              onRowClick={(r) => setSelectedId(r.id)}
              defaultPageSize={30}
              pageSizeOptions={[]}
              exportFilename="roles-and-limits.csv"
              mobileCard={(r) => (
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-sm text-fg-muted">
                    {r.group} · {r.tier ? `Tier ${r.tier}` : "No tier"} · {limitLabel(r.limitNgn)}
                  </span>
                  <span className="text-sm">Session {r.security.sessionTimeoutMin} min{r.security.deviceBinding ? " · device bound" : ""}</span>
                </div>
              )}
            />
            <Text variant="caption" tone="subtle" className="mt-4 block">
              Limits are business rules <span className="font-mono">rbac.limit.*</span>; session rules are <span className="font-mono">session.*.&lt;role&gt;</span> with tighter defaults for Disbursement Maker/Checker and Legal.
            </Text>
          </CardContent>
        </Card>
      </Stack>
      {selected ? <RoleDrawer key={selected.id} role={selected} canEdit={canEdit} onClose={() => setSelectedId(null)} tiered={tiered} directoryModules={directoryModules} /> : null}
    </ModulePage>
  );
}

type Outcome = { label: string; result: SubmitResult };

function RoleDrawer({
  role,
  canEdit,
  onClose,
  tiered,
  directoryModules,
}: {
  role: ConfiguredRole;
  canEdit: boolean;
  onClose: () => void;
  tiered: ConfiguredRole[];
  directoryModules: Record<string, Record<string, "view" | "edit">> | null;
}) {
  const minReason = useRule<number>("operations.minCommentLength");
  const apex = role.limitNgn !== null && !Number.isFinite(role.limitNgn);
  const hasLimit = role.limitNgn !== null && !apex;
  const [name, setName] = useState(role.name);
  const [limit, setLimit] = useState(hasLimit ? String(role.limitNgn) : "");
  const [timeout, setTimeoutMin] = useState(String(role.security.sessionTimeoutMin));
  const [device, setDevice] = useState(role.security.deviceBinding);
  const [ips, setIps] = useState<string[]>(role.security.ipRanges);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [busy, setBusy] = useState(false);
  const timeoutDef = ruleDefinition(ruleKeys.idleTimeout(role.custom?.clonedFrom ?? role.id));

  const below = tiered.filter((r) => r.tier !== null && role.tier !== null && r.tier < role.tier && r.limitNgn !== null && r.id !== role.id);
  const above = tiered.filter((r) => r.tier !== null && role.tier !== null && r.tier > role.tier && r.limitNgn !== null && r.id !== role.id);

  /** Validated draft values, or an error message. */
  const validate = (): string | { limit: number | null; timeout: number } => {
    if (!name.trim()) return "Enter a role name.";
    let value: number | null = null;
    if (hasLimit) {
      value = Number(limit.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(value) || value <= 0) return "Enter a positive limit in naira.";
      const tooLow = below.find((r) => (r.limitNgn ?? 0) > value!);
      const tooHigh = above.find((r) => Number.isFinite(r.limitNgn ?? 0) && (r.limitNgn ?? 0) < value!);
      if (tooLow || tooHigh) return `Limits must rise with the tier: ${tooLow ? `${tooLow.name} (tier ${tooLow.tier}) is ${moneyShort(tooLow.limitNgn!)}` : `${tooHigh!.name} (tier ${tooHigh!.tier}) is ${moneyShort(tooHigh!.limitNgn!)}`}.`;
    }
    const t = Number(timeout);
    if (!Number.isFinite(t) || (timeoutDef?.min !== undefined && t < timeoutDef.min) || (timeoutDef?.max !== undefined && t > timeoutDef.max)) return `Idle timeout must be between ${timeoutDef?.min} and ${timeoutDef?.max} minutes.`;
    const bad = ips.find((x) => !IPV4_OR_CIDR.test(x));
    if (bad) return `"${bad}" isn't a valid IPv4 address or CIDR range.`;
    if (reason.trim().length < minReason) return `Give a reason of at least ${minReason} characters.`;
    return { limit: value, timeout: t };
  };

  const save = async () => {
    const v = validate();
    if (typeof v === "string") return setError(v);
    setError(null);
    setBusy(true);
    const out: Outcome[] = [];
    if (role.custom) {
      const next: CustomRole = { ...role.custom, name: name.trim(), limitNgn: hasLimit ? v.limit : null, security: { sessionTimeoutMin: v.timeout, deviceBinding: device, ipRanges: ips } };
      out.push({ label: "Custom role", result: await submitCustom("update", next, reason.trim()) });
    } else {
      const changes: Array<[string, string, RuleValue, RuleValue]> = [
        ["Role name", ruleKeys.roleName(role.id), role.name, name.trim()],
        ["Sign-on limit", ruleKeys.limit(role.id), role.limitNgn ?? 0, v.limit ?? role.limitNgn ?? 0],
        ["Idle timeout", ruleKeys.idleTimeout(role.id), role.security.sessionTimeoutMin, v.timeout],
        ["Device binding", ruleKeys.deviceBinding(role.id), role.security.deviceBinding, device],
        ["IP allow-list", ruleKeys.ipAllowList(role.id), role.security.ipRanges, ips],
      ];
      for (const [label, key, before, after] of changes) {
        if (JSON.stringify(before) === JSON.stringify(after) || !ruleDefinition(key)) continue;
        out.push({ label, result: await submitWithHooks("admin.config.change", { kind: "rule", key, value: after, reason: reason.trim() }, (ctx) => requestRuleChange(ctx.key, ctx.value, ctx.reason)) });
      }
      if (out.length === 0) setError("Nothing changed.");
    }
    setBusy(false);
    setOutcomes(out);
  };

  const restoreDefaults = () => {
    if (role.custom) return;
    const id = role.id as RoleId;
    const def = <V,>(key: string) => ruleDefinition(key)?.default as V;
    setName(roleById[id].name);
    if (hasLimit) setLimit(String(def<number>(ruleKeys.limit(id))));
    setTimeoutMin(String(def<number>(ruleKeys.idleTimeout(id))));
    setDevice(def<boolean>(ruleKeys.deviceBinding(id)));
    setIps(def<string[]>(ruleKeys.ipAllowList(id)) ?? []);
  };

  const clone = async () => {
    if (reason.trim().length < minReason) return setError(`Give a reason of at least ${minReason} characters for the new role.`);
    const base = (role.custom?.clonedFrom ?? role.id) as RoleId;
    const created: CustomRole = {
      id: `custom-${Date.now().toString(36)}`,
      clonedFrom: base,
      name: `${role.name} (copy)`,
      short: `${roleById[base].short}*`,
      limitNgn: hasLimit ? role.limitNgn : null,
      security: { sessionTimeoutMin: role.security.sessionTimeoutMin, deviceBinding: role.security.deviceBinding, ipRanges: role.security.ipRanges },
      createdAt: new Date().toISOString(),
    };
    setError(null);
    setOutcomes([{ label: "Clone role", result: await submitCustom("create", created, reason.trim()) }]);
  };

  const remove = async () => {
    if (!role.custom) return;
    if (reason.trim().length < minReason) return setError(`Give a reason of at least ${minReason} characters.`);
    setOutcomes([{ label: "Delete role", result: await submitCustom("delete", role.custom, reason.trim()) }]);
  };

  // With the backend, what members actually see (from the role's current permissions); otherwise the app's role definition.
  const modules = Object.entries(directoryModules?.[role.id] ?? role.modules) as Array<[ModuleKey, "view" | "edit"]>;
  const pendingKey = (key: string) => <PendingBadge subjectType="Rule" subjectId={key} />;

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={role.name}
      description={`${role.group}${role.tier ? ` · Tier ${role.tier}` : ""} · ${role.authority}`}
      footer={
        canEdit ? (
          <div className="flex flex-wrap justify-end gap-2">
            {role.custom ? (
              <Button variant="danger" iconBefore={<Trash2 aria-hidden className="size-4" />} onClick={() => void remove()}>
                Request delete
              </Button>
            ) : (
              <Button variant="text" iconBefore={<RotateCcw aria-hidden className="size-4" />} onClick={restoreDefaults}>
                Restore defaults
              </Button>
            )}
            {CLONE_ROLES_ENABLED ? (
              <Button variant="tertiary" iconBefore={<Copy aria-hidden className="size-4" />} onClick={() => void clone()}>
                Request clone
              </Button>
            ) : null}
            <Button loading={busy} onClick={() => void save()}>
              Submit for approval
            </Button>
          </div>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Text tone="muted">{role.description}</Text>
        {role.custom ? <PendingBadge subjectType="Role" subjectId={role.id} /> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {outcomes.length ? (
          <Alert tone={outcomes.every((o) => o.result.ok) ? "success" : "warning"} title="Sent to Operations">
            <ul className="mt-1 flex flex-col gap-1">
              {outcomes.map((o) => (
                <li key={o.label}>
                  {o.label}:{" "}
                  {o.result.ok ? (
                    <TextLink href={operationHref(o.result.instance.id)} as={Link}>
                      {o.result.applied ? "applied" : `awaiting approval (${o.result.instance.id})`}
                    </TextLink>
                  ) : (
                    o.result.reason
                  )}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <Field label="Role name" htmlFor="role-name" description="Rename to match your organogram.">
          <Input id="role-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!role.custom ? pendingKey(ruleKeys.roleName(role.id)) : null}
        <Field
          label="Sign-on (approval) limit"
          htmlFor="role-limit"
          description={apex ? "Apex tier — statutory single-obligor ceiling and above." : hasLimit ? `Rule rbac.limit.${role.custom?.clonedFrom ?? role.id} — mapped 1:1 to this tier in the chart-flow.` : "This role has no credit approval authority."}
        >
          <Input id="role-limit" prefix="₦" inputMode="numeric" value={apex ? "No ceiling" : hasLimit ? limit : "Not applicable"} disabled={!canEdit || !hasLimit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        {!role.custom ? pendingKey(ruleKeys.limit(role.id)) : null}
        <Stack gap="medium">
          <Text variant="eyebrow" tone="muted">
            Session & sign-on rules
          </Text>
          <Field label="Idle session timeout" htmlFor="role-timeout" description={`${timeoutDef?.min}–${timeoutDef?.max} minutes.`}>
            <Input id="role-timeout" type="number" suffix="min" value={timeout} disabled={!canEdit} onChange={(e) => setTimeoutMin(e.target.value)} />
          </Field>
          {!role.custom ? pendingKey(ruleKeys.idleTimeout(role.id)) : null}
          <Switch label="Device binding" description="Only devices registered to the user can sign in with this role." checked={device} disabled={!canEdit} onCheckedChange={setDevice} />
          {!role.custom ? pendingKey(ruleKeys.deviceBinding(role.id)) : null}
          <Field label="IP allow-list" htmlFor="role-ip" description="IPv4 addresses or CIDR ranges; press Enter after each. Empty = any network." optional>
            <ChipInput inputId="role-ip" label="IP allow-list" value={ips} onChange={setIps} disabled={!canEdit} mono placeholder="e.g. 10.20.0.0/16" />
          </Field>
          {!role.custom ? pendingKey(ruleKeys.ipAllowList(role.id)) : null}
          <Switch label="Multi-factor authentication" description="Mandatory for every role." checked disabled />
        </Stack>
        {canEdit ? (
          <Field label="Reason for the change" htmlFor="role-reason" required description="Shown to approvers in Operations and kept in the audit log.">
            <Textarea id="role-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
        <Stack gap="small">
          <Text variant="eyebrow" tone="muted">
            Module access
          </Text>
          <ChipList>
            {modules.map(([m, a]) => (
              <Chip key={m} size="small" tone={a === "edit" ? "accent" : "neutral"}>
                {moduleLabel(m)} · {a}
              </Chip>
            ))}
          </ChipList>
          {directoryModules ? (
            <Text variant="small" tone="muted">
              This is what people with this role see in the side menu. Change it in{" "}
              <TextLink href="/admin/permissions" as={Link}>
                Permissions
              </TextLink>
              .
            </Text>
          ) : null}
          {role.id === "system-admin" ? <Text variant="small" tone="muted">System Admin has configuration, not credit, authority — it can&apos;t approve credit.</Text> : null}
        </Stack>
      </Stack>
    </Drawer>
  );
}

function submitCustom(action: CustomRolePayload["action"], role: CustomRole, reason: string): Promise<SubmitResult> {
  const verb = action === "create" ? "Create" : action === "update" ? "Change" : "Delete";
  return submitWithHooks("admin.config.change", { kind: "custom-role", action, role, reason }, (ctx) =>
    submitOperation<CustomRolePayload>("role.custom-change", {
      title: `${verb} custom role: ${ctx.role.name}`,
      subject: { type: "Role", id: ctx.role.id, title: ctx.role.name, href: "/admin/roles" },
      payload: { action: ctx.action, role: ctx.role, reason: ctx.reason },
      summary: [
        { label: "Action", value: verb },
        { label: "Role", value: ctx.role.name },
        { label: "Cloned from", value: roleName(ctx.role.clonedFrom) },
        { label: "Sign-on limit", value: limitLabel(ctx.role.limitNgn) },
        { label: "Idle timeout", value: `${ctx.role.security.sessionTimeoutMin} min` },
        { label: "Reason", value: ctx.reason },
      ],
    }),
  );
}
