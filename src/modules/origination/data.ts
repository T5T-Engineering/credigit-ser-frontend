"use client";

/**
 * Origination module data: deterministic simulated connector output (OCR extraction, statement reconciliation,
 * bureau / CRMS pulls) derived from the shared spine, plus a small persisted store for module-only state
 * (comments, memo sign-off, overrides, exception decisions).
 *
 * BACKEND SEAM: the generators below stand in for the OCR service (§5.4), the CBA / other-bank statement
 * connectors (§5.1, §5.3) and the bureau / CRMS connector (§5.2). Replace with API calls; keep the shapes.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { subDays } from "date-fns";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Application, Facility, ID, Obligor, User } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";

// ---------------------------------------------------------------- deterministic random

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function rng(seed: string) {
  let a = hash(seed);
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (min: number, max: number) => min + (max - min) * next(), int: (min: number, max: number) => Math.floor(min + (max - min + 1) * next()), pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! };
}

// ---------------------------------------------------------------- OCR extraction (§5.4)

export type ExtractedField = { key: string; label: string; value: number; confidence: number; source: string };

/** Structured fields parsed from the audited financial statements (map into the 360 RAR Internal Risk table, §6.2.1). */
export function extractedFinancials(o: Pick<Obligor, "id" | "declaredTurnover">): ExtractedField[] {
  const r = rng(`fin-${o.id}`);
  const t = o.declaredTurnover;
  const ta = t * r.range(0.8, 1.6);
  const ca = ta * r.range(0.35, 0.55);
  const cl = ca * r.range(0.6, 1.1);
  const debt = ta * r.range(0.2, 0.45);
  const conf = () => Number(r.range(0.86, 0.995).toFixed(3));
  const page = (n: number) => `AFS p.${n}`;
  return [
    { key: "turnover", label: "Turnover (declared)", value: t, confidence: conf(), source: page(4) },
    { key: "grossProfit", label: "Gross profit", value: t * r.range(0.22, 0.38), confidence: conf(), source: page(4) },
    { key: "netProfit", label: "Net profit", value: t * r.range(0.04, 0.12), confidence: conf(), source: page(4) },
    { key: "totalAssets", label: "Total assets", value: ta, confidence: conf(), source: page(5) },
    { key: "currentAssets", label: "Current assets", value: ca, confidence: conf(), source: page(5) },
    { key: "currentLiabilities", label: "Current liabilities", value: cl, confidence: conf(), source: page(5) },
    { key: "debt", label: "Total debt", value: debt, confidence: conf(), source: page(6) },
    { key: "interest", label: "Interest expense", value: debt * r.range(0.16, 0.24), confidence: conf(), source: page(4) },
    { key: "stock", label: "Stock (inventory)", value: ca * r.range(0.2, 0.35), confidence: conf(), source: page(5) },
    { key: "debtors", label: "Debtors", value: ca * r.range(0.3, 0.45), confidence: conf(), source: page(5) },
    { key: "creditors", label: "Creditors", value: cl * r.range(0.3, 0.5), confidence: conf(), source: page(5) },
  ].map((f) => ({ ...f, value: Math.round(f.value / 1e3) * 1e3 }));
}

export function ratiosFrom(fields: ExtractedField[]) {
  const v = (k: string) => fields.find((f) => f.key === k)?.value ?? 0;
  return [
    { label: "Gross margin", value: `${((v("grossProfit") / v("turnover")) * 100).toFixed(1)}%`, hint: "Gross profit ÷ turnover" },
    { label: "Net margin", value: `${((v("netProfit") / v("turnover")) * 100).toFixed(1)}%`, hint: "Net profit ÷ turnover" },
    { label: "Current ratio", value: `${(v("currentAssets") / v("currentLiabilities")).toFixed(2)}x`, hint: "Current assets ÷ current liabilities" },
    { label: "Leverage", value: `${((v("debt") / v("totalAssets")) * 100).toFixed(1)}%`, hint: "Total debt ÷ total assets" },
    { label: "Interest cover", value: `${((v("netProfit") + v("interest")) / v("interest")).toFixed(2)}x`, hint: "(Net profit + interest) ÷ interest (proxy)" },
  ];
}

// ---------------------------------------------------------------- Statement reconciliation → COP (§6.1.4)

export type Reconciliation = {
  cbaGross: number;
  otherBankGross: number;
  interBranchSuspense: number;
  inAndOut: number;
  reversals: number;
  verified: number;
  declared: number;
  otherBanks: { name: string; gross: number }[];
  months: number;
};

export function reconciliation(o: Pick<Obligor, "id" | "declaredTurnover" | "verifiedTurnover">): Reconciliation {
  const r = rng(`rec-${o.id}`);
  const verified = o.verifiedTurnover;
  const interPct = r.range(0.03, 0.08);
  const inOutPct = r.range(0.04, 0.12);
  const revPct = r.range(0.01, 0.03);
  const gross = verified / (1 - interPct - inOutPct - revPct);
  const cbaShare = r.range(0.45, 0.75);
  const banks = ["Northgate Bank", "Crestview Bank", "Unity Trust MFB"].slice(0, r.int(1, 3));
  const otherGross = gross * (1 - cbaShare);
  const weights = banks.map(() => r.range(0.4, 1));
  const sum = weights.reduce((s, w) => s + w, 0);
  return {
    cbaGross: Math.round(gross * cbaShare),
    otherBankGross: Math.round(otherGross),
    interBranchSuspense: Math.round(gross * interPct),
    inAndOut: Math.round(gross * inOutPct),
    reversals: Math.round(gross * revPct),
    verified,
    declared: o.declaredTurnover,
    otherBanks: banks.map((name, i) => ({ name, gross: Math.round((otherGross * weights[i]!) / sum) })),
    months: 12,
  };
}

