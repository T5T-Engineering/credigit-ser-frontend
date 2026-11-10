"use client";

import { useMemo, useState } from "react";
import { FileText, Play } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Drawer,
  Grid,
  PhaseBadge,
  Stack,
  StatusBadge,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { dateTime, money, moneyShort, number, pct } from "@/lib/format";
import { KpiCard } from "../components/calc-note";
import { Panel } from "../components/panel";
import { reconciliation, reportCatalogue, type ReportDef } from "../data";
import { useActor, usePortfolioModel } from "../hooks";
import { CBN_CLASSES, computeWarr, liveFacilities, onBalance, sum } from "../selectors";
import { usePortfolioStore, type ReportRun, type ReportRunStatus } from "../store";

const runTones: Record<ReportRunStatus, "info" | "warning" | "success" | "brand"> = {
  Generating: "info",
  "AI-drafted — awaiting validation": "warning",
  Validated: "info",
  Released: "success",
};
const audienceTone = { "CBN return": "danger", "Board pack": "accent", MIS: "info" } as const;

type PreviewTable = { columns: Array<{ id: string; header: string; numeric?: boolean }>; rows: Array<Record<string, string | number>>; source: string };

export function ReportsPage() {
  const model = usePortfolioModel();
  const canEdit = useCan("portfolio", "edit");
  const actor = useActor();
  const runs = usePortfolioStore((s) => s.runs);
  const addRun = usePortfolioStore((s) => s.addRun);
  const updateRun = usePortfolioStore((s) => s.updateRun);
  const [preview, setPreview] = useState<{ report: ReportDef; run?: ReportRun } | null>(null);
  const recon = useMemo(() => reconciliation(model.facilities), [model.facilities]);
  const reconciled = recon.every((r) => r.difference === 0);

  const lastRun = (id: string) => runs.find((r) => r.reportId === id);
  const awaiting = runs.filter((r) => r.status === "AI-drafted — awaiting validation" || r.status === "Validated");
  const released = runs.filter((r) => r.status === "Released" && r.releasedAt && new Date(r.releasedAt) >= new Date("2026-11-01"));

  const generate = (rep: ReportDef) => {
    const id = `RUN-${Date.now().toString(36).toUpperCase()}`;
    const period = rep.cadence === "Daily" ? "10 Nov 2026" : rep.cadence === "Weekly" ? "Week 46, 2026" : rep.cadence === "Quarterly" ? "Q4 2026 (to date)" : "Nov 2026 (to date)";
    addRun({ id, reportId: rep.id, period, status: "Generating", generatedAt: new Date().toISOString(), generatedBy: actor.name, reconciled });
    actor.log("Generated report", "Report", id, undefined, `${rep.name} — ${period}`);
    window.setTimeout(() => updateRun(id, { status: "AI-drafted — awaiting validation" }), 1200);
  };
  const validate = (run: ReportRun) => {
    updateRun(run.id, { status: "Validated", validatedBy: actor.name });
    actor.log("Validated report", "Report", run.id, run.status, "Validated");
  };
  const release = (run: ReportRun) => {
    updateRun(run.id, { status: "Released", releasedBy: actor.name, releasedAt: new Date().toISOString() });
    actor.log("Released report", "Report", run.id, run.status, "Released");
  };

  const catalogueColumns: DataTableColumn<ReportDef>[] = [
    { id: "name", header: "Report", accessor: "name", sortable: true, cell: (r) => (
      <span className="flex flex-col gap-1">
        <span className="inline-flex flex-wrap items-center gap-2 font-semibold text-fg">{r.name}{r.phase > 1 ? <PhaseBadge phase={r.phase} /> : null}</span>
        <span className="text-xs text-fg-subtle">{r.description}</span>
      </span>
    ) },
    { id: "audience", header: "Type", accessor: "audience", sortable: true, cell: (r) => <Badge tone={audienceTone[r.audience]} variant="soft">{r.audience}</Badge> },
    { id: "cadence", header: "Cadence", accessor: "cadence", sortable: true },
    { id: "prd", header: "Basis", accessor: "prd", cell: (r) => <span className="font-mono text-xs">{r.prd}</span> },
    { id: "last", header: "Latest run", accessor: (r) => lastRun(r.id)?.status ?? "Never run", cell: (r) => {
      const run = lastRun(r.id);
      return run ? <span className="flex flex-col items-start gap-1"><StatusBadge status={run.status} tones={runTones} /><span className="text-xs text-fg-subtle">{run.period}</span></span> : <span className="text-fg-subtle">Never run</span>;
    } },
    { id: "actions", header: "Actions", exportable: false, cell: (r) => (
      <span className="flex flex-wrap gap-2">
        <Button size="small" variant="tertiary" iconBefore={<FileText size={14} aria-hidden />} onClick={() => setPreview({ report: r, run: lastRun(r.id) })}>Preview</Button>
        {canEdit ? <Button size="small" variant="secondary" iconBefore={<Play size={14} aria-hidden />} onClick={() => generate(r)}>Generate</Button> : null}
      </span>
    ) },
  ];

  const runColumns: DataTableColumn<ReportRun>[] = [
    { id: "id", header: "Run", accessor: "id", cell: (r) => <span className="font-mono text-fg">{r.id}</span> },
    { id: "report", header: "Report", accessor: (r) => reportCatalogue.find((x) => x.id === r.reportId)?.name ?? r.reportId, sortable: true },
    { id: "period", header: "Period", accessor: "period" },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (r) => <StatusBadge status={r.status} tones={runTones} /> },
    { id: "recon", header: "Reconciled to CBA", accessor: (r) => (r.reconciled ? "Yes" : "Break open"), cell: (r) => <StatusBadge status={r.reconciled ? "Reconciled" : "Break open"} tones={{ Reconciled: "success", "Break open": "warning" }} /> },
    { id: "gen", header: "Generated", accessor: "generatedAt", sortable: true, cell: (r) => <span className="flex flex-col"><span>{dateTime(r.generatedAt)}</span><span className="text-xs text-fg-subtle">{r.generatedBy}</span></span>, csv: (r) => `${r.generatedAt} ${r.generatedBy}` },
    { id: "released", header: "Released by", accessor: (r) => r.releasedBy ?? "", cell: (r) => r.releasedBy ?? "—" },
    { id: "act", header: "Actions", exportable: false, cell: (r) => (
      <span className="flex flex-wrap gap-2">
        <Button size="small" variant="tertiary" onClick={() => setPreview({ report: reportCatalogue.find((x) => x.id === r.reportId)!, run: r })}>Open</Button>
        {canEdit && r.status === "AI-drafted — awaiting validation" ? <Button size="small" variant="secondary" onClick={() => validate(r)}>Validate</Button> : null}
        {canEdit && r.status === "Validated" ? <Button size="small" variant="primary" disabled={!r.reconciled} onClick={() => release(r)}>Release</Button> : null}
      </span>
    ) },
  ];

  const table = preview ? previewTable(preview.report, model) : null;

  return (
    <ModulePage module="portfolio" description="Executive & regulatory reporting (§6.6.6): CBN-format returns, board packs and MIS on the cadence configured in the Rules & Parameters Engine — AI-drafted, then validated and released by the Portfolio & MIS Reporting Officer.">
      <Stack gap="large">
        {!reconciled ? (
          <Alert tone="warning" title="Release is blocked while a CBA reconciliation break is open">
            {recon.filter((r) => r.difference).map((r) => `${r.ledger}: ${money(r.difference)} — ${r.note}`).join(" ")} New runs generated now are marked &quot;Break open&quot; and cannot be released until the break is cleared.
          </Alert>
        ) : null}

        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <KpiCard label="Reports in catalogue" value={String(reportCatalogue.length)} hint={`${reportCatalogue.filter((r) => r.audience === "CBN return").length} CBN returns · ${reportCatalogue.filter((r) => r.audience === "Board pack").length} board packs`} calc={{ metric: "report catalogue", formula: "Configured report templates × cadence", source: "Rules & Parameters Engine reporting cadence (daily, weekly, monthly, quarterly, annual).", prd: "§6.6.6" }} />
          <KpiCard label="Awaiting validation / release" value={String(awaiting.length)} hint="AI-drafted runs need a named human sign-off" tone="warning" calc={{ metric: "awaiting validation", formula: "Runs in AI-drafted or Validated status", source: "Auto-report generation (§6.12) — the MIS officer validates and releases.", prd: "§6.12" }} />
          <KpiCard label="Released this month" value={String(released.length)} hint="November 2026" tone="success" calc={{ metric: "released reports", formula: "Runs released since 1 Nov 2026", source: "Report run register (audit-logged).", prd: "§6.6.6" }} />
          <KpiCard label="CBA reconciliation" value={reconciled ? "Clean" : `${recon.filter((r) => r.difference).length} break`} hint={`As at ${dateTime(DEMO_NOW)}`} tone={reconciled ? "success" : "warning"} calc={{ metric: "reconciliation status", formula: "Σ spine outstanding vs CBA GL, per ledger", source: "CBA connector staging/reconciliation layer (§5.1).", prd: "§5.1" }} />
        </Grid>

        <Panel title="Report catalogue" description="CBN returns re-aggregate sectors onto the CBN classification regardless of the tenant taxonomy (§6.6.1). Return templates/codes are tenant configuration.">
          <DataTable label="Report catalogue" data={reportCatalogue} columns={catalogueColumns} getRowId={(r) => r.id} paginate={false} filters={[{ id: "audience", label: "Type" }, { id: "cadence", label: "Cadence" }]} searchable searchPlaceholder="Search reports" />
        </Panel>

        <Panel title="Run register" description="Every generation, validation and release is written to the audit log. Export the register as CSV.">
          <DataTable label="Report runs" data={runs} columns={runColumns} getRowId={(r) => r.id} defaultPageSize={10} exportFilename="report-run-register.csv" filters={[{ id: "status", label: "Status" }]} />
        </Panel>
      </Stack>

      <Drawer
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        size="large"
        title={preview?.report.name ?? ""}
        description={preview ? `${preview.report.audience} · ${preview.report.cadence} · ${preview.run ? `${preview.run.period} — ${preview.run.status}` : "Live preview (not yet generated)"}` : undefined}
      >
        {preview && table ? (
          <Stack gap="medium">
            {preview.run?.status === "AI-drafted — awaiting validation" ? (
              <Alert tone="warning" title="AI-drafted">Templated draft generated on schedule. A named Portfolio & MIS Reporting Officer must validate it before release.</Alert>
            ) : null}
            <DescriptionList
              columns={2}
              items={[
                { label: "Basis", value: preview.report.prd, mono: true },
                { label: "Run", value: preview.run?.id ?? "Live preview", mono: true },
                { label: "Validated by", value: preview.run?.validatedBy },
                { label: "Released by", value: preview.run?.releasedBy },
              ]}
            />
            <Text variant="caption">Source mapping (§8): {table.source}</Text>
            <DataTable
              label={preview.report.name}
              data={table.rows}
              getRowId={(_, i) => String(i)}
              defaultPageSize={10}
              exportFilename={`${preview.report.id.toLowerCase()}-${(preview.run?.period ?? "preview").replace(/\W+/g, "-").toLowerCase()}.csv`}
              exportLabel="Download CSV"
              columns={table.columns.map((c) => ({ id: c.id, header: c.header, accessor: (r: Record<string, string | number>) => r[c.id], numeric: c.numeric, cell: (r: Record<string, string | number>) => (typeof r[c.id] === "number" && c.numeric ? fmt(c.id, r[c.id] as number) : String(r[c.id] ?? "")) }))}
            />
          </Stack>
        ) : null}
      </Drawer>
    </ModulePage>
  );
}

