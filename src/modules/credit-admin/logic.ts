"use client";

/**
 * Credit Administration domain logic (PRD §6.3): conditions precedent per facility (from the offer letter's
 * §7.1 clauses), release for disbursement, waivers/deferrals/sanctions, covenant status.
 */
import { useMemo } from "react";
import type { ChecklistStatus } from "@credigit/web-ui";
import { useApplications, useCollateral, useFacilities, useObligors, useUsers } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Application, Collateral, Facility, Obligor, User } from "@/lib/data/types";
import { getRule } from "@/lib/platform/rules";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { chartFlow } from "@/lib/workflow";
import { seedClauses, type Clause } from "../offer-letters/library";
import { autoTag, conditionsPrecedent, letterCovenants, useClauses, useOfferLetters, type OfferLetter } from "../offer-letters/store";
import { addDaysIso, daysBetween, pristineSeed, rand } from "./common";
import { useCreditAdminStore, type CpState, type WaiverRequest } from "./store";

/** A CP counts as cleared for drawdown when met, waived, or deferred under an approved deferral. */
export function isCleared(status: ChecklistStatus) {
  return status === "met" || status === "waived" || status === "deferred";
}

/**
 * Credit Administration's delegated tolerance (PRD §4.1; §6.3.2 routes other requests to the approving tier).
 * Business rules `credit-admin.delegatedMaxDeferralDays` / `credit-admin.delegatedCategories`, read at call time.
 */
export function isWithinTolerance(kind: WaiverRequest["kind"], category: string | undefined, days: number): boolean {
  return kind === "Deferral" && !!category && getRule<string[]>("credit-admin.delegatedCategories").includes(category) && days <= getRule<number>("credit-admin.delegatedMaxDeferralDays");
}

/** Human-readable delegated tolerance (from business rules). */
export function toleranceNote(): string {
  return `deferrals of up to ${getRule<number>("credit-admin.delegatedMaxDeferralDays")} days on ${getRule<string[]>("credit-admin.delegatedCategories").join(", ").toLowerCase()} conditions (business rule — set by tenant)`;
}

export type CpItem = { id: string; title: string; category: string; text: string; status: ChecklistStatus; byName?: string; at?: string; note?: string; source: "letter" | "default" };

export type FacilityRow = {
  facility: Facility;
  obligor?: Obligor;
  app?: Application;
  letter?: OfferLetter;
  cpKey: string;
  cps: CpItem[];
  cleared: number;
  released?: { byName: string; at: string };
  undisbursed: number;
  utilisation: number;
  approverRoleIds: RoleId[];
};

type Profile = "all-met" | "one-pending" | "early" | "partial" | "booked";

/** Stage of an application in the pristine seed (seeded CP profiles stay stable as live stages change). */
function seedStage(appId: string | undefined) {
  return appId ? pristineSeed().applications.find((a) => a.id === appId)?.stage : undefined;
}

function ordinal(appId: string) {
  const apps = pristineSeed().applications;
  const stage = seedStage(appId);
  return apps
    .filter((a) => a.stage === stage)
    .sort((a, b) => a.id.localeCompare(b.id))
    .findIndex((a) => a.id === appId);
}

function profileFor(app: Application | undefined): Profile {
  if (!app) return "all-met";
  const stage = seedStage(app.id);
  if (!stage) return "early"; // created after the seed (e.g. a new application reaching Offer)
  const ord = ordinal(app.id);
  switch (stage) {
    case "Booked":
      return "booked";
    case "Disbursement":
      return ord % 3 === 1 ? "one-pending" : "all-met";
    case "Conditions":
      return ord === 0 ? "early" : "partial";
    default:
      return "early";
  }
}

/** The CP that is still open on a "one-pending" facility (security conditions first). */
function blockingCp(ids: string[]) {
  return ["CP-11", "CP-12", "CP-13", "CP-09", "CP-03", "CP-06"].find((id) => ids.includes(id)) ?? ids[ids.length - 1];
}

