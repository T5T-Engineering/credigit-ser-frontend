"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Landmark, Target, TriangleAlert, Wallet } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DescriptionList,
  Drawer,
  Grid,
  LineChart,
  PhaseBadge,
  ScatterChart,
  Skeleton,
  Sparkline,
  Stack,
  StatCard,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useFacilities, useLookups, useObligors } from "@/lib/data/hooks";
import { useHydrated } from "@/lib/auth/session";
import { useRule } from "@/lib/platform/rules";
import { rarPosition, type RarPosition } from "@/lib/rar";
import type { Obligor } from "@/lib/data/types";
import { moneyShort } from "@/lib/format";
import { walletFor, walletPositionMeta, type WalletData, type WalletPosition } from "../data";
import { assessmentHref, PostureBadge } from "../shared";

type Row = { o: Obligor; sector: string; w: WalletData; pos: RarPosition };

const positions = Object.keys(walletPositionMeta) as WalletPosition[];
const pctS = (v: number) => `${Math.round(v * 100)}%`;
const ppS = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} pp`;

export function ShareOfWalletPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-3xl" />}>
      <ShareOfWalletView />
    </Suspense>
  );
}

function ShareOfWalletView() {
  const hydrated = useHydrated();
  const obligors = useObligors();
  const facilities = useFacilities();
  const { sector } = useLookups();
  const router = useRouter();
  const initial = useSearchParams().get("id");
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const highPct = useRule<number>("credit-analysis.sow.highSharePct");

  const rows = useMemo<Row[]>(
    () =>
      obligors.map((o) => {
        const out = facilities.filter((f) => f.obligorId === o.id && f.status !== "Closed" && f.status !== "Written off").reduce((s, f) => s + f.outstanding, 0);
        return {
          o,
          sector: sector.get(o.sectorId)?.name ?? o.sectorId,
          w: walletFor(o.id, o.verifiedTurnover, out),
          pos: rarPosition(o.rar),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- highPct: wallet quadrant threshold is a business rule
    [obligors, facilities, sector, highPct],
  );
  const withData = rows.filter((r) => r.w.available);
  const count = (p: WalletPosition) => withData.filter((r) => r.w.position === p).length;
  const selected = rows.find((r) => r.o.id === selectedId);

  const close = () => {
    setSelectedId(null);
    if (initial) router.replace("/credit-analysis/share-of-wallet");
  };

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
            {r.o.id} · {r.sector}
          </span>
        </span>
      ),
    },
    {
      id: "turnover",
      header: "Turnover share",
      numeric: true,
      sortable: true,
      accessor: (r) => r.w.turnoverShare,
      cell: (r) => (r.w.available ? pctS(r.w.turnoverShare) : "—"),
    },
    {
      id: "loan",
      header: "Loan share",
      numeric: true,
      sortable: true,
      accessor: (r) => r.w.loanShare,
      cell: (r) => (r.w.available ? pctS(r.w.loanShare) : "—"),
    },
    {
      id: "gap",
      header: "Gap",
      numeric: true,
      sortable: true,
      accessor: (r) => r.w.gap,
      cell: (r) => (r.w.available ? ppS(r.w.gap) : "—"),
    },
    {
      id: "trend",
      header: "Gap trend",
      exportable: false,
      cell: (r) =>
        r.w.available ? (
          <span className="block w-24">
            <Sparkline values={r.w.gapHistory.map((h) => h.gap * 100)} tone={r.w.gap >= 0 ? "success" : "warning"} height={28} />
          </span>
        ) : null,
    },
    {
      id: "position",
      header: "Wallet position",
      accessor: (r) => (r.w.available ? r.w.position : "No other-bank data"),
      cell: (r) => (r.w.available ? <Badge tone={walletPositionMeta[r.w.position].tone}>{r.w.position}</Badge> : <Badge variant="outline">No other-bank data</Badge>),
    },
    {
      id: "posture",
      header: "360 RAR posture",
      accessor: (r) => r.pos.label,
      cell: (r) => <PostureBadge position={r.pos} compact />,
    },
  ];

  return (
    <ModulePage
      module="credit-analysis"
      description="Share of Business Wallet: how much of each customer's transaction turnover and borrowing sits with the bank versus its other banking relationships."
    >
      <Stack gap="large">
        <div className="flex flex-wrap items-center gap-3">
          <PhaseBadge phase={2} label="Phase 2 — Share of Business Wallet" />
          <Text variant="small" tone="muted">
            Needs automated other-bank statement aggregation; runs on demo data in this prototype.
          </Text>
        </div>
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard
            label="Obligors with wallet data"
            value={`${withData.length} / ${rows.length}`}
            icon={<Wallet aria-hidden />}
            hint="Other-bank statements or bureau per-bank breakdown on file"
          />
          <StatCard label="Primary relationships" value={String(count("Primary Relationship"))} icon={<Landmark aria-hidden />} tone="success" />
          <StatCard
            label="Untapped lending opportunity"
            value={String(count("Untapped Lending Opportunity"))}
            icon={<Target aria-hidden />}
            tone="info"
            hint="Cross-sell candidates"
          />
          <StatCard
            label="Credit-concentration watch"
            value={String(count("Credit-Concentration Watch"))}
            icon={<TriangleAlert aria-hidden />}
            tone="warning"
            hint="Closer monitoring until turnover share improves"
          />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Wallet Share Matrix</CardTitle>
                <CardDescription>Turnover wallet share (X) against loan wallet share (Y); “high” at ≥ {highPct}% (tenant business rule)</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ScatterChart
                series={positions.map((p) => ({
                  name: p,
                  tone: walletPositionMeta[p].tone,
                  points: withData
                    .filter((r) => r.w.position === p)
                    .map((r) => ({
                      x: r.w.turnoverShare * 100,
                      y: r.w.loanShare * 100,
                      label: r.o.name,
                    })),
                }))}
                xDomain={[0, 100]}
                yDomain={[0, 100]}
                xLabel="Turnover wallet share"
                yLabel="Loan wallet share"
                xFormatter={(v) => `${Math.round(v)}%`}
                yFormatter={(v) => `${Math.round(v)}%`}
                referenceLines={[
                  { axis: "x", value: highPct },
                  { axis: "y", value: highPct },
                ]}
                height={300}
                label="Wallet share matrix"
              />
              <Text variant="small" tone="muted" className="mt-4">
                Turnover Wallet Share = verified reconciled credit turnover on the tenant CBA ÷ total verified credit turnover across the CBA and every other-bank statement (same
                reconciliation standard). Loan Wallet Share = outstanding with the tenant ÷ total outstanding across reporting banks (bureau/CRMS). Gap = turnover share − loan
                share, trended at each refresh. The gap is also an additional overlay on the Internal Risk Confidence Layer.
              </Text>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Positions, credit read and front-office action</CardTitle>
                <CardDescription>The AI co-pilot turns each position into a credit read and a conversation</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                {positions.map((p) => (
                  <div key={p} className="squircle rounded-3xl bg-surface-sunken p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone={walletPositionMeta[p].tone}>{p}</Badge>
                      <span className="font-mono text-sm text-fg-muted">{count(p)} obligors</span>
                    </div>
                    <Text variant="small" className="mt-2">
                      {walletPositionMeta[p].read}
                    </Text>
                    <Text variant="small" tone="muted" className="mt-1">
                      <strong>Action:</strong> {walletPositionMeta[p].action}
                    </Text>
                  </div>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <DataTable
          label="Share of wallet by obligor"
          columns={columns}
          data={rows}
          getRowId={(r) => r.o.id}
          onRowClick={(r) => setSelectedId(r.o.id)}
          loading={!hydrated}
          searchable
          searchPlaceholder="Search obligor or sector"
          filters={[{ id: "position", label: "Wallet position" }]}
          defaultSort={{ id: "gap", direction: "asc" }}
          exportFilename="share-of-wallet.csv"
        />
      </Stack>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && close()}
        title={selected?.o.name ?? ""}
        description={selected ? `${selected.o.id} · ${selected.sector}` : undefined}
        size="large"
      >
        {selected && <WalletDetail row={selected} />}
      </Drawer>
    </ModulePage>
  );
}

function WalletDetail({ row }: { row: Row }) {
  const { w } = row;
  if (!w.available)
    return (
      <Text tone="muted">
        No other-bank statements or bureau per-bank breakdown on file. Request statements through the other-bank connector to compute this customer’s Share of Business
        Wallet.
      </Text>
    );
  return (
    <Stack gap="large">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={walletPositionMeta[w.position].tone}>{w.position}</Badge>
        <PostureBadge position={row.pos} />
      </div>
      <DescriptionList
        columns={3}
        items={[
          { label: "Turnover share", value: pctS(w.turnoverShare), mono: true },
          { label: "Loan share", value: pctS(w.loanShare), mono: true },
          { label: "Wallet Share Gap", value: ppS(w.gap), mono: true },
        ]}
      />
      <DataTable
        label="Per-bank breakdown"
        data={w.lines}
        getRowId={(l) => l.bank}
        paginate={false}
        density="compact"
        columns={[
          {
            id: "bank",
            header: "Bank",
            accessor: "bank",
            cell: (l) => <span className={l.tenant ? "font-semibold text-fg" : undefined}>{l.bank}</span>,
          },
          {
            id: "t",
            header: "Credit turnover",
            numeric: true,
            accessor: "creditTurnover",
            cell: (l) => moneyShort(l.creditTurnover),
          },
          {
            id: "o",
            header: "Outstanding",
            numeric: true,
            accessor: "outstanding",
            cell: (l) => moneyShort(l.outstanding),
          },
          {
            id: "src",
            header: "Source",
            accessor: "source",
            cell: (l) => <span className="text-xs text-fg-muted">{l.source}</span>,
          },
        ]}
      />
      <div>
        <Text variant="subtitle" as="h3">
          Wallet share over time
        </Text>
        <LineChart
          height={180}
          showLegend
          yFormatter={(v) => `${Math.round(v)}%`}
          series={[
            {
              name: "Turnover share",
              tone: "accent",
              points: w.gapHistory.map((h) => ({
                x: h.at,
                y: h.turnoverShare * 100,
              })),
            },
            {
              name: "Loan share",
              tone: "brand",
              points: w.gapHistory.map((h) => ({
                x: h.at,
                y: h.loanShare * 100,
              })),
            },
          ]}
          label="Turnover and loan wallet share by refresh"
        />
      </div>
      <Card variant="filled">
        <CardContent>
          <Text variant="small">{walletPositionMeta[w.position].read}</Text>
          <Text variant="small" tone="muted" className="mt-2">
            <strong>Front-office action:</strong> {walletPositionMeta[w.position].action}
          </Text>
        </CardContent>
      </Card>
      <Button as={Link} href={assessmentHref(row.o.id)} iconAfter={<ArrowRight aria-hidden />}>
        Open 360 RAR assessment
      </Button>
    </Stack>
  );
}
