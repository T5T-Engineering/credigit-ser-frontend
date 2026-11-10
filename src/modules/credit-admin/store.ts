"use client";

/**
 * Credit Administration data (PRD §6.3). Persisted in this browser as `credigit.ser.credit-admin`.
 * Only user changes are stored; seeded state is derived deterministically from the shared data spine.
 * BACKEND SEAM: replace the setters with API mutations.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ChecklistStatus } from "@credigit/web-ui";
import type { RoleId } from "@/lib/rbac/roles";

export type CpState = { status: ChecklistStatus; byName: string; at: string; note?: string; evidence?: string };

export type WaiverKind = "Waiver" | "Deferral" | "Sanction for breach";
export type WaiverStatus = "Pending approval" | "Approved" | "Declined" | "Lapsed" | "Routed to Operational Risk" | "Closed";

export type WaiverRequest = {
  id: string;
  kind: WaiverKind;
  facilityId: string;
  /** Checklist key (application id when the facility came from origination, else facility id). */
  cpKey: string;
  conditionId: string;
  conditionTitle: string;
  conditionCategory: string;
  reason: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  /** Waiver expiry / deferred-to date. */
  expiryDate?: string;
  status: WaiverStatus;
  /** Tier that approved the original facility (PRD §6.3.2). */
  approverRoleIds: RoleId[];
  /** Within the tenant's Credit Administration delegated tolerance. */
  withinTolerance: boolean;
  decidedByName?: string;
  decidedAt?: string;
  decisionComment?: string;
  /** Sanction for breach: staff / unit and loss-event reference. */
  breachDetail?: string;
  lossEventRef?: string;
};

export type CrmsSearch = {
  id: string;
  obligorId: string;
  purpose: "New application" | "Renewal" | "Periodic review" | "Enhancement" | "Restructure";
  requestedByName: string;
  requestedAt: string;
  respondedAt?: string;
  result: "No adverse record" | "Adverse — delinquent credit elsewhere" | "No record found" | "Awaiting response";
  facilitiesElsewhere: number;
  outstandingElsewhere: number;
  reference: string;
};

export type CrmsBatch = { id: string; label: string; submittedAt: string; submittedByName: string; facilityIds: string[]; status: "Accepted by CBN" | "Submitted" | "Partially rejected"; rejected: number };

export type FileItemState = { status: ChecklistStatus; byName: string; at: string };

type CreditAdminStore = {
  cp: Record<string, Record<string, CpState>>;
  released: Record<string, { byName: string; at: string }>;
  waivers: Record<string, WaiverRequest>;
  crmsSearches: Record<string, CrmsSearch>;
  crmsBatches: Record<string, CrmsBatch>;
  crmsResolved: Record<string, { byName: string; at: string }>;
  files: Record<string, Record<string, FileItemState>>;
  setCp: (key: string, conditionId: string, state: CpState) => void;
  release: (facilityId: string, byName: string, at: string) => void;
  saveWaiver: (w: WaiverRequest) => void;
  saveSearch: (s: CrmsSearch) => void;
  saveBatch: (b: CrmsBatch) => void;
  resolveCrms: (facilityId: string, byName: string, at: string) => void;
  setFileItem: (obligorId: string, itemId: string, state: FileItemState) => void;
  reset: () => void;
};

const empty = { cp: {}, released: {}, waivers: {}, crmsSearches: {}, crmsBatches: {}, crmsResolved: {}, files: {} };

export const useCreditAdminStore = create<CreditAdminStore>()(
  persist(
    (set) => ({
      ...empty,
      setCp: (key, conditionId, state) => set((s) => ({ cp: { ...s.cp, [key]: { ...s.cp[key], [conditionId]: state } } })),
      release: (facilityId, byName, at) => set((s) => ({ released: { ...s.released, [facilityId]: { byName, at } } })),
      saveWaiver: (w) => set((s) => ({ waivers: { ...s.waivers, [w.id]: w } })),
      saveSearch: (x) => set((s) => ({ crmsSearches: { ...s.crmsSearches, [x.id]: x } })),
      saveBatch: (b) => set((s) => ({ crmsBatches: { ...s.crmsBatches, [b.id]: b } })),
      resolveCrms: (facilityId, byName, at) => set((s) => ({ crmsResolved: { ...s.crmsResolved, [facilityId]: { byName, at } } })),
      setFileItem: (obligorId, itemId, state) => set((s) => ({ files: { ...s.files, [obligorId]: { ...s.files[obligorId], [itemId]: state } } })),
      reset: () => set(empty),
    }),
    {
      name: "credigit.ser.credit-admin",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ cp, released, waivers, crmsSearches, crmsBatches, crmsResolved, files }) => ({ cp, released, waivers, crmsSearches, crmsBatches, crmsResolved, files }),
    },
  ),
);
