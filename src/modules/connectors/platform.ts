"use client";

/**
 * Platform registrations for the Connectors module (PRD §5, §4.6): business rules, operation types (Operations workflow),
 * notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md → Platform services.
 * Operation handlers load the module service lazily (no static store imports here).
 */
import { defineEvents } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineTemplates } from "@/lib/platform/notifications";
import { registerOperation } from "@/lib/platform/operations";
import { defineRules, type RuleDefinition } from "@/lib/platform/rules";
import { connectors, freshnessRuleKey } from "./data";

const DEMO = "Tenant parameter";
const M = "connectors";

const defaultScheduleOptions = [
  "Every 5 minutes (market hours)",
  "Every 15 minutes + 01:00 batch",
  "Every 30 minutes + on demand before approval",
  "Hourly",
  "Daily 06:00",
  "Daily 07:00 (series on publisher cadence)",
  "Daily 08:00",
  "Daily 02:00",
  "On demand",
  "On demand (origination & renewal)",
  "On upload",
  "Event-driven (queue)",
  "Daily close (Phase 2) · on upload (Phase 1)",
];

// ---------------------------------------------------------------- business rules
defineRules([
  ...connectors.map(
    (c): RuleDefinition => ({
      key: freshnessRuleKey(c.id),
      label: `Freshness SLA — ${c.name}`,
      description: `Maximum minutes since the last successful sync of ${c.name} before its data counts as stale.`,
      module: M,
      category: "Freshness SLAs",
      type: "duration",
      durationUnit: "minutes",
      default: c.defaultFreshnessSlaMin,
      min: 1,
      max: 10_080,
      source: `${DEMO}`,
    }),
  ),
  { key: "connectors.freshness.warnRatio", label: "Freshness warning ratio", description: "Share of the freshness SLA elapsed at which a connector shows a warning.", module: M, category: "Health thresholds", type: "number", step: 0.05, default: 0.75, min: 0.1, max: 1, source: `${DEMO}` },
  { key: "connectors.errorRate.warnPct", label: "Error-rate warning", description: "Error rate (%) above which a connector's error trend shows a warning.", module: M, category: "Health thresholds", type: "percent", unit: "%", default: 1, min: 0, max: 100, step: 0.1, source: DEMO },
  { key: "connectors.errorRate.dangerPct", label: "Error-rate alert", description: "Error rate (%) above which a connector's error trend shows an alert.", module: M, category: "Health thresholds", type: "percent", unit: "%", default: 5, min: 0, max: 100, step: 0.1, source: DEMO },
  { key: "connectors.runHistoryLimit", label: "Run history kept", description: "Manual runs kept in the run history.", module: M, category: "Runs", type: "number", default: 100, min: 10, max: 1000, source: DEMO },
  { key: "connectors.scheduleOptions", label: "Schedule options", description: "Schedules a connector can be configured with.", module: M, category: "Configuration", type: "list", default: defaultScheduleOptions, source: DEMO },
  { key: "connectors.retryPolicy", label: "Retry policy", description: "How failed connector calls are retried.", module: M, category: "Configuration", type: "text", default: "Automatic retry with back-off", source: DEMO },
]);

// ---------------------------------------------------------------- operations (approvals)
const service = () => import("./service");

export type ConfigChangePayload = { connectorId: string; schedule: string; enabled: boolean; before: { schedule: string; enabled: boolean } };

registerOperation<ConfigChangePayload>({
  type: "connectors.config.change",
  name: "Connector configuration change",
  module: M,
  description: "Change a connector's schedule or enable / pause it. Pausing stops scheduled runs and lets downstream data go stale.",
  defaultSteps: [{ id: "approve", name: "Configuration approval", approverRoles: ["system-admin", "it-support"], mode: "any", slaHours: 8 }],
  apply: async (p, { actor, instance }) => (await service()).applyConfigChange(p, actor, instance.id),
});

// ---------------------------------------------------------------- notification templates
defineTemplates([
  {
    id: "connectors.run-failed",
    name: "Connector run failed",
    module: M,
    trigger: "connectors.run.failed",
    subject: "Connector failed: {{connector}}",
    inApp: "{{connector}} run {{runId}} failed — {{message}}.",
    body: "<p>The <strong>{{connector}}</strong> run <strong>{{runId}}</strong> failed at {{at}}.</p><ul><li>Error: {{message}}</li><li>Downstream consumers affected: {{consumers}}</li></ul><p>Investigate the connector and re-run once fixed; affected data will go stale past its freshness SLA.</p>",
    tone: "danger",
    variables: [
      { name: "connector", description: "Connector name", example: "Core Banking Application (CBA)" },
      { name: "runId", description: "Run reference", example: "RUN-M3K2" },
      { name: "message", description: "Error message", example: "401 — authentication rejected" },
      { name: "at", description: "When it failed", example: "10 Nov 2026, 09:14" },
      { name: "consumers", description: "Downstream consumers", example: "Portfolio / MIS · 360 RAR" },
    ],
  },
  {
    id: "connectors.config-changed",
    name: "Connector configuration changed",
    module: M,
    trigger: "connectors.config.changed",
    subject: "Connector configuration changed: {{connector}}",
    inApp: "{{connector}}: {{before}} → {{after}} (approved by {{approvedBy}}).",
    body: "<p>The configuration of <strong>{{connector}}</strong> changed after approval by {{approvedBy}}.</p><ul><li>Before: {{before}}</li><li>After: <strong>{{after}}</strong></li></ul>",
    tone: "info",
    variables: [
      { name: "connector", description: "Connector name", example: "Credit bureau B" },
      { name: "before", description: "Previous schedule / state", example: "Daily 06:00 · enabled" },
      { name: "after", description: "New schedule / state", example: "Hourly · paused" },
      { name: "approvedBy", description: "Approver", example: "Tunde Bello" },
    ],
  },
]);

// ---------------------------------------------------------------- events & hook points
defineEvents([
  { name: "connectors.run.started", module: M, description: "A connector run was triggered manually.", payloadExample: { trigger: "Manual" } },
  { name: "connectors.run.completed", module: M, description: "A connector run completed (success or partial).", payloadExample: { records: 1200, status: "Success" } },
  { name: "connectors.run.failed", module: M, description: "A connector run failed.", payloadExample: { message: "401 — authentication rejected" } },
  { name: "connectors.config.requested", module: M, description: "A connector configuration change was submitted for approval." },
  { name: "connectors.config.changed", module: M, description: "A connector configuration change was approved and applied." },
]);

defineHookPoints([
  { point: "connectors.run.before", module: M, kind: "before", description: "Before a manual connector run. Veto to block it (e.g. change freeze)." },
  { point: "connectors.run.after", module: M, kind: "after", description: "After a connector run finished." },
  { point: "connectors.config.change.before", module: M, kind: "before", description: "Before a configuration change is submitted. Veto or enrich it." },
  { point: "connectors.config.change.after", module: M, kind: "after", description: "After a configuration change is applied." },
]);
