"use client";

/**
 * Core platform registrations: rules, operation types, notification templates, events and hook points that
 * belong to the platform itself (sessions, auth, RBAC limits, Operations). Modules register their own in
 * src/modules/<module>/platform.ts.
 */
import { roles, type RoleId } from "../rbac/roles";
import { decideAccessRequest } from "../auth/accounts";
import { defineEvents, publish } from "./events";
import { defineHookPoints } from "./hooks";
import { defineTemplates, notify, useNotificationStore, type NotificationTemplate } from "./notifications";
import { registerOperation, saveDefinition, submitOperation, type WorkflowDefinition, type WorkflowStep } from "./operations";
import { applyRuleValue, defineRules, getRule, ruleDefinition, validateRuleValue, type RuleValue } from "./rules";

const DEMO = "Tenant parameter (demo value)";

// ---------------------------------------------------------------- business rules
defineRules([
  { key: "session.idleTimeoutMinutes", label: "Idle session timeout", description: "Sign users out after this much inactivity.", module: "platform", category: "Sessions", type: "duration", durationUnit: "minutes", default: 15, min: 1, max: 240, source: "PRD §4.2 (configurable per role) — demo default" },
  { key: "session.warningSeconds", label: "Timeout warning", description: "Seconds of warning before an idle sign-out.", module: "platform", category: "Sessions", type: "number", unit: "seconds", default: 60, min: 10, max: 600, source: DEMO },
  { key: "auth.otpTtlMinutes", label: "One-time code lifetime", description: "Minutes before a sign-in, registration or reset code expires.", module: "platform", category: "Authentication", type: "duration", durationUnit: "minutes", default: 10, min: 1, max: 60, source: DEMO },
  { key: "auth.otpMaxAttempts", label: "One-time code attempts", description: "Wrong codes allowed before a new code is needed.", module: "platform", category: "Authentication", type: "number", default: 5, min: 1, max: 10, source: DEMO },
  { key: "auth.passwordMaxAttempts", label: "Password attempts before lockout", description: "Consecutive wrong passwords before the account locks.", module: "platform", category: "Authentication", type: "number", default: 5, min: 3, max: 10, source: DEMO },
  { key: "auth.passwordMinLength", label: "Minimum password length", description: "Characters required in a new password.", module: "platform", category: "Authentication", type: "number", default: 12, min: 8, max: 64, source: DEMO },
  { key: "auth.passwordRequireMixed", label: "Require mixed character types", description: "New passwords need upper case, lower case, a number and a symbol.", module: "platform", category: "Authentication", type: "boolean", default: true, source: DEMO },
  { key: "approvals.stepUpThresholdNgn", label: "Step-up authentication threshold", description: "Approvals above this amount need re-authentication (OTP / transaction PIN).", module: "platform", category: "Approvals", type: "money", default: 100_000_000, min: 0, source: "PRD §4.2 — tenant-configurable high-value threshold (demo value)" },
  { key: "operations.minCommentLength", label: "Minimum decision comment", description: "Characters required when rejecting or returning an operation.", module: "operations", category: "Workflow", type: "number", default: 10, min: 0, max: 500, source: DEMO },
  { key: "operations.commentAlwaysRequired", label: "Comment required on approval too", description: "Approvers must also comment when approving.", module: "operations", category: "Workflow", type: "boolean", default: false, source: DEMO },
  { key: "operations.defaultSlaHours", label: "Default step SLA", description: "SLA used for new workflow steps.", module: "operations", category: "Workflow", type: "duration", durationUnit: "hours", default: 24, min: 1, max: 720, source: DEMO },
  { key: "platform.shareholdersFundsNgn", label: "Shareholders' funds (unimpaired)", description: "Base for single-obligor (20%) and large-exposure (10%) limits.", module: "platform", category: "Capital", type: "money", default: 60_000_000_000, min: 1, source: "PRD §6.6.2 / §8 — value from GL capital accounts (demo value)" },
  { key: "rar.midpoint", label: "360 RAR posture midpoint", description: "Composite midpoint separating postures on the 1–10 scale.", module: "credit-analysis", category: "360 RAR", type: "number", default: 5.5, min: 1, max: 10, step: 0.1, source: "PRD §6.2.5" },
  { key: "rar.neutralBelow", label: "Neutral / Transitional below", description: "Magnitude below which the obligor is Neutral/Transitional.", module: "credit-analysis", category: "360 RAR", type: "number", default: 0.4, min: 0, max: 5, step: 0.05, source: "PRD §6.2.5 — tenant threshold (demo value)" },
  { key: "rar.marginalBelow", label: "Marginal below", description: "Magnitude below which a posture is Marginal.", module: "credit-analysis", category: "360 RAR", type: "number", default: 1.2, min: 0, max: 6, step: 0.05, source: "PRD §6.2.5 — tenant threshold (demo value)" },
  { key: "rar.moderateBelow", label: "Moderate below (else Strong)", description: "Magnitude below which a posture is Moderate; at or above is Strong.", module: "credit-analysis", category: "360 RAR", type: "number", default: 2.4, min: 0, max: 7, step: 0.05, source: "PRD §6.2.5 — tenant threshold (demo value)" },
  ...roles
    .filter((r) => r.limitNgn !== null && Number.isFinite(r.limitNgn))
    .map((r) => ({
      key: `rbac.limit.${r.id}`,
      label: `Sign-on limit — ${r.name}`,
      description: `${r.authority}.`,
      module: "platform",
      category: "Sign-on limits",
      type: "money" as const,
      default: r.limitNgn as number,
      min: 0,
      source: "PRD §4.1–4.2 — tenant configuration (illustrative value)",
    })),
]);

