"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, CircleDashed, Radar, ShieldAlert, TimerReset } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  Grid,
  ScatterChart,
  Stack,
  StatCard,
  Text,
  type DataTableColumn,
  type ScatterSeries,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useLookups, useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { useHydrated } from "@/lib/auth/session";
import { rarPosition, RAR_MIDPOINT, type RarPosition } from "@/lib/rar";
import type { Obligor } from "@/lib/data/types";
import { date } from "@/lib/format";
import { ageDays, copBandFor, copRatio, STALE_AFTER_DAYS } from "../logic";
import { assessmentHref, PostureBadge, postureOrder, score1 } from "../shared";

type Row = {
  o: Obligor;
  sector: string;
  pos: RarPosition;
  postureKey: string;
  cop: number;
  copBand: string;
  copTone: "success" | "warning" | "danger";
  age: number;
  stale: boolean;
};

const postureSeriesTone = {
  Aggressive: "success",
  Competitive: "info",
  Conservative: "warning",
  Defensive: "danger",
} as const;

export function AssessmentsPage() {
  const hydrated = useHydrated();
  const obligors = useObligors();
  const { sector } = useLookups();

  const rows = useMemo<Row[]>(
    () =>
      obligors.map((o) => {
        const pos = rarPosition(o.rar);
        const cop = copRatio(o);
        const band = copBandFor(cop);
        const age = ageDays(o.rarUpdatedAt, DEMO_NOW);
        return {
          o,
          sector: sector.get(o.sectorId)?.name ?? o.sectorId,
          pos,
          postureKey: pos.neutral ? "Neutral / Transitional" : pos.base,
          cop,
          copBand: band.band,
          copTone: band.tone,
          age,
          stale: age > STALE_AFTER_DAYS,
        };
      }),
    [obligors, sector],
  );

  const counts = useMemo(() => {
    const by = (k: string) => rows.filter((r) => r.postureKey === k).length;
    return {
      defensive: by("Defensive"),
      neutral: by("Neutral / Transitional"),
      marginal: rows.filter((r) => r.pos.intensity === "Marginally").length,
      stale: rows.filter((r) => r.stale).length,
      lowCop: rows.filter((r) => r.copBand === "Low Confidence").length,
    };
  }, [rows]);

  const scatter = useMemo<ScatterSeries[]>(() => {
    const series: ScatterSeries[] = postureOrder.map((p) => ({
      name: p,
      tone: postureSeriesTone[p],
      points: rows.filter((r) => r.postureKey === p).map((r) => ({ x: r.pos.x, y: r.pos.y, label: r.o.name })),
    }));
    series.push({
      name: "Neutral / Transitional",
      tone: "neutral",
      points: rows.filter((r) => r.pos.neutral).map((r) => ({ x: r.pos.x, y: r.pos.y, label: r.o.name })),
    });
    return series;
  }, [rows]);

  const columns: DataTableColumn<Row>[] = [
    {
      id: "name",
      header: "Obligor",
      accessor: (r) => r.o.name,
      sortable: true,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-semibold text-fg">{r.o.name}</span>
          <span className="font-mono text-xs text-fg-muted">
            {r.o.id} · {r.o.type}
          </span>
        </span>
      ),
    },
    {
      id: "sector",
      header: "Sector",
      accessor: (r) => r.sector,
      sortable: true,
    },
    {
      id: "internal",
      header: "N",
      csvHeader: "North — Internal Risk",
      accessor: (r) => r.o.rar.internal,
      numeric: true,
      sortable: true,
      cell: (r) => score1(r.o.rar.internal),
      searchable: false,
    },
    {
      id: "comparative",
      header: "E",
      csvHeader: "East — Comparative",
      accessor: (r) => r.o.rar.comparative,
      numeric: true,
      sortable: true,
      cell: (r) => score1(r.o.rar.comparative),
      searchable: false,
    },
    {
      id: "industry",
      header: "S",
      csvHeader: "South — Operating Industry",
      accessor: (r) => r.o.rar.industry,
      numeric: true,
      sortable: true,
      cell: (r) => score1(r.o.rar.industry),
      searchable: false,
    },
    {
      id: "macro",
      header: "W",
      csvHeader: "West — Macro-Economic",
      accessor: (r) => r.o.rar.macro,
      numeric: true,
      sortable: true,
      cell: (r) => score1(r.o.rar.macro),
      searchable: false,
    },
    {
      id: "x",
      header: "X",
      accessor: (r) => r.pos.x,
      numeric: true,
      sortable: true,
      cell: (r) => r.pos.x.toFixed(2),
      searchable: false,
    },
    {
      id: "y",
      header: "Y",
      accessor: (r) => r.pos.y,
      numeric: true,
      sortable: true,
      cell: (r) => r.pos.y.toFixed(2),
      searchable: false,
    },
    {
      id: "posture",
      header: "Posture",
      accessor: (r) => r.postureKey,
      sortValue: (r) => r.pos.magnitude,
      sortable: true,
      csv: (r) => r.pos.label,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <PostureBadge position={r.pos} compact />
          {!r.pos.neutral && <span className="text-xs text-fg-muted">{r.pos.lead}</span>}
        </span>
      ),
    },
    {
      id: "confidence",
      header: "Confidence",
      accessor: (r) => r.copBand,
      sortValue: (r) => r.cop,
      sortable: true,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={r.copTone}>{r.copBand.replace(" Confidence", "")}</Badge>
          <span className="font-mono text-xs text-fg-muted">COP {r.cop.toFixed(2)}</span>
        </span>
      ),
    },
    {
      id: "refreshed",
      header: "Last refreshed",
      accessor: (r) => r.o.rarUpdatedAt,
      sortValue: (r) => -r.age,
      sortable: true,
      searchable: false,
      csv: (r) => r.o.rarUpdatedAt,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <span className="font-mono text-sm">{date(r.o.rarUpdatedAt)}</span>
          {r.stale ? <Badge tone="warning">Stale · {r.age}d</Badge> : <span className="text-xs text-fg-muted">{r.age}d ago</span>}
        </span>
      ),
    },
    {
      id: "freshness",
      header: "Freshness",
      accessor: (r) => (r.stale ? "Stale" : "Current"),
      hidden: true,
    },
    {
      id: "intensity",
      header: "Intensity",
      accessor: (r) => (r.pos.neutral ? "Neutral" : r.pos.intensity!),
      hidden: true,
    },
  ];

  return (
    <ModulePage
      module="credit-analysis"
      description="360° Risk Assessment Radar — every obligor scored on four cardinal points (North Internal Risk, East Comparative, South Operating Industry, West Macro-Economic), plotted on the composite position chart and classified into one of 13 posture states."
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="Obligors assessed" value={String(rows.length)} icon={<Radar aria-hidden />} hint={`${counts.marginal} in a Marginal (provisional) band`} />
          <StatCard
            label="Defensive — CRO referral"
            value={String(counts.defensive)}
            icon={<ShieldAlert aria-hidden />}
            tone="danger"
            hint="Mandatory CRO referral regardless of size (§6.2.6)"
          />
          <StatCard label="Neutral / Transitional" value={String(counts.neutral)} icon={<CircleDashed aria-hidden />} tone="neutral" hint="Mandatory Credit Analyst narrative" />
          <StatCard
            label="Stale assessments"
            value={String(counts.stale)}
            icon={<TimerReset aria-hidden />}
            tone="warning"
            hint={`Older than ${STALE_AFTER_DAYS} days (tenant parameter) · ${counts.lowCop} low-confidence COP`}
          />
        </Grid>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Portfolio composite positions</CardTitle>
              <CardDescription>
                X-Composite (Operating Industry + Comparative) against Y-Composite (Internal Risk + Macro-Economic); quadrants split at the {RAR_MIDPOINT} midpoint.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Grid columns={{ base: 1, lg: 12 }} gap="large">
              <div className="lg:col-span-9">
                <ScatterChart
                  series={scatter}
                  xDomain={[1, 10]}
                  yDomain={[1, 10]}
                  xLabel="X-Composite — external & comparative position"
                  yLabel="Y-Composite — internal & macro stability"
                  referenceLines={[
                    { axis: "x", value: RAR_MIDPOINT, label: "X 5.5" },
                    { axis: "y", value: RAR_MIDPOINT, label: "Y 5.5" },
                  ]}
                  height={320}
                  xFormatter={(v) => v.toFixed(1)}
                  yFormatter={(v) => v.toFixed(1)}
                  label="Composite positions of all assessed obligors"
                />
              </div>
              <div className="lg:col-span-3">
                <Grid columns={2} gap="small">
                  {[
                    { p: "Conservative", where: "X < 5.5 · Y > 5.5" },
                    { p: "Aggressive", where: "X > 5.5 · Y > 5.5" },
                    { p: "Defensive", where: "X < 5.5 · Y < 5.5" },
                    { p: "Competitive", where: "X > 5.5 · Y < 5.5" },
                  ].map((q) => (
                    <div key={q.p} className="squircle rounded-3xl bg-surface-sunken p-3">
                      <Badge tone={postureSeriesTone[q.p as keyof typeof postureSeriesTone]} dot>
                        {q.p}
                      </Badge>
                      <p className="mt-2 font-mono text-2xl font-semibold text-fg">{rows.filter((r) => r.postureKey === q.p).length}</p>
                      <p className="font-mono text-xs text-fg-muted">{q.where}</p>
                    </div>
                  ))}
                </Grid>
                <Text variant="small" tone="muted" className="mt-3">
                  {counts.neutral} obligor
                  {counts.neutral === 1 ? " sits" : "s sit"} inside the Neutral / Transitional radius around (5.5, 5.5). Intensity bands and the neutral threshold are tenant
                  parameters (demo defaults).
                </Text>
              </div>
            </Grid>
          </CardContent>
        </Card>

        <DataTable
          label="360 RAR assessments"
          columns={columns}
          data={rows}
          getRowId={(r) => r.o.id}
          getRowHref={(r) => assessmentHref(r.o.id)}
          linkComponent={Link}
          loading={!hydrated}
          searchable
          searchPlaceholder="Search obligor, ID or sector"
          defaultSort={{ id: "refreshed", direction: "asc" }}
          filters={[
            {
              id: "posture",
              label: "Posture",
              options: [...postureOrder, "Neutral / Transitional"].map((p) => ({
                value: p,
                label: p,
              })),
            },
            {
              id: "intensity",
              label: "Intensity",
              options: ["Strongly", "Moderately", "Marginally", "Neutral"].map((p) => ({ value: p, label: p })),
            },
            { id: "sector", label: "Sector" },
            {
              id: "freshness",
              label: "Freshness",
              options: [
                { value: "Current", label: "Current" },
                { value: "Stale", label: `Stale (>${STALE_AFTER_DAYS}d)` },
              ],
            },
            { id: "confidence", label: "Confidence" },
          ]}
          exportFilename="360-rar-assessments.csv"
          caption="N = North Internal Risk · E = East Comparative · S = South Operating Industry · W = West Macro-Economic (1–10, 10 strongest). X = (S + E) ÷ 2, Y = (N + W) ÷ 2."
          emptyState={<EmptyState icon={<AlertTriangle aria-hidden />} title="No assessments match" description="Clear a filter or search term to see more obligors." />}
          mobileCard={(r) => (
            <span className="flex flex-col gap-2">
              <span className="font-semibold text-fg">{r.o.name}</span>
              <span className="font-mono text-xs text-fg-muted">
                N {score1(r.o.rar.internal)} · E {score1(r.o.rar.comparative)} · S {score1(r.o.rar.industry)} · W {score1(r.o.rar.macro)} · X {r.pos.x.toFixed(2)} · Y{" "}
                {r.pos.y.toFixed(2)}
              </span>
              <span className="flex flex-wrap gap-2">
                <PostureBadge position={r.pos} />
                {r.stale && <Badge tone="warning">Stale</Badge>}
              </span>
            </span>
          )}
        />
      </Stack>
    </ModulePage>
  );
}
