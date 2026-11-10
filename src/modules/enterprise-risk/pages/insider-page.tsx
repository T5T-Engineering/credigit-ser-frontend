"use client";

import { ModulePage } from "@/components/module-page";
import { InsiderSection } from "../sections/insider";

export function ErmInsiderPage() {
  return (
    <ModulePage module="enterprise-risk" description="Insider and related-party lending disclosure — facilities to directors, significant shareholders and their related interests (§6.10).">
      <InsiderSection />
    </ModulePage>
  );
}
