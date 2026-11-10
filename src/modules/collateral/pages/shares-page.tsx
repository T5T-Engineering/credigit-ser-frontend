"use client";

import { useMemo } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  Grid,
  MetricDelta,
  PhaseBadge,
  Sparkline,
  Stack,
  StatCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  TextLink,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import { useLookups } from "@/lib/data/hooks";
import { date, dateTime, money, moneyShort, number, pct } from "@/lib/format";
import { useActor, useAuditLog } from "@/modules/monitoring/audit";
import { useMonitoring } from "@/modules/monitoring/store";
import { corporateActions, lienTones } from "../data";
import { collateralAbilities, priceSeries, referencePrices } from "../logic";
import { useCollateralStore, useCollateralView, useSharePrices, type CollateralView } from "../store";

type Row = CollateralView & { obligorName: string; shortfall: number; topUp: number; callId?: string };

export function SharesPage() {
  const view = useCollateralView();
  const { obligor } = useLookups();
  const { prices, asOf } = useSharePrices();
  const role = useRole();
  const can = collateralAbilities(role?.id);
  const store = useCollateralStore();
  const raise = useMonitoring((s) => s.raise);
  const exceptions = useMonitoring((s) => s.exceptions);
  const audit = useAuditLog();
  const actor = useActor();
  const canAct = can.manage || can.verify;

  const rows: Row[] = useMemo(
    () =>
      view
        .filter((c) => c.type === "Quoted shares")
        .map((c) => {
          const shortfall = c.exposure > 0 ? Math.max(0, c.exposure - c.adjusted) : 0;
          const call = store.marginCalls[c.id];
          const open = call && exceptions.find((e) => e.id === call.exceptionId && e.status !== "Resolved");
          return { ...c, obligorName: obligor.get(c.obligorId)?.name ?? c.obligorId, shortfall, topUp: Math.round(shortfall / (1 - c.haircutPct / 100)), callId: open ? call.exceptionId : undefined };
        }),
    [view, obligor, store.marginCalls, exceptions],
  );

  const tickers = Object.keys(referencePrices).filter((t) => rows.some((r) => r.ticker === t));
  const mtm = rows.reduce((a, r) => a + (r.mtm ?? 0), 0);
  const adjusted = rows.reduce((a, r) => a + r.adjusted, 0);
  const exposure = rows.reduce((a, r) => a + r.exposure, 0);
  const short = rows.filter((r) => r.shortfall > 0);

  const refresh = () => {
    const next: Record<string, number> = {};
    for (const [t, r] of Object.entries(referencePrices)) {
      const cur = prices[t] ?? r.price;
      const shock = (Math.random() - 0.5) * 2 * r.vol * 1.5;
      next[t] = Math.round(cur * (1 + shock) * 100) / 100;
    }
    store.setPrices(next);
    audit({ action: "Refreshed share prices (simulated CSCS feed)", entityType: "Connector", entityId: "CON-CSCS", after: `${Object.keys(next).length} counters` });
  };
  const resetPrices = () => {
    store.setPrices({});
    audit({ action: "Reset simulated share prices to reference close", entityType: "Connector", entityId: "CON-CSCS" });
  };

  const marginCall = (r: Row) => {
    const ex = raise({
      type: "Share-collateral margin shortfall",
      title: `Margin call — ${r.ticker}`,
      detail: `${r.obligorName}: haircut-adjusted MTM of ${r.ticker} (${money(r.adjusted)}) covers ${pct(r.cover * 100, 0)} of the ${money(r.exposure)} exposure. Top-up of ${money(r.topUp)} market value required.`,
      obligorId: r.obligorId,
      facilityId: r.facilityIds[0],
      collateralId: r.id,
      amount: r.shortfall,
      source: "Rule",
      by: actor.name,
    });
    store.recordMarginCall(r.id, { by: actor.name, exceptionId: ex.id, topUp: r.topUp });
    audit({ action: "Raised margin call / top-up request", entityType: "Collateral", entityId: r.id, after: `${ex.id} · top-up ${moneyShort(r.topUp)}` });
  };

  const columns: DataTableColumn<Row>[] = [
    { id: "id", header: "Collateral", accessor: "id", sortable: true, cell: (r) => <TextLink as={Link} href={`/collateral/item?id=${r.id}`}>{r.id}</TextLink> },
    { id: "obligor", header: "Pledgor", accessor: "obligorName", sortable: true, cell: (r) => <span className="font-medium text-fg">{r.obligorName}</span> },
    { id: "ticker", header: "Ticker", accessor: "ticker", sortable: true, cell: (r) => <span className="font-mono">{r.ticker}</span> },
    { id: "units", header: "Units", accessor: "units", numeric: true, sortable: true, cell: (r) => number(r.units ?? 0) },
    { id: "mtm", header: "MTM", accessor: "mtm", numeric: true, sortable: true, cell: (r) => moneyShort(r.mtm ?? 0) },
    { id: "adjusted", header: "After 20% haircut", accessor: "adjusted", numeric: true, sortable: true, cell: (r) => moneyShort(r.adjusted) },
    { id: "exposure", header: "Exposure", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
    {
      id: "cover",
      header: "Cover",
      accessor: "cover",
      numeric: true,
      sortable: true,
      cell: (r) => (r.exposure > 0 ? <span className={r.cover < 1 ? "font-mono text-danger-strong" : "font-mono"}>{pct(r.cover * 100, 0)}</span> : "—"),
    },
    { id: "lien", header: "Lien (CSCS)", accessor: "lien", sortable: true, cell: (r) => <StatusBadge status={r.lien ?? "—"} tones={lienTones} /> },
    {
      id: "call",
      header: "Margin",
      accessor: (r) => (r.shortfall > 0 ? "Shortfall" : "Covered"),
      sortable: true,
      cell: (r) =>
        r.shortfall <= 0 ? (
          <StatusBadge status="Covered" tones={{ Covered: "success" }} />
        ) : r.callId ? (
          <Stack gap="none">
            <StatusBadge status="Call raised" tones={{ "Call raised": "warning" }} />
            <TextLink as={Link} href="/monitoring/exceptions">
              {r.callId}
            </TextLink>
          </Stack>
        ) : canAct ? (
          <Button size="small" variant="danger" onClick={() => marginCall(r)}>
            Margin call · {moneyShort(r.topUp)}
          </Button>
        ) : (
          <StatusBadge status={`Top-up ${moneyShort(r.topUp)}`} tones={{ [`Top-up ${moneyShort(r.topUp)}`]: "danger" }} />
        ),
    },
  ];

  return (
    <ModulePage
      module="collateral"
      description="Share-backed exposure valued on a live, independently sourced mark-to-market — not a value frozen at the pledge date (PRD §5.7)."
      actions={
        canAct ? (
          <Stack direction="horizontal" gap="small">
            <Button variant="tertiary" onClick={resetPrices}>
              Reset prices
            </Button>
            <Button variant="secondary" iconBefore={<RefreshCw aria-hidden className="size-4" />} onClick={refresh}>
              Refresh prices
            </Button>
          </Stack>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Alert tone="info" title={
            <>
              SEC / CSCS connector <PhaseBadge phase={2} className="ml-2 align-middle" />
            </>
          }>
          Phase 1: manual / periodic upload of CSCS share-statement and valuation evidence on the collateral record. Phase 2: automated CSCS/SEC feed with scheduled mark-to-market refresh. Prices
          below are <strong>simulated demo values, not market data</strong> — last close {dateTime(asOf)}.
        </Alert>
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Share-backed collateral" value={number(rows.length)} hint={`${tickers.length} counters`} />
          <StatCard label="Mark-to-market" value={moneyShort(mtm)} hint={`${moneyShort(adjusted)} after 20% haircut (PRD §6.7.3)`} />
          <StatCard label="Exposure secured" value={moneyShort(exposure)} hint={`Cover ${pct((adjusted / Math.max(1, exposure)) * 100, 0)}`} tone={adjusted >= exposure ? "success" : "warning"} />
          <StatCard label="Margin shortfalls" value={number(short.length)} hint={`${moneyShort(short.reduce((a, r) => a + r.topUp, 0))} top-up required`} tone="danger" />
        </Grid>

        <Grid columns={{ base: 1, lg: 3 }} gap="medium">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Holdings by ticker</CardTitle>
                <CardDescription>Simulated NGX closing prices and 30-trading-day trend.</CardDescription>
              </div>
            </CardHeader>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Ticker</TableHeaderCell>
                  <TableHeaderCell numeric>Price</TableHeaderCell>
                  <TableHeaderCell numeric>30d</TableHeaderCell>
                  <TableHeaderCell>Trend</TableHeaderCell>
                  <TableHeaderCell numeric>Units pledged</TableHeaderCell>
                  <TableHeaderCell numeric>MTM</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tickers.map((t) => {
                  const s = priceSeries(t);
                  const first = s[0]?.price ?? 1;
                  const now = prices[t]!;
                  const held = rows.filter((r) => r.ticker === t);
                  const change = ((now - first) / first) * 100;
                  return (
                    <TableRow key={t}>
                      <TableCell>
                        <Stack gap="none">
                          <span className="font-mono text-fg">{t}</span>
                          <Text variant="caption" tone="subtle">
                            {referencePrices[t]!.name} · {referencePrices[t]!.sector}
                          </Text>
                        </Stack>
                      </TableCell>
                      <TableCell numeric>₦{now.toFixed(2)}</TableCell>
                      <TableCell numeric>
                        <MetricDelta delta={change} size="small" format={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                      </TableCell>
                      <TableCell>
                        <div className="w-24">
                          <Sparkline values={[...s.slice(0, -1).map((p) => p.price), now]} tone={change < 0 ? "danger" : "success"} height={28} />
                        </div>
                      </TableCell>
                      <TableCell numeric>{number(held.reduce((a, r) => a + (r.units ?? 0), 0))}</TableCell>
                      <TableCell numeric>{moneyShort(held.reduce((a, r) => a + (r.mtm ?? 0), 0))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>SEC / exchange disclosures</CardTitle>
                <CardDescription>Corporate actions and regulatory status (simulated feed).</CardDescription>
              </div>
            </CardHeader>
            <Stack gap="medium">
              {corporateActions
                .filter((a) => tickers.includes(a.ticker))
                .map((a) => (
                  <Stack key={a.ticker + a.kind} gap="none">
                    <Stack direction="horizontal" gap="small" align="center">
                      <span className="font-mono text-fg">{a.ticker}</span>
                      <StatusBadge status={a.kind} tones={{ "Bonus issue": "warning", "Rights issue": "warning", Dividend: "info", "Closed period": "neutral", "Results filing": "info" }} />
                    </Stack>
                    <Text variant="small" tone="muted">
                      {a.detail}
                    </Text>
                    <Text variant="caption" tone="subtle">
                      {date(a.at)}
                    </Text>
                  </Stack>
                ))}
              <Text variant="caption" tone="subtle">
                No suspensions or delisting notices on pledged counters.
              </Text>
            </Stack>
          </Card>
        </Grid>

        <DataTable
          label="Share-backed positions"
          caption="Margin call when haircut-adjusted MTM falls below the exposure it secures; raised through the PRD §6.4.4 escalation protocol."
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          density="compact"
          defaultSort={{ id: "cover", direction: "asc" }}
          filters={[
            { id: "ticker", label: "Ticker", columnId: "ticker" },
            { id: "lien", label: "Lien", columnId: "lien" },
            { id: "call", label: "Margin", columnId: "call" },
          ]}
          exportFilename="share-backed-positions.csv"
          emptyState={<EmptyState title="No share-backed collateral" />}
        />
      </Stack>
    </ModulePage>
  );
}
