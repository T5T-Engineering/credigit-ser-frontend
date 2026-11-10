"use client";

import { useMemo } from "react";
import { capitalBase, capitalMetrics } from "../ifrs9/data";
import { useRulesVersion } from "../ifrs9/governance";
import { useEcl } from "../ifrs9/use-ecl";
import { balanceSheet, liquidityMetrics } from "./data";

/** Balance sheet, total capital and liquidity metrics derived from the shared book (consistent with ICAAP). */
export function useMarketBase() {
  const { rows } = useEcl();
  const rules = useRulesVersion();
  return useMemo(() => {
    void rules; // recompute when business rules change (engine reads them with getRule)
    const capital = capitalMetrics(capitalBase(rows)).qualifying;
    const bs = balanceSheet(rows, capital);
    return { rows, capital, bs, liq: liquidityMetrics(bs), rules };
  }, [rows, rules]);
}
