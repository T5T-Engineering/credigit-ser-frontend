"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Grid,
  ScatterChart,
  Matrix,
  PhaseBadge,
  Select,
  SegmentedControl,
  Stack,
  StatusBadge,
  Text,
  WaterfallChart,
  type DataTableColumn,
  type MatrixCell,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useLookups } from "@/lib/data/hooks";
import { rarPosition } from "@/lib/rar";
import { money, moneyShort, pct } from "@/lib/format";
import type { Obligor } from "@/lib/data/types";
import { KpiCard } from "../components/calc-note";
import { Panel } from "../components/panel";
import { isNewBusiness, migrationMatrix, openingExposure, OPENING_LABEL, PERIOD_LABEL, priorGrade, projectedWarr, warrDecomposition } from "../data";
import { usePortfolioModel } from "../hooks";
import { computeWarr, portfolioParams, productGroup, share, sum, tenorBand } from "../selectors";

type Dimension = "sector" | "branch" | "tenor" | "product" | "size" | "posture" | "officer" | "vintage";
const dimensions: Array<{ value: Dimension; label: string }> = [
  { value: "sector", label: "Sector" },
  { value: "branch", label: "Region / branch" },
  { value: "tenor", label: "Tenor band" },
  { value: "product", label: "Product type" },
  { value: "size", label: "Obligor size band" },
  { value: "posture", label: "360 RAR posture" },
  { value: "officer", label: "Account officer" },
  { value: "vintage", label: "Booking vintage" },
];

/** Obligor size bands — tenant parameter in the Rules & Parameters Engine (demo bands). */
function sizeBand(exposure: number) {
  if (exposure < 100e6) return "< ₦100m";
  if (exposure < 1e9) return "₦100m – ₦1bn";
  if (exposure < 5e9) return "₦1bn – ₦5bn";
  return "> ₦5bn";
}

type Basis = "ccf" | "limit";

