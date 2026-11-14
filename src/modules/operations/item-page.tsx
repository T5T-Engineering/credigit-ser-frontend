"use client";

import { verifyStepUp } from "@/lib/auth/service";
import { getRule } from "@/lib/platform/rules";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KeyRound, Lock, SearchX, Undo2 } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  Alert,
  AuditTrail,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeSnippet,
  DecisionPanel,
  DescriptionList,
  EmptyState,
  EntityHeader,
  EventLogList,
  Field,
  Grid,
  OperationTimeline,
  Spinner,
  Stack,
  StepUpAuthDialog,
  SubmitButton,
  Text,
  Textarea,
  WorkflowDiagram,
  type ActivityItem,
  type DecisionAction,
  type DomainEventEntry,
} from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { ModulePage } from "@/components/module-page";
import { useAudit } from "@/lib/data/hooks";
import { dateTime, money } from "@/lib/format";
import { publish, useEventStore } from "@/lib/platform/events";
import { notify } from "@/lib/platform/notifications";
import { useDb } from "@/lib/data/store";
import { actingRoles, cancelOperation, canDecide, canViewOperation, decideOperation, requiresStepUp, useOperation, type OperationInstance } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { useCan } from "@/lib/iam/permissions";
import {
  currentStepName,
  isOpen,
  largestAmount,
  MS_PER_HOUR,
  payloadFacts,
  roleName,
  roleOptions,
  safeDefinition,
  safeDueAt,
  stepsOf,
  timelineSteps,
  toUiSteps,
  useDefinitions,
  useNow,
  useOpsHydrated,
} from "./logic";

const statusTones = { Pending: "neutral", "In progress": "info", Approved: "success", Rejected: "danger", Returned: "warning", Cancelled: "neutral", Failed: "danger" } as const;
const toEngine: Record<DecisionAction, "approve" | "reject" | "return"> = { approve: "approve", decline: "reject", return: "return", recommend: "approve" };

/** Operations → operation detail (`/operations/item?id=`). */
export function OperationItemPage() {
  return (
    <Suspense fallback={<Spinner label="Loading operation" />}>
      <ItemInner />
    </Suspense>
  );
}

function ItemInner() {
  const id = useSearchParams().get("id");
  const instance = useOperation(id);
  const hydrated = useOpsHydrated();
  if (!hydrated) return <Spinner label="Loading operation" />;
  if (!instance)
    return (
      <ModulePage module="operations" title="Operation" hideTabs>
        <EmptyState
          icon={<SearchX aria-hidden />}
          title="Operation not found"
          description={id ? `No operation with reference ${id} exists in this tenant.` : "No operation reference was given."}
          action={
            <Button as={Link} href="/operations" variant="tertiary">
              Back to approvals
            </Button>
          }
        />
      </ModulePage>
    );
  return <Guarded instance={instance} />;
}

/** OPS-FR-16: only the requester, deciders, step-role holders and Operations oversight see an item. */
function Guarded({ instance }: { instance: OperationInstance }) {
  const { actor } = useScope();
  const allowed = canViewOperation(instance, actor);
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const key = `${instance.id}:${actor.id}:${actor.roleId}`;
    if (allowed || reported.current === key) return;
    reported.current = key;
    useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action: "Access denied: operation item", entityType: `Operation · ${instance.operationType}`, entityId: instance.id });
    publish("operations.request.access-denied", { module: "operations", subject: { type: "Operation", id: instance.id }, payload: { operationId: instance.id } });
  }, [allowed, instance.id, instance.operationType, actor.id, actor.name, actor.roleId]);
  if (!allowed)
    return (
      <ModulePage module="operations" title="Operation" hideTabs>
        <EmptyState
          icon={<Lock aria-hidden />}
          title="You don't have access to this operation"
          description="Only the requester, the approvers on its route and Operations oversight can open it."
          action={
            <Button as={Link} href="/operations" variant="tertiary">
              Back to approvals
            </Button>
          }
        />
      </ModulePage>
    );
  return <Detail instance={instance} />;
}

