/**
 * Loan Review & Monitoring domain logic (PRD §6.4).
 * Pure functions — no React. Thresholds, SLAs and ladder roles come from business rules (src/modules/monitoring/platform.ts),
 * read at call time with getRule. BACKEND SEAM: the Rules & Parameters Engine evaluates these server-side.
 */
import { addDays, differenceInCalendarDays, isWeekend } from "date-fns";
import type { CbnClass, Facility, Ifrs9Stage } from "@/lib/data/types";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { getRule } from "@/lib/platform/rules";
import type { Tone } from "@credigit/web-ui";
import { DEMO_NOW } from "@/lib/data/seed";

/* ---------------- CBN days-past-due ladder (PRD §6.4.1, §6.7.1) — thresholds from business rules ---------------- */

export type DpdBucket = string;

export type DpdBucketDef = { id: DpdBucket; from: number; to?: number; cbnClass: CbnClass; stage: Ifrs9Stage; tone: Tone; rule: string };

/** DPD thresholds from business rules `monitoring.dpd.*` (read at call time). */
export function dpdThresholds() {
  return {
    watchlist: getRule<number>("monitoring.dpd.watchlistFromDays"),
    substandard: getRule<number>("monitoring.dpd.substandardFromDays"),
    doubtful: getRule<number>("monitoring.dpd.doubtfulFromDays"),
    lost: getRule<number>("monitoring.dpd.lostFromDays"),
  };
}

/** The ladder, labelled from the current rule values. */
export function dpdBuckets(): DpdBucketDef[] {
  const t = dpdThresholds();
  const range = (a: number, b: number) => `${a}–${b - 1} days`;
  return [
    { id: "Current", from: 0, to: 1, cbnClass: "Performing", stage: 1, tone: "success", rule: "Up to date per agreed terms" },
    { id: range(1, t.watchlist), from: 1, to: t.watchlist, cbnClass: "Performing", stage: 1, tone: "info", rule: "Early arrears — Performing" },
    { id: range(t.watchlist, t.substandard), from: t.watchlist, to: t.substandard, cbnClass: "Watchlist", stage: 2, tone: "warning", rule: `Watchlist / early arrears (${range(t.watchlist, t.substandard)}) — IFRS 9 Stage 2` },
    { id: range(t.substandard, t.doubtful), from: t.substandard, to: t.doubtful, cbnClass: "Substandard", stage: 3, tone: "warning", rule: `Non-performing — Sub-Standard (${range(t.substandard, t.doubtful)})` },
    { id: range(t.doubtful, t.lost), from: t.doubtful, to: t.lost, cbnClass: "Doubtful", stage: 3, tone: "danger", rule: `Non-performing — Doubtful (${range(t.doubtful, t.lost)})` },
    { id: `${t.lost}+ days`, from: t.lost, cbnClass: "Lost", stage: 3, tone: "danger", rule: `Non-performing — Lost (${t.lost}+ days)` },
  ];
}

export function dpdBucketDef(dpd: number): DpdBucketDef {
  const list = dpdBuckets();
  if (dpd <= 0) return list[0]!;
  return list.find((b) => dpd >= b.from && (b.to === undefined || dpd < b.to)) ?? list[list.length - 1]!;
}

export function dpdBucket(dpd: number): DpdBucket {
  return dpdBucketDef(dpd).id;
}

/** CBN class from days past due alone (qualitative watchlist triggers can move a facility to Watchlist earlier). */
export function cbnClassFromDpd(dpd: number): CbnClass {
  return dpdBucketDef(dpd).cbnClass;
}

/** CBN specific provision label per class (business rules `monitoring.cbn.*ProvisionPct`). */
export function provisionLabel(cbnClass: CbnClass | string): string {
  if (cbnClass === "Substandard") return `${getRule<number>("monitoring.cbn.substandardProvisionPct")}%`;
  if (cbnClass === "Doubtful") return `${getRule<number>("monitoring.cbn.doubtfulProvisionPct")}%`;
  if (cbnClass === "Lost") return `${getRule<number>("monitoring.cbn.lostProvisionPct")}%`;
  return cbnClass === "Watchlist" ? "Enhanced monitoring" : "0%";
}

export const cbnClassTones: Record<string, Tone> = {
  Performing: "success",
  Watchlist: "warning",
  Substandard: "warning",
  Doubtful: "danger",
  Lost: "danger",
};

