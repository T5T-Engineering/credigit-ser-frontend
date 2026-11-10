/**
 * Collateral Management & Legal Review logic (PRD §6.5, §6.7.3, §5.7).
 * Pure functions. Haircuts, alert windows and the margin threshold are business rules (./platform.ts) read at call time.
 * BACKEND SEAM: the Rules & Parameters Engine evaluates these server-side (CBN 12.13(a)(5)).
 */
import { addDays, subDays } from "date-fns";
import type { Tone } from "@credigit/web-ui";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Collateral, Facility, PerfectionStatus } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";
import { getRule } from "@/lib/platform/rules";
import { typeSlug } from "./platform";

/* ---------------- Haircut weighting (PRD §6.7.3) — business rules `collateral.haircut.*` ---------------- */

export type HaircutRule = { pct: number; source: string; prdCategory?: string };

/** PRD §6.7.3 table for the listed types; other types use the tenant's configured haircut. Read at call time. */
export function haircutFor(c: Pick<Collateral, "type" | "description">): HaircutRule {
  const r = (key: string) => getRule<number>(`collateral.haircut.${key}`);
  switch (c.type) {
    case "Cash / lien on deposit":
      return { pct: r("cash"), source: "PRD §6.7.3", prdCategory: "Cash / deposits with the lending bank" };
    case "Quoted shares":
      return { pct: r("quotedShares"), source: "PRD §6.7.3", prdCategory: "Quoted equities & other traded securities" };
    case "Legal mortgage": {
      const words = getRule<string[]>("collateral.haircut.residentialKeywords");
      const residential = words.some((w) => w && c.description.toLowerCase().includes(w.toLowerCase()));
      return residential
        ? { pct: r("residentialMortgage"), source: "PRD §6.7.3", prdCategory: "Residential legal mortgage" }
        : { pct: r("commercialMortgage"), source: "PRD §6.7.3", prdCategory: "Commercial legal mortgage" };
    }
    default:
      return { pct: r(typeSlug(c.type)), source: "Tenant parameter" };
  }
}

/** Value-of-collateral basis for the haircut formula: CSCS mark-to-market for quoted shares; FSV for mortgages and other realisable assets. */
export function valueBasis(c: Collateral, mtm?: number): { value: number; basis: string } {
  if (c.type === "Quoted shares" && mtm !== undefined) return { value: Math.round(mtm), basis: "CSCS mark-to-market (units × price)" };
  if (c.type === "Cash / lien on deposit") return { value: c.marketValue, basis: "Deposit balance" };
  if (c.type === "Legal mortgage" || c.type === "Equitable mortgage") return { value: c.forcedSaleValue, basis: "Forced-sale value (independent valuer, CBN 12.13(a)(6))" };
  // Types outside the PRD §6.7.3 table: the tenant haircut is applied to the assessed value (avoids discounting twice). See OPEN-QUESTIONS.
  return { value: c.marketValue, basis: c.type.includes("guarantee") ? "Guarantor assessed value (tenant policy)" : "Assessed market value (tenant haircut applies)" };
}

/** Haircut-adjusted value = Value of Collateral × (1 − Haircut Weighting). Eligible only when perfected (CBN 12.13(a)(1)). */
export function adjustedValue(c: Collateral, mtm?: number) {
  const basis = valueBasis(c, mtm);
  const h = haircutFor(c);
  const adjusted = Math.round(basis.value * (1 - h.pct / 100));
  return { ...basis, haircut: h, adjusted, eligible: c.perfection === "Perfected" };
}

/** Exposure secured: outstanding, or the contingent amount for guarantees. */
export function facilityExposure(f: Facility): number {
  return f.product.includes("guarantee") ? f.approvedAmount : f.outstanding;
}

/* ---------------- Perfection workflow ---------------- */

export const perfectionSteps: { id: PerfectionStatus; title: string; description: string; owner: "legal-officer" | "collateral-officer" }[] = [
  { id: "Search in progress", title: "Search", description: "Legal search at the registry (parallel to BDM review, PRD §6.1.1)", owner: "legal-officer" },
  { id: "Documentation", title: "Documentation", description: "Security documents executed; genuineness and authenticity confirmed", owner: "legal-officer" },
  { id: "Registration", title: "Registration", description: "Charge / mortgage / lien registered (CAC, Lands Registry, CSCS)", owner: "collateral-officer" },
  { id: "Perfected", title: "Perfected", description: "Perfection complete; documents vaulted", owner: "collateral-officer" },
];

