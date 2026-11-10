"use client";

import { useMemo, useState } from "react";
import { Play, Settings2 } from "lucide-react";
import {
  Alert,
  Badge,
  BarChart,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  Grid,
  PhaseBadge,
  ProgressBar,
  Select,
  Sparkline,
  Stack,
  StatCard,
  StatusBadge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { dateTime, number, pct } from "@/lib/format";
import { useActor, useAuditLog } from "@/modules/monitoring/audit";
import { connectors, projections, seedRuns, staging24h, statusTones, type Connector, type ConnectorStatus, type Run } from "../data";
import { useConnectors } from "../store";

type View = Connector & { effectiveStatus: ConnectorStatus; lastSyncAt: number; freshness: number; enabled: boolean; scheduleNow: string; isRunning: boolean };

function fmtAge(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} d ${h % 24} h ago`;
}
const fmtLatency = (ms: number) => (ms === 0 ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const fmtLag = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

export function ConnectorsPage() {
  const canEdit = useCan("connectors", "edit");
  const [loadedAt] = useState(() => Date.now());
  const runs = useConnectors((s) => s.runs);
  const overrides = useConnectors((s) => s.overrides);
  const running = useConnectors((s) => s.running);
  const addRun = useConnectors((s) => s.addRun);
  const setOverride = useConnectors((s) => s.setOverride);
  const setRunning = useConnectors((s) => s.setRunning);
  const audit = useAuditLog();
  const actor = useActor();
  const [configId, setConfigId] = useState<string | null>(null);

  const views: View[] = useMemo(
    () =>
      connectors.map((c) => {
        const o = overrides[c.id] ?? {};
        const lastSyncAt = o.lastRunAt ? new Date(o.lastRunAt).getTime() : loadedAt - c.lastSyncMin * 60_000;
        const enabled = o.enabled ?? true;
        const effectiveStatus: ConnectorStatus = !enabled ? "Paused" : (o.status ?? c.status);
        return { ...c, effectiveStatus, lastSyncAt, freshness: (loadedAt - lastSyncAt) / 60_000 / c.freshnessSlaMin, enabled, scheduleNow: o.schedule ?? c.schedule, isRunning: !!running[c.id] };
      }),
    [overrides, running, loadedAt],
  );
  const allRuns = useMemo(() => [...runs, ...seedRuns(loadedAt)].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [runs, loadedAt]);

  const healthy = views.filter((v) => v.effectiveStatus === "Healthy" || v.effectiveStatus === "Manual (Phase 1)").length;
  const problems = views.filter((v) => v.effectiveStatus === "Degraded" || v.effectiveStatus === "Failed");
  const stale = views.filter((v) => v.freshness > 1);
  const records = views.reduce((a, v) => a + v.records24h, 0);

  const runNow = (v: View) => {
    setRunning(v.id, true);
    audit({ action: "Triggered connector run (manual)", entityType: "Connector", entityId: v.id, after: v.name });
    window.setTimeout(() => {
      const failed = v.status === "Failed";
      const partial = v.status === "Degraded";
      const at = new Date().toISOString();
      const run: Run = {
        id: `RUN-${Date.now().toString(36).toUpperCase()}`,
        connectorId: v.id,
        startedAt: at,
        durationMs: Math.max(900, Math.round(v.latencyMs * (2 + Math.random()))),
        records: failed ? 0 : Math.max(1, Math.round((v.records24h / 24) * (0.6 + Math.random() * 0.8))),
        status: failed ? "Failed" : partial ? "Partial" : "Success",
        trigger: "Manual",
        by: actor.name,
        message: failed ? "401 — authentication rejected (tenant credential expired)" : partial ? "Some enquiries timed out — queued for retry" : undefined,
      };
      addRun(run);
      if (!failed) setOverride(v.id, { lastRunAt: at });
      setRunning(v.id, false);
    }, 1800);
  };

  const runCols: DataTableColumn<Run & { name: string }>[] = [
    { id: "id", header: "Run", accessor: "id", cell: (r) => <span className="font-mono">{r.id}</span> },
    { id: "name", header: "Connector", accessor: "name", sortable: true },
    { id: "started", header: "Started", accessor: "startedAt", sortable: true, cell: (r) => dateTime(r.startedAt) },
    { id: "duration", header: "Duration", accessor: "durationMs", numeric: true, sortable: true, cell: (r) => fmtLatency(r.durationMs) },
    { id: "records", header: "Records", accessor: "records", numeric: true, sortable: true, cell: (r) => number(r.records) },
    { id: "trigger", header: "Trigger", accessor: "trigger", sortable: true, cell: (r) => (r.by ? `${r.trigger} · ${r.by}` : r.trigger) },
    {
      id: "status",
      header: "Result",
      accessor: "status",
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <StatusBadge status={r.status} tones={{ Success: "success", Partial: "warning", Failed: "danger" }} />
          {r.message && (
            <Text variant="caption" tone="subtle">
              {r.message}
            </Text>
          )}
        </Stack>
      ),
    },
  ];
  const nameOf = new Map(connectors.map((c) => [c.id, c.name]));
  const config = views.find((v) => v.id === configId);
  const d = staging24h.discounted;
  const discountedTotal = d.interBranch + d.suspense + d.inAndOut + d.reversals;

  return (
    <ModulePage module="connectors" description="Health of the connectors feeding the Risk Data Spine through the staging / reconciliation layer — status, freshness, throughput, latency and errors (PRD §5, §4.6). All telemetry here is simulated.">
      <Stack gap="large">
        {problems.length > 0 && (
          <Alert tone={problems.some((p) => p.effectiveStatus === "Failed") ? "danger" : "warning"} title={`${problems.length} connector${problems.length > 1 ? "s need" : " needs"} attention`}>
            {problems.map((p) => `${p.name}: ${p.statusNote ?? p.effectiveStatus}`).join(" · ")}
          </Alert>
        )}
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Connectors healthy" value={`${healthy} / ${views.length}`} hint="Manual Phase 1 connectors count as healthy" tone="success" />
          <StatCard label="Degraded or failed" value={number(problems.length)} tone="danger" />
          <StatCard label="Outside freshness SLA" value={number(stale.length)} hint={stale.map((s) => s.name).join(", ") || "All data current"} tone="warning" />
          <StatCard label="Records (24 h)" value={number(records)} hint="Received into staging" />
        </Grid>

        <Grid columns={{ base: 1, md: 2, xl: 3 }} gap="medium">
          {views.map((v) => (
            <Card key={v.id} padding="medium">
              <Stack gap="medium">
                <Stack direction="horizontal" justify="between" align="start" gap="small">
                  <Stack gap="none">
                    <Text as="h3" variant="subtitle" className="text-fg">
                      {v.name}
                    </Text>
                    <Text variant="caption" tone="subtle">
                      PRD {v.prd} · {v.category}
                    </Text>
                  </Stack>
                  <StatusBadge status={v.isRunning ? "Running…" : v.effectiveStatus} tones={{ ...statusTones, "Running…": "info" }} />
                </Stack>
                <Text variant="small" tone="muted">
                  {v.method}
                </Text>
                {v.phaseNote && (
                  <Stack direction="horizontal" gap="small" align="center" wrap>
                    <PhaseBadge phase={2} label="Phase 2 automation" />
                    <Text variant="caption" tone="subtle">
                      {v.phaseNote}
                    </Text>
                  </Stack>
                )}
                <ProgressBar
                  value={Math.min(1, v.freshness)}
                  tone={v.freshness > 1 ? "danger" : v.freshness > 0.75 ? "warning" : "success"}
                  label={`Data freshness — last sync ${fmtAge(loadedAt - v.lastSyncAt)}`}
                  ariaLabel={`Freshness ${Math.round(v.freshness * 100)}% of SLA`}
                  size="small"
                />
                <DescriptionList
                  columns={3}
                  divided={false}
                  items={[
                    { label: "Volume", value: number(v.records24h), mono: true, hint: `${v.recordsLabel}, 24 h` },
                    { label: "Latency", value: fmtLatency(v.latencyMs), mono: true, hint: "p95" },
                    { label: "Errors", value: pct(v.errorRatePct, 1), mono: true, hint: "24 h" },
                  ]}
                />
                <Stack direction="horizontal" align="center" gap="small">
                  <div className="min-w-0 flex-1">
                    <Sparkline values={v.errorSeries} tone={v.errorRatePct > 5 ? "danger" : v.errorRatePct > 1 ? "warning" : "success"} height={24} label={`${v.name} error rate, last 12 hours`} />
                  </div>
                  <Text variant="caption" tone="subtle">
                    Errors 12 h
                  </Text>
                </Stack>
                {v.statusNote && (
                  <Text variant="caption" tone={v.effectiveStatus === "Failed" ? "accent" : "subtle"}>
                    {v.statusNote}
                  </Text>
                )}
                <Text variant="caption" tone="subtle">
                  Schedule: {v.scheduleNow} · SLA {fmtLag(v.freshnessSlaMin * 60)}
                </Text>
                <Stack direction="horizontal" gap="small">
                  {canEdit && (
                    <Button size="small" variant="secondary" iconBefore={<Play aria-hidden className="size-4" />} onClick={() => runNow(v)} loading={v.isRunning} disabled={!v.enabled || v.isRunning}>
                      Run now
                    </Button>
                  )}
                  <Button size="small" variant="tertiary" iconBefore={<Settings2 aria-hidden className="size-4" />} onClick={() => setConfigId(v.id)}>
                    {canEdit ? "Configure" : "Configuration"}
                  </Button>
                </Stack>
              </Stack>
            </Card>
          ))}
        </Grid>

        <Tabs
          label="Connector details"
          variant="underline"
          items={[
            {
              id: "runs",
              label: "Recent runs",
              content: (
                <DataTable
                  label="Recent connector runs"
                  data={allRuns.map((r) => ({ ...r, name: nameOf.get(r.connectorId) ?? r.connectorId }))}
                  columns={runCols}
                  getRowId={(r) => r.id}
                  searchable
                  density="compact"
                  defaultSort={{ id: "started", direction: "desc" }}
                  filters={[
                    { id: "name", label: "Connector", columnId: "name" },
                    { id: "status", label: "Result", columnId: "status" },
                  ]}
                  exportFilename="connector-runs.csv"
                />
              ),
            },
            {
              id: "staging",
              label: "Staging & reconciliation",
              content: (
                <Grid columns={{ base: 1, lg: 2 }} gap="medium">
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>Discounted before promotion (24 h)</CardTitle>
                        <CardDescription>
                          Inter-branch, suspense, in-and-out and reversal entries are detected algorithmically and excluded before data feeds the COP ratio and 360 RAR scoring (PRD §5.1).
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <BarChart
                      orientation="horizontal"
                      tone="warning"
                      label="Entries discounted by type"
                      valueFormatter={(n) => number(n)}
                      data={[
                        { label: "In-and-out", value: d.inAndOut },
                        { label: "Inter-branch", value: d.interBranch },
                        { label: "Reversals", value: d.reversals },
                        { label: "Suspense", value: d.suspense },
                      ]}
                    />
                    <DescriptionList
                      className="mt-4"
                      columns={3}
                      items={[
                        { label: "Received", value: number(staging24h.received), mono: true },
                        { label: "Discounted", value: number(discountedTotal), mono: true },
                        { label: "Promoted", value: number(staging24h.received - discountedTotal - staging24h.quarantined), mono: true, hint: `${staging24h.quarantined} quarantined for review` },
                      ]}
                    />
                  </Card>
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>Unreconciled items by age</CardTitle>
                        <CardDescription>Items ageing past their clearance window raise an exception through the escalation protocol (PRD §6.4.4).</CardDescription>
                      </div>
                    </CardHeader>
                    <BarChart tone="info" label="Unreconciled items by age" data={staging24h.unreconciledAgeing.map((a) => ({ label: a.label, value: a.value }))} valueFormatter={(n) => number(n)} />
                  </Card>
                </Grid>
              ),
            },
            {
              id: "projections",
              label: "Projection freshness",
              content: (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Read-model projection lag</CardTitle>
                      <CardDescription>How far each downstream engine’s read model trails the write side. Shown wherever lag affects a decision (PRD §4.3).</CardDescription>
                    </div>
                  </CardHeader>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Projection</TableHeaderCell>
                        <TableHeaderCell numeric>Lag</TableHeaderCell>
                        <TableHeaderCell numeric>Events (24 h)</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {projections.map((p) => (
                        <TableRow key={p.name}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell numeric>{fmtLag(p.lagSec)}</TableCell>
                          <TableCell numeric>{number(p.events)}</TableCell>
                          <TableCell>
                            <StatusBadge status={p.status} tones={{ [p.status]: p.status === "Current" ? "success" : "danger" }} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              ),
            },
          ]}
        />
      </Stack>

      {config && (
        <ConfigDrawer
          v={config}
          canEdit={canEdit}
          onClose={() => setConfigId(null)}
          onSave={(schedule, enabled) => {
            setOverride(config.id, { schedule, enabled });
            audit({ action: "Changed connector configuration", entityType: "Connector", entityId: config.id, before: `${config.scheduleNow} · ${config.enabled ? "enabled" : "paused"}`, after: `${schedule} · ${enabled ? "enabled" : "paused"}` });
            setConfigId(null);
          }}
        />
      )}
    </ModulePage>
  );
}

const scheduleOptions = ["Every 5 minutes (market hours)", "Every 15 minutes + 01:00 batch", "Every 30 minutes + on demand before approval", "Hourly", "Daily 06:00", "Daily 07:00 (series on publisher cadence)", "Daily 08:00", "Daily 02:00", "On demand", "On demand (origination & renewal)", "On upload", "Event-driven (queue)", "Daily close (Phase 2) · on upload (Phase 1)"];

function ConfigDrawer({ v, canEdit, onClose, onSave }: { v: View; canEdit: boolean; onClose: () => void; onSave: (schedule: string, enabled: boolean) => void }) {
  const [schedule, setSchedule] = useState(v.scheduleNow);
  const [enabled, setEnabled] = useState(v.enabled);
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={v.name}
      description={`PRD ${v.prd} · ${v.category}`}
      size="medium"
      footer={
        canEdit ? (
          <>
            <Button variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onSave(schedule, enabled)}>Save configuration</Button>
          </>
        ) : undefined
      }
    >
      <Stack gap="large">
        <DescriptionList
          columns={1}
          layout="inline"
          items={[
            { label: "Method", value: v.method },
            { label: "Endpoint", value: <Badge variant="outline">Configured by tenant</Badge> },
            { label: "Authentication", value: <Badge variant="outline">Configured by tenant (credential vault)</Badge> },
            { label: "Data format", value: v.dataFormat },
            { label: "Retry policy", value: "Automatic retry with back-off (tenant parameter)" },
            { label: "Writes to", value: "Staging / reconciliation layer → Risk Data Spine" },
            { label: "Consumed by", value: v.consumers.join(" · ") },
            { label: "Freshness SLA", value: fmtLag(v.freshnessSlaMin * 60), hint: "Tenant parameter — demo value" },
          ]}
        />
        {canEdit ? (
          <Stack gap="medium">
            <Field label="Schedule" htmlFor="con-schedule">
              <Select id="con-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} options={[...new Set([v.scheduleNow, ...scheduleOptions])].map((s) => ({ value: s, label: s }))} />
            </Field>
            <Switch label="Connector enabled" description="Pausing stops scheduled runs; downstream data goes stale." checked={enabled} onCheckedChange={setEnabled} />
          </Stack>
        ) : (
          <Alert tone="info">Only IT support and system administrators can change connector configuration.</Alert>
        )}
      </Stack>
    </Drawer>
  );
}
