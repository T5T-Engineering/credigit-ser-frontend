/**
 * Credit approval chart-flow (PRD §6.1.2, §4.1–4.2) — default tenant configuration.
 *
 * Route: Account Officer initiates → BDM recommends (tier 1) → co-signer pairs per tier until the
 * facility amount is within the pair's limit → committees. Dissent between co-signers routes to the
 * named adjudicator; an unresolved approval must never sit idle.
 */
import type { Faker } from "@faker-js/faker";
import { roleById, type RoleId } from "./rbac/roles";
import type { ApplicationStage, ApprovalStep, User } from "./data/types";

type Tier = { pair: string; roles: RoleId[]; limit: number; adjudicator?: RoleId };

/** Ordered approval tiers. Limits come from the role definitions (illustrative tenant values). */
export const chartFlow: Tier[] = [
  { pair: "T1", roles: ["bdm"], limit: roleById.bdm.limitNgn! },
  { pair: "T2", roles: ["credit-analyst", "group-head"], limit: roleById["group-head"].limitNgn!, adjudicator: "cco" },
  { pair: "T3", roles: ["cco", "directorate-head"], limit: roleById["directorate-head"].limitNgn!, adjudicator: "cro" },
  { pair: "T4", roles: ["cro", "md"], limit: roleById.md.limitNgn!, adjudicator: "mcc" },
  { pair: "T5", roles: ["mcc"], limit: roleById.mcc.limitNgn! },
  { pair: "T6", roles: ["bcc"], limit: roleById.bcc.limitNgn! },
  { pair: "T7", roles: ["board"], limit: Number.POSITIVE_INFINITY },
];

/** Adjudicator for a co-signer pair, if any. */
export function adjudicatorFor(pair: string): RoleId | undefined {
  return chartFlow.find((t) => t.pair === pair)?.adjudicator;
}

/** Build the pending approval chain for an amount (tier 1 always recommends; tier 2 always co-signs). */
export function buildApprovalChain(amount: number, users: User[]): ApprovalStep[] {
  const steps: ApprovalStep[] = [];
  for (const [index, tier] of chartFlow.entries()) {
    for (const roleId of tier.roles) {
      steps.push({
        id: `${tier.pair}-${roleId}`,
        tier: index + 1,
        roleId,
        assigneeId: users.find((u) => u.roleId === roleId)?.id,
        decision: "pending",
        pair: tier.roles.length > 1 ? tier.pair : undefined,
      });
    }
    if (index >= 1 && amount <= tier.limit) break;
  }
  return steps;
}

/** The step(s) currently awaiting a decision (both co-signers of a pair can act in parallel). */
export function currentSteps(chain: ApprovalStep[]): ApprovalStep[] {
  const first = chain.find((s) => s.decision === "pending");
  if (!first) return [];
  return chain.filter((s) => s.decision === "pending" && (s.id === first.id || (first.pair && s.pair === first.pair)));
}

export function chainStatus(chain: ApprovalStep[]): "Approved" | "Declined" | "In progress" {
  if (chain.some((s) => s.decision === "declined")) return "Declined";
  if (chain.every((s) => s.decision !== "pending")) return "Approved";
  return "In progress";
}

/**
 * Apply a decision. Handles co-signer dissent: if one co-signer approves and the other declines,
 * both are marked "dissent" and an adjudicator step is inserted after the pair.
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
        next.splice(lastIndex + 1, 0, {
          id: `${step.pair}-adjudication`,
          tier: step.tier,
          roleId: adjudicator,
          assigneeId: users.find((u) => u.roleId === adjudicator)?.id,
          decision: "pending",
          adjudicates: step.pair,
        });
      }
    }
  }
  return next;
}

/** Demo helper: give a seeded chain decisions consistent with the application's stage. */
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
            : undefined,
  });
  if (stage === "Approval") {
    // Approve the first part of the chain, leave the rest pending. Every 5th case shows a dissent → adjudication.
    const cut = 1 + (index % Math.max(1, chain.length - 1));
    let out = chain.map((s, i) => (i < cut ? done(s, s.tier === 1 ? "recommended" : "approved") : s));
    if (index % 5 === 0 && out.some((s) => s.pair === "T2")) {
      out = out.map((s) => (s.pair === "T2" ? done(s, "dissent") : s.tier === 1 ? done(s, "recommended") : { ...s, decision: "pending" as const, decidedAt: undefined, comment: undefined }));
      const at = out.findLastIndex((s) => s.pair === "T2");
      out.splice(at + 1, 0, { id: "T2-adjudication", tier: 2, roleId: "cco", decision: "pending", adjudicates: "T2" });
    }
    return out;
  }
  if (stage === "Declined") {
    return chain.map((s, i) => (i === 0 ? done(s, "recommended") : i === 1 ? done(s, "declined") : s));
  }
  return chain.map((s) => done(s, s.tier === 1 ? "recommended" : "approved"));
}
