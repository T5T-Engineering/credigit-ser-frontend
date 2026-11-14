/**
 * Credit approval chart-flow (PRD §6.1.2–6.1.3, §4.1–4.2) — rule-driven.
 *
 * Route: Account Officer initiates → BDM recommends (tier 1) → co-signer pairs per tier until the facility
 * amount is within the pair's limit → committees. Dissent between co-signers routes to the named adjudicator;
 * an unresolved approval must never sit idle.
 *
 * Every tier (roles, adjudicator, limit role, SLA) and the Fast-Track pair are BUSINESS RULES
 * (`origination.chartFlow.*`, `origination.fastTrack.*`) defined here — not in the module's platform.ts — because
 * the demo seed builds approval chains while the data store is created, before module registrations load.
 * Tier limits are the sign-on limits of each tier's limit role (`rbac.limit.<role>`, Operations → Business rules).
 *
 * The approval itself runs through the Operations engine: `approvalStepsFor()` turns the tiers into workflow
 * steps (co-sign = mode "all" with the adjudicator), and `chainFromOperation()` mirrors an operation instance
 * back onto `Application.approvals` for the pipeline / inbox views.
 */
import type { Faker } from "@faker-js/faker";
import { roleById, roles, type RoleId } from "./rbac/roles";
import type { ApplicationStage, ApprovalDecision, ApprovalStep, User } from "./data/types";
import type { StepDecision, WorkflowStep } from "./platform/operations";
import { defineRules, getRule, ruleDefinition } from "./platform/rules";

export type Flow = "Standard" | "Fast-Track";

export type Tier = { pair: string; roles: RoleId[]; limit: number; adjudicator?: RoleId; limitRole: RoleId; slaHours: number };

// ---------------------------------------------------------------- business rules

/** Configurable tier slots of the Standard ladder (PRD §6.1.1 default configuration uses seven; T8–T12 are empty by default). A slot with no roles is skipped. */
export const TIER_SLOTS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"] as const;
export const FAST_TRACK_PAIR = "FT1";

const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));
const adjudicatorOptions = [{ value: "", label: "None" }, ...roleOptions];
/** Extra slots may leave the limit role empty: the last signer's limit then applies. */
const optionalLimitRoleOptions = [{ value: "", label: "Last signer" }, ...roleOptions];

type SlotDefault = { roles: RoleId[]; adjudicator: RoleId | ""; limitRole: RoleId | ""; slaHours: number; source: string };
const SRC_FLOW = "6.1.2 (default configuration)";
const SRC_SLA = "Tenant parameter";
const extraSlot: SlotDefault = { roles: [], adjudicator: "", limitRole: "", slaHours: 168, source: "Optional extra tier (empty by default, skipped)" };
const slotDefaults: Record<(typeof TIER_SLOTS)[number], SlotDefault> = {
  T1: { roles: ["bdm"], adjudicator: "", limitRole: "bdm", slaHours: 24, source: SRC_FLOW },
  T2: { roles: ["credit-analyst", "group-head"], adjudicator: "cco", limitRole: "group-head", slaHours: 24, source: SRC_FLOW },
  T3: { roles: ["cco", "directorate-head"], adjudicator: "cro", limitRole: "directorate-head", slaHours: 24, source: SRC_FLOW },
  T4: { roles: ["cro", "md"], adjudicator: "mcc", limitRole: "md", slaHours: 48, source: SRC_FLOW },
  T5: { roles: ["mcc"], adjudicator: "", limitRole: "mcc", slaHours: 72, source: SRC_FLOW },
  T6: { roles: ["bcc"], adjudicator: "", limitRole: "bcc", slaHours: 120, source: SRC_FLOW },
  T7: { roles: ["board"], adjudicator: "", limitRole: "board", slaHours: 168, source: SRC_FLOW },
  T8: extraSlot,
  T9: extraSlot,
  T10: extraSlot,
  T11: extraSlot,
  T12: extraSlot,
};

