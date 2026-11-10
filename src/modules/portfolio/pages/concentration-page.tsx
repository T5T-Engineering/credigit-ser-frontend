"use client";

import { useMemo, useState } from "react";
import { Badge, BarChart, ChipList, Chip, DataTable, Grid, MiniBarList, SegmentedControl, Stack, StatusBadge, Text, Treemap, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { money, moneyShort, number, pct } from "@/lib/format";
import { KpiCard } from "../components/calc-note";
import { Panel } from "../components/panel";
import { cbnSectorMap } from "../data";
import { usePortfolioModel } from "../hooks";
import { concentration, portfolioParams, productGroup, sum, type ObligorExposure } from "../selectors";

const CUTS = ["10", "20", "50", "100"] as const;
type Cut = (typeof CUTS)[number];
const stageTones = { "Stage 1": "success", "Stage 2": "warning", "Stage 3": "danger" } as const;
const postureTone = { Aggressive: "success", Competitive: "info", Conservative: "warning", Defensive: "danger" } as const;

export function ConcentrationPage() {
  const { exposures, totals } = usePortfolioModel();
  const [cut, setCut] = useState<Cut>("10");
  const n = Number(cut);
  const c = useMemo(() => concentration(exposures, n, totals.grossLoans), [exposures, n, totals.grossLoans]);
  const curve = CUTS.map((k) => ({ k, ...concentration(exposures, Number(k), totals.grossLoans) }));
  const bySector = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of c.top) map.set(e.sector?.name ?? "—", (map.get(e.sector?.name ?? "—") ?? 0) + e.exposure);
    return [...map.entries()].map(([label, value]) => ({ label, value }));
  }, [c.top]);

  const columns: DataTableColumn<ObligorExposure & { rank: number }>[] = [
    { id: "rank", header: "#", accessor: "rank", numeric: true, width: 48 },
    { id: "name", header: "Obligor", accessor: (r) => r.obligor.name, sortable: true, cell: (r) => (
      <span className="flex flex-col">
        <span className="font-semibold text-fg">{r.obligor.name}</span>
        <span className="text-xs text-fg-subtle">{r.obligor.id} · {r.obligor.type}</span>
      </span>
    ) },
    { id: "exposure", header: "Aggregate exposure", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
    { id: "book", header: "% of book", accessor: (r) => (r.exposure / sum(exposures, (e) => e.exposure)) * 100, numeric: true, sortable: true, cell: (r) => pct((r.exposure / sum(exposures, (e) => e.exposure)) * 100, 2) },
    { id: "shf", header: "% of SHF", accessor: "pctOfShf", numeric: true, sortable: true, cell: (r) => pct(r.pctOfShf) },
    { id: "sector", header: "Sector (CBN)", accessor: (r) => r.sector?.name ?? "—", sortable: true, cell: (r) => (
      <span className="flex flex-col">
        <span>{r.sector?.name ?? "—"}</span>
        <span className="text-xs text-fg-subtle">{(cbnSectorMap[r.obligor.sectorId] ?? []).map((m) => m.cbn).join(" / ")}</span>
      </span>
    ) },
    { id: "products", header: "Product mix", accessor: (r) => [...new Set(r.products.map(productGroup))].join(", "), cell: (r) => (
      <ChipList>
        {[...new Set(r.products.map(productGroup))].map((pgrp) => (
          <Chip key={pgrp} size="small">{pgrp}</Chip>
        ))}
      </ChipList>
    ) },
    { id: "stage", header: "IFRS 9 stage", accessor: (r) => `Stage ${r.worstStage}`, sortable: true, cell: (r) => <StatusBadge status={`Stage ${r.worstStage}`} tones={stageTones} /> },
    { id: "posture", header: "360 RAR posture", accessor: "posture", sortable: true, cell: (r) => <Badge tone={postureTone[r.postureBase as keyof typeof postureTone] ?? "neutral"} variant="soft">{r.posture}</Badge> },
  ];

  return (
    <ModulePage module="portfolio" description="Bank-wide obligor concentration ranked by outstanding exposure at the Top 10 / 20 / 50 / 100 cut-offs (§6.6.3) — how concentrated the book is at its top end, not just whether a name breaches the statutory limit.">
      <Stack gap="large">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="Concentration cut-off"
            value={cut}
            onChange={setCut}
            options={CUTS.map((k) => ({ value: k, label: `Top ${k}` }))}
          />
          {exposures.length < n ? <Text variant="caption">The demo book has {exposures.length} obligors with live exposure — Top {n} shows all of them.</Text> : null}
        </div>

        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <KpiCard
            label={`Top ${cut} aggregate exposure`}
            value={moneyShort(c.exposure)}
            hint={`${number(c.top.length)} obligors / connected groups`}
            calc={{ metric: "Top-N exposure", formula: "Σ (on-balance + off-balance exposure) of the N largest obligors", source: "CBA facility ledger, ranked by outstanding exposure (§6.6.3).", prd: "§6.6.3" }}
          />
          <KpiCard
            label="% of total loan book"
            value={pct(c.pctOfBook)}
            hint={`of ${moneyShort(sum(exposures, (e) => e.exposure))} incl. contingents`}
            tone="accent"
            calc={{ metric: "% of loan book", formula: "Top-N exposure / Σ all obligor exposure × 100", source: "CBA facility ledger, full book.", prd: "§6.6.3" }}
          />
          <KpiCard
            label="% of shareholders' funds"
            value={pct(c.pctOfShf, 0)}
            hint={`SHF ${moneyShort(portfolioParams.shareholdersFunds.value)} (demo value)`}
            tone="warning"
            calc={{ metric: "% of SHF", formula: "Top-N exposure / Shareholders' funds unimpaired by losses × 100", source: "SHF from GL capital accounts — demo value.", prd: "§6.6.3", demo: true }}
          />
          <KpiCard
            label="Stage 2/3 within cut-off"
            value={moneyShort(sum(c.top.filter((e) => e.worstStage > 1), (e) => e.exposure))}
            hint={`${c.top.filter((e) => e.worstStage > 1).length} obligors in Stage 2 or 3`}
            tone="danger"
            calc={{ metric: "Stage 2/3 concentration", formula: "Σ exposure of Top-N obligors whose worst facility stage is 2 or 3", source: "IFRS 9 staging (§6.7.1).", prd: "§6.6.3" }}
          />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Panel title={`Top ${Math.min(10, n)} obligors`} description="Ranked by aggregate exposure; share of shareholders' funds shown alongside.">
            <MiniBarList
              label={`Top ${Math.min(10, n)} obligors by exposure`}
              items={c.top.slice(0, 10).map((e) => ({ label: e.obligor.name, value: e.exposure, meta: `${pct(e.pctOfShf, 0)} SHF`, tone: e.worstStage > 1 ? "warning" : "accent" }))}
              valueFormatter={moneyShort}
            />
          </Panel>
          <Panel title={`Top ${cut} by sector`} description="Sector make-up of the cut-off (tenant taxonomy).">
            <Treemap label={`Top ${cut} exposure by sector`} items={bySector} valueFormatter={moneyShort} aspectRatio={1.6} />
          </Panel>
        </Grid>

        <Panel title="Concentration curve" description="Cumulative share of the loan book held by the largest obligors at each cut-off.">
          <BarChart
            label="Cumulative share of book by cut-off"
            data={curve.map((x) => ({ label: `Top ${x.k}`, value: x.pctOfBook, caption: moneyShort(x.exposure) }))}
            valueFormatter={(v) => pct(v, 1)}
            tone="accent"
            height={200}
          />
        </Panel>

        <Panel title={`Top ${cut} concentration report`} description="Aggregate exposure, % of book, % of SHF, sector with CBN cross-reference, product mix (incl. Lease), IFRS 9 stage and 360 RAR posture for every name.">
          <DataTable
            label={`Top ${cut} concentration report`}
            data={c.top.map((e, i) => ({ ...e, rank: i + 1 }))}
            columns={columns}
            getRowId={(r) => r.obligor.id}
            defaultPageSize={10}
            exportFilename={`top-${cut}-concentration.csv`}
            searchable
            searchPlaceholder="Search obligors"
            filters={[{ id: "stage", label: "Stage" }]}
          />
          <Text variant="caption" className="mt-2 block">
            Largest name: {c.top[0] ? `${c.top[0].obligor.name}, ${money(c.top[0].exposure)}` : "—"}. Connected-group aggregation will apply once groups are configured in the spine.
          </Text>
        </Panel>
      </Stack>
    </ModulePage>
  );
}
