"use client";

import { Suspense } from "react";
import { MicrosoftCallbackPage } from "@/modules/auth/microsoft-callback-page";

export default function Page() {
  return (
    <Suspense>
      <MicrosoftCallbackPage />
    </Suspense>
  );
}
