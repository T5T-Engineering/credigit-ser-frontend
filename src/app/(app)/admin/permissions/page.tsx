"use client";

import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { BackendPermissionsPage } from "@/modules/admin/backend-permissions-page";
import { PermissionsPage } from "@/modules/admin/permissions-page";

export default function Page() {
  return backendSsoEnabled ? <BackendPermissionsPage /> : <PermissionsPage />;
}
