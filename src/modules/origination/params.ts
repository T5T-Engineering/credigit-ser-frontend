/**
 * Loan-origination parameters — read from business rules at call time (invariant 8).
 *
 * Rules are defined in ./platform.ts (`origination.*`) and the chart-flow in src/lib/workflow.ts. These helpers
 * parse the rule values into domain shapes. Never call them at module top level.
 */
import { getRule } from "@/lib/platform/rules";
import type { CollateralType, DocumentRecord, ProductType } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";

/** Shown next to any value that is a demo default rather than a PRD rule. */
export const TENANT_PARAM_NOTE = "Business rule — set by tenant";

/** Where these values are maintained (Operations → Business rules). */
export const PARAMS_HREF = "/operations/rules";

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Calendar days from initiation to final approval for a flow. */
export function slaDays(flow: "Standard" | "Fast-Track"): number {
  return getRule<number>(flow === "Fast-Track" ? "origination.sla.fastTrackDays" : "origination.sla.standardDays");
}

/** Products offered for origination (tenant catalogue). */
export function productOptions(): ProductType[] {
  return getRule<string[]>("origination.products") as ProductType[];
}

/** Off-balance-sheet (contingent) products — weighted for the single-obligor test (CBN 3.2(b)). */
export function offBalanceProducts(): ProductType[] {
  return getRule<string[]>("origination.offBalanceProducts") as ProductType[];
}

/** Fast-Track eligible product variants (PRD §6.1.3): rule entries "Label = Catalogue product". */
export function fastTrackVariants(): { id: string; label: string; product: ProductType }[] {
  return getRule<string[]>("origination.fastTrack.variants")
    .map((entry) => entry.split("=").map((x) => x.trim()))
    .filter((parts) => parts.length === 2 && parts[0] && parts[1])
    .map(([label, product]) => ({ id: slug(label!), label: label!, product: product as ProductType }));
}

/** Haircut % applied to a newly pledged collateral item of this type. */
export function haircutFor(type: CollateralType): number {
  return getRule<number>(`origination.haircut.${slug(type)}`);
}

/** Documents required for an obligor type. */
export function requiredKinds(obligorType: string): DocumentRecord["kind"][] {
  const base = getRule<string[]>("origination.docs.required") as DocumentRecord["kind"][];
  const extra = getRule<string[]>("origination.docs.requiredNonRetail") as DocumentRecord["kind"][];
  return obligorType === "Retail" ? base : [...base, ...extra.filter((k) => !base.includes(k))];
}

/** Role groups (tenant role mappings). */
export type RoleGroup = "initiators" | "analysts" | "recommenders" | "releasers" | "uploaders";
export function rolesFor(group: RoleGroup): RoleId[] {
  return getRule<string[]>(`origination.roles.${group}`) as RoleId[];
}
export const inGroup = (group: RoleGroup, roleId: RoleId | undefined) => Boolean(roleId && rolesFor(group).includes(roleId));

/** Rule shortcuts. */
export const num = (key: string) => getRule<number>(`origination.${key}`);
export const text = (key: string) => getRule<string>(`origination.${key}`);
