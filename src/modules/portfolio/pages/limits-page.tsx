"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  DataTable,
  Grid,
  ProgressBar,
  SegmentedControl,
  Stack,
  StatusBadge,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { money, moneyShort, number, pct } from "@/lib/format";
import { KpiCard } from "../components/calc-note";
import { useRule } from "@/lib/platform/rules";
import { RulesPanel } from "../components/governance";
import { Panel } from "../components/panel";
import { reaggregateToCbn } from "../data";
import { useLimitMonitor, usePortfolioModel } from "../hooks";
import { PARAM_RULES, PORTFOLIO_RULES } from "../rule-keys";
import { hash01, limitStatus, limitStatusTone, liveFacilities, usePortfolioParams, type ObligorExposure, type SectorExposure } from "../selectors";

const statusTones = { "Within limit": "success", "Near breach": "warning", Breach: "danger" } as const;

export function LimitsPage() {
  const model = usePortfolioModel();
  const { sectorRows, exposures, large, totals, facilities, obligors } = model;
  useLimitMonitor(model);
  const [taxonomy, setTaxonomy] = useState<"tenant" | "cbn">("tenant");
  const p = usePortfolioParams();
  const floor = useRule<number>(PORTFOLIO_RULES.obligorReportFloorPct);
  const shf = p.shareholdersFunds.value;
  const solPct = p.singleObligorLimitPct.value;
  const offWeight = p.offBalanceSolWeight.value;
  const lexPct = p.largeExposurePct.value;
  const lexMultiple = p.aggregateLargeExposureMultiple.value;
  const sol = (shf * solPct) / 100;
  const gov = sectorRows.find((s) => s.statutory);
  const sectorBreaches = sectorRows.filter((s) => s.status !== "Within limit");
  const obligorRows = exposures.filter((e) => e.solUtilisationPct >= floor);
  const obligorFlags = exposures.filter((e) => limitStatus(e.solUtilisationPct) !== "Within limit");
  const top = exposures[0];

  const cbnRows = useMemo(
    () => reaggregateToCbn(sectorRows.map((s) => ({ sectorId: s.sector.id, exposure: s.exposure, npl: s.npl }))).map((r) => ({ ...r, share: totals.grossLoans ? (r.exposure / totals.grossLoans) * 100 : 0 })),
    [sectorRows, totals.grossLoans],
  );

  const obligorName = useMemo(() => new Map(obligors.map((o) => [o.id, o.name])), [obligors]);
  const fcy = liveFacilities(facilities).filter((f) => f.currency === "USD");

  const sectorColumns: DataTableColumn<SectorExposure>[] = [
    { id: "sector", header: "Sector", accessor: (r) => r.sector.name, sortable: true, cell: (r) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="font-semibold text-fg">{r.sector.name}</span>
        {r.statutory ? <Badge tone="info" variant="outline">CBN 3.2(c)</Badge> : null}
      </span>
    ) },
    { id: "exposure", header: "Outstanding", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
    { id: "share", header: "% of book", accessor: "sharePct", numeric: true, sortable: true, cell: (r) => pct(r.sharePct) },
    { id: "limit", header: "Limit", accessor: "limitPct", numeric: true, sortable: true, cell: (r) => pct(r.limitPct, 0) },
    { id: "util", header: "Utilisation", accessor: "utilisationPct", sortable: true, width: 160, cell: (r) => (
      <span className="flex flex-col gap-1"><span className="font-mono text-fg">{pct(r.utilisationPct, 0)}</span><ProgressBar value={Math.min(1, r.utilisationPct / 100)} tone={limitStatusTone[r.status]} ariaLabel={`${r.sector.name} utilisation ${pct(r.utilisationPct, 0)}`} size="small" /></span>
    ), csv: (r) => r.utilisationPct.toFixed(1) },
    { id: "headroom", header: "Headroom", accessor: "headroom", numeric: true, sortable: true, cell: (r) => moneyShort(r.headroom) },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (r) => <StatusBadge status={r.status} tones={statusTones} /> },
  ];

  const obligorColumns: DataTableColumn<ObligorExposure>[] = [
    { id: "name", header: "Obligor", accessor: (r) => r.obligor.name, sortable: true, cell: (r) => <span className="font-semibold text-fg">{r.obligor.name}</span> },
    { id: "sector", header: "Sector", accessor: (r) => r.sector?.name ?? "—", sortable: true },
    { id: "on", header: "On-balance", accessor: "onBalance", numeric: true, sortable: true, cell: (r) => moneyShort(r.onBalance) },
    { id: "off", header: "Off-balance", accessor: "offBalance", numeric: true, sortable: true, cell: (r) => (r.offBalance ? moneyShort(r.offBalance) : "—") },
    { id: "sol", header: "Weighted exposure", accessor: "solExposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.solExposure) },
    { id: "shf", header: "% of SHF", accessor: "pctOfShf", numeric: true, sortable: true, cell: (r) => pct(r.pctOfShf) },
    { id: "util", header: "Limit utilisation", accessor: "solUtilisationPct", sortable: true, width: 160, cell: (r) => (
      <span className="flex flex-col gap-1"><span className="font-mono text-fg">{pct(r.solUtilisationPct, 0)}</span><ProgressBar value={Math.min(1, r.solUtilisationPct / 100)} tone={limitStatusTone[limitStatus(r.solUtilisationPct)]} ariaLabel={`${r.obligor.name} limit utilisation ${pct(r.solUtilisationPct, 0)}`} size="small" /></span>
    ), csv: (r) => r.solUtilisationPct.toFixed(1) },
    { id: "large", header: "Large exposure", accessor: (r) => (r.pctOfShf >= lexPct ? "Yes" : "No"), cell: (r) => (r.pctOfShf >= lexPct ? <Badge tone="info">≥{lexPct}% SHF</Badge> : "—") },
    { id: "status", header: "Status", accessor: (r) => limitStatus(r.solUtilisationPct), sortable: true, cell: (r) => <StatusBadge status={limitStatus(r.solUtilisationPct)} tones={statusTones} /> },
  ];

  const ruleKeys = [
    PARAM_RULES.shareholdersFunds,
    PARAM_RULES.singleObligorLimitPct,
    PARAM_RULES.offBalanceSolWeight,
    PARAM_RULES.largeExposurePct,
    PARAM_RULES.aggregateLargeExposureMultiple,
    PARAM_RULES.governmentCeilingPct,
    PARAM_RULES.earlyWarningPct,
    PARAM_RULES.totalQualifyingCapital,
    PORTFOLIO_RULES.limitAlertRoles,
    PORTFOLIO_RULES.obligorReportFloorPct,
  ];

  return (
    <ModulePage module="portfolio" description="Sectoral & single-obligor limit report — the full facility book against internal sectoral limits and the statutory CBN limits, with breaches and near-breaches flagged.">
      <Stack gap="large">
        {sectorBreaches.length || obligorFlags.length ? (
          <Alert tone="danger" title={`${sectorBreaches.filter((s) => s.status === "Breach").length} sector breaches · ${sectorBreaches.filter((s) => s.status === "Near breach").length} near-breaches · ${obligorFlags.length} obligor flags`}>
            Breaches and near-breaches (≥ {p.earlyWarningPct.value}% of limit, tenant early-warning threshold) are notified to the roles in the limit-alert rule and escalated through the protocol. New requests in these sectors are gated at origination.
          </Alert>
        ) : null}

        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <KpiCard
            label="Single-obligor limit"
            value={moneyShort(sol)}
            hint={`${solPct}% of SHF ${moneyShort(shf)} (demo SHF)`}
            calc={{ metric: "single-obligor limit", formula: `${solPct}% × Shareholders' funds unimpaired by losses`, source: "CBN 3.2(a). Shareholders' funds: GL capital accounts (paid-up capital + reserves, net of identified losses) — demo value for this tenant.", prd: "§5.6, §8", demo: true }}
          />
          <KpiCard
            label="Largest obligor utilisation"
            value={top ? pct(top.solUtilisationPct, 0) : "—"}
            hint={top?.obligor.name}
            tone={top && top.solUtilisationPct >= 100 ? "danger" : top && top.solUtilisationPct >= p.earlyWarningPct.value ? "warning" : "brand"}
            calc={{
              metric: "single-obligor utilisation",
              formula: `(On-balance-sheet exposure + ${pct(offWeight, 2)} × off-balance-sheet exposure) / Shareholders' funds unimpaired by losses`,
              source: `Exposure: CBA facility ledger for the obligor/connected group (CBN 3.2(a)–(b)). Utilisation shown against the ${solPct}% limit.`,
              prd: "§8",
              inputs: top ? [
                { label: "On-balance", value: money(top.onBalance) },
                { label: `Off-balance × ${pct(offWeight, 2)}`, value: money((top.offBalance * offWeight) / 100) },
                { label: "Limit", value: money(sol) },
              ] : undefined,
            }}
          />
          <KpiCard
            label="Government exposure"
            value={gov ? pct(gov.sharePct) : "—"}
            hint={`Ceiling ${p.governmentCeilingPct.value}% of total credit portfolio`}
            tone={gov?.status === "Breach" ? "danger" : gov?.status === "Near breach" ? "warning" : "success"}
            calc={{ metric: "government exposure", formula: "All-tiers-of-government outstanding / Total credit portfolio × 100", source: `Tracked separately against the ${p.governmentCeilingPct.value}% ceiling (CBN 3.2(c)).`, prd: "§6.6.2" }}
          />
          <KpiCard
            label="Aggregate large exposures"
            value={moneyShort(large.aggregate)}
            hint={`${large.list.length} obligors ≥${lexPct}% SHF · ${pct(large.utilisationPct)} of ${lexMultiple}× SHF ceiling`}
            tone="info"
            calc={{
              metric: "aggregate large exposures",
              formula: `Σ weighted exposure of obligors ≥ ${lexPct}% of SHF, vs ${lexMultiple} × SHF`,
              source: "Large exposure definition CBN 3.2(d); aggregate ceiling CBN 3.2(e).",
              prd: "§5.6",
              inputs: [
                { label: `Ceiling (${lexMultiple}× SHF)`, value: moneyShort(large.ceiling) },
                { label: "Large exposures to capital", value: pct(large.toCapitalPct) },
              ],
              demo: true,
            }}
          />
        </Grid>

        <Panel
          title="Sectoral limits"
          description={taxonomy === "tenant" ? "Tenant internal sector taxonomy vs the internal sectoral concentration limit (% of total loan book)." : "Re-aggregated onto the CBN standard industry classification for regulatory returns (mapped with % splits)."}
          calc={{ metric: "sectoral exposure", formula: "Sector outstanding balance / Total portfolio outstanding × 100; utilisation = exposure % / limit %", source: "Numerator: CBA facility ledger filtered by the sector code assigned at origination. Denominator: CBA facility ledger, full book. Sector limits: tenant parameters (demo values).", prd: "§8, §6.6.2", demo: true }}
          actions={
            <SegmentedControl
              label="Sector taxonomy"
              size="small"
              value={taxonomy}
              onChange={setTaxonomy}
              options={[
                { value: "tenant", label: "Tenant taxonomy" },
                { value: "cbn", label: "CBN classification" },
              ]}
            />
          }
        >
          {taxonomy === "tenant" ? (
            <DataTable label="Sectoral limits" data={sectorRows} columns={sectorColumns} getRowId={(r) => r.sector.id} paginate={false} exportFilename="sectoral-limit-report.csv" defaultSort={{ id: "util", direction: "desc" }} />
          ) : (
            <DataTable
              label="Sector exposure on CBN classification"
              data={cbnRows}
              getRowId={(r) => r.cbn}
              paginate={false}
              exportFilename="sector-exposure-cbn-classification.csv"
              columns={[
                { id: "cbn", header: "CBN classification", accessor: "cbn", sortable: true, cell: (r) => <span className="font-semibold text-fg">{r.cbn}</span> },
                { id: "exposure", header: "Outstanding", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
                { id: "share", header: "% of book", accessor: "share", numeric: true, sortable: true, cell: (r) => pct(r.share) },
                { id: "npl", header: "NPL", accessor: "npl", numeric: true, sortable: true, cell: (r) => (r.npl ? moneyShort(r.npl) : "—") },
                { id: "src", header: "Tenant sector codes", accessor: (r) => r.sources.join(", ") },
              ]}
            />
          )}
        </Panel>

        <Panel
          title="Single-obligor limit"
          description={`Obligors above ${floor}% of the ${moneyShort(sol)} limit. Connected-group aggregation applies where groups are configured.`}
          calc={{ metric: "single-obligor utilisation", formula: `(On-balance + ${pct(offWeight, 2)} × off-balance) / SHF; limit = ${solPct}% of SHF`, source: "CBN 3.2(a)–(b). The off-balance weighting applies to the statutory limit only; RWA uses CCFs.", prd: "§8, §9.1" }}
        >
          <DataTable
            label="Single-obligor limit utilisation"
            data={obligorRows}
            columns={obligorColumns}
            getRowId={(r) => r.obligor.id}
            searchable
            searchPlaceholder="Search obligors"
            defaultPageSize={10}
            exportFilename="single-obligor-limit-report.csv"
            filters={[{ id: "status", label: "Status" }]}
          />
        </Panel>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <RulesPanel title="Limit parameters in force" description="Business rules (Rules & Parameters Engine). Changes are requested in Operations, approved, audited and apply immediately across modules." keys={ruleKeys} />
          <Panel title="Foreign-currency lending — currency matching" description="CBN BSD/DIR/GEN/LAB/08/037: FCY facilities only to obligors with revenue in that currency. Ongoing portfolio control.">
            <DataTable
              label="FCY facilities"
              data={fcy}
              getRowId={(r) => r.id}
              paginate={false}
              emptyState={<span>No foreign-currency facilities on the book.</span>}
              columns={[
                { id: "id", header: "Facility", accessor: "id", cell: (r) => <span className="font-mono text-fg">{r.id}</span> },
                { id: "obl", header: "Obligor", accessor: (r) => obligorName.get(r.obligorId) ?? r.obligorId },
                { id: "prod", header: "Product", accessor: "product" },
                { id: "ev", header: "Revenue-currency evidence", accessor: (r) => (hash01(r.id) > 0.25 ? "On file" : "Missing"), cell: (r) => (hash01(r.id) > 0.25 ? <StatusBadge status="On file" tones={{ "On file": "success" }} /> : <StatusBadge status="Missing — exception" tones={{ "Missing — exception": "danger" }} />) },
              ]}
            />
          </Panel>
        </Grid>
        <p className="text-xs text-fg-subtle">
          {number(totals.facilityCount)} live facilities · {number(totals.obligorCount)} obligors · amounts on FCY facilities are held as NGN equivalents in the demo data.
        </p>
      </Stack>
    </ModulePage>
  );
}