/** Sign-on limit for a role from business rules (null = none, Infinity = apex). */
export function roleLimit(roleId: RoleId): number | null {
  const role = roles.find((r) => r.id === roleId);
  if (!role || role.limitNgn === null) return null;
  if (!Number.isFinite(role.limitNgn)) return Number.POSITIVE_INFINITY;
  return getRule<number>(`rbac.limit.${roleId}`);
}

// ---------------------------------------------------------------- operations
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number, mode: "any" | "all" = "any", adjudicatorRole?: RoleId): WorkflowStep => ({ id, name, approverRoles, mode, slaHours, adjudicatorRole });

type RuleChangePayload = { key: string; value: RuleValue; reason: string };
registerOperation<RuleChangePayload>({
  type: "rule.change",
  name: "Business rule change",
  module: "operations",
  description: "Change a business rule / tenant parameter. Second-person approval (PRD §10.4 configurability with control).",
  defaultSteps: [step("review", "Risk review", ["head-of-risk", "cro"], 24), step("confirm", "Confirmation (System Admin or CRO)", ["system-admin", "cro"], 24)],
  apply: (p, { instance, actor }) => {
    const def = ruleDefinition(p.key);
    const before = getRule(p.key);
    applyRuleValue(p.key, p.value, { id: actor.id, name: actor.name }, { reason: p.reason, operationId: instance.id });
    publish("rules.rule.changed", { module: "operations", subject: { type: "Rule", id: p.key, title: def?.label, href: `/operations/rules?key=${encodeURIComponent(p.key)}` }, payload: { before, after: p.value } });
    notify({ templateId: "rules.changed", toRoles: ["system-admin", "head-of-risk", "cro"], href: `/operations/rules?key=${encodeURIComponent(p.key)}`, data: { label: def?.label ?? p.key, before: String(before), after: String(p.value), reason: p.reason } });
  },
});

type AccessPayload = { email: string; name: string; roleId: RoleId };
registerOperation<AccessPayload>({
  type: "access.request",
  name: "Access request",
  module: "platform",
  description: "A person who registered and verified their email asks for access (PRD §4: admin-controlled named users).",
  defaultSteps: [step("approve", "System Admin approval", ["system-admin"], 48)],
  apply: (p) => decideAccessRequest(p.email, "approve", p.roleId),
  onReject: (p) => decideAccessRequest(p.email, "reject"),
});

registerOperation<WorkflowDefinition>({
  type: "workflow.change",
  name: "Workflow definition change",
  module: "operations",
  description: "Change the approval steps, approvers or SLAs of an operation type.",
  defaultSteps: [step("review", "Head of Risk / CRO review", ["head-of-risk", "cro"], 48)],
  apply: (def) => {
    saveDefinition(def);
    publish("operations.workflow.changed", { module: "operations", subject: { type: "WorkflowDefinition", id: def.operationType, title: def.name, href: "/operations/workflows" }, payload: { version: def.version, steps: def.steps.length, enabled: def.enabled } });
    notify({ templateId: "operations.workflow-changed", toRoles: ["system-admin", "head-of-risk", "cro"], href: "/operations/workflows", data: { name: def.name, version: def.version, steps: def.steps.length } });
  },
});