export function perfectionIndex(s: PerfectionStatus): number {
  if (s === "Not started") return -1;
  if (s === "Defective") return 1;
  return perfectionSteps.findIndex((p) => p.id === s);
}

export const perfectionTones: Record<string, Tone> = {
  "Not started": "neutral",
  "Search in progress": "info",
  Documentation: "info",
  Registration: "warning",
  Perfected: "success",
  Defective: "danger",
};

/* ---------------- Role abilities inside the Collateral module (PRD §4.1) ---------------- */

export function collateralAbilities(roleId: RoleId | undefined) {
  return {
    /** Collateral Management Officer: register, value, perfection/registration, haircut, insurance. */
    manage: roleId === "collateral-officer",
    /** Legal Officer: searches, genuineness, vaulting, legal sufficiency sign-off. */
    legal: roleId === "legal-officer",
    /** Middle Office: independent valuation verification. */
    verify: roleId === "middle-office-officer",
  };
}

/* ---------------- Simulated NGX prices (PRD §5.7 — prototype only) ---------------- */

/** Reference closing prices (₦) — simulated demo values, not market data (TD-601). */
export const referencePrices: Record<string, { name: string; price: number; sector: string; vol: number }> = {
  DANGCEM: { name: "Dangote Cement Plc", price: 478.5, sector: "Industrial goods", vol: 0.012 },
  MTNN: { name: "MTN Nigeria Communications Plc", price: 268.0, sector: "ICT", vol: 0.015 },
  ZENITHBANK: { name: "Zenith Bank Plc", price: 52.4, sector: "Banking", vol: 0.02 },
  GTCO: { name: "Guaranty Trust Holding Co Plc", price: 61.85, sector: "Banking", vol: 0.02 },
  NESTLE: { name: "Nestlé Nigeria Plc", price: 1120.0, sector: "Consumer goods", vol: 0.01 },
  SEPLAT: { name: "Seplat Energy Plc", price: 5250.0, sector: "Oil & gas", vol: 0.018 },
  BUACEMENT: { name: "BUA Cement Plc", price: 96.3, sector: "Industrial goods", vol: 0.014 },
  AIRTELAFRI: { name: "Airtel Africa Plc", price: 2150.0, sector: "ICT", vol: 0.013 },
  OKOMUOIL: { name: "Okomu Oil Palm Plc", price: 498.0, sector: "Agriculture", vol: 0.022 },
  PRESCO: { name: "Presco Plc", price: 612.0, sector: "Agriculture", vol: 0.021 },
};

function seeded(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Units pledged, derived so that the pledge-date value matches the register (prototype; seed units are random). */
export function pledgedUnits(c: Collateral): number {
  const ref = c.ticker ? referencePrices[c.ticker] : undefined;
  if (!ref) return c.units ?? 0;
  const seed = c.id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const pledgeFactor = 0.92 + seeded(seed) * 0.3; // price at pledge vs today
  return Math.round(c.marketValue / (ref.price * pledgeFactor) / 100) * 100;
}

/** 30 trading-day simulated price series ending at DEMO_NOW (deterministic). Some counters trend down to create margin calls. */
export function priceSeries(ticker: string, days = 30): { date: Date; price: number }[] {
  const ref = referencePrices[ticker];
  if (!ref) return [];
  const drift = ticker === "ZENITHBANK" || ticker === "OKOMUOIL" || ticker === "MTNN" ? -0.0065 : ticker === "SEPLAT" ? 0.004 : 0.0015;
  const out: { date: Date; price: number }[] = [];
  let p = ref.price;
  const seedBase = ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  // build backwards from the reference so the last point equals the reference close
  const pts = [p];
  for (let i = 1; i < days; i++) {
    const shock = (seeded(seedBase + i) - 0.5) * 2 * ref.vol;
    p = p / (1 + drift + shock);
    pts.unshift(p);
  }
  let d = DEMO_NOW;
  const dates: Date[] = [];
  while (dates.length < days) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) dates.unshift(d);
    d = subDays(d, 1);
  }
  pts.forEach((price, i) => out.push({ date: dates[i]!, price: Math.round(price * 100) / 100 }));
  return out;
}

/* ---------------- Collateral monitoring alerts (PRD §6.4.2) ---------------- */

export type CollateralAlertKind = "Perfection incomplete" | "Perfection defective" | "Revaluation overdue" | "Revaluation due soon" | "Insurance expired" | "Insurance expiring soon" | "Margin shortfall";

