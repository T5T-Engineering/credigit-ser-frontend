"use client";

/**
 * Portfolio & MIS module store (prototype). Persists report runs, uploaded plan versions, plan approval state,
 * AI-output adoptions and the last-evaluated limit status in this browser.
 *
 * Approval outcomes (release, plan approval, adoption, sign-off) are written ONLY by the Operations workflow
 * `apply` / `onReject` handlers in ./platform.ts and ../executive/platform.ts — never directly by pages.
 * BACKEND SEAM: replace actions with API mutations (report-generation jobs, plan ingestion endpoint).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlanVersion } from "./data";
import type { LimitStatus } from "./selectors";
import { dataStorage, registerDatabaseStore } from "@/lib/data/workspace-storage";

export type ReportRunStatus = "Generating" | "AI-drafted — awaiting validation" | "Validated" | "Submitted for release" | "Returned for correction" | "Released";

/** Approval state of a plan version (seeded versions start from their seed status). */
export type PlanStatus = "Board-approved" | "Approved" | "Draft" | "Uploaded — validating" | "Submitted for approval" | "Rejected" | "Superseded";

export type ReportRun = {
  id: string;
  reportId: string;
  period: string;
  status: ReportRunStatus;
  generatedAt: string;
  generatedBy: string;
  generatedById?: string;
  validatedBy?: string;
  validatedById?: string;
  releasedBy?: string;
  releasedAt?: string;
  reconciled: boolean;
  /** Operations instance that released (or is releasing) this run. */
  operationId?: string;
  returnReason?: string;
};

export type SignOff = { by: string; role: string; at: string; operationId?: string };

type PortfolioState = {
  runs: ReportRun[];
  uploadedPlans: PlanVersion[];
  activePlanId: string;
  /** Sign-offs keyed by AI output id (e.g. "exec-summary", "projection-commentary"). */
  signOffs: Record<string, SignOff>;
  /** Plan approval state by plan id (overrides the seed status). */
  planStatus: Record<string, PlanStatus>;
  /** Plan version approved through Operations and in force (variance baseline). */
  operativePlanId: string;
  /** Last evaluated status per monitored limit (to raise alerts on transitions only). */
  limitStates: Record<string, LimitStatus>;
  addRun: (run: ReportRun) => void;
  updateRun: (id: string, changes: Partial<ReportRun>) => void;
  addPlan: (plan: PlanVersion) => void;
  setActivePlan: (id: string) => void;
  signOff: (key: string, s: SignOff) => void;
  clearSignOff: (key: string) => void;
  setPlanStatus: (id: string, status: PlanStatus) => void;
  setOperativePlan: (id: string) => void;
  setLimitState: (id: string, status: LimitStatus) => void;
};

/** Seed report runs so the catalogue shows history on first load. */
const seedRuns: ReportRun[] = [
  { id: "RUN-0931", reportId: "RPT-SOL", period: "Oct 2026", status: "Released", generatedAt: "2026-11-03T07:10:00+01:00", generatedBy: "Portfolio & MIS Officer", validatedBy: "Portfolio & MIS Officer", releasedBy: "Head of Risk", releasedAt: "2026-11-04T16:00:00+01:00", reconciled: true },
  { id: "RUN-0932", reportId: "RPT-PRU", period: "Oct 2026", status: "Released", generatedAt: "2026-11-03T07:12:00+01:00", generatedBy: "Portfolio & MIS Officer", validatedBy: "Portfolio & MIS Officer", releasedBy: "Head of Risk", releasedAt: "2026-11-04T16:05:00+01:00", reconciled: true },
  { id: "RUN-0933", reportId: "RPT-LEX", period: "Oct 2026", status: "Validated", generatedAt: "2026-11-03T07:15:00+01:00", generatedBy: "Portfolio & MIS Officer", validatedBy: "Portfolio & MIS Officer", reconciled: true },
  { id: "RUN-0934", reportId: "RPT-TOP", period: "Oct 2026", status: "Released", generatedAt: "2026-11-03T07:20:00+01:00", generatedBy: "Portfolio & MIS Officer", validatedBy: "Portfolio & MIS Officer", releasedBy: "Chief Risk Officer", releasedAt: "2026-11-05T09:30:00+01:00", reconciled: true },
  { id: "RUN-0935", reportId: "RPT-LSU", period: "Week 45, 2026", status: "AI-drafted — awaiting validation", generatedAt: "2026-11-09T18:00:00+01:00", generatedBy: "Scheduled (Rules & Parameters cadence)", reconciled: false },
  { id: "RUN-0936", reportId: "RPT-DPD", period: "9 Nov 2026", status: "Released", generatedAt: "2026-11-10T06:00:00+01:00", generatedBy: "Scheduled (Rules & Parameters cadence)", validatedBy: "Portfolio & MIS Officer", releasedBy: "Portfolio & MIS Officer", releasedAt: "2026-11-10T07:30:00+01:00", reconciled: true },
  { id: "RUN-0921", reportId: "RPT-WARR", period: "Q3 2026", status: "Released", generatedAt: "2026-10-06T08:00:00+01:00", generatedBy: "Portfolio & MIS Officer", validatedBy: "Portfolio & MIS Officer", releasedBy: "Chief Risk Officer", releasedAt: "2026-10-09T11:00:00+01:00", reconciled: true },
  { id: "RUN-0922", reportId: "RPT-BRC", period: "Q3 2026", status: "Released", generatedAt: "2026-10-07T08:00:00+01:00", generatedBy: "Head of Risk", validatedBy: "Head of Risk", releasedBy: "Chief Risk Officer", releasedAt: "2026-10-12T10:00:00+01:00", reconciled: true },
  { id: "RUN-0923", reportId: "RPT-NPL", period: "Q3 2026", status: "Released", generatedAt: "2026-10-06T08:10:00+01:00", generatedBy: "Portfolio & MIS Officer", validatedBy: "Portfolio & MIS Officer", releasedBy: "Head of Risk", releasedAt: "2026-10-08T15:00:00+01:00", reconciled: true },
];

export const usePortfolioStore = create<PortfolioState>()(
  persist(
    (set) => ({
      runs: seedRuns,
      uploadedPlans: [],
      activePlanId: "PLAN-2026-V1",
      signOffs: {},
      planStatus: {},
      operativePlanId: "PLAN-2026-V1",
      limitStates: {},
      addRun: (run) => set((s) => ({ runs: [run, ...s.runs] })),
      updateRun: (id, changes) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...changes } : r)) })),
      addPlan: (plan) => set((s) => ({ uploadedPlans: [plan, ...s.uploadedPlans], activePlanId: plan.id })),
      setActivePlan: (id) => set({ activePlanId: id }),
      signOff: (key, so) => set((s) => ({ signOffs: { ...s.signOffs, [key]: so } })),
      clearSignOff: (key) =>
        set((s) => {
          const next = { ...s.signOffs };
          delete next[key];
          return { signOffs: next };
        }),
      setPlanStatus: (id, status) => set((s) => ({ planStatus: { ...s.planStatus, [id]: status } })),
      setOperativePlan: (id) => set({ operativePlanId: id }),
      setLimitState: (id, status) => set((s) => ({ limitStates: { ...s.limitStates, [id]: status } })),
    }),
    {
      name: "credigit.ser.portfolio",
      version: 1,
      storage: dataStorage(),
      partialize: ({ runs, uploadedPlans, activePlanId, signOffs, planStatus, operativePlanId, limitStates }) => ({ runs, uploadedPlans, activePlanId, signOffs, planStatus, operativePlanId, limitStates }),
    },
  ),
);

registerDatabaseStore(usePortfolioStore);
