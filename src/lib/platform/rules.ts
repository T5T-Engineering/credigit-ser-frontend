"use client";

/**
 * Business rules registry (invariant 8: no hard-coded values). Every limit, threshold, rate, duration and
 * configurable mapping is a typed rule with a default, bounds and a PRD reference. Code reads values with
 * `getRule` / `useRule`; changes are requested with `requestRuleChange`, which routes through the Operations
 * workflow ("rule.change") and is applied, audited and published as an event only when approved.
 *
 * Modules register their rules in `src/modules/<module>/platform.ts` (imported by src/lib/platform/registry.ts).
 * BACKEND SEAM: values come from the Rules & Parameters Engine API.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type RuleType = "number" | "percent" | "money" | "duration" | "boolean" | "enum" | "text" | "url" | "list" | "roles";

export type RuleValue = number | string | boolean | string[];

export type RuleDefinition<V extends RuleValue = RuleValue> = {
  /** "<module>.<name>", e.g. "origination.stepUpThresholdNgn". */
  key: string;
  label: string;
  description: string;
  module: string;
  category: string;
  type: RuleType;
  default: V;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** Duration unit for `duration` rules. */
  durationUnit?: "minutes" | "hours" | "days";
  /** PRD section, or "Tenant parameter (demo value)". */
  source: string;
  /** Changes need approval through the Operations workflow (default true). */
  requiresApproval?: boolean;
};

export type RuleChange = { key: string; before: RuleValue; after: RuleValue; byId: string; byName: string; at: string; reason?: string; operationId?: string };

type RulesState = { values: Record<string, RuleValue>; history: RuleChange[] };

export const useRulesStore = create<RulesState>()(
  persist((): RulesState => ({ values: {}, history: [] }), { name: "credigit.ser.rules", storage: createJSONStorage(() => localStorage) }),
);

const definitions = new Map<string, RuleDefinition>();

export function defineRules(defs: RuleDefinition[]) {
  for (const d of defs) definitions.set(d.key, d);
}

export function ruleDefinitions(): RuleDefinition[] {
  return [...definitions.values()].sort((a, b) => a.module.localeCompare(b.module) || a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

export function ruleDefinition(key: string): RuleDefinition | undefined {
  return definitions.get(key);
}

/** Current value (tenant override or default). Throws for unknown keys so typos surface in development. */
export function getRule<V extends RuleValue>(key: string): V {
  const def = definitions.get(key);
  if (!def) throw new Error(`Unknown business rule "${key}" — define it with defineRules().`);
  const stored = useRulesStore.getState().values[key];
  return (stored ?? def.default) as V;
}

/** Reactive rule value for components. */
export function useRule<V extends RuleValue>(key: string): V {
  const stored = useRulesStore((s) => s.values[key]);
  const def = definitions.get(key);
  if (!def) throw new Error(`Unknown business rule "${key}" — define it with defineRules().`);
  return (stored ?? def.default) as V;
}

export function validateRuleValue(def: RuleDefinition, value: RuleValue): string | null {
  if (["number", "percent", "money", "duration"].includes(def.type)) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
    if (def.min !== undefined && value < def.min) return `Must be at least ${def.min}.`;
    if (def.max !== undefined && value > def.max) return `Must be at most ${def.max}.`;
  }
  if (def.type === "enum" && def.options && !def.options.some((o) => o.value === value)) return "Choose one of the options.";
  if (def.type === "url" && (typeof value !== "string" || !/^https?:\/\/[^\s]+$/.test(value))) return "Enter a full http(s) URL.";
  if (def.type === "boolean" && typeof value !== "boolean") return "Must be on or off.";
  if ((def.type === "list" || def.type === "roles") && !Array.isArray(value)) return "Must be a list.";
  return null;
}

/** Apply a rule value directly. Only the Operations workflow (on approval) and seeding should call this. */
export function applyRuleValue(key: string, value: RuleValue, by: { id: string; name: string }, meta: { reason?: string; operationId?: string } = {}) {
  const before = getRule(key);
  useRulesStore.setState((s) => ({
    values: { ...s.values, [key]: value },
    history: [{ key, before, after: value, byId: by.id, byName: by.name, at: new Date().toISOString(), ...meta }, ...s.history],
  }));
}

export function resetRules() {
  useRulesStore.setState({ values: {}, history: [] });
}