function fmt(id: string, v: number) {
  if (id.endsWith("Pct")) return pct(v, 2);
  if (id === "count" || id === "dpd" || id === "grade") return number(v);
  if (id === "warr") return v.toFixed(2);
  return moneyShort(v);
}

/** Rows for the report preview, computed from the same selectors as the dashboards. */
function previewTable(rep: ReportDef, m: ReturnType<typeof usePortfolioModel>): PreviewTable {
  const obligorById = new Map(m.obligors.map((o) => [o.id, o]));
  const sectorName = new Map(m.sectors.map((s) => [s.id, s.name]));
  switch (rep.id) {
    case "RPT-SOL":
      return {
        source: "CBA facility ledger (sector code at origination); limits from the Rules & Parameters Engine; SHF from GL capital accounts.",
        columns: [{ id: "sector", header: "Sector" }, { id: "exposure", header: "Outstanding", numeric: true }, { id: "sharePct", header: "% of book", numeric: true }, { id: "limitPct", header: "Limit %", numeric: true }, { id: "status", header: "Status" }],
        rows: m.sectorRows.map((s) => ({ sector: s.sector.name, exposure: s.exposure, sharePct: s.sharePct, limitPct: s.limitPct, status: s.status })),
      };
    case "RPT-LEX":
      return {
        source: "CBA facility ledger; large exposure ≥10% SHF (CBN 3.2(d)); aggregate ceiling 8× SHF (CBN 3.2(e)).",
        columns: [{ id: "obligor", header: "Obligor" }, { id: "exposure", header: "Weighted exposure", numeric: true }, { id: "shfPct", header: "% of SHF", numeric: true }],
        rows: m.large.list.map((e) => ({ obligor: e.obligor.name, exposure: e.solExposure, shfPct: e.pctOfShf })),
      };
    case "RPT-PRU":
    case "RPT-NPL":
      return {
        source: "CBA facility ledger with CBN classification (90/180/360-day thresholds, CBN 12.1); provisioning rates CBN 12.2.",
        columns: [{ id: "cls", header: "CBN class" }, { id: "count", header: "Facilities", numeric: true }, { id: "outstanding", header: "Outstanding", numeric: true }, { id: "sharePct", header: "% of gross loans", numeric: true }],
        rows: CBN_CLASSES.map((c) => {
          const list = liveFacilities(m.facilities).filter((f) => f.cbnClass === c);
          return { cls: c, count: list.length, outstanding: sum(list, onBalance), sharePct: m.totals.grossLoans ? (sum(list, onBalance) / m.totals.grossLoans) * 100 : 0 };
        }),
      };
    case "RPT-TOP":
    case "RPT-BRC":
      return {
        source: "CBA facility ledger, ranked by outstanding exposure; IFRS 9 stage (§6.7.1); 360 RAR posture (§6.2.5).",
        columns: [{ id: "rank", header: "#", numeric: true }, { id: "obligor", header: "Obligor" }, { id: "exposure", header: "Exposure", numeric: true }, { id: "shfPct", header: "% of SHF", numeric: true }, { id: "sector", header: "Sector" }, { id: "stage", header: "Stage" }, { id: "posture", header: "Posture" }],
        rows: m.exposures.slice(0, 20).map((e, i) => ({ rank: i + 1, obligor: e.obligor.name, exposure: e.exposure, shfPct: e.pctOfShf, sector: e.sector?.name ?? "—", stage: `Stage ${e.worstStage}`, posture: e.posture })),
      };
    case "RPT-WARR":
    case "RPT-RAROC":
    case "RPT-PLAN": {
      const groups = new Map<string, typeof m.rows>();
      for (const r of m.rows) groups.set(sectorName.get(r.obligor.sectorId) ?? "—", [...(groups.get(sectorName.get(r.obligor.sectorId) ?? "—") ?? []), r]);
      return {
        source: "Internal grades (§6.2.7), grade-score table GST-2026.1 (demo); exposure = outstanding + undrawn × CCF.",
        columns: [{ id: "sector", header: "Sector" }, { id: "exposure", header: "Exposure", numeric: true }, { id: "warr", header: "WARR", numeric: true }],
        rows: [...groups.entries()].map(([sector, list]) => ({ sector, exposure: sum(list, (r) => r.exposure), warr: computeWarr(list).warr })),
      };
    }
    case "RPT-DPD":
      return {
        source: "CBA facility ledger due-date and last-payment fields (§8 Past-Due Obligations).",
        columns: [{ id: "facility", header: "Facility" }, { id: "obligor", header: "Obligor" }, { id: "branch", header: "Branch" }, { id: "dpd", header: "DPD", numeric: true }, { id: "outstanding", header: "Outstanding", numeric: true }, { id: "cls", header: "CBN class" }],
        rows: liveFacilities(m.facilities).filter((f) => f.dpd > 0).sort((a, b) => b.dpd - a.dpd).map((f) => ({ facility: f.id, obligor: obligorById.get(f.obligorId)?.name ?? f.obligorId, branch: f.branch, dpd: f.dpd, outstanding: f.outstanding, cls: f.cbnClass })),
      };
    default: {
      const groups = new Map<string, number>();
      for (const f of liveFacilities(m.facilities)) groups.set(f.product, (groups.get(f.product) ?? 0) + onBalance(f));
      return {
        source: "CBA facility ledger and Loan Origination records (§6.6.1).",
        columns: [{ id: "product", header: "Product" }, { id: "outstanding", header: "Outstanding", numeric: true }],
        rows: [...groups.entries()].map(([product, outstanding]) => ({ product, outstanding })),
      };
    }
  }
}
