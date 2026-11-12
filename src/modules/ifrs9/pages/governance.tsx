"use client";

import { Grid, Stack } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { ModuleApprovals, RulesPanel } from "../governance";
import { IFRS9_RULE_GROUPS } from "../platform";

const PANELS: { title: string; keys: string[]; description?: string }[] = [
  { title: "Staging & SICR triggers", keys: IFRS9_RULE_GROUPS.staging },
  { title: "CBN prudential provisioning", keys: IFRS9_RULE_GROUPS.provisioning },
  { title: "Declassification (cure & probation)", keys: IFRS9_RULE_GROUPS.cure },
  { title: "PD calibration & forward-looking overlay", keys: IFRS9_RULE_GROUPS.pd, description: "Demo calibration until the approved model register supplies these values." },
  { title: "LGD & EAD", keys: IFRS9_RULE_GROUPS.lgdEad },
  { title: "Model governance", keys: IFRS9_RULE_GROUPS.models },
  { title: "ICAAP — capital adequacy & Pillar 2", keys: IFRS9_RULE_GROUPS.capital },
  { title: "ICAAP — capital base", keys: IFRS9_RULE_GROUPS.capitalBase },
  {
    title: "ICAAP — stress scenarios",
    keys: IFRS9_RULE_GROUPS.scenarios,
    description: "Change the Adverse / Severe severities together from the ICAAP page (ICAAP stress scenario change: Head of Risk → CRO).",
  },
];

/** IFRS 9 & ICAAP — every business rule the module reads, and its approvals routed through Operations. */
export function Ifrs9GovernancePage() {
  const canEdit = useCan("ifrs9", "edit");
  return (
    <ModulePage module="ifrs9" title="Rules & approvals" description="Every IFRS 9 / ICAAP parameter with its source, and the approvals routed through the Operations workflow.">
      <Stack gap="large">
        <ModuleApprovals modules={["ifrs9"]} limit={10} />
        <Grid columns={{ base: 1 }} gap="large">
          {PANELS.map((p) => (
            <RulesPanel key={p.title} title={p.title} description={p.description} keys={p.keys} canRequest={canEdit} />
          ))}
        </Grid>
      </Stack>
    </ModulePage>
  );
}
