"use client";

/** Rule keys + call-time getters for admin-owned and core rules used by the admin module. */
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { getRule, ruleDefinition } from "@/lib/platform/rules";
import type { ProductType } from "@/lib/data/types";

/** The credit product types the catalogue can offer (data type enumeration, not a business value). */
export const allProducts: ProductType[] = [
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

export const productSlug = (p: string) => p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const ruleKeys = {
  roleName: (roleId: string) => `admin.roleName.${roleId}`,
  limit: (roleId: string) => `rbac.limit.${roleId}`,
  idleTimeout: (roleId: string) => `session.idleTimeoutMinutes.${roleId}`,
  deviceBinding: (roleId: string) => `session.deviceBinding.${roleId}`,
  ipAllowList: (roleId: string) => `session.ipAllowList.${roleId}`,
  stepUp: "approvals.stepUpThresholdNgn",
  productsOffered: "origination.products",
  fastTrackVariants: "origination.fastTrack.variants",
  maxTenor: (slug: string) => `admin.product.maxTenorMonths.${slug}`,
};

/** Configured display name of a role (rule `admin.roleName.<role>`), falling back to the static role name. */
export function roleName(roleId: RoleId | string): string {
  const key = ruleKeys.roleName(roleId);
  return ruleDefinition(key) ? getRule<string>(key) : (roleById[roleId as RoleId]?.name ?? roleId);
}

export type RoleSecurity = {
  sessionTimeoutMin: number;
  deviceBinding: boolean;
  /** Comma-separated for display; the rule holds a list. */
  ipAllowList: string;
  ipRanges: string[];
  mfaRequired: true;
};

/** Per-role session rules (PRD §4.2) from business rules, read at call time. */
export function roleSecurity(roleId: string): RoleSecurity {
  const has = ruleDefinition(ruleKeys.idleTimeout(roleId));
  const timeout = has ? getRule<number>(ruleKeys.idleTimeout(roleId)) : getRule<number>("session.idleTimeoutMinutes");
  const device = has ? getRule<boolean>(ruleKeys.deviceBinding(roleId)) : false;
  const ips = has ? getRule<string[]>(ruleKeys.ipAllowList(roleId)) : [];
  return { sessionTimeoutMin: timeout, deviceBinding: device, ipAllowList: ips.join(", "), ipRanges: ips, mfaRequired: true };
}

/** Idle timeout for a role in minutes (for the app shell's idle sign-out). */
export const roleIdleTimeoutMinutes = (roleId: string) => roleSecurity(roleId).sessionTimeoutMin;

export const IPV4_OR_CIDR = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
