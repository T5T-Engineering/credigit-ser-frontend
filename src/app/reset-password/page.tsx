"use client";

import { Suspense } from "react";
import { ResetPasswordPage } from "@/modules/auth/password-pages";

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordPage />
    </Suspense>
  );
}
