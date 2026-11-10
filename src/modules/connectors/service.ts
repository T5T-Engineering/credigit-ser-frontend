"use client";

/**
 * Connector commands (PRD §5, §4.6). Manual runs: hooks, audit, events, failure notification.
 * Configuration changes (schedule / enable / pause) route through the Operations workflow ("connectors.config.change").
 * BACKEND SEAM: runs become POSTs to the connector job API; configuration becomes tenant configuration commands.
 */
import { dateTime } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { submitOperation } from "@/lib/platform/operations";
import { currentActor, type Actor } from "@/lib/platform/scope";
import { auditAs } from "@/modules/monitoring/audit";
import { connectors, type Connector, type Run } from "./data";
import type { ConfigChangePayload } from "./platform";
import { useConnectors } from "./store";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

const M = "connectors";
const subject = (c: Pick<Connector, "id" | "name">) => ({ type: "Connector", id: c.id, title: c.name, href: "/connectors" });
const describe = (schedule: string, enabled: boolean) => `${schedule} · ${enabled ? "enabled" : "paused"}`;

/** Simulated run duration (prototype only — the real job runs server-side). */
// TD-601: simulator input, not a business rule.
const SIMULATED_RUN_MS = 1800;

/** Trigger a manual run. Resolves when the (simulated) run finishes. */
export async function runConnector(c: Connector): Promise<Result<{ run?: Run }>> {
  const actor = currentActor();
  const hook = await runHooks("connectors.run.before", { connector: c, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const store = useConnectors.getState();
  store.setRunning(c.id, true);
  auditAs(actor, { action: "Triggered connector run (manual)", entityType: "Connector", entityId: c.id, after: c.name });
  publish("connectors.run.started", { module: M, subject: subject(c), payload: { trigger: "Manual" } });
  await new Promise((r) => window.setTimeout(r, SIMULATED_RUN_MS));
  const failed = c.status === "Failed";
  const partial = c.status === "Degraded";
  const at = new Date().toISOString();
  const run: Run = {
    id: `RUN-${Date.now().toString(36).toUpperCase()}`,
    connectorId: c.id,
    startedAt: at,
    durationMs: Math.max(900, Math.round(c.latencyMs * (2 + Math.random()))),
    records: failed ? 0 : Math.max(1, Math.round((c.records24h / 24) * (0.6 + Math.random() * 0.8))),
    status: failed ? "Failed" : partial ? "Partial" : "Success",
    trigger: "Manual",
    by: actor.name,
    message: failed ? "401 — authentication rejected (tenant credential expired)" : partial ? "Some enquiries timed out — queued for retry" : undefined,
  };
  store.addRun(run);
  if (!failed) store.setOverride(c.id, { lastRunAt: at });
  store.setRunning(c.id, false);
  auditAs(actor, { action: `Connector run ${run.status.toLowerCase()}`, entityType: "Connector", entityId: c.id, after: `${run.id} · ${run.records} records${run.message ? ` · ${run.message}` : ""}` });
  if (failed) {
    publish("connectors.run.failed", { module: M, subject: subject(c), payload: { runId: run.id, message: run.message } });
    notify({ templateId: "connectors.run-failed", toRoles: ["it-support", "system-admin"], href: "/connectors/runs", data: { connector: c.name, runId: run.id, message: run.message ?? "—", at: dateTime(at), consumers: c.consumers.join(" · ") } });
  } else publish("connectors.run.completed", { module: M, subject: subject(c), payload: { runId: run.id, records: run.records, status: run.status } });
  await runHooks("connectors.run.after", { connector: c, run, actor });
  return { ok: true, run };
}

/** Request a schedule / enable change — applied only after approval in Operations. */
export async function requestConfigChange(c: Connector, current: { schedule: string; enabled: boolean }, next: { schedule: string; enabled: boolean }): Promise<Result<{ operationId: string; applied: boolean }>> {
  if (current.schedule === next.schedule && current.enabled === next.enabled) return { ok: false, reason: "Nothing changed." };
  const actor = currentActor();
  const hook = await runHooks("connectors.config.change.before", { connector: c, current, next, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const n = hook.ctx.next;
  const res = await submitOperation<ConfigChangePayload>("connectors.config.change", {
    title: `${c.name}: ${describe(current.schedule, current.enabled)} → ${describe(n.schedule, n.enabled)}`,
    subject: subject(c),
    payload: { connectorId: c.id, schedule: n.schedule, enabled: n.enabled, before: current },
    summary: [
      { label: "Connector", value: c.name },
      { label: "Current", value: describe(current.schedule, current.enabled) },
      { label: "Proposed", value: describe(n.schedule, n.enabled) },
    ],
  });
  if (!res.ok) return res;
  if (!res.applied) {
    auditAs(actor, { action: "Requested connector configuration change", entityType: "Connector", entityId: c.id, before: describe(current.schedule, current.enabled), after: `${describe(n.schedule, n.enabled)} · ${res.instance.id}` });
    publish("connectors.config.requested", { module: M, subject: subject(c), payload: { operationId: res.instance.id, ...n } });
  }
  return { ok: true, operationId: res.instance.id, applied: res.applied };
}

/** Operations `apply` — the configuration change was approved. */
export async function applyConfigChange(p: ConfigChangePayload, actor: Actor, operationId: string) {
  const c = connectors.find((x) => x.id === p.connectorId);
  if (!c) return;
  useConnectors.getState().setOverride(c.id, { schedule: p.schedule, enabled: p.enabled });
  const before = describe(p.before.schedule, p.before.enabled);
  const after = describe(p.schedule, p.enabled);
  auditAs(actor, { action: "Changed connector configuration (approved)", entityType: "Connector", entityId: c.id, before, after: `${after} · ${operationId}` });
  publish("connectors.config.changed", { module: M, subject: subject(c), payload: { operationId, before: p.before, after: { schedule: p.schedule, enabled: p.enabled } } });
  notify({ templateId: "connectors.config-changed", toRoles: ["it-support", "system-admin"], href: "/connectors", data: { connector: c.name, before, after, approvedBy: actor.name } });
  await runHooks("connectors.config.change.after", { connector: c, payload: p, actor });
}
