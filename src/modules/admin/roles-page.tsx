"use client";

import { useMemo, useState } from "react";
import { Copy, Lock, MonitorSmartphone, RotateCcw, Timer, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  ChipList,
  Chip,
  DataTable,
  Drawer,
  Field,
  Grid,
  Input,
  Select,
  Stack,
  StatCard,
  Switch,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { allNavItems } from "@/lib/nav";
import { roleById, type ModuleKey, type RoleId } from "@/lib/rbac/roles";
import { money, moneyShort } from "@/lib/format";
import { useAuditLog } from "@/modules/workspace/use-audit-log";
import { ConfigNotice } from "./config-notice";
import { configureRoles, defaultRoleSecurity, useAdminStore, type ConfiguredRole } from "./store";

const limitLabel = (n: number | null) => (n === null ? "—" : Number.isFinite(n) ? moneyShort(n) : "Apex (no ceiling)");
const timeoutOptions = [5, 10, 15, 20, 30, 60].map((m) => ({ value: m, label: `${m} minutes` }));
const moduleLabel = (m: ModuleKey) => allNavItems.find((i) => i.module === m)?.label ?? m;

/** Admin → Roles & limits (PRD §4.0–4.2): default role set, tiers, sign-on limits, per-role session rules, clone role. */
export function RolesPage() {
  const canEdit = useCan("admin", "edit");
  const roleOverrides = useAdminStore((s) => s.roleOverrides);
  const roleSecurity = useAdminStore((s) => s.roleSecurity);
  const customRoles = useAdminStore((s) => s.customRoles);
  const configured = useMemo(() => configureRoles({ roleOverrides, roleSecurity, customRoles }), [roleOverrides, roleSecurity, customRoles]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = configured.find((r) => r.id === selectedId) ?? null;

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

  const tiered = configured.filter((r) => r.tier !== null);

  return (
    <ModulePage module="admin" description="The default role set is an illustrative configuration (PRD §4.1). Rename, re-limit, clone and tighten session rules per role.">
      <Stack gap="large">
        <ConfigNotice canEdit={canEdit} />
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Roles" value={configured.length} hint={`${customRoles.length} cloned`} icon={<Lock aria-hidden className="size-5" />} tone="accent" />
          <StatCard label="Approval tiers" value={new Set(tiered.map((r) => r.tier)).size} hint="Chart-flow tiers with sign-on limits" icon={<Copy aria-hidden className="size-5" />} tone="info" />
          <StatCard label="Tighter session rules" value={configured.filter((r) => r.security.deviceBinding || r.security.ipAllowList).length} hint="Device binding or IP allow-list" icon={<MonitorSmartphone aria-hidden className="size-5" />} tone="warning" />
          <StatCard label="MFA" value="All roles" hint="Enforced on every sign-in" icon={<Timer aria-hidden className="size-5" />} tone="success" />
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
              Limits are illustrative NGN values for the demo tenant (PRD §4.1–4.2: tenant-configurable). Tighter session defaults apply to Disbursement Maker/Checker and Legal (PRD §4.2).
            </Text>
          </CardContent>
        </Card>
      </Stack>
      <RoleDrawer key={selected ? `${selected.id}:${selected.name}:${selected.limitNgn}:${selected.security.ipAllowList}` : "none"} role={selected} canEdit={canEdit} onClose={() => setSelectedId(null)} onCloned={(id) => setSelectedId(id)} tiered={tiered} />
    </ModulePage>
  );
}

function RoleDrawer({ role, canEdit, onClose, onCloned, tiered }: { role: ConfiguredRole | null; canEdit: boolean; onClose: () => void; onCloned: (id: string) => void; tiered: ConfiguredRole[] }) {
  const setOverride = useAdminStore((s) => s.setRoleOverride);
  const setSecurity = useAdminStore((s) => s.setRoleSecurity);
  const addCustomRole = useAdminStore((s) => s.addCustomRole);
  const removeCustomRole = useAdminStore((s) => s.removeCustomRole);
  const log = useAuditLog();
  const [name, setName] = useState(role?.name ?? "");
  const [limit, setLimit] = useState(role && role.limitNgn !== null && Number.isFinite(role.limitNgn) ? String(role.limitNgn) : "");
  const [ip, setIp] = useState(role?.security.ipAllowList ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!role) return <Drawer open={false} onOpenChange={() => undefined} title="Role" />;

  const apex = role.limitNgn !== null && !Number.isFinite(role.limitNgn);
  const hasLimit = role.limitNgn !== null && !apex;
  const below = tiered.filter((r) => r.tier !== null && role.tier !== null && r.tier < role.tier && r.limitNgn !== null);
  const above = tiered.filter((r) => r.tier !== null && role.tier !== null && r.tier > role.tier && r.limitNgn !== null);

  const save = () => {
    const changes: string[] = [];
    if (name.trim() && name.trim() !== role.name) {
      if (role.custom) {
        removeCustomRole(role.id);
        addCustomRole({ ...role.custom, name: name.trim() });
      } else setOverride(role.id, { name: name.trim() });
      log({ action: "Renamed role", entityType: "Role", entityId: role.id, before: role.name, after: name.trim() });
      changes.push("name");
    }
    if (hasLimit) {
      const value = Number(limit.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(value) || value <= 0) return setError("Enter a positive limit in naira.");
      const tooLow = below.find((r) => (r.limitNgn ?? 0) > value);
      const tooHigh = above.find((r) => Number.isFinite(r.limitNgn ?? 0) && (r.limitNgn ?? 0) < value);
      if (tooLow || tooHigh) return setError(`Limits must rise with the tier: ${tooLow ? `${tooLow.name} (tier ${tooLow.tier}) is ${moneyShort(tooLow.limitNgn!)}` : `${tooHigh!.name} (tier ${tooHigh!.tier}) is ${moneyShort(tooHigh!.limitNgn!)}`}.`);
      if (value !== role.limitNgn) {
        if (role.custom) {
          removeCustomRole(role.id);
          addCustomRole({ ...role.custom, name: name.trim() || role.name, limitNgn: value });
        } else setOverride(role.id, { limitNgn: value });
        log({ action: "Changed sign-on limit", entityType: "Role", entityId: role.id, before: money(role.limitNgn!), after: money(value) });
        changes.push("limit");
      }
    }
    if (ip.trim() !== role.security.ipAllowList) {
      const bad = ip
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .find((x) => !/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(x));
      if (bad) return setError(`"${bad}" isn't a valid IPv4 address or CIDR range.`);
      setSecurity(role.id, { ipAllowList: ip.trim() });
      log({ action: "Changed IP allow-list", entityType: "Role", entityId: role.id, before: role.security.ipAllowList || "Any network", after: ip.trim() || "Any network" });
      changes.push("ip");
    }
    setError(null);
    if (changes.length === 0) setError(null);
  };

  const clone = () => {
    const id = `custom-${Date.now().toString(36)}`;
    const base = (role.custom?.clonedFrom ?? role.id) as RoleId;
    addCustomRole({ id, clonedFrom: base, name: `${role.name} (copy)`, short: `${roleById[base].short}*`, limitNgn: hasLimit ? role.limitNgn : null, createdAt: new Date().toISOString() });
    setSecurity(id, role.security);
    log({ action: "Cloned role", entityType: "Role", entityId: id, before: role.name, after: `${role.name} (copy)` });
    onCloned(id);
  };

  const resetDefaults = () => {
    if (role.custom) return;
    const def = roleById[role.id as RoleId];
    setOverride(role.id, { name: undefined, limitNgn: undefined });
    setSecurity(role.id, defaultRoleSecurity(role.id));
    log({ action: "Reset role to default", entityType: "Role", entityId: role.id, before: `${role.name} · ${limitLabel(role.limitNgn)}`, after: `${def.name} · ${limitLabel(def.limitNgn)}` });
  };

  const modules = Object.entries(role.modules) as Array<[ModuleKey, "view" | "edit"]>;

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
              <Button
                variant="danger"
                iconBefore={<Trash2 aria-hidden className="size-4" />}
                onClick={() => {
                  removeCustomRole(role.id);
                  log({ action: "Deleted cloned role", entityType: "Role", entityId: role.id, before: role.name });
                  onClose();
                }}
              >
                Delete
              </Button>
            ) : role.edited || role.security.sessionTimeoutMin !== defaultRoleSecurity(role.id).sessionTimeoutMin ? (
              <Button variant="text" iconBefore={<RotateCcw aria-hidden className="size-4" />} onClick={resetDefaults}>
                Reset to default
              </Button>
            ) : null}
            <Button variant="tertiary" iconBefore={<Copy aria-hidden className="size-4" />} onClick={clone}>
              Clone role
            </Button>
            <Button onClick={save}>Save changes</Button>
          </div>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Text tone="muted">{role.description}</Text>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Role name" htmlFor="role-name" description="Rename to match your organogram (PRD §4.0).">
          <Input id="role-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Sign-on (approval) limit"
          htmlFor="role-limit"
          description={apex ? "Apex tier — statutory single-obligor ceiling and above." : hasLimit ? "Local-currency value, mapped 1:1 to this tier in the chart-flow (PRD §4.2)." : "This role has no credit approval authority."}
        >
          <Input id="role-limit" prefix="₦" inputMode="numeric" value={apex ? "No ceiling" : hasLimit ? limit : "Not applicable"} disabled={!canEdit || !hasLimit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Stack gap="medium">
          <Text variant="eyebrow" tone="muted">
            Session & sign-on rules (PRD §4.2)
          </Text>
          <Field label="Idle session timeout" htmlFor="role-timeout">
            <Select
              id="role-timeout"
              value={role.security.sessionTimeoutMin}
              options={timeoutOptions}
              disabled={!canEdit}
              onChange={(e) => {
                setSecurity(role.id, { sessionTimeoutMin: Number(e.target.value) });
                log({ action: "Changed session timeout", entityType: "Role", entityId: role.id, before: `${role.security.sessionTimeoutMin} min`, after: `${e.target.value} min` });
              }}
            />
          </Field>
          <Switch
            label="Device binding"
            description="Only devices registered to the user can sign in with this role."
            checked={role.security.deviceBinding}
            disabled={!canEdit}
            onCheckedChange={(checked) => {
              setSecurity(role.id, { deviceBinding: checked });
              log({ action: "Changed device binding", entityType: "Role", entityId: role.id, before: role.security.deviceBinding ? "On" : "Off", after: checked ? "On" : "Off" });
            }}
          />
          <Field label="IP allow-list" htmlFor="role-ip" description="Comma-separated IPv4 addresses or CIDR ranges. Empty = any network." optional>
            <Input id="role-ip" value={ip} disabled={!canEdit} placeholder="e.g. 10.20.0.0/16, 196.46.20.0/24" onChange={(e) => setIp(e.target.value)} />
          </Field>
          <Switch label="Multi-factor authentication" description="Mandatory for every role (PRD §4, §10.1)." checked disabled />
        </Stack>
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
          {role.id === "system-admin" ? <Text variant="small" tone="muted">System Admin has configuration, not credit, authority — it can&apos;t approve credit (PRD §4.1).</Text> : null}
        </Stack>
      </Stack>
    </Drawer>
  );
}
