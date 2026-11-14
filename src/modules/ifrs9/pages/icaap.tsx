"use client";

import { useMemo, useState } from "react";
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
  SubmitButton,
  type DataTableColumn,
  DescriptionList,
  Field,
  Gauge,
  Grid,
  Input,
  List,
  Stack,
  StatCard,
  StatusBadge,
  Text,
  Textarea,
} from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { ModulePage } from "@/components/module-page";
import { newId } from "@/lib/data/store";
import { DEMO_NOW } from "@/lib/data/seed";
import { useCan } from "@/lib/iam/permissions";
import { dateTime, money, pct } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { usePendingFor } from "@/lib/platform/operations";
import { getRule, ruleDefinition } from "@/lib/platform/rules";
import { CalcPopover, CalcRegister, DemoNote, sum, useActorName, useAuditLog, type CalcSpec, ms } from "../common";
import {
  capitalBands,
  capitalBase,
  capitalClassTone,
  capitalMetrics,
  classifyCar,
  icaapScenarios,
  minimumCar as minimumCarRule,
  pillar2AddOns,
  runEcl,
  SCENARIO_FIELDS,
  supervisoryChecklist,
  type IcaapScenario,
} from "../data";
import { PendingNotice, RulesPanel, useSubmitOperation } from "../governance";
import { IFRS9_RULE_GROUPS, type IcaapSubmission, type ScenarioChangePayload } from "../platform";
import { useIfrs9, type StressRun } from "../store";
import { useEcl } from "../use-ecl";

type Field = (typeof SCENARIO_FIELDS)[number]["field"];
const EDITABLE = ["adverse", "severe"];
/** Upper bound of the CAR gauge (display scale). */
const GAUGE_MAX_CAR = 30;

