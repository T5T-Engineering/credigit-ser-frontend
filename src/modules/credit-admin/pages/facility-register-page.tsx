"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Banknote, BookOpenCheck, Gauge as GaugeIcon, Hourglass, Landmark } from "lucide-react";
import {
  Badge,
  BarChart,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DonutChart,
  EmptyState,
  Grid,
  ProgressBar,
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
  Tooltip,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useApplications } from "@/lib/data/hooks";
import { date, money, moneyShort, number, pct } from "@/lib/format";
import { cbnClassTones, facilityStatusTones } from "../common";
import { useFacilityRows, type FacilityRow } from "../logic";
import { facilityClasses, facilityClassOf, inProcessStages } from "../register";

export function FacilityRegisterPage() {
  const rows = useFacilityRows();
  const apps = useApplications();

  const kpis = useMemo(() => {
    const book = rows.filter((r) => r.facility.status !== "Closed" && r.facility.status !== "Written off");
    const approved = book.reduce((s, r) => s + r.facility.approvedAmount, 0);
    const outstanding = book.reduce((s, r) => s + r.facility.outstanding, 0);
    const pending = book.filter((r) => r.facility.status === "Pending disbursement");
    return {
      count: book.length,
      approved,
      outstanding,
      utilisation: approved ? (outstanding / approved) * 100 : 0,
      undisbursed: approved - outstanding,
      pendingCount: pending.length,
      pendingValue: pending.reduce((s, r) => s + r.facility.approvedAmount, 0),
      pendingReleased: pending.filter((r) => r.released).length,
    };
  }, [rows]);

  const byClass = useMemo(
    () =>
      facilityClasses.map((c) => {
        const list = rows.filter((r) => facilityClassOf[r.facility.product] === c);
        return { label: c, approved: list.reduce((s, r) => s + r.facility.approvedAmount, 0), outstanding: list.reduce((s, r) => s + r.facility.outstanding, 0), count: list.length };
      }),
    [rows],
  );

  const appTypes = useMemo(() => {
    const inProcess = apps.filter((a) => (inProcessStages as readonly string[]).includes(a.stage));
    const total = inProcess.length || 1;
    return (["New", "Renewal", "Restructure", "Enhancement"] as const).map((t) => {
      const list = inProcess.filter((a) => a.requestType === t);
      return { type: t, count: list.length, share: (list.length / total) * 100, value: list.reduce((s, a) => s + a.amount, 0) };
    });
  }, [apps]);

  const columns: DataTableColumn<FacilityRow>[] = [
    {
      id: "id",
      header: "Facility",
      accessor: (r) => r.facility.id,
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <span className="font-mono text-sm font-semibold text-fg">{r.facility.id}</span>
          <span className="text-xs text-fg-muted">{r.obligor?.name ?? r.facility.obligorId}</span>
        </Stack>
      ),
    },
    { id: "obligor", header: "Obligor", accessor: (r) => r.obligor?.name ?? "", hidden: true },
    { id: "product", header: "Product", accessor: (r) => r.facility.product, sortable: true },
    { id: "class", header: "Class", accessor: (r) => facilityClassOf[r.facility.product], hidden: true },
    { id: "approved", header: "Approved", accessor: (r) => r.facility.approvedAmount, numeric: true, sortable: true, cell: (r) => moneyShort(r.facility.approvedAmount, r.facility.currency), csv: (r) => r.facility.approvedAmount },
    { id: "outstanding", header: "Outstanding", accessor: (r) => r.facility.outstanding, numeric: true, sortable: true, cell: (r) => moneyShort(r.facility.outstanding, r.facility.currency), csv: (r) => r.facility.outstanding },
    {
      id: "utilisation",
      header: "Utilisation",
      accessor: (r) => Math.round(r.utilisation * 100),
      sortable: true,
      width: 140,
      cell: (r) => <ProgressBar value={r.utilisation} size="small" showValue ariaLabel={`Utilisation of ${r.facility.id}`} tone={r.utilisation > 0.95 ? "warning" : "brand"} />,
    },
    {
      id: "cps",
      header: "Conditions",
      accessor: (r) => `${r.cleared}/${r.cps.length}`,
      sortValue: (r) => (r.cps.length ? r.cleared / r.cps.length : 1),
      sortable: true,
      cell: (r) =>
        r.cps.length === 0 ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <Badge tone={r.cleared === r.cps.length ? "success" : "warning"} variant="soft">
            <span className="font-mono">
              {r.cleared}/{r.cps.length}
            </span>{" "}
            cleared
          </Badge>
        ),
    },
    { id: "status", header: "Status", accessor: (r) => r.facility.status, sortable: true, cell: (r) => <StatusBadge status={r.facility.status} tones={facilityStatusTones} /> },
    { id: "cbnClass", header: "CBN class", accessor: (r) => r.facility.cbnClass, sortable: true, cell: (r) => <StatusBadge status={r.facility.cbnClass} tones={cbnClassTones} /> },
    { id: "branch", header: "Branch", accessor: (r) => r.facility.branch, sortable: true },
    { id: "maturity", header: "Maturity", accessor: (r) => r.facility.maturityDate, sortable: true, cell: (r) => <span className="font-mono text-sm">{date(r.facility.maturityDate)}</span> },
  ];

  return (
    <ModulePage module="credit-admin" description="The definitive register of the facility book — approved vs outstanding, conditions precedent and release for disbursement.">
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard
            label="Total approved loans"
            value={moneyShort(kpis.approved)}
            icon={<Landmark aria-hidden />}
            hint={<Tooltip content="Σ approved facility amounts across Advances, Loans, Leases, Overdrafts, Term Loans and Contingent Liabilities. Source: Origination approval record reconciled to the CBA facility master.">{<span className="underline decoration-dotted">{number(kpis.count)} live facilities</span>}</Tooltip>}
          />
          <StatCard
            label="Outstanding amount"
            value={moneyShort(kpis.outstanding)}
            icon={<Banknote aria-hidden />}
            tone="accent"
            hint={<Tooltip content="Current principal + accrued/unpaid interest per facility. Source: CBA facility ledger, refreshed daily via the CBA connector (§5.1).">{<span className="underline decoration-dotted">Principal + interest in arrears</span>}</Tooltip>}
          />
          <StatCard label="Utilisation" value={pct(kpis.utilisation)} icon={<GaugeIcon aria-hidden />} tone="info" hint={`Outstanding ÷ approved · undisbursed ${moneyShort(kpis.undisbursed)}`}>
            <ProgressBar value={kpis.utilisation / 100} size="small" ariaLabel="Book utilisation" />
          </StatCard>
          <StatCard label="Pending disbursement" value={number(kpis.pendingCount)} icon={<Hourglass aria-hidden />} tone="warning" hint={`${moneyShort(kpis.pendingValue)} · ${kpis.pendingReleased} released by Credit Admin`} />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Approved amount by facility class</CardTitle>
                <CardDescription>On- and off-balance-sheet classes (PRD §6.3.1). Contingent liabilities carry no drawn balance until called.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <BarChart orientation="horizontal" data={byClass.map((c) => ({ label: c.label, value: c.approved, caption: `${c.count} facilities` }))} valueFormatter={(v) => moneyShort(v)} label="Approved amount by facility class" />
                <DonutChart
                  segments={[
                    { label: "Disbursed", value: kpis.outstanding, tone: "brand" },
                    { label: "Undisbursed", value: kpis.undisbursed, tone: "neutral" },
                  ]}
                  centerLabel="Disbursed"
                  centerValue={pct(kpis.utilisation, 0)}
                  valueFormatter={(v) => moneyShort(v)}
                  label="Disbursed vs undisbursed"
                />
              </Stack>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Application-type register</CardTitle>
                <CardDescription>Volume and Naira value in process by request type — Lending Support Update structure (PRD §6.3.1).</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell numeric>Volume</TableHeaderCell>
                    <TableHeaderCell numeric>Share</TableHeaderCell>
                    <TableHeaderCell numeric>Value in process</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {appTypes.map((t) => (
                    <TableRow key={t.type}>
                      <TableCell>{t.type}</TableCell>
                      <TableCell numeric>{t.count}</TableCell>
                      <TableCell numeric>{pct(t.share)}</TableCell>
                      <TableCell numeric>{money(t.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Text variant="caption" tone="muted" className="mt-3">
                In process = applications from Documents to Disbursement stage. Source: Loan Origination.
              </Text>
            </CardContent>
          </Card>
        </Grid>

        <DataTable
          label="Facility register"
          caption="Facility register"
          columns={columns}
          data={rows}
          getRowId={(r) => r.facility.id}
          getRowHref={(r) => `/credit-admin/facility/?id=${r.facility.id}`}
          linkComponent={Link}
          searchable
          searchPlaceholder="Search facility, obligor, product…"
          filters={[
            { id: "status", label: "Status" },
            { id: "product", label: "Product" },
            { id: "class", label: "Class" },
            { id: "branch", label: "Branch" },
            { id: "cbnClass", label: "CBN class" },
          ]}
          defaultSort={{ id: "status", direction: "desc" }}
          exportFilename="facility-register.csv"
          emptyState={<EmptyState icon={<BookOpenCheck aria-hidden />} title="No facilities match" description="Adjust the filters or search to see facilities." />}
          mobileCard={(r) => (
            <Stack gap="small">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{r.facility.id}</span>
                <StatusBadge status={r.facility.status} tones={facilityStatusTones} />
              </div>
              <Text variant="small">{r.obligor?.name}</Text>
              <Text variant="caption" tone="muted">
                {r.facility.product} · <span className="font-mono">{moneyShort(r.facility.outstanding)}</span> of <span className="font-mono">{moneyShort(r.facility.approvedAmount)}</span>
              </Text>
              <ProgressBar value={r.utilisation} size="small" ariaLabel="Utilisation" />
            </Stack>
          )}
        />
      </Stack>
    </ModulePage>
  );
}
