"use client";

import { useMemo, useState } from "react";
import { Database, FileStack, History, ShieldCheck } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Field,
  Grid,
  KeyValueGrid,
  LineChart,
  PhaseBadge,
  Select,
  Stack,
  StatCard,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useSectors } from "@/lib/data/hooks";
import { date } from "@/lib/format";
import {
  CORPUS_REFRESHED,
  CORPUS_VERSION,
  corpusMetrics,
  formatMetric,
  lifeCycleTone,
  macroSnapshot,
  ngxById,
  ngxSectors,
  sectorMapping,
  type CorpusYear,
  type NgxSector,
} from "../data";

export function SectorCorpusPage() {
  const sectors = useSectors();
  const [selected, setSelected] = useState(ngxSectors[0]!.id);
  const s = ngxById.get(selected)!;

  const mappedTo = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const sec of sectors) {
      const map = sectorMapping[sec.id];
      if (map?.primary) m.set(map.primary, [...(m.get(map.primary) ?? []), sec.name]);
    }
    return m;
  }, [sectors]);

  const sectorColumns: DataTableColumn<NgxSector>[] = [
    {
      id: "name",
      header: "NGX sector",
      accessor: "name",
      sortable: true,
      cell: (r) => <span className="font-semibold text-fg">{r.name}</span>,
    },
    {
      id: "companies",
      header: "Listed cos.",
      accessor: "companies",
      numeric: true,
      sortable: true,
    },
    {
      id: "cagr",
      header: "Real rev. CAGR (5y)",
      accessor: "trailingCagr",
      numeric: true,
      sortable: true,
      cell: (r) => `${r.trailingCagr.toFixed(1)}%`,
    },
    {
      id: "margin",
      header: "Net-margin trend",
      accessor: "marginTrend",
      numeric: true,
      sortable: true,
      cell: (r) => `${r.marginTrend >= 0 ? "+" : ""}${r.marginTrend.toFixed(2)} pp/yr`,
    },
    {
      id: "stage",
      header: "Life-cycle stage",
      accessor: "lifeCycle",
      sortable: true,
      cell: (r) => <Badge tone={lifeCycleTone[r.lifeCycle]}>{r.lifeCycle}</Badge>,
    },
    {
      id: "tenant",
      header: "Tenant sectors mapped",
      accessor: (r) => (mappedTo.get(r.id) ?? []).join(", "),
      cell: (r) => <span className="text-sm text-fg-muted">{(mappedTo.get(r.id) ?? []).join(", ") || "—"}</span>,
    },
  ];

  const yearColumns: DataTableColumn<CorpusYear>[] = [
    {
      id: "year",
      header: "FY",
      accessor: "year",
      sortable: true,
      cell: (y) => <span className="font-mono font-semibold">FY{y.year}</span>,
    },
    ...corpusMetrics.map((m) => ({
      id: m.key,
      header: m.label,
      numeric: true,
      accessor: (y: CorpusYear) => y[m.key],
      cell: (y: CorpusYear) => formatMetric(m.key, y[m.key]),
    })),
  ];

  const pts = (k: keyof CorpusYear) => s.series.map((y) => ({ x: String(y.year).slice(2), y: y[k] as number }));

  return (
    <ModulePage
      module="credit-analysis"
      description="NGX Historical Sector Financials Corpus (§6.2.8): 10–15 years of listed-company audited financials per sector — the benchmark behind Internal Risk and Operating Industry scoring."
    >
      <Stack gap="large">
        <div className="flex flex-wrap items-center gap-3">
          <PhaseBadge phase={2} label="Phase 2 — forward-looking sector projections" />
          <Text variant="small" tone="muted">
            Corpus-backed benchmarking is designed for Phase 2; runs on a demo corpus in this prototype.
          </Text>
        </div>
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard
            label="Corpus version"
            value={CORPUS_VERSION.replace("NGX-SFC ", "")}
            icon={<Database aria-hidden />}
            hint={`NGX-SFC · refreshed ${date(CORPUS_REFRESHED)} · at least annually`}
          />
          <StatCard
            label="NGX sectors"
            value={String(ngxSectors.length)}
            icon={<FileStack aria-hidden />}
            hint={`${ngxSectors.reduce((a, x) => a + x.companies, 0)} listed companies`}
          />
          <StatCard label="Years per sector" value="15" icon={<History aria-hidden />} hint="FY2011 – FY2025" />
          <StatCard label="Governance" value="Versioned" icon={<ShieldCheck aria-hidden />} tone="success" hint="Disclosed in every AI-drafted credit memo" />
        </Grid>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Sector classifications & Industry Life-Cycle</CardTitle>
              <CardDescription>
                AI trend engine (simulated): Introduction / Growth / Maturity / Decline from the trailing real revenue CAGR and net-margin trend shape. Click a sector to open its
                time series.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              label="NGX sectors"
              columns={sectorColumns}
              data={ngxSectors}
              getRowId={(r) => r.id}
              onRowClick={(r) => setSelected(r.id)}
              paginate={false}
              density="compact"
              exportFilename="ngx-sectors.csv"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{s.name} — 15-year time series</CardTitle>
              <CardDescription>
                {s.companies} listed companies · OCR/XBRL-parsed annual reports from the NGX disclosure portal and investor-relations filings · {s.lifeCycleReason}
              </CardDescription>
            </div>
            <Field label="NGX sector" className="min-w-56">
              <Select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                options={ngxSectors.map((x) => ({
                  value: x.id,
                  label: x.name,
                }))}
              />
            </Field>
          </CardHeader>
          <CardContent>
            <Stack gap="large">
              <Grid columns={{ base: 1, lg: 3 }} gap="large">
                <div>
                  <Text variant="eyebrow" as="p">
                    Real revenue growth
                  </Text>
                  <LineChart
                    height={180}
                    series={[
                      {
                        name: "Real revenue growth",
                        tone: "accent",
                        points: pts("realRevenueGrowth"),
                      },
                    ]}
                    yFormatter={(v) => `${v.toFixed(0)}%`}
                    label={`${s.name} real revenue growth`}
                  />
                </div>
                <div>
                  <Text variant="eyebrow" as="p">
                    Margins
                  </Text>
                  <LineChart
                    height={180}
                    showLegend
                    series={[
                      {
                        name: "Gross margin",
                        tone: "brand",
                        points: pts("grossMargin"),
                      },
                      {
                        name: "Net margin",
                        tone: "accent",
                        points: pts("netMargin"),
                      },
                    ]}
                    yFormatter={(v) => `${v.toFixed(0)}%`}
                    label={`${s.name} margins`}
                  />
                </div>
                <div>
                  <Text variant="eyebrow" as="p">
                    Leverage & returns
                  </Text>
                  <LineChart
                    height={180}
                    showLegend
                    series={[
                      {
                        name: "Debt / assets",
                        tone: "warning",
                        points: pts("debtToAssets"),
                      },
                      { name: "ROA", tone: "success", points: pts("roa") },
                    ]}
                    yFormatter={(v) => `${v.toFixed(0)}%`}
                    label={`${s.name} leverage and ROA`}
                  />
                </div>
              </Grid>
              <DataTable
                label={`${s.name} corpus`}
                columns={yearColumns}
                data={[...s.series].reverse()}
                getRowId={(y) => String(y.year)}
                defaultPageSize={5}
                density="compact"
                exportFilename={`${s.id}-corpus.csv`}
              />
            </Stack>
          </CardContent>
        </Card>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Tenant sector → NGX mapping</CardTitle>
                <CardDescription>
                  Every tenant sector code (CBN-aligned taxonomy, §6.6.1) carries its nearest NGX classification(s) so the right benchmark is selected.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                label="Sector mapping"
                data={sectors}
                getRowId={(x) => x.id}
                paginate={false}
                density="compact"
                columns={[
                  {
                    id: "tenant",
                    header: "Tenant sector",
                    accessor: "name",
                    cell: (x) => <span className="font-semibold text-fg">{x.name}</span>,
                  },
                  {
                    id: "primary",
                    header: "Primary NGX",
                    accessor: (x) => ngxById.get(sectorMapping[x.id]?.primary ?? "")?.name ?? "No listed proxy",
                  },
                  {
                    id: "secondary",
                    header: "Secondary",
                    accessor: (x) => ngxById.get(sectorMapping[x.id]?.secondary ?? "")?.name ?? "—",
                  },
                  {
                    id: "note",
                    header: "Note",
                    accessor: (x) => sectorMapping[x.id]?.note ?? "",
                    cell: (x) => <span className="text-xs text-fg-muted">{sectorMapping[x.id]?.note ?? ""}</span>,
                  },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Macro-economic backdrop</CardTitle>
                <CardDescription>
                  Comparative/contextual analysis sets each obligor’s trend against its sector and the wider economy · {macroSnapshot.source}, as at {date(macroSnapshot.asAt)}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <KeyValueGrid
                columns={2}
                items={macroSnapshot.indicators.map((i) => ({
                  label: i.label,
                  value: i.value,
                  hint: i.trend,
                }))}
              />
              <Text variant="small" tone="muted" className="mt-4">
                The corpus is a benchmarking and training dataset, not a substitute for the obligor’s own audited financials. It is refreshed at least annually by the in-house
                data/research analyst, version-controlled, and its use in any credit decision is disclosed in the AI-drafted credit memo.
              </Text>
            </CardContent>
          </Card>
        </Grid>
      </Stack>
    </ModulePage>
  );
}
