"use client";

import { ModulePage } from "@/components/module-page";
import { RegulatorySection } from "../sections/regulatory";

export function ErmRegulatoryPage() {
  return (
    <ModulePage module="enterprise-risk" description="Regulatory-update ingestion, policy-currency tracker and regulatory-breach register.">
      <RegulatorySection />
    </ModulePage>
  );
}
