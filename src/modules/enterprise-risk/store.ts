"use client";

/** ERM module store (prototype persistence). BACKEND SEAM: swap actions for API calls. */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { seedBreaches, seedCirculars, seedEnterpriseRisks, seedPolicies, type BrcPack, type Circular, type EnterpriseRisk, type Policy, type RegBreach } from "./data";

type ErmState = {
  risks: EnterpriseRisk[];
  circulars: Circular[];
  policies: Policy[];
  breaches: RegBreach[];
  packs: BrcPack[];
  appetiteEscalations: Record<string, { by: string; at: string; to: string }>;
  updateRisk: (id: string, c: Partial<EnterpriseRisk>) => void;
  updateCircular: (id: string, c: Partial<Circular>) => void;
  updatePolicy: (id: string, c: Partial<Policy>) => void;
  addPack: (p: BrcPack) => void;
  updatePack: (id: string, c: Partial<BrcPack>) => void;
  escalateAppetite: (id: string, e: { by: string; at: string; to: string }) => void;
};

const initial = () => ({
  risks: seedEnterpriseRisks,
  circulars: seedCirculars,
  policies: seedPolicies,
  breaches: seedBreaches,
  packs: [] as BrcPack[],
  appetiteEscalations: {} as ErmState["appetiteEscalations"],
});

export const useErm = create<ErmState>()(
  persist(
    (set) => ({
      ...initial(),
      updateRisk: (id, c) => set((s) => ({ risks: s.risks.map((r) => (r.id === id ? { ...r, ...c } : r)) })),
      updateCircular: (id, c) => set((s) => ({ circulars: s.circulars.map((r) => (r.id === id ? { ...r, ...c } : r)) })),
      updatePolicy: (id, c) => set((s) => ({ policies: s.policies.map((r) => (r.id === id ? { ...r, ...c } : r)) })),
      addPack: (p) => set((s) => ({ packs: [p, ...s.packs] })),
      updatePack: (id, c) => set((s) => ({ packs: s.packs.map((r) => (r.id === id ? { ...r, ...c } : r)) })),
      escalateAppetite: (id, e) => set((s) => ({ appetiteEscalations: { ...s.appetiteEscalations, [id]: e } })),
    }),
    {
      name: "credigit.ser.enterprise-risk",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ risks: s.risks, circulars: s.circulars, policies: s.policies, breaches: s.breaches, packs: s.packs, appetiteEscalations: s.appetiteEscalations }),
      migrate: () => initial() as unknown as ErmState,
    },
  ),
);
