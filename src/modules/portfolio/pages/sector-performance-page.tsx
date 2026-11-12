"use client";

import { useMemo, useState } from "react";
import { Alert, DataTable, Grid, PhaseBadge, ScatterChart, Select, Stack, StatusBadge, WaterfallChart, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { rarPosition } from "@/lib/rar";
import { moneyShort, pct } from "@/lib/format";
import type { Facility } from "@/lib/data/types";
import { KpiCard } from "../components/calc-note";
import { RulesPanel } from "../components/governance";
import { Panel } from "../components/panel";
import { usePortfolioModel } from "../hooks";
import { OBLIGOR_TYPES, PARAM_RULES, PORTFOLIO_RULES, riskWeightRuleKey } from "../rule-keys";
import {
  computeWarr,
  liveFacilities,
  nplRatio,
  productGroup,
  profitability,
  tenorBand,
  usePortfolioParams,
  warrExposure,
  type Profitability,
} from "../selectors";

type Dim = "sector" | "branch" | "tenor" | "product" | "posture";
const dims: Array<{ value: Dim; label: string }> = [
  { value: "sector", label: "Sector" },
  { value: "branch", label: "Region / branch" },
  { value: "tenor", label: "Tenor band" },
  { value: "product", label: "Product type" },
  { value: "posture", label: "360 RAR posture" },
];

type Row = Profitability & { key: string; npl: number; warr: number };

export function SectorPerformancePage() {
  const { facilities, obligors, sectors, large, rules } = usePortfolioModel();
  const [dim, setDim] = useState<Dim>("sector");
  const p = usePortfolioParams();
  const obligorById = useMemo(() => new Map(obligors.map((o) => [o.id, o])), [obligors]);
  const sectorName = useMemo(() => new Map(sectors.map((s) => [s.id, s.name])), [sectors]);
  const live = useMemo(() => liveFacilities(facilities), [facilities]);
  // `rules` in deps: profitability reads business rules at call time.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `rules` re-runs rule-driven selectors
  const bank = useMemo(() => profitability(live, obligorById), [live, obligorById, rules]);

  const rows: Row[] = useMemo(() => {
    const keyOf = (f: Facility) => {
      const o = obligorById.get(f.obligorId);
      if (dim === "sector") return sectorName.get(o?.sectorId ?? "") ?? "—";
      if (dim === "branch") return f.branch;
      if (dim === "tenor") return tenorBand(f.tenorMonths);
      if (dim === "product") return productGroup(f.product);
      return o ? rarPosition(o.rar).base : "—";
    };
    const groups = new Map<string, Facility[]>();
    for (const f of live) groups.set(keyOf(f), [...(groups.get(keyOf(f)) ?? []), f]);
    return [...groups.entries()]
      .map(([key, list]) => ({
        key,
        ...profitability(list, obligorById),
        npl: nplRatio(list),
        warr: computeWarr(list.map((f) => ({ exposure: warrExposure(f), grade: obligorById.get(f.obligorId)?.riskGrade ?? null, stage: f.stage }))).warr,
      }))
      .sort((a, b) => b.exposure - a.exposure);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rules` re-runs rule-driven selectors
  }, [live, obligorById, sectorName, dim, rules]);

  const hurdle = p.rarocHurdlePct.value;
  const below = rows.filter((r) => r.raroc < hurdle);

  const columns: DataTableColumn<Row>[] = [
    { id: "key", header: dims.find((d) => d.value === dim)!.label, accessor: "key", sortable: true, cell: (r) => <span className="font-semibold text-fg">{r.key}</span> },
    { id: "exposure", header: "Exposure", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
    { id: "rwa", header: "RWA", accessor: "rwa", numeric: true, sortable: true, cell: (r) => moneyShort(r.rwa) },
    { id: "capital", header: "Capital consumed", accessor: "capital", numeric: true, sortable: true, cell: (r) => moneyShort(r.capital) },
    { id: "nii", header: "NII", accessor: "nii", numeric: true, sortable: true, cell: (r) => moneyShort(r.nii) },
    { id: "ecl", header: "ECL", accessor: "ecl", numeric: true, sortable: true, cell: (r) => moneyShort(r.ecl) },
    { id: "nim", header: "NIM", accessor: "nim", numeric: true, sortable: true, cell: (r) => pct(r.nim) },
    { id: "raroc", header: "RAROC", accessor: "raroc", numeric: true, sortable: true, cell: (r) => pct(r.raroc, 0) },
    { id: "npl", header: "NPL ratio", accessor: "npl", numeric: true, sortable: true, cell: (r) => pct(r.npl, 2) },
    { id: "warr", header: "WARR", accessor: "warr", numeric: true, sortable: true, cell: (r) => r.warr.toFixed(2) },
    { id: "status", header: "vs hurdle", accessor: (r) => (r.raroc >= hurdle ? "Above hurdle" : "Below hurdle"), cell: (r) => <StatusBadge status={r.raroc >= hurdle ? "Above hurdle" : "Below hurdle"} tones={{ "Above hurdle": "success", "Below hurdle": "danger" }} /> },
  ];

  return (
    <ModulePage module="portfolio" description="Sector performance analysis and multi-dimensional segment profitability: capital consumption, RAROC and NIM read together with NPL and WARR.">
      <Stack gap="large">
        <Alert tone="info" title={<span className="inline-flex items-center gap-2">Phase 2 capability <PhaseBadge phase={2} /></span>}>
          Until the GL, cost-allocation and IFRS 9 feeds are live, income, cost, risk-weight and ECL inputs use the demo parameters listed below. A segment with improving RAROC on a deteriorating WARR is earning its return by taking more risk — read it as a warning.
        </Alert>

        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <KpiCard
            label="Bank-wide RAROC"
            value={pct(bank.raroc, 0)}
            hint={`Hurdle ${pct(hurdle, 0)} (demo)`}
            tone={bank.raroc >= hurdle ? "success" : "danger"}
            calc={{
              metric: "RAROC",
              formula: "RAROC = (Net interest income + Fee income − Operating cost allocation − Expected credit loss) / Capital consumption",
              source: "NII & fees: CBA GL / product sub-ledger. Opex: cost-allocation key. ECL: IFRS 9 engine — demo proxy here. Capital: as below.",
              prd: "§6.6.5, §8",
              demo: true,
              inputs: [
                { label: "NII", value: moneyShort(bank.nii) },
                { label: "Fees", value: moneyShort(bank.fees) },
                { label: "Opex", value: moneyShort(bank.opex) },
                { label: "ECL", value: moneyShort(bank.ecl) },
                { label: "Capital", value: moneyShort(bank.capital) },
              ],
            }}
          />
          <KpiCard
            label="Capital consumption"
            value={moneyShort(bank.capital)}
            hint={`RWA ${moneyShort(bank.rwa)} × ${p.minCarPct.value}% min CAR`}
            tone="warning"
            calc={{ metric: "capital consumption", formula: "Capital consumption = Sector RWA × Minimum capital adequacy ratio", source: `RWA: exposure (off-balance at CCF) × risk weight per the tenant Basel/CBN table (demo weights). Min CAR ${p.minCarPct.value}% (business rule,: national authorisation; 15% international or SIB).`, prd: "§6.6.5", demo: true }}
          />
          <KpiCard
            label="Net interest margin"
            value={pct(bank.nim, 1)}
            hint="Annualised on funded book"
            tone="info"
            calc={{ metric: "NIM", formula: "(Interest income − Interest expense) / Average interest-earning assets", source: "Interest income: facility rate × outstanding. Interest expense: demo cost of funds. Prototype uses period-end balances as the average.", prd: "§6.6.5", demo: true }}
          />
          <KpiCard
            label="Large exposures to capital"
            value={pct(large.toCapitalPct, 0)}
            hint={`${large.list.length} obligors ≥${p.largeExposurePct.value}% of SHF`}
            tone="accent"
            calc={{ metric: "large exposures to capital", formula: "Aggregate large exposures / Total qualifying capital × 100", source: `Large exposures: obligors/groups ≥${p.largeExposurePct.value}% of SHF (CBN 3.2(d)). TQC: GL capital accounts (demo value).`, prd: "§6.6.5", demo: true }}
          />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Panel title="RAROC vs capital consumed" description={`Bubble size = exposure. ${below.length} of ${rows.length} segments below the ${pct(hurdle, 0)} hurdle.`}>
            <ScatterChart
              label="RAROC against capital consumption by segment"
              height={300}
              xLabel="Capital consumed"
              yLabel="RAROC"
              xFormatter={moneyShort}
              yFormatter={(v) => pct(v, 0)}
              showLabels={rows.length <= 6}
              referenceLines={[{ axis: "y", value: hurdle, label: "Hurdle", tone: "danger" }]}
              series={[
                { name: "Above hurdle", tone: "success", points: rows.filter((r) => r.raroc >= hurdle).map((r) => ({ x: r.capital, y: r.raroc, size: r.exposure, label: r.key })) },
                { name: "Below hurdle", tone: "danger", points: below.map((r) => ({ x: r.capital, y: r.raroc, size: r.exposure, label: r.key })) },
              ]}
            />
          </Panel>
          <Panel title="Risk-adjusted return build" description="Bank-wide, annualised: from interest income to the RAROC numerator.">
            <WaterfallChart
              label="Risk-adjusted return waterfall"
              height={300}
              valueFormatter={moneyShort}
              steps={[
                { label: "Int. income", value: bank.interestIncome, type: "start", caption: "Interest income" },
                { label: "Int. expense", value: -bank.interestExpense, caption: "Interest expense" },
                { label: "Fees", value: bank.fees },
                { label: "Opex", value: -bank.opex },
                { label: "ECL", value: -bank.ecl },
                { label: "Net", type: "total", caption: "Risk-adjusted return" },
              ]}
            />
          </Panel>
        </Grid>

        <Panel
          title="Segment profitability & performance"
          description="Each dimension is independently reportable; WARR shown on every row."
          actions={<Select aria-label="Segment dimension" size="small" value={dim} onChange={(e) => setDim(e.target.value as Dim)} options={dims} />}
        >
          <DataTable label="Segment profitability" data={rows} columns={columns} getRowId={(r) => r.key} paginate={rows.length > 15} exportFilename={`raroc-by-${dim}.csv`} defaultSort={{ id: "raroc", direction: "desc" }} />
        </Panel>

        <RulesPanel
          title="Inputs in force"
          description="Business rules used above (Rules & Parameters Engine). Demo values are placeholders until the tenant configures them; changes are approved in Operations."
          keys={[
            PARAM_RULES.minCarPct,
            PARAM_RULES.rarocHurdlePct,
            PARAM_RULES.costOfFundsPct,
            PARAM_RULES.feeIncomePct,
            PARAM_RULES.opexAllocationPct,
            PORTFOLIO_RULES.eclStage1Pct,
            PORTFOLIO_RULES.eclStage2Pct,
            PORTFOLIO_RULES.eclSubstandardPct,
            PORTFOLIO_RULES.eclDoubtfulPct,
            PORTFOLIO_RULES.eclLostPct,
            ...OBLIGOR_TYPES.map(riskWeightRuleKey),
          ]}
        />
      </Stack>
    </ModulePage>
  );
}