function defaultStatus(id: string, profile: Profile, ids: string[], app: Application | undefined, letter: OfferLetter | undefined, key: string): ChecklistStatus {
  if (id === "CP-02") return letter?.status === "Accepted" || profile === "all-met" || profile === "booked" ? "met" : "pending";
  switch (profile) {
    case "all-met":
    case "booked":
      return "met";
    case "one-pending":
      return id === blockingCp(ids) ? "pending" : "met";
    case "partial":
      return id === "CP-01" || id === "CP-04" || rand(key, id) < 0.6 ? "met" : "pending";
    case "early":
      return id === "CP-01" || (id === "CP-04" && app?.crmsChecked) ? "met" : "pending";
  }
}

/** Approving tier of the original facility → roles that may approve a waiver/deferral (PRD §6.3.2). */
export function approverRolesFor(app: Application | undefined, amount: number): RoleId[] {
  if (app) {
    const top = Math.max(...app.approvals.filter((s) => s.decision === "approved" || s.decision === "adjudicated").map((s) => s.tier), 0);
    if (top > 0) return [...new Set(app.approvals.filter((s) => s.tier === top).map((s) => s.roleId))];
  }
  const tier = chartFlow.find((t, i) => i >= 1 && amount <= t.limit) ?? chartFlow[chartFlow.length - 1]!;
  return tier.roles;
}

/** Whether a role may approve at (or above) the given approving tier. */
export function canApproveAtTier(roleId: RoleId | undefined, required: RoleId[]): boolean {
  if (!roleId) return false;
  if (required.includes(roleId)) return true;
  const mine = roleById[roleId]?.tier;
  const need = Math.min(...required.map((r) => roleById[r]?.tier ?? 99));
  return mine != null && mine >= need;
}

function pseudoCpIds(facility: Facility, obligor: Obligor | undefined, collateral: Collateral[]): string[] {
  return autoTag(
    seedClauses.filter((c) => c.library === "pre"),
    {
      product: facility.product,
      obligorType: obligor?.type ?? "Corporate",
      sectorId: obligor?.sectorId ?? "",
      currency: facility.currency,
      collateralTypes: collateral.filter((c) => facility.collateralIds.includes(c.id)).map((c) => c.type),
      covenants: [],
    },
  );
}

// ---------------- Seeded waivers / deferrals / sanctions ----------------

