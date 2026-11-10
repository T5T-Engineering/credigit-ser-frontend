"use client";

/** Module state for Market & Liquidity Risk (persisted in this browser). BACKEND SEAM: replace with API mutations. */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { BANDS, DYNAMIC_SIGNAL, seedBreaches, type Breach, type StressAssumptions } from "./data";

export type RasMetric = { id: string; metric: string; floor: string; earlyWarning: number; buffer: number; unit: string; direction: "min" | "max" };
export type RasVersion = { version: string; at: string; by: string; note: string; values: Record<string, { earlyWarning: number; buffer: number }> };
export type RiskFactor = { id: string; category: string; factor: string; relevance: "Low" | "Medium" | "High"; tenantSpecific?: boolean };
export type SignOff = { tier: string; roleId: string; title: string; decision: "pending" | "approved" | "returned"; by?: string; at?: string; comment?: string };
export type SavedRun = { id: string; at: string; by: string; name: string; assumptions: StressAssumptions; lcr: number; survivalDays: number | null; minBuffer: number };

export const RAS_METRICS: RasMetric[] = [
  { id: "lcr", metric: "Liquidity Coverage Ratio", floor: "≥ 100% (Basel III)", earlyWarning: 120, buffer: 135, unit: "%", direction: "min" },
  { id: "nsfr", metric: "Net Stable Funding Ratio", floor: "≥ 100% (Basel III)", earlyWarning: 110, buffer: 118, unit: "%", direction: "min" },
  { id: "ldr", metric: "Loan-to-Deposit Ratio (weighted)", floor: "≥ 65% CBN minimum", earlyWarning: 68, buffer: 85, unit: "%", direction: "min" },
  { id: "lr", metric: "Liquidity ratio", floor: "Tenant parameter (CBN 3.13)", earlyWarning: 35, buffer: 40, unit: "%", direction: "min" },
  { id: "top20", metric: "Top-20 depositor concentration", floor: "No regulatory floor", earlyWarning: 22, buffer: 25, unit: "%", direction: "max" },
  { id: "survival", metric: "Stressed survival horizon", floor: "Stress test required (BAU, adverse, reverse)", earlyWarning: 45, buffer: 30, unit: "days", direction: "min" },
];

const initialValues = Object.fromEntries(RAS_METRICS.map((m) => [m.id, { earlyWarning: m.earlyWarning, buffer: m.buffer }]));

export const defaultAssumptions = (band: StressAssumptions["band"] = "Adverse"): StressAssumptions => ({
  band,
  ...BANDS[band],
  dynamic: false,
  dynRetailAdd: DYNAMIC_SIGNAL.retailAdd,
  dynCorporateAdd: DYNAMIC_SIGNAL.corporateAdd,
  dynHaircutAdd: DYNAMIC_SIGNAL.haircutAdd,
});

const initial = () => ({
  breaches: seedBreaches,
  rasVersions: [
    { version: "1.0", at: "2026-02-14T10:00:00+01:00", by: "Board of Directors", note: "Board-approved Risk Appetite Statement captured at onboarding.", values: initialValues },
  ] as RasVersion[],
  riskFactors: [
    { id: "RF1", category: "Funding liquidity", factor: "Concentration of corporate deposits", relevance: "High" },
    { id: "RF2", category: "Funding liquidity", factor: "Retail deposit stability", relevance: "Medium" },
    { id: "RF3", category: "Market liquidity", factor: "Depth of FGN bond / T-bill secondary market", relevance: "Medium" },
    { id: "RF4", category: "Credit", factor: "Undrawn-facility drawdown surge", relevance: "Medium" },
    { id: "RF5", category: "Operational", factor: "Payment-system / NIP outage", relevance: "Low" },
    { id: "RF6", category: "Intraday", factor: "RTGS settlement timing", relevance: "Medium" },
    { id: "RF7", category: "Other", factor: "FX liquidity — USD funding gap", relevance: "High", tenantSpecific: true },
  ] as RiskFactor[],
  signOffs: [
    { tier: "prepare", roleId: "market-risk-analyst", title: "Prepared — Market Risk Analyst", decision: "approved", by: "Market Risk Analyst", at: "2026-11-03T15:00:00+01:00" },
    { tier: "review", roleId: "head-of-risk", title: "Reviewed — Head of Risk", decision: "pending" },
    { tier: "cro", roleId: "cro", title: "Endorsed — Chief Risk Officer", decision: "pending" },
    { tier: "alco", roleId: "md", title: "ALCO (chaired by MD/CEO)", decision: "pending" },
    { tier: "board", roleId: "board", title: "Board approval", decision: "pending" },
  ] as SignOff[],
  chapters: { exec: true, gov: true, ras: true, factors: true, metrics: true, stress: false, cfp: true, conclusion: false } as Record<string, boolean>,
  compiled: [] as { id: string; at: string; by: string; rasVersion: string }[],
  draft: defaultAssumptions(),
  runs: [] as SavedRun[],
});

type State = ReturnType<typeof initial> & {
  setBreach: (id: string, changes: Partial<Breach>) => void;
  addRasVersion: (v: RasVersion) => void;
  setRelevance: (id: string, relevance: RiskFactor["relevance"]) => void;
  signOff: (tier: string, changes: Partial<SignOff>) => void;
  setChapter: (id: string, done: boolean) => void;
  addCompiled: (c: { id: string; at: string; by: string; rasVersion: string }) => void;
  setDraft: (a: StressAssumptions) => void;
  addRun: (r: SavedRun) => void;
  reset: () => void;
};

export const useMarketRisk = create<State>()(
  persist(
    (set) => ({
      ...initial(),
      setBreach: (id, changes) => set((s) => ({ breaches: s.breaches.map((b) => (b.id === id ? { ...b, ...changes } : b)) })),
      addRasVersion: (v) => set((s) => ({ rasVersions: [v, ...s.rasVersions] })),
      setRelevance: (id, relevance) => set((s) => ({ riskFactors: s.riskFactors.map((f) => (f.id === id ? { ...f, relevance } : f)) })),
      signOff: (tier, changes) => set((s) => ({ signOffs: s.signOffs.map((x) => (x.tier === tier ? { ...x, ...changes } : x)) })),
      setChapter: (id, done) => set((s) => ({ chapters: { ...s.chapters, [id]: done } })),
      addCompiled: (c) => set((s) => ({ compiled: [c, ...s.compiled] })),
      setDraft: (draft) => set({ draft }),
      addRun: (r) => set((s) => ({ runs: [r, ...s.runs].slice(0, 20) })),
      reset: () => set(initial()),
    }),
    { name: "credigit.ser.market-risk", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
