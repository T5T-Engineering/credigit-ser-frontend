"use client";

/**
 * Approved tenant brand (Settings → Branding). The BrandProvider shows whatever this browser last applied —
 * which may be a personal, unapproved preview. The tenant brand only changes when a "brand.change" operation is
 * approved in Operations; `TenantBrandSync` then applies it in every browser session that sees the new version.
 *
 * BACKEND SEAM: the approved brand comes from the tenant configuration API.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useBrand, type BrandConfig } from "@credigit/web-ui";
import { deploymentTenantId } from "@/lib/tenant";

type BrandingState = {
  /** Approved tenant brand; null = Credigit defaults. */
  approved: BrandConfig | null;
  /** Increments on each approved change. */
  version: number;
  /** Version this browser has applied to its BrandProvider. */
  appliedVersion: number;
  approvedAt?: string;
  approvedBy?: string;
  operationId?: string;
};

export const useBrandingStore = create<BrandingState>()(
  persist((): BrandingState => ({ approved: null, version: 0, appliedVersion: 0 }), { name: `credigit.brand.tenant.${deploymentTenantId}`, storage: createJSONStorage(() => localStorage) }),
);

/** Only the "brand.change" operation (on approval) calls this. */
export function setApprovedBrand(brand: BrandConfig | null, meta: { by: string; operationId: string }) {
  useBrandingStore.setState((s) => ({ approved: brand, version: s.version + 1, approvedAt: new Date().toISOString(), approvedBy: meta.by, operationId: meta.operationId }));
}

/** Apply a newly approved tenant brand to this browser's BrandProvider (mount once in the app shell). */
export function TenantBrandSync() {
  const { updateBrand, resetBrand } = useBrand();
  const version = useBrandingStore((s) => s.version);
  const applied = useBrandingStore((s) => s.appliedVersion);
  const approved = useBrandingStore((s) => s.approved);
  useEffect(() => {
    if (version <= applied) return;
    if (approved) updateBrand(approved);
    else resetBrand();
    useBrandingStore.setState({ appliedVersion: version });
  }, [version, applied, approved, updateBrand, resetBrand]);
  return null;
}

/** Comparable fingerprint of a brand (name, colours, font, logos). */
export const brandFingerprint = (b: Pick<BrandConfig, "name" | "colors" | "font" | "logos">) =>
  JSON.stringify([b.name, b.colors.primary.toUpperCase(), b.colors.accent.toUpperCase(), b.colors.neutral.toUpperCase(), b.font.family, b.logos]);
