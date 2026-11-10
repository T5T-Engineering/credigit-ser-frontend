"use client";

import { useMemo } from "react";
import { useFacilities, useObligors, useSectors } from "@/lib/data/hooks";
import { kris, lossLimits, netLoss } from "../operational-risk/data";
import { readKris } from "../operational-risk/logic";
import { useOpRisk } from "../operational-risk/store";
import { appetiteMetrics, appetiteRag, spineFigures } from "./data";

/** Risk appetite scorecard computed from the Risk Data Spine + Operational Risk module. */
export function useAppetite() {
  const facilities = useFacilities();
  const obligors = useObligors();
  const sectors = useSectors();
  const lossEvents = useOpRisk((s) => s.lossEvents);
  const escalations = useOpRisk((s) => s.escalations);
  const changes = useOpRisk((s) => s.thresholdChanges);
  return useMemo(() => {
    const fig = spineFigures(facilities, obligors, sectors);
    const readings = readKris(kris, escalations, changes);
    const netLossYtd = lossEvents.filter((e) => new Date(e.discoveredAt).getFullYear() === 2026).reduce((s, e) => s + netLoss(e), 0);
    const metrics = appetiteMetrics(fig, { netLossYtd, annualLossLimit: lossLimits.annualNet, redKris: readings.filter((k) => k.rag === "red").length, totalKris: readings.length }).map((m) => ({ ...m, rag: appetiteRag(m) }));
    return { fig, metrics, readings };
  }, [facilities, obligors, sectors, lossEvents, escalations, changes]);
}