type TemplatePayload = { id: string; subject: string; body: string; inApp: string };
registerOperation<TemplatePayload>({
  type: "template.change",
  name: "Notification template change",
  module: "operations",
  description: "Change the wording of a notification template.",
  defaultSteps: [step("review", "Compliance / risk review", ["head-of-risk", "cro"], 48)],
  apply: (t) => {
    useNotificationStore.setState((s) => ({ overrides: { ...s.overrides, [t.id]: { subject: t.subject, body: t.body, inApp: t.inApp } } }));
    publish("operations.template.changed", { module: "operations", subject: { type: "NotificationTemplate", id: t.id, href: "/operations/notifications" }, payload: {} });
    notify({ templateId: "operations.template-changed", toRoles: ["system-admin", "head-of-risk"], href: "/operations/notifications", data: { id: t.id } });
  },
});

/** Request a rule change through Operations. Validates the value first. */
export async function requestRuleChange(key: string, value: RuleValue, reason: string) {
  const def = ruleDefinition(key);
  if (!def) return { ok: false as const, reason: `Unknown rule "${key}".` };
  const error = validateRuleValue(def, value);
  if (error) return { ok: false as const, reason: error };
  const before = getRule(key);
  return submitOperation<RuleChangePayload>("rule.change", {
    title: `${def.label}: ${String(before)} → ${String(value)}`,
    subject: { type: "Rule", id: key, title: def.label, href: `/operations/rules?key=${encodeURIComponent(key)}` },
    payload: { key, value, reason },
    summary: [
      { label: "Rule", value: def.label },
      { label: "Current", value: String(before) },
      { label: "Proposed", value: String(value) },
      { label: "Reason", value: reason },
    ],
  });
}

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "operations.approval-requested",
    name: "Approval requested",
    module: "operations",
    trigger: "operations.request.submitted / next step reached",
    subject: "Approval needed: {{title}}",
    inApp: "{{requester}} needs your decision on {{operation}} — step “{{step}}”.",
    body: "<p><strong>{{requester}}</strong> has asked for approval.</p><ul><li>Operation: {{operation}}</li><li>Your step: {{step}}</li><li>Due by: {{due}}</li></ul><p>Review the details and record your decision.</p>",
    tone: "info",
    variables: [
      { name: "title", description: "Operation title", example: "Step-up threshold: 100000000 → 150000000" },
      { name: "operation", description: "Operation type name", example: "Business rule change" },
      { name: "requester", description: "Who requested it", example: "Adegoke Agnes" },
      { name: "step", description: "Current step", example: "Risk review" },
      { name: "due", description: "SLA due time", example: "Tue, 11 Nov 2026 09:00:00 GMT" },
    ],
  }),
  tpl({
    id: "operations.request-completed",
    name: "Request decided",
    module: "operations",
    trigger: "operations.request.approved / rejected / returned / cancelled",
    subject: "Your request was {{outcome}}: {{title}}",
    inApp: "{{operation}} was {{outcome}} by {{decidedBy}}.",
    body: "<p>Your request <strong>{{title}}</strong> was <strong>{{outcome}}</strong> by {{decidedBy}}.</p><p>{{reason}}</p>",
    tone: "success",
    variables: [
      { name: "title", description: "Operation title", example: "Waiver of quarterly accounts covenant" },
      { name: "operation", description: "Operation type name", example: "Waiver request" },
      { name: "outcome", description: "approved / rejected / returned / cancelled", example: "approved" },
      { name: "decidedBy", description: "Decision maker", example: "Chinedu Okafor" },
      { name: "reason", description: "Decision comment", example: "Within delegated tolerance." },
    ],
  }),
  tpl({
    id: "operations.workflow-changed",
    name: "Workflow changed",
    module: "operations",
    trigger: "operations.workflow.changed",
    subject: "Workflow updated: {{name}} (v{{version}})",
    inApp: "{{name}} now has {{steps}} approval step(s) (version {{version}}).",
    body: "<p>The approval workflow <strong>{{name}}</strong> was updated to version {{version}} with {{steps}} step(s).</p><p>New requests follow the updated steps; requests already in progress keep their original route.</p>",
    tone: "info",
    variables: [
      { name: "name", description: "Workflow name", example: "Waiver request" },
      { name: "version", description: "New version", example: "2" },
      { name: "steps", description: "Number of steps", example: "2" },
    ],
  }),
  tpl({
    id: "operations.template-changed",
    name: "Notification template changed",
    module: "operations",
    trigger: "operations.template.changed",
    subject: "Notification template updated: {{id}}",
    inApp: "The wording of notification template {{id}} was updated.",
    body: "<p>The notification template <strong>{{id}}</strong> was updated after approval.</p>",
    tone: "info",
    variables: [{ name: "id", description: "Template id", example: "operations.approval-requested" }],
  }),
  tpl({
    id: "auth.access-requested",
    name: "New access request",
    module: "platform",
    trigger: "auth.access.requested",
    subject: "Access request from {{name}}",
    inApp: "{{name}} ({{email}}) requested access as {{role}}.",
    body: "<p><strong>{{name}}</strong> ({{email}}) at {{institution}}, {{branch}} has verified their email and requested access as <strong>{{role}}</strong>.</p><p>Approve or reject the request and confirm the role.</p>",
    tone: "info",
    variables: [
      { name: "name", description: "Applicant name", example: "Ada Obi" },
      { name: "email", description: "Work email", example: "ada.obi@bank.ng" },
      { name: "institution", description: "Institution", example: "Harbourline Bank" },
      { name: "branch", description: "Branch", example: "Ikeja" },
      { name: "role", description: "Requested role", example: "Credit Analyst" },
    ],
  }),
  tpl({
    id: "auth.password-changed",
    name: "Password changed",
    module: "platform",
    trigger: "auth.password.changed / auth.password.reset",
    subject: "Your password was changed",
    inApp: "Your password was changed. If this wasn't you, contact your System Admin now.",
    body: "<p>The password for <strong>{{email}}</strong> was changed on {{when}}.</p><p>If you didn't do this, contact your System Admin immediately.</p>",
    tone: "warning",
    variables: [
      { name: "email", description: "Account email", example: "ada.obi@bank.ng" },
      { name: "when", description: "Date and time", example: "10 Nov 2026, 14:05" },
    ],
  }),
  tpl({
    id: "rules.changed",
    name: "Business rule changed",
    module: "operations",
    trigger: "rules.rule.changed",
    subject: "Rule updated: {{label}}",
    inApp: "{{label}} changed from {{before}} to {{after}}.",
    body: "<p><strong>{{label}}</strong> changed from {{before}} to <strong>{{after}}</strong>.</p><p>Reason: {{reason}}</p>",
    tone: "info",
    variables: [
      { name: "label", description: "Rule name", example: "Step-up authentication threshold" },
      { name: "before", description: "Previous value", example: "100000000" },
      { name: "after", description: "New value", example: "150000000" },
      { name: "reason", description: "Change reason", example: "Board-approved policy update" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "operations.request.submitted", module: "operations", description: "An operation was submitted for approval." },
  { name: "operations.step.decided", module: "operations", description: "An approver recorded a decision on a step." },
  { name: "operations.step.dissent", module: "operations", description: "Co-signers split; the step awaits its adjudicator." },
  { name: "operations.request.approved", module: "operations", description: "An operation was fully approved and applied." },
  { name: "operations.request.rejected", module: "operations", description: "An operation was rejected." },
  { name: "operations.request.returned", module: "operations", description: "An operation was returned to the requester." },
  { name: "operations.request.cancelled", module: "operations", description: "The requester withdrew an operation." },
  { name: "operations.workflow.changed", module: "operations", description: "An approved workflow definition change was applied." },
  { name: "operations.template.changed", module: "operations", description: "An approved notification template change was applied." },
  { name: "rules.rule.changed", module: "operations", description: "A business rule value changed (after approval)." },
  { name: "platform.notification.sent", module: "platform", description: "A notification was sent (in-app + email outbox)." },
  { name: "auth.access.requested", module: "platform", description: "A person verified their email and requested access." },
  { name: "auth.password.changed", module: "platform", description: "A user changed or reset their password." },
  { name: "auth.session.started", module: "platform", description: "A user signed in." },
]);

defineHookPoints([
  { point: "operations.submit.before", module: "operations", kind: "before", description: "Before an operation is created. Veto to block it, or enrich the payload." },
  { point: "operations.submit.after", module: "operations", kind: "after", description: "After an operation is created and approvers are notified." },
  { point: "operations.decide.before", module: "operations", kind: "before", description: "Before a decision is recorded. Veto to block (e.g. extra policy checks)." },
  { point: "operations.decide.after", module: "operations", kind: "after", description: "After a decision is recorded." },
]);

export { saveDefinition };
