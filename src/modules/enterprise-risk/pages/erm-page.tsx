"use client";

import { Building2, Gauge as GaugeIcon, Landmark, Layers } from "lucide-react";
import { Grid, Stack, StatCard } from "@credigit/web-ui";
import { useRule } from "@/lib/platform/rules";
import { ModulePage } from "@/components/module-page";
import { moneyShort, pct } from "@/lib/format";
import { riskScore, scoreBand } from "../../operational-risk/logic";
import { fmtMetric } from "../data";
import { useAppetite } from "../logic";
import { useErm } from "../store";
import { ermKeys } from "../keys";
import { AppetiteSection } from "../sections/appetite";

/** ERM overview = Risk appetite (sub-pages: register, insider, regulatory, BRC pack, lines of defence). */
export function ErmPage() {
  const { metrics, fig } = useAppetite();
  const risks = useErm((s) => s.risks);
  const circulars = useErm((s) => s.circulars);
  const reds = metrics.filter((m) => m.rag === "red");
  const soLimit = useRule<number>(ermKeys.rasLimit("RA-01"));
  const critical = risks.filter((r) => scoreBand(riskScore(r.residual)).label === "Critical").length;
  const so = metrics.find((m) => m.id === "RA-01")!;

  return (
    <ModulePage
      module="enterprise-risk"
      description="Enterprise-level aggregation of the Risk Data Spine — risk appetite against the Board-approved statement, enterprise risk register, insider/related-party disclosure, regulatory-update tracking and the Board Risk Committee pack."
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="Appetite breaches" value={<span className="font-mono">{reds.length}</span>} hint={`${metrics.filter((m) => m.rag === "amber").length} in early warning · ${metrics.length} metrics`} icon={<GaugeIcon aria-hidden />} tone={reds.length ? "danger" : "success"} />
          <StatCard label="Largest single obligor" value={<span className="font-mono">{fmtMetric(so, so.actual)}</span>} hint={`${fig.largestObligor.name} · ${moneyShort(fig.largestObligor.exposure)} of shareholders' funds (limit ${soLimit}%)`} icon={<Landmark aria-hidden />} tone={so.rag === "green" ? "success" : so.rag === "amber" ? "warning" : "danger"} />
          <StatCard label="Critical residual risks" value={<span className="font-mono">{critical}</span>} hint={`${risks.length} enterprise risks · ${risks.filter((r) => r.trend === "Rising").length} rising`} icon={<Layers aria-hidden />} tone={critical ? "warning" : "success"} />
          <StatCard label="NPL ratio" value={<span className="font-mono">{pct((fig.npl / fig.totalBook) * 100, 2)}</span>} hint={`Total book ${moneyShort(fig.totalBook)} · ${circulars.filter((c) => c.status === "New").length} new CBN circular(s)`} icon={<Building2 aria-hidden />} />
        </Grid>
        <AppetiteSection />
      </Stack>
    </ModulePage>
  );
}