function seedWaivers(rows: Array<Omit<FacilityRow, "cps" | "cleared"> & { cpIds: Array<{ id: string; title: string; category: string }> }>, users: User[]): WaiverRequest[] {
  const cad = users.find((u) => u.roleId === "credit-admin-officer");
  const by = { requestedById: cad?.id ?? "USR-CAD", requestedByName: cad?.name ?? "Credit Administration Officer" };
  const nameOf = (roles: RoleId[]) => users.find((u) => u.roleId === roles[0])?.name ?? roleById[roles[0]!].name;
  const out: WaiverRequest[] = [];
  const booked = rows.filter((r) => seedStage(r.app?.id) === "Booked");
  const pending = rows.filter((r) => seedStage(r.app?.id) === "Disbursement");
  const seededActive = rows.filter((r) => !r.app && r.facility.status === "Active" && r.cpIds.length > 4).slice(0, 4);
  const pick = (r: (typeof rows)[number], prefer: string[]) => r.cpIds.find((c) => prefer.includes(c.id)) ?? r.cpIds[r.cpIds.length - 1]!;
  const make = (r: (typeof rows)[number], n: number, cp: { id: string; title: string; category: string }, w: Partial<WaiverRequest> & Pick<WaiverRequest, "kind" | "status" | "reason">): WaiverRequest => ({
    id: `WVR-${String(3101 + n)}`,
    facilityId: r.facility.id,
    cpKey: r.cpKey,
    conditionId: cp.id,
    conditionTitle: cp.title,
    conditionCategory: cp.category,
    ...by,
    requestedAt: addDaysIso(DEMO_NOW, -(n + 2)),
    approverRoleIds: r.approverRoleIds,
    withinTolerance: false,
    ...w,
  });
  if (booked[0]) {
    const cp = pick(booked[0], ["CP-11", "CP-12", "CP-13"]);
    out.push(make(booked[0], 0, cp, { kind: "Deferral", status: "Approved", reason: "Perfection at the land registry is in progress; registered deed expected after the registry's batch processing.", expiryDate: addDaysIso(DEMO_NOW, 5), decidedByName: nameOf(booked[0].approverRoleIds), decidedAt: addDaysIso(DEMO_NOW, -20), decisionComment: "Deferral approved; disbursement may proceed. Track to expiry." }));
  }
  if (booked[1]) {
    const cp = pick(booked[1], ["CP-07", "CP-03", "CP-06"]);
    out.push(make(booked[1], 1, cp, { kind: "Waiver", status: "Approved", reason: "Condition superseded by a corporate guarantee from the parent company, already held on file.", expiryDate: addDaysIso(DEMO_NOW, 48), decidedByName: nameOf(booked[1].approverRoleIds), decidedAt: addDaysIso(DEMO_NOW, -15), decisionComment: "Waived for the current tenor only." }));
  }
  if (pending[1]) {
    const blocked = blockingCp(pending[1].cpIds.map((c) => c.id));
    const cp = pending[1].cpIds.find((c) => c.id === blocked)!;
    out.push(
      make(pending[1], 2, cp, {
        kind: "Deferral",
        status: "Pending approval",
        reason: "Customer has executed the security documents; registration is awaiting stamping. Request to defer to post-disbursement.",
        expiryDate: addDaysIso(DEMO_NOW, 21),
        requestedAt: addDaysIso(DEMO_NOW, -1),
        withinTolerance: isWithinTolerance("Deferral", cp.category, 21),
      }),
    );
  }
  if (booked[2]) {
    const cp = pick(booked[2], ["CP-13", "CP-09"]);
    out.push(make(booked[2], 3, cp, { kind: "Waiver", status: "Declined", reason: "Customer requests waiver of insurance pending renewal of its group policy.", decidedByName: nameOf(booked[2].approverRoleIds), decidedAt: addDaysIso(DEMO_NOW, -9), decisionComment: "Insurance of pledged assets is a core security condition; waiver not supported." }));
  }
  if (seededActive[0]) {
    const r = seededActive[0];
    const cp = pick(r, ["CP-13", "CP-11"]);
    out.push(make(r, 4, cp, { kind: "Deferral", status: "Lapsed", reason: "Insurance renewal certificate to follow from the broker.", expiryDate: addDaysIso(DEMO_NOW, -4), requestedAt: addDaysIso(DEMO_NOW, -34), decidedByName: nameOf(r.approverRoleIds), decidedAt: addDaysIso(DEMO_NOW, -33) }));
    out.push(
      make(r, 5, cp, {
        kind: "Sanction for breach",
        status: "Routed to Operational Risk",
        reason: "Deferred condition lapsed without regularisation while the facility remained drawn.",
        breachDetail: "Branch credit unit — deferral not tracked to expiry",
        lossEventRef: "LE-2026-041",
        requestedAt: addDaysIso(DEMO_NOW, -3),
        decidedByName: users.find((u) => u.roleId === "head-of-risk")?.name ?? "Head of Risk",
        decidedAt: addDaysIso(DEMO_NOW, -2),
      }),
    );
  }
  const boardCase = rows.find((x) => !x.app && x.facility.status === "Active" && x !== seededActive[0] && x.cpIds.some((c) => c.id === "CP-03")) ?? seededActive[1];
  if (boardCase) {
    const r = boardCase;
    const cp = pick(r, ["CP-03", "CP-01"]);
    out.push(make(r, 6, cp, { kind: "Sanction for breach", status: "Pending approval", reason: "Facility disbursed before the required Board resolution was on file (identified at credit-file review).", breachDetail: "Domestic Operations — disbursement executed with an open CP", requestedAt: addDaysIso(DEMO_NOW, -1) }));
  }
  if (seededActive[2]) {
    const r = seededActive[2];
    const cp = pick(r, ["CP-06", "CP-01"]);
    out.push(make(r, 7, cp, { kind: "Waiver", status: "Closed", reason: "Processing fee waived as part of renewal pricing concession.", expiryDate: addDaysIso(DEMO_NOW, -60), requestedAt: addDaysIso(DEMO_NOW, -120), decidedByName: nameOf(r.approverRoleIds), decidedAt: addDaysIso(DEMO_NOW, -118) }));
  }
  if (seededActive[3]) {
    const r = seededActive[3];
    const cp = pick(r, ["CP-13", "CP-09", "CP-01"]);
    out.push(make(r, 8, cp, { kind: "Deferral", status: "Pending approval", reason: "Updated valuation report delayed by the valuer; requesting 14-day deferral.", expiryDate: addDaysIso(DEMO_NOW, 14), requestedAt: addDaysIso(DEMO_NOW, -0.5) }));
  }
  return out;
}

