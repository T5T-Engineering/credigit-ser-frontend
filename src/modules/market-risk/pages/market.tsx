"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  SubmitButton,
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
  SegmentedControl,
  Textarea,
} from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import Link from "next/link";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { dateTime, number, pct } from "@/lib/format";
import { useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { CalcPopover, CalcRegister, DemoNote, sum, type CalcSpec, ms } from "../../ifrs9/common";
import { operationHref } from "../../ifrs9/governance";
import { escalateBreach, raiseBreach, requestBreachClose, roleName, type ActionResult, type BreachInput } from "../actions";
import {
  INTERBANK_QUOTES,
  INTERBANK_SPREAD_TREND,
  MONTHS,
  VAR_TREND,
  desks,
  escalationRoles,
  eveSensitivity,
  fxPositions,
  fxRates,
  interbankSpreadLimit,
  irrbbLadder,
  irrbbShock,
  niiAtRisk,
  nopLimitPct,
  repricingGap,
  utilisationTone,
  type Breach,
  type Desk,
  type FxPosition,
} from "../data";
import { useMarketRisk } from "../store";
import { useMarketBase } from "../use-market";

const breachTones = { Open: "danger", Escalated: "warning", Closed: "success" } as const;

export function MarketRiskPage() {
  const { rows, capital, bs, rules } = useMarketBase();
  const canRaiseBreach = useCan("market-risk.breaches.create");
  const canEscalate = useCan("market-risk.breaches.escalate");
  const canRequestClose = useCan("market-risk.breaches.request-close");
  const canExport = useCan("market-risk.data.export");
  const { actor } = useScope();
  const { toast } = useSaveFeedback();
  const breaches = useMarketRisk((s) => s.breaches);
  const instances = useOperationsStore((s) => s.instances);
  const stopLossWarn = useRule<number>("market-risk.stopLossEarlyWarningPct") / 100;
  const [closing, setClosing] = useState<Breach | null>(null);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<"all" | "mine">("all");

  const { positions, deskList, gap, nopLimit, spreadLimit, shock, ladder, rates, ladderRoles } = useMemo(() => {
    void rules; // recompute when business rules change
    return {
      positions: fxPositions(capital),
      deskList: desks(capital),
      gap: repricingGap(rows, bs),
      nopLimit: nopLimitPct(),
      spreadLimit: interbankSpreadLimit(),
      shock: irrbbShock(),
      ladder: irrbbLadder(),
      rates: fxRates(),
      ladderRoles: escalationRoles(),
    };
  }, [capital, rows, bs, rules]);
  const topRole = ladderRoles[ladderRoles.length - 1];
  const nop = sum(positions.map((p) => p.netNgn));
  const nopPct = (nop / capital) * 100;
  const totalVar = sum(deskList.map((d) => d.varNgn));
  const totalVarLimit = sum(deskList.map((d) => d.limitNgn));
  const spread = Math.max(...INTERBANK_QUOTES.map((q) => q.rate)) - Math.min(...INTERBANK_QUOTES.map((q) => q.rate));

  /** Breaches with an open closure request in Operations. */
  const closeRequests = useMemo(
    () => new Map(instances.filter((i) => i.operationType === "market-risk.breach.close" && ["Pending", "In progress"].includes(i.status)).map((i) => [i.subject.id, i.id])),
    [instances],
  );
  const shownBreaches = scope === "mine" ? breaches.filter((b) => b.levelRole === actor.roleId || b.raisedBy === actor.name) : breaches;

  /** Live limit exceedances not yet logged as an open breach (§6.8 auto-escalation). */
  const share = (v: number) => (v / capital) * 100;
  const detected: BreachInput[] = [
    ...(Math.abs(nopPct) >= nopLimit ? [{ metric: "NOP to capital", desk: "Aggregate", actual: pct(nopPct, 2), limit: `${nopLimit}%`, utilisation: Math.round((Math.abs(nopPct) / nopLimit) * 100) }] : []),
    ...positions
      .filter((p) => Math.abs(share(p.netNgn)) >= p.limitPct)
      .map((p) => ({ metric: `NOP — ${p.ccy}`, desk: "FX trading desk", actual: `${pct(share(p.netNgn), 2)} of capital`, limit: `${p.limitPct}%`, utilisation: Math.round((Math.abs(share(p.netNgn)) / p.limitPct) * 100) })),
    ...deskList
      .filter((d) => d.varNgn >= d.limitNgn)
      .map((d) => ({ metric: "VaR limit utilisation", desk: d.name, actual: pct((d.varNgn / d.limitNgn) * 100, 0), limit: "100%", utilisation: Math.round((d.varNgn / d.limitNgn) * 100) })),
    ...deskList
      .filter((d) => d.mtmLossNgn >= d.stopLossNgn)
      .map((d) => ({ metric: "Stop-loss trigger", desk: d.name, actual: `₦ loss ${Math.round((d.mtmLossNgn / d.stopLossNgn) * 100)}% of trigger`, limit: "100%", utilisation: Math.round((d.mtmLossNgn / d.stopLossNgn) * 100) })),
    ...(spread >= spreadLimit ? [{ metric: "Interbank spread", desk: "Money market", actual: `${spread.toFixed(2)} pp`, limit: `${spreadLimit} pp`, utilisation: Math.round((spread / spreadLimit) * 100) }] : []),
  ].filter((x) => !breaches.some((b) => b.status !== "Closed" && b.metric === x.metric && b.desk === x.desk));

  const report = (res: ActionResult, success: string) => (res.ok ? toast({ title: success, tone: "success" }) : toast({ title: "Not done", description: res.reason, tone: "danger" }));
  const raise = async (d: BreachInput) => report(await raiseBreach(d), "Breach raised and alert recipients notified");
  const escalate = async (b: Breach) => report(await escalateBreach(b), "Breach escalated");
  const close = async () => {
    if (!closing) return;
    const res = await requestBreachClose(closing, note);
    if (res.ok) toast({ title: res.applied ? "Breach closed" : "Closure submitted for approval", description: res.applied ? undefined : `Follow it in Operations (${res.instance.id}).`, tone: "success" });
    else toast({ title: "Not submitted", description: res.reason, tone: "danger" });
    setClosing(null);
    setNote("");
  };

  const BreachActions = ({ b }: { b: Breach }) => {
    const pendingId = closeRequests.get(b.id);
    if (b.status === "Closed")
      return b.closedBy ? (
        <Text variant="caption" tone="muted">
          Closed · {b.closedBy}
        </Text>
      ) : null;
    if (pendingId)
      return (
        <Button as={Link} href={operationHref(pendingId)} size="small" variant="text">
          Closure awaiting approval
        </Button>
      );
    if (!canEscalate && !canRequestClose) return null;
    return (
      <Stack direction="horizontal" gap="xsmall">
        {canEscalate && b.levelRole !== topRole && (
          <Button size="small" variant="secondary" onClick={() => escalate(b)}>
            Escalate
          </Button>
        )}
        {canRequestClose && (
          <Button size="small" variant="tertiary" onClick={() => setClosing(b)}>
            Request close
          </Button>
        )}
      </Stack>
    );
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
      sources: "Positions: Treasury/dealing system; price series: market-data feed",
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
      metric: `NII at Risk (+${shock} bps)`,
      formula: "Σ gap × shock × (12 − bucket midpoint) / 12",
      sources: "Repricing gap × IRRBB shock (Rules & Parameters Engine); NMD behaviour from the model registry",
      value: ms(niiAtRisk(gap, shock)),
      prd: "§6.8.1",
    },
    {
      metric: `EVE (+${shock} bps)`,
      formula: "ΔPV(assets) − ΔPV(liabilities) ≈ −Σ gap × modified duration × shock",
      sources: "Cash-flow schedule (CBA) discounted at the shocked yield curve (market-data feed)",
      value: ms(eveSensitivity(gap, shock)),
      prd: "§6.8.1",
    },
    {
      metric: "Interbank rate spread",
      formula: "Highest interbank rate − lowest interbank rate",
      sources: "Treasury / money-market dealing system feed",
      value: `${spread.toFixed(2)} pp (limit ${spreadLimit} pp)`,
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
            tone={utilisationTone(u)}
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
          tone={utilisationTone(d.varNgn / d.limitNgn)}
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
        return <RagIndicator status={u >= 1 ? "red" : u >= stopLossWarn ? "amber" : "green"} label={`${Math.round(u * 100)}% of trigger`} />;
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
    { id: "level", header: "With", accessor: (b) => roleName(b.levelRole) },
    { id: "status", header: "Status", accessor: "status", cell: (b) => <StatusBadge status={b.status} tones={breachTones} /> },
    { id: "note", header: "Resolution", accessor: (b) => b.note ?? "" },
    {
      id: "act",
      header: "",
      exportable: false,
      cell: (b) => <BreachActions b={b} />,
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
            hint={`Limit ${nopLimit}% (business rule)`}
            tone={utilisationTone(Math.abs(nopPct) / nopLimit)}
          />
          <StatCard label="FCY loans / total" value={pct((bs.fcyLoans / bs.totalLoans) * 100, 1)} hint={`${ms(bs.fcyLoans)} of ${ms(bs.totalLoans)}`} />
          <StatCard
            label="VaR (99%, 1-day)"
            value={ms(totalVar)}
            hint={`${pct((totalVar / totalVarLimit) * 100, 0)} of limit`}
            tone={utilisationTone(totalVar / totalVarLimit)}
          />
          <StatCard label={`NII at risk +${shock} bps`} value={ms(niiAtRisk(gap, shock))} hint="12-month horizon" />
          <StatCard label={`ΔEVE +${shock} bps`} value={ms(eveSensitivity(gap, shock))} hint={pct((eveSensitivity(gap, shock) / capital) * 100, 1) + " of capital"} />
          <StatCard label="Interbank spread" value={`${spread.toFixed(2)} pp`} hint={`Limit ${spreadLimit} pp · highest − lowest quote`} tone={utilisationTone(spread / spreadLimit)} />
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
                series={rates.filter((r) => r.ccy !== "CNY").map((r, i) => ({
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
                      {ladder.map((s) => (
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

        {detected.length > 0 && (
          <Alert tone="danger" title={`${detected.length} limit exceedance${detected.length > 1 ? "s" : ""} not yet in the breach log`}>
            <Stack gap="small">
              {detected.map((d) => (
                <Stack key={`${d.metric}-${d.desk}`} direction="horizontal" justify="between" align="center" gap="small" wrap>
                  <Text variant="small">
                    <span className="font-semibold">{d.metric}</span> · {d.desk}: <span className="font-mono">{d.actual}</span> vs {d.limit}
                  </Text>
                  {canRaiseBreach && (
                    <Button size="small" variant="secondary" onClick={() => raise(d)}>
                      Raise breach
                    </Button>
                  )}
                </Stack>
              ))}
            </Stack>
          </Alert>
        )}

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Limit breaches &amp; escalation</CardTitle>
              <CardDescription>
                Escalated through the protocol: {ladderRoles.map(roleName).join(" → ")}. Closure is approved in Operations. Visible on the CRO Dashboard.
              </CardDescription>
            </Stack>
            <SegmentedControl
              label="Breaches shown"
              size="small"
              value={scope}
              onChange={(v) => setScope(v as "all" | "mine")}
              options={[
                { value: "all", label: "All" },
                { value: "mine", label: "Mine" },
              ]}
            />
          </CardHeader>
          <CardContent>
            <DataTable
              label="Limit breach log"
              columns={breachCols}
              data={shownBreaches}
              getRowId={(b) => b.id}
              filters={[{ id: "status", label: "Status", columnId: "status" }]}
              defaultSort={{ id: "at", direction: "desc" }}
              exportFilename={canExport ? "market-risk-breach-log" : undefined}
              mobileCard={(b) => (
                <Stack gap="xsmall">
                  <Stack direction="horizontal" justify="between" align="center">
                    <Text variant="small" className="font-semibold text-fg">
                      {b.metric}
                    </Text>
                    <StatusBadge status={b.status} tones={breachTones} />
                  </Stack>
                  <Text variant="caption" tone="muted">
                    {b.desk} · {b.actual} vs {b.limit} · with {roleName(b.levelRole)}
                  </Text>
                  <BreachActions b={b} />
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
        title="Request breach closure"
        description={closing ? `${closing.id} · ${closing.metric} · ${closing.desk}` : undefined}
        footer={
          <Stack direction="horizontal" gap="small" justify="end">
            <Button variant="tertiary" onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <SubmitButton onClick={close} disabled={note.trim().length < 5}>
              Submit for approval
            </SubmitButton>
          </Stack>
        }
      >
        <Field label="Resolution note" required description="Closure is approved in Operations (Head of Risk / CRO); the note is recorded in the breach log and the audit trail.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
      </Modal>
    </ModulePage>
  );
}
