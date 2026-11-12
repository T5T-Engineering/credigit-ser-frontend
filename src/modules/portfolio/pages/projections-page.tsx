"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AiInsightCard, Alert, AreaChart, Badge, ChipList, Chip, DataTable, Grid, PhaseBadge, SegmentedControl, Stack, StatusBadge, Text, useToast, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { getDefinition, stepApproverLabel, usePendingFor } from "@/lib/platform/operations";
import { useScope } from "@/lib/platform/scope";
import { roleById } from "@/lib/rbac/roles";
import { dateTime, pct } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { KpiCard } from "../components/calc-note";
import { operationHref, PendingApproval, useSubmitOperation } from "../components/governance";
import { Panel } from "../components/panel";
import { bookProjection, macroVariables, projectedWarr, sectorProjections, type Scenario, type SectorProjection } from "../data";
import { useActor, usePortfolioModel } from "../hooks";
import type { ProjectionAdoptPayload } from "../platform";
import { usePortfolioStore } from "../store";

const OPERATION = "portfolio.projection.adopt";
const phaseTone = { Expansion: "success", Peak: "info", Contraction: "danger", Trough: "warning" } as const;
const dirTone = { Improving: "success", Stable: "info", Deteriorating: "danger" } as const;

export function ProjectionsPage() {
  const { facilities, obligors, sectors, totals, warr } = usePortfolioModel();
  const [scenario, setScenario] = useState<Scenario>("Base");
  const actor = useActor();
  const { actor: me } = useScope();
  const { toast } = useToast();
  const submit = useSubmitOperation();
  const canSubmitForAdoption = useCan("portfolio.projection-commentary.submit");
  const canExport = useCan("portfolio.data.export");
  const key = `projection-commentary:${scenario}`;
  const signOff = usePortfolioStore((s) => s.signOffs[key]);
  const pending = usePendingFor("ProjectionCommentary", key);
  const approvers = getDefinition(OPERATION).steps.map(stepApproverLabel).join(" → ") || "no approval step (applied directly)";

  const proj = useMemo(() => sectorProjections(facilities, obligors, sectors, scenario), [facilities, obligors, sectors, scenario]);
  const path = useMemo(() => bookProjection(totals.nplRatio), [totals.nplRatio]);
  const fw = projectedWarr(warr.warr).find((x) => x.scenario === scenario)!;
  const sel = path.find((s) => s.name === scenario)!;
  const deteriorating = proj.filter((x) => x.direction === "Deteriorating");
  const headline = `Under the ${scenario.toLowerCase()} scenario the bank-wide NPL ratio moves from ${pct(totals.nplRatio, 2)} to ${pct(sel.points[12]!.y, 2)} over 12 months.`;

  /** Submit the AI commentary for adoption; it's adopted only when the Operations workflow approves it. */
  const submitForAdoption = async () => {
    const hook = await runHooks("portfolio.projection.submit.before", { key, scenario, actor: me });
    if (!hook.ok) {
      toast({ title: "Can't submit commentary", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const res = await submit<ProjectionAdoptPayload>(OPERATION, {
      title: `Adopt projection commentary — ${scenario} scenario`,
      subject: { type: "ProjectionCommentary", id: key, title: `Projection commentary — ${scenario}`, href: "/portfolio/projections" },
      payload: { key, scenario, summary: headline },
      summary: [
        { label: "Scenario", value: scenario },
        { label: "Headline", value: headline },
        { label: "Deteriorating sectors", value: deteriorating.map((d) => d.sector.name).slice(0, 5).join(", ") || "None" },
      ],
    });
    if (!res.ok) return;
    actor.log("Submitted AI projection commentary for adoption", "Projection", key, "AI-drafted", "Submitted for adoption");
    publish("portfolio.projection.submitted", { module: "portfolio", subject: { type: "ProjectionCommentary", id: key, title: `Projection commentary — ${scenario}`, href: "/portfolio/projections" }, payload: { scenario, operationId: res.instance.id } });
    await runHooks("portfolio.projection.submit.after", { key, scenario, operationId: res.instance.id });
  };

  const columns: DataTableColumn<SectorProjection>[] = [
    { id: "sector", header: "Sector", accessor: (r) => r.sector.name, sortable: true, cell: (r) => <span className="font-semibold text-fg">{r.sector.name}</span> },
    { id: "life", header: "Life-cycle stage", accessor: "lifeCycle", sortable: true },
    { id: "phase", header: "Macro-cycle phase", accessor: "phase", sortable: true, cell: (r) => <StatusBadge status={r.phase} tones={phaseTone} /> },
    { id: "now", header: "NPL now", accessor: "currentNpl", numeric: true, sortable: true, cell: (r) => pct(r.currentNpl, 2) },
    { id: "m3", header: "3 months", accessor: (r) => r.m3[1], numeric: true, cell: (r) => range(r.m3) },
    { id: "m6", header: "6 months", accessor: (r) => r.m6[1], numeric: true, cell: (r) => range(r.m6) },
    { id: "m12", header: "12 months", accessor: (r) => r.m12[1], numeric: true, sortable: true, cell: (r) => range(r.m12) },
    { id: "roll", header: "Roll-rate (12m)", accessor: "rollRate12", numeric: true, sortable: true, cell: (r) => pct(r.rollRate12) },
    { id: "drivers", header: "Driving variables", accessor: (r) => r.drivers.join(", "), cell: (r) => (
      <ChipList>{r.drivers.map((d) => <Chip key={d} size="small">{d}</Chip>)}</ChipList>
    ) },
    { id: "dir", header: "Trend", accessor: "direction", sortable: true, cell: (r) => <StatusBadge status={r.direction} tones={dirTone} /> },
    { id: "gate", header: "Origination gate (§6.2.6)", accessor: (r) => (r.direction === "Deteriorating" ? "Gate earlier" : "Normal"), cell: (r) => (r.direction === "Deteriorating" ? <Badge tone="warning">Gate earlier</Badge> : "—") },
  ];

  return (
    <ModulePage module="portfolio" description="Forward-looking sector & macro-economic loan-performance projection (§6.6.7): the relationship between macro variables and each sector's realised NPL and roll-rate history, projected forward on the current book.">
      <Stack gap="large">
        <Alert tone="info" title={<span className="inline-flex items-center gap-2">Phase 2 capability — simulated engine output <PhaseBadge phase={2} /></span>}>
          Every output is a decision-support signal reviewed by the Credit Analyst or Head of Risk through the §6.4.4 escalation protocol before it affects a credit, allocation or provisioning outcome. The engine does not act on its own output.
        </Alert>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl label="Scenario" value={scenario} onChange={setScenario} options={[{ value: "Base", label: "Base" }, { value: "Upside", label: "Upside" }, { value: "Downside", label: "Downside" }]} />
          <Text variant="caption">Macro data as of {dateTime(DEMO_NOW)} · NGX Corpus update Q3 2026 (demo)</Text>
        </div>

        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <KpiCard
            label="NPL ratio in 12 months"
            value={pct(sel.points[12]!.y, 2)}
            hint={`from ${pct(totals.nplRatio, 2)} today · ${scenario.toLowerCase()} scenario`}
            tone={scenario === "Downside" ? "danger" : scenario === "Upside" ? "success" : "info"}
            calc={{ metric: "projected NPL ratio", formula: "Sector NPL/roll-rate history regressed on §5.5 macro variables, projected on the current macro trend and portfolio composition", source: "External Data Feeds (§5.5), sector NPL/roll-rate history (§6.6.5), NGX Corpus life-cycle (§6.2.8). Prototype: simulated.", prd: "§6.6.7", demo: true }}
          />
          <KpiCard label="Sectors deteriorating" value={String(deteriorating.length)} hint={deteriorating.slice(0, 2).map((d) => d.sector.name).join(", ") || "None"} tone="warning" calc={{ metric: "deteriorating sectors", formula: "12-month projected NPL midpoint > current × 1.08", source: "Projection engine output under the selected scenario.", prd: "§6.6.7", demo: true }} />
          <KpiCard label="Projected WARR (12m)" value={fw.m12.toFixed(2)} hint={`6m ${fw.m6.toFixed(2)} · today ${warr.warr.toFixed(2)}`} tone="accent" calc={{ metric: "forward-looking WARR", formula: "WARR re-computed on scenario-projected grades and exposures", source: "Projection engine (§6.6.7) and ICAAP stress cases (§6.7.4).", prd: "§6.6.9", demo: true }} />
          <KpiCard label="Sectors in contraction" value={String(proj.filter((x) => x.phase === "Contraction").length)} hint="Macro-cycle phase, refreshed with life-cycle classification" tone="danger" calc={{ metric: "macro-cycle phase", formula: "Expansion / Peak / Contraction / Trough tag computed by the AI trend engine from §5.5 variables", source: "Read together with the Industry Life-Cycle Stage (§6.2.8).", prd: "§6.6.7", demo: true }} />
        </Grid>

        <Grid columns={{ base: 1, lg: 3 }} gap="medium">
          <div className="lg:col-span-2">
            <Panel title="Bank-wide NPL ratio — 12-month projection" description="Base, upside and downside paths from today's ratio.">
              <AreaChart label="Projected NPL ratio by scenario" series={path.map((s) => ({ ...s, tone: s.name === "Base" ? "info" : s.name === "Upside" ? "success" : "danger" }))} yFormatter={(v) => pct(v, 1)} height={260} />
            </Panel>
          </div>
          <AiInsightCard
            kind="drafted"
            title="Projection commentary"
            model="Credigit trend engine (simulated)"
            generatedAt={dateTime(DEMO_NOW)}
            confidence={0.72}
            paragraphs={[
              headline,
              deteriorating.length ? `${deteriorating.map((d) => d.sector.name).slice(0, 3).join(", ")} ${deteriorating.length > 1 ? "show" : "shows"} the steepest projected deterioration, driven mainly by ${deteriorating[0]!.drivers.join(" and ")}.` : "No sector shows material projected deterioration.",
            ]}
            bullets={["Consider earlier origination gating for deteriorating sectors (§6.2.6).", "Feed projected roll-rates into ILAAP cash-inflow assumptions (§6.8.4)."]}
            sources={[{ label: "Macro feed (§5.5)", detail: "MPR, inflation, FX, crude, GDP, PMI, T-bill" }, { label: "Sector NPL history (§6.6.5)" }]}
            signedOffBy={signOff ? `${signOff.by} (${roleById[signOff.role as keyof typeof roleById]?.name ?? signOff.role}), ${dateTime(signOff.at)} — adopted through Operations` : undefined}
            signOffNote={
              pending ? (
                <span>
                  Awaiting adoption in Operations — <Link href={operationHref(pending.id)} className="font-semibold text-link">{pending.id}</Link>
                </span>
              ) : (
                `Adoption (${approvers}) is required before this affects any decision.`
              )
            }
            labels={{ accept: "Submit for adoption" }}
            onAccept={canSubmitForAdoption && !pending ? () => void submitForAdoption() : undefined}
          />
        </Grid>

        {pending ? <PendingApproval subjectType="ProjectionCommentary" subjectId={key} /> : null}

        <Panel title="Sector projections" description={`3/6/12-month projected NPL ratio range (confidence band) per sector — ${scenario.toLowerCase()} scenario — with the driving variables, not a single unexplained figure.`}>
          <DataTable label="Sector projections" data={proj} columns={columns} getRowId={(r) => r.sector.id} paginate={false} exportFilename={canExport ? `sector-projection-${scenario.toLowerCase()}.csv` : undefined} defaultSort={{ id: "m12", direction: "desc" }} />
        </Panel>

        <Panel title="Macro-economic variables" description="Carried in the External Data Feeds layer (§5.5). Values shown are demo feed values.">
          <DataTable
            label="Macro variables"
            data={macroVariables}
            getRowId={(r) => r.id}
            paginate={false}
            columns={[
              { id: "v", header: "Variable", accessor: "variable", cell: (r) => <span className="font-semibold text-fg">{r.variable}</span> },
              { id: "src", header: "Source", accessor: "source" },
              { id: "cur", header: "Latest", accessor: "current", numeric: true },
              { id: "trend", header: "Trend", accessor: "trend" },
              { id: "use", header: "Primary use in the projection", accessor: "use" },
            ]}
          />
        </Panel>
      </Stack>
    </ModulePage>
  );
}

function range([lo, , hi]: [number, number, number]) {
  return `${lo.toFixed(1)}–${hi.toFixed(1)}%`;
}
