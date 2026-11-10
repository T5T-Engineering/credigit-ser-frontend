"use client";

import { ModulePage } from "@/components/module-page";
import { BrcPackSection } from "../sections/brc-pack";

export function ErmBrcPackPage() {
  return (
    <ModulePage module="enterprise-risk" description="Board Risk Committee pack builder — the Head of Risk compiles and submits; the CRO approves through the Operations workflow (§6.11).">
      <BrcPackSection />
    </ModulePage>
  );
}
