"use client";

/**
 * Module state for Market & Liquidity Risk (persisted in this browser). Thresholds live in business rules
 * (platform.ts); approvals live in the Operations workflow. BACKEND SEAM: replace with API mutations.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { seedBreaches, type Breach, type StressAssumptions } from "./data";

/** RAS metric catalogue. Early-warning / buffer values are rules `market-risk.ras.<id>.earlyWarning|buffer`. */
export type RasMetric = { id: string; metric: string; unit: string; direction: "min" | "max"; floorRule?: string; floorText: string };
export const RAS_METRICS: RasMetric[] = [
  { id: "lcr", metric: "Liquidity Coverage Ratio", unit: "%", direction: "min", floorRule: "market-risk.lcrFloorPct", floorText: "Basel III" },
  { id: "nsfr", metric: "Net Stable Funding Ratio", unit: "%", direction: "min", floorRule: "market-risk.nsfrFloorPct", floorText: "Basel III" },
  { id: "ldr", metric: "Loan-to-Deposit Ratio (weighted)", unit: "%", direction: "min", floorRule: "market-risk.ldrMinPct", floorText: "CBN minimum" },
  { id: "lr", metric: "Liquidity ratio", unit: "%", direction: "min", floorRule: "market-risk.liquidityRatioMinPct", floorText: "CBN 3.13 (tenant parameter)" },
  { id: "top20", metric: "Top-20 depositor concentration", unit: "%", direction: "max", floorText: "No regulatory floor" },
  { id: "survival", metric: "Stressed survival horizon", unit: "days", direction: "min", floorText: "Stress test required (BAU, adverse, reverse)" },
];

export type RasValues = Record<string, { earlyWarning: number; buffer: number }>;
export type RasVersion = { version: string; at: string; by: string; note: string; values: RasValues; operationId?: string };
export type RiskFactor = { id: string; category: string; factor: string; relevance: "Low" | "Medium" | "High"; tenantSpecific?: boolean };
export type SavedRun = {
  id: string;
  at: string;
  by: string;
  byId?: string;
  name: string;
  assumptions: StressAssumptions;
  lcr: number;
  survivalDays: number | null;
  minBuffer: number;
  approval?: { status: "Approved" | "Rejected"; by: string; at: string };
};
export type IlaapState = { period: string; status: "Draft" | "In review" | "Approved" | "Returned"; operationId?: string; approvedAt?: string; approvedBy?: string };

const initial = () => ({
  breaches: seedBreaches,
  rasVersions: [{ version: "1.0", at: "2026-02-14T10:00:00+01:00", by: "Board of Directors", note: "Board-approved Risk Appetite Statement captured at onboarding.", values: {} }] as RasVersion[],
  riskFactors: [
    { id: "RF1", category: "Funding liquidity", factor: "Concentration of corporate deposits", relevance: "High" },
    { id: "RF2", category: "Funding liquidity", factor: "Retail deposit stability", relevance: "Medium" },
    { id: "RF3", category: "Market liquidity", factor: "Depth of FGN bond / T-bill secondary market", relevance: "Medium" },
    { id: "RF4", category: "Credit", factor: "Undrawn-facility drawdown surge", relevance: "Medium" },
    { id: "RF5", category: "Operational", factor: "Payment-system / NIP outage", relevance: "Low" },
    { id: "RF6", category: "Intraday", factor: "RTGS settlement timing", relevance: "Medium" },
    { id: "RF7", category: "Other", factor: "FX liquidity — USD funding gap", relevance: "High", tenantSpecific: true },
  ] as RiskFactor[],
  ilaap: { period: "2026", status: "Draft" } as IlaapState,
  chapters: { exec: true, gov: true, ras: true, factors: true, metrics: true, stress: false, cfp: true, conclusion: false } as Record<string, boolean>,
  compiled: [] as { id: string; at: string; by: string; rasVersion: string }[],
  /** Scenario builder draft; null = use the Adverse band from business rules. */
  draft: null as StressAssumptions | null,
  runs: [] as SavedRun[],
});

type State = ReturnType<typeof initial> & {
  setBreach: (id: string, changes: Partial<Breach>) => void;
  addBreach: (b: Breach) => void;
  addRasVersion: (v: RasVersion) => void;
  setRelevance: (id: string, relevance: RiskFactor["relevance"]) => void;
  setIlaap: (changes: Partial<IlaapState>) => void;
  setChapter: (id: string, done: boolean) => void;
  addCompiled: (c: { id: string; at: string; by: string; rasVersion: string }) => void;
  setDraft: (a: StressAssumptions | null) => void;
  addRun: (r: SavedRun) => void;
  setRun: (id: string, changes: Partial<SavedRun>) => void;
  reset: () => void;
};

/** Max saved stress runs kept in the browser (demo). */
const RUN_LIMIT = 20;

export const useMarketRisk = create<State>()(
  persist(
    (set) => ({
      ...initial(),
      setBreach: (id, changes) => set((s) => ({ breaches: s.breaches.map((b) => (b.id === id ? { ...b, ...changes } : b)) })),
      addBreach: (b) => set((s) => ({ breaches: [b, ...s.breaches] })),
      addRasVersion: (v) => set((s) => ({ rasVersions: [v, ...s.rasVersions] })),
      setRelevance: (id, relevance) => set((s) => ({ riskFactors: s.riskFactors.map((f) => (f.id === id ? { ...f, relevance } : f)) })),
      setIlaap: (changes) => set((s) => ({ ilaap: { ...s.ilaap, ...changes } })),
      setChapter: (id, done) => set((s) => ({ chapters: { ...s.chapters, [id]: done } })),
      addCompiled: (c) => set((s) => ({ compiled: [c, ...s.compiled] })),
      setDraft: (draft) => set({ draft }),
      addRun: (r) => set((s) => ({ runs: [r, ...s.runs].slice(0, RUN_LIMIT) })),
      setRun: (id, changes) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...changes } : r)) })),
      reset: () => set(initial()),
    }),
    // v2: thresholds moved to business rules, sign-off chain moved to Operations — older demo state is discarded.
    { name: "credigit.ser.market-risk", version: 2, migrate: () => initial() as unknown as State, storage: createJSONStorage(() => localStorage) },
  ),
);
