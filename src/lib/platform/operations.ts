"use client";

/**
 * Operations workflow engine (invariant 9: every approval routes through "Operations").
 *
 * - Modules register an OPERATION TYPE with a default workflow definition and an `apply` function.
 * - `submitOperation()` creates an instance; approvers act in Operations → Approvals (or inline via
 *   `decideOperation()`); when the last step approves, `apply(payload)` runs.
 * - Steps: approver roles, mode "any" (one of the roles) or "all" (co-sign: every role), SLA hours,
 *   optional adjudicator role when co-signers disagree (PRD §4.2: dissent never sits idle).
 * - Segregation of duties: the requester can never decide their own operation.
 * - Every transition: hook points (operations.submit.before/after, operations.decide.before/after),
 *   domain events (operations.*), audit log, notifications.
 * - Definitions are tenant configuration: edits are themselves an operation ("workflow.change").
 *
 * BACKEND SEAM: submit/decide call the workflow API; instances/definitions come from the server.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { roleById, type RoleId } from "../rbac/roles";
import { actorHasPermission } from "../iam/permissions";
import { useDb, newId } from "../data/store";
import { publish, type EventSubject } from "./events";
import { runHooks } from "./hooks";
import { notify } from "./notifications";
import { getRule } from "./rules";
import { currentActor, type Actor } from "./scope";

export type StepMode = "any" | "all";

export type WorkflowStep = {
  id: string;
  name: string;
  approverRoles: RoleId[];
  mode: StepMode;
  slaHours: number;
  /** Role that resolves a split decision in an "all" step. */
  adjudicatorRole?: RoleId;
};

export type WorkflowDefinition = {
  operationType: string;
  name: string;
  description: string;
  module: string;
  enabled: boolean;
  version: number;
  steps: WorkflowStep[];
};

/** "Failed": the final step approved but `apply` threw — the change was not made (OPS-FR-17). */
export type OperationStatus = "Pending" | "In progress" | "Approved" | "Rejected" | "Returned" | "Cancelled" | "Failed";

export type StepDecision = {
  stepId: string;
  actorId: string;
  actorName: string;
  roleId: RoleId;
  decision: "approve" | "reject" | "return";
  comment: string;
  at: string;
  /** Decision made as adjudicator. */
  adjudication?: boolean;
};

export type OperationInstance = {
  id: string;
  operationType: string;
  definitionVersion: number;
  title: string;
  subject: EventSubject;
  payload: unknown;
  /** Key facts shown to approvers. */
  summary: { label: string; value: string }[];
  /** Amount (NGN) the decision is about — drives step-up authentication above approvals.stepUpThresholdNgn. */
  amountNgn?: number;
  /** Steps captured at submission, so later workflow/rule changes never reshape an in-flight request. */
  steps?: WorkflowStep[];
  requestedBy: { id: string; name: string; roleId: RoleId };
  requestedAt: string;
  status: OperationStatus;
  stepIndex: number;
  /** Set when co-signers split and an adjudicator must decide. */
  awaitingAdjudication?: boolean;
  decisions: StepDecision[];
  stepStartedAt: string;
  completedAt?: string;
  reason?: string;
};

export type OperationHandler<P> = {
  type: string;
  name: string;
  module: string;
  description: string;
  defaultSteps: WorkflowStep[];
  /**
   * Allow the same person to decide more than one step (default false = four eyes across steps).
   * Credit chart-flows need this: the PRD makes the CCO adjudicator at tier 2 and co-signer at tier 3.
   */
  allowRepeatApprover?: boolean;
  /** Runs when the final step approves (or immediately when the workflow is disabled/has no steps). */
  apply: (payload: P, ctx: { instance: OperationInstance; actor: Actor }) => void | Promise<void>;
  onReject?: (payload: P, ctx: { instance: OperationInstance; actor: Actor }) => void;
};

type OpsState = {
  /** Tenant definition overrides (by operation type). */
  definitions: Record<string, WorkflowDefinition>;
  instances: OperationInstance[];
};

export const useOperationsStore = create<OpsState>()(
  persist((): OpsState => ({ definitions: {}, instances: [] }), { name: "credigit.ser.operations", storage: createJSONStorage(() => localStorage) }),
);

