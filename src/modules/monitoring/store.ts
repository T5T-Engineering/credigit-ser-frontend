"use client";

/**
 * Loan Review & Monitoring — persisted module state (exceptions, notes, assignments, covenant tests, APG/TOD actions).
 * BACKEND SEAM: replace these actions with API commands (CQRS write side); keep the shapes.
 * Persisted in this browser as `credigit.ser.monitoring`.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { subDays, subHours } from "date-fns";
import { createSeed, DEMO_NOW } from "@/lib/data/seed";
import type { Facility } from "@/lib/data/types";
// Rules must be registered before the seed reads them (the seed runs when the store is created).
import "./platform";
import { getRule } from "@/lib/platform/rules";
import { addBusinessDays, dpdThresholds, exposureOf, slaBusinessDays, type EscalationLevel, type ExceptionType } from "./logic";
import { buildCovenants, buildInflowProfiles, buildTods } from "./data";

export type ExceptionStatus = "Raised" | "Under review" | "Escalated" | "Resolved";

export type ExceptionEvent = { id: string; at: string; by: string; action: string; level?: EscalationLevel; status?: ExceptionStatus };
export type ExceptionComment = { id: string; at: string; authorName: string; authorRole?: string; body: string };

export type MonitoringException = {
  id: string;
  type: ExceptionType;
  title: string;
  detail: string;
  obligorId: string;
  facilityId?: string;
  collateralId?: string;
  amount?: number;
  source: "Rule" | "AI-flagged" | "Manual";
  raisedAt: string;
  level: EscalationLevel;
  status: ExceptionStatus;
  slaDueAt: string;
  assigneeId?: string;
  evidence?: { name: string; at: string; by: string; note?: string };
  history: ExceptionEvent[];
  comments: ExceptionComment[];
};

export type FacilityNote = { id: string; at: string; by: string; body: string };
export type CovenantTest = { status: "Compliant" | "Breached" | "Waived"; at: string; by: string; result: string; evidence?: string; nextTestAt?: string };

type State = {
  exceptions: MonitoringException[];
  notes: Record<string, FacilityNote[]>;
  assignments: Record<string, string>;
  covenantTests: Record<string, CovenantTest>;
  apgActions: Record<string, { status: string; at: string; by: string; note?: string }>;
  todActions: Record<string, { status: string; at: string; by: string; note?: string }>;
  aiSignoffs: Record<string, { by: string; at: string; decision: "accepted" | "dismissed" }>;
  raise: (e: Omit<MonitoringException, "id" | "history" | "comments" | "level" | "status" | "slaDueAt" | "raisedAt"> & { by: string }) => MonitoringException;
  patchException: (id: string, changes: Partial<MonitoringException>, event?: Omit<ExceptionEvent, "id" | "at">) => void;
  comment: (id: string, c: Omit<ExceptionComment, "id" | "at">) => void;
  addNote: (facilityId: string, note: Omit<FacilityNote, "id" | "at">) => void;
  assign: (facilityId: string, userId: string) => void;
  recordCovenantTest: (covenantId: string, t: CovenantTest) => void;
  setApg: (id: string, a: { status: string; by: string; note?: string }) => void;
  setTod: (id: string, a: { status: string; by: string; note?: string }) => void;
  signOffAi: (key: string, by: string, decision: "accepted" | "dismissed") => void;
  reset: () => void;
};

// TD-603: the seed below is mock data (demo shape constants).
let counter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36).toUpperCase()}${(counter++).toString(36).toUpperCase()}`;

/** Seed exception queue from the shared spine (deterministic). */
function seedExceptions(): MonitoringException[] {
  const spine = createSeed();
  const obligors = new Map(spine.obligors.map((o) => [o.id, o]));
  const lro = spine.users.find((u) => u.roleId === "loan-review-officer")!;
  const list: MonitoringException[] = [];
  const mk = (
    type: ExceptionType,
    f: Pick<Facility, "obligorId"> & { id?: string },
    title: string,
    detail: string,
    ageDays: number,
    level: EscalationLevel,
    status: ExceptionStatus,
    source: MonitoringException["source"] = "Rule",
    amount?: number,
    collateralId?: string,
  ) => {
    const raisedAt = subDays(DEMO_NOW, ageDays);
    const history: ExceptionEvent[] = [{ id: `EV-${list.length}-0`, at: raisedAt.toISOString(), by: source === "Manual" ? lro.name : "Rules engine", action: "Exception raised — Level 1 notified (dashboard + email)", level: 1, status: "Raised" }];
    let at = raisedAt;
    for (let l = 2 as EscalationLevel; l <= level; l = (l + 1) as EscalationLevel) {
      at = addBusinessDays(at, slaBusinessDays((l - 1) as EscalationLevel));
      history.push({ id: `EV-${list.length}-${l}`, at: at.toISOString(), by: "Escalation protocol", action: `Level ${l - 1} SLA lapsed uncured — escalated to Level ${l}`, level: l, status: "Escalated" });
    }
    if (status === "Under review") history.push({ id: `EV-${list.length}-r`, at: subHours(DEMO_NOW, 20 + ageDays).toISOString(), by: lro.name, action: "Picked up for review", status: "Under review" });
    if (status === "Resolved")
      history.push({ id: `EV-${list.length}-z`, at: subDays(DEMO_NOW, 1).toISOString(), by: lro.name, action: "Cured — evidence attached and time-stamped", status: "Resolved" });
    list.push({
      id: `EXC-${String(6101 + list.length)}`,
      type,
      title,
      detail,
      obligorId: f.obligorId,
      facilityId: f.id,
      collateralId,
      amount,
      source,
      raisedAt: raisedAt.toISOString(),
      level,
      status,
      // A few seeded exceptions have lapsed SLAs (to demo the sweep); the rest are inside their cure window.
      slaDueAt: (list.length % 4 === 1 || status === "Resolved" ? addBusinessDays(at, slaBusinessDays(level)) : addBusinessDays(DEMO_NOW, 1 + (list.length % 4))).toISOString(),
      assigneeId: lro.id,
      evidence: status === "Resolved" ? { name: "Repayment confirmation — CBA credit ref.pdf", at: subDays(DEMO_NOW, 1).toISOString(), by: lro.name } : undefined,
      history,
      comments:
        level >= 2
          ? [{ id: `CMT-${list.length}`, at: subDays(DEMO_NOW, 2).toISOString(), authorName: lro.name, authorRole: "Loan Review Officer", body: "Customer contacted; repayment plan requested from the Account Officer. Awaiting evidence." }]
          : [],
    });
  };

  const t = dpdThresholds();
  const pastDue = spine.facilities.filter((f) => f.dpd >= t.watchlist).sort((a, b) => b.dpd - a.dpd);
  pastDue.slice(0, 7).forEach((f, i) => {
    const o = obligors.get(f.obligorId)!;
    const level = (f.dpd >= t.doubtful ? 4 : f.dpd >= t.substandard ? 3 : f.dpd >= (t.watchlist + t.substandard) / 2 ? 2 : 1) as EscalationLevel;
    mk(
      "Past-due obligation",
      f,
      `${f.dpd} days past due — ${f.product}`,
      `${o.name}: ${f.product} ${f.id} is ${f.dpd} days past due (CBN class ${f.cbnClass}, IFRS 9 Stage ${f.stage}).`,
      Math.min(f.dpd, 4 + level * 7),
      level,
      i === 2 ? "Under review" : level >= 2 ? "Escalated" : "Raised",
      "Rule",
      exposureOf(f),
    );
  });

  const covs = buildCovenants(spine.facilities, obligors).filter((c) => c.status === "Breached").slice(0, 4);
  covs.forEach((c, i) => {
    const o = obligors.get(c.obligorId)!;
    mk("Covenant breach", { obligorId: c.obligorId, id: c.facilityId }, `Covenant breach — ${c.kind.toLowerCase()}`, `${o.name}: "${c.text}" — ${c.lastResult}.`, 3 + i * 4, (i === 0 ? 2 : 1) as EscalationLevel, i === 3 ? "Under review" : i === 0 ? "Escalated" : "Raised");
  });

  const flagged = buildInflowProfiles(spine.obligors).filter((p) => p.aiFlag);
  flagged.slice(0, 1).forEach((p) => {
    const o = obligors.get(p.obligorId)!;
    const f = spine.facilities.find((x) => x.obligorId === o.id);
    mk("Inflow-envelope deviation", { obligorId: o.id, id: f?.id }, "Inflow below AI envelope", `${o.name}: net verified inflow over the last 3 months is ${Math.round(p.ratio3m * 100)}% of the expected ${p.nature.toLowerCase()} pattern.`, 1, 1, "Raised", "AI-flagged");
  });

  const tods = buildTods(spine.facilities, spine.obligors).filter((t) => t.status === "Classified non-performing");
  tods.slice(0, 1).forEach((t) => {
    const o = obligors.get(t.obligorId)!;
    mk("Temporary overdraft not regularised", { obligorId: o.id, id: t.facilityId }, `${t.type} not regularised`, `${o.name}: ${t.id} granted ${Math.round((DEMO_NOW.getTime() - new Date(t.grantedAt).getTime()) / 864e5)} days ago — classified and provisioned as non-performing per CBN 12.10 (${getRule<number>("monitoring.tod.nonPerformingDays")}-day rule).`, 6, 2, "Escalated", "Rule", t.amount);
  });

  const insExpired = spine.collateral.filter((c) => c.insuranceExpiry && new Date(c.insuranceExpiry) < DEMO_NOW).slice(0, 2);
  insExpired.forEach((c, i) => {
    const o = obligors.get(c.obligorId)!;
    mk("Collateral perfection / insurance", { obligorId: o.id, id: c.facilityIds[0] }, "Insurance cover lapsed", `${o.name}: insurance on ${c.type.toLowerCase()} ${c.id} expired — cover not current.`, 2 + i, 1, i ? "Under review" : "Raised", "Rule", c.marketValue, c.id);
  });

  const someone = spine.obligors[11]!;
  mk("Unreconciled inter-branch / suspense item", { obligorId: someone.id }, "Suspense entry ageing past clearance window", `${someone.name}: suspense-account credit of ₦18.4m unreconciled for 97 days (CBN: clear within 3 months).`, 9, 2, "Escalated", "AI-flagged");
  const resolved = spine.facilities.filter((f) => f.dpd > 0 && f.dpd < t.watchlist).slice(0, 2);
  resolved.forEach((f) => {
    const o = obligors.get(f.obligorId)!;
    mk("Past-due obligation", f, `${f.dpd} days past due — ${f.product}`, `${o.name}: instalment arrears cleared after follow-up.`, 12, 1, "Resolved", "Rule", exposureOf(f));
  });
  return list;
}

