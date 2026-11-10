"use client";

import { useMemo } from "react";
import { capitalBase, capitalMetrics } from "../ifrs9/data";
import { useEcl } from "../ifrs9/use-ecl";
import { balanceSheet, liquidityMetrics } from "./data";

/** Balance sheet, total capital and liquidity metrics derived from the shared book (consistent with ICAAP). */
export function useMarketBase() {
  const { rows } = useEcl();
  return useMemo(() => {
    const capital = capitalMetrics(capitalBase(rows)).qualifying;
    const bs = balanceSheet(rows, capital);
    return { rows, capital, bs, liq: liquidityMetrics(bs) };
  }, [rows]);
}
