"use client";

/**
 * Platform registrations for the Operations area (Approvals, My requests, Workflows, Business rules,
 * Notifications, Events & hooks): business rules, the "extension.toggle" operation type, notification
 * templates, events, hook points and two clearly-labelled EXAMPLE extensions so the console isn't empty.
 * Core operation types (rule.change, workflow.change, template.change) live in src/lib/platform/core.ts.
 */
import { defineEvents, publish, setSubscriptionEnabled, subscribe, type DomainEvent } from "@/lib/platform/events";
import { defineHookPoints, registerHook } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, getRule } from "@/lib/platform/rules";
import { useDb } from "@/lib/data/store";
import type { RoleId } from "@/lib/rbac/roles";

const M = "operations";
const DEMO = "Tenant parameter (demo value)";

// ---------------------------------------------------------------- business rules
defineRules([
  {
    key: "operations.slaWarningHours",
    label: "SLA warning window",
    description: "An approval step turns amber when its SLA is due within this time.",
    module: M,
    category: "Approvals queue",
    type: "duration",
    durationUnit: "hours",
    default: 4,
    min: 1,
    max: 168,
    source: DEMO,
  },
  {
    key: "operations.rulesPageSize",
    label: "Business rules shown per page",
    description: "Rules listed before “Show more” in Operations → Business rules.",
    module: M,
    category: "Display",
    type: "number",
    default: 60,
    min: 10,
    max: 1000,
    source: DEMO,
  },
  {
    key: "operations.testSendRoles",
    label: "Roles allowed to send template tests",
    description: "Roles that may send a test of a notification template to themselves.",
    module: M,
    category: "Notifications",
    type: "roles",
    default: ["system-admin", "cro", "head-of-risk"],
    source: DEMO,
  },
  {
    key: "operations.extensionToggleApproverRoles",
    label: "Extension toggle approvers",
    description: "Roles in the default workflow that approves enabling or disabling an extension (hook or subscriber).",
    module: M,
    category: "Extensions",
    type: "roles",
    default: ["system-admin", "cro"],
    source: DEMO,
  },
  {
    key: "operations.extensionToggleSlaHours",
    label: "Extension toggle SLA",
    description: "SLA of the default extension-toggle approval step.",
    module: M,
    category: "Extensions",
    type: "duration",
    durationUnit: "hours",
    default: 24,
    min: 1,
    max: 720,
    source: DEMO,
  },
  {
    key: "operations.example.largeExposurePct",
    label: "Large-exposure guard — % of shareholders' funds",
    description: "Example extension: operations whose amount reaches this share of shareholders' funds are flagged (never vetoed).",
    module: M,
    category: "Extensions",
    type: "percent",
    unit: "%",
    default: 10,
    min: 0,
    max: 100,
    step: 0.5,
    source: "large exposure at 10% of shareholders' funds",
  },
]);

// ---------------------------------------------------------------- operations
type TogglePayload = { id: string; name: string; kind: "subscription" | "hook"; enabled: boolean; reason: string };

// Default steps come from business rules at call time (getter below), never at module load.
const toggleSteps = (): WorkflowStep[] => [
  {
    id: "approve",
    name: "Platform owner approval",
    approverRoles: getRule<string[]>("operations.extensionToggleApproverRoles") as RoleId[],
    mode: "any",
    slaHours: getRule<number>("operations.extensionToggleSlaHours"),
  },
];

