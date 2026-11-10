"use client";

import { useMemo } from "react";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, Grid, Stack, StatCard, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, riskStatusTones, type DataTableColumn } from "@credigit/web-ui";
import { useCollateral, useFacilities, useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Facility } from "@/lib/data/types";
import { date, moneyShort, pct } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { ermKeys } from "../keys";
import { insiderFlags, type Insider } from "../data";

type Row = Facility & { obligorName: string; insider: Insider; secured: boolean; maturityBand: string; nonPerforming: boolean };

const cbnTones = { Performing: "success", Watchlist: "warning", Substandard: "warning", Doubtful: "danger", Lost: "danger" } as const;

export function InsiderSection() {
  const obligors = useObligors();
  const facilities = useFacilities();
  const collateral = useCollateral();
  const sigPct = useRule<number>(ermKeys.significantShareholdingPct);
  const flags = useMemo(() => insiderFlags(obligors, facilities), [obligors, facilities]);

  const rows: Row[] = useMemo(() => {
    const cMap = new Map(collateral.map((c) => [c.id, c]));
    return flags.flatMap((fl) =>
      facilities
        .filter((f) => f.obligorId === fl.obligorId && f.status !== "Closed")
        .map((f) => {
          const yrs = (Date.parse(f.maturityDate) - DEMO_NOW.getTime()) / (365 * 86_400_000);
          return {
            ...f,
            obligorName: obligors.find((o) => o.id === f.obligorId)?.name ?? f.obligorId,
            insider: fl,
            secured: f.collateralIds.some((id) => cMap.has(id) && cMap.get(id)!.type !== "Personal guarantee"),
            maturityBand: yrs <= 1 ? "≤ 1 year" : yrs <= 3 ? "1–3 years" : "> 3 years",
            nonPerforming: f.cbnClass === "Substandard" || f.cbnClass === "Doubtful" || f.cbnClass === "Lost",
          };
        }),
    );
  }, [flags, facilities, obligors, collateral]);

  const total = rows.reduce((s, r) => s + r.outstanding, 0);
  const book = facilities.filter((f) => f.status !== "Closed").reduce((s, f) => s + f.outstanding, 0) || 1;
  const np = rows.filter((r) => r.nonPerforming);
  const npTotal = np.reduce((s, r) => s + r.outstanding, 0);
  const sum = (pred: (r: Row) => boolean) => rows.filter(pred).reduce((s, r) => s + r.outstanding, 0);
  const npSum = (pred: (r: Row) => boolean) => np.filter(pred).reduce((s, r) => s + r.outstanding, 0);

  const breakdown = [
    { group: "Security", label: "Secured", all: sum((r) => r.secured), np: npSum((r) => r.secured) },
    { group: "Security", label: "Unsecured", all: sum((r) => !r.secured), np: npSum((r) => !r.secured) },
    { group: "Maturity", label: "≤ 1 year", all: sum((r) => r.maturityBand === "≤ 1 year"), np: npSum((r) => r.maturityBand === "≤ 1 year") },
    { group: "Maturity", label: "1–3 years", all: sum((r) => r.maturityBand === "1–3 years"), np: npSum((r) => r.maturityBand === "1–3 years") },
    { group: "Maturity", label: "> 3 years", all: sum((r) => r.maturityBand === "> 3 years"), np: npSum((r) => r.maturityBand === "> 3 years") },
    { group: "Performance", label: "Performing / Watchlist", all: sum((r) => !r.nonPerforming), np: 0 },
    { group: "Performance", label: "Non-performing", all: npTotal, np: npTotal },
  ];

  const columns: DataTableColumn<Row>[] = [
    { id: "obligor", header: "Obligor", accessor: "obligorName", searchable: true, cell: (r) => <div><div className="font-medium text-fg">{r.obligorName}</div><div className="font-mono text-xs text-fg-subtle">{r.obligorId} · {r.id}</div></div> },
    { id: "insider", header: "Insider / relationship", accessor: (r) => `${r.insider.insider} — ${r.insider.relationship}`, cell: (r) => <div><div className="text-fg">{r.insider.insider}</div><div className="text-xs text-fg-subtle">{r.insider.relationship === "Significant shareholder" ? `Significant shareholder (≥${sigPct}%)` : r.insider.relationship}{r.insider.holdingPct ? ` · ${r.insider.holdingPct}% holding` : ""}</div></div> },
    { id: "product", header: "Facility", accessor: "product", sortable: true },
    { id: "outstanding", header: "Outstanding", numeric: true, sortable: true, accessor: "outstanding", cell: (r) => moneyShort(r.outstanding) },
    { id: "security", header: "Security", accessor: (r) => (r.secured ? "Secured" : "Unsecured") },
    { id: "maturity", header: "Maturity", accessor: (r) => date(r.maturityDate), sortValue: (r) => r.maturityDate, sortable: true },
    { id: "class", header: "Performance", accessor: "cbnClass", sortable: true, cell: (r) => <StatusBadge status={r.cbnClass} tones={{ ...riskStatusTones, ...cbnTones }} /> },
    { id: "provision", header: "Provision", accessor: () => "From IFRS 9 ECL run", cell: () => <span className="text-xs text-fg-subtle">From IFRS 9 ECL run (§6.7)</span> },
  ];

  return (
    <Stack gap="large">
      <Alert tone="info" title="Flagged automatically from the Risk Data Spine">
        Any facility to a director, significant shareholder (≥ {sigPct}% holding) or their related interest is flagged, and the CBN-mandated financial-statement disclosure fields are populated automatically. Insider links in this demo are fictional.
      </Alert>
      <Grid columns={{ base: 1, sm: 3 }} gap="medium">
        <StatCard label="Aggregate insider-related credit" value={<span className="font-mono">{moneyShort(total)}</span>} hint={`${rows.length} facilities · ${flags.length} related parties`} />
        <StatCard label="Share of total loan book" value={<span className="font-mono">{pct((total / book) * 100, 2)}</span>} hint={`Total book ${moneyShort(book)}`} />
        <StatCard label="Non-performing component" value={<span className="font-mono">{moneyShort(npTotal)}</span>} hint={`${np.length} ${np.length === 1 ? "facility" : "facilities"}`} tone={npTotal > 0 ? "danger" : "success"} />
      </Grid>
      <Grid columns={{ base: 1, lg: 3 }} gap="large">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Disclosure fields</CardTitle>
            <CardDescription>Aggregate and non-performing component by security, maturity and performance</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Analysis</TableHeaderCell>
                  <TableHeaderCell numeric>Total</TableHeaderCell>
                  <TableHeaderCell numeric>Non-perf.</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {breakdown.map((b) => (
                  <TableRow key={b.group + b.label}>
                    <TableCell><span className="text-xs text-fg-subtle">{b.group} · </span>{b.label}</TableCell>
                    <TableCell numeric>{moneyShort(b.all)}</TableCell>
                    <TableCell numeric>{moneyShort(b.np)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>Provision held</TableCell>
                  <TableCell numeric colSpan={2}><span className="text-xs text-fg-subtle">From IFRS 9 ECL run</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <DataTable label="Insider-related facilities" columns={columns} data={rows} getRowId={(r) => r.id} searchable searchPlaceholder="Search obligors or insiders" exportFilename="insider-related-credit.csv" defaultSort={{ id: "outstanding", direction: "desc" }} />
        </div>
      </Grid>
    </Stack>
  );
}
