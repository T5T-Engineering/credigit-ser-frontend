"use client";

/**
 * Admin module state (PRD §4.0–4.2, §10.4).
 *
 * Every limit, threshold, catalogue entry and per-role session rule now lives in the business-rules registry
 * (`src/lib/platform/rules.ts`, registered in `./platform.ts` and core); changes route through the Operations
 * workflow. The only state kept here is the list of tenant-created (cloned) roles, which is dynamic data, not a
 * rule — persisted as `credigit.ser.admin` and changed only by the "role.custom-change" operation.
 *
 * The read hooks below are kept for other modules (`useAdminParams`, `useRoleLimit`, `useRoleSecurity`,
 * `usePendingChanges`) and are now backed by rules / Operations.
 *
 * BACKEND SEAM: custom roles come from the RBAC API; rules from the Rules & Parameters Engine.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { roleById, roles, type Role, type RoleId } from "@/lib/rbac/roles";
import { chartFlow } from "@/lib/workflow";
import { intensityThresholds, type IntensityThresholds } from "@/lib/rar";
import { roleLimit } from "@/lib/platform/core";
import { useOperationsStore, type OperationInstance } from "@/lib/platform/operations";
import { getRule, ruleDefinition, useRulesStore } from "@/lib/platform/rules";
import type { CollateralType, ProductType } from "@/lib/data/types";
import { allProducts, productSlug, roleName, roleSecurity, ruleKeys, type RoleSecurity } from "./rule-keys";

export type { RoleSecurity } from "./rule-keys";

// ---------------------------------------------------------------- custom (cloned) roles

/** Role created by cloning (PRD §4: "the Admin can create additional roles by cloning and adjusting"). */
export type CustomRole = {
  id: string;
  clonedFrom: RoleId;
  name: string;
  short: string;
  limitNgn: number | null;
  security: Omit<RoleSecurity, "ipAllowList" | "mfaRequired">;
  createdAt: string;
};

type AdminState = { customRoles: CustomRole[] };

export const useAdminStore = create<AdminState>()(
  persist((): AdminState => ({ customRoles: [] }), {
    name: "credigit.ser.admin",
    version: 2,
    storage: createJSONStorage(() => localStorage),
    // v1 held parameters (now business rules) — keep only cloned roles that have the v2 shape.
    migrate: (persisted) => {
      const list = ((persisted as { customRoles?: CustomRole[] } | null)?.customRoles ?? []).filter((c) => c && c.security);
      return { customRoles: list };
    },
  }),
);

/** Only the "role.custom-change" operation (on approval) calls these. */
export const addCustomRole = (role: CustomRole) => useAdminStore.setState((s) => ({ customRoles: [...s.customRoles.filter((c) => c.id !== role.id), role] }));
export const updateCustomRole = (role: CustomRole) => useAdminStore.setState((s) => ({ customRoles: s.customRoles.map((c) => (c.id === role.id ? role : c)) }));
export const removeCustomRole = (id: string) => useAdminStore.setState((s) => ({ customRoles: s.customRoles.filter((c) => c.id !== id) }));

// ---------------------------------------------------------------- configured roles (rules + custom)

/** A role as configured for this tenant (default role + rules, or a cloned role). */
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

/** Built at call time from business rules. */
export function configureRoles(customRoles: CustomRole[]): ConfiguredRole[] {
  const base: ConfiguredRole[] = roles.map((r) => {
    const name = roleName(r.id);
    const limitNgn = roleLimit(r.id);
    const security = roleSecurity(r.id);
    return {
      id: r.id,
      name,
      short: r.short,
      group: r.group,
      tier: flowTierOf(r.id),
      limitNgn,
      authority: r.authority,
      description: r.description,
      modules: r.modules,
      edited: name !== r.name || (limitNgn !== null && Number.isFinite(limitNgn) && limitNgn !== r.limitNgn),
      security,
    };
  });
  const custom: ConfiguredRole[] = customRoles.map((c) => {
    const src = roleById[c.clonedFrom];
    return {
      id: c.id,
      name: c.name,
      short: c.short,
      group: src.group,
      tier: flowTierOf(src.id),
      limitNgn: c.limitNgn,
      authority: `Cloned from ${roleName(src.id)}`,
      description: src.description,
      modules: src.modules,
      custom: c,
      edited: true,
      security: { ...c.security, ipAllowList: c.security.ipRanges.join(", "), mfaRequired: true },
    };
  });
  return [...base, ...custom];
}

