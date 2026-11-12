"use client";

import { useMemo, useState } from "react";
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
  Field,
  Grid,
  Modal,
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
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import { useLookups } from "@/lib/data/hooks";
import { date, dateTime, moneyShort, number, pct } from "@/lib/format";
import { useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { PendingApproval } from "@/modules/monitoring/pending-approval";
import { exceptionHref } from "@/modules/monitoring/service";
import { useMonitoring } from "@/modules/monitoring/store";
import { corporateActions, lienTones } from "../data";
import { collateralAbilities, marginShortfall, priceSeries, referencePrices, requiredCover } from "../logic";
import { raiseMarginCall, requestMarginRelease, setSimulatedPrices } from "../service";
import { useCollateralStore, useCollateralView, useSharePrices, type CollateralView } from "../store";

type Row = CollateralView & { obligorName: string; shortfall: number; topUp: number; callId?: string };

export function SharesPage() {
  const view = useCollateralView();
  const { obligor } = useLookups();
  const { prices, asOf } = useSharePrices();
  const role = useRole();
  const can = collateralAbilities(role?.id);
  const store = useCollateralStore();
  const exceptions = useMonitoring((s) => s.exceptions);
  const instances = useOperationsStore((s) => s.instances);
  const haircutPct = useRule<number>("collateral.haircut.quotedShares");
  const minCoverPct = useRule<number>("collateral.margin.minCoverPct");
  const minText = useRule<number>("collateral.legal.minOpinionLength");
  const canAct = can.manage || can.verify;
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [releaseFor, setReleaseFor] = useState<Row | null>(null);
  const [evidence, setEvidence] = useState("");
  const pendingRelease = useMemo(
    () => new Set(instances.filter((i) => i.operationType === "collateral.margin.release" && ["Pending", "In progress"].includes(i.status)).map((i) => i.subject.id)),
    [instances],
  );

  const rows: Row[] = useMemo(
    () =>
      view
        .filter((c) => c.type === "Quoted shares")
        .map((c) => {
          const shortfall = marginShortfall(c.adjusted, c.exposure);
          const call = store.marginCalls[c.id];
          const open = call && !call.releasedAt && exceptions.find((e) => e.id === call.exceptionId && e.status !== "Resolved");
          return { ...c, obligorName: obligor.get(c.obligorId)?.name ?? c.obligorId, shortfall, topUp: Math.round(shortfall / (1 - c.haircutPct / 100)), callId: open ? call.exceptionId : undefined };
        }),
    // marginShortfall reads the margin rule at call time; minCoverPct re-runs it when the tenant value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, obligor, store.marginCalls, exceptions, minCoverPct],
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
      // TD-601: simulated CSCS feed — shock size is a simulator input, not a business rule.
      const shock = (Math.random() - 0.5) * 2 * r.vol * 1.5;
      next[t] = Math.round(cur * (1 + shock) * 100) / 100;
    }
    setSimulatedPrices(next);
  };
  const resetPrices = () => setSimulatedPrices({});

  const marginCall = async (r: Row) => {
    const res = await raiseMarginCall(r);
    setMessage(res.ok ? { tone: "success", text: `Margin call raised on ${r.id} — exception ${res.exceptionId} entered the escalation protocol.` } : { tone: "danger", text: res.reason });
  };

  const release = async () => {
    if (!releaseFor) return;
    const res = await requestMarginRelease(releaseFor, evidence);
    setMessage(res.ok ? { tone: "success", text: `Release of the margin call on ${releaseFor.id} submitted for cover verification (${res.operationId}).` } : { tone: "danger", text: res.reason });
    setReleaseFor(null);
    setEvidence("");
  };

  const columns: DataTableColumn<Row>[] = [
    { id: "id", header: "Collateral", accessor: "id", sortable: true, cell: (r) => <TextLink as={Link} href={`/collateral/item?id=${r.id}`}>{r.id}</TextLink> },
    { id: "obligor", header: "Pledgor", accessor: "obligorName", sortable: true, cell: (r) => <span className="font-medium text-fg">{r.obligorName}</span> },
    { id: "ticker", header: "Ticker", accessor: "ticker", sortable: true, cell: (r) => <span className="font-mono">{r.ticker}</span> },
    { id: "units", header: "Units", accessor: "units", numeric: true, sortable: true, cell: (r) => number(r.units ?? 0) },
    { id: "mtm", header: "MTM", accessor: "mtm", numeric: true, sortable: true, cell: (r) => moneyShort(r.mtm ?? 0) },
    { id: "adjusted", header: `After ${haircutPct}% haircut`, accessor: "adjusted", numeric: true, sortable: true, cell: (r) => moneyShort(r.adjusted) },
    { id: "exposure", header: "Exposure", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
    {
      id: "cover",
      header: "Cover",
      accessor: "cover",
      numeric: true,
      sortable: true,
      cell: (r) => (r.exposure > 0 ? <span className={r.cover * 100 < minCoverPct ? "font-mono text-danger-strong" : "font-mono"}>{pct(r.cover * 100, 0)}</span> : "—"),
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
          <Stack gap="xsmall">
            <StatusBadge status="Call raised" tones={{ "Call raised": "warning" }} />
            <TextLink as={Link} href={exceptionHref(r.callId)}>
              {r.callId}
            </TextLink>
            {pendingRelease.has(r.id) ? (
              <PendingApproval subjectType="Collateral" subjectId={r.id} compact />
            ) : (
              can.manage && (
                <Button size="small" variant="tertiary" onClick={() => setReleaseFor(r)}>
                  Release call
                </Button>
              )
            )}
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
      description="Share-backed exposure valued on a live, independently sourced mark-to-market — not a value frozen at the pledge date."
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
        {message && (
          <Alert tone={message.tone} title={message.tone === "danger" ? "Not completed" : "Done"}>
            {message.text}
          </Alert>
        )}
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
          <StatCard label="Mark-to-market" value={moneyShort(mtm)} hint={`${moneyShort(adjusted)} after ${haircutPct}% haircut`} />
          <StatCard label="Exposure secured" value={moneyShort(exposure)} hint={`Cover ${pct((adjusted / Math.max(1, exposure)) * 100, 0)}`} tone={adjusted >= requiredCover(exposure) ? "success" : "warning"} />
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
          caption={`Margin call when haircut-adjusted MTM covers less than ${minCoverPct}% of the exposure it secures (business rule); raised through the escalation protocol. Releases need cover verification in Operations.`}
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
      {releaseFor && (
        <Modal
          open
          onOpenChange={(o) => !o && (setReleaseFor(null), setEvidence(""))}
          title="Release margin call"
          description={`${releaseFor.id} · ${releaseFor.obligorName} · ${releaseFor.callId}`}
          footer={
            <>
              <Button variant="tertiary" onClick={() => (setReleaseFor(null), setEvidence(""))}>
                Cancel
              </Button>
              <Button onClick={release} disabled={evidence.trim().length < minText}>
                Submit for verification
              </Button>
            </>
          }
        >
          <Stack gap="medium">
            <Field label="Top-up evidence" htmlFor="release-evidence" required description="Additional units lien-marked, cash top-up received or exposure reduced. Middle Office / Head of Risk verify restored cover before the call and its exception close.">
              <Textarea id="release-evidence" rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            </Field>
          </Stack>
        </Modal>
      )}
    </ModulePage>
  );
}
