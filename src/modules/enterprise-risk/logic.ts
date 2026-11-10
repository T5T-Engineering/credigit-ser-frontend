"use client";

import { useMemo } from "react";
import { useFacilities, useObligors, useSectors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { getRule } from "@/lib/platform/rules";
import { netLoss } from "../operational-risk/data";
import { useKriReadings } from "../operational-risk/logic";
import { orKeys } from "../operational-risk/platform";
import { useOpRisk } from "../operational-risk/store";
import { useRuleValues } from "../operational-risk/shared";
import { appetiteMetrics, appetiteRag, spineFigures } from "./data";

/** Risk appetite scorecard computed from the Risk Data Spine + Operational Risk module; limits are business rules. */
export function useAppetite() {
  const facilities = useFacilities();
  const obligors = useObligors();
  const sectors = useSectors();
  const lossEvents = useOpRisk((s) => s.lossEvents);
  const readings = useKriReadings();
  const rules = useRuleValues();
  return useMemo(() => {
    const fig = spineFigures(facilities, obligors, sectors);
    const year = DEMO_NOW.getFullYear();
    const netLossYtd = lossEvents.filter((e) => new Date(e.discoveredAt).getFullYear() === year).reduce((s, e) => s + netLoss(e), 0);
    const metrics = appetiteMetrics(fig, { netLossYtd, annualLossLimit: getRule<number>(orKeys.annualNetLimit), redKris: readings.filter((k) => k.rag === "red").length, totalKris: readings.length }).map((m) => ({ ...m, rag: appetiteRag(m) }));
    return { fig, metrics, readings };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rules` is the change signal for getRule()
  }, [facilities, obligors, sectors, lossEvents, readings, rules]);
}
