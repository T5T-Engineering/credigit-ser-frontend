"use client";

import { useMemo } from "react";
import { useCollateral, useFacilities, useObligors, useSectors } from "@/lib/data/hooks";
import { useRulesStore } from "@/lib/platform/rules";
import { runEcl, type EngineInput } from "./data";

/** Engine inputs from the shared Risk Data Spine. */
export function useEngineInput(): EngineInput {
  const facilities = useFacilities();
  const obligors = useObligors();
  const collateral = useCollateral();
  const sectors = useSectors();
  return useMemo(() => ({ facilities, obligors, collateral, sectors }), [facilities, obligors, collateral, sectors]);
}

/** Facility-level ECL rows for the in-scope book. Recomputes when business rules change (engine reads rules at call time). */
export function useEcl() {
  const input = useEngineInput();
  const rules = useRulesStore((s) => s.values);
  const rows = useMemo(() => runEcl(input), [input, rules]); // eslint-disable-line react-hooks/exhaustive-deps
  return { input, rows, rules };
}