const handlers = new Map<string, OperationHandler<unknown>>();

export function registerOperation<P>(handler: OperationHandler<P>) {
  handlers.set(handler.type, handler as OperationHandler<unknown>);
}

export function operationTypes(): OperationHandler<unknown>[] {
  return [...handlers.values()].sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}

/** Effective definition: tenant override, else the registered default. */
export function getDefinition(type: string): WorkflowDefinition {
  const override = useOperationsStore.getState().definitions[type];
  if (override) return override;
  const h = handlers.get(type);
  if (!h) throw new Error(`Unknown operation type "${type}" — register it with registerOperation().`);
  return { operationType: type, name: h.name, description: h.description, module: h.module, enabled: true, version: 1, steps: h.defaultSteps };
}

export function definitionList(): WorkflowDefinition[] {
  return operationTypes().map((h) => getDefinition(h.type));
}

/** Store a definition directly. Only the "workflow.change" operation (on approval) should call this. */
export function saveDefinition(def: WorkflowDefinition) {
  useOperationsStore.setState((s) => ({ definitions: { ...s.definitions, [def.operationType]: def } }));
}

const hoursFromNow = (from: string, hours: number) => new Date(new Date(from).getTime() + hours * 3_600_000).toISOString();

/** Due time of the current step (SLA). */
export function stepDueAt(instance: OperationInstance): string | undefined {
  const step = currentStep(instance);
  return step ? hoursFromNow(instance.stepStartedAt, step.slaHours) : undefined;
}

/** Steps for an instance: the snapshot taken at submission (falls back to the live definition for old records). */
export function instanceSteps(instance: OperationInstance): WorkflowStep[] {
  return instance.steps ?? getDefinition(instance.operationType).steps;
}

export function currentStep(instance: OperationInstance): WorkflowStep | undefined {
  return instanceSteps(instance)[instance.stepIndex];
}

/** Whether a decision on this instance needs step-up authentication (amount above the tenant threshold). */
export function requiresStepUp(instance: OperationInstance): boolean {
  return typeof instance.amountNgn === "number" && instance.amountNgn > getRule<number>("approvals.stepUpThresholdNgn");
}

/** Roles that may act now (approvers, or the adjudicator after a split). */
export function actingRoles(instance: OperationInstance): RoleId[] {
  const step = currentStep(instance);
  if (!step || !["Pending", "In progress"].includes(instance.status)) return [];
  if (instance.awaitingAdjudication && step.adjudicatorRole) return [step.adjudicatorRole];
  if (step.mode === "all") {
    const decided = new Set(instance.decisions.filter((d) => d.stepId === step.id && !d.adjudication).map((d) => d.roleId));
    return step.approverRoles.filter((r) => !decided.has(r));
  }
  return step.approverRoles;
}

/** Whether an actor may decide the instance now (role match + segregation of duties). */
export function canDecide(instance: OperationInstance, actor: Pick<Actor, "id" | "roleId">): { ok: boolean; reason?: string } {
  // Invariant 12: deciding needs the permission — and the permission never bypasses eligibility, four-eyes or SoD below.
  if (!actorHasPermission(actor, "operations.items.decide")) return { ok: false, reason: "Your permissions don't include deciding Operations requests (operations.items.decide)." };
  if (instance.requestedBy.id === actor.id) return { ok: false, reason: "You requested this operation, so someone else must decide it (segregation of duties)." };
  // Four eyes across steps: one person decides at most one step of a request.
  if (!handlers.get(instance.operationType)?.allowRepeatApprover && instance.decisions.some((d) => d.actorId === actor.id)) return { ok: false, reason: "You already decided an earlier step of this request — a different person must decide this one." };
  if (!actingRoles(instance).includes(actor.roleId)) return { ok: false, reason: "This step is waiting for a different role." };
  return { ok: true };
}

/**
 * Whether an actor may see an operation (item page, OPS-FR-16): the requester, anyone who decided a step,
 * holders of a role named as approver / adjudicator in any snapshotted step, and holders of the Operations oversight
 * permission `operations.oversight.view` (was TD-961).
 */
