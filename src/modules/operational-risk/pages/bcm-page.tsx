"use client";

import { useState } from "react";
import { Building, ClipboardList, FlameKindling, LifeBuoy, PlusCircle } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChecklistPanel,
  DataTable,
  Field,
  Gauge,
  Grid,
  Input,
  Modal,
  ProgressBar,
  Select,
  Stack,
  StatCard,
  StatusBadge,
  Text,
  Timeline,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { date } from "@/lib/format";
import { crisisReadiness, fireDrills, planCurrency, type BcmExercise, type BcmPlan, type TestResult } from "../data";
import { useOpRisk } from "../store";
import { isoDaysAhead, useAuditLog } from "../shared";

const currencyTones = { Current: "success", "Due for review": "warning", Overdue: "danger" } as const;
const resultTones = { Passed: "success", "Passed with issues": "warning", Failed: "danger", "Not tested": "neutral" } as const;

export function BcmPage() {
  const canEdit = useCan("operational-risk", "edit");
  const plans = useOpRisk((s) => s.bcmPlans);
  const exercises = useOpRisk((s) => s.exercises);
  const { updatePlan, addExercise } = useOpRisk.getState();
  const audit = useAuditLog();
  const [recordOpen, setRecordOpen] = useState(false);

  const current = plans.filter((p) => planCurrency(p) === "Current").length;
  const tier1 = plans.filter((p) => p.tier === 1);
  const rtoMet = plans.filter((p) => p.rtoAchievedHrs !== undefined && p.rtoAchievedHrs <= p.rtoTargetHrs).length;
  const tested = plans.filter((p) => p.rtoAchievedHrs !== undefined).length;
  const drillsDone = fireDrills.reduce((s, d) => s + Math.min(d.completed, d.required), 0);
  const drillsReq = fireDrills.reduce((s, d) => s + d.required, 0);
  const crisisMet = crisisReadiness.filter((c) => c.status === "met").length;
  // Readiness index (demo composite, equal weights — tenant-configurable): plan currency, RTO met, drill compliance, crisis checklist.
  const readiness = Math.round(((current / plans.length + rtoMet / Math.max(1, tested) + drillsDone / drillsReq + crisisMet / crisisReadiness.length) / 4) * 100);

  const columns: DataTableColumn<BcmPlan>[] = [
    { id: "process", header: "Business process", accessor: "process", searchable: true, sortable: true, cell: (p) => <div><div className="font-medium text-fg">{p.process}</div><div className="font-mono text-xs text-fg-subtle">{p.id} · {p.owner}</div></div> },
    { id: "tier", header: "Criticality", accessor: (p) => `Tier ${p.tier}`, sortable: true, sortValue: (p) => p.tier, cell: (p) => <Badge tone={p.tier === 1 ? "danger" : p.tier === 2 ? "warning" : "neutral"} variant="outline">Tier {p.tier}</Badge> },
    { id: "rto", header: "RTO target / tested", numeric: true, accessor: (p) => `${p.rtoTargetHrs}h / ${p.rtoAchievedHrs ?? "—"}h`, cell: (p) => <span className={p.rtoAchievedHrs !== undefined && p.rtoAchievedHrs > p.rtoTargetHrs ? "text-danger-strong font-semibold" : undefined}>{p.rtoTargetHrs}h / {p.rtoAchievedHrs ?? "—"}{p.rtoAchievedHrs !== undefined ? "h" : ""}</span> },
    { id: "rpo", header: "RPO target / tested", numeric: true, accessor: (p) => `${p.rpoTargetMins}m / ${p.rpoAchievedMins ?? "—"}m`, cell: (p) => <span className={p.rpoAchievedMins !== undefined && p.rpoAchievedMins > p.rpoTargetMins ? "text-danger-strong font-semibold" : undefined}>{fmtMins(p.rpoTargetMins)} / {p.rpoAchievedMins !== undefined ? fmtMins(p.rpoAchievedMins) : "—"}</span> },
    { id: "currency", header: "Plan currency", accessor: (p) => planCurrency(p), sortable: true, cell: (p) => <div><StatusBadge status={planCurrency(p)} tones={currencyTones} /><div className="mt-1 text-xs text-fg-subtle">Reviewed {date(p.lastReviewed)}</div></div> },
    { id: "result", header: "Last test", accessor: "lastResult", sortable: true, cell: (p) => <div><StatusBadge status={p.lastResult} tones={resultTones} />{p.lastTest && <div className="mt-1 text-xs text-fg-subtle">{date(p.lastTest)}</div>}</div> },
    { id: "site", header: "Alternate site", accessor: "alternateSite", hidden: true },
    {
      id: "actions",
      header: "",
      exportable: false,
      cell: (p) =>
        canEdit && planCurrency(p) !== "Current" ? (
          <Button
            size="small"
            variant="tertiary"
            onClick={() => {
              updatePlan(p.id, { lastReviewed: DEMO_NOW.toISOString(), nextReview: isoDaysAhead(365) });
              audit("Recorded BCM plan review", "BCM plan", p.id, `Reviewed ${date(p.lastReviewed)}`, `Reviewed ${date(DEMO_NOW)}`);
            }}
          >
            Record review
          </Button>
        ) : null,
    },
  ];

  return (
    <ModulePage
      module="operational-risk"
      description="Business Continuity Management — BCM plan currency, crisis-management readiness and fire-drill/evacuation compliance per the Crisis Management Policy, Fire Drill & Evacuation Framework and BCM Framework (ISO 22301)."
      actions={canEdit ? <Button iconBefore={<PlusCircle aria-hidden />} onClick={() => setRecordOpen(true)}>Record test / exercise</Button> : undefined}
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, lg: 3 }} gap="large">
          <Card>
            <CardHeader>
              <CardTitle>Operational resilience readiness</CardTitle>
              <CardDescription>Shown on the CRO dashboard alongside credit and market risk</CardDescription>
            </CardHeader>
            <CardContent>
              <Gauge value={readiness} min={0} max={100} label="Readiness index" bands={[{ to: 60, tone: "danger" }, { to: 80, tone: "warning" }, { to: 100, tone: "success" }]} />
              <Text variant="caption" tone="subtle">Equal-weighted index of plan currency, RTO achievement, drill compliance and crisis checklist (demo composite — weights are a tenant parameter).</Text>
            </CardContent>
          </Card>
          <Grid columns={{ base: 1, sm: 2 }} gap="medium" className="lg:col-span-2">
            <StatCard label="Plans current" value={<span className="font-mono">{current}/{plans.length}</span>} hint={`${plans.filter((p) => planCurrency(p) === "Overdue").length} overdue for annual review`} icon={<ClipboardList aria-hidden />} tone={current === plans.length ? "success" : "warning"} />
            <StatCard label="RTO met in last test" value={<span className="font-mono">{rtoMet}/{tested}</span>} hint={`${tier1.filter((p) => p.lastResult === "Failed").length} Tier 1 failure(s) to remediate`} icon={<LifeBuoy aria-hidden />} tone={rtoMet === tested ? "success" : "danger"} />
            <StatCard label="Fire-drill compliance" value={<span className="font-mono">{Math.round((drillsDone / drillsReq) * 100)}%</span>} hint={`${drillsDone} of ${drillsReq} required drills this year`} icon={<FlameKindling aria-hidden />} tone={drillsDone / drillsReq >= 0.9 ? "success" : "warning"} />
            <StatCard label="Crisis readiness checklist" value={<span className="font-mono">{crisisMet}/{crisisReadiness.length}</span>} hint="Crisis Management Policy requirements met" icon={<Building aria-hidden />} tone={crisisReadiness.some((c) => c.status === "breached") ? "danger" : "success"} />
          </Grid>
        </Grid>

        {plans.some((p) => p.tier === 1 && p.lastResult === "Failed") && (
          <Alert tone="danger" title="Tier 1 DR test failed">
            {plans.filter((p) => p.tier === 1 && p.lastResult === "Failed").map((p) => `${p.process}: recovered in ${p.rtoAchievedHrs}h against a ${p.rtoTargetHrs}h RTO`).join("; ")}. Re-test required; escalated to the Head of Risk.
          </Alert>
        )}

        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <CardTitle>BCM plan register</CardTitle>
            <CardDescription>Recovery Time and Recovery Point Objectives are tenant targets per process (demo values)</CardDescription>
          </CardHeader>
          <CardContent className="p-2 sm:p-4">
            <DataTable label="BCM plans" columns={columns} data={plans} getRowId={(p) => p.id} filters={[{ id: "tier", label: "Criticality" }, { id: "currency", label: "Currency" }, { id: "result", label: "Last test" }]} defaultSort={{ id: "tier", direction: "asc" }} exportFilename="bcm-plans.csv" defaultPageSize={20} />
          </CardContent>
        </Card>

        <Grid columns={{ base: 1, lg: 3 }} gap="large">
          <Card>
            <CardHeader>
              <CardTitle>Tests & exercises</CardTitle>
              <CardDescription>DR failovers, crisis simulations, call trees and drills</CardDescription>
            </CardHeader>
            <CardContent>
              <Timeline items={exercises.slice(0, 7).map((e) => ({ title: `${e.type} — ${e.result}`, description: `${e.scope}${e.findings ? ` · ${e.findings} finding${e.findings > 1 ? "s" : ""}` : ""}`, meta: date(e.date), status: "complete" as const }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Fire drill & evacuation by branch</CardTitle>
              <CardDescription>Required drills per year: 2 (demo default)</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="small">
                {fireDrills.map((d) => (
                  <div key={d.branch} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                    <span className="text-sm text-fg">{d.branch}</span>
                    <span className="font-mono text-xs text-fg-muted">{d.completed}/{d.required} · wardens {d.wardensTrained}%</span>
                    <ProgressBar className="col-span-2" value={d.completed / d.required} size="small" tone={d.completed >= d.required ? "success" : d.completed ? "warning" : "danger"} ariaLabel={`${d.branch} drill compliance`} />
                  </div>
                ))}
              </Stack>
            </CardContent>
          </Card>
          <ChecklistPanel title="Crisis-management readiness" description="Crisis Management Policy requirements" items={crisisReadiness.map((c) => ({ ...c, owner: c.owner }))} />
        </Grid>
      </Stack>

      <RecordExerciseModal
        open={recordOpen}
        plans={plans}
        onOpenChange={setRecordOpen}
        onSubmit={(ex, planId, rto) => {
          addExercise(ex);
          if (planId) {
            const p = plans.find((x) => x.id === planId)!;
            updatePlan(planId, { lastTest: ex.date, lastResult: ex.result, rtoAchievedHrs: rto ?? p.rtoAchievedHrs });
          }
          audit("Recorded BCM test result", "BCM exercise", ex.id, undefined, `${ex.type} · ${ex.result}${planId ? ` · ${planId}` : ""}`);
          setRecordOpen(false);
        }}
      />
    </ModulePage>
  );
}

function fmtMins(m: number) {
  return m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
}

function RecordExerciseModal({ open, plans, onOpenChange, onSubmit }: { open: boolean; plans: BcmPlan[]; onOpenChange: (o: boolean) => void; onSubmit: (e: BcmExercise, planId?: string, rto?: number) => void }) {
  const [type, setType] = useState<BcmExercise["type"] | "">("");
  const [planId, setPlanId] = useState("");
  const [scope, setScope] = useState("");
  const [result, setResult] = useState<TestResult | "">("");
  const [rto, setRto] = useState("");
  const [findings, setFindings] = useState("0");
  const [touched, setTouched] = useState(false);
  const plan = plans.find((p) => p.id === planId);
  const valid = type && result && (scope.trim() || plan) && (!rto || Number(rto) > 0);
  const reset = () => { setType(""); setPlanId(""); setScope(""); setResult(""); setRto(""); setFindings("0"); setTouched(false); };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) { reset(); onOpenChange(false); } }}
      title="Record test / exercise"
      description="Updates plan test status and the BCM evidence trail."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={() => {
            setTouched(true);
            if (!valid) return;
            onSubmit({ id: `EX-${Date.now().toString(36).toUpperCase()}`, type: type as BcmExercise["type"], scope: scope.trim() || plan!.process, date: DEMO_NOW.toISOString(), result: result as TestResult, findings: Number(findings) || 0 }, planId || undefined, rto ? Number(rto) : undefined);
            reset();
          }}>Save result</Button>
        </div>
      }
    >
      <Stack gap="medium">
        <Field label="Exercise type" htmlFor="ex-type" required error={touched && !type ? "Choose a type" : undefined}>
          <Select id="ex-type" placeholder="Select" value={type} onChange={(e) => setType(e.target.value as BcmExercise["type"])} options={["DR failover", "Tabletop crisis simulation", "Call-tree test", "Fire drill & evacuation", "Alternate-site walkthrough"].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="BCM plan tested" htmlFor="ex-plan" optional>
          <Select id="ex-plan" placeholder="Not plan-specific" value={planId} onChange={(e) => setPlanId(e.target.value)} options={plans.map((p) => ({ value: p.id, label: `${p.id} — ${p.process}` }))} />
        </Field>
        <Field label="Scope" htmlFor="ex-scope" required={!plan} error={touched && !scope.trim() && !plan ? "Describe the scope" : undefined}>
          <Input id="ex-scope" value={scope} onChange={(e) => setScope(e.target.value)} placeholder={plan?.process ?? "e.g. Ikeja branch evacuation"} />
        </Field>
        <Grid columns={{ base: 1, md: 3 }} gap="medium">
          <Field label="Result" htmlFor="ex-result" required error={touched && !result ? "Choose a result" : undefined}>
            <Select id="ex-result" placeholder="Select" value={result} onChange={(e) => setResult(e.target.value as TestResult)} options={["Passed", "Passed with issues", "Failed"].map((v) => ({ value: v, label: v }))} />
          </Field>
          <Field label="Recovery time (hours)" htmlFor="ex-rto" optional description={plan ? `RTO ${plan.rtoTargetHrs}h` : undefined}>
            <Input id="ex-rto" inputMode="decimal" value={rto} onChange={(e) => setRto(e.target.value)} />
          </Field>
          <Field label="Findings" htmlFor="ex-find">
            <Input id="ex-find" inputMode="numeric" value={findings} onChange={(e) => setFindings(e.target.value)} />
          </Field>
        </Grid>
      </Stack>
    </Modal>
  );
}
