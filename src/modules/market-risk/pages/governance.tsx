"use client";

import { useMemo } from "react";
import { Grid, Stack } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { ruleDefinitions } from "@/lib/platform/rules";
import { ModuleApprovals, RulesPanel } from "../../ifrs9/governance";

/** Rule categories shown on this page, grouped into panels. Stress-band categories are matched by prefix. */
const GROUPS: { title: string; description?: string; categories: (c: string) => boolean }[] = [
  { title: "Market limits & IRRBB", categories: (c) => c === "Market limits" || c === "IRRBB" },
  { title: "Liquidity ratios & factors", categories: (c) => c === "Liquidity ratios" || c === "LCR / NSFR factors" || c === "Concentration" },
  { title: "Early warning & escalation", categories: (c) => c === "Early warning" || c === "Escalation" },
  {
    title: "Risk Appetite Statement",
    description: "Board-approved liquidity appetite. Change these together through the ILAAP page (RAS change: Head of Risk → CRO → Board).",
    categories: (c) => c === "Risk appetite",
  },
  { title: "Stress testing", categories: (c) => c === "Stress model" || c.startsWith("Stress band") },
];

export function MarketGovernancePage() {
  const canEdit = useCan("market-risk", "edit");
  const groups = useMemo(() => {
    const defs = ruleDefinitions().filter((d) => d.module === "market-risk");
    return GROUPS.map((g) => ({ ...g, keys: defs.filter((d) => g.categories(d.category)).map((d) => d.key) }));
  }, []);
  return (
    <ModulePage module="market-risk" title="Limits, rules & approvals" description="Every market and liquidity limit, threshold and stress assumption, and the approvals routed through Operations.">
      <Stack gap="large">
        <ModuleApprovals modules={["market-risk"]} limit={10} />
        <Grid columns={{ base: 1 }} gap="large">
          {groups.map((g) => (
            <RulesPanel key={g.title} title={g.title} description={g.description} keys={g.keys} canRequest={canEdit} />
          ))}
        </Grid>
      </Stack>
    </ModulePage>
  );
}