/** Effective status of a waiver (approved items lapse after their expiry date). */
export function waiverStatus(w: WaiverRequest): WaiverRequest["status"] {
  if (w.status === "Approved" && w.kind !== "Sanction for breach" && w.expiryDate && new Date(w.expiryDate) < DEMO_NOW) return "Lapsed";
  return w.status;
}

export function useWaivers(): WaiverRequest[] {
  const { seeded } = useFacilityBase();
  const stored = useCreditAdminStore((s) => s.waivers);
  return useMemo(() => {
    const seen = new Set(seeded.map((w) => w.id));
    return [...Object.values(stored).filter((w) => !seen.has(w.id)), ...seeded.map((w) => stored[w.id] ?? w)].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }, [seeded, stored]);
}

/** Facilities joined with obligor, application, letter, CP id list, approving tier (no statuses). */
function useFacilityBase() {
  const facilities = useFacilities();
  const apps = useApplications();
  const obligors = useObligors();
  const collateral = useCollateral();
  const users = useUsers();
  const letters = useOfferLetters();
  const clauses = useClauses();
  return useMemo(() => {
    const appById = new Map(apps.map((a) => [a.id, a]));
    const obligorById = new Map(obligors.map((o) => [o.id, o]));
    const letterByApp = new Map(letters.map((l) => [l.applicationId, l]));
    const rows = facilities.map((facility) => {
      const app = facility.applicationId ? appById.get(facility.applicationId) : undefined;
      const obligor = obligorById.get(facility.obligorId);
      const letter = app ? letterByApp.get(app.id) : undefined;
      const cpIds = letter
        ? conditionsPrecedent(letter, clauses).map(({ id, title, category }) => ({ id, title, category }))
        : pseudoCpIds(facility, obligor, collateral).map((id) => {
            const c = seedClauses.find((x) => x.id === id)!;
            return { id, title: c.title, category: c.category };
          });
      return {
        facility,
        obligor,
        app,
        letter,
        cpKey: app?.id ?? facility.id,
        cpIds,
        undisbursed: Math.max(0, facility.approvedAmount - facility.outstanding),
        utilisation: facility.approvedAmount ? facility.outstanding / facility.approvedAmount : 0,
        approverRoleIds: approverRolesFor(app, facility.approvedAmount),
      };
    });
    return { rows, seeded: seedWaivers(rows, users), apps, clauses };
  }, [facilities, apps, obligors, collateral, users, letters, clauses]);
}

function statusFromWaivers(waivers: WaiverRequest[], key: string, id: string): ChecklistStatus | undefined {
  const w = waivers.find((x) => x.cpKey === key && x.conditionId === id && ["Approved", "Lapsed", "Closed", "Routed to Operational Risk"].includes(x.status));
  if (!w) return undefined;
  const st = waiverStatus(w);
  if (w.kind === "Sanction for breach" || st === "Lapsed") return "breached";
  if (st === "Closed") return "met";
  return w.kind === "Waiver" ? "waived" : "deferred";
}

function buildCps(
  key: string,
  ids: Array<{ id: string; title: string; category: string }>,
  texts: Map<string, string>,
  profile: Profile,
  app: Application | undefined,
  letter: OfferLetter | undefined,
  stored: Record<string, CpState> | undefined,
  waivers: WaiverRequest[],
): CpItem[] {
  const idList = ids.map((c) => c.id);
  return ids.map((c) => {
    const s = stored?.[c.id];
    const status = s?.status ?? statusFromWaivers(waivers, key, c.id) ?? defaultStatus(c.id, profile, idList, app, letter, key);
    return { ...c, text: texts.get(c.id) ?? "", status, byName: s?.byName, at: s?.at, note: s?.note, source: letter ? "letter" : "default" };
  });
}

