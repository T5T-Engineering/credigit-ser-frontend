"use client";

import { useEffect, useMemo } from "react";
import { useApplications, useDbActions, useFacilities, useObligors, useSectors } from "@/lib/data/hooks";
import { useRole, useSession } from "@/lib/auth/session";
import { useRulesStore } from "@/lib/platform/rules";
import { portfolioHistory } from "./data";
import { raiseLimitAlert, type LimitAlert } from "./platform";
import { usePortfolioStore } from "./store";
import { pct, moneyShort } from "@/lib/format";
import { computeWarr, largeExposures, limitStatus, obligorExposures, param, pipelineTotals, portfolioTotals, sectorExposures, warrRows } from "./selectors";

/** Memoised portfolio model over the shared spine — one place so every page shows the same figures. */
export function usePortfolioModel() {
  const facilities = useFacilities();
  const obligors = useObligors();
  const sectors = useSectors();
  const applications = useApplications();
  // Selectors read business rules at call time — recompute when any rule changes.
  const rules = useRulesStore((s) => s.values);
  return useMemo(() => {
    const totals = portfolioTotals(facilities);
    const exposures = obligorExposures(facilities, obligors, sectors);
    const sectorRows = sectorExposures(facilities, obligors, sectors);
    const large = largeExposures(exposures);
    const pipeline = pipelineTotals(applications);
    const rows = warrRows(facilities, obligors);
    const warr = computeWarr(rows);
    const history = portfolioHistory(facilities, obligors, pipeline.value);
    return { facilities, obligors, sectors, applications, totals, exposures, sectorRows, large, pipeline, rows, warr, history, rules };
  }, [facilities, obligors, sectors, applications, rules]);
}

/** Current actor for audit-log entries. */
export function useActor() {
  const user = useSession((s) => s.user);
  const role = useRole();
  const { log } = useDbActions();
  return {
    name: user?.name ?? "Demo user",
    roleName: role?.name ?? "—",
    roleId: role?.id,
    log: (action: string, entityType: string, entityId: string, before?: string, after?: string) => {
      if (!user || !role) return;
      log({ actorId: user.id, actorName: user.name, roleId: role.id, action, entityType, entityId, before, after });
    },
  };
}

/** Current limit statuses (sector, single obligor at/above early warning, aggregate large exposures, WARR). */
export function limitAlerts(m: Pick<ReturnType<typeof usePortfolioModel>, "sectorRows" | "exposures" | "large" | "warr">): LimitAlert[] {
  const shf = param("shareholdersFunds");
  const sol = (shf * param("singleObligorLimitPct")) / 100;
  const ceiling = param("warrCeiling");
  const early = param("warrEarlyWarning");
  const store = usePortfolioStore.getState().limitStates;
  const obligorIds = new Set(Object.keys(store).filter((k) => k.startsWith("OBL:")));
  return [
    ...m.sectorRows.map((s): LimitAlert => ({ id: `SEC:${s.sector.id}`, kind: "Sector", name: s.sector.name, status: s.status, utilisation: `${pct(s.utilisationPct, 0)} of limit (${pct(s.sharePct)} of book)`, limit: `${pct(s.limitPct, 0)} of book` })),
    // Obligors: those flagged now, plus previously flagged ones (so a return within limit is recorded).
    ...m.exposures
      .filter((e) => limitStatus(e.solUtilisationPct) !== "Within limit" || obligorIds.has(`OBL:${e.obligor.id}`))
      .map((e): LimitAlert => ({ id: `OBL:${e.obligor.id}`, kind: "Single obligor", name: e.obligor.name, status: limitStatus(e.solUtilisationPct), utilisation: `${pct(e.solUtilisationPct, 0)} of limit`, limit: `${moneyShort(sol)} (${param("singleObligorLimitPct")}% SHF)` })),
    { id: "LEX:AGG", kind: "Large exposures", name: "Aggregate large exposures", status: limitStatus(m.large.utilisationPct), utilisation: `${pct(m.large.utilisationPct, 0)} of ceiling`, limit: `${param("aggregateLargeExposureMultiple")}× SHF (${moneyShort(m.large.ceiling)})` },
    { id: "WARR:BOOK", kind: "WARR", name: "Whole-book WARR", status: m.warr.warr >= ceiling ? "Breach" : m.warr.warr >= early ? "Near breach" : "Within limit", utilisation: m.warr.warr.toFixed(2), limit: `ceiling ${ceiling} · early warning ${early}` },
  ];
}

/**
 * Limit monitor: compares current limit statuses with the last evaluated ones and raises an alert (audit,
 * event, notification) on each transition. Runs on the dashboards, limits and executive views.
 * BACKEND SEAM: the limit-monitoring job evaluates on every spine refresh and raises the same events.
 */
export function useLimitMonitor(m: ReturnType<typeof usePortfolioModel>) {
  const user = useSession((s) => s.user);
  useEffect(() => {
    if (!user) return;
    const known = usePortfolioStore.getState().limitStates;
    for (const a of limitAlerts(m)) {
      const prev = known[a.id];
      if (prev === a.status || (!prev && a.status === "Within limit")) continue;
      void raiseLimitAlert(a, prev);
    }
  }, [m, user]);
}
