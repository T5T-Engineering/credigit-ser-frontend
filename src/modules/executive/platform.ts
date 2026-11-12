"use client";

/**
 * Platform registrations for the Executive module (invariants 8 & 9): business rules, operation types
 * (Operations workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md →
 * Platform services.
 *
 * Approval flows routed through Operations:
 *  - executive.summary.signoff   — AI executive risk summary signed off by the CRO / Head of Risk (§6.12).
 *  - executive.brc-pack.approve  — Board Risk Committee pack approved for issue (§6.6.6, §6.11).
 */
import { useDb } from "@/lib/data/store";
import type { RoleId } from "@/lib/rbac/roles";
import { defineEvents, publish, subscribe } from "@/lib/platform/events";
import { defineHookPoints, registerHook } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, getRule, type RuleDefinition } from "@/lib/platform/rules";
import type { Actor } from "@/lib/platform/scope";
import { usePortfolioStore } from "@/modules/portfolio/store";

const MODULE = "executive";
const DEMO = "Tenant parameter (demo value)";

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
  packRequiresSignedSummary: "executive.brcPack.requiresSignedSummary",
  summaryNotifyRoles: "executive.summary.notifyRoles",
  packNotifyRoles: "executive.brcPack.notifyRoles",
} as const;

const pctRule = (key: string, label: string, description: string, category: string, value: number, source: string, extra: Partial<RuleDefinition> = {}): RuleDefinition => ({
  key, label, description, module: MODULE, category, type: "percent", unit: "%", default: value, min: 0, max: 100, step: 0.1, source, ...extra,
});
const R = EXEC_RULES;

// ---------------------------------------------------------------- business rules
defineRules([
  pctRule(R.stage2RedPct, "Stage 2 share of book — appetite", "Stage 2 share at or above this is Red.", "KRI thresholds", 12, "tenant parameter (demo value)"),
  pctRule(R.stage2AmberPct, "Stage 2 share of book — early warning", "Stage 2 share at or above this (below appetite) is Amber.", "KRI thresholds", 10, "tenant parameter (demo value)"),
  pctRule(R.appetiteAmberPct, "Early-warning share of appetite", "A KRI at or above this share of its appetite (NPL, op-loss) is Amber.", "KRI thresholds", 80, DEMO),
  { key: R.carAmberBufferPp, label: "CAR early-warning buffer", description: "CAR within this many percentage points above the minimum is Amber.", module: MODULE, category: "KRI thresholds", type: "number", unit: "pp", default: 2.5, min: 0, max: 10, step: 0.1, source: DEMO },
  pctRule(R.ldrMinPct, "Minimum loan-to-deposit ratio", "LDR below this is Red.", "KRI thresholds", 65, "CBN minimum LDR"),
  { key: R.ldrAmberBufferPp, label: "LDR early-warning buffer", description: "LDR within this many percentage points above the minimum is Amber.", module: MODULE, category: "KRI thresholds", type: "number", unit: "pp", default: 3, min: 0, max: 20, step: 0.5, source: DEMO },
  pctRule(R.liquidityRatioMinPct, "Minimum liquidity ratio", "Liquidity ratio below this is Red.", "KRI thresholds", 30, "tenant parameter (demo value)"),
  pctRule(R.nopLimitPct, "Net open position limit (% of capital)", "NOP / capital above this is a breach.", "KRI thresholds", 20, "tenant parameter (demo value)"),
  { key: R.varLimitNgn, label: "Trading VaR limit (1-day, 99%)", description: "VaR above this is a breach.", module: MODULE, category: "KRI thresholds", type: "money", default: 600e6, min: 0, source: "tenant parameter (demo value)" },
  pctRule(R.opLossAppetitePct, "Operational loss appetite (% of gross income)", "Loss rate at or above this is Red.", "KRI thresholds", 0.5, "tenant parameter (demo value)", { step: 0.01 }),
  pctRule(R.quotedEquityHaircutPct, "Quoted-equity collateral haircut", "Haircut applied to CSCS mark-to-market for share-margin status.", "Collateral", 20, "quoted equity haircut"),
  { key: R.packRequiresSignedSummary, label: "BRC pack needs a signed-off summary", description: "The Board Risk Committee pack can't be submitted until the executive summary is signed off.", module: MODULE, category: "Board reporting", type: "boolean", default: true, source: "AI-drafted, human-approved (tenant choice, demo on)" },
  { key: R.summaryNotifyRoles, label: "Executive summary sign-off — notify roles", description: "Roles notified when the executive summary is signed off.", module: MODULE, category: "Notifications", type: "roles", default: ["cro", "head-of-risk", "md"], source: DEMO },
  { key: R.packNotifyRoles, label: "BRC pack approval — notify roles", description: "Roles notified when the Board Risk Committee pack is approved.", module: MODULE, category: "Notifications", type: "roles", default: ["cro", "head-of-risk", "md", "board", "portfolio-mis-officer"], source: DEMO },
]);

