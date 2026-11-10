"use client";

import { useMemo } from "react";
import { useCollateral, useFacilities, useObligors, useSectors } from "@/lib/data/hooks";
import { runEcl, type EngineInput } from "./data";

/** Engine inputs from the shared Risk Data Spine. */
export function useEngineInput(): EngineInput {
  const facilities = useFacilities();
  const obligors = useObligors();
  const collateral = useCollateral();
  const sectors = useSectors();
  return useMemo(() => ({ facilities, obligors, collateral, sectors }), [facilities, obligors, collateral, sectors]);
}

/** Facility-level ECL rows for the in-scope book. */
export function useEcl() {
  const input = useEngineInput();
  const rows = useMemo(() => runEcl(input), [input]);
  return { input, rows };
}