const initial = () => ({
  exceptions: seedExceptions(),
  notes: {} as Record<string, FacilityNote[]>,
  assignments: {} as Record<string, string>,
  covenantTests: {} as Record<string, CovenantTest>,
  apgActions: {} as State["apgActions"],
  todActions: {} as State["todActions"],
  aiSignoffs: {} as State["aiSignoffs"],
});

export const useMonitoring = create<State>()(
  persist(
    (set) => ({
      ...initial(),
      raise: (e) => {
        const now = new Date();
        const { by, ...rest } = e;
        const ex: MonitoringException = {
          ...rest,
          id: uid("EXC"),
          raisedAt: now.toISOString(),
          level: 1,
          status: "Raised",
          slaDueAt: addBusinessDays(now, slaBusinessDays(1)).toISOString(),
          history: [{ id: uid("EV"), at: now.toISOString(), by, action: "Exception raised — Level 1 notified (dashboard + email)", level: 1, status: "Raised" }],
          comments: [],
        };
        set((s) => ({ exceptions: [ex, ...s.exceptions] }));
        return ex;
      },
      patchException: (id, changes, event) =>
        set((s) => ({
          exceptions: s.exceptions.map((x) =>
            x.id === id ? { ...x, ...changes, history: event ? [...x.history, { ...event, id: uid("EV"), at: new Date().toISOString() }] : x.history } : x,
          ),
        })),
      comment: (id, c) =>
        set((s) => ({ exceptions: s.exceptions.map((x) => (x.id === id ? { ...x, comments: [...x.comments, { ...c, id: uid("CMT"), at: new Date().toISOString() }] } : x)) })),
      addNote: (facilityId, note) =>
        set((s) => ({ notes: { ...s.notes, [facilityId]: [{ ...note, id: uid("NOTE"), at: new Date().toISOString() }, ...(s.notes[facilityId] ?? [])] } })),
      assign: (facilityId, userId) => set((s) => ({ assignments: { ...s.assignments, [facilityId]: userId } })),
      recordCovenantTest: (covenantId, t) => set((s) => ({ covenantTests: { ...s.covenantTests, [covenantId]: t } })),
      setApg: (id, a) => set((s) => ({ apgActions: { ...s.apgActions, [id]: { ...a, at: new Date().toISOString() } } })),
      setTod: (id, a) => set((s) => ({ todActions: { ...s.todActions, [id]: { ...a, at: new Date().toISOString() } } })),
      signOffAi: (key, by, decision) => set((s) => ({ aiSignoffs: { ...s.aiSignoffs, [key]: { by, at: new Date().toISOString(), decision } } })),
      reset: () => set(initial()),
    }),
    {
      name: "credigit.ser.monitoring",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ exceptions, notes, assignments, covenantTests, apgActions, todActions, aiSignoffs }) => ({ exceptions, notes, assignments, covenantTests, apgActions, todActions, aiSignoffs }),
    },
  ),
);

/** Open (not resolved) exceptions for an entity — used by other pages to show "exception raised" state. */
export function openExceptionFor(list: MonitoringException[], key: { facilityId?: string; collateralId?: string; type?: ExceptionType }) {
  return list.find(
    (x) => x.status !== "Resolved" && (!key.type || x.type === key.type) && (key.facilityId ? x.facilityId === key.facilityId : true) && (key.collateralId ? x.collateralId === key.collateralId : true),
  );
}
