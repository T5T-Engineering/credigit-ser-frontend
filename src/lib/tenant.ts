/**
 * Tenant of this deployment (invariant 2: tenant-scoped brand storage). `NEXT_PUBLIC_TENANT_ID` in real deployments;
 * the demo tenant id (seed data) otherwise. In API mode the signed-in user's `tenantId` (`/identity/me`) wins at runtime.
 */
export const DEMO_TENANT_ID = "TEN-001";

export const deploymentTenantId = (process.env.NEXT_PUBLIC_TENANT_ID ?? "").trim() || DEMO_TENANT_ID;
