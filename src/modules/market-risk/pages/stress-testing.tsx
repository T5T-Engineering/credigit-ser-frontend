"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DescriptionList,
  type DataTableColumn,
  Field,
  Grid,
  Input,
  LineChart,
  SegmentedControl,
  PhaseBadge,
  Stack,
  StatCard,
  Switch,
  Text,
  useToast,
} from "@credigit/web-ui";
import Link from "next/link";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { dateTime, pct } from "@/lib/format";
import { useOperationsStore } from "@/lib/platform/operations";
import { getRule, useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { CalcRegister, type CalcSpec, ms } from "../../ifrs9/common";
import { operationHref } from "../../ifrs9/governance";
import { requestStressApproval, saveStressRun } from "../actions";
import {
  STRESS_BANDS,
  STRESS_FIELDS,
  bandAssumptions,
  defaultAssumptions,
  dynamicSignal,
  lcrFloor,
  niiAtRisk,
  repricingGap,
  reverseStress,
  runLiquidityStress,
  type BandName,
  type StressAssumptions,
} from "../data";
import { useMarketRisk, type SavedRun } from "../store";
import { useMarketBase } from "../use-market";

export function StressTestingPage() {
  const { bs, liq, rows, rules } = useMarketBase();
  const canRun = useCan("market-risk.stress-runs.run");
  const canSubmitRun = useCan("market-risk.stress-runs.submit");
  const canExport = useCan("market-risk.data.export");
  const { actor } = useScope();
  const { toast } = useToast();
  const storedDraft = useMarketRisk((s) => s.draft);
  const setDraft = useMarketRisk((s) => s.setDraft);
  const allRuns = useMarketRisk((s) => s.runs);
  const instances = useOperationsStore((s) => s.instances);
  const survivalTarget = useRule<number>("market-risk.ras.survival.buffer");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"all" | "mine">("all");

  const { draft, signal, floor, maxMultiplier } = useMemo(() => {
    void rules; // recompute when business rules change
    return { draft: storedDraft ?? defaultAssumptions(), signal: dynamicSignal(), floor: lcrFloor(), maxMultiplier: getRule<number>("market-risk.stress.reverseMaxMultiplier") };
  }, [storedDraft, rules]);
  const runs = scope === "mine" ? allRuns.filter((r) => r.byId === actor.id) : allRuns;
  const pendingRuns = useMemo(
    () => new Map(instances.filter((i) => i.operationType === "market-risk.stress.approve" && ["Pending", "In progress"].includes(i.status)).map((i) => [i.subject.id, i.id])),
    [instances],
  );

  const result = useMemo(() => {
    void rules;
    return runLiquidityStress(bs, liq.hqla, draft);
  }, [bs, liq.hqla, draft, rules]);
  const reverse = useMemo(() => {
    void rules;
    return reverseStress(bs, liq.hqla, draft, survivalTarget);
  }, [bs, liq.hqla, draft, survivalTarget, rules]);
  const gap = useMemo(() => repricingGap(rows, bs), [rows, bs]);
  const nii = niiAtRisk(gap, draft.rateShockBps);

  const set = (changes: Partial<StressAssumptions>) => setDraft({ ...draft, ...changes });
  const pickBand = (band: BandName) => setDraft({ ...draft, band, ...bandAssumptions(band) });

  const run = async () => {
    const label = name.trim() || `${draft.band}${draft.dynamic ? " (dynamic)" : ""}`;
    const res = await saveStressRun(label, draft, result);
    toast(res.ok ? { title: "Stress run saved", description: "Submit it for approval to use it in the ILAAP.", tone: "success" } : { title: "Not saved", description: res.reason, tone: "danger" });
    if (res.ok) setName("");
  };
  const submit = async (r: SavedRun) => {
    const res = await requestStressApproval(r);
    if (res.ok) toast({ title: res.applied ? "Scenario approved" : "Submitted for approval", description: res.applied ? undefined : `Follow it in Operations (${res.instance.id}).`, tone: "success" });
    else toast({ title: "Not submitted", description: res.reason, tone: "danger" });
  };

  const survivalLabel = (d: number | null) => (d === null ? `> ${result.horizon} days` : `${d} days`);
  const days = Array.from({ length: Math.floor(result.horizon / 5) + 1 }, (_, i) => i * 5);
  const chartSeries = [
    { name: "Current scenario", tone: "accent" as const, points: days.map((d) => ({ x: `D${d}`, y: result.path[d]!.buffer })) },
    ...runs.slice(0, 3).map((r, i) => {
      const rr = runLiquidityStress(bs, liq.hqla, r.assumptions);
      return { name: r.name, tone: (["brand", "info", "warning"] as const)[i], points: days.map((d) => ({ x: `D${d}`, y: rr.path[Math.min(d, rr.path.length - 1)]!.buffer })) };
    }),
  ];

  const runCols: DataTableColumn<SavedRun>[] = [
    { id: "at", header: "Run", accessor: "at", cell: (r) => dateTime(r.at) },
    { id: "name", header: "Scenario", accessor: "name", cell: (r) => <span className="font-semibold text-fg">{r.name}</span> },
    { id: "band", header: "Band", accessor: (r) => r.assumptions.band, cell: (r) => <Badge variant="outline">{r.assumptions.band}</Badge> },
    { id: "dyn", header: "Dynamic", accessor: (r) => (r.assumptions.dynamic ? "Yes" : "No") },
    {
      id: "runoff",
      header: "Run-off R / C / W",
      accessor: (r) => r.assumptions.retailRunOff,
      cell: (r) => (
        <span className="font-mono text-sm">
          {r.assumptions.retailRunOff + (r.assumptions.dynamic ? r.assumptions.dynRetailAdd : 0)} /{" "}
          {r.assumptions.corporateRunOff + (r.assumptions.dynamic ? r.assumptions.dynCorporateAdd : 0)} / {r.assumptions.wholesaleWithdrawal}%
        </span>
      ),
    },
    {
      id: "fx",
      header: "FX / rates",
      accessor: (r) => r.assumptions.fxDevaluation,
      cell: (r) => (
        <span className="font-mono text-sm">
          {r.assumptions.fxDevaluation}% / {r.assumptions.rateShockBps} bps
        </span>
      ),
    },
    { id: "lcr", header: "Stressed LCR", accessor: "lcr", numeric: true, cell: (r) => pct(r.lcr, 0) },
    { id: "surv", header: "Survival", accessor: (r) => r.survivalDays ?? 999, numeric: true, cell: (r) => survivalLabel(r.survivalDays) },
    { id: "by", header: "By", accessor: "by" },
    {
      id: "approval",
      header: "Approval",
      accessor: (r) => r.approval?.status ?? (pendingRuns.has(r.id) ? "Pending" : "Not submitted"),
      cell: (r) =>
        r.approval ? (
          <Badge tone={r.approval.status === "Approved" ? "success" : "danger"}>{r.approval.status}</Badge>
        ) : pendingRuns.has(r.id) ? (
          <Button as={Link} href={operationHref(pendingRuns.get(r.id)!)} size="small" variant="text">
            Awaiting approval
          </Button>
        ) : canSubmitRun && r.byId === actor.id ? (
          <Button size="small" variant="secondary" onClick={() => submit(r)}>
            Submit for approval
          </Button>
        ) : (
          <Text variant="caption" tone="muted">
            Not submitted
          </Text>
        ),
    },
  ];

  const specs: CalcSpec[] = [
    {
      metric: "Day-0 liquidity buffer",
      formula: "HQLA × (1 − haircut) − FGN bond MTM loss (duration × rate shock)",
      sources: "HQLA from the liquidity tab; haircut per severity band (Rules & Parameters Engine)",
      value: ms(result.buffer0),
      prd: "§6.8.2",
    },
    {
      metric: "Cumulative outflows",
      formula: "Σ deposits by source × run-off × FX revaluation + undrawn × drawdown rate, phased over the horizon",
      sources: "CBA deposit ledger by source type; undrawn limits from the facility book",
      value: ms(result.outflows30) + " (30d)",
      prd: "§6.8.2",
    },
    {
      metric: "Survival horizon",
      formula: "First day on which buffer + contractual inflows − cumulative outflows < 0",
      sources: `Projected daily liquidity path (${result.horizon}-day horizon)`,
      value: survivalLabel(result.survivalDays),
      prd: "§6.8.2, §6.8.4",
    },
    { metric: "Stressed LCR", formula: `Stressed HQLA / (30-day outflows − min(inflows, ${getRule<number>("market-risk.inflowCapPct")}% of outflows))`, sources: "As above", value: pct(result.lcr, 0), prd: "§6.8.2" },
    {
      metric: "Reverse stress test",
      formula: "Scale retail and corporate run-off until survival < target (bisection)",
      sources: `Survival target ${survivalTarget} days (RAS business rule)`,
      prd: "§6.8.3",
    },
    {
      metric: "Dynamic adjustment",
      formula: "Band run-off / haircut + macro-cycle add-on when the sector engine signals contraction",
      sources: "Macro & sector-cycle engine (§6.6.7); editable by the Market Risk Analyst before sign-off",
      prd: "§6.8.4",
    },
  ];

  return (
    <ModulePage
      module="market-risk"
      actions={<PhaseBadge phase={3} label="Ships in Phase 3" />}
      title="Liquidity stress testing"
      description="Static severity bands plus a dynamic, forward-looking layer that adjusts run-off and haircut assumptions to the macro and sector cycle."
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-7">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Scenario builder</CardTitle>
                <CardDescription>Pick a severity band, then adjust any assumption. Band defaults are business rules; a saved run is approved in Operations before it feeds the ILAAP.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <SegmentedControl
                  label="Severity band"
                  value={draft.band}
                  onChange={(v) => pickBand(v as BandName)}
                  options={STRESS_BANDS.map((b) => ({ value: b.label, label: b.label, disabled: !canRun }))}
                  size="small"
                />
                <Grid columns={{ base: 1, sm: 2 }} gap="medium">
                  {STRESS_FIELDS.map((f) => (
                    <Field key={f.key} label={f.label} description={f.hint}>
                      <Input type="number" suffix={f.suffix} value={draft[f.key]} disabled={!canRun} onChange={(e) => set({ [f.key]: Number(e.target.value) })} />
                    </Field>
                  ))}
                </Grid>
                <Card variant="filled" padding="small">
                  <Stack gap="medium">
                    <Switch
                      label="Dynamic, forward-looking adjustment (§6.8.4)"
                      description="Widen run-off and haircut assumptions automatically when the sector-cycle engine detects a contraction in a sector the bank is exposed to."
                      checked={draft.dynamic}
                      disabled={!canRun}
                      onCheckedChange={(c) => set({ dynamic: c })}
                    />
                    {draft.dynamic && (
                      <Stack gap="medium">
                        <Alert tone="warning" title={`${signal.phase} signal — ${signal.sector}`}>
                          {signal.justification} Adjustments below are proposed by the engine and editable before sign-off.
                        </Alert>
                        <Grid columns={{ base: 1, sm: 3 }} gap="medium">
                          <Field label="Retail run-off add-on">
                            <Input type="number" suffix="pp" value={draft.dynRetailAdd} disabled={!canRun} onChange={(e) => set({ dynRetailAdd: Number(e.target.value) })} />
                          </Field>
                          <Field label="Corporate run-off add-on">
                            <Input type="number" suffix="pp" value={draft.dynCorporateAdd} disabled={!canRun} onChange={(e) => set({ dynCorporateAdd: Number(e.target.value) })} />
                          </Field>
                          <Field label="HQLA haircut add-on">
                            <Input type="number" suffix="pp" value={draft.dynHaircutAdd} disabled={!canRun} onChange={(e) => set({ dynHaircutAdd: Number(e.target.value) })} />
                          </Field>
                        </Grid>
                      </Stack>
                    )}
                  </Stack>
                </Card>
                {canRun && (
                  <Grid columns={{ base: 1, sm: 3 }} gap="medium">
                    <div className="sm:col-span-2">
                      <Field label="Run name" optional>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${draft.band}${draft.dynamic ? " (dynamic)" : ""}`} />
                      </Field>
                    </div>
                    <Stack direction="horizontal" gap="small" align="end">
                      <Button onClick={run}>Run &amp; save</Button>
                      <Button variant="tertiary" onClick={() => setDraft(defaultAssumptions(draft.band))}>
                        Reset
                      </Button>
                    </Stack>
                  </Grid>
                )}
              </Stack>
            </CardContent>
          </Card>

          <div className="lg:col-span-5">
            <Stack gap="medium">
              <Grid columns={{ base: 1, sm: 2 }} gap="medium">
                <StatCard
                  label="Survival horizon"
                  value={survivalLabel(result.survivalDays)}
                  hint={`Target ≥ ${survivalTarget} days (RAS)`}
                  tone={result.survivalDays !== null && result.survivalDays < survivalTarget ? "danger" : "success"}
                />
                <StatCard label="Stressed LCR" value={pct(result.lcr, 0)} hint={`Floor ${floor}%`} tone={result.lcr < floor ? "danger" : "success"} />
                <StatCard label="Day-0 buffer" value={ms(result.buffer0)} hint="HQLA after haircut and MTM" />
                <StatCard label="30-day outflows" value={ms(result.outflows30)} hint={`NII impact ${ms(nii)} (12m)`} />
              </Grid>
              <Card variant="filled" padding="small">
                <Stack gap="xsmall">
                  <Text variant="eyebrow">Reverse stress test</Text>
                  <Text variant="small">
                    {reverse
                      ? `Survival falls below ${survivalTarget} days when retail run-off reaches ${reverse.retail}% and corporate run-off ${reverse.corporate}% (other assumptions as set).`
                      : `Survival stays above ${survivalTarget} days even at ${maxMultiplier}× the current run-off assumptions.`}
                  </Text>
                </Stack>
              </Card>
              <Card variant="outlined" padding="small">
                <Stack gap="small">
                  <Text variant="eyebrow">Effective assumptions{draft.dynamic ? " (incl. dynamic add-ons)" : ""}</Text>
                  <DescriptionList
                    columns={2}
                    layout="inline"
                    divided={false}
                    items={[
                      { label: "Retail run-off", value: `${draft.retailRunOff + (draft.dynamic ? draft.dynRetailAdd : 0)}%`, mono: true },
                      { label: "Corporate run-off", value: `${draft.corporateRunOff + (draft.dynamic ? draft.dynCorporateAdd : 0)}%`, mono: true },
                      { label: "Wholesale withdrawal", value: `${draft.wholesaleWithdrawal}%`, mono: true },
                      { label: "HQLA haircut", value: `${draft.hqlaHaircut + (draft.dynamic ? draft.dynHaircutAdd : 0)}%`, mono: true },
                      { label: "FX devaluation", value: `${draft.fxDevaluation}%`, mono: true },
                      { label: "Rate shock", value: `${draft.rateShockBps} bps`, mono: true },
                    ]}
                  />
                </Stack>
              </Card>
            </Stack>
          </div>
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Survival horizon — projected liquidity buffer</CardTitle>
              <CardDescription>
                Buffer + contractual inflows − cumulative stressed outflows over {result.horizon} days. The scenario survives while the line stays above zero.
              </CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <LineChart label="Projected liquidity buffer" height={280} yFormatter={(v) => ms(v)} series={chartSeries} />
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Results comparison</CardTitle>
              <CardDescription>Every run is retained with its full assumption set for audit; approved runs feed the ILAAP stress-testing chapter (§6.8.3).</CardDescription>
            </Stack>
            <SegmentedControl
              label="Runs shown"
              size="small"
              value={scope}
              onChange={(v) => setScope(v as "all" | "mine")}
              options={[
                { value: "all", label: "All runs" },
                { value: "mine", label: "My runs" },
              ]}
            />
          </CardHeader>
          <CardContent>
            <DataTable
              label="Stress-test runs"
              columns={runCols}
              data={runs}
              getRowId={(r) => r.id}
              exportFilename={canExport ? "liquidity-stress-runs" : undefined}
              emptyState={<Text tone="muted">No saved runs yet. Configure a scenario and select “Run &amp; save”.</Text>}
              mobileCard={(r) => (
                <Stack gap="xsmall">
                  <Text variant="small" className="font-semibold text-fg">
                    {r.name}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {dateTime(r.at)} · LCR {pct(r.lcr, 0)} · survival {survivalLabel(r.survivalDays)}
                  </Text>
                </Stack>
              )}
            />
          </CardContent>
        </Card>

        <CalcRegister specs={specs} />
      </Stack>
    </ModulePage>
  );
}
