"use client";

import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { BackendApplicationPage } from "@/modules/origination/backend/record-page";
import { ApplicationRecordPage } from "@/modules/origination/pages/application-page";

export default function Page() {
  return backendSsoEnabled ? <BackendApplicationPage /> : <ApplicationRecordPage />;
}
