"use client";

/** Workspace selectors (dashboard + My tasks) over the shared Risk Data Spine. Pure functions + thin hooks. */
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { currentSteps } from "@/lib/workflow";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Application, ApprovalStep, CbnClass, Facility, Obligor, Sector, Task } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";
import { useApplications, useFacilities, useObligors, useSectors, useTasks } from "@/lib/data/hooks";
import { getRule, useRulesStore } from "@/lib/platform/rules";
import { dataStorage, registerDatabaseStore } from "@/lib/data/workspace-storage";

export const DAY = 24 * 60 * 60 * 1000;
export const nowMs = DEMO_NOW.getTime();

/** Applications whose current approval step(s) belong to this role (co-signers act in parallel). */
export function approvalsAwaiting(apps: Application[], roleId: RoleId | undefined): Array<{ app: Application; step: ApprovalStep }> {
  if (!roleId) return [];
  const out: Array<{ app: Application; step: ApprovalStep }> = [];
  for (const app of apps) {
    if (app.stage !== "Approval" && app.stage !== "Recommendation") continue;
    const step = currentSteps(app.approvals).find((s) => s.roleId === roleId);
    if (step) out.push({ app, step });
  }
  return out.sort((a, b) => a.app.slaDueAt.localeCompare(b.app.slaDueAt));
}

export function useApprovalsAwaiting(roleId: RoleId | undefined) {
  const apps = useApplications();
  return useMemo(() => approvalsAwaiting(apps, roleId), [apps, roleId]);
}

/** Store tasks for this role. Approval tasks are replaced by live approvals (computed from the chain). */
export function useRoleTasks(roleId: RoleId | undefined): Task[] {
  const tasks = useTasks();
  return useMemo(() => tasks.filter((t) => t.assigneeRoleId === roleId && !t.href.startsWith("/origination/application?id=")), [tasks, roleId]);
}

export const isOverdue = (iso: string) => new Date(iso).getTime() < nowMs;
/** Due within `days` (default: rule workspace.slaDueSoonDays). */
export const isDueSoon = (iso: string, days = getRule<number>("workspace.slaDueSoonDays")) => {
  const t = new Date(iso).getTime();
  return t >= nowMs && t - nowMs <= days * DAY;
};

const impaired: CbnClass[] = ["Substandard", "Doubtful", "Lost"];

export type PortfolioSnapshot = {
  outstanding: number;
  nplRatio: number;
  npl: number;
  stage2: number;
  stage3: number;
  watchlistObligors: number;
  byClass: Array<{ label: CbnClass; value: number }>;
  bySector: Array<{ id: string; label: string; value: number; sharePct: number; limitPct: number }>;
  breaches: Array<{ id: string; label: string; sharePct: number; limitPct: number }>;
  nearBreach: Array<{ id: string; label: string; sharePct: number; limitPct: number }>;
};

/**
 * Portfolio figures for the dashboard.
 * NPL ratio = outstanding classified Substandard + Doubtful + Lost ÷ total outstanding (active book).
 * Sector share = sector outstanding ÷ total outstanding, compared with the sector's limit % (Rules & parameters).
 * "Near limit" = share ≥ rule workspace.nearLimitPct % of the limit.
 */
export function portfolioSnapshot(facilities: Facility[], obligors: Obligor[], sectors: Sector[], nearLimitPct = getRule<number>("workspace.nearLimitPct")): PortfolioSnapshot {
  const live = facilities.filter((f) => f.status !== "Closed" && f.status !== "Written off");
  const obligorById = new Map(obligors.map((o) => [o.id, o]));
  const outstanding = live.reduce((s, f) => s + f.outstanding, 0) || 1;
  const sum = (pred: (f: Facility) => boolean) => live.filter(pred).reduce((s, f) => s + f.outstanding, 0);
  const npl = sum((f) => impaired.includes(f.cbnClass));
  const classes: CbnClass[] = ["Performing", "Watchlist", "Substandard", "Doubtful", "Lost"];
  const sectorTotals = new Map<string, number>();
  for (const f of live) {
    const sid = obligorById.get(f.obligorId)?.sectorId;
    if (sid) sectorTotals.set(sid, (sectorTotals.get(sid) ?? 0) + f.outstanding);
  }
  const bySector = sectors
    .map((s) => {
      const value = sectorTotals.get(s.id) ?? 0;
      return { id: s.id, label: s.name, value, sharePct: (value / outstanding) * 100, limitPct: s.limitPct };
    })
    .sort((a, b) => b.value - a.value);
  return {
    outstanding,
    npl,
    nplRatio: (npl / outstanding) * 100,
    stage2: sum((f) => f.stage === 2),
    stage3: sum((f) => f.stage === 3),
    watchlistObligors: obligors.filter((o) => o.watchlist).length,
    byClass: classes.map((c) => ({ label: c, value: sum((f) => f.cbnClass === c) })),
    bySector,
    breaches: bySector.filter((s) => s.sharePct > s.limitPct),
    nearBreach: bySector.filter((s) => s.sharePct <= s.limitPct && s.sharePct >= s.limitPct * (nearLimitPct / 100)),
  };
}

export function usePortfolioSnapshot() {
  const facilities = useFacilities();
  const obligors = useObligors();
  const sectors = useSectors();
  const nearLimitPct = useRulesStore((s) => s.values["workspace.nearLimitPct"]);
  return useMemo(() => portfolioSnapshot(facilities, obligors, sectors, typeof nearLimitPct === "number" ? nearLimitPct : undefined), [facilities, obligors, sectors, nearLimitPct]);
}

export const classTone: Record<CbnClass, "success" | "warning" | "accent" | "danger" | "neutral"> = {
  Performing: "success",
  Watchlist: "warning",
  Substandard: "accent",
  Doubtful: "danger",
  Lost: "neutral",
};

// ---------------------------------------------------------------- AI-flagged sign-offs (persisted per browser)

type WorkspaceState = {
  signedOff: Record<string, { by: string; at: string }>;
  dismissed: string[];
  signOff: (id: string, by: string) => void;
  dismiss: (id: string) => void;
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      signedOff: {},
      dismissed: [],
      signOff: (id, by) => set((s) => ({ signedOff: { ...s.signedOff, [id]: { by, at: new Date().toISOString() } } })),
      dismiss: (id) => set((s) => ({ dismissed: [...s.dismissed, id] })),
    }),
    { name: "credigit.ser.workspace", storage: dataStorage(), partialize: ({ signedOff, dismissed }) => ({ signedOff, dismissed }) },
  ),
);

registerDatabaseStore(useWorkspaceStore);