defineRules([
  ...TIER_SLOTS.flatMap((slot, i) => {
    const d = slotDefaults[slot];
    const base = { module: "origination", category: "Credit chart-flow (Standard)" };
    return [
      { ...base, key: `origination.chartFlow.${slot}.roles`, label: `Tier ${i + 1} — signers`, description: `Roles that sign tier ${i + 1}. One role signs alone; two or more co-sign. Leave empty to skip the tier.`, type: "roles" as const, default: d.roles, source: d.source },
      { ...base, key: `origination.chartFlow.${slot}.adjudicator`, label: `Tier ${i + 1} — adjudicator`, description: `Role that resolves a dissent between the tier ${i + 1} co-signers.`, type: "enum" as const, options: adjudicatorOptions, default: d.adjudicator, source: d.source },
      { ...base, key: `origination.chartFlow.${slot}.limitRole`, label: `Tier ${i + 1} — limit role`, description: `Whose sign-on limit closes the route at tier ${i + 1} (the amount must be within it).`, type: "enum" as const, options: d.limitRole ? roleOptions : optionalLimitRoleOptions, default: d.limitRole, source: d.source },
      { ...base, key: `origination.chartFlow.${slot}.slaHours`, label: `Tier ${i + 1} — decision SLA`, description: `Hours the tier ${i + 1} signers have to decide.`, type: "duration" as const, durationUnit: "hours" as const, default: d.slaHours, min: 1, max: 720, source: SRC_SLA },
    ];
  }),
  { key: "origination.fastTrack.roles", label: "Fast-Track — co-signers", description: "Roles that co-sign a Fast-Track request within the Fast-Track limit.", module: "origination", category: "Credit chart-flow (Fast-Track)", type: "roles", default: ["bdm", "credit-analyst"], source: "Platform default" },
  { key: "origination.fastTrack.adjudicator", label: "Fast-Track — adjudicator", description: "Role that resolves a dissent between the Fast-Track co-signers.", module: "origination", category: "Credit chart-flow (Fast-Track)", type: "enum", options: adjudicatorOptions, default: "cco", source: "Platform default" },
  { key: "origination.fastTrack.limitRole", label: "Fast-Track — ceiling role", description: "Fast-Track requests within this role's sign-on limit use the Fast-Track pair; above it the Standard ladder applies (open question O1).", module: "origination", category: "Credit chart-flow (Fast-Track)", type: "enum", options: roleOptions, default: "bdm", source: "see docs/OPEN-QUESTIONS.md O1/W5" },
  { key: "origination.fastTrack.slaHours", label: "Fast-Track — decision SLA", description: "Hours the Fast-Track co-signers have to decide.", module: "origination", category: "Credit chart-flow (Fast-Track)", type: "duration", durationUnit: "hours", default: 8, min: 1, max: 720, source: SRC_SLA },
]);

/**
 * Sign-on limit for a role (Infinity = apex, 0 = no authority). Mirrors `roleLimit()` in `platform/core.ts` but is
 * safe while the seed runs (before core's `rbac.limit.*` rules are registered, when it falls back to the role's
 * configured default — which is the rule's own default).
 */
export function signOnLimit(roleId: RoleId): number {
  const role = roleById[roleId];
  if (!role || role.limitNgn === null) return 0;
  if (!Number.isFinite(role.limitNgn)) return Number.POSITIVE_INFINITY;
  const key = `rbac.limit.${roleId}`;
  return ruleDefinition(key) ? getRule<number>(key) : role.limitNgn;
}

const asRole = (v: string): RoleId | undefined => (v && v in roleById ? (v as RoleId) : undefined);

