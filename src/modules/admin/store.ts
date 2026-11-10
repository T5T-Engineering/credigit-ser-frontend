"use client";

/**
 * Tenant configuration for the prototype — Admin → Roles & limits and Rules & parameters (PRD §4.0–4.2, §10.4).
 *
 * Persisted in this browser as `credigit.ser.admin`. Values are DEMO DEFAULTS, not product rules: where the PRD
 * names a parameter without a value, the default is marked "Parameter — set by tenant".
 *
 * BACKEND SEAM: replace the actions with calls to the Rules & Parameters Engine API (versioned, audited). Pages read
 * through the hooks at the bottom of this file and never touch the store internals.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { roleById, roles, type Role, type RoleId } from "@/lib/rbac/roles";
import { chartFlow } from "@/lib/workflow";
import { defaultIntensityThresholds, type IntensityThresholds } from "@/lib/rar";
import type { CollateralType, ProductType } from "@/lib/data/types";

// ---------------------------------------------------------------- types

/** Per-role session rules (PRD §4.2: session timeout, device binding and IP allow-listing configurable per role). */
export type RoleSecurity = {
  sessionTimeoutMin: number;
  deviceBinding: boolean;
  /** Comma-separated CIDR ranges; empty = any network. */
  ipAllowList: string;
  mfaRequired: true;
};

/** Editable overlay over a default role (PRD §4.0: rename, re-limit). */
export type RoleOverride = { name?: string; limitNgn?: number | null };

/** Role created by cloning (PRD §4: "the Admin can create additional roles by cloning and adjusting"). */
export type CustomRole = {
  id: string;
  clonedFrom: RoleId;
  name: string;
  short: string;
  limitNgn: number | null;
  createdAt: string;
};

export type ChartFlowTierConfig = { pair: string; adjudicator: RoleId | "" };

export type Ifrs9Params = {
  /** Stage 2 (SICR) backstop, days past due. PRD §6.7.1: "typically 30–89 days". */
  stage2Dpd: number;
  /** Stage 3 (credit-impaired), days past due. PRD §6.7.1: Sub-Standard from 90 days. */
  stage3Dpd: number;
  /** CBN specific provision rates (PRD §6.7.1, CBN 12.2(a)(2)). */
  provisionSubstandardPct: number;
  provisionDoubtfulPct: number;
  provisionLostPct: number;
  /** General provision cap as % of RWA (PRD §6.7.1, CBN 3.16(d)). */
  generalProvisionCapPct: number;
  /** PD / LGD model parameters — placeholders until the model owner calibrates them. */
  lgdFloorPct: number | null;
  forwardLookingScenarios: string;
};

export type ProductConfig = {
  product: ProductType;
  enabled: boolean;
  maxTenorMonths: number;
  fastTrackEligible: boolean;
};

export type AdminParams = {
  /** Step-up authentication threshold (PRD §4.2) — tenant-configurable, NGN. */
  stepUpThresholdNgn: number;
  /** Fast-Track chart-flow ceiling (PRD §6.1.3) — demo default. */
  fastTrackCeilingNgn: number;
  rar: IntensityThresholds;
  chartFlow: ChartFlowTierConfig[];
  ifrs9: Ifrs9Params;
  haircuts: Record<CollateralType, number>;
  products: ProductConfig[];
};

/** A regulatory-parameter change waiting for a second person (PRD §10.4). */
export type PendingChange = {
  id: string;
  section: "ifrs9";
  field: keyof Ifrs9Params;
  label: string;
  before: string;
  after: string;
  value: number | string | null;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
};

// ---------------------------------------------------------------- defaults

const tighter: RoleId[] = ["disbursement-maker", "disbursement-checker", "legal-officer"];

export function defaultRoleSecurity(roleId: RoleId | string): RoleSecurity {
  const tight = tighter.includes(roleId as RoleId);
  return {
    sessionTimeoutMin: tight ? 10 : 15,
    deviceBinding: tight,
    ipAllowList: tight ? "10.20.0.0/16" : "",
    mfaRequired: true,
  };
}

