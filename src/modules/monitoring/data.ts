/**
 * Loan Review & Monitoring — module mock data (deterministic, derived from the shared Risk Data Spine).
 * BACKEND SEAM: each generator stands in for a read-model query (covenant register, inflow projection,
 * APG / TOD registers). Keep the shapes; swap the bodies for API calls.
 */
import { addDays, format, subDays, subMonths } from "date-fns";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Facility, Obligor } from "@/lib/data/types";
import { natureBySector, type NatureOfBusiness } from "./logic";

/* ---------------- deterministic helpers ---------------- */

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Deterministic 0..1 value for a key. */
export function rnd(key: string): number {
  return (hash(key) % 100000) / 100000;
}
const between = (key: string, min: number, max: number) => min + rnd(key) * (max - min);
const pickBy = <T,>(key: string, arr: readonly T[]) => arr[hash(key) % arr.length]!;
const iso = (d: Date) => d.toISOString();

/* ---------------- Covenant register (PRD §6.4.3) ---------------- */

export type CovenantKind = "Financial" | "Reporting" | "Turnover / domiciliation" | "Security" | "Operational";
export type CovenantStatus = "Compliant" | "Due" | "Overdue" | "Breached" | "Waived";

export type Covenant = {
  id: string;
  facilityId: string;
  obligorId: string;
  kind: CovenantKind;
  text: string;
  frequency: "Monthly" | "Quarterly" | "Semi-annual" | "Annual";
  evidence: string;
  ownerRole: "loan-review-officer" | "credit-admin-officer" | "account-officer";
  lastTestedAt?: string;
  nextTestAt: string;
  status: CovenantStatus;
  lastResult?: string;
};

const covenantTemplates: Array<Omit<Covenant, "id" | "facilityId" | "obligorId" | "nextTestAt" | "status" | "lastTestedAt" | "lastResult">> = [
  { kind: "Financial", text: "Debt service cover ratio ≥ 1.25x (as per offer letter)", frequency: "Quarterly", evidence: "Quarterly management accounts + DSCR computation", ownerRole: "loan-review-officer" },
  { kind: "Reporting", text: "Audited financial statements within 6 months of financial year-end", frequency: "Annual", evidence: "Audited financial statements (signed)", ownerRole: "credit-admin-officer" },
  { kind: "Reporting", text: "Quarterly management accounts within 45 days of quarter-end", frequency: "Quarterly", evidence: "Management accounts", ownerRole: "account-officer" },
  { kind: "Turnover / domiciliation", text: "Domiciliation of contract proceeds to the Harbourline collection account", frequency: "Monthly", evidence: "CBA account-inflow reconciliation", ownerRole: "loan-review-officer" },
  { kind: "Turnover / domiciliation", text: "Minimum monthly credit turnover through the account (as per offer letter)", frequency: "Monthly", evidence: "CBA account-inflow reconciliation", ownerRole: "loan-review-officer" },
  { kind: "Security", text: "Comprehensive insurance on charged assets noting the bank's interest", frequency: "Annual", evidence: "Insurance certificate / endorsement", ownerRole: "credit-admin-officer" },
  { kind: "Financial", text: "Gearing (total debt / equity) within the limit stated in the offer letter", frequency: "Semi-annual", evidence: "Management accounts", ownerRole: "loan-review-officer" },
  { kind: "Operational", text: "No change in ownership or management control without the bank's prior written consent", frequency: "Annual", evidence: "CAC status report", ownerRole: "credit-admin-officer" },
];

