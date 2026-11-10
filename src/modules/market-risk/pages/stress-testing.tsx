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
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { newId } from "@/lib/data/store";
import { dateTime, pct } from "@/lib/format";
import { CalcRegister, useActorName, useAuditLog, type CalcSpec, ms } from "../../ifrs9/common";
import { BANDS, DYNAMIC_SIGNAL, niiAtRisk, repricingGap, reverseStress, runLiquidityStress, type StressAssumptions } from "../data";
import { defaultAssumptions, useMarketRisk, type SavedRun } from "../store";
import { useMarketBase } from "../use-market";

type NumKey = Exclude<keyof StressAssumptions, "band" | "dynamic">;

const FIELDS: { key: NumKey; label: string; suffix: string; hint: string }[] = [
  { key: "retailRunOff", label: "Retail deposit run-off", suffix: "%", hint: "30-day stressed outflow" },
  { key: "corporateRunOff", label: "Corporate deposit run-off", suffix: "%", hint: "30-day stressed outflow" },
  { key: "wholesaleWithdrawal", label: "Wholesale / interbank withdrawal", suffix: "%", hint: "Non-renewal of market funding" },
  { key: "undrawnDrawdown", label: "Undrawn-facility drawdown surge", suffix: "%", hint: "Of undrawn commitments" },
  { key: "hqlaHaircut", label: "HQLA haircut", suffix: "%", hint: "Market-liquidity discount" },
  { key: "fxDevaluation", label: "FX devaluation", suffix: "%", hint: "Naira depreciation vs USD" },
  { key: "rateShockBps", label: "Interest-rate shock", suffix: "bps", hint: "Parallel shift" },
  { key: "inflowRate", label: "Contractual inflow rate", suffix: "%", hint: "Share of loan repayments received" },
];

const SURVIVAL_TARGET = 30;