const allProducts: ProductType[] = [
  "Term loan",
  "Overdraft",
  "Revolving credit",
  "Lease finance",
  "Trade finance (LC)",
  "Bank guarantee",
  "Advance payment guarantee",
  "Invoice discounting",
  "Mortgage",
  "Asset finance",
];

export const defaultParams: AdminParams = {
  stepUpThresholdNgn: 100_000_000,
  fastTrackCeilingNgn: 50_000_000,
  rar: defaultIntensityThresholds,
  chartFlow: chartFlow.map((t) => ({ pair: t.pair, adjudicator: t.adjudicator ?? "" })),
  ifrs9: {
    stage2Dpd: 30,
    stage3Dpd: 90,
    provisionSubstandardPct: 10,
    provisionDoubtfulPct: 50,
    provisionLostPct: 100,
    generalProvisionCapPct: 1.25,
    lgdFloorPct: null,
    forwardLookingScenarios: "Base 60% · Upside 15% · Downside 25%",
  },
  // Same values the demo collateral register uses (src/lib/data/seed.ts).
  haircuts: {
    "Legal mortgage": 30,
    "Equitable mortgage": 40,
    Debenture: 50,
    "Quoted shares": 40,
    "Cash / lien on deposit": 0,
    Vehicle: 40,
    Equipment: 45,
    "Domiciliation of proceeds": 60,
    "Personal guarantee": 100,
    "Corporate guarantee": 70,
    "Insurance policy": 50,
  },
  products: allProducts.map((product) => ({
    product,
    enabled: product !== "Mortgage",
    maxTenorMonths: product === "Overdraft" || product === "Revolving credit" ? 12 : product === "Mortgage" ? 240 : product.includes("guarantee") ? 24 : 60,
    fastTrackEligible: ["Term loan", "Overdraft", "Asset finance", "Invoice discounting"].includes(product),
  })),
};

// ---------------------------------------------------------------- store

type AdminState = {
  roleOverrides: Partial<Record<string, RoleOverride>>;
  roleSecurity: Partial<Record<string, RoleSecurity>>;
  customRoles: CustomRole[];
  params: AdminParams;
  pending: PendingChange[];
  setRoleOverride: (roleId: string, change: RoleOverride) => void;
  setRoleSecurity: (roleId: string, change: Partial<RoleSecurity>) => void;
  addCustomRole: (role: CustomRole) => void;
  removeCustomRole: (id: string) => void;
  setParams: (change: Partial<AdminParams>) => void;
  requestChange: (change: PendingChange) => void;
  resolveChange: (id: string, apply: boolean) => PendingChange | undefined;
  resetAdmin: () => void;
};

const initial = () => ({ roleOverrides: {}, roleSecurity: {}, customRoles: [], params: defaultParams, pending: [] as PendingChange[] });

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      ...initial(),
      setRoleOverride: (roleId, change) => set((s) => ({ roleOverrides: { ...s.roleOverrides, [roleId]: { ...s.roleOverrides[roleId], ...change } } })),
      setRoleSecurity: (roleId, change) =>
        set((s) => ({ roleSecurity: { ...s.roleSecurity, [roleId]: { ...(s.roleSecurity[roleId] ?? defaultRoleSecurity(roleId)), ...change } } })),
      addCustomRole: (role) => set((s) => ({ customRoles: [...s.customRoles, role] })),
      removeCustomRole: (id) => set((s) => ({ customRoles: s.customRoles.filter((r) => r.id !== id) })),
      setParams: (change) => set((s) => ({ params: { ...s.params, ...change } })),
      requestChange: (change) => set((s) => ({ pending: [...s.pending.filter((p) => p.field !== change.field), change] })),
      resolveChange: (id, apply) => {
        const change = get().pending.find((p) => p.id === id);
        if (!change) return undefined;
        set((s) => ({
          pending: s.pending.filter((p) => p.id !== id),
          params: apply ? { ...s.params, ifrs9: { ...s.params.ifrs9, [change.field]: change.value } } : s.params,
        }));
        return change;
      },
      resetAdmin: () => set(initial()),
    }),
    {
      name: "credigit.ser.admin",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ roleOverrides, roleSecurity, customRoles, params, pending }) => ({ roleOverrides, roleSecurity, customRoles, params, pending }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AdminState>;
        return { ...current, ...p, params: { ...defaultParams, ...(p.params ?? {}), ifrs9: { ...defaultParams.ifrs9, ...(p.params?.ifrs9 ?? {}) } } };
      },
    },
  ),
);

