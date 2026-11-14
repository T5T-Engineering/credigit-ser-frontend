/**
 * Collateral module mock data (deterministic, derived from the shared Collateral register).
 * BACKEND SEAM: valuation history, insurance, lien status, vault and legal-search records become API reads.
 */
import { addDays, subDays, subMonths } from "date-fns";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Collateral } from "@/lib/data/types";
import { hash, rnd } from "../monitoring/data";

const iso = (d: Date) => d.toISOString();

export type ValuationEntry = {
  id: string;
  at: string;
  marketValue: number;
  forcedSaleValue: number;
  valuer: string;
  basis: string;
  assumptions: string;
  fsvMethod: string;
  reference: string;
  source: "Independent valuer" | "CSCS market data" | "Internal" | "Recorded manually";
};

const bases = ["Market comparison approach", "Depreciated replacement cost", "Investment (income) approach"];

/** Valuation history (oldest → newest). The latest entry matches the register. */
export function valuationHistory(c: Collateral): ValuationEntry[] {
  const n = 2 + (hash(c.id) % 3);
  const out: ValuationEntry[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const at = i === 0 ? new Date(c.valuedAt) : subMonths(new Date(c.valuedAt), i * 12 + (hash(c.id + i) % 4));
    const factor = i === 0 ? 1 : Math.pow(0.88 + rnd(c.id + "g") * 0.1, i);
    const mv = Math.round((c.marketValue * factor) / 1e5) * 1e5 || c.marketValue;
    const shares = c.type === "Quoted shares";
    out.push({
      id: `VAL-${c.id.slice(4)}-${n - i}`,
      at: iso(at),
      marketValue: i === 0 ? c.marketValue : mv,
      forcedSaleValue: i === 0 ? c.forcedSaleValue : Math.round(mv * 0.7),
      valuer: shares ? "CSCS market data" : i === 0 ? c.valuer : ["Ubosi Eleh & Co", "Knight Frank Nigeria", "Jide Taiwo & Co"][hash(c.id + i) % 3]!,
      basis: shares ? "Closing price × units (CSCS)" : bases[hash(c.id + "b" + i) % bases.length]!,
      assumptions: shares ? "Last traded price on NGX; no illiquidity discount" : "Vacant possession; good and marketable title; no adverse planning matters",
      fsvMethod: shares ? "Haircut applied per instead of FSV" : "FSV at 70% of open market value (valuer's assumption of a 3–6 month disposal)",
      reference: shares ? `CSCS/${c.ticker}/${String(hash(c.id + i) % 900000 + 100000)}` : `VR/${at.getFullYear()}/${String(hash(c.id + i) % 9000 + 1000)}`,
      source: shares ? "CSCS market data" : c.valuer === "Internal valuation" && i === 0 ? "Internal" : "Independent valuer",
    });
  }
  return out;
}

export type InsuranceCover = { insurer: string; policyNo: string; sumInsured: number; expiry: string; bankInterestNoted: boolean };

export function insuranceOf(c: Collateral): InsuranceCover | undefined {
  if (!c.insuranceExpiry) return undefined;
  return {
    insurer: ["Harbour Mutual Assurance", "Lagoon General Insurance", "Crestline Insurance", "Northbridge Assurance"][hash(c.id + "i") % 4]!,
    policyNo: `POL/${String(hash(c.id + "p") % 900000 + 100000)}`,
    sumInsured: Math.round((c.marketValue * 0.9) / 1e5) * 1e5,
    expiry: c.insuranceExpiry,
    bankInterestNoted: rnd(c.id + "n") > 0.15,
  };
}

export type MoStatus = "Verified" | "Pending" | "Queried";
export type MoVerification = { status: MoStatus; by?: string; at?: string; note?: string };

/** Middle Office independent verification seed (PRD §4.1). */
export function moSeed(c: Collateral): MoVerification {
  const recent = new Date(c.valuedAt) > subMonths(DEMO_NOW, 4);
  const r = rnd(c.id + "mo");
  if (c.type === "Quoted shares") return { status: "Verified", by: "Independent price verification (CSCS feed)", at: iso(subDays(DEMO_NOW, 1)) };
  if (recent && r < 0.55) return { status: "Pending" };
  if (r < 0.06) return { status: "Queried", by: "Middle Office", at: iso(subDays(DEMO_NOW, 6)), note: "FSV assumption looks optimistic vs comparable disposals — please confirm with the valuer." };
  return { status: "Verified", by: "Middle Office", at: iso(addDays(new Date(c.valuedAt), 6)) };
}

