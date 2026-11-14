"use client";

/**
 * Module records for IFRS 9 & ICAAP (persisted in this browser). Parameters live in business rules (./platform.ts);
 * approvals live in the Operations workflow — this store only holds the resulting records. BACKEND SEAM: API mutations.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Ifrs9Stage } from "@/lib/data/types";
import { seedModels, type ModelStatus, type RiskModel } from "./data";
import { dataStorage, registerDatabaseStore } from "@/lib/data/workspace-storage";

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
  /** DPD today from the CBA repayment feed (applied to the facility on approval). */
  currentDpd?: number;
  proposedBy: string;
  proposedById?: string;
  proposedAt: string;
  /** Operations workflow instance routing the approval. */
  operationId?: string;
  status: "Pending approval" | "Approved" | "Rejected" | "Returned" | "Withdrawn";
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
};

export type ReservePosting = { id: string; at: string; by: string; period: string; amount: number; direction: string; ifrs: number; prudential: number };

export type IcaapApproval = { id: string; period: string; car: number; minimumCar: number; classification: string; internalTarget: number; results: { scenario: string; car: number; classification: string }[]; approvedAt: string; approvedBy: string };

export type StressRun = { id: string; at: string; by: string; byId?: string; scenarioId: string; scenarioName: string; car: number; eclIncrease: number; rwaIncrease: number };

type State = {
  models: RiskModel[];
  modelChanges: ModelChange[];
  stressRuns: StressRun[];
  declassifications: Declassification[];
  icaapApprovals: IcaapApproval[];
  aiSignOff: Record<string, string>;
  postings: ReservePosting[];
  addPosting: (p: ReservePosting) => void;
  setModelStatus: (id: string, status: ModelStatus, change: Omit<ModelChange, "id" | "modelId" | "at" | "from" | "to">) => void;
  setModelVersion: (id: string, version: string) => void;
  addStressRun: (run: StressRun) => void;
  addDeclassification: (d: Declassification) => void;
  updateDeclassification: (id: string, changes: Partial<Declassification>) => void;
  addIcaapApproval: (a: IcaapApproval) => void;
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
  stressRuns: [] as StressRun[],
  declassifications: [] as Declassification[],
  icaapApprovals: [] as IcaapApproval[],
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
      setModelVersion: (id, version) => set((s) => ({ models: s.models.map((m) => (m.id === id ? { ...m, version, lastCalibrated: new Date().toISOString() } : m)) })),
      // Bounded run history kept in the browser (demo); the backend keeps the full history.
      addStressRun: (run) => set((s) => ({ stressRuns: [run, ...s.stressRuns].slice(0, 30) })),
      addDeclassification: (d) => set((s) => ({ declassifications: [d, ...s.declassifications] })),
      updateDeclassification: (id, changes) => set((s) => ({ declassifications: s.declassifications.map((x) => (x.id === id ? { ...x, ...changes } : x)) })),
      addIcaapApproval: (a) => set((s) => ({ icaapApprovals: [a, ...s.icaapApprovals] })),
      addPosting: (p) => set((s) => ({ postings: [p, ...s.postings] })),
      signOffAi: (key, by) => set((s) => ({ aiSignOff: { ...s.aiSignOff, [key]: by } })),
      reset: () => set(initial()),
    }),
    // v2: parameters (cure, minimum CAR, scenarios) moved to business rules; approvals moved to Operations.
    { name: "credigit.ser.ifrs9", version: 2, storage: dataStorage(), migrate: () => initial() as unknown as State },
  ),
);

registerDatabaseStore(useIfrs9);
