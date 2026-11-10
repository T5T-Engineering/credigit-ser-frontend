"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Building2, Factory, Layers } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  Field,
  Grid,
  PhaseBadge,
  ScatterChart,
  Select,
  Stack,
  StatCard,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useObligors, useSectors } from "@/lib/data/hooks";
import { useHydrated } from "@/lib/auth/session";
import { rarPosition, RAR_MIDPOINT, type RarPosition } from "@/lib/rar";
import type { Obligor } from "@/lib/data/types";
import { CORPUS_VERSION, corpusMetrics, formatMetric, lifeCycleTone, ngxById, ngxForSector, sectorDistribution, sectorMapping } from "../data";
import { assess, OUTLIER_SD, ratioBenchmarks, type RatioBenchmark } from "../logic";
import { cardinalPoints } from "../parameters";
import { assessmentHref, PostureBadge } from "../shared";
import { ordinal } from "../assessment/peers-tab";

type SectorRow = {
  id: string;
  name: string;
  n: number;
  avg: Record<string, number>;
  pos: RarPosition | null;
  ngx: string;
  stage?: string;
};
type OutlierRow = { o: Obligor; b: RatioBenchmark };

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function BenchmarksPage() {
  const hydrated = useHydrated();
  const obligors = useObligors();
  const sectors = useSectors();

  const sectorRows = useMemo<SectorRow[]>(
    () =>
      sectors.map((s) => {
        const list = obligors.filter((o) => o.sectorId === s.id);
        const avg = Object.fromEntries(cardinalPoints.map((c) => [c.key, r1(mean(list.map((o) => o.rar[c.key])))])) as Record<string, number>;
        const ngx = ngxForSector(s.id);
        return {
          id: s.id,
          name: s.name,
          n: list.length,
          avg,
          pos: list.length
            ? rarPosition({
                internal: avg.internal!,
                industry: avg.industry!,
                comparative: avg.comparative!,
                macro: avg.macro!,
              })
            : null,
          ngx: ngx?.name ?? "No listed proxy",
          stage: ngx?.lifeCycle,
        };
      }),
    [sectors, obligors],
  );

  const defaultSector = useMemo(() => [...sectorRows].sort((a, b) => b.n - a.n)[0]?.id ?? "", [sectorRows]);
  const [picked, setPicked] = useState<string>("");
  const sectorId = picked || defaultSector;
  const current = sectorRows.find((s) => s.id === sectorId);
  const ngx = ngxForSector(sectorId);
  const inSector = useMemo(() => obligors.filter((o) => o.sectorId === sectorId), [obligors, sectorId]);

  const outliers = useMemo<OutlierRow[]>(
    () =>
      inSector.flatMap((o) =>
        ratioBenchmarks(assess(o))
          .filter((b) => b.outlier)
          .map((b) => ({ o, b })),
      ),
    [inSector],
  );

  const sectorColumns: DataTableColumn<SectorRow>[] = [
    {
      id: "name",
      header: "Sector",
      accessor: "name",
      sortable: true,
      cell: (r) => <span className="font-semibold text-fg">{r.name}</span>,
    },
    {
      id: "n",
      header: "Obligors",
      accessor: "n",
      numeric: true,
      sortable: true,
    },
    ...cardinalPoints.map((c) => ({
      id: c.key,
      header: c.direction[0]!,
      csvHeader: `${c.direction} — ${c.label}`,
      accessor: (r: SectorRow) => r.avg[c.key],
      numeric: true,
      sortable: true,
      cell: (r: SectorRow) => (r.n ? r.avg[c.key]!.toFixed(1) : "—"),
    })),
    {
      id: "posture",
      header: "Aggregate posture",
      accessor: (r) => r.pos?.label ?? "",
      cell: (r) => (r.pos ? <PostureBadge position={r.pos} compact /> : <span className="text-fg-muted">No obligors</span>),
    },
    {
      id: "ngx",
      header: "NGX benchmark",
      accessor: "ngx",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <span>{r.ngx}</span>
          {r.stage && <Badge tone={lifeCycleTone[r.stage as keyof typeof lifeCycleTone]}>{r.stage}</Badge>}
        </span>
      ),
    },
  ];

  const outlierColumns: DataTableColumn<OutlierRow>[] = [
    {
      id: "obligor",
      header: "Obligor",
      accessor: (r) => r.o.name,
      sortable: true,
      cell: (r) => <span className="font-semibold text-fg">{r.o.name}</span>,
    },
    {
      id: "ratio",
      header: "Ratio",
      accessor: (r) => r.b.label,
      sortable: true,
    },
    {
      id: "value",
      header: "Obligor value",
      numeric: true,
      accessor: (r) => r.b.value,
      cell: (r) => r.b.format(r.b.value),
    },
    {
      id: "median",
      header: "Sector median",
      numeric: true,
      accessor: (r) => r.b.dist.median,
      cell: (r) => r.b.format(r.b.dist.median),
    },
    {
      id: "pct",
      header: "Percentile",
      numeric: true,
      sortable: true,
      accessor: (r) => r.b.percentile,
      cell: (r) => ordinal(r.b.percentile),
    },
    {
      id: "flag",
      header: "Flag",
      accessor: (r) => r.b.outlier,
      cell: (r) => (
        <Badge tone={r.b.favourable ? "success" : "danger"}>
          {r.b.outlier} · {r.b.favourable ? "strength" : "weakness"}
        </Badge>
      ),
    },
  ];

  return (
    <ModulePage
      module="credit-analysis"
      description="Comparative & peer benchmarking (§6.2.10): sector 360 RAR aggregates from the tenant's own book, NGX corpus ratio distributions, and outlier discussion points."
    >
      <Stack gap="large">
        <div className="flex flex-wrap items-center gap-3">
          <PhaseBadge phase={2} label="Phase 2 — full external-data enrichment" />
          <Text variant="small" tone="muted">
            Designed for Phase 2; runs on demo data in this prototype.
          </Text>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Sector 360 RAR — aggregate of scored obligors</CardTitle>
              <CardDescription>
                360 RAR scores every sector in aggregate: mean cardinal-point averages of the obligors the tenant has scored, mapped to a posture with the same formula.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Sector aggregates"
              columns={sectorColumns}
              data={sectorRows}
              getRowId={(r) => r.id}
              loading={!hydrated}
              onRowClick={(r) => setPicked(r.id)}
              defaultSort={{ id: "n", direction: "desc" }}
              defaultPageSize={15}
              pageSizeOptions={[]}
              density="compact"
              exportFilename="sector-360-rar.csv"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Sector deep-dive</CardTitle>
              <CardDescription>Select a sector (or click a row above) to compare its obligors with each other and with the NGX corpus.</CardDescription>
            </div>
            <Field label="Sector" className="min-w-60">
              <Select value={sectorId} onChange={(e) => setPicked(e.target.value)} options={sectors.map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
          </CardHeader>
          <CardContent>
            <Stack gap="large">
              <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
                <StatCard label="Obligors scored" value={String(current?.n ?? 0)} icon={<Building2 aria-hidden />} />
                <StatCard
                  label="NGX benchmark"
                  value={ngx?.name ?? "None"}
                  icon={<Factory aria-hidden />}
                  hint={sectorMapping[sectorId]?.secondary ? `Secondary: ${ngxById.get(sectorMapping[sectorId]!.secondary!)?.name}` : sectorMapping[sectorId]?.note}
                />
                <StatCard
                  label="Industry life-cycle"
                  value={ngx?.lifeCycle ?? "n/a"}
                  icon={<Layers aria-hidden />}
                  tone={ngx ? lifeCycleTone[ngx.lifeCycle] : "neutral"}
                  hint={ngx?.lifeCycleReason}
                />
                <StatCard label="Ratio outliers" value={String(outliers.length)} icon={<BarChart3 aria-hidden />} tone="warning" hint={`Top/bottom decile or > ${OUTLIER_SD} SD`} />
              </Grid>

              {inSector.length ? (
                <Grid columns={{ base: 1, lg: 2 }} gap="large">
                  <ScatterChart
                    series={[
                      {
                        name: "Rest of book",
                        tone: "neutral",
                        points: obligors.filter((o) => o.sectorId !== sectorId).map((o) => ({ ...xy(o), size: 0.2 })),
                      },
                      {
                        name: current?.name ?? "Sector",
                        tone: "accent",
                        points: inSector.map((o) => ({
                          ...xy(o),
                          size: 1,
                          label: o.name,
                        })),
                      },
                    ]}
                    bubbleRange={[4, 8]}
                    xDomain={[1, 10]}
                    yDomain={[1, 10]}
                    xLabel="X-Composite"
                    yLabel="Y-Composite"
                    referenceLines={[
                      { axis: "x", value: RAR_MIDPOINT },
                      { axis: "y", value: RAR_MIDPOINT },
                    ]}
                    xFormatter={(v) => v.toFixed(1)}
                    yFormatter={(v) => v.toFixed(1)}
                    height={280}
                    label={`Composite positions — ${current?.name}`}
                  />
                  <DataTable
                    label="Obligors in sector"
                    data={inSector}
                    getRowId={(o) => o.id}
                    getRowHref={(o) => assessmentHref(o.id)}
                    linkComponent={Link}
                    defaultPageSize={6}
                    pageSizeOptions={[]}
                    density="compact"
                    columns={[
                      {
                        id: "name",
                        header: "Obligor",
                        accessor: "name",
                        sortable: true,
                        cell: (o) => <span className="font-semibold text-fg">{o.name}</span>,
                      },
                      {
                        id: "type",
                        header: "Size band",
                        accessor: "type",
                        sortable: true,
                      },
                      {
                        id: "posture",
                        header: "Posture",
                        accessor: (o) => rarPosition(o.rar).label,
                        cell: (o) => <PostureBadge position={rarPosition(o.rar)} compact />,
                      },
                    ]}
                  />
                </Grid>
              ) : (
                <EmptyState title="No scored obligors in this sector" description="Sector aggregates appear once the tenant has scored at least one obligor here." />
              )}

              {ngx ? (
                <div>
                  <Text variant="subtitle" as="h3">
                    NGX ratio distribution — {ngx.name}, FY2025
                  </Text>
                  <Text variant="small" tone="muted" className="mb-3">
                    {CORPUS_VERSION} · {ngx.companies} listed companies · mean, median, quartile and decile bands per ratio.
                  </Text>
                  <DataTable
                    label="NGX sector distribution"
                    data={corpusMetrics.map((m) => ({
                      m,
                      d: sectorDistribution(ngx, m.key),
                    }))}
                    getRowId={(r) => r.m.key}
                    paginate={false}
                    density="compact"
                    columns={[
                      {
                        id: "metric",
                        header: "Ratio",
                        accessor: (r) => r.m.label,
                        cell: (r) => <span className="font-semibold text-fg">{r.m.label}</span>,
                      },
                      {
                        id: "mean",
                        header: "Mean",
                        numeric: true,
                        accessor: (r) => r.d.mean,
                        cell: (r) => formatMetric(r.m.key, r.d.mean),
                      },
                      {
                        id: "median",
                        header: "Median",
                        numeric: true,
                        accessor: (r) => r.d.median,
                        cell: (r) => formatMetric(r.m.key, r.d.median),
                      },
                      {
                        id: "q",
                        header: "Q1 – Q3",
                        numeric: true,
                        accessor: (r) => r.d.q1,
                        cell: (r) => `${formatMetric(r.m.key, r.d.q1)} – ${formatMetric(r.m.key, r.d.q3)}`,
                      },
                      {
                        id: "p",
                        header: "P10 – P90",
                        numeric: true,
                        accessor: (r) => r.d.p10,
                        cell: (r) => `${formatMetric(r.m.key, r.d.p10)} – ${formatMetric(r.m.key, r.d.p90)}`,
                      },
                      {
                        id: "dir",
                        header: "Direction",
                        accessor: (r) => (r.m.higherIsBetter ? "Higher is better" : "Lower is better"),
                      },
                    ]}
                  />
                </div>
              ) : null}

              <div>
                <Text variant="subtitle" as="h3">
                  Outlier discussion points
                </Text>
                <Text variant="small" tone="muted" className="mb-3">
                  Ratios flagged automatically for the AI-drafted advisory note — a genuine strength or a structural weakness rather than an in-line reading.
                </Text>
                <DataTable
                  label="Ratio outliers"
                  data={outliers}
                  columns={outlierColumns}
                  getRowId={(r) => `${r.o.id}-${r.b.label}`}
                  getRowHref={(r) => assessmentHref(r.o.id)}
                  linkComponent={Link}
                  defaultPageSize={8}
                  density="compact"
                  emptyState={<EmptyState title="No outliers" description={ngx ? "Every ratio sits inside the sector's P10–P90 band." : "No NGX benchmark for this sector."} />}
                  exportFilename="ratio-outliers.csv"
                />
              </div>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </ModulePage>
  );
}

function xy(o: Obligor) {
  const p = rarPosition(o.rar);
  return { x: p.x, y: p.y };
}