export const moTones = { Verified: "success", Pending: "info", Queried: "warning" } as const;

export type LienStatus = "Lien-marked (CSCS confirmed)" | "Pending CSCS confirmation" | "Pledged elsewhere — flagged" | "Released";
export function lienSeed(c: Collateral): LienStatus {
  const r = rnd(c.id + "lien");
  return c.perfection !== "Perfected" ? "Pending CSCS confirmation" : r < 0.08 ? "Pledged elsewhere — flagged" : "Lien-marked (CSCS confirmed)";
}
export const lienTones = { "Lien-marked (CSCS confirmed)": "success", "Pending CSCS confirmation": "info", "Pledged elsewhere — flagged": "danger", Released: "neutral" } as const;

/* ---------------- Legal workflow (PRD §6.5, §6.1.1) ---------------- */

export type LegalRecord = {
  searchStatus: "Not requested" | "Requested" | "Clean" | "Encumbrance found";
  searchAt?: string;
  registry?: string;
  genuineness: "Pending" | "Confirmed" | "Doubtful";
  vaultRef?: string;
  vaultedAt?: string;
  signOff?: { by: string; at: string; opinion: string };
  checkedOut?: { by: string; at: string; purpose: string };
};

export function registryFor(c: Collateral): string {
  if (c.type.includes("mortgage")) return `${c.location ?? "Lagos"} State Lands Registry`;
  if (c.type === "Debenture" || c.type === "Equipment" || c.type === "Vehicle") return "Corporate Affairs Commission (charges register)";
  if (c.type === "Quoted shares") return "CSCS (lien register)";
  return "Not applicable — contractual security";
}

export function legalSeed(c: Collateral): LegalRecord {
  const done = c.perfection === "Perfected";
  const idx = ["Not started", "Search in progress", "Documentation", "Registration", "Perfected", "Defective"].indexOf(c.perfection);
  return {
    searchStatus: idx <= 0 ? "Not requested" : idx === 1 ? "Requested" : c.perfection === "Defective" ? "Encumbrance found" : "Clean",
    searchAt: idx >= 2 ? iso(subDays(new Date(c.valuedAt), 20)) : idx === 1 ? iso(subDays(DEMO_NOW, 2 + (hash(c.id) % 6))) : undefined,
    registry: registryFor(c),
    genuineness: idx >= 3 && c.perfection !== "Defective" ? "Confirmed" : c.perfection === "Defective" ? "Doubtful" : "Pending",
    vaultRef: done ? `VLT-${String(hash(c.id) % 90000 + 10000)}` : undefined,
    vaultedAt: done ? iso(addDays(new Date(c.valuedAt), 14)) : undefined,
    signOff: done ? { by: "Legal Officer", at: iso(addDays(new Date(c.valuedAt), 15)), opinion: "Security documents genuine; perfection complete; legally sufficient." } : undefined,
  };
}

/* ---------------- SEC / exchange corporate actions (simulated) ---------------- */

export type CorporateAction = { ticker: string; kind: "Dividend" | "Bonus issue" | "Rights issue" | "Closed period" | "Results filing"; detail: string; at: string };

export const corporateActions: CorporateAction[] = [
  { ticker: "ZENITHBANK", kind: "Results filing", detail: "Q3 2026 unaudited results filed (simulated)", at: iso(subDays(DEMO_NOW, 12)) },
  { ticker: "MTNN", kind: "Closed period", detail: "Closed period ahead of results (simulated)", at: iso(subDays(DEMO_NOW, 4)) },
  { ticker: "DANGCEM", kind: "Dividend", detail: "Interim dividend qualification date (simulated)", at: iso(addDays(DEMO_NOW, 9)) },
  { ticker: "OKOMUOIL", kind: "Bonus issue", detail: "Bonus issue 1-for-10 proposed — units to be adjusted on allotment (simulated)", at: iso(addDays(DEMO_NOW, 21)) },
  { ticker: "GTCO", kind: "Rights issue", detail: "Rights circular filed (simulated)", at: iso(subDays(DEMO_NOW, 26)) },
];
