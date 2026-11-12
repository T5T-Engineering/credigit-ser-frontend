"use client";

/**
 * Platform registrations for the workspace module (dashboard, My tasks): business rules, events and hook
 * points. Workspace has no approvals of its own — approvals awaiting the user come from Operations.
 * See docs/FRONTEND-CONVENTIONS.md → Platform services.
 */
import { defineEvents } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineRules } from "@/lib/platform/rules";

const DEMO = "Tenant parameter";

defineRules([
  { key: "workspace.nearLimitPct", label: "Near-limit warning from", description: "A sector counts as 'near limit' once its share reaches this % of its limit (e.g. 90% = within 10% of the limit).", module: "workspace", category: "Dashboard", type: "percent", default: 90, min: 50, max: 100, source: DEMO },
  { key: "workspace.slaDueSoonDays", label: "SLA 'due soon' window", description: "Applications whose SLA falls within this many days count as due soon on the dashboard.", module: "workspace", category: "Dashboard", type: "number", unit: "days", default: 2, min: 1, max: 30, source: DEMO },
  { key: "workspace.taskDueSoonDays", label: "Task 'due soon' window", description: "Tasks due within this many days are highlighted in My tasks.", module: "workspace", category: "My tasks", type: "number", unit: "days", default: 1, min: 1, max: 30, source: DEMO },
  { key: "workspace.highPriorityAmountNgn", label: "High-priority approval amount", description: "Approvals above this amount are shown as High priority in My tasks.", module: "workspace", category: "My tasks", type: "money", default: 1_000_000_000, min: 0, source: DEMO },
  { key: "workspace.stalledStageDays", label: "Stalled workflow after", description: "AI flag: applications not updated for this many days in an active stage.", module: "workspace", category: "AI flags", type: "number", unit: "days", default: 7, min: 1, max: 90, source: DEMO },
  { key: "workspace.inflowShortfallRatio", label: "Inflow shortfall ratio", description: "AI flag: verified ÷ declared turnover (COP ratio) below this value.", module: "workspace", category: "AI flags", type: "number", default: 0.6, min: 0.1, max: 1, step: 0.05, source: `(inflow monitoring) — ${DEMO}` },
  { key: "workspace.nplAlertPct", label: "NPL ratio alert above", description: "The dashboard NPL tile turns red above this ratio.", module: "workspace", category: "Dashboard", type: "percent", default: 5, min: 0, max: 100, step: 0.1, source: DEMO },
  { key: "workspace.decisionsWindowDays", label: "'My decisions' window", description: "Days of approval decisions counted on the dashboard.", module: "workspace", category: "Dashboard", type: "number", unit: "days", default: 30, min: 1, max: 365, source: DEMO },
  { key: "workspace.activityWindowHours", label: "Audit activity window", description: "Hours of audit events counted on the admin dashboard tile.", module: "workspace", category: "Dashboard", type: "number", unit: "hours", default: 24, min: 1, max: 720, source: DEMO },
]);

defineEvents([
  { name: "workspace.task.completed", module: "workspace", description: "A user marked a task done in My tasks.", payloadExample: { taskId: "TSK-0001" } },
  { name: "workspace.task.reopened", module: "workspace", description: "A user reopened a completed task." },
  { name: "workspace.ai-flag.signed-off", module: "workspace", description: "A user signed off an AI-flagged exception on the dashboard." },
  { name: "workspace.ai-flag.dismissed", module: "workspace", description: "A user dismissed an AI-flagged exception on the dashboard." },
]);

defineHookPoints([
  { point: "workspace.task.update.before", module: "workspace", kind: "before", description: "Before a task is marked done / reopened. Veto to block (e.g. evidence required)." },
  { point: "workspace.task.update.after", module: "workspace", kind: "after", description: "After a task status changed." },
  { point: "workspace.ai-flag.review.before", module: "workspace", kind: "before", description: "Before an AI flag is signed off or dismissed. Veto to block." },
  { point: "workspace.ai-flag.review.after", module: "workspace", kind: "after", description: "After an AI flag was signed off or dismissed." },
]);