/** Enabled Standard tiers, in order, from business rules. */
export function getChartFlow(): Tier[] {
  return TIER_SLOTS.map((slot) => {
    const tierRoles = getRule<string[]>(`origination.chartFlow.${slot}.roles`).map(asRole).filter((r): r is RoleId => Boolean(r));
    const limitRole = asRole(getRule<string>(`origination.chartFlow.${slot}.limitRole`)) ?? tierRoles.at(-1)!;
    return { pair: slot, roles: tierRoles, adjudicator: asRole(getRule<string>(`origination.chartFlow.${slot}.adjudicator`)), limitRole, limit: limitRole ? signOnLimit(limitRole) : 0, slaHours: getRule<number>(`origination.chartFlow.${slot}.slaHours`) };
  }).filter((t) => t.roles.length > 0);
}

/** The Fast-Track co-signer pair (PRD §6.1.3). */
export function getFastTrackTier(): Tier {
  const tierRoles = getRule<string[]>("origination.fastTrack.roles").map(asRole).filter((r): r is RoleId => Boolean(r));
  const limitRole = asRole(getRule<string>("origination.fastTrack.limitRole")) ?? "bdm";
  return { pair: FAST_TRACK_PAIR, roles: tierRoles, adjudicator: asRole(getRule<string>("origination.fastTrack.adjudicator")), limitRole, limit: signOnLimit(limitRole), slaHours: getRule<number>("origination.fastTrack.slaHours") };
}

/**
 * @deprecated Live view of `getChartFlow()` kept so existing callers compile. Each access reads the current rules;
 * prefer calling `getChartFlow()` at call time. TD-110.
 */
export const chartFlow: readonly Tier[] = new Proxy([] as Tier[], {
  get: (_t, prop) => {
    const live = getChartFlow();
    const v = Reflect.get(live, prop);
    return typeof v === "function" ? v.bind(live) : v;
  },
  has: (_t, prop) => Reflect.has(getChartFlow(), prop),
  ownKeys: () => Reflect.ownKeys(getChartFlow()),
  getOwnPropertyDescriptor: (_t, prop) => {
    const d = Reflect.getOwnPropertyDescriptor(getChartFlow(), prop);
    return d ? { ...d, configurable: true } : undefined;
  },
});

/** Adjudicator for a co-signer pair, if any. */
export function adjudicatorFor(pair: string): RoleId | undefined {
  if (pair === FAST_TRACK_PAIR) return getFastTrackTier().adjudicator;
  return getChartFlow().find((t) => t.pair === pair)?.adjudicator;
}

/** Tier (Standard or Fast-Track) by pair id. */
export function tierByPair(pair: string | undefined): Tier | undefined {
  if (!pair) return undefined;
  return pair === FAST_TRACK_PAIR ? getFastTrackTier() : getChartFlow().find((t) => t.pair === pair);
}

/** Tiers a request must pass (tier 1 always recommends; tier 2 always co-signs; Fast-Track within its ceiling = the pair alone). */
export function tiersFor(flow: Flow, amount: number): Tier[] {
  if (flow === "Fast-Track") {
    const ft = getFastTrackTier();
    if (ft.roles.length && amount <= ft.limit) return [ft];
  }
  const out: Tier[] = [];
  for (const [index, tier] of getChartFlow().entries()) {
    out.push(tier);
    if (index >= 1 && amount <= tier.limit) break;
  }
  return out;
}

/** Build the pending approval chain for an amount (seed and previews). */
export function buildApprovalChain(amount: number, users: User[], flow: Flow = "Standard"): ApprovalStep[] {
  return tiersFor(flow, amount).flatMap((tier, index) =>
    tier.roles.map((roleId) => ({
      id: `${tier.pair}-${roleId}`,
      tier: index + 1,
      roleId,
      assigneeId: users.find((u) => u.roleId === roleId)?.id,
      decision: "pending" as const,
      pair: tier.roles.length > 1 ? tier.pair : undefined,
    })),
  );
}

// ---------------------------------------------------------------- Operations engine mapping

/** Operation type for the route an amount/flow needs (one type per route length; see origination/platform.ts). */
export function creditOperationType(flow: Flow, amount: number): string {
  const tiers = tiersFor(flow, amount);
  return tiers[0]?.pair === FAST_TRACK_PAIR ? "credit.facility-approval.fast-track" : `credit.facility-approval.t${tiers.length}`;
}

