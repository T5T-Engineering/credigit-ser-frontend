"use client";

/**
 * Operations area — view models and pure helpers that map the platform engine (src/lib/platform/*) to the
 * library's operations components (@credigit/web-ui → operations group).
 */
import { useSyncExternalStore } from "react";
import type {
  DurationValue,
  MultiSelectOption,
  OperationStatus as UiOperationStatus,
  OperationStep,
  RuleSummary,
  RuleValue as UiRuleValue,
  WorkflowStep as UiWorkflowStep,
} from "@credigit/web-ui";
import { durationToMinutes, formatRuleValue, isDurationValue } from "@credigit/web-ui";
import { dateTime } from "@/lib/format";
import { roleById, roles, type RoleId } from "@/lib/rbac/roles";
import {
  getDefinition,
  stepDueAt,
  useOperationsStore,
  type OperationInstance,
  type OperationStatus,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@/lib/platform/operations";
import type { RuleChange, RuleDefinition, RuleValue } from "@/lib/platform/rules";

export { largestAmount } from "./platform";

export const OPEN_STATUSES: OperationStatus[] = ["Pending", "In progress"];
export const isOpen = (i: OperationInstance) => OPEN_STATUSES.includes(i.status);

const statusMap: Record<OperationStatus, UiOperationStatus> = {
  Pending: "pending",
  "In progress": "in_progress",
  Approved: "approved",
  Rejected: "rejected",
  Returned: "returned",
  Cancelled: "cancelled",
};
export const uiStatus = (s: OperationStatus) => statusMap[s];

/** Role options (value = role id, label = role name) for step editors, diagrams and roles rules. */
export const roleOptions: MultiSelectOption[] = roles.map((r) => ({ value: r.id, label: r.name, description: r.group }));
export const roleName = (id: string) => roleById[id as RoleId]?.name ?? id;

export const toUiSteps = (steps: WorkflowStep[]): UiWorkflowStep[] => steps.map((s) => ({ ...s, approverRoles: [...s.approverRoles] }));
export const fromUiSteps = (steps: UiWorkflowStep[]): WorkflowStep[] =>
  steps.map((s) => ({
    id: s.id,
    name: s.name.trim(),
    approverRoles: s.approverRoles as RoleId[],
    mode: s.mode,
    slaHours: s.slaHours,
    ...(s.mode === "all" && s.adjudicatorRole ? { adjudicatorRole: s.adjudicatorRole as RoleId } : {}),
  }));

/** Safe definition lookup (operation types registered by a module that later disappeared). */
export function safeDefinition(type: string): WorkflowDefinition | undefined {
  try {
    return getDefinition(type);
  } catch {
    return undefined;
  }
}

export function safeDueAt(i: OperationInstance): string | undefined {
  try {
    return isOpen(i) ? stepDueAt(i) : undefined;
  } catch {
    return undefined;
  }
}

/** Build the OperationTimeline steps (incl. decisions and adjudication) from an instance + its definition. */
export function timelineSteps(i: OperationInstance, def: WorkflowDefinition | undefined): OperationStep[] {
  const steps = def?.steps ?? [];
  const finalStatus = statusMap[i.status];
  return steps.map((s, idx) => {
    const decisions = i.decisions
      .filter((d) => d.stepId === s.id)
      .map((d, n) => ({
        id: `${s.id}-${n}`,
        actor: { name: d.actorName, role: `${roleName(d.roleId)}${d.adjudication ? " · adjudicator" : ""}` },
        decision: (d.decision === "approve" ? "approved" : d.decision === "reject" ? "rejected" : "returned") as "approved" | "rejected" | "returned",
        time: dateTime(d.at),
        comment: d.comment || undefined,
      }));
    let status: OperationStep["status"] = "pending";
    if (idx < i.stepIndex) status = "approved";
    else if (idx === i.stepIndex) {
      if (isOpen(i)) status = "current";
      else if (finalStatus === "approved") status = "approved";
      else if (finalStatus === "rejected") status = "rejected";
      else if (finalStatus === "returned") status = "returned";
      else status = "skipped";
    } else if (!isOpen(i)) status = "skipped";
    const approvers = s.mode === "all" ? s.approverRoles.map(roleName).join(" + ") : s.approverRoles.map(roleName).join(" / ");
    return {
      id: s.id,
      name: s.name,
      status,
      mode: s.mode,
      approvers: `${approvers}${s.adjudicatorRole ? ` · adjudicator: ${roleName(s.adjudicatorRole)}` : ""}${idx === i.stepIndex && i.awaitingAdjudication ? " — awaiting adjudication" : ""}`,
      decisions,
      dueAt: status === "current" ? safeDueAt(i) : undefined,
      meta: `SLA ${s.slaHours} h`,
    };
  });
}

/** Payload → readable facts (top-level; nested values summarised). */
export function payloadFacts(payload: unknown): { label: string; value: string; mono?: boolean }[] {
  if (payload === null || payload === undefined) return [];
  if (typeof payload !== "object") return [{ label: "Value", value: String(payload) }];
  return Object.entries(payload as Record<string, unknown>).map(([k, v]) => ({
    label: humanise(k),
    value: readable(v),
    mono: typeof v === "number",
  }));
}

function humanise(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function readable(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 4 }).format(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== "object")) return v.map(String).join(", ") || "—";
    return `${v.length} item(s)`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    if (typeof o.title === "string") return o.title;
    return `${Object.keys(o).length} field(s)`;
  }
  return String(v);
}

