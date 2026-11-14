"use client";

import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { BackendNewApplicationPage } from "@/modules/origination/backend/new-application-page";
import { NewApplicationPage } from "@/modules/origination/pages/new-application-page";

export default function Page() {
  return backendSsoEnabled ? <BackendNewApplicationPage /> : <NewApplicationPage />;
}