export function IcaapPage() {
  const { input, rows, rules } = useEcl();
  const canProposeScenarios = useCan("ifrs9.icaap-scenarios.request-change");
  const canRunStress = useCan("ifrs9.stress-tests.run");
  const canSubmitIcaap = useCan("ifrs9.icaap.submit");
  const canRequestRuleChange = useCan("rules.rules.request-change");
  const audit = useAuditLog();
  const actor = useActorName();
  const { toast } = useSaveFeedback();
  const submitOperation = useSubmitOperation();
  const runs = useIfrs9((s) => s.stressRuns);
  const addRun = useIfrs9((s) => s.addStressRun);
  const approvals = useIfrs9((s) => s.icaapApprovals);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [proposing, setProposing] = useState(false);
  const icaapId = `ICAAP-${DEMO_NOW.getFullYear()}`;
  const pendingIcaap = usePendingFor("IcaapReport", icaapId);
  const pendingScenarios = usePendingFor("IcaapScenarioSet", "icaap-scenarios");

  // Every parameter below comes from business rules; `rules` re-renders this page when one changes.
  const { minimumCar, bands, pillar2Rows, scenarios, licence } = useMemo(
    () => ({
      minimumCar: minimumCarRule(),
      bands: capitalBands(),
      pillar2Rows: pillar2AddOns(),
      scenarios: icaapScenarios(),
      licence: getRule<string>("ifrs9.icaap.licenceCategory"),
    }),
    [rules], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const base = useMemo(() => capitalBase(rows), [rows]);
  const current = capitalMetrics(base);
  const baseEcl = sum(rows.map((r) => r.ecl));
  const cls = classifyCar(current.car, minimumCar);
  const pillar2 = sum(pillar2Rows.map((p) => p.pct));
  const fxSensitivity = getRule<number>("ifrs9.capital.fxMarketRwaSensitivity") / 100;

  const results = useMemo(
    () =>
      scenarios.map((sc) => {
        const stressed = runEcl(input, { pdMultiplier: sc.pdMultiplier, lgdAddOn: sc.lgdAddOn, fxDevaluationPct: sc.fxDevaluationPct });
        const eclIncrease = sum(stressed.map((r) => r.ecl)) - baseEcl;
        const fxEad = sum(stressed.filter((r) => r.facility.currency === "USD").map((r) => r.ead)) - sum(rows.filter((r) => r.facility.currency === "USD").map((r) => r.ead));
        const rwaIncrease = fxEad + base.marketRwa * (sc.fxDevaluationPct / 100) * fxSensitivity;
        const m = capitalMetrics(base, eclIncrease, rwaIncrease);
        return { scenario: sc, eclIncrease, rwaIncrease, ...m, cls: classifyCar(m.car, minimumCar) };
      }),
    [scenarios, input, baseEcl, rows, base, minimumCar, fxSensitivity],
  );
  const breaches = results.filter((r) => r.car < minimumCar);

  const runAll = async () => {
    const before = await runHooks("ifrs9.stresstest.run.before", { scenarios: scenarios.map((s) => s.id) });
    if (!before.ok) {
      toast({ title: "Stress test blocked", description: `${before.vetoedBy}: ${before.reason}`, tone: "danger" });
      return;
    }
    const at = new Date().toISOString();
    for (const r of results) {
      const run: StressRun = { id: newId(`ST-${r.scenario.id}`), at, by: actor.name, byId: actor.id, scenarioId: r.scenario.id, scenarioName: r.scenario.name, car: r.car, eclIncrease: r.eclIncrease, rwaIncrease: r.rwaIncrease };
      addRun(run);
    }
    const summary = results.map((r) => ({ scenario: r.scenario.name, car: Number(r.car.toFixed(2)), classification: r.cls }));
    audit("Ran ICAAP stress test", "IcaapStressTest", icaapId, undefined, results.map((r) => `${r.scenario.name}: CAR ${r.car.toFixed(2)}%`).join("; "));
    publish("ifrs9.stresstest.completed", { module: "ifrs9", subject: { type: "IcaapStressTest", id: icaapId, href: "/ifrs9/icaap" }, payload: { results: summary } });
    if (breaches.length) {
      const lowest = Math.min(...breaches.map((b) => b.car));
      publish("ifrs9.car.breached", { module: "ifrs9", subject: { type: "IcaapStressTest", id: icaapId, href: "/ifrs9/icaap" }, payload: { minimum: minimumCar, scenarios: breaches.map((b) => b.scenario.name), lowest } });
      notify({
        templateId: "ifrs9.car-breach",
        toRoles: ["cro", "head-of-risk", "predictive-analytics-officer"],
        href: "/ifrs9/icaap",
        data: { scenarios: breaches.map((b) => b.scenario.name).join(", "), minimum: pct(minimumCar, 0), lowest: pct(lowest, 2), current: pct(current.car, 2), runBy: actor.name },
      });
    }
    await runHooks("ifrs9.stresstest.run.after", { results: summary });
    toast({ title: "Stress test complete", description: `${results.length} scenarios run and retained for audit.`, tone: breaches.length ? "warning" : "success" });
  };

  const valueOf = (sc: IcaapScenario, f: Field) => draft[`ifrs9.scenario.${sc.id}.${f}`] ?? sc[f];
  const changes = Object.entries(draft)
    .map(([key, after]) => ({ key, label: String(ruleDefinition(key)?.label ?? key), before: getRule<number>(key), after }))
    .filter((c) => c.before !== c.after);

  const submitScenarios = async () => {
    const hook = await runHooks("ifrs9.scenario.change.before", { changes, reason, request: true });
    if (!hook.ok) {
      toast({ title: "Change blocked", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const res = await submitOperation<ScenarioChangePayload>("ifrs9.icaap.scenario.change", {
      title: `ICAAP stress scenarios: ${changes.length} change(s)`,
      subject: { type: "IcaapScenarioSet", id: "icaap-scenarios", title: "ICAAP stress scenarios", href: "/ifrs9/icaap" },
      payload: { changes: hook.ctx.changes, reason },
      summary: [...changes.map((c) => ({ label: c.label, value: `${c.before} → ${c.after}` })), { label: "Reason", value: reason }],
    });
    if (!res.ok) return;
    audit("Requested ICAAP scenario change", "IcaapScenarioSet", "icaap-scenarios", changes.map((c) => `${c.label}=${c.before}`).join("; "), `${changes.map((c) => `${c.label}=${c.after}`).join("; ")} — Operations ${res.instance.id}`);
    publish("ifrs9.scenario.change-requested", { module: "ifrs9", subject: { type: "IcaapScenarioSet", id: "icaap-scenarios", href: "/ifrs9/icaap" }, payload: { operationId: res.instance.id, changes } });
    setDraft({});
    setReason("");
    setProposing(false);
  };

  const submitIcaap = async () => {
    const payload: IcaapSubmission = {
      id: icaapId,
      period: String(DEMO_NOW.getFullYear()),
      car: current.car,
      minimumCar,
      classification: cls,
      internalTarget: minimumCar + pillar2,
      results: results.map((r) => ({ scenario: r.scenario.name, car: r.car, classification: r.cls })),
    };
    const hook = await runHooks("ifrs9.icaap.submit.before", { submission: payload });
    if (!hook.ok) {
      toast({ title: "Submission blocked", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const res = await submitOperation<IcaapSubmission>("ifrs9.icaap.approval", {
      title: `ICAAP ${payload.period} — CAR ${current.car.toFixed(2)}% (${cls})`,
      subject: { type: "IcaapReport", id: icaapId, title: `ICAAP ${payload.period}`, href: "/ifrs9/icaap" },
      payload: hook.ctx.submission,
      summary: [
        { label: "CAR", value: pct(current.car, 2) },
        { label: "Minimum CAR", value: pct(minimumCar, 0) },
        { label: "Internal capital target", value: pct(minimumCar + pillar2, 1) },
        { label: "Classification", value: cls },
        ...results.map((r) => ({ label: `Stressed CAR — ${r.scenario.name}`, value: `${pct(r.car, 2)} (${r.cls})` })),
      ],
    });
    if (!res.ok) return;
    audit("Submitted ICAAP report for sign-off", "IcaapReport", icaapId, undefined, `CAR ${current.car.toFixed(2)}% — Operations ${res.instance.id}`);
    publish("ifrs9.icaap.submitted", { module: "ifrs9", subject: { type: "IcaapReport", id: icaapId, href: "/ifrs9/icaap" }, payload: { operationId: res.instance.id, car: current.car } });
    await runHooks("ifrs9.icaap.submit.after", { submission: payload, operationId: res.instance.id });
  };

  const specs: CalcSpec[] = [
    {
      metric: "Capital Adequacy Ratio (CAR)",
      formula: "Total Qualifying Capital / Risk-Weighted Assets × 100",
      sources: "GL Tier 1 + Tier 2 capital net of deductions; RWA = CBA exposures × Basel/CBN risk weights",
      value: pct(current.car, 2),
      prd: "§8, §9.1",
    },
    {
      metric: "Tier 2 limit",
      formula: `Tier 2 eligible = min(Tier 2, Tier 1 × ${pct(getRule<number>("ifrs9.icaap.tier2CapPctOfTier1"), 2)})`,
      sources: "CBN Guidelines on Regulatory Capital (2021); rule ifrs9.icaap.tier2CapPctOfTier1",
      value: ms(current.tier2),
      prd: "§9.1",
    },
    {
      metric: "Minimum CAR",
      formula: `${pct(getRule<number>("ifrs9.icaap.minCarOther"), 0)} (other banks) or ${pct(getRule<number>("ifrs9.icaap.minCarInternational"), 0)} (international / SIB)`,
      sources: "Business rules per licence category (ifrs9.icaap.licenceCategory)",
      value: pct(minimumCar, 0),
      prd: "§9.1",
    },
    {
      metric: "Capital classification",
      formula: `≥ min: adequate · ${bands.significantly}%–<min: under · ${bands.critically}–<${bands.significantly}%: significantly under · <${bands.critically}%: critically under · <0: insolvent`,
      sources: "CBN 3.16(f)-(g); rules ifrs9.icaap.band.*",
      value: cls,
      prd: "§6.7.4",
    },
    {
      metric: "Stressed CAR",
      formula: "(Qualifying capital − ΔECL × (1 − tax)) / (RWA + ΔRWA)",
      sources: "Scenario PD multiplier, LGD add-on and FX devaluation (rules ifrs9.scenario.*) applied to the ECL engine (ECL inputs)",
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
    ...SCENARIO_FIELDS.map(
      (f): DataTableColumn<IcaapScenario> => ({
        id: f.field,
        header: `${f.label}${f.unit === "fraction" || f.unit === "×" ? "" : ` (${f.unit})`}`,
        accessor: f.field,
        numeric: true,
        cell: (s) =>
          proposing && EDITABLE.includes(s.id) ? (
            <div className="ml-auto w-24">
              <Input
                aria-label={`${s.name} ${f.label}`}
                type="number"
                size="small"
                step={f.step}
                min={f.min}
                max={f.max}
                value={String(valueOf(s, f.field))}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setDraft((d) => ({ ...d, [`ifrs9.scenario.${s.id}.${f.field}`]: v }));
                }}
              />
            </div>
          ) : (
            <span className="font-mono">{String(s[f.field])}</span>
          ),
      }),
    ),
  ];

  const lastApproval = approvals[0];

  return (
    <ModulePage module="ifrs9" title="ICAAP" description="Internal Capital Adequacy Assessment Process — capital adequacy, Pillar 2 add-ons and macro stress testing.">
      <Stack gap="large">
        <DemoNote title="Capital base">
          Capital accounts and non-loan RWA are calibrated from the demo loan book (GL connector not yet live). The CAR formula, Tier 2 cap, minimum CAR and classification bands
          are business rules sourced from and.
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
                  max={Math.max(GAUGE_MAX_CAR, minimumCar * 2)}
                  valueFormatter={(v) => pct(v, 2)}
                  bands={[
                    { to: bands.significantly, tone: "danger" },
                    { to: minimumCar, tone: "warning" },
                    { to: Math.max(GAUGE_MAX_CAR, minimumCar * 2), tone: "success" },
                  ]}
                />
                <StatusBadge status={cls} tones={capitalClassTone} />
                <Text variant="small" tone="muted">
                  Licence category: {licence === "other" ? "Other banks" : "International / SIB"} · minimum {pct(minimumCar, 0)} (business rule)
                </Text>
              </Stack>
            </CardContent>
          </Card>
          <div className="lg:col-span-7">
            <Stack gap="medium">
              <Grid columns={{ base: 1, sm: 3 }} gap="medium">
                <StatCard label="CAR" value={pct(current.car, 2)} hint={`Minimum ${pct(minimumCar, 0)}`} tone={capitalClassTone[cls]} />
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
                      hint: current.tier2Capped ? "Capped at one-third of Tier 1" : "Within one-third of Tier 1 cap",
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
                <CardDescription>Risks not captured in Pillar 1, from the tenant ICAAP policy (business rules, demo values).</CardDescription>
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
                  data={pillar2Rows}
                  getRowId={(p) => p.id}
                  paginate={false}
                />
                <Text variant="small">
                  Internal capital target: <span className="font-mono font-semibold text-fg">{pct(minimumCar + pillar2, 1)}</span> of RWA (minimum {pct(minimumCar, 0)} + Pillar 2{" "}
                  {pct(pillar2, 1)}). Current CAR {current.car >= minimumCar + pillar2 ? "meets" : "is below"} the internal target.
                </Text>
              </Stack>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Supervisory-action checklist</CardTitle>
                <CardDescription>Surfaced for the current classification. Checklist items are tenant-configured.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <StatusBadge status={cls} tones={capitalClassTone} />
                <List variant="check" items={supervisoryChecklist[cls]} />
                <Text variant="caption" tone="muted">
                  Bands: Under-capitalised {bands.significantly}%–&lt;{minimumCar}% · Significantly under-capitalised {bands.critically}%–&lt;{bands.significantly}% · Critically
                  under-capitalised &lt;{bands.critically}% · Insolvent: negative CAR (CBN 3.16(f)-(g)).
                </Text>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Stress-testing workspace</CardTitle>
              <CardDescription>Macro shock scenarios (external data feed) applied to portfolio PD / LGD / EAD to project CAR impact. Severities are approved business rules.</CardDescription>
            </Stack>
            {(canProposeScenarios || canRunStress) && (
              <Stack direction="horizontal" gap="small" wrap>
                {canProposeScenarios && !pendingScenarios && (
                  <Button variant="secondary" onClick={() => (proposing ? (setProposing(false), setDraft({})) : setProposing(true))}>
                    {proposing ? "Cancel changes" : "Propose scenario changes"}
                  </Button>
                )}
                {canRunStress && <SubmitButton onClick={() => void runAll()}>Run stress test</SubmitButton>}
              </Stack>
            )}
          </CardHeader>
          <CardContent>
            <Stack gap="large">
              <PendingNotice subjectType="IcaapScenarioSet" subjectId="icaap-scenarios">
                The severities below change when the request is approved.
              </PendingNotice>
              <DataTable label="ICAAP scenarios" columns={scenarioCols} data={scenarios} getRowId={(s) => s.id} paginate={false} />
              {proposing && (
                <Card variant="filled" padding="small">
                  <Stack gap="small">
                    <Text variant="small">
                      {changes.length ? `${changes.length} change(s): ${changes.map((c) => `${c.label} ${c.before} → ${c.after}`).join("; ")}` : "Edit the Adverse or Severe severities above."}
                    </Text>
                    <Field label="Reason" required>
                      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                    <div>
                      <SubmitButton onClick={() => void submitScenarios()} disabled={!changes.length || reason.trim().length < 5}>
                        Submit for approval
                      </SubmitButton>
                    </div>
                  </Stack>
                </Card>
              )}
              <Grid columns={{ base: 1, lg: 2 }} gap="large">
                <BarChart
                  label="Stressed CAR by scenario"
                  data={[{ label: "Current", value: Number(current.car.toFixed(2)) }, ...results.map((r) => ({ label: r.scenario.name, value: Number(r.car.toFixed(2)), caption: r.cls }))]}
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
              {breaches.length > 0 && (
                <Alert tone="warning" title="Scenario breaches the minimum CAR">
                  {breaches.map((r) => r.scenario.name).join(", ")} would take CAR below {pct(minimumCar, 0)}. Capital planning actions should be documented in the ICAAP report.
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

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>ICAAP report sign-off</CardTitle>
              <CardDescription>Head of Risk review → CRO endorsement → Board approval, routed through Operations.</CardDescription>
            </Stack>
            {canSubmitIcaap && !pendingIcaap && <SubmitButton onClick={() => void submitIcaap()}>Submit ICAAP for sign-off</SubmitButton>}
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              <PendingNotice subjectType="IcaapReport" subjectId={icaapId} />
              {lastApproval ? (
                <Alert tone="success" title={`ICAAP ${lastApproval.period} approved`}>
                  Approved by {lastApproval.approvedBy}, {dateTime(lastApproval.approvedAt)} — CAR {pct(lastApproval.car, 2)} ({lastApproval.classification}).
                </Alert>
              ) : (
                !pendingIcaap && (
                  <Text variant="small" tone="muted">
                    Not yet submitted for {DEMO_NOW.getFullYear()}. The current capital position and stress results are captured at submission.
                  </Text>
                )
              )}
            </Stack>
          </CardContent>
        </Card>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <RulesPanel title="Capital adequacy rules" keys={IFRS9_RULE_GROUPS.capital} canRequest={canRequestRuleChange} />
          <RulesPanel title="Capital base calibration" keys={IFRS9_RULE_GROUPS.capitalBase} canRequest={canRequestRuleChange} />
        </Grid>

        <CalcRegister specs={specs} />
      </Stack>
    </ModulePage>
  );
}
