"use client";

/** Reactive views of the monitoring business rules (re-compute when a tenant rule change is approved). */
import { useMemo } from "react";
import { useRulesStore } from "@/lib/platform/rules";
import { dpdBuckets, dpdThresholds, escalationLadder } from "./logic";

/** Changes whenever any business-rule value changes — use as a memo dependency for rule-derived values. */
export function useRuleValues() {
  return useRulesStore((s) => s.values);
}

export function useLadder() {
  const v = useRuleValues();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => escalationLadder(), [v]);
}

export function useDpdLadder() {
  const v = useRuleValues();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ buckets: dpdBuckets(), t: dpdThresholds() }), [v]);
}
