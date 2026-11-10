"use client";

/**
 * Credit Analysis prototype store: analyst enrichment adjustments and advisory sign-offs (refresh timestamps and
 * resulting cardinal scores are written back to the shared obligor record),
 * persisted in this browser. BACKEND SEAM: replace with the 360 RAR engine API (assessment, parameter
 * overrides with rationale, refresh job, advisory note) — page code reads through the hooks below.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ParamOverride } from "./logic";

export type AdvisorySignOff = {
  text: string;
  signedOffBy: string;
  at: string;
  /** Posture label at sign-off (to detect a later change). */ postureLabel: string;
};

type State = {
  overrides: Record<string, Record<string, ParamOverride>>;
  advisory: Record<string, AdvisorySignOff>;
  setOverrides: (obligorId: string, overrides: Record<string, ParamOverride>) => void;
  signAdvisory: (obligorId: string, record: AdvisorySignOff) => void;
  resetAll: () => void;
};

export const useCreditAnalysis = create<State>()(
  persist(
    (set) => ({
      overrides: {},
      advisory: {},
      setOverrides: (id, overrides) => set((s) => ({ overrides: { ...s.overrides, [id]: overrides } })),
      signAdvisory: (id, record) => set((s) => ({ advisory: { ...s.advisory, [id]: record } })),
      resetAll: () => set({ overrides: {}, advisory: {} }),
    }),
    {
      name: "credigit.ser.credit-analysis",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ overrides, advisory }) => ({ overrides, advisory }),
    },
  ),
);

const empty: Record<string, ParamOverride> = {};
export const useOverrides = (id: string) => useCreditAnalysis((s) => s.overrides[id] ?? empty);
export const useAdvisorySignOff = (id: string) => useCreditAnalysis((s) => s.advisory[id]);
