"use client";

/**
 * Platform registrations for the AI analytics module (PRD §6.12–6.13): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md →
 * Platform services. Rule values are read at call time (never at module load).
 */
import { useDb } from "@/lib/data/store";
import { defineEvents, publish } from "@/lib/platform/events";
import { defineHookPoints, registerHook, runHooks } from "@/lib/platform/hooks";
import { defineTemplates, notify } from "@/lib/platform/notifications";
import { registerOperation, submitOperation, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, getRule } from "@/lib/platform/rules";
import type { Actor } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { logAudit } from "../operational-risk/shared";
import { useAi, type SavedQuery } from "./store";

export const AI = "ai";
const DEMO = "Tenant parameter (demo value)";

export type QueryScope = "full" | "platform";

export const aiKeys = {
  fullScopeRoles: "ai.console.fullScopeRoles",
  platformScopeRoles: "ai.console.platformScopeRoles",
  modelVersion: "ai.console.modelVersion",
  trendModel: "ai.model.trendAnalyser",
  narrativeModel: "ai.model.narrative",
  queryLogMax: "ai.queryLog.maxEntries",
  conversationMax: "ai.conversation.maxExchanges",
  minQuestionLength: "ai.query.minQuestionLength",
  defaultTopN: "ai.query.defaultTopN",
  maxTopN: "ai.query.maxTopN",
  nearBreachPct: "ai.query.nearBreachPct",
  cadences: "ai.schedule.cadences",
} as const;

defineRules([
  { key: aiKeys.fullScopeRoles, label: "Query console — full-scope roles", description: "Roles with natural-language access to the whole Risk Data Spine.", module: AI, category: "Query console access", type: "roles", default: ["cro", "head-of-risk"], source: "PRD §6.13" },
  { key: aiKeys.platformScopeRoles, label: "Query console — platform-scope roles", description: "Roles limited to platform-health and configuration data (no customer-identifiable financial data).", module: AI, category: "Query console access", type: "roles", default: ["system-admin", "it-support"], source: "PRD §6.13" },
  { key: aiKeys.modelVersion, label: "Query model version label", description: "Model version shown on every console answer and written to the audit trail.", module: AI, category: "Models", type: "text", default: "SER-NLQ 0.9 (simulated, rules-based)", source: "PRD §6.12 (model version labelled) — demo value" },
  { key: aiKeys.trendModel, label: "Trend analyser model label", description: "Model that drafts KRI trend & correlation commentary.", module: AI, category: "Models", type: "text", default: "SER Trend Analyser v2.3 (simulated)", source: DEMO },
  { key: aiKeys.narrativeModel, label: "Narrative model label", description: "Model that drafts report narratives (e.g. BRC executive summary).", module: AI, category: "Models", type: "text", default: "SER Narrative v1.4 (simulated)", source: DEMO },
  { key: aiKeys.queryLogMax, label: "Query log size (browser)", description: "Query records kept in the console's local log. The audit trail keeps every query.", module: AI, category: "Query console", type: "number", default: 200, min: 10, max: 5000, source: DEMO, requiresApproval: false },
  { key: aiKeys.conversationMax, label: "Conversation length", description: "Exchanges shown in the current conversation.", module: AI, category: "Query console", type: "number", default: 8, min: 1, max: 50, source: DEMO, requiresApproval: false },
  { key: aiKeys.minQuestionLength, label: "Minimum question length", description: "Characters needed before a question is resolved.", module: AI, category: "Query console", type: "number", default: 3, min: 1, max: 50, source: DEMO, requiresApproval: false },
  { key: aiKeys.defaultTopN, label: "Default “top N”", description: "Rows returned for ranking questions that don't name a number.", module: AI, category: "Query console", type: "number", default: 10, min: 1, max: 100, source: DEMO, requiresApproval: false },
  { key: aiKeys.maxTopN, label: "Maximum “top N”", description: "Largest ranking a question may ask for.", module: AI, category: "Query console", type: "number", default: 50, min: 1, max: 500, source: DEMO, requiresApproval: false },
  { key: aiKeys.nearBreachPct, label: "Near-breach band", description: "Share of an internal limit from which a sector is reported as a near-breach.", module: AI, category: "Query console", type: "percent", default: 90, min: 1, max: 100, unit: "%", source: DEMO },
  { key: aiKeys.cadences, label: "Scheduled report cadences", description: "Cadences offered when saving a query as a scheduled report.", module: AI, category: "Scheduled reports", type: "list", default: ["Daily", "Weekly", "Monthly"], source: DEMO },
]);

/** Console scope for a role from the access rules (undefined = no console access). */
export function consoleScopeFor(roleId: RoleId | null | undefined): QueryScope | undefined {
  if (!roleId) return undefined;
  if (getRule<RoleId[]>(aiKeys.fullScopeRoles).includes(roleId)) return "full";
  if (getRule<RoleId[]>(aiKeys.platformScopeRoles).includes(roleId)) return "platform";
  return undefined;
}

/** Intents a platform-scope user may resolve. */
export const PLATFORM_INTENTS = ["users", "audit", "connectors"] as const;

// ---------------------------------------------------------------- operations
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });

export type AiSignOffPayload = { activityId: string; item: string; module: string; href: string; decision: "Signed off" | "Rejected"; accountable: RoleId; text?: string; comment?: string };
registerOperation<AiSignOffPayload>({
  type: "ai.output.sign-off",
  name: "AI output sign-off",
  module: AI,
  description:
    "The accountable role's sign-off (or rejection) of an AI-drafted / AI-flagged output before it has any workflow effect (PRD §6.12). Default: the accountable person's decision is final (no extra steps); add a checker step here if the tenant wants four eyes.",
  defaultSteps: [],
  apply: (p, { actor }) => {
    useAi.getState().signOff(p.activityId, { status: p.decision, by: actor.name, at: new Date().toISOString() });
    logAudit(p.decision === "Signed off" ? "Signed off AI output" : "Rejected AI output", "AI output", p.activityId, "Pending sign-off", p.decision);
    publish(p.decision === "Signed off" ? "ai.output.signed-off" : "ai.output.rejected", { module: AI, subject: { type: "AiOutput", id: p.activityId, title: p.item, href: p.href }, payload: { activityId: p.activityId, text: p.text, module: p.module } });
  },
});