export const stageTones: Record<string, Tone> = { "Stage 1": "success", "Stage 2": "warning", "Stage 3": "danger" };

export const isNonPerforming = (dpd: number) => dpd >= getRule<number>("monitoring.dpd.substandardFromDays");
export const isWatchlist = (dpd: number) => dpd >= getRule<number>("monitoring.dpd.watchlistFromDays") && !isNonPerforming(dpd);

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

/** PRD §6.4.4: a manual "mark as resolved" without evidence is not permitted for these types (business rule). */
export function evidenceRequired(type: ExceptionType): boolean {
  return getRule<string[]>("monitoring.exceptions.evidenceRequiredTypes").includes(type);
}

export type EscalationLevel = 1 | 2 | 3 | 4;

export type LadderLevel = { level: EscalationLevel; trigger: string; notified: string; roles: RoleId[]; slaBusinessDays: number; sla: string };

const ladderTriggers: Record<EscalationLevel, string> = {
  1: "Exception first detected",
  2: "Level 1 SLA lapses uncured",
  3: "Level 2 SLA lapses uncured",
  4: "Level 3 SLA lapses uncured",
};

const roleNames = (ids: RoleId[]) => ids.map((r) => roleById[r]?.name ?? r).join(" + ");

/** SLA (business days) for a level — business rule `monitoring.escalation.l<n>SlaBusinessDays`. */
export function slaBusinessDays(level: EscalationLevel): number {
  return getRule<number>(`monitoring.escalation.l${level}SlaBusinessDays`);
}

/** Roles notified at a level; Level 4 adds the Board roles above the materiality threshold (PRD §6.4.4). */
export function ladderRoles(level: EscalationLevel, amount?: number): RoleId[] {
  const roles = getRule<RoleId[]>(`monitoring.escalation.l${level}Roles`);
  if (level === 4 && (amount ?? 0) > getRule<number>("monitoring.escalation.boardMaterialityNgn")) return [...new Set([...roles, ...getRule<RoleId[]>("monitoring.escalation.boardRoles")])];
  return roles;
}

/** Roles notified up to and including a level (each level adds officers; nobody drops off). */
export function rolesUpTo(level: EscalationLevel, amount?: number): RoleId[] {
  return [...new Set(([1, 2, 3, 4] as EscalationLevel[]).filter((l) => l <= level).flatMap((l) => ladderRoles(l, amount)))];
}

/** The escalation ladder from current business rules. */
export function escalationLadder(): LadderLevel[] {
  return ([1, 2, 3, 4] as EscalationLevel[]).map((level) => {
    const roles = ladderRoles(level);
    const days = slaBusinessDays(level);
    const board = getRule<RoleId[]>("monitoring.escalation.boardRoles");
    return {
      level,
      trigger: ladderTriggers[level],
      roles,
      notified: level === 4 ? `${roleNames(roles)}, plus ${roleNames(board)} above the materiality threshold` : roleNames(roles),
      slaBusinessDays: days,
      sla: level === 4 ? `Re-timestamped and re-notified every ${days} business days until cured` : `${days} business days (business rule)`,
    };
  });
}

export const levelTones: Record<EscalationLevel, Tone> = { 1: "info", 2: "warning", 3: "danger", 4: "danger" };

/* ---------------- Nature-of-Business profile (PRD §6.4.3) ---------------- */

export type NatureOfBusiness = "Steady / Regular" | "Seasonal" | "Project / Milestone-based" | "Cyclical";

/** Nature-of-Business profile for a sector — business rules `monitoring.nature.<sectorId>` (tenant classification). */
export function natureOfSector(sectorId: string): NatureOfBusiness {
  try {
    return getRule<NatureOfBusiness>(`monitoring.nature.${sectorId}`);
  } catch {
    return getRule<NatureOfBusiness>("monitoring.nature.default");
  }
}

export const natureDescriptions: Record<NatureOfBusiness, string> = {
  "Steady / Regular": "Retail, FMCG, salaried-income-backed — inflow expected every month; silence is an exception.",
  Seasonal: "Agriculture, education-fee cycles, festive retail — off-season silence is not an exception.",
  "Project / Milestone-based": "Construction, contract services — lumpy receipts tied to milestones.",
  Cyclical: "Commodity-linked manufacturing / trading — inflows follow the commodity cycle.",
};
