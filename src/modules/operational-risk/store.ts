"use client";

/**
 * Operational Risk module store — user changes persist in this browser (prototype).
 * BACKEND SEAM: replace these actions with API calls; pages read only through `useOpRisk`.
 * Approvals (KRI thresholds, loss-event closure, RCSA sign-off, BCM plan approval) never write here directly —
 * they are Operations workflow requests whose `apply` (../platform.ts) calls these actions after approval.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { seedBcmPlans, seedExercises, seedLossEvents, seedRcsa, type BcmExercise, type BcmPlan, type LossEvent, type RcsaRisk } from "./data";

export type KriEscalation = {
  kriId: string;
  level: 1 | 2 | 3 | 4;
  escalatedById?: string;
  acknowledgedBy?: string;
  acknowledgedById?: string;
  acknowledgedAt?: string;
  note?: string;
};

type OpRiskState = {
  lossEvents: LossEvent[];
  rcsa: RcsaRisk[];
  bcmPlans: BcmPlan[];
  exercises: BcmExercise[];
  escalations: Record<string, KriEscalation>;
  commentarySignedOffBy?: string;
  addLossEvent: (e: LossEvent) => void;
  updateLossEvent: (id: string, changes: Partial<LossEvent>) => void;
  updateRcsa: (id: string, changes: Partial<RcsaRisk>) => void;
  updatePlan: (id: string, changes: Partial<BcmPlan>) => void;
  addExercise: (e: BcmExercise) => void;
  setEscalation: (e: KriEscalation) => void;
  signOffCommentary: (by: string) => void;
};

const initial = () => ({
  lossEvents: seedLossEvents,
  rcsa: seedRcsa,
  bcmPlans: seedBcmPlans,
  exercises: seedExercises,
  escalations: {} as Record<string, KriEscalation>,
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
      signOffCommentary: (by) => set({ commentarySignedOffBy: by }),
    }),
    {
      name: "credigit.ser.operational-risk",
      // v2: KRI threshold changes moved to business rules + the Operations workflow.
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lossEvents: s.lossEvents, rcsa: s.rcsa, bcmPlans: s.bcmPlans, exercises: s.exercises, escalations: s.escalations, commentarySignedOffBy: s.commentarySignedOffBy }),
      migrate: () => initial() as unknown as OpRiskState,
    },
  ),
);
