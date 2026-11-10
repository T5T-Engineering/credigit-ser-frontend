"use client";

import { Suspense } from "react";
import { LoginPage } from "@/modules/auth/login-page";

export default function Page() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
