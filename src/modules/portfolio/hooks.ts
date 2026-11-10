"use client";

import { useMemo } from "react";
import { useApplications, useDbActions, useFacilities, useObligors, useSectors } from "@/lib/data/hooks";
import { useRole, useSession } from "@/lib/auth/session";
import { portfolioHistory } from "./data";
import { computeWarr, largeExposures, obligorExposures, pipelineTotals, portfolioTotals, sectorExposures, warrRows } from "./selectors";

/** Memoised portfolio model over the shared spine — one place so every page shows the same figures. */
export function usePortfolioModel() {
  const facilities = useFacilities();
  const obligors = useObligors();
  const sectors = useSectors();
  const applications = useApplications();
  return useMemo(() => {
    const totals = portfolioTotals(facilities);
    const exposures = obligorExposures(facilities, obligors, sectors);
    const sectorRows = sectorExposures(facilities, obligors, sectors);
    const large = largeExposures(exposures);
    const pipeline = pipelineTotals(applications);
    const rows = warrRows(facilities, obligors);
    const warr = computeWarr(rows);
    const history = portfolioHistory(facilities, obligors, pipeline.value);
    return { facilities, obligors, sectors, applications, totals, exposures, sectorRows, large, pipeline, rows, warr, history };
  }, [facilities, obligors, sectors, applications]);
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
