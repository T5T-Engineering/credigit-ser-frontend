"use client";

import type { ReactNode } from "react";
import { BrandProvider } from "@credigit/web-ui";
import { useSession } from "@/lib/auth/session";
import { deploymentTenantId } from "@/lib/tenant";

/** BrandProvider scoped to the tenant (`credigit.brand.<tenantId>`), so brands never bleed between tenants in a browser. */
export function TenantBrandProvider({ children }: { children: ReactNode }) {
  const sessionTenant = useSession((s) => s.tenantId);
  return <BrandProvider tenantId={sessionTenant ?? deploymentTenantId}>{children}</BrandProvider>;
}