// ---------------------------------------------------------------- helpers
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });

function audit(actor: Actor, action: string, entityType: string, entityId: string, before?: string, after?: string) {
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType, entityId, before, after });
}

export const PACK_HREF = "/executive/board-pack";

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

export type PackApprovalPayload = { runId: string; period: string };

registerOperation<PackApprovalPayload>({
  type: "executive.brc-pack.approve",
  name: "Board Risk Committee pack approval",
  module: MODULE,
  description: "Approve the Board Risk Committee pack for issue to the committee.",
  defaultSteps: [step("approve", "CRO / Head of Risk approval", ["cro", "head-of-risk"], 48)],
  apply: (p, { instance, actor }) => {
    const store = usePortfolioStore.getState();
    const before = store.runs.find((r) => r.id === p.runId)?.status;
    store.updateRun(p.runId, { status: "Released", releasedBy: actor.name, releasedAt: new Date().toISOString(), operationId: instance.id, returnReason: undefined });
    audit(actor, "Approved Board Risk Committee pack", "Report", p.runId, before, "Released");
    publish("executive.brcPack.approved", { module: MODULE, subject: { type: "BoardPack", id: p.runId, title: `Board Risk Committee pack — ${p.period}`, href: PACK_HREF }, payload: { period: p.period, operationId: instance.id } });
    notify({ templateId: "executive.brc-pack-approved", toRoles: getRule<RoleId[]>(R.packNotifyRoles), href: PACK_HREF, data: { period: p.period, run: p.runId, approvedBy: actor.name, preparedBy: instance.requestedBy.name } });
  },
  onReject: (p, { instance, actor }) => {
    usePortfolioStore.getState().updateRun(p.runId, { status: "Returned for correction", returnReason: instance.reason });
    audit(actor, "Rejected Board Risk Committee pack", "Report", p.runId, "Submitted for release", "Returned for correction");
    publish("executive.brcPack.rejected", { module: MODULE, subject: { type: "BoardPack", id: p.runId, title: `Board Risk Committee pack — ${p.period}`, href: PACK_HREF }, payload: { reason: instance.reason } });
    notify({ templateId: "executive.brc-pack-returned", toUserIds: [instance.requestedBy.id], href: PACK_HREF, data: { period: p.period, run: p.runId, decidedBy: actor.name, reason: instance.reason ?? "" } });
  },
});

// Returned / withdrawn pack requests don't call apply/onReject — make the pack editable again.
subscribe({
  id: "executive.operations-closed",
  name: "Executive: reset BRC pack on returned / withdrawn request",
  pattern: "operations.request.*",
  handler: (e) => {
    if (!["operations.request.returned", "operations.request.cancelled"].includes(e.name)) return;
    const { operationType, subject } = e.payload as { operationType: string; subject: { id: string } };
    if (operationType !== "executive.brc-pack.approve") return;
    const store = usePortfolioStore.getState();
    const run = store.runs.find((r) => r.id === subject.id);
    if (run?.status === "Submitted for release") store.updateRun(run.id, { status: "Returned for correction", returnReason: e.name.endsWith("cancelled") ? "Withdrawn by requester" : "Returned by approver" });
  },
});