export function WarrPage() {
  const { facilities, obligors, sectors, rows, history, exposures } = usePortfolioModel();
  const { user } = useLookups();
  const [basis, setBasis] = useState<Basis>("ccf");
  const [view, setView] = useState<"count" | "exposure">("count");
  const [dim, setDim] = useState<Dimension>("sector");
  const [segment, setSegment] = useState<string | null>(null);
  const p = portfolioParams;

  const sectorName = useMemo(() => new Map(sectors.map((s) => [s.id, s.name])), [sectors]);
  const obligorExposure = useMemo(() => new Map(exposures.map((e) => [e.obligor.id, e.exposure])), [exposures]);
  const basisRows = useMemo(() => rows.map((r) => ({ ...r, exposure: basis === "ccf" ? r.exposure : r.facility.approvedAmount })), [rows, basis]);
  const w = computeWarr(basisRows);
  const newRows = basisRows.filter((r) => isNewBusiness(r.facility));
  const oldRows = basisRows.filter((r) => !isNewBusiness(r.facility));
  const wNew = computeWarr(newRows);
  const wOld = computeWarr(oldRows);
  const dec = useMemo(() => warrDecomposition(facilities, obligors), [facilities, obligors]);
  const cells = useMemo(() => migrationMatrix(facilities, obligors), [facilities, obligors]);
  const upgrades = cells.filter((c) => c.to < c.from);
  const downgrades = cells.filter((c) => c.to > c.from);

  const keyOf = (r: (typeof basisRows)[number]): string => {
    const o = r.obligor;
    switch (dim) {
      case "sector": return sectorName.get(o.sectorId) ?? o.sectorId;
      case "branch": return r.facility.branch;
      case "tenor": return tenorBand(r.facility.tenorMonths);
      case "product": return productGroup(r.facility.product);
      case "size": return sizeBand(obligorExposure.get(o.id) ?? 0);
      case "posture": return rarPosition(o.rar).base;
      case "officer": return user.get(o.relationshipManagerId)?.name ?? "Unassigned";
      case "vintage": return new Date(r.facility.startDate).getFullYear().toString();
    }
  };

  const segRows = useMemo(() => {
    const groups = new Map<string, typeof basisRows>();
    for (const r of basisRows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
    const total = sum(basisRows, (r) => r.exposure);
    const openTotal = sum(basisRows, (r) => openingExposure(r.facility));
    return [...groups.entries()].map(([key, list]) => {
      const cur = computeWarr(list);
      const openRows = list.filter((r) => !isNewBusiness(r.facility)).map((r) => ({ exposure: openingExposure(r.facility), grade: priorGrade(r.obligor) }));
      const open = computeWarr(openRows);
      const shareNow = share(sum(list, (r) => r.exposure), total);
      const shareOpen = share(sum(openRows, (r) => r.exposure), openTotal);
      const movement = open.warr ? cur.warr - open.warr : 0;
      return { key, exposure: sum(list, (r) => r.exposure), share: shareNow, shareMove: shareNow - shareOpen, warr: cur.warr, exS3: cur.warrExStage3, movement, count: new Set(list.map((r) => r.obligor.id)).size, flag: movement > 0.05 && shareNow - shareOpen > 0.2 };
    }).sort((a, b) => b.exposure - a.exposure);
    // keyOf depends on dim/basis lookups only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basisRows, dim, sectorName, user, obligorExposure]);

  const drill = useMemo(() => {
    if (!segment) return [];
    const list = basisRows.filter((r) => keyOf(r) === segment);
    const total = sum(list, (r) => r.exposure);
    const num = sum(list, (r) => r.exposure * (r.grade ?? 0));
    const byObligor = new Map<string, { obligor: Obligor; exposure: number; grade: number; prior: number | null }>();
    for (const r of list) {
      const cur = byObligor.get(r.obligor.id) ?? { obligor: r.obligor, exposure: 0, grade: r.obligor.riskGrade, prior: priorGrade(r.obligor) };
      cur.exposure += r.exposure;
      byObligor.set(r.obligor.id, cur);
    }
    return [...byObligor.values()].map((x) => ({ ...x, weight: share(x.exposure, total), contribution: num ? share(x.exposure * x.grade, num) : 0, rar: rarPosition(x.obligor.rar) })).sort((a, b) => b.exposure - a.exposure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, basisRows, dim]);

  const grades = Array.from({ length: 10 }, (_, i) => i + 1);
  const matrixCells: MatrixCell[] = grades.flatMap((from) =>
    grades.map((to) => {
      const c = cells.find((x) => x.from === from && x.to === to);
      const value = c ? (view === "count" ? c.count : c.exposure) : 0;
      return {
        row: String(from),
        column: String(to),
        value,
        label: c ? (view === "count" ? String(c.count) : moneyShort(c.exposure)) : "",
        tone: !c ? "neutral" : to === from ? "info" : to < from ? "success" : to - from >= 2 ? "danger" : "warning",
        description: c ? `${c.count} obligors, ${money(c.exposure)} — ${to === from ? "unchanged" : to < from ? "upgrade" : "downgrade"}` : "No obligors",
      } satisfies MatrixCell;
    }),
  );

  const status = w.warr >= p.warrCeiling.value ? "Breach" : w.warr >= p.warrEarlyWarning.value ? "Early warning" : "Within appetite";

  return (
    <ModulePage
      module="portfolio"
      description="Weighted Average Risk Rating (§6.6.9) — rating quality as a single trendable number, always reported with its migration drivers, unrated bucket and Stage 3 treatment."
      actions={
        <SegmentedControl
          label="Exposure weighting basis"
          size="small"
          value={basis}
          onChange={setBasis}
          options={[
            { value: "ccf", label: "Outstanding + CCF" },
            { value: "limit", label: "Approved limit" },
          ]}
        />
      }
    >
      <Stack gap="large">
        <Alert tone={status === "Within appetite" ? "info" : status === "Early warning" ? "warning" : "danger"} title={`WARR ${w.warr.toFixed(2)} — ${status.toLowerCase()} (ceiling ${p.warrCeiling.value.toFixed(1)}, early warning ${p.warrEarlyWarning.value.toFixed(1)} — demo Board appetite)`}>
          Computation basis stamped on this view: weighting = {basis === "ccf" ? "gross outstanding + undrawn/contingent × CCF (default, §9.1)" : "approved limit (selectable alternative)"}; grade-score table GST-2026.1 (demo: grade n = score n, 1 best – 10 worst); unrated reported separately; Stage 3 shown included and excluded.
        </Alert>

        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <KpiCard
            label="WARR — whole book"
            value={w.warr.toFixed(2)}
            delta={`${(dec.closing - dec.opening >= 0 ? "+" : "")}${(dec.closing - dec.opening).toFixed(2)} YTD`}
            deltaIntent={dec.closing <= dec.opening ? "positive" : "negative"}
            deltaDirection={dec.closing > dec.opening ? "up" : dec.closing < dec.opening ? "down" : "flat"}
            hint={`from ${dec.opening.toFixed(2)} at ${OPENING_LABEL}`}
            calc={{
              metric: "WARR",
              formula: "WARR = Σ (exposure × grade score) / Σ rated exposure",
              source: "Grade: internal rating per §6.2.7 (360 RAR composite + PD). Grade score: tenant grade-to-score table. Exposure: CBA outstanding + undrawn at CCF (or approved limit / EAD per the basis in force).",
              prd: "§6.6.9, §8",
              inputs: [
                { label: "Rated exposure", value: money(w.ratedExposure) },
                { label: "Σ exposure × score", value: money(w.warr * w.ratedExposure) },
              ],
            }}
          />
          <KpiCard
            label="WARR excluding Stage 3"
            value={w.warrExStage3.toFixed(2)}
            hint={`Stage 3 exposure ${moneyShort(w.stage3Exposure)} shown in and out`}
            tone="info"
            calc={{ metric: "WARR ex-Stage 3", formula: "Same formula, Stage 3 / defaulted exposures excluded", source: "So a WARR that improves only because bad names were written off is not mistaken for genuine improvement.", prd: "§6.6.9" }}
          />
          <KpiCard
            label="New business vs existing book"
            value={`${wNew.warr.toFixed(2)} / ${wOld.warr.toFixed(2)}`}
            hint={`${PERIOD_LABEL} · new ${moneyShort(wNew.ratedExposure)}`}
            tone={wNew.warr > wOld.warr ? "warning" : "success"}
            calc={{ metric: "new vs existing WARR", formula: "WARR of facilities originated in the reporting period vs WARR of the pre-existing book", source: "Facility start date from the CBA facility ledger.", prd: "§6.6.9" }}
          />
          <KpiCard
            label="Unrated bucket"
            value={moneyShort(w.unratedExposure)}
            hint={`${pct(w.unratedPct)} of book — not averaged in`}
            tone="neutral"
            calc={{ metric: "unrated bucket", formula: "Σ exposure carrying no current internal grade", source: "Reported separately with value and % of book; above the tenant threshold it is a §6.4.4 exception.", prd: "§6.6.9" }}
          />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Panel title="WARR trend vs Board appetite" description="Month-end WARR (prototype history synthesised from the opening and current book).">
            <ScatterChart
              label="WARR trend vs ceiling"
              height={240}
              xDomain={[0, history.length - 1]}
              yDomain={[Math.floor(Math.min(...history.map((h) => h.warr)) * 2) / 2 - 0.5, Math.max(p.warrCeiling.value + 0.25, Math.ceil(Math.max(...history.map((h) => h.warr)) * 2) / 2)]}
              xFormatter={(v) => history[Math.round(v)]?.month ?? ""}
              yFormatter={(v) => v.toFixed(2)}
              showLegend={false}
              referenceLines={[
                { axis: "y", value: p.warrCeiling.value, label: "Ceiling", tone: "danger" },
                { axis: "y", value: p.warrEarlyWarning.value, label: "Early warning", tone: "warning" },
              ]}
              series={[{ name: "WARR", tone: "accent", points: history.map((h, i) => ({ x: i, y: h.warr, label: h.month })) }]}
            />
          </Panel>
          <Panel
            title="Why WARR moved"
            description={`Drivers of the move from ${dec.opening.toFixed(2)} (${OPENING_LABEL}) to ${dec.closing.toFixed(2)} today.`}
            calc={{ metric: "WARR decomposition", formula: "Opening → run-off (exposure change at opening grades) → migration (grade change, existing book) → new disbursements → write-offs/exits → closing", source: "Prior grades retained under §6.2.7 (prototype: opening grades synthesised deterministically).", prd: "§6.6.9" }}
          >
            <WaterfallChart
              label="WARR movement decomposition"
              increaseIntent="negative"
              legendLabels={{ increase: "Deterioration", decrease: "Improvement", total: "Net movement" }}
              valueFormatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`}
              height={240}
              steps={[
                { label: "Run-off", value: dec.runoff, caption: "Repayments & run-off" },
                { label: "Migration", value: dec.migration, caption: "Upgrades & downgrades" },
                { label: "New business", value: dec.newBusiness, caption: "New disbursements" },
                { label: "Write-offs", value: dec.writeOffs, caption: "Write-offs / exits" },
                { label: "Net move", type: "total" },
              ]}
            />
          </Panel>
        </Grid>

        <Panel
          title="Grade-migration matrix"
          description={`Opening grade (${OPENING_LABEL}, rows) against current grade (columns). ${upgrades.reduce((a, c) => a + c.count, 0)} upgrades, ${downgrades.reduce((a, c) => a + c.count, 0)} downgrades.`}
          actions={
            <SegmentedControl label="Matrix values" size="small" value={view} onChange={setView} options={[{ value: "count", label: "By count" }, { value: "exposure", label: "By exposure" }]} />
          }
        >
          <div className="overflow-x-auto">
            <Matrix
              label="Grade migration matrix"
              rows={grades.map((g) => ({ id: String(g), label: `G${g}` }))}
              columns={grades.map((g) => ({ id: String(g), label: `G${g}` }))}
              cells={matrixCells}
              rowAxisLabel="Opening grade"
              columnAxisLabel="Current grade"
              cellSize="small"
              legend={[
                { label: "Upgrade", tone: "success" },
                { label: "Unchanged", tone: "info" },
                { label: "Downgrade 1 notch", tone: "warning" },
                { label: "Downgrade ≥2 notches", tone: "danger" },
              ]}
            />
          </div>
        </Panel>

        <Panel
          title="WARR by segment"
          description="Every §6.6.4 dimension plus account officer and booking vintage. Flag = WARR deteriorating while exposure share grows (checked against the annual plan, §6.6.8). Select a row to drill through to obligors."
          actions={<Select aria-label="Segment dimension" size="small" value={dim} onChange={(e) => { setDim(e.target.value as Dimension); setSegment(null); }} options={dimensions} />}
        >
          <DataTable
            label="WARR by segment"
            data={segRows}
            getRowId={(r) => r.key}
            paginate={segRows.length > 12}
            onRowClick={(r) => setSegment(r.key)}
            exportFilename={`warr-by-${dim}.csv`}
            columns={[
              { id: "key", header: dimensions.find((d) => d.value === dim)!.label, accessor: "key", sortable: true, cell: (r) => <span className="font-semibold text-fg">{r.key}</span> },
              { id: "count", header: "Obligors", accessor: "count", numeric: true, sortable: true },
              { id: "exposure", header: "Exposure", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
              { id: "share", header: "Share", accessor: "share", numeric: true, sortable: true, cell: (r) => `${pct(r.share)} (${r.shareMove >= 0 ? "+" : ""}${r.shareMove.toFixed(1)}pp)` },
              { id: "warr", header: "WARR", accessor: "warr", numeric: true, sortable: true, cell: (r) => r.warr.toFixed(2) },
              { id: "exs3", header: "Ex-Stage 3", accessor: "exS3", numeric: true, sortable: true, cell: (r) => r.exS3.toFixed(2) },
              { id: "move", header: "YTD move", accessor: "movement", numeric: true, sortable: true, cell: (r) => `${r.movement >= 0 ? "+" : ""}${r.movement.toFixed(2)}` },
              { id: "flag", header: "Flag", accessor: (r) => (r.flag ? "Deteriorating & growing" : ""), cell: (r) => (r.flag ? <StatusBadge status="Deteriorating & growing" tones={{ "Deteriorating & growing": "danger" }} /> : "—") },
            ] as DataTableColumn<(typeof segRows)[number]>[]}
          />
        </Panel>

        {segment ? (
          <Panel
            title={`Drill-through: ${segment}`}
            description="Obligors producing this WARR — grade, exposure, weight and contribution, with the 360 RAR composite behind the grade (§6.6.9)."
            actions={<Button variant="tertiary" size="small" onClick={() => setSegment(null)}>Close</Button>}
          >
            <DataTable
              label={`Obligors in ${segment}`}
              data={drill}
              getRowId={(r) => r.obligor.id}
              defaultPageSize={10}
              exportFilename="warr-drill-through.csv"
              columns={[
                { id: "name", header: "Obligor", accessor: (r) => r.obligor.name, sortable: true, cell: (r) => <Link className="font-semibold text-link" href={`/credit-analysis?obligor=${r.obligor.id}`}>{r.obligor.name}</Link> },
                { id: "grade", header: "Grade", accessor: "grade", numeric: true, sortable: true },
                { id: "prior", header: `Grade at ${OPENING_LABEL}`, accessor: (r) => r.prior ?? "New", numeric: true },
                { id: "exp", header: "Exposure", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
                { id: "weight", header: "Weight", accessor: "weight", numeric: true, sortable: true, cell: (r) => pct(r.weight) },
                { id: "contrib", header: "Contribution", accessor: "contribution", numeric: true, sortable: true, cell: (r) => pct(r.contribution) },
                { id: "rar", header: "360 RAR (X / Y)", accessor: (r) => `${r.rar.x.toFixed(1)} / ${r.rar.y.toFixed(1)}`, cell: (r) => <span className="font-mono">{r.rar.x.toFixed(1)} / {r.rar.y.toFixed(1)}</span> },
                { id: "posture", header: "Posture", accessor: (r) => r.rar.label },
              ] as DataTableColumn<(typeof drill)[number]>[]}
            />
          </Panel>
        ) : null}

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Panel title={<span className="inline-flex items-center gap-2">Forward-looking WARR <PhaseBadge phase={2} /></span>} description="Projected WARR under each macro/sector scenario from the projection engine (§6.6.7).">
            <DataTable
              label="Projected WARR by scenario"
              data={projectedWarr(w.warr)}
              getRowId={(r) => r.scenario}
              paginate={false}
              columns={[
                { id: "s", header: "Scenario", accessor: "scenario", cell: (r) => <Badge tone={r.scenario === "Downside" ? "danger" : r.scenario === "Upside" ? "success" : "info"}>{r.scenario}</Badge> },
                { id: "m6", header: "6 months", accessor: "m6", numeric: true, cell: (r) => r.m6.toFixed(2) },
                { id: "m12", header: "12 months", accessor: "m12", numeric: true, cell: (r) => r.m12.toFixed(2) },
                { id: "c", header: "vs ceiling", accessor: (r) => (r.m12 >= p.warrCeiling.value ? "Breach" : "Within"), cell: (r) => <StatusBadge status={r.m12 >= p.warrCeiling.value ? "Breach" : "Within"} tones={{ Breach: "danger", Within: "success" }} /> },
              ]}
            />
            <Button as={Link} href="/portfolio/projections" variant="text" size="small" className="mt-2">Open projections</Button>
          </Panel>
          <Panel title="Computation basis in force" description="Recorded against every published WARR so a figure reproduced later reconciles exactly.">
            <DescriptionList
              columns={1}
              layout="inline"
              items={[
                { label: "Weighting", value: basis === "ccf" ? "Outstanding + undrawn × CCF" : "Approved limit" },
                { label: "Grade-score table", value: "GST-2026.1 (demo)", mono: true },
                { label: "Unrated treatment", value: "Separate bucket, excluded from average" },
                { label: "Defaulted treatment", value: "Shown included and excluded" },
                { label: "Reporting period", value: PERIOD_LABEL },
                { label: "Facilities in scope", value: String(basisRows.length), mono: true },
                { label: "Exposure in scope", value: moneyShort(sum(basisRows, (r) => r.exposure)), mono: true },
              ]}
            />
            <Text variant="caption" className="mt-2 block">Scenario projection values are simulated engine output (Phase 2).</Text>
          </Panel>
        </Grid>
      </Stack>
    </ModulePage>
  );
}
