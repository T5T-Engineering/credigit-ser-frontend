"use client";

/**
 * Platform registrations for the Executive module (invariants 8 & 9): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md →
 * Platform services.
 *
 * Approval flows routed through Operations:
 *  - executive.summary.signoff   — AI executive risk summary signed off by the CRO / Head of Risk (§6.12).
 *
 * The Board Risk Committee pack has ONE flow, owned by enterprise-risk (`enterprise-risk.brc-pack.approval`,
 * /enterprise-risk/brc-pack). The former executive pack flow was retired; /executive/board-pack redirects.
 */
import { useDb } from "@/lib/data/store";
import type { RoleId } from "@/lib/rbac/roles";
import { defineEvents, publish } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, getRule, type RuleDefinition } from "@/lib/platform/rules";
import type { Actor } from "@/lib/platform/scope";
import { usePortfolioStore } from "@/modules/portfolio/store";

const MODULE = "executive";
const DEMO = "Tenant parameter";

/** Business-rule keys of the executive module. Market/liquidity/op-risk/collateral thresholds are temporary duplicates (TD-508). */
export const EXEC_RULES = {
  stage2RedPct: "executive.stage2ShareRedPct",
  stage2AmberPct: "executive.stage2ShareAmberPct",
  appetiteAmberPct: "executive.appetiteAmberPct",
  carAmberBufferPp: "executive.carAmberBufferPp",
  ldrMinPct: "executive.ldrMinPct",
  ldrAmberBufferPp: "executive.ldrAmberBufferPp",
  liquidityRatioMinPct: "executive.liquidityRatioMinPct",
  nopLimitPct: "executive.nopLimitPct",
  varLimitNgn: "executive.varLimitNgn",
  opLossAppetitePct: "executive.opLossAppetitePct",
  quotedEquityHaircutPct: "executive.quotedEquityHaircutPct",
  summaryNotifyRoles: "executive.summary.notifyRoles",
} as const;

const pctRule = (key: string, label: string, description: string, category: string, value: number, source: string, extra: Partial<RuleDefinition> = {}): RuleDefinition => ({
  key, label, description, module: MODULE, category, type: "percent", unit: "%", default: value, min: 0, max: 100, step: 0.1, source, ...extra,
});
const R = EXEC_RULES;

// ---------------------------------------------------------------- business rules
defineRules([
  pctRule(R.stage2RedPct, "Stage 2 share of book — appetite", "Stage 2 share at or above this is Red.", "KRI thresholds", 12, "tenant parameter"),
  pctRule(R.stage2AmberPct, "Stage 2 share of book — early warning", "Stage 2 share at or above this (below appetite) is Amber.", "KRI thresholds", 10, "tenant parameter"),
  pctRule(R.appetiteAmberPct, "Early-warning share of appetite", "A KRI at or above this share of its appetite (NPL, op-loss) is Amber.", "KRI thresholds", 80, DEMO),
  { key: R.carAmberBufferPp, label: "CAR early-warning buffer", description: "CAR within this many percentage points above the minimum is Amber.", module: MODULE, category: "KRI thresholds", type: "number", unit: "pp", default: 2.5, min: 0, max: 10, step: 0.1, source: DEMO },
  pctRule(R.ldrMinPct, "Minimum loan-to-deposit ratio", "LDR below this is Red.", "KRI thresholds", 65, "CBN minimum LDR"),
  { key: R.ldrAmberBufferPp, label: "LDR early-warning buffer", description: "LDR within this many percentage points above the minimum is Amber.", module: MODULE, category: "KRI thresholds", type: "number", unit: "pp", default: 3, min: 0, max: 20, step: 0.5, source: DEMO },
  pctRule(R.liquidityRatioMinPct, "Minimum liquidity ratio", "Liquidity ratio below this is Red.", "KRI thresholds", 30, "tenant parameter"),
  pctRule(R.nopLimitPct, "Net open position limit (% of capital)", "NOP / capital above this is a breach.", "KRI thresholds", 20, "tenant parameter"),
  { key: R.varLimitNgn, label: "Trading VaR limit (1-day, 99%)", description: "VaR above this is a breach.", module: MODULE, category: "KRI thresholds", type: "money", default: 600e6, min: 0, source: "tenant parameter" },
  pctRule(R.opLossAppetitePct, "Operational loss appetite (% of gross income)", "Loss rate at or above this is Red.", "KRI thresholds", 0.5, "tenant parameter", { step: 0.01 }),
  pctRule(R.quotedEquityHaircutPct, "Quoted-equity collateral haircut", "Haircut applied to CSCS mark-to-market for share-margin status.", "Collateral", 20, "quoted equity haircut"),
  { key: R.summaryNotifyRoles, label: "Executive summary sign-off — notify roles", description: "Roles notified when the executive summary is signed off.", module: MODULE, category: "Notifications", type: "roles", default: ["cro", "head-of-risk", "md"], source: DEMO },
]);

