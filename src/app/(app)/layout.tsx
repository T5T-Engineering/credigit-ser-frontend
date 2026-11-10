"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { AppFrame } from "@/components/app-frame";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <AppFrame>{children}</AppFrame>
    </AuthGuard>
  );
}
