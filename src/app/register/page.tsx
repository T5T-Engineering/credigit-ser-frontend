"use client";

import { Suspense } from "react";
import { RegisterPage } from "@/modules/auth/register-page";

export default function Page() {
  return (
    <Suspense>
      <RegisterPage />
    </Suspense>
  );
}