/** Human name of a tier step. */
export function tierStepName(tier: Tier, index: number): string {
  if (tier.pair === FAST_TRACK_PAIR) return `Fast-Track — ${tier.roles.map((r) => roleById[r].short).join(" + ")} co-sign`;
  if (index === 0 && tier.roles.length === 1) return `Tier 1 — ${roleById[tier.roles[0]!].name} recommendation`;
  if (tier.roles.length > 1) return `Tier ${index + 1} — ${tier.roles.map((r) => roleById[r].short).join(" + ")} co-sign`;
  return `Tier ${index + 1} — ${roleById[tier.roles[0]!].name}`;
}

/** Operations workflow steps for a list of tiers: co-signers = mode "all" + adjudicator; single signer = "any". */
export function approvalStepsFor(tiers: Tier[]): WorkflowStep[] {
  return tiers.map((tier, index) => ({
    id: tier.pair,
    name: tierStepName(tier, index),
    approverRoles: tier.roles,
    mode: tier.roles.length > 1 ? "all" : "any",
    slaHours: tier.slaHours,
    adjudicatorRole: tier.roles.length > 1 ? tier.adjudicator : undefined,
  }));
}

const fromEngine = (d: StepDecision["decision"], recommend: boolean): ApprovalDecision => (d === "approve" ? (recommend ? "recommended" : "approved") : d === "reject" ? "declined" : "returned");

