"use client";

/** Module state for Predictive Analytics (persisted in this browser). BACKEND SEAM: replace with API mutations. */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Ifrs9Stage } from "@/lib/data/types";
import { defaultCureParams, seedModels, seedScenarios, type CureParams, type IcaapScenario, type ModelStatus, type RiskModel } from "./data";

export type ModelChange = { id: string; modelId: string; at: string; by: string; action: string; from?: string; to?: string; note?: string };

export type Declassification = {
  id: string;
  facilityId: string;
  obligorName: string;
  from: Ifrs9Stage;
  to: Ifrs9Stage;
  performingPortion: number;
  eclBefore: number;
  eclAfter: number;
  interestWriteBack: number;
  trigger: string;
  proposedBy: string;
  proposedAt: string;
  status: "Pending approval" | "Approved" | "Rejected";
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
};

export type ReservePosting = { id: string; at: string; by: string; amount: number; direction: string; ifrs: number; prudential: number };

export type StressRun = { id: string; at: string; by: string; scenarioId: string; scenarioName: string; car: number; eclIncrease: number; rwaIncrease: number };

type State = {
  models: RiskModel[];
  modelChanges: ModelChange[];
  scenarios: IcaapScenario[];
  stressRuns: StressRun[];
  minimumCar: 10 | 15;
  cureParams: CureParams;
  declassifications: Declassification[];
  aiSignOff: Record<string, string>;
  postings: ReservePosting[];
  addPosting: (p: ReservePosting) => void;
  setModelStatus: (id: string, status: ModelStatus, change: Omit<ModelChange, "id" | "modelId" | "at" | "from" | "to">) => void;
  updateScenario: (id: string, changes: Partial<IcaapScenario>) => void;
  addStressRun: (run: StressRun) => void;
  setMinimumCar: (v: 10 | 15) => void;
  setCureParams: (p: CureParams) => void;
  addDeclassification: (d: Declassification) => void;
  decideDeclassification: (id: string, changes: Partial<Declassification>) => void;
  signOffAi: (key: string, by: string) => void;
  reset: () => void;
};

const initial = () => ({
  models: seedModels,
  modelChanges: [
    {
      id: "MC-3",
      modelId: "MDL-FLI",
      at: "2026-10-06T10:20:00+01:00",
      by: "Predictive Analytics Officer",
      action: "Recalibrated scenario weights",
      from: "3.1",
      to: "4.0",
      note: "Downside weight raised from 20% to 25% after Q3 macro review.",
    },
    {
      id: "MC-2",
      modelId: "MDL-LGD-UNS",
      at: "2026-09-18T15:05:00+01:00",
      by: "Model validation (2nd line)",
      action: "Validation findings raised",
      note: "Recovery data older than 3 years dominates the sample.",
    },
    { id: "MC-1", modelId: "MDL-PD-CORP", at: "2026-04-12T09:00:00+01:00", by: "Chief Risk Officer", action: "Approved version", from: "3.1", to: "3.2" },
  ] as ModelChange[],
  scenarios: seedScenarios,
  stressRuns: [] as StressRun[],
  minimumCar: 15 as 10 | 15,
  cureParams: defaultCureParams,
  declassifications: [] as Declassification[],
  aiSignOff: {} as Record<string, string>,
  postings: [] as ReservePosting[],
});

export const useIfrs9 = create<State>()(
  persist(
    (set) => ({
      ...initial(),
      setModelStatus: (id, status, change) =>
        set((s) => {
          const model = s.models.find((m) => m.id === id);
          if (!model) return {};
          return {
            models: s.models.map((m) => (m.id === id ? { ...m, status } : m)),
            modelChanges: [{ id: `MC-${Date.now().toString(36)}`, modelId: id, at: new Date().toISOString(), from: model.status, to: status, ...change }, ...s.modelChanges],
          };
        }),
      updateScenario: (id, changes) => set((s) => ({ scenarios: s.scenarios.map((x) => (x.id === id ? { ...x, ...changes } : x)) })),
      addStressRun: (run) => set((s) => ({ stressRuns: [run, ...s.stressRuns].slice(0, 30) })),
      setMinimumCar: (minimumCar) => set({ minimumCar }),
      setCureParams: (cureParams) => set({ cureParams }),
      addDeclassification: (d) => set((s) => ({ declassifications: [d, ...s.declassifications] })),
      decideDeclassification: (id, changes) => set((s) => ({ declassifications: s.declassifications.map((x) => (x.id === id ? { ...x, ...changes } : x)) })),
      addPosting: (p) => set((s) => ({ postings: [p, ...s.postings] })),
      signOffAi: (key, by) => set((s) => ({ aiSignOff: { ...s.aiSignOff, [key]: by } })),
      reset: () => set(initial()),
    }),
    { name: "credigit.ser.ifrs9", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