registerOperation<TogglePayload>({
  type: "extension.toggle",
  name: "Extension enable / disable",
  module: M,
  description: "Enable or disable an event subscriber or hook handler (configuration change, second-person approval).",
  get defaultSteps() {
    return toggleSteps();
  },
  apply: (p, { instance, actor }) => {
    setSubscriptionEnabled(p.id, p.enabled);
    const state = p.enabled ? "enabled" : "disabled";
    useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action: `Extension ${state}`, entityType: p.kind === "hook" ? "Hook handler" : "Event subscriber", entityId: p.id, before: p.enabled ? "disabled" : "enabled", after: state });
    publish("operations.extension.toggled", { module: M, subject: { type: "Extension", id: p.id, title: p.name, href: "/operations/events" }, payload: { kind: p.kind, enabled: p.enabled, operationId: instance.id } });
    notify({ templateId: "operations.extension-toggled", toRoles: getRule<string[]>("operations.extensionToggleApproverRoles") as RoleId[], toUserIds: [instance.requestedBy.id], href: "/operations/events", data: { name: p.name, id: p.id, state, by: actor.name, reason: p.reason } });
  },
});

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "operations.extension-toggled",
    name: "Extension enabled / disabled",
    module: M,
    trigger: "operations.extension.toggled",
    subject: "Extension {{state}}: {{name}}",
    inApp: "{{name}} was {{state}} (approved by {{by}}).",
    body: "<p>The extension <strong>{{name}}</strong> (<strong>{{id}}</strong>) was <strong>{{state}}</strong>.</p><ul><li>Approved by: {{by}}</li><li>Reason: {{reason}}</li></ul><p>Review the Events &amp; hooks console if this was unexpected.</p>",
    tone: "warning",
    variables: [
      { name: "name", description: "Extension name", example: "Audit mirror (example)" },
      { name: "id", description: "Subscriber / hook id", example: "example.audit-mirror" },
      { name: "state", description: "enabled / disabled", example: "disabled" },
      { name: "by", description: "Approver", example: "Chinedu Okafor" },
      { name: "reason", description: "Change reason", example: "Noisy during month-end close" },
    ],
  }),
  tpl({
    id: "operations.sla-overdue",
    name: "Approval overdue",
    module: M,
    trigger: "operations.sla.breached (approver opens an overdue item)",
    subject: "Overdue approval: {{title}}",
    inApp: "{{title}} is overdue at step “{{step}}” (due {{due}}).",
    body: "<p>The approval <strong>{{title}}</strong> is past its SLA.</p><ul><li>Step: {{step}}</li><li>Was due: {{due}}</li><li>Requested by: {{requester}}</li></ul><p>Record a decision or return the request.</p>",
    tone: "danger",
    variables: [
      { name: "title", description: "Operation title", example: "Step-up threshold: 100000000 → 150000000" },
      { name: "step", description: "Current step", example: "Risk review" },
      { name: "due", description: "SLA due time", example: "Tue, 11 Nov 2026 09:00:00 GMT" },
      { name: "requester", description: "Requester", example: "Adegoke Agnes" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hook points
defineEvents([
  { name: "operations.extension.toggled", module: M, description: "An event subscriber or hook handler was enabled or disabled (after approval).", payloadExample: { kind: "hook", enabled: false, operationId: "OPS-123" } },
  { name: "operations.template.tested", module: M, description: "A user sent a test of a notification template to themselves.", payloadExample: { templateId: "operations.approval-requested" } },
  { name: "operations.sla.breached", module: M, description: "An approver opened an operation whose current step is past its SLA (escalation notified once per step).", payloadExample: { stepId: "review", dueAt: "2026-11-10T09:00:00Z" } },
]);

defineHookPoints([
  { point: "operations.extension.toggle.before", module: M, kind: "before", description: "Before an extension toggle request is submitted. Veto to protect critical extensions." },
  { point: "operations.template.test.before", module: M, kind: "before", description: "Before a template test is sent. Enrich the test data or veto." },
]);

// ---------------------------------------------------------------- EXAMPLE extensions (demo only)
/** In-memory mirror of operations events kept by the example subscriber (not persisted). */
export const exampleAuditMirror: { at: string; name: string; subject?: string }[] = [];

subscribe({
  id: "example.audit-mirror",
  name: "EXAMPLE · Audit mirror (operations.*)",
  pattern: "operations.*",
  priority: 200,
  handler: (event: DomainEvent) => {
    exampleAuditMirror.unshift({ at: event.at, name: event.name, subject: event.subject?.id });
    exampleAuditMirror.splice(50);
  },
});

/** Checks recorded by the example large-exposure guard (not persisted). */
export const exampleExposureChecks: { at: string; type: string; amount: number; flagged: boolean }[] = [];

registerHook<{ type: string; payload?: unknown }>({
  id: "example.large-exposure-guard",
  name: "EXAMPLE · Large-exposure guard",
  point: "operations.submit.before",
  priority: 200,
  run: (ctx) => {
    const amount = largestAmount(ctx.payload);
    if (amount === undefined) return;
    const limit = (getRule<number>("platform.shareholdersFundsNgn") * getRule<number>("operations.example.largeExposurePct")) / 100;
    exampleExposureChecks.unshift({ at: new Date().toISOString(), type: ctx.type, amount, flagged: amount >= limit });
    exampleExposureChecks.splice(50);
    // Example only: records the check, never vetoes.
  },
});

/** Largest top-level numeric amount-like field of a payload (keys containing amount / exposure / ngn). */
export function largestAmount(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const values = Object.entries(payload as Record<string, unknown>)
    .filter(([k, v]) => /amount|exposure|ngn/i.test(k) && typeof v === "number" && Number.isFinite(v))
    .map(([, v]) => v as number);
  return values.length ? Math.max(...values) : undefined;
}
