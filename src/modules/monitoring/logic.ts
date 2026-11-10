/**
 * Loan Review & Monitoring domain logic (PRD §6.4).
 * Pure functions — no React. Backend seam: these rules move to the Rules & Parameters Engine server-side.
 */
import { addDays, differenceInCalendarDays, isWeekend } from "date-fns";
import type { CbnClass, Facility, Ifrs9Stage } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";
import type { Tone } from "@credigit/web-ui";
import { DEMO_NOW } from "@/lib/data/seed";

/* ---------------- CBN days-past-due ladder (PRD §6.4.1, §6.7.1) ---------------- */

export type DpdBucket = "Current" | "1–29 days" | "30–89 days" | "90–179 days" | "180–359 days" | "360+ days";

export const dpdBuckets: { id: DpdBucket; cbnClass: CbnClass; stage: Ifrs9Stage; tone: Tone; rule: string }[] = [
  { id: "Current", cbnClass: "Performing", stage: 1, tone: "success", rule: "Up to date per agreed terms" },
  { id: "1–29 days", cbnClass: "Performing", stage: 1, tone: "info", rule: "Early arrears — Performing" },
  { id: "30–89 days", cbnClass: "Watchlist", stage: 2, tone: "warning", rule: "Watchlist / early arrears (typically 30–89 days) — IFRS 9 Stage 2" },
  { id: "90–179 days", cbnClass: "Substandard", stage: 3, tone: "warning", rule: "Non-performing — Sub-Standard (90–179 days), 10% CBN provision" },
  { id: "180–359 days", cbnClass: "Doubtful", stage: 3, tone: "danger", rule: "Non-performing — Doubtful (180–359 days), 50% CBN provision" },
  { id: "360+ days", cbnClass: "Lost", stage: 3, tone: "danger", rule: "Non-performing — Lost (360+ days), 100% CBN provision" },
];

export function dpdBucket(dpd: number): DpdBucket {
  if (dpd <= 0) return "Current";
  if (dpd < 30) return "1–29 days";
  if (dpd < 90) return "30–89 days";
  if (dpd < 180) return "90–179 days";
  if (dpd < 360) return "180–359 days";
  return "360+ days";
}

/** CBN class from days past due alone (qualitative watchlist triggers can move a facility to Watchlist earlier). */
export function cbnClassFromDpd(dpd: number): CbnClass {
  return dpdBuckets.find((b) => b.id === dpdBucket(dpd))!.cbnClass;
}

export const cbnClassTones: Record<string, Tone> = {
  Performing: "success",
  Watchlist: "warning",
  Substandard: "warning",
  Doubtful: "danger",
  Lost: "danger",
};

export const stageTones: Record<string, Tone> = { "Stage 1": "success", "Stage 2": "warning", "Stage 3": "danger" };

export const isNonPerforming = (dpd: number) => dpd >= 90;

/** Exposure the bank carries: drawn balance, or the contingent amount for guarantees. */
export function exposureOf(f: Facility): number {
  return f.product.includes("guarantee") ? f.approvedAmount : f.outstanding;
}

/** Date the oldest unpaid instalment fell due. */
export function pastDueSince(dpd: number): Date {
  return addDays(DEMO_NOW, -dpd);
}

/* ---------------- Business days & SLAs (PRD §6.4.4) ---------------- */

export function addBusinessDays(from: Date, days: number): Date {
  let d = new Date(from);
  let left = days;
  while (left > 0) {
    d = addDays(d, 1);
    if (!isWeekend(d)) left--;
  }
  return d;
}

export function daysBetween(a: Date | string, b: Date | string = DEMO_NOW): number {
  return differenceInCalendarDays(new Date(b), new Date(a));
}

/* ---------------- Exception escalation protocol (PRD §6.4.4) ---------------- */

export type ExceptionType =
  | "Past-due obligation"
  | "Covenant breach"
  | "Inflow-envelope deviation"
  | "Limit near-breach"
  | "Share-collateral margin shortfall"
  | "Collateral perfection / insurance"
  | "Temporary overdraft not regularised"
  | "APG expiry"
  | "Unreconciled inter-branch / suspense item"
  | "Periodic financials overdue";