// ---------------------------------------------------------------- rules value mapping

const minutesPer = { minutes: 1, hours: 60, days: 1440 } as const;

/** Registry value → RuleValueInput value. */
export function toInputValue(def: RuleDefinition, value: RuleValue): UiRuleValue {
  if (def.type === "duration") return { amount: Number(value), unit: def.durationUnit ?? "minutes" };
  return value;
}

/** RuleValueInput value → registry value (duration → number in the rule's durationUnit). */
export function fromInputValue(def: RuleDefinition, value: UiRuleValue): RuleValue | null {
  if (value === null) return null;
  if (def.type === "duration") {
    if (!isDurationValue(value)) return typeof value === "number" ? value : null;
    const minutes = durationToMinutes(value as DurationValue);
    return minutes / minutesPer[def.durationUnit ?? "minutes"];
  }
  if (isDurationValue(value)) return null;
  return value as RuleValue;
}

/** Bounds for RuleValueInput (durations in total minutes). */
export function inputBounds(def: RuleDefinition): { min?: number; max?: number } {
  if (def.type !== "duration") return { min: def.min, max: def.max };
  const f = minutesPer[def.durationUnit ?? "minutes"];
  return { min: def.min !== undefined ? def.min * f : undefined, max: def.max !== undefined ? def.max * f : undefined };
}

export function ruleOptions(def: RuleDefinition) {
  if (def.type === "roles") return roleOptions;
  return def.options;
}

export function formatValue(def: RuleDefinition, value: RuleValue | undefined): string {
  if (value === undefined) return "—";
  return formatRuleValue(def.type, toInputValue(def, value), { unit: def.unit, options: ruleOptions(def) });
}

export function ruleSummary(def: RuleDefinition, value: RuleValue, pending?: OperationInstance, lastChange?: RuleChange): RuleSummary {
  const proposed = pending ? (pending.payload as { value: RuleValue }).value : undefined;
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    type: def.type,
    value: toInputValue(def, value),
    defaultValue: toInputValue(def, def.default),
    unit: def.unit,
    options: ruleOptions(def),
    scope: def.requiresApproval === false ? { label: "Direct", tone: "warning" } : "Tenant",
    source: def.source,
    pending: pending
      ? { formattedValue: formatValue(def, proposed), requestedBy: pending.requestedBy.name, requestedAt: dateTime(pending.requestedAt), href: `/operations/item?id=${pending.id}` }
      : undefined,
    changedBy: lastChange?.byName,
    changedAt: lastChange ? dateTime(lastChange.at) : undefined,
  };
}

// ---------------------------------------------------------------- clock

const listeners = new Set<() => void>();
let clockNow = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    clockNow = Date.now();
    timer = setInterval(() => {
      clockNow = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function readClock() {
  if (!clockNow) clockNow = Date.now();
  return clockNow;
}

/** Wall clock (ms) ticking every 30 s; SLAs run on real timestamps because instances do. 0 before mount. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, readClock, () => 0);
}

/** Effective workflow definitions; re-renders when tenant overrides change. */
export function useDefinitions(): Record<string, WorkflowDefinition> {
  return useOperationsStore((s) => s.definitions);
}

/** Whether the persisted operations store has loaded (loading state). */
export function useOpsHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => useOperationsStore.persist.onFinishHydration(cb),
    () => useOperationsStore.persist.hasHydrated(),
    () => false,
  );
}

export const MS_PER_HOUR = 3_600_000;

/** Name of the current step (with adjudication marker) for open instances. */
export function currentStepName(i: OperationInstance, def: WorkflowDefinition | undefined): string | undefined {
  if (!isOpen(i)) return undefined;
  const step = def?.steps[i.stepIndex];
  if (!step) return undefined;
  return i.awaitingAdjudication && step.adjudicatorRole ? `${step.name} — adjudication by ${roleName(step.adjudicatorRole)}` : step.name;
}

/** One-line description of a workflow's steps, e.g. "Risk review (Head of Risk / CRO, 24 h) → …". */
export function stepApproverSummary(steps: WorkflowStep[]): string {
  if (!steps.length) return "no steps";
  return steps.map((s) => `${s.name} (${s.approverRoles.map(roleName).join(s.mode === "all" ? " + " : " / ")}, ${s.slaHours} h)`).join(" → ");
}
