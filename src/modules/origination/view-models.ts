/** Mappers from domain records to @credigit/web-ui component shapes (no JSX). */
import type { ActivityItem, ApprovalParticipant, ApprovalTier, DocumentItem, OperationDecisionKind, OperationStatus as UiOperationStatus, OperationStep, OperationStepStatus } from "@credigit/web-ui";
import type { ApprovalStep, AuditEvent, DocumentRecord, User } from "@/lib/data/types";
import { roleById } from "@/lib/rbac/roles";
import { stepApproverLabel, stepDueAt, type OperationInstance, type OperationStatus, type StepDecision, type WorkflowStep } from "@/lib/platform/operations";
import { FAST_TRACK_PAIR, tierByPair } from "@/lib/workflow";
import { dateTime, moneyShort } from "@/lib/format";

const docStatus: Record<DocumentRecord["status"], DocumentItem["status"]> = {
  Uploaded: "uploaded",
  "Processing OCR": "processing",
  Extracted: "extracted",
  Verified: "verified",
  Rejected: "rejected",
};

export function toDocumentItem(d: DocumentRecord, users: Map<string, User>): DocumentItem {
  return {
    id: d.id,
    name: d.name,
    size: d.sizeKb * 1024,
    version: `v${d.version}`,
    uploadedBy: users.get(d.uploadedById)?.name,
    uploadedAt: dateTime(d.uploadedAt),
    status: docStatus[d.status],
    category: d.kind,
  };
}

export function toActivityItem(e: AuditEvent): ActivityItem {
  return {
    id: e.id,
    actor: { name: e.actorName, role: roleById[e.roleId]?.name },
    action: e.action,
    target: `${e.entityType} ${e.entityId}`,
    timestamp: e.at,
    changes: e.before || e.after ? [{ field: "Value", before: e.before, after: e.after }] : undefined,
    ip: e.ip,
    device: e.device,
  };
}

/** Tier limit for a chain step (from the chart-flow business rules). */
export function pairLimit(pair: string | undefined): number | null {
  const tier = tierByPair(pair);
  return tier ? tier.limit : null;
}

function participant(s: ApprovalStep, users: User[]): ApprovalParticipant {
  const user = users.find((u) => u.id === s.assigneeId) ?? users.find((u) => u.roleId === s.roleId);
  return {
    id: s.id,
    name: user?.name ?? roleById[s.roleId].name,
    role: roleById[s.roleId].name,
    decision: s.decision,
    decidedAt: s.decidedAt ? dateTime(s.decidedAt) : undefined,
    comment: s.comment,
  };
}

/** Group a chain into ApprovalTimeline tiers: co-signer pairs side by side, adjudicator on the pair. */
export function toApprovalTiers(chain: ApprovalStep[], users: User[]): ApprovalTier[] {
  const tiers: ApprovalTier[] = [];
  for (const s of chain) {
    if (s.adjudicates) {
      const t = tiers.find((x) => x.id === s.adjudicates);
      if (t) t.adjudicator = participant(s, users);
      continue;
    }
    const key = s.pair ?? s.id;
    let t = tiers.find((x) => x.id === key);
    if (!t) {
      const limit = pairLimit(s.pair ?? s.id.split("-")[0]);
      t = {
        id: key,
        title: s.pair ? `Tier ${s.tier} — co-signers` : s.roleId === "bdm" ? `Tier ${s.tier} — recommendation` : `Tier ${s.tier} — ${roleById[s.roleId].name}`,
        role: s.pair ? undefined : roleById[s.roleId].name,
        limit: limit === null ? undefined : limit === Number.POSITIVE_INFINITY ? "Apex — no limit" : `Up to ${moneyShort(limit)}`,
        participants: [],
      };
      tiers.push(t);
    }
    t.participants.push(participant(s, users));
  }
  return tiers;
}

// ---------------------------------------------------------------- Operations instance → library shapes

const uiStatus: Record<OperationStatus, UiOperationStatus> = { Pending: "pending", "In progress": "in_progress", Approved: "approved", Rejected: "rejected", Returned: "returned", Cancelled: "cancelled" };
export const toUiOperationStatus = (s: OperationStatus) => uiStatus[s];

function decisionKind(d: StepDecision, recommend: boolean): OperationDecisionKind {
  return d.decision === "approve" ? (recommend ? "recommended" : "approved") : d.decision === "reject" ? "rejected" : "returned";
}

/** Steps of an operation instance for `WorkflowInstanceCard` / `OperationTimeline`. */
export function toOperationSteps(instance: OperationInstance, steps: WorkflowStep[]): OperationStep[] {
  const open = instance.status === "Pending" || instance.status === "In progress";
  return steps.map((step, i) => {
    const recommend = i === 0 && step.approverRoles.length === 1 && step.id !== FAST_TRACK_PAIR;
    let status: OperationStepStatus = i < instance.stepIndex ? "approved" : "pending";
    if (i === instance.stepIndex) {
      status = open ? "current" : instance.status === "Approved" ? "approved" : instance.status === "Rejected" ? "rejected" : instance.status === "Returned" ? "returned" : "skipped";
    }
    const tier = tierByPair(step.id);
    const adjudicator = step.adjudicatorRole ? roleById[step.adjudicatorRole]?.name : undefined;
    return {
      id: step.id,
      name: step.name,
      status,
      mode: step.mode,
      approvers: `${stepApproverLabel(step)}${adjudicator ? ` · adjudicator: ${adjudicator}` : ""}`,
      decisions: instance.decisions
        .filter((d) => d.stepId === step.id)
        .map((d, k) => ({ id: `${step.id}-${k}`, actor: { name: d.actorName, role: `${roleById[d.roleId]?.name ?? d.roleId}${d.adjudication ? " (adjudicator)" : ""}` }, decision: decisionKind(d, recommend), time: dateTime(d.at), comment: d.comment || undefined })),
      dueAt: i === instance.stepIndex && open ? stepDueAt(instance) : undefined,
      meta:
        instance.awaitingAdjudication && i === instance.stepIndex
          ? `Co-signers disagree — awaiting the ${adjudicator ?? "adjudicator"}`
          : tier
            ? tier.limit === Number.POSITIVE_INFINITY
              ? "Apex — no limit"
              : `Limit up to ${moneyShort(tier.limit)} · SLA ${step.slaHours}h`
            : `SLA ${step.slaHours}h`,
    };
  });
}
