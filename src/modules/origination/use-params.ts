"use client";

/** Reactive business-rule access for origination components (re-render when a rule changes). */
import { useRule, useRulesStore } from "@/lib/platform/rules";

export function useStepUpThreshold(): number {
  return useRule<number>("approvals.stepUpThresholdNgn");
}

/**
 * Subscribe a component to rule changes. Origination helpers read rules with `getRule()` at call time; calling this
 * once in a page makes those reads re-run when a tenant rule changes.
 */
export function useRulesVersion() {
  return useRulesStore((s) => s.values);
}
