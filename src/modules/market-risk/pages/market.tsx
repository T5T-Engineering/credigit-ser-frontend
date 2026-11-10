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
  type DataTableColumn,
  Field,
  Grid,
  LineChart,
  Modal,
  ProgressBar,
  RagIndicator,
  Sparkline,
  Stack,
  StackedBarChart,
  StatCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { dateTime, number, pct } from "@/lib/format";
import { CalcPopover, CalcRegister, DemoNote, sum, useAuditLog, type CalcSpec, ms } from "../../ifrs9/common";
import {
  ESCALATION,
  FX_RATES,
  INTERBANK_QUOTES,
  INTERBANK_SPREAD_TREND,
  MONTHS,
  NOP_LIMIT_PCT,
  VAR_TREND,
  desks,
  eveSensitivity,
  fxPositions,
  niiAtRisk,
  repricingGap,
  type Breach,
  type Desk,
  type FxPosition,
} from "../data";
import { useMarketRisk } from "../store";
import { useMarketBase } from "../use-market";

const breachTones = { Open: "danger", Escalated: "warning", Closed: "success" } as const;

export function MarketRiskPage() {
  const { rows, capital, bs } = useMarketBase();
  const canEdit = useCan("market-risk", "edit");
  const audit = useAuditLog();
  const breaches = useMarketRisk((s) => s.breaches);
  const setBreach = useMarketRisk((s) => s.setBreach);
  const [closing, setClosing] = useState<Breach | null>(null);
  const [note, setNote] = useState("");

  const positions = useMemo(() => fxPositions(capital), [capital]);
  const deskList = useMemo(() => desks(capital), [capital]);
  const gap = useMemo(() => repricingGap(rows, bs), [rows, bs]);
  const nop = sum(positions.map((p) => p.netNgn));
  const nopPct = (nop / capital) * 100;
  const totalVar = sum(deskList.map((d) => d.varNgn));
  const totalVarLimit = sum(deskList.map((d) => d.limitNgn));
  const spread = Math.max(...INTERBANK_QUOTES.map((q) => q.rate)) - Math.min(...INTERBANK_QUOTES.map((q) => q.rate));
  const shocks = [-200, -100, 100, 200];

  const escalate = (b: Breach) => {
    const next = ESCALATION[Math.min(ESCALATION.length - 1, ESCALATION.indexOf(b.level) + 1)]!;
    setBreach(b.id, { level: next, status: "Escalated" });
    audit("Escalated market-risk limit breach (§6.4.4)", "LimitBreach", b.id, `${b.status} · ${b.level}`, `Escalated · ${next}`);
  };
  const close = () => {
    if (!closing) return;
    setBreach(closing.id, { status: "Closed", note });
    audit("Closed market-risk limit breach", "LimitBreach", closing.id, closing.status, `Closed: ${note}`);
    setClosing(null);
    setNote("");
  };

  const specs: CalcSpec[] = [
    {
      metric: "NOP to Capital",
      formula: "Net Open Position / Total Capital",
      sources: "NOP: Treasury/FX sub-ledger (long − short) via CBA/Treasury connector; Total Capital: GL capital accounts",
      value: pct(nopPct, 2),
      prd: "§6.8.1",
    },
    {
      metric: "FCY loans to total loans",
      formula: "Naira value of FCY-denominated loans / Total loans",
      sources: "CBA facility ledger, FCY revalued at the configured spot-rate feed",
      value: pct((bs.fcyLoans / bs.totalLoans) * 100, 2),
      prd: "§6.8.1",
    },
    {
      metric: "VaR (99%, 1-day)",
      formula: "Historical simulation / parametric / Monte Carlo (tenant-configurable)",
      sources: "Positions: Treasury/dealing system; price series: market-data feed (§5.5)",
      value: ms(totalVar),
      prd: "§6.8.1",
    },
    {
      metric: "VaR limit utilisation",
      formula: "Actual VaR / Board-approved VaR limit × 100",
      sources: "VaR limit: Rules & Parameters Engine per Market Risk Policy Manual",
      value: pct((totalVar / totalVarLimit) * 100, 1),
      prd: "§6.8.1",
    },
    {
      metric: "Stop-loss trigger status",
      formula: "Cumulative MTM loss vs configured stop-loss trigger",
      sources: "MTM P&L: Treasury/dealing system revalued daily",
      prd: "§6.8.1",
    },
    {
      metric: "Repricing gap",
      formula: "Rate-sensitive assets − rate-sensitive liabilities, per bucket",
      sources: "CBA asset and liability ledgers tagged by next-repricing date",
      prd: "§6.8.1",
    },
    {
      metric: "NII at Risk (+200 bps)",
      formula: "Σ gap × shock × (12 − bucket midpoint) / 12",
      sources: "Repricing gap × IRRBB shock (Rules & Parameters Engine); NMD behaviour from the model registry",
      value: ms(niiAtRisk(gap, 200)),
      prd: "§6.8.1",
    },
    {
      metric: "EVE (+200 bps)",
      formula: "ΔPV(assets) − ΔPV(liabilities) ≈ −Σ gap × modified duration × shock",
      sources: "Cash-flow schedule (CBA) discounted at the shocked yield curve (market-data feed)",
      value: ms(eveSensitivity(gap, 200)),
      prd: "§6.8.1",
    },
    {
      metric: "Interbank rate spread",
      formula: "Highest interbank rate − lowest interbank rate",
      sources: "Treasury / money-market dealing system feed",
      value: `${spread.toFixed(2)} pp`,
      prd: "§6.8.1",
    },
  ];

  const posCols: DataTableColumn<FxPosition>[] = [
    { id: "ccy", header: "Currency", accessor: "ccy", cell: (p) => <span className="font-mono font-semibold text-fg">{p.ccy}</span> },
    { id: "spot", header: "Spot (₦)", accessor: "spot", numeric: true, cell: (p) => number(p.spot) },
    { id: "long", header: "Long (FCY)", accessor: "longFcy", numeric: true, cell: (p) => ms(p.longFcy).replace("₦", "") },
    { id: "short", header: "Short (FCY)", accessor: "shortFcy", numeric: true, cell: (p) => ms(p.shortFcy).replace("₦", "") },
    { id: "net", header: "Net (₦)", accessor: "netNgn", numeric: true, cell: (p) => ms(p.netNgn) },
    { id: "pct", header: "% capital", accessor: (p) => (p.netNgn / capital) * 100, numeric: true, cell: (p) => pct((p.netNgn / capital) * 100, 2) },
    {
      id: "util",
      header: "Limit use",
      accessor: (p) => Math.abs((p.netNgn / capital) * 100) / p.limitPct,
      cell: (p) => {
        const u = Math.abs((p.netNgn / capital) * 100) / p.limitPct;
        return (
          <ProgressBar
            value={Math.min(1, u)}
            tone={u >= 1 ? "danger" : u >= 0.8 ? "warning" : "success"}
            ariaLabel={`${p.ccy} use of ${p.limitPct}% limit`}
            showValue
            size="small"
          />
        );
      },
      width: "10rem",
    },
  ];

  const deskCols: DataTableColumn<Desk>[] = [
    { id: "name", header: "Desk / portfolio", accessor: "name", cell: (d) => <span className="font-semibold text-fg">{d.name}</span> },
    { id: "method", header: "Method", accessor: "method" },
    { id: "var", header: "VaR", accessor: "varNgn", numeric: true, cell: (d) => ms(d.varNgn) },
    { id: "limit", header: "Limit", accessor: "limitNgn", numeric: true, cell: (d) => ms(d.limitNgn) },
    {
      id: "util",
      header: "Utilisation",
      accessor: (d) => d.varNgn / d.limitNgn,
      cell: (d) => (
        <ProgressBar
          value={Math.min(1, d.varNgn / d.limitNgn)}
          tone={d.varNgn >= d.limitNgn ? "danger" : d.varNgn / d.limitNgn >= 0.8 ? "warning" : "success"}
          ariaLabel={`${d.name} VaR use of limit`}
          showValue
          size="small"
        />
      ),
      width: "10rem",
    },
    {
      id: "stop",
      header: "Stop-loss",
      accessor: (d) => d.mtmLossNgn / d.stopLossNgn,
      cell: (d) => {
        const u = d.mtmLossNgn / d.stopLossNgn;
        return <RagIndicator status={u >= 1 ? "red" : u >= 0.6 ? "amber" : "green"} label={`${Math.round(u * 100)}% of trigger`} />;
      },
    },
  ];

  const breachCols: DataTableColumn<Breach>[] = [
    { id: "at", header: "Raised", accessor: "at", cell: (b) => dateTime(b.at) },
    { id: "metric", header: "Metric", accessor: "metric", cell: (b) => <span className="font-semibold text-fg">{b.metric}</span> },
    { id: "desk", header: "Desk", accessor: "desk" },
    {
      id: "actual",
      header: "Actual vs limit",
      accessor: "actual",
      cell: (b) => (
        <span className="font-mono text-sm">
          {b.actual} / {b.limit}
        </span>
      ),
    },
    { id: "level", header: "With", accessor: "level" },
    { id: "status", header: "Status", accessor: "status", cell: (b) => <StatusBadge status={b.status} tones={breachTones} /> },
    { id: "note", header: "Resolution", accessor: (b) => b.note ?? "" },
    {
      id: "act",
      header: "",
      exportable: false,
      cell: (b) =>
        canEdit && b.status !== "Closed" ? (
          <Stack direction="horizontal" gap="xsmall">
            {b.level !== "Board Risk Committee" && (
              <Button size="small" variant="secondary" onClick={() => escalate(b)}>
                Escalate
              </Button>
            )}
            <Button size="small" variant="tertiary" onClick={() => setClosing(b)}>
              Close
            </Button>
          </Stack>
        ) : null,
    },
  ];

  return (
    <ModulePage module="market-risk" description="Net open position, FX, VaR, interest-rate sensitivity and limit breaches for the Treasury book.">
      <Stack gap="large">
        <DemoNote title="Simulated Treasury feed">
          Positions, VaR, market rates and limits are demo values standing in for the Treasury/dealing system and market-data connectors; loan-book figures come from the shared
          facility ledger. Limits are tenant parameters (Rules &amp; Parameters Engine).
        </DemoNote>

        <Grid columns={{ base: 2, lg: 3 }} gap="medium">
          <StatCard
            label="NOP / capital"
            value={pct(nopPct, 2)}
            hint={`Limit ${NOP_LIMIT_PCT}% (tenant, demo)`}
            tone={nopPct >= NOP_LIMIT_PCT ? "danger" : nopPct >= NOP_LIMIT_PCT * 0.8 ? "warning" : "success"}
          />
          <StatCard label="FCY loans / total" value={pct((bs.fcyLoans / bs.totalLoans) * 100, 1)} hint={`${ms(bs.fcyLoans)} of ${ms(bs.totalLoans)}`} />
          <StatCard
            label="VaR (99%, 1-day)"
            value={ms(totalVar)}
            hint={`${pct((totalVar / totalVarLimit) * 100, 0)} of limit`}
            tone={totalVar / totalVarLimit >= 0.9 ? "warning" : "neutral"}
          />
          <StatCard label="NII at risk +200 bps" value={ms(niiAtRisk(gap, 200))} hint="12-month horizon" />
          <StatCard label="ΔEVE +200 bps" value={ms(eveSensitivity(gap, 200))} hint={pct((eveSensitivity(gap, 200) / capital) * 100, 1) + " of capital"} />
          <StatCard label="Interbank spread" value={`${spread.toFixed(2)} pp`} hint="Highest − lowest quote" />
        </Grid>

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-7">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Net open position by currency</CardTitle>
                <CardDescription>
                  Long minus short FX positions; aggregate NOP {ms(nop)} = {pct(nopPct, 2)} of total capital ({ms(capital)}).
                </CardDescription>
              </Stack>
              <CalcPopover spec={specs[0]!} />
            </CardHeader>
            <CardContent>
              <DataTable
                label="NOP by currency"
                columns={posCols}
                data={positions}
                getRowId={(p) => p.ccy}
                paginate={false}
                mobileCard={(p) => (
                  <Stack direction="horizontal" justify="between" align="center">
                    <Text variant="small" className="font-mono font-semibold text-fg">
                      {p.ccy} @ ₦{number(p.spot)}
                    </Text>
                    <Text variant="small" className="font-mono">
                      {ms(p.netNgn)} · {pct((p.netNgn / capital) * 100, 2)} (limit {p.limitPct}%)
                    </Text>
                  </Stack>
                )}
              />
            </CardContent>
          </Card>
          <Card variant="outlined" className="lg:col-span-5">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>FX rates — 12 months</CardTitle>
                <CardDescription>Naira per unit, from the Rules &amp; Parameters Engine spot-rate feed.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <LineChart
                label="FX rate trend"
                height={240}
                yFormatter={(v) => `₦${number(v)}`}
                series={FX_RATES.filter((r) => r.ccy !== "CNY").map((r, i) => ({
                  name: `${r.ccy}/NGN`,
                  tone: (["accent", "brand", "info"] as const)[i],
                  points: r.history.map((y, k) => ({ x: MONTHS[k]!, y })),
                }))}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-8">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Value-at-Risk and stop-loss by desk</CardTitle>
                <CardDescription>99% confidence, 1-day holding period (configurable defaults).</CardDescription>
              </Stack>
              <CalcPopover spec={specs[3]!} />
            </CardHeader>
            <CardContent>
              <DataTable
                label="VaR by desk"
                columns={deskCols}
                data={deskList}
                getRowId={(d) => d.id}
                paginate={false}
                mobileCard={(d) => (
                  <Stack gap="xsmall">
                    <Text variant="small" className="font-semibold text-fg">
                      {d.name}
                    </Text>
                    <Text variant="caption" tone="muted">
                      VaR {ms(d.varNgn)} of {ms(d.limitNgn)} limit · stop-loss {Math.round((d.mtmLossNgn / d.stopLossNgn) * 100)}% of trigger
                    </Text>
                    <ProgressBar value={Math.min(1, d.varNgn / d.limitNgn)} tone={d.varNgn >= d.limitNgn ? "danger" : "success"} ariaLabel={`${d.name} VaR use of limit`} size="small" />
                  </Stack>
                )}
              />
            </CardContent>
          </Card>
          <Card variant="outlined" className="lg:col-span-4">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Total VaR utilisation</CardTitle>
                <CardDescription>Last 20 business days, % of aggregate limit.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <LineChart
                label="VaR utilisation trend"
                height={220}
                yFormatter={(v) => `${v}%`}
                series={[
                  { name: "Utilisation", tone: "accent", points: VAR_TREND.map((y, i) => ({ x: `D${i + 1}`, y })) },
                  { name: "Limit", tone: "danger", points: VAR_TREND.map((_, i) => ({ x: `D${i + 1}`, y: 100 })) },
                ]}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-8">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Interest-rate repricing gap</CardTitle>
                <CardDescription>Rate-sensitive assets vs liabilities by next-repricing bucket (overdrafts and revolving credit reprice within 1 month).</CardDescription>
              </Stack>
              <CalcPopover spec={specs[5]!} />
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <StackedBarChart
                  label="Repricing gap"
                  mode="grouped"
                  categories={gap.map((g) => g.bucket)}
                  series={[
                    { name: "Rate-sensitive assets", values: gap.map((g) => g.rsa), tone: "brand" },
                    { name: "Rate-sensitive liabilities", values: gap.map((g) => g.rsl), tone: "accent" },
                  ]}
                  valueFormatter={(v) => ms(v)}
                  height={240}
                />
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Bucket</TableHeaderCell>
                        {gap.map((g) => (
                          <TableHeaderCell key={g.bucket} numeric>
                            {g.bucket}
                          </TableHeaderCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow>
                        <TableCell>Gap</TableCell>
                        {gap.map((g) => (
                          <TableCell key={g.bucket} numeric>
                            {ms(g.gap)}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell>Cumulative</TableCell>
                        {gap.map((g) => (
                          <TableCell key={g.bucket} numeric>
                            {ms(g.cumulative)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>
            </CardContent>
          </Card>
          <Card variant="outlined" className="lg:col-span-4">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>IRRBB sensitivity</CardTitle>
                <CardDescription>Standardised parallel shocks.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Shock</TableHeaderCell>
                        <TableHeaderCell numeric>ΔNII (12m)</TableHeaderCell>
                        <TableHeaderCell numeric>ΔEVE</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {shocks.map((s) => (
                        <TableRow key={s}>
                          <TableCell className="font-mono">{s > 0 ? `+${s}` : s} bps</TableCell>
                          <TableCell numeric>{ms(niiAtRisk(gap, s))}</TableCell>
                          <TableCell numeric>{ms(eveSensitivity(gap, s))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Stack gap="small">
                  <Stack direction="horizontal" justify="between" align="center">
                    <Text variant="small" className="font-semibold text-fg">
                      Interbank quotes today
                    </Text>
                    <Text variant="small" className="font-mono">
                      spread {spread.toFixed(2)} pp
                    </Text>
                  </Stack>
                  {INTERBANK_QUOTES.map((q) => (
                    <Stack key={q.counterparty} direction="horizontal" justify="between">
                      <Text variant="small">{q.counterparty}</Text>
                      <Text variant="small" className="font-mono">
                        {q.rate.toFixed(2)}%
                      </Text>
                    </Stack>
                  ))}
                  <Sparkline values={INTERBANK_SPREAD_TREND} tone="accent" height={40} />
                  <Text variant="caption" tone="muted">
                    Spread trend, last 10 business days. Counterparties anonymised in the demo.
                  </Text>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Limit breaches &amp; escalation</CardTitle>
              <CardDescription>
                Escalated through the §6.4.4 protocol: Market Risk Analyst → Head of Risk → CRO → Board Risk Committee. Visible on the CRO Dashboard (§6.11).
              </CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Limit breach log"
              columns={breachCols}
              data={breaches}
              getRowId={(b) => b.id}
              filters={[{ id: "status", label: "Status", columnId: "status" }]}
              defaultSort={{ id: "at", direction: "desc" }}
              exportFilename="market-risk-breach-log"
              mobileCard={(b) => (
                <Stack gap="xsmall">
                  <Stack direction="horizontal" justify="between" align="center">
                    <Text variant="small" className="font-semibold text-fg">
                      {b.metric}
                    </Text>
                    <StatusBadge status={b.status} tones={breachTones} />
                  </Stack>
                  <Text variant="caption" tone="muted">
                    {b.desk} · {b.actual} vs {b.limit} · with {b.level}
                  </Text>
                  {canEdit && b.status !== "Closed" && (
                    <Stack direction="horizontal" gap="xsmall">
                      <Button size="small" variant="secondary" onClick={() => escalate(b)}>
                        Escalate
                      </Button>
                      <Button size="small" variant="tertiary" onClick={() => setClosing(b)}>
                        Close
                      </Button>
                    </Stack>
                  )}
                </Stack>
              )}
            />
          </CardContent>
        </Card>

        <CalcRegister specs={specs} />
      </Stack>

      <Modal
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        title="Close limit breach"
        description={closing ? `${closing.id} · ${closing.metric} · ${closing.desk}` : undefined}
        footer={
          <Stack direction="horizontal" gap="small" justify="end">
            <Button variant="tertiary" onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <Button onClick={close} disabled={note.trim().length < 5}>
              Close breach
            </Button>
          </Stack>
        }
      >
        <Field label="Resolution note" required description="Recorded in the breach log and the audit trail.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
      </Modal>
    </ModulePage>
  );
}
