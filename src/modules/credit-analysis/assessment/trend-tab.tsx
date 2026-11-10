"use client";

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, DescriptionList, Grid, LineChart, MetricDelta, Stack, Text } from "@credigit/web-ui";
import { REFRESH_LABELS } from "../data";
import { FY_LABELS, momentumOf, momentumTone, type Assessment, type axisHistory, type RatioTrend } from "../logic";
import { cardinalPoints } from "../parameters";

type Props = {
  a: Assessment;
  trends: RatioTrend[];
  history: ReturnType<typeof axisHistory>;
};

type AxisRow = { id: string; label: string; values: number[] };

export function TrendTab({ a, trends, history }: Props) {
  const axisRows: AxisRow[] = [
    ...cardinalPoints.map((c) => ({
      id: c.key,
      label: `${c.direction} · ${c.short}`,
      values: history.map((h) => h.scores[c.key]),
    })),
    { id: "x", label: "X-Composite", values: history.map((h) => h.position.x) },
    { id: "y", label: "Y-Composite", values: history.map((h) => h.position.y) },
  ];
  const lineTones = ["accent", "brand", "info", "warning"] as const;

  return (
    <Stack gap="large">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>360 RAR axis averages over time</CardTitle>
            <CardDescription>Quarterly refreshes; momentum from the trend line’s slope and second-derivative shape (§6.2.11)</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Grid columns={{ base: 1, xl: 2 }} gap="large">
            <LineChart
              series={cardinalPoints.map((c, i) => ({
                name: c.short,
                tone: lineTones[i],
                points: history.map((h) => ({
                  x: h.label,
                  y: h.scores[c.key],
                })),
              }))}
              height={240}
              yFormatter={(v) => v.toFixed(1)}
              showLegend
              label="Cardinal-point averages by refresh"
            />
            <DataTable
              label="Axis momentum"
              data={axisRows}
              getRowId={(r) => r.id}
              paginate={false}
              density="compact"
              columns={[
                { id: "label", header: "Axis", accessor: "label" },
                ...REFRESH_LABELS.slice(-1).map((l, i) => ({
                  id: l,
                  header: l,
                  numeric: true,
                  accessor: (r: AxisRow) => r.values[REFRESH_LABELS.length - 1 + i],
                  cell: (r: AxisRow) => r.values[REFRESH_LABELS.length - 1 + i]!.toFixed(2),
                })),
                {
                  id: "yoy",
                  header: "vs Q4 2025",
                  numeric: true,
                  accessor: (r) => r.values[r.values.length - 1]! - r.values[0]!,
                  cell: (r) => <MetricDelta delta={Math.round((r.values[r.values.length - 1]! - r.values[0]!) * 100) / 100} format={(v: number) => v.toFixed(2)} size="small" />,
                },
                {
                  id: "momentum",
                  header: "Momentum",
                  accessor: (r) => momentumOf(r.values).momentum,
                  cell: (r) => {
                    const m = momentumOf(r.values);
                    return <Badge tone={momentumTone[m.momentum]}>{m.momentum}</Badge>;
                  },
                },
              ]}
            />
          </Grid>
        </CardContent>
      </Card>

      <div>
        <Text variant="subtitle" as="h3">
          Ratio trends vs {a.ngx ? `${a.ngx.name} (NGX corpus)` : "sector — no listed proxy"}
        </Text>
        <Text tone="muted" variant="small">
          Five financial years from the Risk Data Spine (audited statements), with CAGR / annualised change, year-on-year delta, momentum class, relative momentum against the
          sector and AI-detected inflections.
        </Text>
      </div>
      <Grid columns={{ base: 1, md: 2, xl: 3 }} gap="medium">
        {trends.map((t) => (
          <Card key={t.metric}>
            <CardHeader>
              <div>
                <CardTitle>{t.label}</CardTitle>
                <CardDescription>{t.higherIsBetter ? "Higher is better" : "Lower is better"}</CardDescription>
              </div>
              <span className="flex flex-col items-end gap-1">
                <Badge tone={momentumTone[t.momentum.momentum]}>{t.momentum.momentum}</Badge>
                {t.momentum.inflection && (
                  <Badge tone="warning" variant="outline">
                    Inflection
                  </Badge>
                )}
              </span>
            </CardHeader>
            <CardContent>
              <LineChart
                height={150}
                series={[
                  {
                    name: "Obligor",
                    tone: "accent",
                    points: t.obligor.map((y, i) => ({ x: FY_LABELS[i]!, y })),
                  },
                  ...(t.sector
                    ? [
                        {
                          name: "Sector (NGX)",
                          tone: "neutral" as const,
                          points: t.sector.map((y, i) => ({
                            x: FY_LABELS[i]!,
                            y,
                          })),
                        },
                      ]
                    : []),
                ]}
                yFormatter={t.format}
                showLegend
                label={`${t.label} trend, obligor vs sector`}
              />
              <DescriptionList
                className="mt-3"
                columns={2}
                layout="stacked"
                items={[
                  {
                    label: "FY2025",
                    value: t.format(t.obligor[4]!),
                    mono: true,
                  },
                  {
                    label: "YoY",
                    value: <MetricDelta delta={Math.round(t.yoy * 100) / 100} format={(v: number) => t.format(v).replace(/^\+/, "")} invert={!t.higherIsBetter} size="small" />,
                  },
                  {
                    label: t.roc.kind === "CAGR" ? "4-yr CAGR" : "Change / yr",
                    value: `${t.roc.value >= 0 ? "+" : ""}${t.roc.value.toFixed(1)}${t.roc.kind === "CAGR" ? "%" : ""}`,
                    mono: true,
                  },
                  {
                    label: "vs sector",
                    value: t.relative ? (
                      <Badge tone={t.relative === "Gaining ground" ? "success" : t.relative === "Losing ground" ? "danger" : "neutral"}>{t.relative}</Badge>
                    ) : (
                      "—"
                    ),
                    hint: t.sectorRoc ? `Sector ${t.sectorRoc.value >= 0 ? "+" : ""}${t.sectorRoc.value.toFixed(1)}${t.sectorRoc.kind === "CAGR" ? "%" : ""}` : undefined,
                  },
                ]}
              />
            </CardContent>
          </Card>
        ))}
      </Grid>
    </Stack>
  );
}
