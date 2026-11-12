"use client";

import { Suspense } from "react";
import { backendAuthEnabled } from "@/lib/auth/backend-auth";
import { BackendVerifyPage } from "@/modules/auth/backend-verify-page";
import { VerifyPage } from "@/modules/auth/verify-page";

export default function Page() {
  return <Suspense>{backendAuthEnabled ? <BackendVerifyPage /> : <VerifyPage />}</Suspense>;
}
