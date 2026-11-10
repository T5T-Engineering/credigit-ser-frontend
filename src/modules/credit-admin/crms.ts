"use client";

/**
 * CRMS desk (PRD §6.3.3): CBN Credit Risk Management System search log per obligor (CBN 3.7(d)) and
 * facility reporting to CRMS. The CRMS connector is simulated; seeded data derives from the pristine seed.
 */
import { useMemo } from "react";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Application, Obligor } from "@/lib/data/types";
import { addDaysIso, hash, pristineSeed, rand } from "./common";
import type { FacilityRow } from "./logic";
import { useCreditAdminStore, type CrmsBatch, type CrmsSearch } from "./store";

export const crmsResultTones = {
  "No adverse record": "success",
  "No record found": "neutral",
  "Adverse — delinquent credit elsewhere": "danger",
  "Awaiting response": "info",
} as const;

export type CrmsReportStatus = "Reported" | "Pending submission" | "Exception" | "Not reportable until disbursed";
export const crmsReportTones = { Reported: "success", "Pending submission": "info", Exception: "danger", "Not reportable until disbursed": "neutral" } as const;

const exceptionReasons = [
  "BVN of principal director missing",
  "Sector code not mapped to CBN classification",
  "RC number failed CAC validation",
  "Collateral value not captured",
  "Account number not matched to CBA extract",
];

/** Simulated CRMS response for an obligor (deterministic per obligor + request). */
export function simulateCrms(obligor: Obligor, salt: string): Pick<CrmsSearch, "result" | "facilitiesElsewhere" | "outstandingElsewhere"> {
  const r = rand(obligor.id, salt);
  if (obligor.watchlist || r < 0.12) {
    const n = 1 + (hash(obligor.id + salt) % 3);
    return { result: "Adverse — delinquent credit elsewhere", facilitiesElsewhere: n + 1, outstandingElsewhere: Math.round((obligor.declaredTurnover * (0.05 + rand(obligor.id, `${salt}o`) * 0.2)) / 1e6) * 1e6 };
  }
  if (r < 0.2) return { result: "No record found", facilitiesElsewhere: 0, outstandingElsewhere: 0 };
  const n = hash(obligor.id + salt) % 4;
  return { result: "No adverse record", facilitiesElsewhere: n, outstandingElsewhere: n ? Math.round((obligor.declaredTurnover * (0.03 + rand(obligor.id, `${salt}o`) * 0.15)) / 1e6) * 1e6 : 0 };
}

const purposeOf = (a: Application): CrmsSearch["purpose"] => (a.requestType === "New" ? "New application" : a.requestType === "Waiver" ? "Periodic review" : a.requestType);

function seedSearches(): CrmsSearch[] {
  const p = pristineSeed();
  const cad = p.users.find((u) => u.roleId === "credit-admin-officer")?.name ?? "Credit Administration";
  const ob = new Map(p.obligors.map((o) => [o.id, o]));
  const out: CrmsSearch[] = [];
  let n = 0;
  for (const a of p.applications.filter((x) => x.crmsChecked)) {
    const o = ob.get(a.obligorId);
    if (!o) continue;
    const at = addDaysIso(a.createdAt, 1);
    out.push({ id: `CRS-${String(41001 + n++)}`, obligorId: o.id, purpose: purposeOf(a), requestedByName: cad, requestedAt: at, respondedAt: addDaysIso(at, 0.02 + rand(a.id, "rt") * 0.1), reference: `CRMS/${String(hash(a.id) % 10_000_000).padStart(7, "0")}`, ...simulateCrms(o, a.id) });
  }
  // Periodic-review searches on the existing book.
  p.obligors
    .filter((o) => rand(o.id, "review") < 0.18)
    .slice(0, 14)
    .forEach((o) => {
      const at = addDaysIso(DEMO_NOW, -(2 + Math.floor(rand(o.id, "rd") * 55)));
      out.push({ id: `CRS-${String(41001 + n++)}`, obligorId: o.id, purpose: "Periodic review", requestedByName: cad, requestedAt: at, respondedAt: addDaysIso(at, 0.05), reference: `CRMS/${String(hash(o.id + "pr") % 10_000_000).padStart(7, "0")}`, ...simulateCrms(o, "pr") });
    });
  return out;
}

const OCT_CUTOFF = "2026-10-31T23:59:59.000Z";

function seedBatches(rows: FacilityRow[]): CrmsBatch[] {
  const live = rows.filter((r) => r.facility.status !== "Pending disbursement" && !isSeedException(r));
  const before = (iso: string) => live.filter((r) => r.facility.startDate <= iso).map((r) => r.facility.id);
  return [
    { id: "CRMS-B-2026-09", label: "September 2026 month-end", submittedAt: "2026-10-06T10:20:00.000Z", submittedByName: "Credit Administration", facilityIds: before("2026-09-30T23:59:59.000Z"), status: "Accepted by CBN", rejected: 0 },
    { id: "CRMS-B-2026-10", label: "October 2026 month-end", submittedAt: "2026-11-05T11:05:00.000Z", submittedByName: "Credit Administration", facilityIds: before(OCT_CUTOFF), status: "Partially rejected", rejected: rows.filter(isSeedException).length },
  ];
}

function isSeedException(r: FacilityRow) {
  return r.facility.status !== "Pending disbursement" && rand(r.facility.id, "crms") < 0.06;
}

export type CrmsReportRow = { row: FacilityRow; status: CrmsReportStatus; reason?: string; note?: string; batchId?: string };

export function useCrms(rows: FacilityRow[]) {
  const storedSearches = useCreditAdminStore((s) => s.crmsSearches);
  const storedBatches = useCreditAdminStore((s) => s.crmsBatches);
  const resolved = useCreditAdminStore((s) => s.crmsResolved);
  const seeded = useMemo(() => seedSearches(), []);
  const searches = useMemo(() => [...Object.values(storedSearches), ...seeded.filter((s) => !storedSearches[s.id])].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)), [seeded, storedSearches]);
  const seedB = useMemo(() => seedBatches(rows), [rows]);
  const batches = useMemo(() => [...Object.values(storedBatches), ...seedB].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [seedB, storedBatches]);
  const reports: CrmsReportRow[] = useMemo(() => {
    const inBatch = new Map<string, string>();
    for (const b of [...batches].reverse()) for (const id of b.facilityIds) inBatch.set(id, b.id);
    return rows
      .filter((r) => r.facility.status !== "Closed")
      .map((r) => {
        if (r.facility.status === "Pending disbursement") return { row: r, status: "Not reportable until disbursed" as const };
        const batchId = inBatch.get(r.facility.id);
        const latest = batches.find((b) => b.facilityIds.includes(r.facility.id));
        // Seeded book: some facilities changed balance / classification since the last month-end batch.
        if (batchId && latest && !storedBatches[latest.id] && rand(r.facility.id, "upd") < 0.12)
          return { row: r, status: "Pending submission" as const, note: r.facility.dpd > 0 ? "Classification / DPD update since last batch" : "Balance update since last batch" };
        if (batchId) return { row: r, status: "Reported" as const, batchId };
        if (isSeedException(r) && !resolved[r.facility.id]) return { row: r, status: "Exception" as const, reason: exceptionReasons[hash(r.facility.id) % exceptionReasons.length] };
        return { row: r, status: "Pending submission" as const, note: "New facility since last batch" };
      });
  }, [rows, batches, resolved, storedBatches]);
  return { searches, batches, reports };
}