export function buildCovenants(facilities: Facility[], obligors: Map<string, Obligor>): Covenant[] {
  const out: Covenant[] = [];
  for (const f of facilities) {
    if (f.status === "Closed" || f.status === "Written off") continue;
    const o = obligors.get(f.obligorId);
    if (!o) continue;
    const n = 1 + (hash(f.id + "n") % (o.type === "Retail" ? 1 : 3));
    const start = hash(f.id + "t") % covenantTemplates.length;
    for (let k = 0; k < n; k++) {
      const t = covenantTemplates[(start + k * 3) % covenantTemplates.length]!;
      const id = `COV-${f.id.slice(4)}-${k + 1}`;
      const stressed = f.dpd >= 30 || o.watchlist;
      const r = rnd(id);
      const status: CovenantStatus = stressed
        ? r < 0.35 ? "Breached" : r < 0.55 ? "Overdue" : r < 0.7 ? "Due" : "Compliant"
        : r < 0.025 ? "Breached" : r < 0.07 ? "Overdue" : r < 0.2 ? "Due" : r < 0.24 ? "Waived" : "Compliant";
      const nextTestAt =
        status === "Overdue" ? subDays(DEMO_NOW, 3 + (hash(id) % 40)) : status === "Due" ? addDays(DEMO_NOW, hash(id) % 30) : addDays(DEMO_NOW, 30 + (hash(id) % 150));
      const lastTestedAt = subMonths(DEMO_NOW, 1 + (hash(id + "l") % 5));
      out.push({
        ...t,
        id,
        facilityId: f.id,
        obligorId: f.obligorId,
        status,
        nextTestAt: iso(nextTestAt),
        lastTestedAt: iso(lastTestedAt),
        lastResult:
          status === "Breached"
            ? t.kind === "Financial"
              ? `Failed — ${t.text.startsWith("Debt") ? `DSCR ${between(id, 0.62, 1.18).toFixed(2)}x` : "limit exceeded"}`
              : t.kind === "Turnover / domiciliation"
                ? `Failed — inflow ${Math.round(between(id, 38, 72))}% of expectation`
                : "Failed — evidence not received"
            : status === "Waived"
              ? "Waived by Credit Administration (within delegated tolerance)"
              : "Passed",
      });
    }
  }
  return out;
}

export const covenantStatusTones = { Compliant: "success", Due: "info", Overdue: "warning", Breached: "danger", Waived: "neutral" } as const;

/* ---------------- Account-inflow tracking (PRD §6.4.3, §5.1) ---------------- */

/** Expected-inflow shape per Nature-of-Business profile, 12 months Nov → Oct (mean = 1). */
const shapes: Record<NatureOfBusiness, number[]> = {
  "Steady / Regular": [1.02, 1.12, 0.94, 0.96, 0.98, 1.0, 0.98, 0.97, 0.99, 1.0, 1.02, 1.02],
  Seasonal: [1.7, 1.9, 1.35, 0.55, 0.3, 0.25, 0.3, 0.45, 0.65, 0.95, 1.35, 2.25],
  "Project / Milestone-based": [0.4, 2.4, 0.3, 0.35, 1.9, 0.4, 0.3, 2.1, 0.35, 0.4, 2.2, 0.9],
  Cyclical: [1.25, 1.3, 1.2, 1.05, 0.9, 0.78, 0.7, 0.72, 0.85, 1.0, 1.1, 1.15],
};

export const inflowMonths = Array.from({ length: 12 }, (_, i) => subMonths(new Date(DEMO_NOW.getFullYear(), DEMO_NOW.getMonth(), 1), 12 - i));
export const inflowMonthLabels = inflowMonths.map((d) => format(d, "MMM yy"));

/** AI envelope half-width (demo value; PRD: AI-built from obligor history + sector seasonality). */
export const ENVELOPE_BAND = 0.25;

export type InflowStatus = "Within envelope" | "Below envelope" | "Above envelope" | "Off-season — within envelope";

export type InflowProfile = {
  obligorId: string;
  nature: NatureOfBusiness;
  expected: number[];
  floor: number[];
  ceiling: number[];
  actual: number[];
  /** Last 3 months: gross CBA credits and the excluded entries (PRD §5.1 reconciliation rule). */
  gross3m: number;
  exclusions: { interBranch: number; suspense: number; inAndOut: number; reversals: number };
  net3m: number;
  expected3m: number;
  ratio3m: number;
  status: InflowStatus;
  aiFlag: boolean;
};

