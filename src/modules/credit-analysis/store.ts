"use client";

/**
 * Credit Analysis prototype store: APPROVED analyst enrichment adjustments, advisory sign-offs and Industry
 * Life-Cycle gating overrides (refresh timestamps and resulting cardinal scores are written back to the shared
 * obligor record), persisted in this browser. Writes happen only from the Operations workflow `apply` handlers
 * in ./platform.ts — never directly from pages.
 * BACKEND SEAM: replace with the 360 RAR engine API (assessment, parameter overrides with rationale, refresh
 * job, advisory note, gating overrides) — page code reads through the hooks below.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ParamOverride } from "./logic";
import { dataStorage, registerDatabaseStore } from "@/lib/data/workspace-storage";

export type AdvisorySignOff = {
  text: string;
  /** Credit Analyst who prepared and submitted the note. */
  signedOffBy: string;
  at: string;
  /** Posture label at sign-off (to detect a later change). */
  postureLabel: string;
  /** Reviewer who approved the sign-off in Operations. */
  approvedBy?: string;
  operationId?: string;
};

export type GatingOverride = {
  applicationId: string;
  obligorId: string;
  rationale: string;
  requestedBy: string;
  approvedBy: string;
  at: string;
  operationId: string;
};

type State = {
  overrides: Record<string, Record<string, ParamOverride>>;
  advisory: Record<string, AdvisorySignOff>;
  gatingOverrides: Record<string, GatingOverride>;
  setOverrides: (obligorId: string, overrides: Record<string, ParamOverride>) => void;
  signAdvisory: (obligorId: string, record: AdvisorySignOff) => void;
  setGatingOverride: (record: GatingOverride) => void;
  resetAll: () => void;
};

export const useCreditAnalysis = create<State>()(
  persist(
    (set) => ({
      overrides: {},
      advisory: {},
      gatingOverrides: {},
      setOverrides: (id, overrides) => set((s) => ({ overrides: { ...s.overrides, [id]: overrides } })),
      signAdvisory: (id, record) => set((s) => ({ advisory: { ...s.advisory, [id]: record } })),
      setGatingOverride: (record) => set((s) => ({ gatingOverrides: { ...s.gatingOverrides, [record.applicationId]: record } })),
      resetAll: () => set({ overrides: {}, advisory: {}, gatingOverrides: {} }),
    }),
    {
      name: "credigit.ser.credit-analysis",
      version: 2,
      storage: dataStorage(),
      partialize: ({ overrides, advisory, gatingOverrides }) => ({ overrides, advisory, gatingOverrides }),
      migrate: (persisted) => ({ gatingOverrides: {}, ...(persisted as object) }) as State,
    },
  ),
);

const empty: Record<string, ParamOverride> = {};
export const useOverrides = (id: string) => useCreditAnalysis((s) => s.overrides[id] ?? empty);
export const useAdvisorySignOff = (id: string) => useCreditAnalysis((s) => s.advisory[id]);
export const useGatingOverrides = () => useCreditAnalysis((s) => s.gatingOverrides);

registerDatabaseStore(useCreditAnalysis);