function Detail({ instance: i }: { instance: OperationInstance }) {
  const { actor } = useScope();
  const { toast } = useSaveFeedback();
  useDefinitions();
  const def = safeDefinition(i.operationType);
  const now = useNow();
  const warnHours = useRule<number>("operations.slaWarningHours");
  const minComment = useRule<number>("operations.minCommentLength");
  const commentAlways = useRule<boolean>("operations.commentAlwaysRequired");
  const threshold = useRule<number>("approvals.stepUpThresholdNgn");
  const audit = useAudit();
  const log = useEventStore((s) => s.log);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const verified = useRef(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [busy, setBusy] = useState(false);

  const steps = useMemo(() => timelineSteps(i, def), [i, def]);
  const due = safeDueAt(i);
  const overdue = !!due && now > 0 && new Date(due).getTime() < now;
  // UI mirror of invariant 12; canDecide() still applies eligibility, four-eyes and segregation of duties.
  const holdsDecide = useCan("operations.items.decide");
  const holdsWithdraw = useCan("operations.items.withdraw");
  const decide = canDecide(i, actor);
  const amount = largestAmount(i.payload);
  // Same rule as the engine (instance.amountNgn), plus the largest amount in the payload (OPS-FR-19).
  const highValue = requiresStepUp(i) || (amount !== undefined && amount > threshold);
  const open = isOpen(i);
  const mine = i.requestedBy.id === actor.id;
  const route = stepsOf(i, def);
  const currentStep = route[i.stepIndex];

  // SLA breach: escalate once per step when an approver opens an overdue item (event + notification). TD-962: no sweep job yet.
  const breachKey = `${i.id}:${currentStep?.id}:${i.stepStartedAt}`;
  const alreadyEscalated = log.some((e) => e.name === "operations.sla.breached" && (e.payload as { key?: string })?.key === breachKey);
  useEffect(() => {
    if (!overdue || !decide.ok || alreadyEscalated || !currentStep || !due) return;
    publish("operations.sla.breached", { module: "operations", subject: { type: "Operation", id: i.id, title: i.title, href: `/operations/item?id=${i.id}` }, payload: { key: breachKey, stepId: currentStep.id, dueAt: due } });
    notify({ templateId: "operations.sla-overdue", toRoles: actingRoles(i), href: `/operations/item?id=${i.id}`, data: { title: i.title, step: currentStep.name, due: new Date(due).toUTCString(), requester: i.requestedBy.name } });
  }, [overdue, decide.ok, alreadyEscalated, currentStep, due, breachKey, i]);

  const events: DomainEventEntry[] = log
    .filter((e) => e.subject?.id === i.id || e.subject?.id === i.subject.id || (e.payload as { subject?: { id?: string } })?.subject?.id === i.subject.id)
    .slice(0, 50)
    .map((e) => ({
      id: e.id,
      name: e.name,
      module: e.module,
      subject: e.subject ? { label: e.subject.title ?? e.subject.id, href: e.subject.href } : undefined,
      actor: e.actorName,
      time: dateTime(e.at),
      payload: e.payload,
      deliveredTo: e.deliveredTo,
      status: "delivered",
    }));

  const auditItems: ActivityItem[] = audit
    .filter((a) => a.entityId === i.id || a.entityId === i.subject.id)
    .slice(0, 50)
    .map((a) => ({
      id: a.id,
      actor: { name: a.actorName, role: roleName(a.roleId) },
      action: a.action,
      target: `${a.entityType} ${a.entityId}`,
      timestamp: a.at,
      changes: a.before || a.after ? [{ field: "Value", before: a.before, after: a.after }] : undefined,
      ip: a.ip,
      device: a.device,
    }));

  const facts = payloadFacts(i.payload);
  const completed = route.slice(0, open || i.status !== "Approved" ? i.stepIndex : route.length).map((s) => s.id);

  async function onDecide({ decision, comment }: { decision: DecisionAction; comment: string }) {
    // DecisionPanel only reaches here for a high-value approval after StepUpAuthDialog verified the code.
    const res = await decideOperation(i.id, toEngine[decision], comment, { stepUpVerified: highValue && decision === "approve" });
    if (res.ok) toast({ title: `Decision recorded: ${res.instance.status}`, description: i.title, tone: "success" });
    else toast({ title: "Decision not recorded", description: res.reason, tone: "danger" });
  }

  async function withdraw() {
    setBusy(true);
    const res = await cancelOperation(i.id, withdrawReason.trim());
    setBusy(false);
    if (res.ok) toast({ title: "Request withdrawn", description: i.title, tone: "success" });
    else toast({ title: "Couldn't withdraw", description: res.reason, tone: "danger" });
  }

  return (
    <ModulePage module="operations" title="Operation" hideTabs>
      <Stack gap="large">
        <EntityHeader
          back={{ href: mine ? "/operations/requests" : "/operations", label: mine ? "My requests" : "Approvals" }}
          linkComponent={Link}
          eyebrow={def?.name ?? i.operationType}
          title={i.title}
          titleAs="h2"
          identifier={i.id}
          identifierLabel="Reference"
          status={{ status: i.status, tones: statusTones }}
          facts={[
            { label: "Requested by", value: `${i.requestedBy.name} · ${roleName(i.requestedBy.roleId)}` },
            { label: "Submitted", value: dateTime(i.requestedAt), mono: true },
            { label: open ? "Current step" : "Closed", value: open ? (currentStepName(i, def) ?? "—") : i.completedAt ? dateTime(i.completedAt) : "—" },
            { label: "Workflow version", value: `v${i.definitionVersion}`, mono: true },
          ]}
        />

        <Grid columns={{ base: 1, lg: 3 }} gap="large">
          <div className="lg:col-span-2">
            <Stack gap="large">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Summary</CardTitle>
                    <CardDescription>Key facts the requester gave approvers.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <DescriptionList
                    items={[
                      { label: "Subject", value: i.subject.href ? <Link href={i.subject.href} className="text-link underline-offset-2 hover:underline">{i.subject.title ?? i.subject.id}</Link> : (i.subject.title ?? i.subject.id), hint: i.subject.type },
                      ...i.summary.map((s) => ({ label: s.label, value: s.value })),
                      ...(amount !== undefined ? [{ label: "Amount (for step-up)", value: money(amount), mono: true }] : []),
                      ...(i.reason ? [{ label: "Outcome note", value: i.reason, span: 2 as const }] : []),
                    ]}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Approval route</CardTitle>
                    <CardDescription>{def ? `${def.name} — ${route.length} step(s), as captured when submitted. ${def.description}` : "The workflow definition for this operation type is no longer registered."}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Stack gap="large">
                    {route.length ? <WorkflowDiagram steps={toUiSteps(route)} roleOptions={roleOptions} currentStepId={open ? currentStep?.id : undefined} completedStepIds={completed} label={`${def?.name ?? i.operationType} workflow`} /> : null}
                    {steps.length ? <OperationTimeline steps={steps} now={now || undefined} warnWithinMs={warnHours * MS_PER_HOUR} /> : <Text tone="muted">Applied directly — the workflow had no steps or was disabled.</Text>}
                  </Stack>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Request details</CardTitle>
                    <CardDescription>What will be applied if the last step approves.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Stack gap="medium">
                    {facts.length ? <DescriptionList items={facts} /> : <Text tone="muted">No payload.</Text>}
                    <Accordion type="single">
                      <AccordionItem value="raw" title="Raw payload (JSON)">
                        <CodeSnippet code={JSON.stringify(i.payload ?? null, null, 2)} language="json" copyable label="Raw payload" />
                      </AccordionItem>
                    </Accordion>
                  </Stack>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Related events</CardTitle>
                    <CardDescription>Domain events about this operation or its subject.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {events.length ? <EventLogList events={events} showFilters={false} linkComponent={Link} label="Related events" /> : <Text tone="muted">No events recorded in this browser yet.</Text>}
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <AuditTrail items={auditItems} formatTimestamp={(t) => dateTime(t)} emptyMessage="No audit entries for this operation yet." />
                </CardContent>
              </Card>
            </Stack>
          </div>

          <Stack gap="large" className="order-first lg:order-none">
            {open && holdsDecide && decide.ok ? (
              <DecisionPanel
                title={`Your decision — ${roleName(actor.roleId)}${i.awaitingAdjudication ? " (adjudicator)" : ""}`}
                actions={["approve", "return", "decline"]}
                actionLabels={{ decline: "Reject", return: "Return to requester" }}
                commentRequired={commentAlways ? true : ["return", "decline"]}
                minCommentLength={Math.max(1, minComment)}
                requireStepUp={(d) => highValue && d === "approve"}
                onStepUp={() =>
                  new Promise<boolean>((resolve) => {
                    resolver.current = resolve;
                    verified.current = false;
                    setStepUpOpen(true);
                  })
                }
                notice={
                  overdue
                    ? "This step is past its SLA — approvers have been alerted."
                    : highValue
                      ? `Above the ${money(threshold)} step-up threshold — approving needs re-authentication.`
                      : undefined
                }
                onDecide={onDecide}
              />
            ) : (
              <Alert tone={open ? "info" : i.status === "Approved" ? "success" : i.status === "Rejected" || i.status === "Failed" ? "danger" : "warning"} title={open ? "No decision needed from you" : `${i.status}${i.completedAt ? ` · ${dateTime(i.completedAt)}` : ""}`}>
                {open
                  ? `${decide.reason ?? ""} Waiting on ${actingRoles(i).map(roleName).join(", ") || "—"}.`
                  : (i.reason ?? "This operation is closed.")}
              </Alert>
            )}

            {open && mine && holdsWithdraw ? (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Withdraw request</CardTitle>
                    <CardDescription>Only you, as the requester, can withdraw. Approvers are told it was cancelled.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Stack gap="medium">
                    <Field label="Reason" description={`At least ${minComment} characters.`} required>
                      <Textarea value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} rows={3} />
                    </Field>
                    <SubmitButton variant="danger" iconBefore={<Undo2 aria-hidden />} loading={busy} disabled={withdrawReason.trim().length < minComment} onClick={withdraw}>
                      Withdraw request
                    </SubmitButton>
                  </Stack>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Controls</CardTitle>
              </CardHeader>
              <CardContent>
                <Stack gap="small">
                  <Text variant="small">
                    <KeyRound aria-hidden className="mr-1 inline size-4" />
                    Approvals above {money(threshold)} need step-up authentication (business rule).
                  </Text>
                  <Text variant="small">The requester can never decide their own operation (segregation of duties).</Text>
                  <Text variant="small">
                    Comments: {commentAlways ? "required on every decision" : "required to reject or return"}, at least {minComment} characters.
                  </Text>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Stack>

      <StepUpAuthDialog
        length={getRule<number>("auth.otpLength")}
        resendCooldown={getRule<number>("auth.otpResendCooldownSeconds")}
        open={stepUpOpen}
        onOpenChange={(o) => {
          setStepUpOpen(o);
          // The dialog closes before calling onVerified, so resolve with the verification result here.
          if (!o && resolver.current) {
            resolver.current(verified.current);
            resolver.current = null;
          }
        }}
        summary={`Approve “${i.title}”${amount !== undefined ? ` — ${money(amount)}` : ""}`}
        description="Demo: enter any complete code (TD-858)."
        onVerify={async (code) => (verified.current = (await verifyStepUp(null, code)).ok)}
        errorMessage="Enter the 6-digit code."
      />
    </ModulePage>
  );
}