export function StressTestingPage() {
  const { bs, liq, rows } = useMarketBase();
  const canEdit = useCan("market-risk", "edit");
  const actor = useActorName();
  const audit = useAuditLog();
  const draft = useMarketRisk((s) => s.draft);
  const setDraft = useMarketRisk((s) => s.setDraft);
  const runs = useMarketRisk((s) => s.runs);
  const addRun = useMarketRisk((s) => s.addRun);
  const [name, setName] = useState("");

  const result = useMemo(() => runLiquidityStress(bs, liq.hqla, draft), [bs, liq.hqla, draft]);
  const reverse = useMemo(() => reverseStress(bs, liq.hqla, draft, SURVIVAL_TARGET), [bs, liq.hqla, draft]);
  const gap = useMemo(() => repricingGap(rows, bs), [rows, bs]);
  const nii = niiAtRisk(gap, draft.rateShockBps);

  const set = (changes: Partial<StressAssumptions>) => setDraft({ ...draft, ...changes });
  const pickBand = (band: StressAssumptions["band"]) => setDraft({ ...draft, band, ...BANDS[band] });

  const run = () => {
    const label = name.trim() || `${draft.band}${draft.dynamic ? " (dynamic)" : ""}`;
    const saved: SavedRun = {
      id: newId("LST"),
      at: new Date().toISOString(),
      by: actor.name,
      name: label,
      assumptions: draft,
      lcr: result.lcr,
      survivalDays: result.survivalDays,
      minBuffer: result.minBuffer,
    };
    addRun(saved);
    audit(
      "Ran liquidity stress test",
      "LiquidityStressRun",
      saved.id,
      undefined,
      `${label}: LCR ${result.lcr.toFixed(0)}%, survival ${result.survivalDays ?? "> 90"} days; assumptions ${JSON.stringify(draft)}`,
    );
    setName("");
  };

  const survivalLabel = (d: number | null) => (d === null ? "> 90 days" : `${d} days`);
  const days = Array.from({ length: 19 }, (_, i) => i * 5);
  const chartSeries = [
    { name: "Current scenario", tone: "accent" as const, points: days.map((d) => ({ x: `D${d}`, y: result.path[d]!.buffer })) },
    ...runs.slice(0, 3).map((r, i) => {
      const rr = runLiquidityStress(bs, liq.hqla, r.assumptions);
      return { name: r.name, tone: (["brand", "info", "warning"] as const)[i], points: days.map((d) => ({ x: `D${d}`, y: rr.path[d]!.buffer })) };
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
      sources: "Projected daily liquidity path (90-day horizon)",
      value: survivalLabel(result.survivalDays),
      prd: "§6.8.2, §6.8.4",
    },
    { metric: "Stressed LCR", formula: "Stressed HQLA / (30-day outflows − min(inflows, 75% of outflows))", sources: "As above", value: pct(result.lcr, 0), prd: "§6.8.2" },
    {
      metric: "Reverse stress test",
      formula: "Scale retail and corporate run-off until survival < target (bisection)",
      sources: `Survival target ${SURVIVAL_TARGET} days (tenant RAS)`,
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
                <CardDescription>Pick a severity band, then adjust any assumption. Severity bands and assumptions are tenant-configurable (demo values).</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <SegmentedControl
                  label="Severity band"
                  value={draft.band}
                  onChange={(v) => pickBand(v as StressAssumptions["band"])}
                  options={(Object.keys(BANDS) as StressAssumptions["band"][]).map((b) => ({ value: b, label: b, disabled: !canEdit }))}
                  size="small"
                />
                <Grid columns={{ base: 1, sm: 2 }} gap="medium">
                  {FIELDS.map((f) => (
                    <Field key={f.key} label={f.label} description={f.hint}>
                      <Input type="number" suffix={f.suffix} value={draft[f.key]} disabled={!canEdit} onChange={(e) => set({ [f.key]: Number(e.target.value) })} />
                    </Field>
                  ))}
                </Grid>
                <Card variant="filled" padding="small">
                  <Stack gap="medium">
                    <Switch
                      label="Dynamic, forward-looking adjustment (§6.8.4)"
                      description="Widen run-off and haircut assumptions automatically when the sector-cycle engine detects a contraction in a sector the bank is exposed to."
                      checked={draft.dynamic}
                      disabled={!canEdit}
                      onCheckedChange={(c) => {
                        set({ dynamic: c });
                        audit(c ? "Enabled dynamic stress adjustment" : "Disabled dynamic stress adjustment", "LiquidityStressDraft", "draft", String(!c), String(c));
                      }}
                    />
                    {draft.dynamic && (
                      <Stack gap="medium">
                        <Alert tone="warning" title={`${DYNAMIC_SIGNAL.phase} signal — ${DYNAMIC_SIGNAL.sector}`}>
                          {DYNAMIC_SIGNAL.justification} Adjustments below are proposed by the engine and editable before sign-off.
                        </Alert>
                        <Grid columns={{ base: 1, sm: 3 }} gap="medium">
                          <Field label="Retail run-off add-on">
                            <Input type="number" suffix="pp" value={draft.dynRetailAdd} disabled={!canEdit} onChange={(e) => set({ dynRetailAdd: Number(e.target.value) })} />
                          </Field>
                          <Field label="Corporate run-off add-on">
                            <Input type="number" suffix="pp" value={draft.dynCorporateAdd} disabled={!canEdit} onChange={(e) => set({ dynCorporateAdd: Number(e.target.value) })} />
                          </Field>
                          <Field label="HQLA haircut add-on">
                            <Input type="number" suffix="pp" value={draft.dynHaircutAdd} disabled={!canEdit} onChange={(e) => set({ dynHaircutAdd: Number(e.target.value) })} />
                          </Field>
                        </Grid>
                      </Stack>
                    )}
                  </Stack>
                </Card>
                {canEdit && (
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
                  hint={`Target ≥ ${SURVIVAL_TARGET} days (tenant RAS)`}
                  tone={result.survivalDays !== null && result.survivalDays < SURVIVAL_TARGET ? "danger" : "success"}
                />
                <StatCard label="Stressed LCR" value={pct(result.lcr, 0)} hint="Floor 100%" tone={result.lcr < 100 ? "danger" : "success"} />
                <StatCard label="Day-0 buffer" value={ms(result.buffer0)} hint="HQLA after haircut and MTM" />
                <StatCard label="30-day outflows" value={ms(result.outflows30)} hint={`NII impact ${ms(nii)} (12m)`} />
              </Grid>
              <Card variant="filled" padding="small">
                <Stack gap="xsmall">
                  <Text variant="eyebrow">Reverse stress test</Text>
                  <Text variant="small">
                    {reverse
                      ? `Survival falls below ${SURVIVAL_TARGET} days when retail run-off reaches ${reverse.retail}% and corporate run-off ${reverse.corporate}% (other assumptions as set).`
                      : `Survival stays above ${SURVIVAL_TARGET} days even at 6× the current run-off assumptions.`}
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
              <CardDescription>Buffer + contractual inflows − cumulative stressed outflows over 90 days. The scenario survives while the line stays above zero.</CardDescription>
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
              <CardDescription>Every run is retained with its full assumption set for audit and feeds the ILAAP stress-testing chapter (§6.8.3).</CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Stress-test runs"
              columns={runCols}
              data={runs}
              getRowId={(r) => r.id}
              exportFilename="liquidity-stress-runs"
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
