"use client";

import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { BackendPipelinePage } from "@/modules/origination/backend/pipeline-page";
import { OriginationPipelinePage } from "@/modules/origination/pages/pipeline-page";

export default function Page() {
  return backendSsoEnabled ? <BackendPipelinePage /> : <OriginationPipelinePage />;
}
