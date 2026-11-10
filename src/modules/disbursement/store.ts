"use client";

/**
 * Disbursement (Domestic Operations maker-checker, PRD §4.1 / §4.2). Persisted as `credigit.ser.disbursement`.
 * Seeded history is derived from the shared facilities; the store keeps requests created or changed here.
 * BACKEND SEAM: `saveRequest` → API; authorisation posts to the CBA connector (§5.1) in production.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Application, Facility, Obligor, User } from "@/lib/data/types";
import { getDefinition } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import type { RoleId } from "@/lib/rbac/roles";
import { addDaysIso, hash, pristineSeed, rand } from "../credit-admin/common";

export type DisbursementStatus = "Awaiting authorisation" | "Authorised" | "Returned to maker" | "Rejected" | "Withdrawn";

export type Disbursement = {
  id: string;
  facilityId: string;
  obligorId: string;
  amount: number;
  currency: "NGN" | "USD";
  accountNumber: string;
  accountName: string;
  valueDate: string;
  narration: string;
  status: DisbursementStatus;
  makerId: string;
  makerName: string;
  preparedAt: string;
  checkerId?: string;
  checkerName?: string;
  decidedAt?: string;
  comment?: string;
  stepUpVerified?: boolean;
  cbaReference?: string;
  /** Operations workflow request for the Checker step. */
  operationId?: string;
};

export const disbursementTones = { "Awaiting authorisation": "info", Authorised: "success", "Returned to maker": "warning", Rejected: "danger", Withdrawn: "neutral" } as const;

/** Demo NUBAN for an obligor's operating account (deterministic; length from business rules). */
export function accountFor(obligor: Obligor | undefined): string {
  const len = getRule<number>("disbursement.accountNumberLength");
  return obligor ? String(10 ** (len - 1) + (hash(obligor.id) % (9 * 10 ** (len - 1) - 1))).slice(0, len) : "";
}

function seedRequests(facilities: Facility[], apps: Application[], obligors: Obligor[], users: User[]): Disbursement[] {
  const maker = users.find((u) => u.roleId === "disbursement-maker");
  const checker = users.find((u) => u.roleId === "disbursement-checker");
  const ob = new Map(obligors.map((o) => [o.id, o]));
  const appById = new Map(apps.map((a) => [a.id, a]));
  const out: Disbursement[] = [];
  const base = (f: Facility, n: number, amount: number, at: string): Disbursement => {
    const o = ob.get(f.obligorId);
    return {
      id: `DSB-${String(51001 + n)}`,
      facilityId: f.id,
      obligorId: f.obligorId,
      amount,
      currency: f.currency,
      accountNumber: accountFor(o),
      accountName: o?.name ?? f.obligorId,
      valueDate: at,
      narration: `${f.product} drawdown — ${f.id}`,
      status: "Authorised",
      makerId: maker?.id ?? "USR-DOM",
      makerName: maker?.name ?? "Disbursement Maker",
      preparedAt: addDaysIso(at, -0.1),
      checkerId: checker?.id ?? "USR-DOC",
      checkerName: checker?.name ?? "Disbursement Checker",
      decidedAt: at,
      stepUpVerified: amount > getRule<number>("approvals.stepUpThresholdNgn"),
      cbaReference: `CBA/DSB/${String(hash(f.id + n) % 1_000_000).padStart(6, "0")}`,
    };
  };
  let n = 0;
  // Booked facilities: initial drawdown authorised.
  for (const f of facilities.filter((x) => x.applicationId && appById.get(x.applicationId)?.stage === "Booked")) {
    out.push(base(f, n++, f.approvedAmount, f.startDate));
  }
  // One pending facility already prepared by the Maker, awaiting the Checker.
  const pendingApps = apps.filter((a) => a.stage === "Disbursement").sort((a, b) => a.id.localeCompare(b.id));
  const prepared = pendingApps[0];
  const pf = prepared && facilities.find((f) => f.applicationId === prepared.id && f.status === "Pending disbursement");
  if (pf) {
    const d = base(pf, n++, pf.approvedAmount, addDaysIso(DEMO_NOW, -0.08));
    out.push({ ...d, status: "Awaiting authorisation", checkerId: undefined, checkerName: undefined, decidedAt: undefined, stepUpVerified: undefined, cbaReference: undefined, preparedAt: addDaysIso(DEMO_NOW, -0.08), valueDate: DEMO_NOW.toISOString() });
  }
  // Recent drawdowns on revolving lines (last 45 days).
  const revolving = facilities.filter((f) => !f.applicationId && f.status === "Active" && ["Overdraft", "Revolving credit", "Invoice discounting"].includes(f.product)).slice(0, 14);
  revolving.forEach((f, i) => {
    const at = addDaysIso(DEMO_NOW, -(1 + Math.floor(rand(f.id, "dsb") * 44)));
    const amount = Math.round((f.approvedAmount * (0.1 + rand(f.id, "amt") * 0.3)) / 1e5) * 1e5;
    const d = base(f, n++, amount, at);
    if (i === 3) out.push({ ...d, status: "Returned to maker", comment: "Beneficiary account name does not match the CBA mandate — please re-confirm.", cbaReference: undefined, stepUpVerified: undefined });
    else if (i === 8) out.push({ ...d, status: "Rejected", comment: "Drawdown exceeds available headroom after the latest CBA balance refresh.", cbaReference: undefined, stepUpVerified: undefined });
    else out.push(d);
  });
  return out;
}