export function buildInflowProfiles(obligors: Obligor[]): InflowProfile[] {
  // Three steady/cyclical obligors with the weakest COP ratio get a sharp recent shortfall (AI-flagged).
  const candidates = obligors
    .filter((o) => (natureBySector[o.sectorId] ?? "Steady / Regular") !== "Seasonal" && natureBySector[o.sectorId] !== "Project / Milestone-based" && o.type !== "Retail")
    .sort((a, b) => a.verifiedTurnover / a.declaredTurnover - b.verifiedTurnover / b.declaredTurnover)
    .slice(0, 3)
    .map((o) => o.id);
  return obligors.map((o) => {
    const nature = natureBySector[o.sectorId] ?? "Steady / Regular";
    const shape = shapes[nature];
    const monthlyDeclared = o.declaredTurnover / 12;
    const cop = o.verifiedTurnover / o.declaredTurnover;
    const expected = shape.map((s) => Math.round(monthlyDeclared * s));
    const flagged = candidates.includes(o.id);
    const actual = shape.map((s, m) => {
      const noise = between(`${o.id}-m${m}`, 0.92, 1.08);
      const base = monthlyDeclared * s * Math.max(cop, 0.9) * noise;
      return Math.round(flagged && m >= 9 ? monthlyDeclared * s * between(`${o.id}-f${m}`, 0.42, 0.58) : base);
    });
    const floor = expected.map((v) => Math.round(v * (1 - ENVELOPE_BAND)));
    const ceiling = expected.map((v) => Math.round(v * (1 + ENVELOPE_BAND)));
    const net3m = actual.slice(9).reduce((a, b) => a + b, 0);
    const expected3m = expected.slice(9).reduce((a, b) => a + b, 0);
    const floor3m = floor.slice(9).reduce((a, b) => a + b, 0);
    const ceil3m = ceiling.slice(9).reduce((a, b) => a + b, 0);
    const exclRate = between(o.id + "x", 0.06, 0.16);
    const gross3m = Math.round(net3m / (1 - exclRate));
    const excl = gross3m - net3m;
    const w = [between(o.id + "a", 1, 3), between(o.id + "b", 0.5, 1.5), between(o.id + "c", 1, 4), between(o.id + "d", 0.5, 2)];
    const ws = w.reduce((a, b) => a + b, 0);
    const exclusions = {
      interBranch: Math.round((excl * w[0]!) / ws),
      suspense: Math.round((excl * w[1]!) / ws),
      inAndOut: Math.round((excl * w[2]!) / ws),
      reversals: 0,
    };
    exclusions.reversals = excl - exclusions.interBranch - exclusions.suspense - exclusions.inAndOut;
    const offSeason = nature === "Seasonal" && shape.slice(9).reduce((a, b) => a + b, 0) / 3 < 0.9;
    const status: InflowStatus = net3m < floor3m ? "Below envelope" : net3m > ceil3m ? "Above envelope" : offSeason ? "Off-season — within envelope" : "Within envelope";
    return {
      obligorId: o.id,
      nature,
      expected,
      floor,
      ceiling,
      actual,
      gross3m,
      exclusions,
      net3m,
      expected3m,
      ratio3m: net3m / expected3m,
      status,
      aiFlag: flagged,
    };
  });
}

export const inflowStatusTones = { "Within envelope": "success", "Below envelope": "danger", "Above envelope": "info", "Off-season — within envelope": "neutral" } as const;

/* ---------------- Periodic analysis (PRD §6.4.5) ---------------- */

export type PeriodicReview = {
  obligorId: string;
  lastFinancialsAt: string;
  nextDueAt: string;
  type: "Quarterly management accounts" | "Audited financial statements" | "Half-year accounts";
  status: "Received" | "Due" | "Overdue";
  gradeAtOrigination: number;
  gradeNow: number;
  reviewer?: string;
};