// Built-in policy hook: the pack needs a signed-off executive summary (PRD §6.12).
registerHook<{ summaryKey: string }>({
  id: "executive.pack-needs-signed-summary",
  name: "Signed-off summary gate",
  point: "executive.brcPack.submit.before",
  priority: 10,
  run: ({ summaryKey }) =>
    getRule<boolean>(R.packRequiresSignedSummary) && !usePortfolioStore.getState().signOffs[summaryKey] ? { veto: "the executive risk summary for this period isn't signed off yet." } : undefined,
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
  tpl({
    id: "executive.brc-pack-approved",
    name: "Board Risk Committee pack approved",
    module: MODULE,
    trigger: "executive.brcPack.approved",
    subject: "Board Risk Committee pack approved — {{period}}",
    inApp: "The {{period}} Board Risk Committee pack was approved by {{approvedBy}}.",
    body: "<p>The <strong>{{period}}</strong> Board Risk Committee pack (run {{run}}) was approved by <strong>{{approvedBy}}</strong> for issue to the committee.</p><ul><li>Prepared by: {{preparedBy}}</li><li>Approved by: {{approvedBy}}</li></ul>",
    tone: "success",
    variables: [
      { name: "period", description: "Pack period", example: "Q4 2026" },
      { name: "run", description: "Run id", example: "RUN-MH3K2A" },
      { name: "approvedBy", description: "Approver", example: "Ngozi Eze" },
      { name: "preparedBy", description: "Who built and submitted the pack", example: "Tunde Bakare" },
    ],
  }),
  tpl({
    id: "executive.brc-pack-returned",
    name: "Board Risk Committee pack not approved",
    module: MODULE,
    trigger: "executive.brcPack.rejected",
    subject: "Board Risk Committee pack not approved — {{period}}",
    inApp: "The {{period}} Board Risk Committee pack was rejected by {{decidedBy}}.",
    body: "<p>The <strong>{{period}}</strong> Board Risk Committee pack (run {{run}}) was rejected by {{decidedBy}}.</p><p>{{reason}}</p><p>Update the pack and submit it again.</p>",
    tone: "warning",
    variables: [
      { name: "period", description: "Pack period", example: "Q4 2026" },
      { name: "run", description: "Run id", example: "RUN-MH3K2A" },
      { name: "decidedBy", description: "Approver", example: "Ngozi Eze" },
      { name: "reason", description: "Approver comment", example: "IFRS 9 section still pending." },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "executive.summary.submitted", module: MODULE, description: "The AI executive summary was submitted for sign-off." },
  { name: "executive.summary.signedOff", module: MODULE, description: "The executive summary was signed off (after approval)." },
  { name: "executive.brcPack.built", module: MODULE, description: "A Board Risk Committee pack draft was built.", payloadExample: { period: "Q4 2026 (draft)" } },
  { name: "executive.brcPack.submitted", module: MODULE, description: "The Board Risk Committee pack was submitted for approval." },
  { name: "executive.brcPack.approved", module: MODULE, description: "The Board Risk Committee pack was approved for issue." },
  { name: "executive.brcPack.rejected", module: MODULE, description: "The Board Risk Committee pack was rejected." },
]);

defineHookPoints([
  { point: "executive.summary.submit.before", module: MODULE, kind: "before", description: "Before the executive summary is submitted for sign-off. Veto or enrich." },
  { point: "executive.summary.submit.after", module: MODULE, kind: "after", description: "After the executive summary is submitted." },
  { point: "executive.brcPack.build.before", module: MODULE, kind: "before", description: "Before a Board Risk Committee pack draft is built. Veto or add sections." },
  { point: "executive.brcPack.build.after", module: MODULE, kind: "after", description: "After a pack draft is built." },
  { point: "executive.brcPack.submit.before", module: MODULE, kind: "before", description: "Before the pack is submitted for approval. Built-in: signed-off summary gate." },
  { point: "executive.brcPack.submit.after", module: MODULE, kind: "after", description: "After the pack is submitted." },
]);
