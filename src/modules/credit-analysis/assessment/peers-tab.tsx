"use client";

import { useMemo } from "react";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, ProgressBar, Stack, type DataTableColumn } from "@credigit/web-ui";
import type { Obligor } from "@/lib/data/types";
import { CORPUS_VERSION } from "../data";
import { bookPercentile, OUTLIER_SD, type Assessment, type RatioBenchmark } from "../logic";
import { cardinalPoints, type CardinalKey } from "../parameters";

type Props = {
  a: Assessment;
  benchmarks: RatioBenchmark[];
  peers: { scope: string; peers: Obligor[] };
};

type AxisPeerRow = {
  key: CardinalKey;
  label: string;
  value: number;
  median: number;
  q1: number;
  q3: number;
  percentile: number;
};

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function PeersTab({ a, benchmarks, peers }: Props) {
  const axisRows = useMemo<AxisPeerRow[]>(
    () =>
      cardinalPoints.map((c) => {
        const vals = peers.peers.map((o) => o.rar[c.key]).sort((x, y) => x - y);
        return {
          key: c.key,
          label: `${c.direction} · ${c.label}`,
          value: a.scores[c.key],
          median: quantile(vals, 0.5),
          q1: quantile(vals, 0.25),
          q3: quantile(vals, 0.75),
          percentile: bookPercentile(vals, a.scores[c.key]),
        };
      }),
    [a.scores, peers],
  );

  const ratioColumns: DataTableColumn<RatioBenchmark>[] = [
    {
      id: "label",
      header: "Ratio",
      accessor: "label",
      cell: (r) => <span className="font-semibold text-fg">{r.label}</span>,
    },
    {
      id: "value",
      header: "Obligor",
      numeric: true,
      accessor: "value",
      cell: (r) => r.format(r.value),
    },
    {
      id: "mean",
      header: "Sector avg",
      numeric: true,
      accessor: (r) => r.dist.mean,
      cell: (r) => r.format(r.dist.mean),
    },
    {
      id: "median",
      header: "Median",
      numeric: true,
      accessor: (r) => r.dist.median,
      cell: (r) => r.format(r.dist.median),
    },
    {
      id: "iqr",
      header: "Quartiles (Q1–Q3)",
      numeric: true,
      accessor: (r) => r.dist.q1,
      cell: (r) => `${r.format(r.dist.q1)} – ${r.format(r.dist.q3)}`,
    },
    {
      id: "dec",
      header: "P10–P90",
      numeric: true,
      accessor: (r) => r.dist.p10,
      cell: (r) => `${r.format(r.dist.p10)} – ${r.format(r.dist.p90)}`,
    },
    {
      id: "percentile",
      header: "Percentile",
      accessor: "percentile",
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-32 flex-col gap-1">
          <span className="font-mono text-sm font-semibold">
            {ordinal(r.percentile)} <span className="font-sans text-xs font-normal text-fg-muted">{r.higherIsBetter ? "" : "· lower is better"}</span>
          </span>
          <ProgressBar
            value={r.higherIsBetter ? r.percentile / 100 : 1 - r.percentile / 100}
            tone={r.favourable ? "success" : "warning"}
            size="small"
            ariaLabel={`${r.label} percentile ${r.percentile}`}
          />
        </span>
      ),
    },
    {
      id: "flag",
      header: "Discussion point",
      accessor: (r) => r.outlier ?? "",
      cell: (r) =>
        r.outlier ? (
          <Badge tone={r.favourable ? "success" : "danger"}>
            {r.outlier} · {r.favourable ? "strength" : "weakness"}
          </Badge>
        ) : (
          <span className="text-sm text-fg-muted">In line</span>
        ),
    },
  ];

  return (
    <Stack gap="large">
      {a.ngx ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Per-ratio benchmarking — {a.ngx.name}</CardTitle>
              <CardDescription>
                FY2025 sector distribution from the NGX Historical Sector Financials Corpus ({CORPUS_VERSION}, {a.ngx.companies} listed companies). Outliers: top/bottom decile or
                more than {OUTLIER_SD} SD from the mean (tenant parameter).
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Ratio benchmarks"
              columns={ratioColumns}
              data={benchmarks}
              getRowId={(r) => r.label}
              paginate={false}
              density="compact"
              exportFilename={`${a.obligor.id}-peer-benchmarks.csv`}
            />
          </CardContent>
        </Card>
      ) : (
        <Alert tone="info" title="No NGX-listed proxy for this sector">
          Per-ratio benchmarking needs an NGX sector classification. This obligor’s sector has none mapped, so the comparison relies on the tenant’s own book (below) and analyst
          research notes.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Composite peer positioning — tenant book</CardTitle>
            <CardDescription>
              Axis averages benchmarked against {peers.peers.length} other scored obligors · scope: {peers.scope.toLowerCase()} (§6.2.10)
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            label="Axis peer positioning"
            data={axisRows}
            getRowId={(r) => r.key}
            paginate={false}
            density="compact"
            columns={[
              { id: "label", header: "Cardinal point", accessor: "label" },
              {
                id: "value",
                header: "Obligor",
                numeric: true,
                accessor: "value",
                cell: (r) => r.value.toFixed(1),
              },
              {
                id: "median",
                header: "Peer median",
                numeric: true,
                accessor: "median",
                cell: (r) => r.median.toFixed(1),
              },
              {
                id: "iqr",
                header: "Peer Q1–Q3",
                numeric: true,
                accessor: "q1",
                cell: (r) => `${r.q1.toFixed(1)} – ${r.q3.toFixed(1)}`,
              },
              {
                id: "pct",
                header: "Percentile in book",
                accessor: "percentile",
                cell: (r) => (
                  <span className="flex min-w-32 flex-col gap-1">
                    <span className="font-mono text-sm font-semibold">{ordinal(r.percentile)}</span>
                    <ProgressBar value={r.percentile / 100} tone={r.percentile >= 50 ? "success" : "warning"} size="small" ariaLabel={`${r.label} percentile ${r.percentile}`} />
                  </span>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </Stack>
  );
}

export function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${s}`;
}
