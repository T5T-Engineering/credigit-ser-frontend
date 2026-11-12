"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DescriptionList,
  DonutChart,
  Gauge,
  Grid,
  LineChart,
  MiniBarList,
  ProgressBar,
  RagIndicator,
  SegmentedControl,
  Stack,
  StackedBarChart,
  StatCard,
  Text,
  useToast,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { pct } from "@/lib/format";
import { CalcPopover, CalcRegister, DemoNote, sum, type CalcSpec, ms } from "../../ifrs9/common";
import { raiseBreach, rasValues } from "../actions";
import {
  LIQUID_ASSETS,
  concentrationCutoffs,
  earlyWarnings,
  fundingMix,
  lcrFloor,
  ldrMin,
  liquidityRatioMin,
  maturityLadder,
  nsfrFloor,
  ratioWarningMargin,
  topDepositors,
  type EarlyWarning,
} from "../data";
import { useMarketRisk } from "../store";
import { useMarketBase } from "../use-market";

export function LiquidityPage() {
  const { bs, liq, rules } = useMarketBase();
  const canEdit = useCan("market-risk", "edit");
  const { toast } = useToast();
  const breaches = useMarketRisk((s) => s.breaches);
  const p = useMemo(() => {
    void rules; // recompute when business rules change
    return {
      cutoffs: concentrationCutoffs(),
      ew: earlyWarnings(),
      mix: fundingMix(),
      lrMin: liquidityRatioMin(),
      lcr: lcrFloor(),
      nsfr: nsfrFloor(),
      ldr: ldrMin(),
      margin: ratioWarningMargin(),
      top20: rasValues().top20!,
    };
  }, [rules]);
  const [cutoff, setCutoff] = useState("10");
  const ladder = useMemo(() => maturityLadder(bs, liq.liquid), [bs, liq.liquid]);
  const depositors = useMemo(() => topDepositors(bs), [bs]);
  const concentration = p.cutoffs.map((n) => ({ n, balance: sum(depositors.slice(0, n).map((d) => d.balance)) }));
  const shown = depositors.slice(0, Number(cutoff));
  const top20Share = (sum(depositors.slice(0, 20).map((d) => d.balance)) / bs.deposits) * 100;
  const ewLogged = (e: EarlyWarning) => breaches.some((b) => b.status !== "Closed" && b.metric === `Early warning — ${e.trigger}`);
  const raiseEw = async (e: EarlyWarning) => {
    const res = await raiseBreach(
      { metric: `Early warning — ${e.trigger}`, desk: "Treasury / ALM", actual: `${e.current} ${e.unit}`, limit: e.threshold, utilisation: Math.round((e.current / e.limit) * 100) },
      "early-warning",
      e,
    );
    toast(res.ok ? { title: "Early warning raised and escalated", tone: "success" } : { title: "Not raised", description: res.reason, tone: "danger" });
  };

  const specs: CalcSpec[] = [
    {
      metric: "Liquidity ratio (CBN)",
      formula: "Liquid assets / deposit liabilities",
      sources: "Liquid assets: CBA treasury/GL balances per CBN 3.13(a) admissible list; deposits: CBA deposit ledger",
      value: pct(liq.liquidityRatio, 1),
      prd: "§6.8.2",
    },
    {
      metric: "LCR",
      formula: "HQLA / total net cash outflows over 30 days (stressed)",
      sources: "HQLA per tenant Basel III taxonomy; outflows from deposit/facility maturity schedule under configured run-off and draw rates",
      value: pct(liq.lcr, 0),
      prd: "§6.8.2",
    },
    {
      metric: "NSFR",
      formula: "Available stable funding / required stable funding",
      sources: "ASF: deposit/capital ledger × Basel III ASF factors; RSF: asset ledger × RSF factors",
      value: pct(liq.nsfr, 0),
      prd: "§6.8.2",
    },
    {
      metric: "Loan-to-deposit ratio",
      formula: "(Total loans + 150% weighting uplift on qualifying SME/retail/mortgage/consumer lending) / total deposits",
      sources: `CBA facility book (SME/retail/mortgage flag from Origination) / CBA deposit ledger; minimum ${p.ldr}% (business rule)`,
      value: pct(liq.ldrWeighted, 1),
      prd: "§6.8.2, §9.1",
    },
    {
      metric: "Maturity gap",
      formula: "(Maturing assets − maturing liabilities) per bucket, cumulative",
      sources: "Contractual (and behavioural) maturity schedules, tenor ladder from the Liquidity Risk TOM",
      prd: "§6.8.2",
    },
    {
      metric: "Depositor concentration",
      formula: `Top-N depositors' balance / total deposits × 100 (N = ${p.cutoffs.join("/")})`,
      sources: "CBA deposit ledger ranked by balance",
      value: concentration[1] ? `${pct((concentration[1].balance / bs.deposits) * 100, 1)} (top ${concentration[1].n})` : "—",
      prd: "§6.8.2",
    },
    {
      metric: "Funding mix",
      formula: "Balance by funding-source category / total deposits",
      sources: "CBA deposit ledger tagged by source type at account opening",
      prd: "§6.8.2",
    },
  ];

  const ratioCards = [
    {
      label: "Liquidity ratio",
      value: liq.liquidityRatio,
      floor: p.lrMin,
      floorLabel: `Minimum ${p.lrMin}% — business rule`,
      max: 80,
      spec: specs[0]!,
    },
    { label: "LCR", value: liq.lcr, floor: p.lcr, floorLabel: `Floor ${p.lcr}%`, max: 300, spec: specs[1]! },
    { label: "NSFR", value: liq.nsfr, floor: p.nsfr, floorLabel: `Floor ${p.nsfr}%`, max: 200, spec: specs[2]! },
    { label: "LDR (weighted)", value: liq.ldrWeighted, floor: p.ldr, floorLabel: `CBN minimum ${p.ldr}% · gross ${pct(liq.ldrGross, 1)}`, max: 120, spec: specs[3]! },
  ];

  return (
    <ModulePage module="market-risk" title="Liquidity risk" description="Regulatory liquidity ratios, maturity ladder, depositor concentration and funding mix (ILAAP inputs).">
      <Stack gap="large">
        <DemoNote title="Simulated deposit and treasury ledgers">
          Loan balances come from the shared facility ledger; deposits, liquid assets, run-off rates and ASF/RSF factors are demo values standing in for the CBA deposit ledger and
          the tenant&apos;s Basel III taxonomy.
        </DemoNote>

        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          {ratioCards.map((c) => (
            <Card key={c.label} variant="outlined" padding="small">
              <Stack gap="small" align="center">
                <Gauge
                  label={c.label}
                  value={c.value}
                  min={0}
                  max={c.max}
                  valueFormatter={(v) => pct(v, 0)}
                  bands={[
                    { to: c.floor, tone: "danger" },
                    { to: c.floor * (1 + p.margin), tone: "warning" },
                    { to: c.max, tone: "success" },
                  ]}
                />
                <Text variant="caption" tone="muted" align="center">
                  {c.floorLabel}
                </Text>
                <CalcPopover spec={c.spec} />
              </Stack>
            </Card>
          ))}
        </Grid>

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-8">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Maturity ladder</CardTitle>
                <CardDescription>Contractual maturing assets vs liabilities (incl. capital) per tenor bucket.</CardDescription>
              </Stack>
              <CalcPopover spec={specs[4]!} />
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <StackedBarChart
                  label="Maturity ladder"
                  mode="grouped"
                  categories={ladder.map((l) => l.bucket)}
                  series={[
                    { name: "Maturing assets", values: ladder.map((l) => l.assets), tone: "brand" },
                    { name: "Maturing liabilities", values: ladder.map((l) => l.liabilities), tone: "accent" },
                  ]}
                  valueFormatter={(v) => ms(v)}
                  height={240}
                />
                <LineChart
                  label="Cumulative liquidity gap"
                  height={180}
                  yFormatter={(v) => ms(v)}
                  series={[{ name: "Cumulative gap", tone: "info", points: ladder.map((l) => ({ x: l.bucket, y: l.cumulative })) }]}
                />
              </Stack>
            </CardContent>
          </Card>
          <Card variant="outlined" className="lg:col-span-4">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Liquid assets</CardTitle>
                <CardDescription>CBN 3.13(a) admissible list.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <DescriptionList
                  columns={1}
                  layout="inline"
                  items={[
                    ...LIQUID_ASSETS.map((a) => ({ label: a.label, value: ms((a.pctOfDeposits / 100) * bs.deposits), mono: true, hint: a.hqla })),
                    { label: "Total liquid assets", value: ms(liq.liquid), mono: true },
                    { label: "Deposit liabilities", value: ms(bs.deposits), mono: true },
                    { label: "HQLA (Level 1)", value: ms(liq.hqla), mono: true },
                    { label: "Net cash outflows (30d)", value: ms(liq.netOutflows), mono: true },
                  ]}
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Depositor concentration</CardTitle>
              <CardDescription>
                Share of total deposits held by the top-N depositors (cut-offs are a business rule). Top 20: {pct(top20Share, 1)} vs RAS early warning {p.top20.earlyWarning}% / limit{" "}
                {p.top20.buffer}%.
              </CardDescription>
            </Stack>
            <CalcPopover spec={specs[5]!} />
          </CardHeader>
          <CardContent>
            <Stack gap="large">
              <Grid columns={{ base: 2, sm: 3, lg: 6 }} gap="small">
                {concentration.map((c) => (
                  <Card key={c.n} variant="filled" padding="small">
                    <Stack gap="xsmall">
                      <Text variant="eyebrow">Top {c.n}</Text>
                      <Text variant="subtitle" className="font-mono">
                        {pct((c.balance / bs.deposits) * 100, 1)}
                      </Text>
                      <ProgressBar
                        value={c.balance / bs.deposits}
                        tone={c.n <= 20 && (c.balance / bs.deposits) * 100 > p.top20.earlyWarning ? "warning" : "brand"}
                        ariaLabel={`Top ${c.n} share of deposits`}
                        size="small"
                      />
                    </Stack>
                  </Card>
                ))}
              </Grid>
              <SegmentedControl
                label="Depositor list size"
                size="small"
                value={cutoff}
                onChange={setCutoff}
                options={p.cutoffs.map((v) => ({ value: String(v), label: `Top ${v}` }))}
              />
              {Number(cutoff) <= 10 ? (
                <MiniBarList
                  label={`Top ${cutoff} depositors`}
                  items={shown.map((d) => ({ label: d.name, value: d.balance, meta: d.segment }))}
                  valueFormatter={(v) => ms(v)}
                  tone="brand"
                />
              ) : (
                <DataTable
                  label={`Top ${cutoff} depositors`}
                  data={shown}
                  getRowId={(d) => String(d.rank)}
                  defaultPageSize={10}
                  pageSizeOptions={[]}
                  searchable
                  exportFilename={`top-${cutoff}-depositors`}
                  columns={[
                    { id: "rank", header: "#", accessor: "rank", numeric: true, width: "3rem" },
                    { id: "name", header: "Depositor", accessor: "name", searchable: true },
                    { id: "segment", header: "Segment", accessor: "segment" },
                    { id: "bal", header: "Balance", accessor: "balance", numeric: true, cell: (d) => ms(d.balance) },
                    { id: "share", header: "% deposits", accessor: (d) => d.balance / bs.deposits, numeric: true, cell: (d) => pct((d.balance / bs.deposits) * 100, 2) },
                  ]}
                />
              )}
              <Text variant="caption" tone="muted">
                Depositor names are fictional demo data.
              </Text>
            </Stack>
          </CardContent>
        </Card>
        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Funding mix by source</CardTitle>
                <CardDescription>Share of total deposits ({ms(bs.deposits)}).</CardDescription>
              </Stack>
              <CalcPopover spec={specs[6]!} />
            </CardHeader>
            <CardContent>
              <DonutChart
                label="Funding mix"
                segments={p.mix.map((f, i) => ({ label: f.label, value: f.pct, tone: (["brand", "accent", "info", "warning"] as const)[i] }))}
                centerLabel="Deposits"
                centerValue={ms(bs.deposits)}
                valueFormatter={(v) => `${v}%`}
              />
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Illiquidity early-warning triggers</CardTitle>
                <CardDescription>CBN 3.13(c) — thresholds are business rules; raising an indicator escalates it via and notifies the alert recipients.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                {p.ew.map((e) => (
                  <Stack key={e.id} gap="xsmall">
                    <Stack direction="horizontal" justify="between" align="start" gap="small">
                      <Text variant="small" className="font-semibold text-fg">
                        {e.trigger}
                      </Text>
                      <RagIndicator status={e.status} label={e.status === "green" ? "Clear" : e.status === "amber" ? "Watch" : "Triggered"} />
                    </Stack>
                    <Stack direction="horizontal" justify="between" align="center" gap="small" wrap>
                      <Text variant="caption" tone="muted">
                        Trigger: {e.threshold} · current: {e.current} {e.unit}
                      </Text>
                      {canEdit && e.status !== "green" && !ewLogged(e) && (
                        <Button size="small" variant="secondary" onClick={() => raiseEw(e)}>
                          Raise &amp; escalate
                        </Button>
                      )}
                      {ewLogged(e) && (
                        <Text variant="caption" tone="muted">
                          In breach log
                        </Text>
                      )}
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid columns={{ base: 1, sm: 3 }} gap="medium">
          <StatCard label="Total deposits" value={ms(bs.deposits)} hint={`FCY ${ms(bs.fcyDeposits)}`} />
          <StatCard label="Total loans" value={ms(bs.totalLoans)} hint={`Qualifying SME/retail/mortgage ${ms(bs.qualifyingLoans)}`} />
          <StatCard label="Undrawn commitments" value={ms(bs.undrawn)} hint="Drawdown-surge exposure (stress input)" />
        </Grid>

        <CalcRegister specs={specs} />
      </Stack>
    </ModulePage>
  );
}
