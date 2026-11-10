"use client";

import { Suspense } from "react";
import { ChangePasswordPage } from "@/modules/auth/password-pages";

export default function Page() {
  return (
    <Suspense>
      <ChangePasswordPage />
    </Suspense>
  );
}
