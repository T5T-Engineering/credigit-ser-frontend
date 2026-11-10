"use client";

/**
 * Portfolio & MIS module store (prototype). Persists report runs, uploaded plan versions and sign-offs in this
 * browser. BACKEND SEAM: replace actions with API mutations (report-generation jobs, plan ingestion endpoint).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PlanVersion } from "./data";

export type ReportRunStatus = "Generating" | "AI-drafted — awaiting validation" | "Validated" | "Released";

export type ReportRun = {
  id: string;
  reportId: string;
  period: string;
  status: ReportRunStatus;
  generatedAt: string;
  generatedBy: string;
  validatedBy?: string;
  releasedBy?: string;
  releasedAt?: string;
  reconciled: boolean;
};

export type SignOff = { by: string; role: string; at: string };

type PortfolioState = {
  runs: ReportRun[];
  uploadedPlans: PlanVersion[];
  activePlanId: string;
  /** Sign-offs keyed by AI output id (e.g. "exec-summary", "projection-commentary"). */
  signOffs: Record<string, SignOff>;
  addRun: (run: ReportRun) => void;
  updateRun: (id: string, changes: Partial<ReportRun>) => void;
  addPlan: (plan: PlanVersion) => void;
  setActivePlan: (id: string) => void;
  signOff: (key: string, s: SignOff) => void;
  clearSignOff: (key: string) => void;
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
    }),
    {
      name: "credigit.ser.portfolio",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ runs, uploadedPlans, activePlanId, signOffs }) => ({ runs, uploadedPlans, activePlanId, signOffs }),
    },
  ),
);
