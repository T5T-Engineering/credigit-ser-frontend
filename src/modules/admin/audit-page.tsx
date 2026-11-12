"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, ScrollText, ShieldCheck, Users } from "lucide-react";
import {
  Alert,
  AuditTrail,
  Badge,
  Card,
  CardContent,
  DataTable,
  FilterBar,
  Grid,
  SegmentedControl,
  Stack,
  StatCard,
  Text,
  type ActivityItem,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import type { AuditEvent } from "@/lib/data/types";
import { roleById } from "@/lib/rbac/roles";
import { ruleDefinition } from "@/lib/platform/rules";
import { dateTime } from "@/lib/format";
import { useAuditLog } from "@/modules/workspace/use-audit-log";
import { useAuditEntries } from "./use-audit-entries";
import { DAY, nowMs } from "@/modules/workspace/data";

/** What an audit entry is about, in words: rules show their label, not the technical key. */
function entityText(e: AuditEvent): string {
  if (e.entityId === "-") return e.entityType;
  const name = e.entityType === "Rule" ? (ruleDefinition(e.entityId)?.label ?? e.entityId) : e.entityId;
  return `${e.entityType} · ${name}`;
}

const typeOf = (a: string) =>
  /sign(ed)? (in|out)|switched/i.test(a) ? "session" : /approv|recommend|declin|adjudic|confirm/i.test(a) ? "decision" : /parameter|limit|role|haircut|adjudicator|product|sector|branding|session timeout|device|allow-list/i.test(a) ? "configuration" : /view|generated/i.test(a) ? "read" : "update";
const typeTone = { session: "neutral", decision: "success", configuration: "accent", read: "info", update: "warning" } as const;

/** Audit log (PRD §4, §10.1, §10.3): immutable, append-only — who, what, before/after, timestamp, IP/device. */
export function AuditPage() {
  const { entries: audit, loading, error: loadError, backendTotal } = useAuditEntries();
  const role = useRole();
  const log = useAuditLog();
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("");
  const [roleF, setRoleF] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [view, setView] = useState<"table" | "timeline">("table");

  // IT Support access to business data is read-only and itself logged (PRD §10.1).
  useEffect(() => {
    if (role?.id !== "it-support") return;
    const key = "credigit.ser.audit-viewed";
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    log({ action: "Viewed audit log (read-only support access)", entityType: "Audit log", entityId: "-" });
  }, [role?.id, log]);

  const opts = (values: string[]) => [...new Set(values)].sort().map((v) => ({ value: v, label: v }));
  const options = useMemo(
    () => ({
      actor: opts(audit.map((e) => e.actorName)),
      role: [...new Set(audit.map((e) => e.roleId))].map((r) => ({ value: r, label: roleById[r]?.name ?? r })).sort((a, b) => a.label.localeCompare(b.label)),
      action: opts(audit.map((e) => e.action)),
      entity: opts(audit.map((e) => e.entityType)),
    }),
    [audit],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audit.filter((e) => {
      const day = e.at.slice(0, 10);
      if (actor && e.actorName !== actor) return false;
      if (roleF && e.roleId !== roleF) return false;
      if (action && e.action !== action) return false;
      if (entity && e.entityType !== entity) return false;
      if (range.from && day < range.from) return false;
      if (range.to && day > range.to) return false;
      if (q && ![e.id, e.actorName, e.action, e.entityType, e.entityId, e.before, e.after, e.ip, e.device].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [audit, search, actor, roleF, action, entity, range]);

  const columns: DataTableColumn<AuditEvent>[] = [
    { id: "at", header: "When", accessor: "at", sortable: true, csv: (e) => e.at, cell: (e) => <span className="whitespace-nowrap font-mono">{dateTime(e.at)}</span> },
    {
      id: "actor",
      header: "Who",
      accessor: "actorName",
      sortable: true,
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-semibold">{e.actorName}</span>
          <span className="text-sm text-fg-muted">{roleById[e.roleId]?.name ?? e.roleId}</span>
        </span>
      ),
    },
    { id: "role", header: "Role", accessor: (e) => roleById[e.roleId]?.name ?? e.roleId, hidden: true },
    {
      id: "action",
      header: "What",
      accessor: "action",
      sortable: true,
      cell: (e) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={typeTone[typeOf(e.action)]}>{typeOf(e.action)}</Badge>
          <span>{e.action}</span>
        </span>
      ),
    },
    { id: "entity", header: "Entity", accessor: (e) => entityText(e), sortable: true, cell: (e) => <span className="text-sm">{entityText(e)}</span> },
    {
      id: "change",
      header: "Before → after",
      accessor: (e) => (e.before || e.after ? `${e.before ?? "—"} → ${e.after ?? "—"}` : ""),
      cell: (e) =>
        e.before || e.after ? (
          <span className="font-mono text-sm">
            <span className="text-fg-muted line-through">{e.before ?? "—"}</span> → <span className="font-semibold">{e.after ?? "—"}</span>
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { id: "ip", header: "IP", accessor: "ip", cell: (e) => <span className="font-mono text-sm">{e.ip}</span> },
    { id: "device", header: "Device", accessor: "device" },
    { id: "id", header: "Event ID", accessor: "id", hidden: true },
  ];

  const items: ActivityItem[] = rows.slice(0, 80).map((e) => ({
    id: e.id,
    actor: { name: e.actorName, role: roleById[e.roleId]?.name },
    action: e.action,
    target: entityText(e),
    type: typeOf(e.action),
    timestamp: e.at,
    changes: e.before || e.after ? [{ field: "Value", before: e.before, after: e.after }] : undefined,
    ip: e.ip,
    device: e.device,
    tone: typeTone[typeOf(e.action)],
  }));

  const since = nowMs - 7 * DAY;
  const clear = () => {
    setSearch("");
    setActor("");
    setRoleF("");
    setAction("");
    setEntity("");
    setRange({});
  };

  return (
    <ModulePage module="audit" description="Every create, read, update, approve and override action — who, what, before/after value, timestamp, IP and device.">
      <Stack gap="large">
        {loadError ? (
          <Alert tone="warning" title="The server audit trail couldn&apos;t be loaded">
            {loadError} Showing the app activity log only.
          </Alert>
        ) : null}
        <Alert tone="info" title="Append-only">
          Audit entries can&apos;t be edited or deleted by any role, including System Admin. Every AI-assisted output is logged with its model and version.
        </Alert>
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Events" value={loading ? "…" : audit.length} hint={backendTotal !== null && backendTotal > audit.length ? `Latest of ${backendTotal} server entries` : "In this tenant"} icon={<ScrollText aria-hidden className="size-5" />} tone="accent" />
          <StatCard label="Last 7 days" value={audit.filter((e) => new Date(e.at).getTime() >= since).length} hint="All actions" icon={<Lock aria-hidden className="size-5" />} tone="info" />
          <StatCard label="Configuration changes" value={audit.filter((e) => typeOf(e.action) === "configuration").length} hint="Parameters, roles, limits" icon={<ShieldCheck aria-hidden className="size-5" />} tone="warning" />
          <StatCard label="Distinct users" value={new Set(audit.map((e) => e.actorId)).size} hint="Named individuals only" icon={<Users aria-hidden className="size-5" />} tone="success" />
        </Grid>
        <Card>
          <CardContent>
            <Stack gap="medium">
              <FilterBar
                search={{ value: search, onChange: setSearch, placeholder: "Search events, entities, IP…" }}
                filters={[
                  { id: "actor", label: "Actor", options: options.actor, value: actor, onChange: setActor },
                  { id: "role", label: "Role", options: options.role, value: roleF, onChange: setRoleF },
                  { id: "action", label: "Action", options: options.action, value: action, onChange: setAction },
                  { id: "entity", label: "Entity", options: options.entity, value: entity, onChange: setEntity },
                  { type: "dateRange", id: "date", label: "Date", from: range.from, to: range.to, onChange: setRange },
                ]}
                onClearAll={clear}
                actions={
                  <SegmentedControl
                    label="View"
                    size="small"
                    value={view}
                    onChange={(v) => setView(v as "table" | "timeline")}
                    options={[
                      { value: "table", label: "Table" },
                      { value: "timeline", label: "Timeline" },
                    ]}
                  />
                }
              />
              {view === "table" ? (
                <DataTable
                  columns={columns}
                  data={rows}
                  getRowId={(e) => e.id}
                  label="Audit log"
                  defaultSort={{ id: "at", direction: "desc" }}
                  defaultPageSize={15}
                  exportFilename="audit-log.csv"
                  exportLabel="Export CSV"
                  mobileCard={(e) => (
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-sm text-fg-muted">{dateTime(e.at)}</span>
                      <span className="font-semibold">
                        {e.actorName} · {e.action}
                      </span>
                      <span className="text-sm">
                        {entityText(e)}
                        {e.before || e.after ? ` · ${e.before ?? "—"} → ${e.after ?? "—"}` : ""}
                      </span>
                      <span className="text-sm text-fg-muted">
                        {e.ip} · {e.device}
                      </span>
                    </div>
                  )}
                />
              ) : (
                <>
                  <AuditTrail items={items} formatTimestamp={(t) => dateTime(t)} emptyMessage="No events match these filters." />
                  {rows.length > 80 ? (
                    <Text variant="caption" tone="subtle">
                      Showing the latest 80 of {rows.length} matching events — use the table view to export all.
                    </Text>
                  ) : null}
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </ModulePage>
  );
}