// ---------------------------------------------------------------- Bureau + CRMS (§5.2)

export type BureauLine = { institution: string; facilityType: string; approved: number; outstanding: number; status: "Performing" | "Non-performing" };
export type BureauReport = { source: string; kind: "Bureau" | "CRMS"; reference: string; enquiredAt: string; score?: number; lines: BureauLine[] };

export function bureauReports(o: Obligor, facilities: Facility[], at?: string): BureauReport[] {
  const r = rng(`bur-${o.id}`);
  const ours: BureauLine[] = facilities
    .filter((f) => f.obligorId === o.id && f.status !== "Closed")
    .map((f) => ({ institution: "Harbourline Bank (this bank)", facilityType: f.product, approved: f.approvedAmount, outstanding: f.outstanding, status: f.dpd >= 90 ? "Non-performing" : "Performing" }));
  const others: BureauLine[] = ["Northgate Bank", "Crestview Bank", "Unity Trust MFB", "Meridian Finance Co."].slice(0, r.int(1, 3)).map((inst, i) => {
    const approved = Math.round((o.declaredTurnover * r.range(0.03, 0.18)) / 1e6) * 1e6;
    return {
      institution: inst,
      facilityType: r.pick(["Term loan", "Overdraft", "Asset finance", "Bank guarantee"]),
      approved,
      outstanding: Math.round(approved * r.range(0.2, 0.95)),
      status: o.watchlist && i === 0 && o.riskGrade >= 7 ? "Non-performing" : "Performing",
    };
  });
  const lines = [...ours, ...others];
  const when = at ?? subDays(DEMO_NOW, r.int(1, 12)).toISOString();
  const score = () => Math.round(o.watchlist ? r.range(420, 590) : r.range(610, 790));
  return [
    { source: "CRC Credit Bureau", kind: "Bureau", reference: `CRC-${r.int(10_000_000, 99_999_999)}`, enquiredAt: when, score: score(), lines },
    { source: "FirstCentral Credit Bureau", kind: "Bureau", reference: `FCCB-${r.int(1_000_000, 9_999_999)}`, enquiredAt: when, score: score(), lines },
    { source: "CBN CRMS", kind: "CRMS", reference: `CRMS/${new Date(when).getFullYear()}/${r.int(100_000, 999_999)}`, enquiredAt: when, lines },
  ];
}
export const bureauAdverse = (reports: BureauReport[]) => reports.some((b) => b.lines.some((l) => l.status === "Non-performing"));

// ---------------------------------------------------------------- module store

export type OriginationComment = { id: ID; authorId: ID; authorName: string; roleId: RoleId; body: string; at: string; internal?: boolean };
export type ApplicationExtra = {
  /** Fast-Track product variant (PRD §6.1.3). */
  variant?: string;
  /** Customer explanation documented by the analyst when COP is in the Low band (§6.1.4). */
  copExplanation?: string;
  /** AI-drafted credit memo after human sign-off. */
  memo?: { text: string; by: string; at: string; edited: boolean };
  /** Analyst / CCO override of the engine recommendation (§6.1.5) — reason is mandatory. */
  override?: { from: string; to: string; reason: string; by: string; at: string };
  /** CRO / Board exception decision on a limit breach (§6.1.5). */
  exception?: { decision: "granted" | "refused"; by: string; at: string; comment: string };
  comments?: OriginationComment[];
  bureauRunAt?: string;
};

type OriginationState = {
  extras: Record<ID, ApplicationExtra>;
  patch: (id: ID, changes: Partial<ApplicationExtra>) => void;
};

export const useOriginationStore = create<OriginationState>()(
  persist(
    (set) => ({
      extras: {},
      patch: (id, changes) => set((s) => ({ extras: { ...s.extras, [id]: { ...s.extras[id], ...changes } } })),
    }),
    { name: "credigit.ser.origination", storage: createJSONStorage(() => localStorage), partialize: ({ extras }) => ({ extras }) },
  ),
);

export function useExtra(id: ID | undefined): ApplicationExtra {
  return useOriginationStore((s) => (id ? s.extras[id] : undefined)) ?? EMPTY;
}
const EMPTY: ApplicationExtra = {};

/** Deterministic seeded discussion for demo applications (no user-entered data). */
export function seedComments(appId: ID, app?: Application, users?: User[]): OriginationComment[] {
  if (!app || !users || app.stage === "Draft") return [];
  const by = (roleId: RoleId) => users.find((u) => u.roleId === roleId);
  const ao = users.find((u) => u.id === app.createdById);
  const ca = by("credit-analyst");
  const out: OriginationComment[] = [];
  const at = (h: number) => new Date(new Date(app.createdAt).getTime() + h * 3_600_000).toISOString();
  if (ao) out.push({ id: `${appId}-c1`, authorId: ao.id, authorName: ao.name, roleId: ao.roleId, body: "Customer has submitted the request letter, audited accounts and 12 months' statements. Collateral documents are with Legal for search.", at: at(20) });
  if (ca && !["Documents"].includes(app.stage))
    out.push({ id: `${appId}-c2`, authorId: ca.id, authorName: ca.name, roleId: ca.roleId, body: `@${ao?.name.split(" ")[0] ?? "AO"} please obtain the latest quarter's management accounts — the AFS is ten months old.`, at: at(44), internal: true });
  return out;
}