export type CollateralAlert = { id: string; collateralId: string; obligorId: string; kind: CollateralAlertKind; detail: string; tone: Tone; dueAt?: string };

/** `mtmOf` returns the current mark-to-market value of a quoted-share collateral (undefined for other types). */
export function buildCollateralAlerts(collateral: (Collateral & { insuranceExpiryEffective?: string })[], facilities: Facility[], mtmOf: (c: Collateral) => number | undefined): CollateralAlert[] {
  const facMap = new Map(facilities.map((f) => [f.id, f]));
  const alerts: CollateralAlert[] = [];
  const now = DEMO_NOW;
  const stallDays = getRule<number>("collateral.perfection.stallDays");
  const revalWarn = getRule<number>("collateral.revaluation.warningDays");
  const insWarn = getRule<number>("collateral.insurance.warningDays");
  for (const c of collateral) {
    const linked = c.facilityIds.map((id) => facMap.get(id)).filter((f): f is Facility => !!f && f.status !== "Closed");
    if (!linked.length) continue;
    if (c.perfection === "Defective") alerts.push({ id: `${c.id}-pd`, collateralId: c.id, obligorId: c.obligorId, kind: "Perfection defective", detail: "Security document defect reported by Legal — cure before relying on the haircut adjustment.", tone: "danger" });
    else if (c.perfection !== "Perfected" && new Date(c.valuedAt) < subDays(now, stallDays)) alerts.push({ id: `${c.id}-pi`, collateralId: c.id, obligorId: c.obligorId, kind: "Perfection incomplete", detail: `Stalled at ${c.perfection.toLowerCase()} for over ${stallDays} days on a live facility.`, tone: "warning" });
    const reval = new Date(c.nextRevaluation);
    if (c.type !== "Quoted shares" && c.type !== "Cash / lien on deposit") {
      if (reval < now) alerts.push({ id: `${c.id}-ro`, collateralId: c.id, obligorId: c.obligorId, kind: "Revaluation overdue", detail: `Revaluation was due ${reval.toDateString().slice(4)}.`, tone: "danger", dueAt: c.nextRevaluation });
      else if (reval < addDays(now, revalWarn)) alerts.push({ id: `${c.id}-rd`, collateralId: c.id, obligorId: c.obligorId, kind: "Revaluation due soon", detail: `Revaluation due ${reval.toDateString().slice(4)} (within ${revalWarn} days).`, tone: "warning", dueAt: c.nextRevaluation });
    }
    const insExpiry = c.insuranceExpiryEffective ?? c.insuranceExpiry;
    if (insExpiry) {
      const ins = new Date(insExpiry);
      if (ins < now) alerts.push({ id: `${c.id}-ie`, collateralId: c.id, obligorId: c.obligorId, kind: "Insurance expired", detail: "Insurance cover is not current.", tone: "danger", dueAt: insExpiry });
      else if (ins < addDays(now, insWarn)) alerts.push({ id: `${c.id}-ix`, collateralId: c.id, obligorId: c.obligorId, kind: "Insurance expiring soon", detail: `Expires within ${insWarn} days — request renewal certificate noting the bank's interest.`, tone: "warning", dueAt: insExpiry });
    }
    const mtm = mtmOf(c);
    if (c.type === "Quoted shares" && mtm !== undefined) {
      const adj = adjustedValue(c, mtm).adjusted;
      const exposure = linked.reduce((a, f) => a + facilityExposure(f), 0);
      if (exposure > 0 && marginShortfall(adj, exposure) > 0)
        alerts.push({ id: `${c.id}-mc`, collateralId: c.id, obligorId: c.obligorId, kind: "Margin shortfall", detail: `Haircut-adjusted MTM covers ${Math.round((adj / exposure) * 100)}% of exposure.`, tone: "danger" });
    }
  }
  return alerts;
}

/* ---------------- Margin (PRD §5.7, §6.4.2) ---------------- */

/** Haircut-adjusted value needed to cover an exposure at the margin threshold (business rule `collateral.margin.minCoverPct`). */
export function requiredCover(exposure: number): number {
  return exposure * (getRule<number>("collateral.margin.minCoverPct") / 100);
}

/** Shortfall of haircut-adjusted value below the margin threshold (0 when covered). */
export function marginShortfall(adjusted: number, exposure: number): number {
  return exposure > 0 ? Math.max(0, requiredCover(exposure) - adjusted) : 0;
}
