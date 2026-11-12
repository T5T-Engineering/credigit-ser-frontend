"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileBarChart2 } from "lucide-react";
import {
  Alert,
  BarChart,
  Button,
  DataTable,
  DonutChart,
  Grid,
  LineChart,
  SegmentedControl,
  StackedBarChart,
  Stack,
  StatusBadge,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { roleById } from "@/lib/rbac/roles";
import type { Application } from "@/lib/data/types";
import { dateTime, money, moneyShort, number, pct } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { KpiCard } from "../components/calc-note";
import { Panel } from "../components/panel";
import { reconciliation, type ReconLine } from "../data";
import { useLimitMonitor, usePortfolioModel } from "../hooks";
import { bookBy, inPipeline, usePortfolioParams, productGroup, sum, TENOR_BANDS, tenorBand, CBN_CLASSES } from "../selectors";

/** Processing-stage label (§6.6.1): approval-stage applications are shown at the tier awaiting decision. */
function processingStage(a: Application): string {
  if (a.stage === "Approval") {
    const step = a.approvals.find((s) => s.decision === "pending");
    return step ? roleById[step.roleId].name : "Approval";
  }
  const map: Partial<Record<Application["stage"], string>> = {
    Draft: "Account Officer",
    Documents: "Account Officer",
    Analysis: "Credit Analyst",
    Recommendation: "BDM / Group Head",
    Offer: "Offering",
    Conditions: "Credit Admin stage",
    Disbursement: "Operations maker",
    Booked: "Disbursed",
    Declined: "Rejected",
  };
  return map[a.stage] ?? a.stage;
}

const cbnTones = { Performing: "success", Watchlist: "warning", Substandard: "warning", Doubtful: "danger", Lost: "danger" } as const;

export function PortfolioDashboardsPage() {
  const m = usePortfolioModel();
  const { totals, history, pipeline, warr, applications, facilities, obligors, sectors } = m;
  const p = usePortfolioParams();
  useLimitMonitor(m);
  const [trend, setTrend] = useState<"book" | "npl" | "stage">("book");
  const obligorById = useMemo(() => new Map(obligors.map((o) => [o.id, o])), [obligors]);
  const sectorById = useMemo(() => new Map(sectors.map((s) => [s.id, s])), [sectors]);
  const recon = useMemo(() => reconciliation(facilities), [facilities]);
  const breaks = recon.filter((r) => r.difference !== 0);

  const open = applications.filter(inPipeline);
  const byType = groupApps(open, (a) => a.requestType);
  const byStage = groupApps(applications.filter((a) => a.stage !== "Withdrawn"), processingStage);
  const bySector = bookBy(facilities, (f) => obligorById.get(f.obligorId)?.sectorId ?? "—", (k) => sectorById.get(k)?.name ?? k);
  const byProduct = bookBy(facilities, (f) => productGroup(f.product));
  const byTenor = bookBy(facilities, (f) => tenorBand(f.tenorMonths));
  const byBranch = bookBy(facilities, (f) => f.branch);
  const byGrade = bookBy(facilities, (f) => String(obligorById.get(f.obligorId)?.riskGrade ?? "Unrated"));
  const prev = history[history.length - 2]!;
  const last = history[history.length - 1]!;

  return (
    <ModulePage
      module="portfolio"
      description="Real-time application and portfolio dashboards replacing the manual Lending Support Update — every figure computed from the Risk Data Spine and reconciled to the CBA."
      actions={
        <Button as={Link} href="/portfolio/reports" variant="secondary" iconBefore={<FileBarChart2 size={16} aria-hidden />}>
          Reports & returns
        </Button>
      }
    >
      <Stack gap="large">
        <Alert
          tone={breaks.length ? "warning" : "success"}
          title={breaks.length ? `CBA reconciliation: ${breaks.length} break under review` : "Reconciled to the CBA"}
        >
          Spine totals were reconciled to the core banking ledger at {dateTime(DEMO_NOW)} (simulated CBA connector).{" "}
          {breaks.length ? `Difference ${money(sum(breaks, (b) => b.difference))} on ${breaks[0]!.ledger.toLowerCase()} — see reconciliation below.` : "No differences."}
        </Alert>

        <Grid columns={{ base: 1, sm: 2, xl: 3 }} gap="medium">
          <KpiCard
            label="Gross loan book"
            value={moneyShort(totals.grossLoans)}
            delta={pct(((last.grossLoans - prev.grossLoans) / prev.grossLoans) * 100)}
            hint="vs last month-end"
            calc={{
              metric: "gross loan book",
              formula: "Σ (current principal + accrued/unpaid interest) per funded facility",
              source: "CBA facility ledger via the CBA connector, refreshed daily. Active and restructured facilities.",
              prd: "§8",
              inputs: [
                { label: "Facilities", value: number(totals.facilityCount) },
                { label: "Obligors", value: number(totals.obligorCount) },
                { label: "Contingents (off-balance)", value: moneyShort(totals.contingent) },
              ],
            }}
          />
          <KpiCard
            label="NPL ratio"
            value={pct(totals.nplRatio, 2)}
            delta={`${(last.nplRatio - prev.nplRatio).toFixed(2)} pp`}
            deltaIntent={last.nplRatio <= prev.nplRatio ? "positive" : "negative"}
            hint={`Appetite ${pct(p.nplAppetitePct.value, 0)} (demo)`}
            tone={totals.nplRatio > p.nplAppetitePct.value ? "danger" : "brand"}
            calc={{
              metric: "NPL ratio",
              formula: "NPL / Gross loans × 100",
              source: "Both from the CBA facility book using the CBN performing/non-performing classification (Substandard, Doubtful, Lost — CBN 12.1(b)).",
              prd: "§6.6.5",
              inputs: [
                { label: "NPL", value: money(totals.npl) },
                { label: "Gross loans", value: money(totals.grossLoans) },
              ],
            }}
          />
          <KpiCard
            label="IFRS 9 Stage 2 / Stage 3"
            value={`${pct(totals.stageShare[2])} / ${pct(totals.stageShare[3])}`}
            hint={`${moneyShort(totals.byStage[2])} / ${moneyShort(totals.byStage[3])}`}
            tone="warning"
            calc={{
              metric: "stage share",
              formula: "Σ outstanding in stage / Gross loans × 100",
              source: "Facility stage from the IFRS 9 staging engine, mapped to CBN classification.",
              prd: "§6.7.1",
              inputs: [
                { label: "Stage 1", value: money(totals.byStage[1]) },
                { label: "Stage 2", value: money(totals.byStage[2]) },
                { label: "Stage 3", value: money(totals.byStage[3]) },
              ],
            }}
          />
          <KpiCard
            label="Pipeline — value in process"
            value={moneyShort(pipeline.value)}
            hint={`${number(pipeline.count)} applications in process`}
            tone="info"
            calc={{
              metric: "pipeline value",
              formula: "Σ requested amount of applications not yet booked, declined or withdrawn",
              source: "Loan Origination application records.",
              prd: "§6.6.1",
              inputs: [
                { label: "Applications in process", value: number(pipeline.count) },
                { label: "Declined (all time, demo)", value: number(pipeline.declined) },
              ],
            }}
          />
          <KpiCard
            label="WARR (whole book)"
            value={warr.warr.toFixed(2)}
            hint={`Ceiling ${p.warrCeiling.value.toFixed(1)} (demo) · scale 1 best – 10 worst`}
            calc={{
              metric: "WARR",
              formula: "Σ (exposure × grade score) / Σ rated exposure",
              source: "Grades: internal rating. Exposure: outstanding + undrawn × CCF. Unrated and Stage 3 reported separately.",
              prd: "§6.6.9",
              inputs: [
                { label: "Rated exposure", value: moneyShort(warr.ratedExposure) },
                { label: "Unrated", value: moneyShort(warr.unratedExposure) },
                { label: "WARR ex-Stage 3", value: warr.warrExStage3.toFixed(2) },
              ],
            }}
          />
          <KpiCard
            label="Past-due obligations"
            value={moneyShort(totals.pastDueValue)}
            hint={`${number(totals.pastDueCount)} facilities ≥ 1 day past due`}
            tone="accent"
            calc={{
              metric: "past-due obligations",
              formula: "Count and value of facilities with principal/interest overdue ≥ 1 day",
              source: "CBA facility ledger due-date and last-payment fields; 90/180/360-day thresholds from the Rules & Parameters Engine (CBN 12.1(b)–(e)).",
              prd: "§8",
            }}
          />
        </Grid>

        <Panel
          title="12-month trend"
          description="Month-end history (prototype: synthesised deterministically from the current book; live tenants read month-end snapshots)."
          actions={
            <SegmentedControl
              label="Trend metric"
              size="small"
              value={trend}
              onChange={setTrend}
              options={[
                { value: "book", label: "Loan book" },
                { value: "npl", label: "NPL ratio" },
                { value: "stage", label: "Stage mix" },
              ]}
            />
          }
        >
          {trend === "book" ? (
            <LineChart label="Gross loan book, last 12 months" area series={[{ name: "Gross loans", points: history.map((h) => ({ x: h.month, y: h.grossLoans })), tone: "accent" }]} yFormatter={moneyShort} height={240} />
          ) : trend === "npl" ? (
            <LineChart
              label="NPL ratio vs appetite, last 12 months"
              showLegend
              series={[
                { name: "NPL ratio", points: history.map((h) => ({ x: h.month, y: h.nplRatio })), tone: "danger" },
                { name: "Appetite (demo)", points: history.map((h) => ({ x: h.month, y: p.nplAppetitePct.value })), tone: "neutral" },
              ]}
              yFormatter={(v) => pct(v, 1)}
              height={240}
            />
          ) : (
            <StackedBarChart
              label="IFRS 9 stage mix by month (% of gross loans)"
              categories={history.map((h) => h.month)}
              series={[
                { name: "Stage 1", values: history.map((h) => h.stage1), tone: "success" },
                { name: "Stage 2", values: history.map((h) => h.stage2), tone: "warning" },
                { name: "Stage 3", values: history.map((h) => h.stage3), tone: "danger" },
              ]}
              valueFormatter={(v) => pct(v, 0)}
              height={240}
            />
          )}
        </Panel>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Panel title="Distribution by application type" description="Applications in process — volume and naira value.">
            <BarChart label="Value in process by application type" orientation="horizontal" data={byType.map((t) => ({ label: t.label, value: t.value, caption: `${t.count} apps` }))} valueFormatter={moneyShort} tone="accent" />
          </Panel>
          <Panel title="Distribution by processing stage" description="Pending volume and value at each configured workflow tier — bottlenecks in real time.">
            <BarChart label="Pending value by processing stage" orientation="horizontal" data={byStage.map((t) => ({ label: t.label, value: t.value, caption: `${t.count}` }))} valueFormatter={moneyShort} tone="info" />
          </Panel>
          <Panel title="Distribution by product type" description="Overdraft, Contingent liability, Advance, Term loan, Lease — on the Total Approved Loans basis.">
            <DonutChart
              label="Book by product group"
              showLegend
              centerLabel="Book + contingents"
              centerValue={moneyShort(sum(byProduct, (b) => b.value))}
              segments={byProduct.map((b, i) => ({ label: `${b.label} (${pct(b.share, 0)})`, value: b.value, tone: (["accent", "brand", "info", "success", "warning"] as const)[i % 5] }))}
              valueFormatter={moneyShort}
            />
          </Panel>
          <Panel title="Distribution by tenor range" description="Book value by original tenor band.">
            <BarChart
              label="Book by tenor band"
              data={TENOR_BANDS.map((t) => byTenor.find((b) => b.key === t)).map((b, i) => ({ label: TENOR_BANDS[i]!, value: b?.value ?? 0, caption: b ? `${b.count}` : "0" }))}
              valueFormatter={moneyShort}
              tone="brand"
            />
          </Panel>
          <Panel
            title="Distribution by internal risk rating"
            description={`Grade 1 (best) – 10 (worst). WARR ${warr.warr.toFixed(2)} shown alongside; unrated bucket ${moneyShort(warr.unratedExposure)} disclosed separately.`}
          >
            <BarChart
              label="Book by internal grade"
              data={Array.from({ length: 10 }, (_, i) => String(i + 1)).map((g) => {
                const b = byGrade.find((x) => x.key === g);
                return { label: `G${g}`, value: b?.value ?? 0, caption: b ? pct(b.share, 0) : "0%" };
              })}
              valueFormatter={moneyShort}
              tone="accent"
            />
          </Panel>
          <Panel title="CBN prudential classification" description="Funded book by CBN class (CBN 12.1).">
            <Stack gap="medium">
              <DonutChart
                label="Book by CBN class"
                showLegend
                centerLabel="NPL"
                centerValue={pct(totals.nplRatio, 2)}
                segments={CBN_CLASSES.map((c) => ({ label: c, value: totals.byClass[c], tone: cbnTones[c] }))}
                valueFormatter={moneyShort}
              />
            </Stack>
          </Panel>
        </Grid>

        <Panel title="Distribution by sector" description="Tenant internal sector taxonomy with value, volume and % of portfolio (CBN classification cross-reference in the regulatory returns).">
          <DataTable
            label="Book by sector"
            data={bySector}
            getRowId={(r) => r.key}
            paginate={false}
            exportFilename="portfolio-by-sector.csv"
            columns={[
              { id: "label", header: "Sector", accessor: "label", sortable: true },
              { id: "count", header: "Facilities", accessor: "count", numeric: true, sortable: true },
              { id: "value", header: "Value", accessor: "value", numeric: true, sortable: true, cell: (r) => moneyShort(r.value) },
              { id: "share", header: "% of portfolio", accessor: "share", numeric: true, sortable: true, cell: (r) => pct(r.share) },
              { id: "npl", header: "NPL ratio", accessor: "nplRatio", numeric: true, sortable: true, cell: (r) => pct(r.nplRatio, 2) },
            ] as DataTableColumn<(typeof bySector)[number]>[]}
          />
        </Panel>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Panel title="Distribution by branch / region" description="Book value by booking branch (CBA branch code).">
            <BarChart label="Book by branch" orientation="horizontal" data={byBranch.map((b) => ({ label: b.label, value: b.value, caption: pct(b.share, 0) }))} valueFormatter={moneyShort} tone="info" />
          </Panel>
          <Panel
            title="Reconciliation to CBA"
            description="Spine vs core banking general ledger, by product ledger (simulated connector)."
            calc={{ metric: "reconciliation", formula: "Difference = CBA GL balance − Σ spine outstanding (per ledger)", source: "CBA connector staging/reconciliation layer before promotion to the Risk Data Spine.", prd: "§5.1" }}
          >
            <DataTable
              label="Reconciliation to CBA"
              data={recon}
              getRowId={(r) => r.id}
              paginate={false}
              columns={[
                { id: "ledger", header: "Ledger", accessor: "ledger" },
                { id: "spine", header: "Spine", accessor: "spine", numeric: true, cell: (r) => moneyShort(r.spine) },
                { id: "diff", header: "Difference", accessor: "difference", numeric: true, cell: (r) => (r.difference ? money(r.difference) : "—") },
                { id: "status", header: "Status", accessor: "status", cell: (r) => <StatusBadge status={r.status} tones={{ Reconciled: "success", "Break — under review": "warning" }} /> },
              ] as DataTableColumn<ReconLine>[]}
            />
            {breaks.map((b) => (
              <Text key={b.id} variant="caption" className="mt-2 block">
                {b.ledger}: {b.note}
              </Text>
            ))}
          </Panel>
        </Grid>
      </Stack>
    </ModulePage>
  );
}

function groupApps(apps: Application[], keyOf: (a: Application) => string) {
  const map = new Map<string, Application[]>();
  for (const a of apps) map.set(keyOf(a), [...(map.get(keyOf(a)) ?? []), a]);
  return [...map.entries()].map(([label, list]) => ({ label, count: list.length, value: sum(list, (a) => a.amount) })).sort((a, b) => b.value - a.value);
}
