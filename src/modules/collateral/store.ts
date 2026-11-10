"use client";

/**
 * Collateral module persisted state (`credigit.ser.collateral`): MO verifications, legal records, recorded valuations,
 * lien status, simulated price refreshes and margin calls. Register fields (value, perfection) live in the shared store.
 * BACKEND SEAM: replace actions with API commands.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useCollateral, useFacilities } from "@/lib/data/hooks";
import type { Collateral } from "@/lib/data/types";
import { DEMO_NOW } from "@/lib/data/seed";
import { legalSeed, lienSeed, moSeed, type LegalRecord, type LienStatus, type MoVerification, type ValuationEntry } from "./data";
import { adjustedValue, facilityExposure, pledgedUnits, referencePrices } from "./logic";

type State = {
  verifications: Record<string, MoVerification>;
  legal: Record<string, Partial<LegalRecord>>;
  valuations: Record<string, ValuationEntry[]>;
  liens: Record<string, LienStatus>;
  prices: Record<string, number>;
  pricesAt?: string;
  marginCalls: Record<string, { at: string; by: string; exceptionId: string; topUp: number }>;
  insurance: Record<string, { expiry: string; by: string; at: string }>;
  setVerification: (id: string, v: MoVerification) => void;
  patchLegal: (id: string, v: Partial<LegalRecord>) => void;
  addValuation: (id: string, v: ValuationEntry) => void;
  setLien: (id: string, v: LienStatus) => void;
  setPrices: (p: Record<string, number>) => void;
  recordMarginCall: (id: string, v: { by: string; exceptionId: string; topUp: number }) => void;
  renewInsurance: (id: string, v: { expiry: string; by: string }) => void;
};

export const useCollateralStore = create<State>()(
  persist(
    (set) => ({
      verifications: {},
      legal: {},
      valuations: {},
      liens: {},
      prices: {},
      marginCalls: {},
      insurance: {},
      setVerification: (id, v) => set((s) => ({ verifications: { ...s.verifications, [id]: v } })),
      patchLegal: (id, v) => set((s) => ({ legal: { ...s.legal, [id]: { ...s.legal[id], ...v } } })),
      addValuation: (id, v) => set((s) => ({ valuations: { ...s.valuations, [id]: [...(s.valuations[id] ?? []), v] } })),
      setLien: (id, v) => set((s) => ({ liens: { ...s.liens, [id]: v } })),
      setPrices: (p) => set(() => ({ prices: p, pricesAt: new Date().toISOString() })),
      recordMarginCall: (id, v) => set((s) => ({ marginCalls: { ...s.marginCalls, [id]: { ...v, at: new Date().toISOString() } } })),
      renewInsurance: (id, v) => set((s) => ({ insurance: { ...s.insurance, [id]: { ...v, at: new Date().toISOString() } } })),
    }),
    { name: "credigit.ser.collateral", version: 1, storage: createJSONStorage(() => localStorage), partialize: ({ verifications, legal, valuations, liens, prices, pricesAt, marginCalls, insurance }) => ({ verifications, legal, valuations, liens, prices, pricesAt, marginCalls, insurance }) },
  ),
);

/** Current simulated NGX closing prices (reference prices, or the last simulated refresh). */
export function useSharePrices(): { prices: Record<string, number>; asOf: string } {
  const overrides = useCollateralStore((s) => s.prices);
  const at = useCollateralStore((s) => s.pricesAt);
  return useMemo(
    () => ({
      prices: Object.fromEntries(Object.entries(referencePrices).map(([t, r]) => [t, overrides[t] ?? r.price])),
      asOf: at ?? new Date(DEMO_NOW.getFullYear(), DEMO_NOW.getMonth(), DEMO_NOW.getDate() - 1, 14, 30).toISOString(),
    }),
    [overrides, at],
  );
}

export type CollateralView = Collateral & {
  mtm?: number;
  units?: number;
  price?: number;
  basisValue: number;
  basis: string;
  haircutPct: number;
  haircutSource: string;
  adjusted: number;
  eligible: boolean;
  exposure: number;
  cover: number;
  verification: MoVerification;
  legalRecord: LegalRecord;
  lien?: LienStatus;
  insuranceExpiryEffective?: string;
};

/** Register rows enriched with MTM, haircut-adjusted value, cover, MO verification and legal state. */
export function useCollateralView(): CollateralView[] {
  const collateral = useCollateral();
  const facilities = useFacilities();
  const { prices } = useSharePrices();
  const verifications = useCollateralStore((s) => s.verifications);
  const legal = useCollateralStore((s) => s.legal);
  const liens = useCollateralStore((s) => s.liens);
  const insurance = useCollateralStore((s) => s.insurance);
  return useMemo(() => {
    const fac = new Map(facilities.map((f) => [f.id, f]));
    return collateral.map((c) => {
      const units = c.type === "Quoted shares" ? pledgedUnits(c) : undefined;
      const price = c.ticker ? prices[c.ticker] : undefined;
      const mtm = units && price ? units * price : undefined;
      const a = adjustedValue(c, mtm);
      const exposure = c.facilityIds.map((id) => fac.get(id)).reduce((s, f) => s + (f && f.status !== "Closed" ? facilityExposure(f) : 0), 0);
      return {
        ...c,
        units,
        price,
        mtm,
        basisValue: a.value,
        basis: a.basis,
        haircutPct: a.haircut.pct,
        haircutSource: a.haircut.source === "PRD §6.7.3" ? `PRD §6.7.3 — ${a.haircut.prdCategory}` : "Tenant parameter (demo value)",
        adjusted: a.adjusted,
        eligible: a.eligible,
        exposure,
        cover: exposure > 0 ? a.adjusted / exposure : 0,
        verification: verifications[c.id] ?? moSeed(c),
        legalRecord: { ...legalSeed(c), ...legal[c.id] } as LegalRecord,
        lien: c.type === "Quoted shares" ? (liens[c.id] ?? lienSeed(c)) : undefined,
        insuranceExpiryEffective: insurance[c.id]?.expiry ?? c.insuranceExpiry,
      };
    });
  }, [collateral, facilities, prices, verifications, legal, liens, insurance]);
}