/** Mirror an operation instance onto the application's approval chain (pipeline, inbox and header views). */
export function chainFromOperation(steps: WorkflowStep[], instance: { decisions: StepDecision[]; stepIndex: number; awaitingAdjudication?: boolean }, users: User[]): ApprovalStep[] {
  const out: ApprovalStep[] = [];
  steps.forEach((step, index) => {
    const recommend = index === 0 && step.approverRoles.length === 1 && step.id !== FAST_TRACK_PAIR;
    const pair = step.approverRoles.length > 1 ? step.id : undefined;
    const adjudication = instance.decisions.filter((d) => d.stepId === step.id && d.adjudication).at(-1);
    const dissent = Boolean(adjudication) || (instance.awaitingAdjudication && index === instance.stepIndex);
    for (const roleId of step.approverRoles) {
      const d = instance.decisions.filter((x) => x.stepId === step.id && x.roleId === roleId && !x.adjudication).at(-1);
      out.push({
        id: `${step.id}-${roleId}`,
        tier: index + 1,
        roleId,
        assigneeId: d?.actorId ?? users.find((u) => u.roleId === roleId)?.id,
        decision: d ? (dissent ? "dissent" : fromEngine(d.decision, recommend)) : "pending",
        comment: d?.comment,
        decidedAt: d?.at,
        pair,
      });
    }
    if (dissent && step.adjudicatorRole) {
      out.push({
        id: `${step.id}-adjudication`,
        tier: index + 1,
        roleId: step.adjudicatorRole,
        assigneeId: adjudication?.actorId ?? users.find((u) => u.roleId === step.adjudicatorRole)?.id,
        decision: adjudication ? fromEngine(adjudication.decision, false) : "pending",
        comment: adjudication?.comment,
        decidedAt: adjudication?.at,
        adjudicates: step.id,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------- chain helpers (read-only views)

/** The step(s) currently awaiting a decision (both co-signers of a pair can act in parallel). */
export function currentSteps(chain: ApprovalStep[]): ApprovalStep[] {
  const first = chain.find((s) => s.decision === "pending");
  if (!first) return [];
  return chain.filter((s) => s.decision === "pending" && (s.id === first.id || (first.pair && s.pair === first.pair)));
}

export function chainStatus(chain: ApprovalStep[]): "Approved" | "Declined" | "In progress" {
  if (chain.some((s) => s.decision === "declined")) return "Declined";
  if (chain.length && chain.every((s) => s.decision !== "pending")) return "Approved";
  return "In progress";
}

/**
 * @deprecated Approvals are decided through the Operations engine (`decideOperation`); kept for callers that
 * still simulate a chain locally. Handles co-signer dissent → adjudicator step.
 */
export function applyDecision(
  chain: ApprovalStep[],
  stepId: string,
  decision: "approved" | "declined" | "recommended" | "returned",
  comment: string,
  users: User[],
  at = new Date().toISOString(),
): ApprovalStep[] {
  let next = chain.map((s) => (s.id === stepId ? { ...s, decision, comment, decidedAt: at } : s));
  const step = next.find((s) => s.id === stepId)!;
  if (step.pair) {
    const pair = next.filter((s) => s.pair === step.pair && !s.adjudicates);
    const decided = pair.filter((s) => s.decision !== "pending");
    if (decided.length === pair.length && decided.some((s) => s.decision === "approved") && decided.some((s) => s.decision === "declined")) {
      const adjudicator = adjudicatorFor(step.pair);
      if (adjudicator) {
        next = next.map((s) => (s.pair === step.pair && !s.adjudicates ? { ...s, decision: "dissent" as const } : s));
        const lastIndex = next.findLastIndex((s) => s.pair === step.pair);
        next.splice(lastIndex + 1, 0, { id: `${step.pair}-adjudication`, tier: step.tier, roleId: adjudicator, assigneeId: users.find((u) => u.roleId === adjudicator)?.id, decision: "pending", adjudicates: step.pair });
      }
    }
  }
  return next;
}

/** Demo helper: give a seeded chain decisions consistent with the application's stage (seed DATA, not policy). */
export function settleChain(chain: ApprovalStep[], stage: ApplicationStage, index: number, _users: User[], f: Faker): ApprovalStep[] {
  const preApproval: ApplicationStage[] = ["Draft", "Documents", "Analysis", "Recommendation"];
  if (preApproval.includes(stage)) return chain;
  const done = (s: ApprovalStep, d: ApprovalStep["decision"]): ApprovalStep => ({
    ...s,
    decision: d,
    decidedAt: new Date(Date.UTC(2026, 9, 20 + (s.tier % 8), 10)).toISOString(),
    comment:
      d === "recommended"
        ? "Strong cash-flow coverage; recommend subject to domiciliation."
        : d === "approved"
          ? f.helpers.arrayElement(["Approved within limit.", "Approved subject to conditions precedent.", "Concur with analyst."])
          : d === "declined"
            ? "Leverage above appetite for the sector."
            : d === "dissent"
              ? "Leverage above appetite for the sector."
              : undefined,
  });
  if (stage === "Approval") {
    // Approve the first part of the chain, leave the rest pending. Every 5th case shows a dissent → adjudication.
    const cut = 1 + (index % Math.max(1, chain.length - 1));
    let out = chain.map((s, i) => (i < cut ? done(s, s.tier === 1 ? "recommended" : "approved") : s));
    const pair2 = out.find((s) => s.tier === 2 && s.pair)?.pair;
    const adjudicator = pair2 ? adjudicatorFor(pair2) : undefined;
    if (index % 5 === 0 && pair2 && adjudicator) {
      out = out.map((s) => (s.pair === pair2 ? done(s, "dissent") : s.tier === 1 ? done(s, "recommended") : { ...s, decision: "pending" as const, decidedAt: undefined, comment: undefined }));
      const at = out.findLastIndex((s) => s.pair === pair2);
      out.splice(at + 1, 0, { id: `${pair2}-adjudication`, tier: 2, roleId: adjudicator, decision: "pending", adjudicates: pair2 });
    }
    return out;
  }
  if (stage === "Declined") {
    return chain.map((s, i) => (i === 0 ? done(s, "recommended") : i === 1 ? done(s, "declined") : s));
  }
  return chain.map((s) => done(s, s.tier === 1 ? "recommended" : "approved"));
}
