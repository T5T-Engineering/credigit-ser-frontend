"use client";

import { useMemo } from "react";
import {
  Alert,
  BarChart,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  DescriptionList,
  Gauge,
  Grid,
  Input,
  List,
  SegmentedControl,
  Stack,
  StatCard,
  StatusBadge,
  Text,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { newId } from "@/lib/data/store";
import { useCan } from "@/lib/auth/session";
import { dateTime, money, pct } from "@/lib/format";
import { CalcPopover, CalcRegister, DemoNote, sum, useActorName, useAuditLog, type CalcSpec, ms } from "../common";
import { capitalBase, capitalClassTone, capitalMetrics, classifyCar, pillar2AddOns, runEcl, supervisoryChecklist, type IcaapScenario } from "../data";
import { useIfrs9, type StressRun } from "../store";
import { useEcl } from "../use-ecl";

export function IcaapPage() {
  const { input, rows } = useEcl();
  const canEdit = useCan("ifrs9", "edit");
  const audit = useAuditLog();
  const actor = useActorName();
  const scenarios = useIfrs9((s) => s.scenarios);
  const updateScenario = useIfrs9((s) => s.updateScenario);
  const minimumCar = useIfrs9((s) => s.minimumCar);
  const setMinimumCar = useIfrs9((s) => s.setMinimumCar);
  const runs = useIfrs9((s) => s.stressRuns);
  const addRun = useIfrs9((s) => s.addStressRun);

  const base = useMemo(() => capitalBase(rows), [rows]);
  const current = capitalMetrics(base);
  const baseEcl = sum(rows.map((r) => r.ecl));
  const cls = classifyCar(current.car, minimumCar);
  const pillar2 = sum(pillar2AddOns.map((p) => p.pct));

  const results = useMemo(
    () =>
      scenarios.map((sc) => {
        const stressed = runEcl(input, { pdMultiplier: sc.pdMultiplier, lgdAddOn: sc.lgdAddOn, fxDevaluationPct: sc.fxDevaluationPct });
        const eclIncrease = sum(stressed.map((r) => r.ecl)) - baseEcl;
        const fxEad = sum(stressed.filter((r) => r.facility.currency === "USD").map((r) => r.ead)) - sum(rows.filter((r) => r.facility.currency === "USD").map((r) => r.ead));
        const rwaIncrease = fxEad + base.marketRwa * (sc.fxDevaluationPct / 100) * 0.5;
        const m = capitalMetrics(base, eclIncrease, rwaIncrease);
        return { scenario: sc, eclIncrease, rwaIncrease, ...m, cls: classifyCar(m.car, minimumCar) };
      }),
    [scenarios, input, baseEcl, rows, base, minimumCar],
  );

  const runAll = () => {
    for (const r of results) {
      const run: StressRun = {
        id: newId(`ST-${r.scenario.id}`),
        at: new Date().toISOString(),
        by: actor.name,
        scenarioId: r.scenario.id,
        scenarioName: r.scenario.name,
        car: r.car,
        eclIncrease: r.eclIncrease,
        rwaIncrease: r.rwaIncrease,
      };
      addRun(run);
    }
    audit("Ran ICAAP stress test", "IcaapStressTest", "ICAAP-2026", undefined, results.map((r) => `${r.scenario.name}: CAR ${r.car.toFixed(2)}%`).join("; "));
  };

  const setParam = (sc: IcaapScenario, key: keyof IcaapScenario, value: number) => {
    if (!Number.isFinite(value)) return;
    audit("Changed ICAAP scenario parameter", "IcaapScenario", sc.id, `${String(key)}=${String(sc[key])}`, `${String(key)}=${value}`);
    updateScenario(sc.id, { [key]: value });
  };

  const specs: CalcSpec[] = [
    {
      metric: "Capital Adequacy Ratio (CAR)",
      formula: "Total Qualifying Capital / Risk-Weighted Assets × 100",
      sources: "GL Tier 1 + Tier 2 capital net of deductions; RWA = CBA exposures × Basel/CBN risk weights",
      value: pct(current.car, 2),
      prd: "§8, §9.1",
    },
    { metric: "Tier 2 limit", formula: "Tier 2 eligible = min(Tier 2, Tier 1 / 3)", sources: "CBN Guidelines on Regulatory Capital (2021)", value: ms(current.tier2), prd: "§9.1" },
    {
      metric: "Minimum CAR",
      formula: "10% (other banks) or 15% (international / SIB)",
      sources: "Rules & Parameters Engine per licence category",
      value: `${minimumCar}%`,
      prd: "§9.1",
    },
    {
      metric: "Capital classification",
      formula: "≥ min: adequate · 5%–<min: under · 2–<5%: significantly under · <2%: critically under · <0: insolvent",
      sources: "CBN 3.16(f)-(g)",
      value: cls,
      prd: "§6.7.4",
    },
    {
      metric: "Stressed CAR",
      formula: "(Qualifying capital − ΔECL × (1 − tax)) / (RWA + ΔRWA)",
      sources: "Scenario PD multiplier, LGD add-on and FX devaluation applied to the ECL engine (§6.7.2 inputs)",
      prd: "§6.7.4",
    },
  ];

  const scenarioCols: DataTableColumn<IcaapScenario>[] = [
    {
      id: "name",
      header: "Scenario",
      accessor: "name",
      cell: (s) => (
        <Stack gap="none">
          <span className="font-semibold text-fg">{s.name}</span>
          <span className="text-xs text-fg-muted">{s.description}</span>
        </Stack>
      ),
    },
    ...(
      [
        ["gdpPct", "GDP growth %"],
        ["inflationPct", "Inflation %"],
        ["fxDevaluationPct", "FX devaluation %"],
        ["mprBps", "MPR shock (bps)"],
        ["pdMultiplier", "PD multiplier"],
        ["lgdAddOn", "LGD add-on"],
      ] as [keyof IcaapScenario, string][]
    ).map(([key, label]): DataTableColumn<IcaapScenario> => ({
      id: key,
      header: label,
      accessor: key,
      numeric: true,
      cell: (s) =>
        canEdit && s.id !== "base" ? (
          <div className="ml-auto w-24">
            <Input
              aria-label={`${s.name} ${label}`}
              type="number"
              size="small"
              step={key === "pdMultiplier" || key === "lgdAddOn" ? 0.05 : 1}
              defaultValue={String(s[key])}
              onBlur={(e) => Number(e.target.value) !== s[key] && setParam(s, key, Number(e.target.value))}
            />
          </div>
        ) : (
          <span className="font-mono">{String(s[key])}</span>
        ),
    })),
  ];

  return (
    <ModulePage module="ifrs9" title="ICAAP" description="Internal Capital Adequacy Assessment Process — capital adequacy, Pillar 2 add-ons and macro stress testing.">
      <Stack gap="large">
        <DemoNote title="Demo capital base">
          Capital accounts and non-loan RWA are calibrated from the demo loan book (GL connector not yet live). The CAR formula, Tier 2 cap, minimum CAR and classification bands
          are as stated in PRD §6.7.4 and §9.1.
        </DemoNote>

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-5">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Capital adequacy</CardTitle>
                <CardDescription>Pillar 1 CAR against the licence minimum.</CardDescription>
              </Stack>
              <CalcPopover spec={specs[0]!} />
            </CardHeader>
            <CardContent>
              <Stack gap="medium" align="center">
                <Gauge
                  label="Capital adequacy ratio"
                  value={current.car}
                  min={0}
                  max={30}
                  valueFormatter={(v) => pct(v, 2)}
                  bands={[
                    { to: 5, tone: "danger" },
                    { to: minimumCar, tone: "warning" },
                    { to: 30, tone: "success" },
                  ]}
                />
                <StatusBadge status={cls} tones={capitalClassTone} />
                <SegmentedControl
                  label="Licence category"
                  size="small"
                  value={String(minimumCar)}
                  onChange={(v) => {
                    if (!canEdit) return;
                    audit("Changed minimum CAR (licence category)", "IcaapParameter", "minimum-car", `${minimumCar}%`, `${v}%`);
                    setMinimumCar(Number(v) as 10 | 15);
                  }}
                  options={[
                    { value: "10", label: "Other banks · 10%" },
                    { value: "15", label: "International / SIB · 15%" },
                  ]}
                />
              </Stack>
            </CardContent>
          </Card>
          <div className="lg:col-span-7">
            <Stack gap="medium">
              <Grid columns={{ base: 1, sm: 3 }} gap="medium">
                <StatCard label="CAR" value={pct(current.car, 2)} hint={`Minimum ${minimumCar}%`} tone={capitalClassTone[cls]} />
                <StatCard label="Tier 1 ratio" value={pct(current.tier1Ratio, 2)} hint="Tier 1 / RWA" />
                <StatCard label="Headroom" value={ms(current.qualifying - (current.rwa * minimumCar) / 100)} hint="Above minimum" />
              </Grid>
              <Card variant="filled" padding="small">
                <DescriptionList
                  columns={2}
                  items={[
                    { label: "Tier 1 (net of deductions)", value: money(current.tier1), mono: true },
                    {
                      label: "Tier 2 eligible",
                      value: money(current.tier2),
                      mono: true,
                      hint: current.tier2Capped ? "Capped at one-third of Tier 1 (§9.1)" : "Within one-third of Tier 1 cap (§9.1)",
                    },
                    { label: "Credit RWA", value: money(base.creditRwa), mono: true },
                    { label: "Market RWA", value: money(base.marketRwa), mono: true },
                    { label: "Operational RWA", value: money(base.operationalRwa), mono: true },
                    { label: "Total RWA", value: money(current.rwa), mono: true },
                  ]}
                />
              </Card>
            </Stack>
          </div>
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Pillar 2 capital add-ons</CardTitle>
                <CardDescription>Risks not captured in Pillar 1, from the tenant ICAAP policy (demo values).</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <DataTable
                  label="Pillar 2 add-ons"
                  columns={[
                    { id: "risk", header: "Risk", accessor: "risk" },
                    { id: "basis", header: "Basis", accessor: "basis" },
                    { id: "pct", header: "% of RWA", accessor: "pct", numeric: true, cell: (p) => pct(p.pct, 1) },
                  ]}
                  data={pillar2AddOns}
                  getRowId={(p) => p.risk}
                  paginate={false}
                />
                <Text variant="small">
                  Internal capital target: <span className="font-mono font-semibold text-fg">{pct(minimumCar + pillar2, 1)}</span> of RWA (minimum {minimumCar}% + Pillar 2{" "}
                  {pct(pillar2, 1)}). Current CAR {current.car >= minimumCar + pillar2 ? "meets" : "is below"} the internal target.
                </Text>
              </Stack>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Supervisory-action checklist</CardTitle>
                <CardDescription>Surfaced for the current classification (§6.7.4). Checklist items are tenant-configured (demo).</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <StatusBadge status={cls} tones={capitalClassTone} />
                <List variant="check" items={supervisoryChecklist[cls]} />
                <Text variant="caption" tone="muted">
                  Bands: Under-capitalised 5%–&lt;{minimumCar}% · Significantly under-capitalised 2%–&lt;5% · Critically under-capitalised &lt;2% · Insolvent: negative CAR (CBN
                  3.16(f)-(g)).
                </Text>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Stress-testing workspace</CardTitle>
              <CardDescription>Macro shock scenarios (external data feed, §5.5) applied to portfolio PD / LGD / EAD to project CAR impact.</CardDescription>
            </Stack>
            {canEdit && <Button onClick={runAll}>Run stress test</Button>}
          </CardHeader>
          <CardContent>
            <Stack gap="large">
              <DataTable label="ICAAP scenarios" columns={scenarioCols} data={scenarios} getRowId={(s) => s.id} paginate={false} />
              <Grid columns={{ base: 1, lg: 2 }} gap="large">
                <BarChart
                  label="Stressed CAR by scenario"
                  data={[
                    { label: "Current", value: Number(current.car.toFixed(2)) },
                    ...results.map((r) => ({ label: r.scenario.name, value: Number(r.car.toFixed(2)), caption: r.cls })),
                  ]}
                  valueFormatter={(v) => pct(v, 1)}
                  showValues
                  tone="brand"
                  height={240}
                />
                <DataTable
                  label="Stress results"
                  columns={[
                    { id: "s", header: "Scenario", accessor: (r) => r.scenario.name },
                    { id: "ecl", header: "ΔECL", accessor: "eclIncrease", numeric: true, cell: (r) => ms(r.eclIncrease) },
                    { id: "rwa", header: "ΔRWA", accessor: "rwaIncrease", numeric: true, cell: (r) => ms(r.rwaIncrease) },
                    { id: "car", header: "CAR", accessor: "car", numeric: true, cell: (r) => pct(r.car, 2) },
                    { id: "cls", header: "Classification", accessor: "cls", cell: (r) => <StatusBadge status={r.cls} tones={capitalClassTone} /> },
                  ]}
                  data={results}
                  getRowId={(r) => r.scenario.id}
                  paginate={false}
                />
              </Grid>
              {results.some((r) => r.car < minimumCar) && (
                <Alert tone="warning" title="Scenario breaches the minimum CAR">
                  {results
                    .filter((r) => r.car < minimumCar)
                    .map((r) => r.scenario.name)
                    .join(", ")}{" "}
                  would take CAR below {minimumCar}%. Capital planning actions should be documented in the ICAAP report.
                </Alert>
              )}
              {runs.length > 0 && (
                <Text variant="small" tone="muted">
                  Last run {dateTime(runs[0]!.at)} by {runs[0]!.by} · {runs.length} scenario results retained for audit.
                </Text>
              )}
            </Stack>
          </CardContent>
        </Card>

        <CalcRegister specs={specs} />
      </Stack>
    </ModulePage>
  );
}