export function canViewOperation(instance: OperationInstance, actor: Pick<Actor, "id" | "roleId">): boolean {
  if (instance.requestedBy.id === actor.id) return true;
  if (instance.decisions.some((d) => d.actorId === actor.id)) return true;
  let steps: WorkflowStep[] = [];
  try {
    steps = instanceSteps(instance);
  } catch {
    steps = instance.steps ?? [];
  }
  if (steps.some((s) => s.approverRoles.includes(actor.roleId) || s.adjudicatorRole === actor.roleId)) return true;
  return actorHasPermission(actor, "operations.oversight.view");
}

function audit(actor: Actor, action: string, instance: OperationInstance, before?: string, after?: string) {
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType: `Operation · ${instance.operationType}`, entityId: instance.id, before, after });
}

function update(id: string, changes: Partial<OperationInstance>) {
  useOperationsStore.setState((s) => ({ instances: s.instances.map((i) => (i.id === id ? { ...i, ...changes } : i)) }));
}

function get(id: string) {
  return useOperationsStore.getState().instances.find((i) => i.id === id);
}

function notifyApprovers(instance: OperationInstance) {
  const roles = actingRoles(instance);
  if (!roles.length) return;
  // Notify the eligible people, not whole roles: skip the requester and anyone who already decided.
  const decided = new Set(instance.decisions.map((d) => d.actorId));
  const userIds = useDb
    .getState()
    .users.filter((u) => u.status === "Active" && roles.includes(u.roleId) && u.id !== instance.requestedBy.id && !decided.has(u.id))
    .map((u) => u.id);
  if (!userIds.length) return;
  const step = currentStep(instance)!;
  notify({
    templateId: "operations.approval-requested",
    toUserIds: userIds,
    href: `/operations/item?id=${instance.id}`,
    data: { title: instance.title, operation: getDefinition(instance.operationType).name, requester: instance.requestedBy.name, step: step.name, due: new Date(stepDueAt(instance)!).toUTCString() },
  });
}

export type SubmitInput<P> = { title: string; subject: EventSubject; payload: P; summary?: { label: string; value: string }[]; /** Amount (NGN) in question; used for step-up. */ amountNgn?: number };
export type SubmitResult = { ok: true; instance: OperationInstance; applied: boolean } | { ok: false; reason: string };

