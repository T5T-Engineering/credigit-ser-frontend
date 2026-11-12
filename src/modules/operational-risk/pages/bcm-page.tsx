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
  Textarea,
  Timeline,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { newId } from "@/lib/data/store";
import { DEMO_NOW } from "@/lib/data/seed";
import { date } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { submitOperation, type SubmitResult } from "@/lib/platform/operations";
import { getRule, useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { crisisReadiness, fireDrills, planCurrency, type BcmExercise, type BcmPlan, type TestResult } from "../data";
import { planTargets } from "../logic";
import { PendingBadge, SubmitOutcome } from "../operation-ui";
import { OPRISK, orKeys, type BcmPlanPayload } from "../platform";
import { useOpRisk } from "../store";
import { roleNames, useAuditLog, useRuleValues } from "../shared";

const currencyTones = { Current: "success", "Due for review": "warning", Overdue: "danger" } as const;
const resultTones = { Passed: "success", "Passed with issues": "warning", Failed: "danger", "Not tested": "neutral" } as const;

export function BcmPage() {
  const canSubmitPlan = useCan("operational-risk.bcm-plans.submit");
  const canRecordExercise = useCan("operational-risk.bcm-exercises.create");
  const canExport = useCan("operational-risk.registers.export");
  const { actor } = useScope();
  useRuleValues(); // re-render when RTO/RPO targets or BCM rules change
  const storedPlans = useOpRisk((s) => s.bcmPlans);
  const exercises = useOpRisk((s) => s.exercises);
  const { updatePlan, addExercise } = useOpRisk.getState();
  const audit = useAuditLog();
  const dueWindow = useRule<number>(orKeys.bcmReviewDueWindowDays);
  const drillsRequired = useRule<number>(orKeys.bcmFireDrillsPerYear);
  const drillTarget = useRule<number>(orKeys.bcmDrillTargetPct) / 100;
  const redBelow = useRule<number>(orKeys.bcmReadinessRedBelow);
  const amberBelow = useRule<number>(orKeys.bcmReadinessAmberBelow);
  const weights = [useRule<number>(orKeys.bcmWeightCurrency), useRule<number>(orKeys.bcmWeightRto), useRule<number>(orKeys.bcmWeightDrills), useRule<number>(orKeys.bcmWeightCrisis)];
  const [recordOpen, setRecordOpen] = useState(false);
  const [reviewing, setReviewing] = useState<BcmPlan | null>(null);
  const [outcome, setOutcome] = useState<SubmitResult | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  /** Plans with their RTO/RPO targets in force (business rules). */
  const plans = storedPlans.map((p) => {
    const t = planTargets(p.id);
    return { ...p, rtoTargetHrs: t.rtoHours, rpoTargetMins: t.rpoMinutes };
  });
  const currencyOf = (p: BcmPlan) => planCurrency(p, dueWindow);
  const current = plans.filter((p) => currencyOf(p) === "Current").length;
  const tier1 = plans.filter((p) => p.tier === 1);
  const rtoMet = plans.filter((p) => p.rtoAchievedHrs !== undefined && p.rtoAchievedHrs <= p.rtoTargetHrs).length;
  const tested = plans.filter((p) => p.rtoAchievedHrs !== undefined).length;
  const drillsDone = fireDrills.reduce((s, d) => s + Math.min(d.completed, drillsRequired), 0);
  const drillsReq = fireDrills.length * drillsRequired;
  const crisisMet = crisisReadiness.filter((c) => c.status === "met").length;
  // Readiness index: weighted composite (weights are business rules) of plan currency, RTO met, drill compliance, crisis checklist.
  const parts = [current / plans.length, rtoMet / Math.max(1, tested), drillsDone / drillsReq, crisisMet / crisisReadiness.length];
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
  const readiness = Math.round((parts.reduce((s, v, i) => s + v * weights[i]!, 0) / totalWeight) * 100);

  const columns: DataTableColumn<BcmPlan>[] = [
    { id: "process", header: "Business process", accessor: "process", searchable: true, sortable: true, cell: (p) => <div><div className="font-medium text-fg">{p.process}</div><div className="font-mono text-xs text-fg-subtle">{p.id} · {p.owner}</div></div> },
    { id: "tier", header: "Criticality", accessor: (p) => `Tier ${p.tier}`, sortable: true, sortValue: (p) => p.tier, cell: (p) => <Badge tone={p.tier === 1 ? "danger" : p.tier === 2 ? "warning" : "neutral"} variant="outline">Tier {p.tier}</Badge> },
    { id: "rto", header: "RTO target / tested", numeric: true, accessor: (p) => `${p.rtoTargetHrs}h / ${p.rtoAchievedHrs ?? "—"}h`, cell: (p) => <span className={p.rtoAchievedHrs !== undefined && p.rtoAchievedHrs > p.rtoTargetHrs ? "text-danger-strong font-semibold" : undefined}>{p.rtoTargetHrs}h / {p.rtoAchievedHrs ?? "—"}{p.rtoAchievedHrs !== undefined ? "h" : ""}</span> },
    { id: "rpo", header: "RPO target / tested", numeric: true, accessor: (p) => `${p.rpoTargetMins}m / ${p.rpoAchievedMins ?? "—"}m`, cell: (p) => <span className={p.rpoAchievedMins !== undefined && p.rpoAchievedMins > p.rpoTargetMins ? "text-danger-strong font-semibold" : undefined}>{fmtMins(p.rpoTargetMins)} / {p.rpoAchievedMins !== undefined ? fmtMins(p.rpoAchievedMins) : "—"}</span> },
    { id: "currency", header: "Plan currency", accessor: (p) => currencyOf(p), sortable: true, cell: (p) => <div className="flex flex-col items-start gap-1"><StatusBadge status={currencyOf(p)} tones={currencyTones} /><div className="text-xs text-fg-subtle">Reviewed {date(p.lastReviewed)}{p.approvedBy ? ` · approved by ${p.approvedBy}` : ""}</div><PendingBadge subjectType="BcmPlan" subjectId={p.id} /></div> },
    { id: "result", header: "Last test", accessor: "lastResult", sortable: true, cell: (p) => <div><StatusBadge status={p.lastResult} tones={resultTones} />{p.lastTest && <div className="mt-1 text-xs text-fg-subtle">{date(p.lastTest)}</div>}</div> },
    { id: "site", header: "Alternate site", accessor: "alternateSite", hidden: true },
    {
      id: "actions",
      header: "",
      exportable: false,
      cell: (p) =>
        canSubmitPlan ? (
          <Button size="small" variant="tertiary" onClick={() => setReviewing(p)}>
            {currencyOf(p) === "Current" ? "Review plan" : "Submit review"}
          </Button>
        ) : null,
    },
  ];

  return (
    <ModulePage
      module="operational-risk"
      description="Business Continuity Management — BCM plan currency, crisis-management readiness and fire-drill/evacuation compliance per the Crisis Management Policy, Fire Drill & Evacuation Framework and BCM Framework (ISO 22301)."
      actions={canRecordExercise ? <Button iconBefore={<PlusCircle aria-hidden />} onClick={() => setRecordOpen(true)}>Record test / exercise</Button> : undefined}
    >
      <Stack gap="large">
        <SubmitOutcome result={outcome} />
        {flash && <Alert tone="success">{flash}</Alert>}
        <Grid columns={{ base: 1, lg: 3 }} gap="large">
          <Card>
            <CardHeader>
              <CardTitle>Operational resilience readiness</CardTitle>
              <CardDescription>Shown on the CRO dashboard alongside credit and market risk</CardDescription>
            </CardHeader>
            <CardContent>
              <Gauge value={readiness} min={0} max={100} label="Readiness index" bands={[{ to: redBelow, tone: "danger" }, { to: amberBelow, tone: "warning" }, { to: 100, tone: "success" }]} />
              <Text variant="caption" tone="subtle">Weighted index of plan currency ({weights[0]}), RTO achievement ({weights[1]}), drill compliance ({weights[2]}) and crisis checklist ({weights[3]}) — weights and bands are business rules.</Text>
            </CardContent>
          </Card>
          <Grid columns={{ base: 1, sm: 2 }} gap="medium" className="lg:col-span-2">
            <StatCard label="Plans current" value={<span className="font-mono">{current}/{plans.length}</span>} hint={`${plans.filter((p) => currencyOf(p) === "Overdue").length} overdue for review`} icon={<ClipboardList aria-hidden />} tone={current === plans.length ? "success" : "warning"} />
            <StatCard label="RTO met in last test" value={<span className="font-mono">{rtoMet}/{tested}</span>} hint={`${tier1.filter((p) => p.lastResult === "Failed").length} Tier 1 failure(s) to remediate`} icon={<LifeBuoy aria-hidden />} tone={rtoMet === tested ? "success" : "danger"} />
            <StatCard label="Fire-drill compliance" value={<span className="font-mono">{Math.round((drillsDone / drillsReq) * 100)}%</span>} hint={`${drillsDone} of ${drillsReq} required drills this year`} icon={<FlameKindling aria-hidden />} tone={drillsDone / drillsReq >= drillTarget ? "success" : "warning"} />
            <StatCard label="Crisis readiness checklist" value={<span className="font-mono">{crisisMet}/{crisisReadiness.length}</span>} hint="Crisis Management Policy requirements met" icon={<Building aria-hidden />} tone={crisisReadiness.some((c) => c.status === "breached") ? "danger" : "success"} />
          </Grid>
        </Grid>

        {plans.some((p) => p.tier === 1 && p.lastResult === "Failed") && (
          <Alert tone="danger" title="Tier 1 DR test failed">
            {plans.filter((p) => p.tier === 1 && p.lastResult === "Failed").map((p) => `${p.process}: recovered in ${p.rtoAchievedHrs}h against a ${p.rtoTargetHrs}h RTO`).join("; ")}. Re-test required; escalated to {roleNames(getRule<RoleId[]>(orKeys.bcmEscalationRoles))}.
          </Alert>
        )}

        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <CardTitle>BCM plan register</CardTitle>
            <CardDescription>Recovery Time and Recovery Point Objectives are business rules per process; plan reviews and target changes are approved through Operations</CardDescription>
          </CardHeader>
          <CardContent className="p-2 sm:p-4">
            <DataTable label="BCM plans" columns={columns} data={plans} getRowId={(p) => p.id} filters={[{ id: "tier", label: "Criticality" }, { id: "currency", label: "Currency" }, { id: "result", label: "Last test" }]} defaultSort={{ id: "tier", direction: "asc" }} exportFilename={canExport ? "bcm-plans.csv" : undefined} defaultPageSize={20} />
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
              <CardDescription>Required drills per year: {drillsRequired} (business rule)</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="small">
                {fireDrills.map((d) => (
                  <div key={d.branch} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                    <span className="text-sm text-fg">{d.branch}</span>
                    <span className="font-mono text-xs text-fg-muted">{d.completed}/{drillsRequired} · wardens {d.wardensTrained}%</span>
                    <ProgressBar className="col-span-2" value={Math.min(1, d.completed / drillsRequired)} size="small" tone={d.completed >= drillsRequired ? "success" : d.completed ? "warning" : "danger"} ariaLabel={`${d.branch} drill compliance`} />
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
        onSubmit={async (draft, planId, rto) => {
          const before = await runHooks("operational-risk.bcm.exercise.before", { exercise: draft, planId, rto, actor });
          if (!before.ok) {
            setOutcome({ ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` });
            setRecordOpen(false);
            return;
          }
          const ex = before.ctx.exercise;
          addExercise(ex);
          const p = planId ? plans.find((x) => x.id === planId) : undefined;
          if (p) updatePlan(p.id, { lastTest: ex.date, lastResult: ex.result, rtoAchievedHrs: rto ?? p.rtoAchievedHrs });
          audit("Recorded BCM test result", "BCM exercise", ex.id, undefined, `${ex.type} · ${ex.result}${planId ? ` · ${planId}` : ""}`);
          publish("operational-risk.bcm.exercise-recorded", { module: OPRISK, subject: { type: "BcmExercise", id: ex.id, title: `${ex.type} — ${ex.scope}`, href: "/operational-risk/bcm" }, payload: { result: ex.result, planId, rto } });
          if (p && p.tier === 1 && ex.result === "Failed") {
            notify({
              templateId: "operational-risk.bcm-test-failed",
              toRoles: getRule<RoleId[]>(orKeys.bcmEscalationRoles),
              href: "/operational-risk/bcm",
              data: { exercise: ex.type, process: p.process, planId: p.id, achieved: rto !== undefined ? `${rto}h` : "not recorded", target: `${p.rtoTargetHrs}h`, findings: ex.findings },
            });
          }
          await runHooks("operational-risk.bcm.exercise.after", { exercise: ex, planId, rto, actor });
          setFlash(`${ex.id} recorded — ${ex.type}: ${ex.result}.`);
          setRecordOpen(false);
        }}
      />
      <PlanReviewModal
        plan={reviewing}
        onClose={() => setReviewing(null)}
        onSubmit={async (p, rtoHours, rpoMinutes, comment) => {
          const r = await submitOperation<BcmPlanPayload>("operational-risk.bcm.plan-approval", {
            title: `BCM plan review — ${p.process}`,
            subject: { type: "BcmPlan", id: p.id, title: p.process, href: "/operational-risk/bcm" },
            payload: { planId: p.id, process: p.process, rtoHours, rpoMinutes, before: { rtoHours: p.rtoTargetHrs, rpoMinutes: p.rpoTargetMins }, comment },
            summary: [
              { label: "Plan", value: `${p.id} — ${p.process} (Tier ${p.tier})` },
              { label: "RTO target", value: rtoHours === p.rtoTargetHrs ? `${rtoHours}h (unchanged)` : `${p.rtoTargetHrs}h → ${rtoHours}h` },
              { label: "RPO target", value: rpoMinutes === p.rpoTargetMins ? `${fmtMins(rpoMinutes)} (unchanged)` : `${fmtMins(p.rpoTargetMins)} → ${fmtMins(rpoMinutes)}` },
              { label: "Last test", value: `${p.lastResult}${p.lastTest ? ` · ${date(p.lastTest)}` : ""}` },
              { label: "Reviewer note", value: comment },
            ],
          });
          if (r.ok) audit("Submitted BCM plan review for approval", "BCM plan", p.id, `Reviewed ${date(p.lastReviewed)}`, r.instance.id);
          setOutcome(r);
          setReviewing(null);
        }}
      />
    </ModulePage>
  );
}

function fmtMins(m: number) {
  return m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
}

function PlanReviewModal({ plan, onClose, onSubmit }: { plan: BcmPlan | null; onClose: () => void; onSubmit: (p: BcmPlan, rtoHours: number, rpoMinutes: number, comment: string) => void | Promise<void> }) {
  const minComment = useRule<number>("operations.minCommentLength");
  const [rto, setRto] = useState("");
  const [rpo, setRpo] = useState("");
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const rtoV = Number(rto || plan?.rtoTargetHrs);
  const rpoV = Number(rpo || plan?.rpoTargetMins);
  const targetError = !(rtoV > 0) || !(rpoV > 0) ? "Targets must be positive numbers" : undefined;
  const commentError = comment.trim().length < minComment ? `Add a review note (at least ${minComment} characters)` : undefined;
  const reset = () => { setRto(""); setRpo(""); setComment(""); setTouched(false); };
  return (
    <Modal
      open={!!plan}
      onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}
      title="Submit BCM plan review"
      description={plan ? `${plan.id} — ${plan.process}. Approved through the Operations workflow; target changes apply on approval.` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={() => { setTouched(true); if (targetError || commentError || !plan) return; void onSubmit(plan, rtoV, rpoV, comment.trim()); reset(); }}>Submit for approval</Button>
        </div>
      }
    >
      {plan && (
        <Stack gap="medium">
          <Grid columns={{ base: 1, md: 2 }} gap="medium">
            <Field label="RTO target (hours)" htmlFor="pr-rto" description={`Now ${plan.rtoTargetHrs}h`} error={touched ? targetError : undefined}>
              <Input id="pr-rto" inputMode="decimal" value={rto} placeholder={String(plan.rtoTargetHrs)} onChange={(e) => setRto(e.target.value)} />
            </Field>
            <Field label="RPO target (minutes)" htmlFor="pr-rpo" description={`Now ${fmtMins(plan.rpoTargetMins)}`}>
              <Input id="pr-rpo" inputMode="numeric" value={rpo} placeholder={String(plan.rpoTargetMins)} onChange={(e) => setRpo(e.target.value)} />
            </Field>
          </Grid>
          <Field label="Review note" htmlFor="pr-note" required error={touched ? commentError : undefined}>
            <Textarea id="pr-note" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </Stack>
      )}
    </Modal>
  );
}

function RecordExerciseModal({ open, plans, onOpenChange, onSubmit }: { open: boolean; plans: BcmPlan[]; onOpenChange: (o: boolean) => void; onSubmit: (e: BcmExercise, planId?: string, rto?: number) => void | Promise<void> }) {
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
            void onSubmit({ id: newId("EX"), type: type as BcmExercise["type"], scope: scope.trim() || plan!.process, date: DEMO_NOW.toISOString(), result: result as TestResult, findings: Number(findings) || 0 }, planId || undefined, rto ? Number(rto) : undefined);
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
