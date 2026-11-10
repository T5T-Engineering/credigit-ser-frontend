"use client";

import { Suspense } from "react";
import { VerifyPage } from "@/modules/auth/verify-page";

export default function Page() {
  return (
    <Suspense>
      <VerifyPage />
    </Suspense>
  );
}