/** Facility register rows with CP checklist status and release state. */
export function useFacilityRows(): FacilityRow[] {
  const { rows, seeded, clauses } = useFacilityBase();
  const cp = useCreditAdminStore((s) => s.cp);
  const released = useCreditAdminStore((s) => s.released);
  const storedWaivers = useCreditAdminStore((s) => s.waivers);
  return useMemo(() => {
    const waivers = [...seeded.map((w) => storedWaivers[w.id] ?? w), ...Object.values(storedWaivers).filter((w) => !seeded.some((x) => x.id === w.id))];
    const texts = new Map(clauses.map((c) => [c.id, c.text]));
    return rows.map((r) => {
      for (const c of r.letter?.customClauses ?? []) texts.set(c.id, c.text);
      const profile = profileFor(r.app);
      const cps = buildCps(r.cpKey, r.cpIds, texts, profile, r.app, r.letter, cp[r.cpKey], waivers);
      const seededRelease = seedStage(r.app?.id) === "Disbursement" && profile === "all-met" ? { byName: "Credit Administration", at: addDaysIso(DEMO_NOW, -1) } : undefined;
      return { ...r, cps, cleared: cps.filter((x) => isCleared(x.status)).length, released: released[r.facility.id] ?? seededRelease };
    });
  }, [rows, seeded, clauses, cp, released, storedWaivers]);
}

export function useFacilityRow(id: string | null | undefined) {
  const rows = useFacilityRows();
  return useMemo(() => rows.find((r) => r.facility.id === id), [rows, id]);
}

/** CP checklist for an application that has no facility yet (Offer / Conditions stage) — used by the letter composer. */
export function useApplicationCps(app: Application | undefined, letter: OfferLetter | undefined): CpItem[] {
  const clauses = useClauses();
  const stored = useCreditAdminStore((s) => (app ? s.cp[app.id] : undefined));
  return useMemo(() => {
    if (!app || !letter) return [];
    const list = conditionsPrecedent(letter, clauses);
    const texts = new Map(list.map((c) => [c.id, c.text]));
    return buildCps(app.id, list, texts, profileFor(app), app, letter, stored, []);
  }, [app, letter, clauses, stored]);
}

// ---------------- Covenants ----------------

export type CovenantStatus = "Compliant" | "Watch" | "Breached" | "Not yet tested";
export type CovenantRow = { id: string; title: string; category: string; status: CovenantStatus; lastTested?: string; nextTest: string; source: string };

export function covenantsFor(row: FacilityRow, clauses: Clause[]): CovenantRow[] {
  const { facility, letter, app, obligor } = row;
  const list: Array<{ id: string; title: string; category: string; source: string }> = letter
    ? letterCovenants(letter, clauses).map((c) => ({ id: c.id, title: c.title, category: c.category, source: c.id.startsWith("SC-") ? "Tagged at origination (§6.1.5)" : "Offer letter (§7.3)" }))
    : clauses.filter((c) => c.library === "general" && c.category === "Covenant").map((c) => ({ id: c.id, title: c.title, category: c.category, source: "Offer letter (§7.3)" }));
  if (!letter && app) for (const t of app.covenants) list.push({ id: t, title: t, category: "Special covenant", source: "Tagged at origination (§6.1.5)" });
  const stress = facility.dpd >= 30 || obligor?.watchlist;
  return list.map((c) => {
    const r = rand(facility.id, c.id);
    const status: CovenantStatus = facility.status === "Pending disbursement" ? "Not yet tested" : stress && r < 0.35 ? "Breached" : stress || r < 0.08 ? "Watch" : "Compliant";
    const age = Math.floor(rand(facility.id, `${c.id}t`) * 80) + 5;
    return {
      ...c,
      status,
      lastTested: status === "Not yet tested" ? undefined : addDaysIso(DEMO_NOW, -age),
      nextTest: addDaysIso(DEMO_NOW, 90 - age),
    };
  });
}

export const covenantTones = { Compliant: "success", Watch: "warning", Breached: "danger", "Not yet tested": "neutral" } as const;

export function daysToExpiry(iso?: string) {
  return iso ? -daysBetween(iso) : undefined;
}