// ---------------------------------------------------------------- helpers
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });

function audit(actor: Actor, action: string, entityType: string, entityId: string, before?: string, after?: string) {
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType, entityId, before, after });
}

/** The single Board Risk Committee pack flow (enterprise-risk module). */
export const PACK_HREF = "/enterprise-risk/brc-pack";

// ---------------------------------------------------------------- operations
export type SummarySignOffPayload = { key: string; period: string; headline: string };

registerOperation<SummarySignOffPayload>({
  type: "executive.summary.signoff",
  name: "Executive summary sign-off",
  module: MODULE,
  description: "Sign off the AI-drafted executive risk summary before it is used in a Board pack.",
  defaultSteps: [step("signoff", "CRO / Head of Risk sign-off", ["cro", "head-of-risk"], 24)],
  apply: (p, { instance, actor }) => {
    usePortfolioStore.getState().signOff(p.key, { by: actor.name, role: actor.roleId, at: new Date().toISOString(), operationId: instance.id });
    audit(actor, "Signed off AI executive summary", "ExecutiveSummary", p.key, "AI-drafted", "Signed off");
    publish("executive.summary.signedOff", { module: MODULE, subject: { type: "ExecutiveSummary", id: p.key, title: `Executive risk summary — ${p.period}`, href: "/executive" }, payload: { period: p.period, operationId: instance.id } });
    notify({ templateId: "executive.summary-signed-off", toRoles: getRule<RoleId[]>(R.summaryNotifyRoles), toUserIds: [instance.requestedBy.id], href: "/executive", data: { period: p.period, signedOffBy: actor.name, headline: p.headline } });
  },
});

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "executive.summary-signed-off",
    name: "Executive summary signed off",
    module: MODULE,
    trigger: "executive.summary.signedOff",
    subject: "Executive risk summary signed off — {{period}}",
    inApp: "{{signedOffBy}} signed off the executive risk summary for {{period}}.",
    body: "<p>The AI-drafted executive risk summary for <strong>{{period}}</strong> was signed off by <strong>{{signedOffBy}}</strong> and may now be used in Board packs.</p><p>{{headline}}</p>",
    tone: "success",
    variables: [
      { name: "period", description: "Reporting period", example: "Q4 2026" },
      { name: "signedOffBy", description: "Signer", example: "Ngozi Eze" },
      { name: "headline", description: "First paragraph of the summary", example: "The loan book stands at ₦412bn with an NPL ratio of 4.1%…" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "executive.summary.submitted", module: MODULE, description: "The AI executive summary was submitted for sign-off." },
  { name: "executive.summary.signedOff", module: MODULE, description: "The executive summary was signed off (after approval)." },
]);

defineHookPoints([
  { point: "executive.summary.submit.before", module: MODULE, kind: "before", description: "Before the executive summary is submitted for sign-off. Veto or enrich." },
  { point: "executive.summary.submit.after", module: MODULE, kind: "after", description: "After the executive summary is submitted." },
]);
