"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, Settings2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
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
  Text,
  TextLink,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { number, pct } from "@/lib/format";
import { useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { PendingApproval } from "@/modules/monitoring/pending-approval";
import { statusTones } from "../data";
import { requestConfigChange, runConnector } from "../service";
import { fmtAge, fmtLag, fmtLatency, useConnectorViews, useLoadedAt, type ConnectorView } from "../views";

export function ConnectorsPage() {
  const canEdit = useCan("connectors", "edit");
  const loadedAt = useLoadedAt();
  const views = useConnectorViews(loadedAt);
  const warnRatio = useRule<number>("connectors.freshness.warnRatio");
  const errWarn = useRule<number>("connectors.errorRate.warnPct");
  const errDanger = useRule<number>("connectors.errorRate.dangerPct");
  const instances = useOperationsStore((s) => s.instances);
  const pendingIds = new Set(instances.filter((i) => i.subject.type === "Connector" && ["Pending", "In progress"].includes(i.status)).map((i) => i.subject.id));
  const [configId, setConfigId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "danger" | "success" | "info"; text: string } | null>(null);

  const healthy = views.filter((v) => v.effectiveStatus === "Healthy" || v.effectiveStatus === "Manual (Phase 1)").length;
  const problems = views.filter((v) => v.effectiveStatus === "Degraded" || v.effectiveStatus === "Failed");
  const stale = views.filter((v) => v.freshness > 1);
  const records = views.reduce((a, v) => a + v.records24h, 0);
  const config = views.find((v) => v.id === configId);

  const runNow = async (v: ConnectorView) => {
    const r = await runConnector(v);
    if (!r.ok) setNotice({ tone: "danger", text: r.reason });
    else if (r.run?.status === "Failed") setNotice({ tone: "danger", text: `${v.name}: run ${r.run.id} failed — IT support and system administrators were notified.` });
  };

  return (
    <ModulePage module="connectors" description="Health of the connectors feeding the Risk Data Spine through the staging / reconciliation layer — status, freshness, throughput, latency and errors (PRD §5, §4.6). All telemetry here is simulated.">
      <Stack gap="large">
        {notice && (
          <Alert tone={notice.tone} action={<Button size="small" variant="tertiary" onClick={() => setNotice(null)}>Dismiss</Button>}>
            {notice.text}
          </Alert>
        )}
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
                  <Stack gap="xsmall" align="end">
                    <StatusBadge status={v.isRunning ? "Running…" : v.effectiveStatus} tones={{ ...statusTones, "Running…": "info" }} />
                    {pendingIds.has(v.id) && <Badge variant="outline">Change pending</Badge>}
                  </Stack>
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
                  tone={v.freshness > 1 ? "danger" : v.freshness > warnRatio ? "warning" : "success"}
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
                    <Sparkline values={v.errorSeries} tone={v.errorRatePct > errDanger ? "danger" : v.errorRatePct > errWarn ? "warning" : "success"} height={24} label={`${v.name} error rate, last 12 hours`} />
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
        <Text variant="caption" tone="subtle">
          Run history: <TextLink as={Link} href="/connectors/runs">Recent runs</TextLink> · Data quality: <TextLink as={Link} href="/connectors/staging">Staging & reconciliation</TextLink>
        </Text>
      </Stack>

      {config && (
        <ConfigDrawer
          v={config}
          canEdit={canEdit}
          onClose={() => setConfigId(null)}
          onSubmitted={(text) => {
            setNotice({ tone: "info", text });
            setConfigId(null);
          }}
        />
      )}
    </ModulePage>
  );
}

function ConfigDrawer({ v, canEdit, onClose, onSubmitted }: { v: ConnectorView; canEdit: boolean; onClose: () => void; onSubmitted: (text: string) => void }) {
  const scheduleOptions = useRule<string[]>("connectors.scheduleOptions");
  const retryPolicy = useRule<string>("connectors.retryPolicy");
  const pendingOps = useOperationsStore((s) => s.instances.some((i) => i.subject.type === "Connector" && i.subject.id === v.id && ["Pending", "In progress"].includes(i.status)));
  const [schedule, setSchedule] = useState(v.scheduleNow);
  const [enabled, setEnabled] = useState(v.enabled);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = schedule !== v.scheduleNow || enabled !== v.enabled;

  const submit = async () => {
    setBusy(true);
    const r = await requestConfigChange(v, { schedule: v.scheduleNow, enabled: v.enabled }, { schedule, enabled });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    onSubmitted(r.applied ? `${v.name}: configuration applied (workflow disabled).` : `${v.name}: change submitted for approval (${r.operationId}). It applies once approved in Operations.`);
  };

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
            <Button onClick={submit} disabled={!changed || pendingOps} loading={busy}>
              Submit for approval
            </Button>
          </>
        ) : undefined
      }
    >
      <Stack gap="large">
        <PendingApproval subjectType="Connector" subjectId={v.id} label="Configuration change awaiting approval" />
        <DescriptionList
          columns={1}
          layout="inline"
          items={[
            { label: "Method", value: v.method },
            { label: "Endpoint", value: <Badge variant="outline">Configured by tenant</Badge> },
            { label: "Authentication", value: <Badge variant="outline">Configured by tenant (credential vault)</Badge> },
            { label: "Data format", value: v.dataFormat },
            { label: "Retry policy", value: retryPolicy, hint: "Business rule" },
            { label: "Writes to", value: "Staging / reconciliation layer → Risk Data Spine" },
            { label: "Consumed by", value: v.consumers.join(" · ") },
            { label: "Freshness SLA", value: fmtLag(v.freshnessSlaMin * 60), hint: "Business rule — change in Operations → Business rules" },
          ]}
        />
        {canEdit ? (
          <Stack gap="medium">
            <Field label="Schedule" htmlFor="con-schedule">
              <Select id="con-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} options={[...new Set([v.scheduleNow, ...scheduleOptions])].map((s) => ({ value: s, label: s }))} disabled={pendingOps} />
            </Field>
            <Switch label="Connector enabled" description="Pausing stops scheduled runs; downstream data goes stale." checked={enabled} onCheckedChange={setEnabled} disabled={pendingOps} />
            <Text variant="caption" tone="subtle">
              Configuration changes are approved through the Operations workflow before they take effect; you can’t approve your own request.
            </Text>
            {error && (
              <Alert tone="danger" action={<Button size="small" variant="tertiary" onClick={() => setError(null)}>Dismiss</Button>}>
                {error}
              </Alert>
            )}
          </Stack>
        ) : (
          <Alert tone="info">Only IT support and system administrators can request connector configuration changes.</Alert>
        )}
      </Stack>
    </Drawer>
  );
}
