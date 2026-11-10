"use client";

import { useState } from "react";
import { Building2, FileStack, Gauge as GaugeIcon, Landmark, Layers, ScrollText, Users } from "lucide-react";
import { Grid, Stack, StatCard, Tabs } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { moneyShort, pct } from "@/lib/format";
import { riskScore } from "../../operational-risk/logic";
import { fmtMetric } from "../data";
import { useAppetite } from "../logic";
import { useErm } from "../store";
import { AppetiteSection } from "../sections/appetite";
import { BrcPackSection } from "../sections/brc-pack";
import { InsiderSection } from "../sections/insider";
import { LinesOfDefenceSection } from "../sections/lines-of-defence";
import { RegisterSection } from "../sections/register";
import { RegulatorySection } from "../sections/regulatory";

export function ErmPage() {
  const { metrics, fig } = useAppetite();
  const risks = useErm((s) => s.risks);
  const circulars = useErm((s) => s.circulars);
  // Initial tab from ?tab= (client-only page, rendered after sign-in).
  const [tab, setTab] = useState(() => (typeof window === "undefined" ? "appetite" : (new URLSearchParams(window.location.search).get("tab") ?? "appetite")));
  const reds = metrics.filter((m) => m.rag === "red");
  const critical = risks.filter((r) => riskScore(r.residual) >= 15).length;
  const so = metrics.find((m) => m.id === "RA-01")!;

  return (
    <ModulePage
      module="enterprise-risk"
      description="Enterprise-level aggregation of the Risk Data Spine — risk appetite against the Board-approved statement, enterprise risk register, insider/related-party disclosure, regulatory-update tracking and the Board Risk Committee pack."
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="Appetite breaches" value={<span className="font-mono">{reds.length}</span>} hint={`${metrics.filter((m) => m.rag === "amber").length} in early warning · ${metrics.length} metrics`} icon={<GaugeIcon aria-hidden />} tone={reds.length ? "danger" : "success"} />
          <StatCard label="Largest single obligor" value={<span className="font-mono">{fmtMetric(so, so.actual)}</span>} hint={`${fig.largestObligor.name} · ${moneyShort(fig.largestObligor.exposure)} of shareholders' funds (limit 20%)`} icon={<Landmark aria-hidden />} tone={so.rag === "green" ? "success" : so.rag === "amber" ? "warning" : "danger"} />
          <StatCard label="Critical residual risks" value={<span className="font-mono">{critical}</span>} hint={`${risks.length} enterprise risks · ${risks.filter((r) => r.trend === "Rising").length} rising`} icon={<Layers aria-hidden />} tone={critical ? "warning" : "success"} />
          <StatCard label="NPL ratio" value={<span className="font-mono">{pct((fig.npl / fig.totalBook) * 100, 2)}</span>} hint={`Total book ${moneyShort(fig.totalBook)} · ${circulars.filter((c) => c.status === "New").length} new CBN circular(s)`} icon={<Building2 aria-hidden />} />
        </Grid>
        <Tabs
          label="Enterprise risk sections"
          value={tab}
          onValueChange={setTab}
          variant="underline"
          items={[
            { id: "appetite", label: "Risk appetite", icon: <GaugeIcon aria-hidden className="size-4" />, badge: reds.length ? String(reds.length) : undefined, content: <AppetiteSection /> },
            { id: "register", label: "Risk register", icon: <Layers aria-hidden className="size-4" />, content: <RegisterSection /> },
            { id: "insider", label: "Insider & related party", icon: <Users aria-hidden className="size-4" />, content: <InsiderSection /> },
            { id: "regulatory", label: "Regulatory & policies", icon: <ScrollText aria-hidden className="size-4" />, content: <RegulatorySection /> },
            { id: "brc", label: "BRC pack", icon: <FileStack aria-hidden className="size-4" />, content: <BrcPackSection /> },
            { id: "lod", label: "Lines of defence", icon: <Building2 aria-hidden className="size-4" />, content: <LinesOfDefenceSection /> },
          ]}
        />
      </Stack>
    </ModulePage>
  );
}