/** Reactive configured roles (re-computed when rules or custom roles change). */
export function useConfiguredRoles(): ConfiguredRole[] {
  const values = useRulesStore((s) => s.values);
  const customRoles = useAdminStore((s) => s.customRoles);
  return useMemo(() => {
    void values;
    return configureRoles(customRoles);
  }, [values, customRoles]);
}

// ---------------------------------------------------------------- compatibility read hooks (rules-backed)

export type ProductConfig = { product: ProductType; enabled: boolean; maxTenorMonths: number; fastTrackEligible: boolean };

export type AdminParams = {
  /** Rule `approvals.stepUpThresholdNgn` (core). */
  stepUpThresholdNgn: number;
  /** Rules `rar.*` (core). */
  rar: IntensityThresholds;
  /** Rules `origination.products`, `origination.fastTrack.variants`, `admin.product.maxTenorMonths.*`. */
  products: ProductConfig[];
  /**
   * Collateral haircuts are owned by the collateral module's rules — no longer served here.
   * Callers fall back to their own source until they read the collateral rules.
   */
  haircuts?: Record<CollateralType, number>;
};

/** Product catalogue from rules (call time). */
export function productCatalogue(all: ProductType[]): ProductConfig[] {
  const has = (k: string) => Boolean(ruleDefinition(k));
  const offered = has(ruleKeys.productsOffered) ? getRule<string[]>(ruleKeys.productsOffered) : all;
  // Variants are "Label = Catalogue product".
  const fast = has(ruleKeys.fastTrackVariants) ? getRule<string[]>(ruleKeys.fastTrackVariants).map((v) => v.split("=").pop()!.trim()) : [];
  return all.map((product) => ({ product, enabled: offered.includes(product), fastTrackEligible: fast.includes(product), maxTenorMonths: getRule<number>(ruleKeys.maxTenor(productSlug(product))) }));
}

/**
 * @deprecated Read the individual rules with `useRule()` instead. Kept for existing call sites
 * (origination/use-params.ts, workspace) — values now come from business rules.
 */
export function useAdminParams(): AdminParams {
  const values = useRulesStore((s) => s.values);
  return useMemo(() => {
    void values;
    return { stepUpThresholdNgn: getRule<number>(ruleKeys.stepUp), rar: intensityThresholds(), products: productCatalogue(allProducts) };
  }, [values]);
}

/** Session rules for a role (used by Settings → Profile & security). */
export function useRoleSecurity(roleId: string | undefined): RoleSecurity {
  const values = useRulesStore((s) => s.values);
  const custom = useAdminStore((s) => s.customRoles.find((c) => c.id === roleId));
  return useMemo(() => {
    void values;
    if (custom) return { ...custom.security, ipAllowList: custom.security.ipRanges.join(", "), mfaRequired: true as const };
    return roleSecurity(roleId ?? "");
  }, [values, custom, roleId]);
}

/** Sign-on limit for a role from rule `rbac.limit.<role>` (null = none, Infinity = apex). */
export function useRoleLimit(roleId: RoleId | undefined): number | null {
  const values = useRulesStore((s) => s.values);
  return useMemo(() => {
    void values;
    return roleId ? roleLimit(roleId) : null;
  }, [values, roleId]);
}

const open = (i: OperationInstance) => i.status === "Pending" || i.status === "In progress";

/** Open rule-change operations (Operations workflow) — replaces the old ad-hoc "pending changes" list. */
export function usePendingChanges(): OperationInstance[] {
  const instances = useOperationsStore((s) => s.instances);
  return useMemo(() => instances.filter((i) => i.operationType === "rule.change" && open(i)), [instances]);
}

/** Open operations raised from the admin module (users, roles, rules, sector limits). */
export const adminOperationTypes = ["rule.change", "user.invite", "user.role-change", "user.deactivate", "user.reactivate", "user.mfa-reset", "role.custom-change", "role.permissions-change", "admin.sector-limits.change", "access.request"];
export function useOpenAdminOperations(): OperationInstance[] {
  const instances = useOperationsStore((s) => s.instances);
  return useMemo(() => instances.filter((i) => adminOperationTypes.includes(i.operationType) && open(i)), [instances]);
}