/** Submit an operation for approval. Applies immediately if the workflow is disabled or has no steps. */
export async function submitOperation<P>(type: string, input: SubmitInput<P>): Promise<SubmitResult> {
  const handler = handlers.get(type) as OperationHandler<P> | undefined;
  if (!handler) return { ok: false, reason: `Unknown operation type "${type}".` };
  const actor = currentActor();
  const before = await runHooks("operations.submit.before", { type, actor, ...input });
  if (!before.ok) return { ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` };
  const def = getDefinition(type);
  const now = new Date().toISOString();
  const instance: OperationInstance = {
    id: newId("OPS"),
    operationType: type,
    definitionVersion: def.version,
    title: input.title,
    subject: input.subject,
    payload: before.ctx.payload,
    summary: input.summary ?? [],
    amountNgn: input.amountNgn,
    steps: def.steps,
    requestedBy: { id: actor.id, name: actor.name, roleId: actor.roleId },
    requestedAt: now,
    status: "Pending",
    stepIndex: 0,
    decisions: [],
    stepStartedAt: now,
  };
  useOperationsStore.setState((s) => ({ instances: [instance, ...s.instances] }));
  audit(actor, `Submitted for approval: ${def.name}`, instance, undefined, input.title);
  publish("operations.request.submitted", { module: "operations", subject: { type: "Operation", id: instance.id, title: instance.title, href: `/operations/item?id=${instance.id}` }, payload: { operationType: type, subject: input.subject } });

  if (!def.enabled || def.steps.length === 0) {
    const final = await finalise(instance.id, actor, "Approved", "Applied directly — workflow disabled or has no steps.");
    if (final === "Failed") return { ok: false, reason: get(instance.id)!.reason ?? "Applying the change failed." };
    return { ok: true, instance: get(instance.id)!, applied: true };
  }
  notifyApprovers(instance);
  await runHooks("operations.submit.after", { instance });
  return { ok: true, instance, applied: false };
}

/**
 * Close an instance. For "Approved" the handler's `apply` runs FIRST; the instance becomes Approved only if
 * it succeeds. If `apply` throws, the instance becomes "Failed" (audited, published, requester + decider
 * notified) and the change is not made (OPS-FR-17). Returns the final status.
 */
async function finalise(id: string, actor: Actor, status: "Approved" | "Rejected" | "Returned" | "Cancelled", reason?: string): Promise<OperationStatus> {
  const instance = get(id)!;
  const handler = handlers.get(instance.operationType)!;
  const beforeStatus = instance.status;
  const completedAt = new Date().toISOString();
  const name = getDefinition(instance.operationType).name;
  const href = `/operations/item?id=${id}`;

  if (status === "Approved") {
    try {
      // The handler sees the instance as it will be once approved; the store changes only after success.
      await handler.apply(instance.payload, { instance: { ...instance, status: "Approved", completedAt, reason }, actor });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      update(id, { status: "Failed", completedAt, reason: `Approved, but applying the change failed: ${error}` });
      const failed = get(id)!;
      audit(actor, `Apply failed: ${name}`, failed, beforeStatus, `Failed — ${error}`);
      publish("operations.request.failed", { module: "operations", subject: { type: "Operation", id, title: failed.title, href }, payload: { operationType: failed.operationType, subject: failed.subject, error } });
      notify({
        templateId: "operations.apply-failed",
        toUserIds: [...new Set([failed.requestedBy.id, actor.id])],
        href,
        data: { title: failed.title, operation: name, decidedBy: actor.name, error },
      });
      return "Failed";
    }
  }

  update(id, { status, completedAt, reason });
  const done = get(id)!;
  if (status === "Rejected") handler.onReject?.(done.payload, { instance: done, actor });
  audit(actor, `${status}: ${name}`, done, beforeStatus, reason ? `${status} — ${reason}` : status);
  publish(`operations.request.${status.toLowerCase()}`, { module: "operations", subject: { type: "Operation", id, title: done.title, href }, payload: { operationType: done.operationType, subject: done.subject } });
  notify({
    templateId: "operations.request-completed",
    toUserIds: [done.requestedBy.id],
    href,
    data: { title: done.title, operation: name, outcome: status.toLowerCase(), decidedBy: actor.name, reason: reason ?? "" },
  });
  return status;
}

export type DecideResult = { ok: true; instance: OperationInstance } | { ok: false; reason: string };

export type DecideOptions = { /** The UI re-authenticated the approver (OTP / PIN) for this decision. */ stepUpVerified?: boolean };

/** Record a decision for the signed-in actor on the current step. */
export async function decideOperation(id: string, decision: "approve" | "reject" | "return", comment: string, options: DecideOptions = {}): Promise<DecideResult> {
  const instance = get(id);
  if (!instance) return { ok: false, reason: "Operation not found." };
  const actor = currentActor();
  const allowed = canDecide(instance, actor);
  if (!allowed.ok) return { ok: false, reason: allowed.reason! };
  if ((decision !== "approve" || getRule<boolean>("operations.commentAlwaysRequired")) && comment.trim().length < getRule<number>("operations.minCommentLength")) {
    return { ok: false, reason: `Add a comment of at least ${getRule<number>("operations.minCommentLength")} characters.` };
  }
  if (decision === "approve" && requiresStepUp(instance) && !options.stepUpVerified) {
    return { ok: false, reason: "This amount needs step-up authentication. Verify with your one-time code to approve." };
  }
  const hook = await runHooks("operations.decide.before", { instance, decision, comment, actor, stepUpVerified: options.stepUpVerified === true });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };

  const step = currentStep(instance)!;
  const record: StepDecision = { stepId: step.id, actorId: actor.id, actorName: actor.name, roleId: actor.roleId, decision, comment, at: new Date().toISOString(), adjudication: instance.awaitingAdjudication || undefined };
  const decisions = [...instance.decisions, record];
  audit(actor, `Decision (${decision}) on step "${step.name}"`, instance, undefined, comment);
  publish("operations.step.decided", { module: "operations", subject: { type: "Operation", id, title: instance.title }, payload: { stepId: step.id, decision, roleId: actor.roleId } });

  if (decision === "return") {
    update(id, { decisions });
    await finalise(id, actor, "Returned", comment);
    return { ok: true, instance: get(id)! };
  }

  const advance = async () => {
    const next = instance.stepIndex + 1;
    if (next >= instanceSteps(instance).length) {
      update(id, { decisions, awaitingAdjudication: false });
      await finalise(id, actor, "Approved", comment);
    } else {
      update(id, { decisions, stepIndex: next, status: "In progress", awaitingAdjudication: false, stepStartedAt: new Date().toISOString() });
      notifyApprovers(get(id)!);
    }
  };

  if (instance.awaitingAdjudication) {
    if (decision === "approve") await advance();
    else {
      update(id, { decisions });
      await finalise(id, actor, "Rejected", comment);
    }
  } else if (step.mode === "any") {
    if (decision === "approve") await advance();
    else {
      update(id, { decisions });
      await finalise(id, actor, "Rejected", comment);
    }
  } else {
    // Co-sign: wait for every role; a split goes to the adjudicator if configured, otherwise rejects.
    const stepDecisions = decisions.filter((d) => d.stepId === step.id && !d.adjudication);
    const remaining = step.approverRoles.filter((r) => !stepDecisions.some((d) => d.roleId === r));
    if (remaining.length > 0) {
      update(id, { decisions, status: "In progress" });
      notifyApprovers(get(id)!);
    } else if (stepDecisions.every((d) => d.decision === "approve")) await advance();
    else if (stepDecisions.some((d) => d.decision === "approve") && step.adjudicatorRole) {
      update(id, { decisions, awaitingAdjudication: true, status: "In progress" });
      publish("operations.step.dissent", { module: "operations", subject: { type: "Operation", id, title: instance.title }, payload: { stepId: step.id, adjudicator: step.adjudicatorRole } });
      notifyApprovers(get(id)!);
    } else {
      update(id, { decisions });
      await finalise(id, actor, "Rejected", comment);
    }
  }
  await runHooks("operations.decide.after", { instance: get(id)!, decision });
  return { ok: true, instance: get(id)! };
}

/** Requester withdraws a pending operation. */
export async function cancelOperation(id: string, reason: string): Promise<DecideResult> {
  const instance = get(id);
  const actor = currentActor();
  if (!instance) return { ok: false, reason: "Operation not found." };
  if (instance.requestedBy.id !== actor.id) return { ok: false, reason: "Only the requester can withdraw this request." };
  if (!["Pending", "In progress"].includes(instance.status)) return { ok: false, reason: "This request is already closed." };
  await finalise(id, actor, "Cancelled", reason);
  return { ok: true, instance: get(id)! };
}

/** Readable approver label for a step. */
export function stepApproverLabel(step: WorkflowStep): string {
  const names = step.approverRoles.map((r) => roleById[r]?.name ?? r);
  return step.mode === "all" ? `All of: ${names.join(" + ")}` : `Any of: ${names.join(", ")}`;
}

// ---------------------------------------------------------------- React hooks

/** Operations the signed-in user can act on now. */
export function useMyApprovalQueue(actor: Pick<Actor, "id" | "roleId">) {
  const instances = useOperationsStore((s) => s.instances);
  return instances.filter((i) => canDecide(i, actor).ok);
}

export function useMyRequests(actorId: string) {
  const instances = useOperationsStore((s) => s.instances);
  return instances.filter((i) => i.requestedBy.id === actorId);
}

export function useOperation(id: string | null | undefined) {
  return useOperationsStore((s) => s.instances.find((i) => i.id === id));
}

/** Latest open instance for a subject (e.g. to show "Awaiting approval" on a record). */
export function usePendingFor(subjectType: string, subjectId: string) {
  return useOperationsStore((s) => s.instances.find((i) => i.subject.type === subjectType && i.subject.id === subjectId && ["Pending", "In progress"].includes(i.status)));
}