export const exceptionTypes: ExceptionType[] = [
  "Past-due obligation",
  "Covenant breach",
  "Inflow-envelope deviation",
  "Limit near-breach",
  "Share-collateral margin shortfall",
  "Collateral perfection / insurance",
  "Temporary overdraft not regularised",
  "APG expiry",
  "Unreconciled inter-branch / suspense item",
  "Periodic financials overdue",
];

/** PRD §6.4.4: a manual "mark as resolved" without evidence is not permitted for regulatory-relevant types. */
export const regulatoryRelevant: ExceptionType[] = ["Past-due obligation", "Covenant breach", "Limit near-breach"];

export type EscalationLevel = 1 | 2 | 3 | 4;

export const escalationLadder: { level: EscalationLevel; trigger: string; notified: string; roles: RoleId[]; sla: string }[] = [
  {
    level: 1,
    trigger: "Exception first detected",
    notified: "Account Officer + Loan Review / Monitoring Officer for the obligor",
    roles: ["account-officer", "loan-review-officer"],
    sla: "Tenant-configurable (demo: 5 business days), by exception type",
  },
  {
    level: 2,
    trigger: "Level 1 SLA lapses uncured",
    notified: "Group Head / BDM + Credit Administration Officer (adds the officers who approved / administer the facility)",
    roles: ["group-head", "bdm", "credit-admin-officer"],
    sla: "Tenant-configurable (demo: a further 5 business days)",
  },
  {
    level: 3,
    trigger: "Level 2 SLA lapses uncured",
    notified: "Chief Credit Officer + Head of Risk",
    roles: ["cco", "head-of-risk"],
    sla: "Tenant-configurable (demo: a further 5 business days)",
  },
  {
    level: 4,
    trigger: "Level 3 SLA lapses uncured",
    notified: "Chief Risk Officer, plus the Board Risk Committee for exceptions above the materiality threshold",
    roles: ["cro", "board"],
    sla: "Remains open, re-timestamped and re-notified on the same cadence until cured",
  },
];

/** Demo SLA per level (business days). PRD: tenant parameter. */
export const DEMO_SLA_BUSINESS_DAYS = 5;

export const levelTones: Record<EscalationLevel, Tone> = { 1: "info", 2: "warning", 3: "danger", 4: "danger" };

/* ---------------- Nature-of-Business profile (PRD §6.4.3) ---------------- */

export type NatureOfBusiness = "Steady / Regular" | "Seasonal" | "Project / Milestone-based" | "Cyclical";

export const natureBySector: Record<string, NatureOfBusiness> = {
  "SEC-AGR": "Seasonal",
  "SEC-EDU": "Seasonal",
  "SEC-CON": "Project / Milestone-based",
  "SEC-RES": "Project / Milestone-based",
  "SEC-GOV": "Project / Milestone-based",
  "SEC-PWR": "Project / Milestone-based",
  "SEC-MFG": "Cyclical",
  "SEC-OGU": "Cyclical",
  "SEC-OGD": "Cyclical",
  "SEC-MIN": "Cyclical",
  "SEC-COM": "Steady / Regular",
  "SEC-ICT": "Steady / Regular",
  "SEC-HLT": "Steady / Regular",
  "SEC-FIN": "Steady / Regular",
  "SEC-TRN": "Steady / Regular",
};

export const natureDescriptions: Record<NatureOfBusiness, string> = {
  "Steady / Regular": "Retail, FMCG, salaried-income-backed — inflow expected every month; silence is an exception.",
  Seasonal: "Agriculture, education-fee cycles, festive retail — off-season silence is not an exception.",
  "Project / Milestone-based": "Construction, contract services — lumpy receipts tied to milestones.",
  Cyclical: "Commodity-linked manufacturing / trading — inflows follow the commodity cycle.",
};