export function buildPeriodicReviews(obligors: Obligor[], facilities: Facility[]): PeriodicReview[] {
  const withFacilities = new Set(facilities.filter((f) => f.status === "Active").map((f) => f.obligorId));
  return obligors
    .filter((o) => withFacilities.has(o.id) && o.type !== "Retail")
    .map((o) => {
      const r = rnd(o.id + "pr");
      const status = o.watchlist ? (r < 0.6 ? "Overdue" : "Due") : r < 0.12 ? "Overdue" : r < 0.35 ? "Due" : "Received";
      const type = o.type === "Corporate" ? (r < 0.5 ? "Quarterly management accounts" : "Audited financial statements") : r < 0.5 ? "Half-year accounts" : "Quarterly management accounts";
      const drift = o.watchlist ? 1 + (hash(o.id) % 3) : (hash(o.id) % 3) - 1;
      return {
        obligorId: o.id,
        type,
        lastFinancialsAt: iso(subMonths(DEMO_NOW, status === "Overdue" ? 5 + (hash(o.id) % 4) : 1 + (hash(o.id) % 3))),
        nextDueAt: iso(status === "Overdue" ? subDays(DEMO_NOW, 5 + (hash(o.id) % 50)) : addDays(DEMO_NOW, status === "Due" ? hash(o.id) % 21 : 25 + (hash(o.id) % 70))),
        status,
        gradeAtOrigination: Math.max(1, Math.min(10, o.riskGrade - drift)),
        gradeNow: o.riskGrade,
      } satisfies PeriodicReview;
    });
}

/* ---------------- External agents' fees (PRD §6.4.3) ---------------- */

export type AgentFee = {
  id: string;
  agent: string;
  kind: "Valuer" | "Solicitor" | "Insurance broker" | "Recovery agent";
  obligorId: string;
  invoiceRef: string;
  amount: number;
  invoicedAt: string;
  status: "Reconciled" | "Awaiting debit to customer" | "Disputed" | "Paid — not reconciled";
};

export function buildAgentFees(obligors: Obligor[]): AgentFee[] {
  const agents: Array<[string, AgentFee["kind"]]> = [
    ["Ubosi Eleh & Co", "Valuer"],
    ["Knight Frank Nigeria", "Valuer"],
    ["Jide Taiwo & Co", "Valuer"],
    ["Adeyemi & Partners (solicitors)", "Solicitor"],
    ["Okafor Legal Practice", "Solicitor"],
    ["Northgate Insurance Brokers", "Insurance broker"],
    ["Prime Recoveries Ltd", "Recovery agent"],
  ];
  return Array.from({ length: 14 }, (_, i) => {
    const [agent, kind] = agents[i % agents.length]!;
    const o = obligors[(i * 13 + 4) % obligors.length]!;
    const id = `FEE-${3101 + i}`;
    return {
      id,
      agent,
      kind,
      obligorId: o.id,
      invoiceRef: `INV/${2026}/${String(410 + i * 7).padStart(4, "0")}`,
      amount: Math.round(between(id, 250_000, 4_800_000) / 5000) * 5000,
      invoicedAt: iso(subDays(DEMO_NOW, 4 + i * 6)),
      status: pickBy(id, ["Reconciled", "Reconciled", "Awaiting debit to customer", "Paid — not reconciled", "Disputed"] as const),
    };
  });
}

/* ---------------- APGs & temporary overdrafts (PRD §6.4.2) ---------------- */

export type ApgStatus = "Awaiting advance" | "Crystallised" | "Expiring ≤ 30 days" | "Expired" | "Called" | "Released";

export type Apg = {
  id: string;
  facilityId: string;
  obligorId: string;
  beneficiary: string;
  contractRef: string;
  amount: number;
  issuedAt: string;
  expiryAt: string;
  advanceReceivedAt?: string;
  status: ApgStatus;
};