registerOperation<SavedQuery>({
  type: "ai.schedule.create",
  name: "Scheduled AI report",
  module: AI,
  description: "Save a console query as a recurring report to named recipients. Distribution of risk data needs Head of Risk / CRO approval.",
  defaultSteps: [step("approve", "Data-distribution approval", ["head-of-risk", "cro"], 24)],
  apply: (q) => {
    useAi.getState().saveQuery(q);
    logAudit("Created scheduled AI report (approved)", "AI query schedule", q.id, undefined, `${q.cadence} · ${q.question} · to ${q.recipients}`);
    publish("ai.schedule.created", { module: AI, subject: { type: "AiSchedule", id: q.id, title: q.question, href: "/ai/log" }, payload: { cadence: q.cadence, recipients: q.recipients } });
    const emails = q.recipients.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const toUserIds = useDb.getState().users.filter((u) => emails.includes(u.email.toLowerCase())).map((u) => u.id);
    if (toUserIds.length) notify({ templateId: "ai.schedule-subscribed", toUserIds, href: "/ai/log", data: { question: q.question, cadence: q.cadence, createdBy: q.createdBy } });
  },
});

/** Record an AI output sign-off / rejection through Operations, with hook points. */
export async function submitAiSignOff(p: AiSignOffPayload) {
  const before = await runHooks("ai.output.sign-off.before", p);
  if (!before.ok) return { ok: false as const, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` };
  const result = await submitOperation<AiSignOffPayload>("ai.output.sign-off", {
    title: `${p.decision === "Signed off" ? "Sign off" : "Reject"} AI output: ${p.item}`,
    subject: { type: "AiOutput", id: p.activityId, title: p.item, href: p.href },
    payload: before.ctx,
    summary: [
      { label: "AI output", value: p.item },
      { label: "Module", value: p.module },
      { label: "Decision", value: p.decision },
    ],
  });
  await runHooks("ai.output.sign-off.after", { ...before.ctx, result });
  return result;
}

// ---------------------------------------------------------------- notifications
defineTemplates([
  {
    id: "ai.schedule-subscribed",
    name: "Scheduled AI report subscription",
    module: AI,
    trigger: "ai.schedule.created",
    subject: "You'll receive a {{cadence}} AI report",
    inApp: "{{createdBy}} added you to a {{cadence}} report: “{{question}}”.",
    body: "<p><strong>{{createdBy}}</strong> scheduled a <strong>{{cadence}}</strong> AI-generated report and named you as a recipient.</p><ul><li>Question: {{question}}</li></ul><p>Answers are AI-generated from live data, labelled with sources and model version. Verify before relying on them.</p>",
    tone: "info",
    variables: [
      { name: "question", description: "Saved question", example: "Which KRIs are Red or Amber?" },
      { name: "cadence", description: "Daily / Weekly / Monthly", example: "Weekly" },
      { name: "createdBy", description: "Who scheduled it", example: "Chinedu Okafor" },
    ],
  },
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "ai.query.answered", module: AI, description: "A console question was answered.", payloadExample: { intent: "kri", touched: "16 KRIs" } },
  { name: "ai.query.refused", module: AI, description: "A console question was refused (out of scope or vetoed by a hook)." },
  { name: "ai.query.unmatched", module: AI, description: "A console question couldn't be mapped to the data dictionary." },
  { name: "ai.output.signed-off", module: AI, description: "An AI-drafted / AI-flagged output was signed off by the accountable role.", payloadExample: { activityId: "AIA-KRI-COMMENTARY" } },
  { name: "ai.output.rejected", module: AI, description: "An AI output was rejected by the accountable role." },
  { name: "ai.schedule.created", module: AI, description: "A scheduled AI report was created (after approval)." },
  { name: "ai.schedule.removed", module: AI, description: "A scheduled AI report was removed." },
]);

export type AiQueryHookCtx = { question: string; intent: string | null; scope: QueryScope; actor: Pick<Actor, "id" | "name" | "roleId"> };

defineHookPoints([
  { point: "ai.query.before", module: AI, kind: "before", description: "Before a console question is resolved. Veto to refuse it (e.g. data-scope or PII policy), or enrich/rewrite the question." },
  { point: "ai.query.after", module: AI, kind: "after", description: "After a question is answered/refused and logged (e.g. usage analytics, DLP review)." },
  { point: "ai.output.sign-off.before", module: AI, kind: "before", description: "Before an AI output sign-off is submitted. Veto to block." },
  { point: "ai.output.sign-off.after", module: AI, kind: "after", description: "After an AI output sign-off was submitted." },
]);

/** Built-in data-scope guard (PRD §6.13). The resolver also enforces scope as defence in depth. */
registerHook<AiQueryHookCtx>({
  id: "ai.scope-guard",
  name: "Data-scope enforcement (§6.13)",
  point: "ai.query.before",
  priority: 10,
  run: (ctx) => {
    if (ctx.scope === "platform" && ctx.intent && !(PLATFORM_INTENTS as readonly string[]).includes(ctx.intent))
      return { veto: "Your query scope is limited to platform-health and configuration data. Customer-identifiable and financial risk data needs a separate entitlement (PRD §6.13)." };
  },
});
