"use client";

import type { ReactNode } from "react";
import "@/lib/platform/registry";

/** Ensures business rules, workflows, templates, events and hook points are registered before any page runs. */
export function PlatformProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