// ---------------------------------------------------------------- read hooks / selectors

/** A role as configured for this tenant (default role + overrides, or a cloned role). */
export type ConfiguredRole = {
  id: string;
  name: string;
  short: string;
  group: Role["group"];
  tier: number | null;
  limitNgn: number | null;
  authority: string;
  description: string;
  modules: Role["modules"];
  custom?: CustomRole;
  edited: boolean;
  security: RoleSecurity;
};

/** Position of a role in the approval chart-flow (1-based tier; null = no approval authority). */
export function flowTierOf(roleId: string): number | null {
  const i = chartFlow.findIndex((t) => t.roles.includes(roleId as RoleId));
  return i >= 0 ? i + 1 : null;
}

export function configureRoles(state: Pick<AdminState, "roleOverrides" | "roleSecurity" | "customRoles">): ConfiguredRole[] {
  const base: ConfiguredRole[] = roles.map((r) => {
    const o = state.roleOverrides[r.id];
    return {
      id: r.id,
      name: o?.name ?? r.name,
      short: r.short,
      group: r.group,
      tier: flowTierOf(r.id),
      limitNgn: o?.limitNgn !== undefined ? o.limitNgn : r.limitNgn,
      authority: r.authority,
      description: r.description,
      modules: r.modules,
      edited: Boolean(o && (o.name !== undefined || o.limitNgn !== undefined)),
      security: state.roleSecurity[r.id] ?? defaultRoleSecurity(r.id),
    };
  });
  const custom: ConfiguredRole[] = state.customRoles.map((c) => {
    const src = roleById[c.clonedFrom];
    return {
      id: c.id,
      name: c.name,
      short: c.short,
      group: src.group,
      tier: flowTierOf(src.id),
      limitNgn: c.limitNgn,
      authority: `Cloned from ${src.name}`,
      description: src.description,
      modules: src.modules,
      custom: c,
      edited: true,
      security: state.roleSecurity[c.id] ?? defaultRoleSecurity(c.clonedFrom),
    };
  });
  return [...base, ...custom];
}

export const useAdminParams = () => useAdminStore((s) => s.params);
export const usePendingChanges = () => useAdminStore((s) => s.pending);

/** Session rules for a role (used by Settings → Profile & security). */
export function useRoleSecurity(roleId: string | undefined): RoleSecurity {
  const sec = useAdminStore((s) => (roleId ? s.roleSecurity[roleId] : undefined));
  return sec ?? defaultRoleSecurity(roleId ?? "");
}

/** Sign-on limit for a role after tenant overrides. */
export function useRoleLimit(roleId: RoleId | undefined): number | null {
  const o = useAdminStore((s) => (roleId ? s.roleOverrides[roleId] : undefined));
  if (!roleId) return null;
  return o && "limitNgn" in o && o.limitNgn !== undefined ? o.limitNgn : roleById[roleId].limitNgn;
}

/** Roles allowed to give the second-person confirmation for regulatory parameters (assumption, see OPEN-QUESTIONS). */
export const confirmerRoles: RoleId[] = ["system-admin", "cro", "head-of-risk"];