const beneficiaries = [
  "Lagos State Ministry of Works",
  "Federal Ministry of Power (demo)",
  "Rivers State Water Board",
  "Coastal EPC Contractors Ltd",
  "Northern Roads Development Agency (demo)",
  "Abuja Metropolitan Works (demo)",
];

export function buildApgs(facilities: Facility[]): Apg[] {
  return facilities
    .filter((f) => f.product === "Advance payment guarantee" || f.product === "Bank guarantee")
    .slice(0, 16)
    .map((f, i) => {
      const id = `APG-${f.id.slice(4)}`;
      const issued = new Date(f.startDate);
      const expiry = new Date(f.maturityDate);
      const daysToExpiry = Math.round((expiry.getTime() - DEMO_NOW.getTime()) / 864e5);
      const received = rnd(id) > 0.3;
      const status: ApgStatus =
        i === 3 ? "Called" : daysToExpiry < 0 ? "Expired" : daysToExpiry <= 30 ? "Expiring ≤ 30 days" : received ? "Crystallised" : "Awaiting advance";
      return {
        id,
        facilityId: f.id,
        obligorId: f.obligorId,
        beneficiary: pickBy(id, beneficiaries),
        contractRef: `CTR/${format(issued, "yy")}/${String(hash(id) % 9000 + 1000)}`,
        amount: f.approvedAmount,
        issuedAt: f.startDate,
        expiryAt: daysToExpiry > 400 && i % 4 === 1 ? iso(addDays(DEMO_NOW, 12 + i)) : f.maturityDate,
        advanceReceivedAt: received ? iso(addDays(issued, 5 + (hash(id) % 20))) : undefined,
        status: daysToExpiry > 400 && i % 4 === 1 ? "Expiring ≤ 30 days" : status,
      };
    });
}

export type TodType = "Temporary overdraft" | "Excess over limit" | "Matured loan without renewal" | "Undocumented facility";
export type TodStatus = "Within regularisation window" | "Regularisation overdue" | "Classified non-performing (90+ days)" | "Regularised" | "Converted to facility";

export type Tod = {
  id: string;
  obligorId: string;
  facilityId?: string;
  type: TodType;
  amount: number;
  grantedAt: string;
  regulariseBy: string;
  grantedBy: string;
  status: TodStatus;
};

/** Demo regularisation window (tenant parameter). CBN 12.10: not regularised within 90 days → non-performing. */
export const TOD_WINDOW_DAYS = 30;

export function buildTods(facilities: Facility[], obligors: Obligor[]): Tod[] {
  const ods = facilities.filter((f) => f.product === "Overdraft" || f.product === "Revolving credit" || f.product === "Term loan").slice(0, 60);
  const ages = [6, 12, 21, 28, 34, 41, 57, 73, 96, 118, 9, 16];
  const types: TodType[] = ["Temporary overdraft", "Excess over limit", "Temporary overdraft", "Matured loan without renewal", "Temporary overdraft", "Undocumented facility"];
  return ages.map((age, i) => {
    const f = ods[(i * 5) % ods.length]!;
    const o = obligors.find((x) => x.id === f.obligorId)!;
    const granted = subDays(DEMO_NOW, age);
    const id = `TOD-${4401 + i}`;
    return {
      id,
      obligorId: o.id,
      facilityId: f.id,
      type: types[i % types.length]!,
      amount: Math.round((f.approvedAmount * between(id, 0.05, 0.25)) / 1e5) * 1e5,
      grantedAt: iso(granted),
      regulariseBy: iso(addDays(granted, TOD_WINDOW_DAYS)),
      grantedBy: pickBy(id, ["Group Head", "Chief Credit Officer", "Business Development Manager"]),
      status: age >= 90 ? "Classified non-performing (90+ days)" : age > TOD_WINDOW_DAYS ? "Regularisation overdue" : "Within regularisation window",
    };
  });
}