type DisbursementStore = {
  requests: Record<string, Disbursement>;
  saveRequest: (d: Disbursement) => void;
  reset: () => void;
};

export const useDisbursementStore = create<DisbursementStore>()(
  persist(
    (set) => ({
      requests: {},
      saveRequest: (d) => set((s) => ({ requests: { ...s.requests, [d.id]: d } })),
      reset: () => set({ requests: {} }),
    }),
    { name: "credigit.ser.disbursement", version: 1, storage: createJSONStorage(() => localStorage), partialize: ({ requests }) => ({ requests }) },
  ),
);

export function useDisbursements(): Disbursement[] {
  const stored = useDisbursementStore((s) => s.requests);
  // Seeded history comes from the pristine seed so it doesn't shift when live facilities change status.
  const seed = useMemo(() => {
    const p = pristineSeed();
    return seedRequests(p.facilities, p.applications, p.obligors, p.users);
  }, []);
  return useMemo(() => {
    const ids = new Set(seed.map((s) => s.id));
    return [...Object.values(stored).filter((d) => !ids.has(d.id)), ...seed.map((s) => stored[s.id] ?? s)].sort((a, b) => b.preparedAt.localeCompare(a.preparedAt));
  }, [seed, stored]);
}

// ---------------- Segregation of duties (PRD §4.2) ----------------

export type SodCheck = { id: string; label: string; ok: boolean; detail: string };

/** People who initiated or recommended the facility — barred from being Maker or Checker. */
export function conflictedPeople(app: Application | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!app) return m;
  m.set(app.createdById, "initiated the credit application");
  for (const s of app.approvals) {
    if (s.assigneeId && (s.decision === "recommended" || s.tier === 1)) m.set(s.assigneeId, "recommended the facility");
  }
  return m;
}

export function makerChecks(userId: string, roleId: RoleId, app: Application | undefined): SodCheck[] {
  const conflicts = conflictedPeople(app);
  const isMaker = getRule<RoleId[]>("disbursement.makerRoles").includes(roleId);
  return [
    { id: "role", label: "Role is Disbursement Maker", ok: isMaker, detail: isMaker ? "Execution authority within the approved amount" : "Only a Disbursement Maker can prepare a disbursement" },
    {
      id: "initiator",
      label: "Not the initiator or recommender",
      ok: !conflicts.has(userId),
      detail: conflicts.has(userId) ? `You ${conflicts.get(userId)} — PRD §4.2 bars you from disbursing it` : "You did not initiate or recommend this facility",
    },
  ];
}

/** Roles on the Checker step of the Operations workflow (tenant-configurable). */
export function checkerRoles(): RoleId[] {
  return getDefinition("disbursement.authorise").steps.flatMap((s) => s.approverRoles);
}

export function checkerChecks(userId: string, roleId: RoleId, app: Application | undefined, request: Disbursement | undefined): SodCheck[] {
  const conflicts = conflictedPeople(app);
  const isChecker = checkerRoles().includes(roleId);
  return [
    { id: "role", label: "Role is Disbursement Checker", ok: isChecker, detail: isChecker ? "Authorisation authority (Operations workflow Checker step)" : "Only a Disbursement Checker can authorise" },
    {
      id: "maker",
      label: "Different person from the Maker",
      ok: !request || request.makerId !== userId,
      detail: request && request.makerId === userId ? "You prepared this disbursement — no self-approval" : request ? `Prepared by ${request.makerName}` : "No request prepared yet",
    },
    {
      id: "initiator",
      label: "Not the initiator or recommender",
      ok: !conflicts.has(userId),
      detail: conflicts.has(userId) ? `You ${conflicts.get(userId)}` : "You did not initiate or recommend this facility",
    },
  ];
}
