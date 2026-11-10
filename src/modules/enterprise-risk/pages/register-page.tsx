"use client";

import { ModulePage } from "@/components/module-page";
import { RegisterSection } from "../sections/register";

export function ErmRegisterPage() {
  return (
    <ModulePage module="enterprise-risk" description="Enterprise risk register — likelihood × impact heat map, ISO 31000 responses and COSO stages, with risk acceptance routed through Operations.">
      <RegisterSection />
    </ModulePage>
  );
}
