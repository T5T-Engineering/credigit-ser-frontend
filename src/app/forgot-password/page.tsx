"use client";

import { Suspense } from "react";
import { ForgotPasswordPage } from "@/modules/auth/password-pages";

export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordPage />
    </Suspense>
  );
}
