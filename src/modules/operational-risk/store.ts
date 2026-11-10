"use client";

/**
 * Operational Risk module store — user changes persist in this browser (prototype).
 * BACKEND SEAM: replace these actions with API calls; pages read only through `useOpRisk`.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { seedBcmPlans, seedExercises, seedLossEvents, seedRcsa, type BcmExercise, type BcmPlan, type LossEvent, type RcsaRisk } from "./data";

export type KriEscalation = { kriId: string; level: 1 | 2 | 3 | 4; acknowledgedBy?: string; acknowledgedAt?: string; note?: string };
export type ThresholdChange = {
  id: string;
  kriId: string;
  amber: number;
  red: number;
  previous: { amber: number; red: number };
  reason: string;
  proposedBy: string;
  proposedAt: string;
  status: "Pending approval" | "Approved" | "Rejected";
  decidedBy?: string;
};

type OpRiskState = {
  lossEvents: LossEvent[];
  rcsa: RcsaRisk[];
  bcmPlans: BcmPlan[];
  exercises: BcmExercise[];
  escalations: Record<string, KriEscalation>;
  thresholdChanges: ThresholdChange[];
  commentarySignedOffBy?: string;
  addLossEvent: (e: LossEvent) => void;
  updateLossEvent: (id: string, changes: Partial<LossEvent>) => void;
  updateRcsa: (id: string, changes: Partial<RcsaRisk>) => void;
  updatePlan: (id: string, changes: Partial<BcmPlan>) => void;
  addExercise: (e: BcmExercise) => void;
  setEscalation: (e: KriEscalation) => void;
  proposeThreshold: (c: ThresholdChange) => void;
  decideThreshold: (id: string, status: "Approved" | "Rejected", by: string) => void;
  signOffCommentary: (by: string) => void;
};

const initial = () => ({
  lossEvents: seedLossEvents,
  rcsa: seedRcsa,
  bcmPlans: seedBcmPlans,
  exercises: seedExercises,
  escalations: {} as Record<string, KriEscalation>,
  thresholdChanges: [] as ThresholdChange[],
  commentarySignedOffBy: undefined as string | undefined,
});

export const useOpRisk = create<OpRiskState>()(
  persist(
    (set) => ({
      ...initial(),
      addLossEvent: (e) => set((s) => ({ lossEvents: [e, ...s.lossEvents] })),
      updateLossEvent: (id, changes) => set((s) => ({ lossEvents: s.lossEvents.map((x) => (x.id === id ? { ...x, ...changes } : x)) })),
      updateRcsa: (id, changes) => set((s) => ({ rcsa: s.rcsa.map((x) => (x.id === id ? { ...x, ...changes } : x)) })),
      updatePlan: (id, changes) => set((s) => ({ bcmPlans: s.bcmPlans.map((x) => (x.id === id ? { ...x, ...changes } : x)) })),
      addExercise: (e) => set((s) => ({ exercises: [e, ...s.exercises] })),
      setEscalation: (e) => set((s) => ({ escalations: { ...s.escalations, [e.kriId]: e } })),
      proposeThreshold: (c) => set((s) => ({ thresholdChanges: [c, ...s.thresholdChanges] })),
      decideThreshold: (id, status, by) => set((s) => ({ thresholdChanges: s.thresholdChanges.map((c) => (c.id === id ? { ...c, status, decidedBy: by } : c)) })),
      signOffCommentary: (by) => set({ commentarySignedOffBy: by }),
    }),
    {
      name: "credigit.ser.operational-risk",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lossEvents: s.lossEvents, rcsa: s.rcsa, bcmPlans: s.bcmPlans, exercises: s.exercises, escalations: s.escalations, thresholdChanges: s.thresholdChanges, commentarySignedOffBy: s.commentarySignedOffBy }),
      migrate: () => initial() as unknown as OpRiskState,
    },
  ),
);

/** KRI thresholds in force = defaults overridden by the latest approved change. */
export function effectiveThresholds(kriId: string, amber: number, red: number, changes: ThresholdChange[]) {
  const approved = changes.find((c) => c.kriId === kriId && c.status === "Approved");
  return approved ? { amber: approved.amber, red: approved.red } : { amber, red };
}
