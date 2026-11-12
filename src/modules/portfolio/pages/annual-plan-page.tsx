"use client";

import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  FileUpload,
  Grid,
  PhaseBadge,
  ProgressBar,
  Select,
  StackedBarChart,
  Stack,
  StatusBadge,
  Text,
  useToast,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { getRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { date, moneyShort, pct } from "@/lib/format";
import { KpiCard } from "../components/calc-note";
import { PendingApproval, useSubmitOperation } from "../components/governance";
import { Panel } from "../components/panel";
import { sectorProjections, seedPlanVersions, type PlanVersion } from "../data";
import { useActor, usePortfolioModel } from "../hooks";
import type { PlanApprovalPayload } from "../platform";
import { PORTFOLIO_RULES } from "../rule-keys";
import { param } from "../selectors";
import { usePortfolioStore, type PlanStatus } from "../store";

const planTones: Record<PlanStatus, "success" | "warning" | "info" | "danger" | "neutral" | "brand"> = {
  "Board-approved": "success",
  Approved: "success",
  Draft: "neutral",
  "Uploaded — validating": "info",
  "Submitted for approval": "brand",
  Rejected: "danger",
  Superseded: "neutral",
};
const SUBMITTABLE: PlanStatus[] = ["Draft", "Rejected"];
/** Simulated plan-template validation latency (TD-506). */
const SIMULATED_INGEST_MS = 900;

type Flag = "Limit conflict" | "Cycle conflict" | "Reallocation opportunity" | "Aligned";
const flagTone = { "Limit conflict": "danger", "Cycle conflict": "warning", "Reallocation opportunity": "info", Aligned: "success" } as const;

type GuidanceRow = {
  sectorId: string;
  sector: string;
  planPct: number;
  actualPct: number;
  recommendedPct: number;
  limitPct: number;
  variancePp: number;
  plannedAmount: number;
  actualAmount: number;
  direction: string;
  phase: string;
  flag: Flag;
  rationale: string;
};

export function AnnualPlanPage() {
  const { facilities, obligors, sectors, sectorRows, totals } = usePortfolioModel();
  const canEdit = useCan("portfolio", "edit");
  const actor = useActor();
  const { actor: me } = useScope();
  const { toast } = useToast();
  const submit = useSubmitOperation();
  const uploaded = usePortfolioStore((s) => s.uploadedPlans);
  const activeId = usePortfolioStore((s) => s.activePlanId);
  const setActive = usePortfolioStore((s) => s.setActivePlan);
  const addPlan = usePortfolioStore((s) => s.addPlan);
  const planStatus = usePortfolioStore((s) => s.planStatus);
  const setPlanStatus = usePortfolioStore((s) => s.setPlanStatus);
  const operativeId = usePortfolioStore((s) => s.operativePlanId);
  const [ingesting, setIngesting] = useState(false);

  const seeded = useMemo(() => seedPlanVersions(sectors, totals.grossLoans), [sectors, totals.grossLoans]);
  const versions = [...uploaded, ...seeded];
  const statusOf = (v: PlanVersion): PlanStatus => planStatus[v.id] ?? v.status;
  const plan = versions.find((v) => v.id === activeId) ?? seeded[0]!;
  const original = seeded[0]!;
  const operative = versions.find((v) => v.id === operativeId) ?? original;
  const proj = useMemo(() => sectorProjections(facilities, obligors, sectors, "Base"), [facilities, obligors, sectors]);

  const rows: GuidanceRow[] = useMemo(() => {
    const ew = param("earlyWarningPct") / 100;
    const worse = getRule<number>(PORTFOLIO_RULES.planDeterioratingFactor);
    const better = getRule<number>(PORTFOLIO_RULES.planImprovingFactor);
    const raw = plan.lines.map((l) => {
      const pr = proj.find((x) => x.sector.id === l.sectorId);
      const adj = pr?.direction === "Deteriorating" ? worse : pr?.direction === "Improving" ? better : 1;
      return { l, pr, rec: l.targetPct * adj };
    });
    const totalRec = raw.reduce((a, r) => a + r.rec, 0) || 1;
    return raw.map(({ l, pr, rec }) => {
      const s = sectorRows.find((x) => x.sector.id === l.sectorId)!;
      const recommendedPct = Math.min((rec / totalRec) * 100, s.limitPct * ew);
      const flag: Flag =
        l.targetPct > s.limitPct || s.status === "Breach" ? "Limit conflict"
        : pr?.direction === "Deteriorating" && l.targetPct > s.sharePct ? "Cycle conflict"
        : pr?.direction === "Improving" && l.targetPct < recommendedPct - 0.5 ? "Reallocation opportunity"
        : "Aligned";
      const rationale =
        flag === "Limit conflict" ? `Planned ${pct(l.targetPct)} vs limit ${pct(s.limitPct, 0)}; current ${pct(s.sharePct)} (${s.status.toLowerCase()}).`
        : flag === "Cycle conflict" ? `Planned growth into a ${pr!.phase.toLowerCase()} phase; projected NPL ${pct(pr!.m12[1])} in 12m.`
        : flag === "Reallocation opportunity" ? `Sector trending favourably (${pr!.phase.toLowerCase()}); plan under-allocates vs cycle-adjusted guidance.`
        : "Plan, cycle and limit are consistent.";
      return {
        sectorId: l.sectorId,
        sector: s.sector.name,
        planPct: l.targetPct,
        actualPct: s.sharePct,
        recommendedPct,
        limitPct: s.limitPct,
        variancePp: s.sharePct - l.targetPct,
        plannedAmount: (plan.targetBook * l.targetPct) / 100,
        actualAmount: s.exposure,
        direction: pr?.direction ?? "Stable",
        phase: pr?.phase ?? "—",
        flag,
        rationale,
      };
    });
  }, [plan, proj, sectorRows]);

  const count = (f: Flag) => rows.filter((r) => r.flag === f).length;
  const top = [...rows].sort((a, b) => b.planPct - a.planPct).slice(0, 8);

  const ingest = async (files: File[]) => {
    const file = files[0];
    if (!file || !canEdit) return;
    const hook = await runHooks("portfolio.plan.upload.before", { fileName: file.name, size: file.size, actor: me });
    if (!hook.ok) {
      toast({ title: "Plan not ingested", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    setIngesting(true);
    const version = versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
    const next: PlanVersion = {
      ...plan,
      id: `PLAN-2026-V${version}-${Date.now().toString(36).toUpperCase()}`,
      name: `FY2026 plan — ${file.name.replace(/\.[^.]+$/, "")}`,
      version,
      status: "Uploaded — validating",
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor.name,
      fileName: file.name,
    };
    window.setTimeout(() => {
      addPlan(next);
      setPlanStatus(next.id, "Draft");
      actor.log("Uploaded portfolio plan version", "PortfolioPlan", next.id, plan.id, `v${version} (${file.name})`);
      publish("portfolio.plan.uploaded", { module: "portfolio", subject: { type: "PortfolioPlan", id: next.id, title: next.name, href: "/portfolio/annual-plan" }, payload: { version, fileName: file.name } });
      void runHooks("portfolio.plan.upload.after", { plan: next });
      setIngesting(false);
    }, SIMULATED_INGEST_MS);
  };

  /** Submit the selected version for approval; it becomes operative only when Operations approves it. */
  const submitPlan = async (v: PlanVersion) => {
    const hook = await runHooks("portfolio.plan.submit.before", { plan: v, actor: me });
    if (!hook.ok) {
      toast({ title: "Can't submit plan", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const before = statusOf(v);
    setPlanStatus(v.id, "Submitted for approval");
    const res = await submit<PlanApprovalPayload>("portfolio.plan.approve", {
      title: `Approve ${v.name} (v${v.version})`,
      subject: { type: "PortfolioPlan", id: v.id, title: v.name, href: "/portfolio/annual-plan" },
      payload: { planId: v.id, planName: v.name, version: v.version, fileName: v.fileName },
      summary: [
        { label: "Plan", value: `${v.name} (v${v.version})` },
        { label: "File", value: v.fileName },
        { label: "Target book", value: moneyShort(v.targetBook) },
        { label: "Limit conflicts", value: String(v.id === plan.id ? count("Limit conflict") : "—") },
        { label: "Cycle conflicts", value: String(v.id === plan.id ? count("Cycle conflict") : "—") },
        { label: "Replaces", value: `${operative.name} (v${operative.version})` },
      ],
    });
    if (!res.ok) {
      setPlanStatus(v.id, before);
      return;
    }
    actor.log("Submitted portfolio plan for approval", "PortfolioPlan", v.id, before, "Submitted for approval");
    publish("portfolio.plan.submitted", { module: "portfolio", subject: { type: "PortfolioPlan", id: v.id, title: v.name, href: "/portfolio/annual-plan" }, payload: { version: v.version, operationId: res.instance.id } });
    await runHooks("portfolio.plan.submit.after", { plan: v, operationId: res.instance.id });
  };

  const columns: DataTableColumn<GuidanceRow>[] = [
    { id: "sector", header: "Sector", accessor: "sector", sortable: true, cell: (r) => <span className="font-semibold text-fg">{r.sector}</span> },
    { id: "plan", header: "Plan", accessor: "planPct", numeric: true, sortable: true, cell: (r) => pct(r.planPct) },
    { id: "actual", header: "Actual", accessor: "actualPct", numeric: true, sortable: true, cell: (r) => pct(r.actualPct) },
    { id: "var", header: "Variance", accessor: "variancePp", numeric: true, sortable: true, cell: (r) => `${r.variancePp >= 0 ? "+" : ""}${r.variancePp.toFixed(1)}pp` },
    { id: "rec", header: "Cycle-adjusted", accessor: "recommendedPct", numeric: true, sortable: true, cell: (r) => pct(r.recommendedPct) },
    { id: "limit", header: "Limit", accessor: "limitPct", numeric: true, sortable: true, cell: (r) => pct(r.limitPct, 0) },
    { id: "cycle", header: "Cycle", accessor: (r) => `${r.phase} · ${r.direction}` },
    { id: "flag", header: "Flag", accessor: "flag", sortable: true, cell: (r) => <StatusBadge status={r.flag} tones={flagTone} /> },
    { id: "why", header: "Supporting data", accessor: "rationale", className: "min-w-64" },
  ];

  return (
    <ModulePage module="portfolio" description="Annual portfolio plan ingestion & sectoral allocation guidance: the Board-approved plan reconciled against the forward-looking sector projection and the sectoral concentration limits.">
      <Stack gap="large">
        <Alert tone="info" title={<span className="inline-flex items-center gap-2">Phase 2 capability <PhaseBadge phase={2} /></span>}>
          Flags carry their supporting data; the decision stays with the Credit and ALCO-equivalent committees — the module never silently approves or blocks disbursement. Plan changes feed the ILAAP funding plan and stress-testing assumptions.
        </Alert>

        <Grid columns={{ base: 1, lg: 3 }} gap="medium">
          <div className="lg:col-span-2">
            <Panel
              title="Plan versions"
              description="Versioned so a mid-year revision never overwrites the original plan."
              actions={
                <>
                  <Select aria-label="Plan version shown" size="small" value={plan.id} onChange={(e) => setActive(e.target.value)} options={versions.map((v) => ({ value: v.id, label: `v${v.version} — ${v.name}` }))} />
                  {canEdit && SUBMITTABLE.includes(statusOf(plan)) ? (
                    <Button size="small" variant="primary" iconBefore={<Send size={14} aria-hidden />} onClick={() => void submitPlan(plan)}>
                      Submit v{plan.version} for approval
                    </Button>
                  ) : null}
                </>
              }
            >
              <Stack gap="medium">
              <PendingApproval subjectType="PortfolioPlan" subjectId={plan.id} />
              <DataTable
                label="Plan versions"
                data={versions}
                getRowId={(r) => r.id}
                paginate={false}
                onRowClick={(r) => setActive(r.id)}
                columns={[
                  { id: "v", header: "Version", accessor: (r) => `v${r.version}`, cell: (r) => <span className="inline-flex items-center gap-2 font-mono text-fg">v{r.version}{r.id === operative.id ? <Badge tone="success">Operative</Badge> : null}{r.id === plan.id ? <Badge tone="accent">Shown</Badge> : null}</span> },
                  { id: "name", header: "Plan", accessor: "name" },
                  { id: "file", header: "File", accessor: "fileName" },
                  { id: "status", header: "Status", accessor: (r) => statusOf(r), cell: (r) => <StatusBadge status={statusOf(r)} tones={planTones} /> },
                  { id: "at", header: "Uploaded", accessor: "uploadedAt", cell: (r) => date(r.uploadedAt) },
                ]}
              />
              </Stack>
            </Panel>
          </div>
          <Panel title="Ingest a plan" description="Upload the Board-approved or rolling plan (sector, product, region and tenor targets; budgeted disbursement; pricing; funding mix).">
            {canEdit ? (
              <Stack gap="small">
                <FileUpload accept=".xlsx,.xls,.csv" maxSizeMb={10} onFilesChange={(f) => void ingest(f)} disabled={ingesting} />
                <Text variant="caption">{ingesting ? "Validating template and mapping sectors…" : "Simulated ingestion: the file is validated against the plan template and saved as a draft version. Submit it for approval to make it operative."}</Text>
              </Stack>
            ) : (
              <Text variant="small">Plan ingestion is performed by the Portfolio & MIS Reporting Officer. Your role can review the guidance.</Text>
            )}
          </Panel>
        </Grid>

        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <KpiCard
            label="Book vs plan target"
            value={pct((totals.grossLoans / plan.targetBook) * 100, 0)}
            hint={`${moneyShort(totals.grossLoans)} of ${moneyShort(plan.targetBook)} target`}
            calc={{ metric: "plan achievement", formula: "Actual gross loans / Planned year-end loan book × 100", source: "Actual: CBA facility ledger. Target: active plan version.", prd: "§6.6.8" }}
          />
          <KpiCard label="Limit conflicts" value={String(count("Limit conflict"))} hint="Plan would breach or sits in a breached sector" tone="danger" calc={{ metric: "limit conflicts", formula: "Planned sector share > sectoral limit, or sector already in breach", source: "Sectoral limits.", prd: "§6.6.8" }} />
          <KpiCard label="Cycle conflicts" value={String(count("Cycle conflict"))} hint="Planned growth into a deteriorating projection" tone="warning" calc={{ metric: "cycle conflicts", formula: "Planned share > current share while the 12m projection deteriorates", source: "Forward-looking projection, base scenario.", prd: "§6.6.8", demo: true }} />
          <KpiCard label="Reallocation opportunities" value={String(count("Reallocation opportunity"))} hint="Favourable sectors under-allocated" tone="info" calc={{ metric: "reallocation opportunities", formula: "Improving sector where plan share < cycle-adjusted recommendation", source: `Cycle-adjusted = plan × (${getRule<number>(PORTFOLIO_RULES.planDeterioratingFactor)} deteriorating · 1.0 stable · ${getRule<number>(PORTFOLIO_RULES.planImprovingFactor)} improving), renormalised, capped at the early-warning share of the limit (business rules, demo calibration).`, prd: "§6.6.8", demo: true }} />
        </Grid>

        <Panel title="Sectoral allocation guidance" description="Planned vs actual vs cycle-adjusted recommended share (largest planned sectors).">
          <StackedBarChart
            label="Planned, actual and recommended sector share"
            mode="grouped"
            categories={top.map((r) => r.sector)}
            series={[
              { name: "Plan", values: top.map((r) => r.planPct), tone: "neutral" },
              { name: "Actual", values: top.map((r) => r.actualPct), tone: "accent" },
              { name: "Cycle-adjusted", values: top.map((r) => r.recommendedPct), tone: "info" },
            ]}
            valueFormatter={(v) => pct(v, 1)}
            height={260}
          />
        </Panel>

        <Panel title="Variance report" description={`Actual vs ${plan.name} (v${plan.version}) vs cycle-adjusted guidance — produced on the configured MIS cadence. Operative plan: v${operative.version}; original plan v${original.version} retained.`}>
          <DataTable label="Plan variance report" data={rows} columns={columns} getRowId={(r) => r.sectorId} paginate={false} exportFilename={`plan-variance-v${plan.version}.csv`} filters={[{ id: "flag", label: "Flag" }]} defaultSort={{ id: "flag", direction: "asc" }} />
        </Panel>

        <Panel title="Budgeted disbursement progress" description="Year-to-date new disbursement against the budget, by largest sectors (demo budget split).">
          <Stack gap="medium">
            {top.slice(0, 6).map((r) => {
              const line = plan.lines.find((l) => l.sectorId === r.sectorId)!;
              const ratio = Math.min(1.2, r.actualAmount / Math.max(1, r.plannedAmount));
              return <ProgressBar key={r.sectorId} value={Math.min(1, ratio)} label={`${r.sector} — ${moneyShort(r.actualAmount)} of ${moneyShort(r.plannedAmount)} · budgeted disbursement ${moneyShort(line.budgetedDisbursement)} · target yield ${pct(line.targetYieldPct)}`} showValue tone={ratio > 1 ? "warning" : "accent"} />;
            })}
          </Stack>
        </Panel>
      </Stack>
    </ModulePage>
  );
}
