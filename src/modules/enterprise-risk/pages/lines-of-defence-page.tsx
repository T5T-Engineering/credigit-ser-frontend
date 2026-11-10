"use client";

import { ModulePage } from "@/components/module-page";
import { LinesOfDefenceSection } from "../sections/lines-of-defence";

export function ErmLinesOfDefencePage() {
  return (
    <ModulePage module="enterprise-risk" description="Three lines of defence — which roles own, oversee and assure risk in this tenant.">
      <LinesOfDefenceSection />
    </ModulePage>
  );
}
