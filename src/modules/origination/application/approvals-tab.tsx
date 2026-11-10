"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, KeyRound, Send } from "lucide-react";
import {
  Alert,
  ApprovalTimeline,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DecisionPanel,
  Grid,
  Stack,
  StepUpAuthDialog,
  Text,
  TextLink,
  WorkflowInstanceCard,
  useToast,
  type DecisionAction,
} from "@credigit/web-ui";
import { dateTime, money, moneyShort } from "@/lib/format";
import { roleById } from "@/lib/rbac/roles";
import { canDecide, currentStep, getDefinition, useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { collateralDueDiligenceDone, finalAuthority, isBreach } from "../logic";
import { inGroup, TENANT_PARAM_NOTE } from "../params";
import { toApprovalTiers, toOperationSteps, toUiOperationStatus } from "../view-models";
import { decideApplicationOperation, freshChain, isCreditOp, markStepUp, submitForApproval } from "../actions";
import { operationHref } from "./operation-status";
import type { AppCtx } from "./context";
import { useStepUpThreshold } from "../use-params";

const toEngine: Record<DecisionAction, "approve" | "reject" | "return"> = { approve: "approve", recommend: "approve", decline: "reject", return: "return" };

export function ApprovalsTab({ c }: { c: AppCtx }) {
  const { app, users } = c;
  const { actor } = useScope();
  const { toast } = useToast();
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const threshold = useStepUpThreshold();
  const minComment = useRule<number>("operations.minCommentLength");
  const warnHours = useRule<number>("origination.sla.warnWithinHours");
  const instances = useOperationsStore((s) => s.instances);
  const history = instances.filter((i) => isCreditOp(i.operationType) && i.subject.id === app.id);
  const op = history[0];
  const open = op && (op.status === "Pending" || op.status === "In progress");
  const steps = op ? getDefinition(op.operationType).steps : [];
  const step = op ? currentStep(op) : undefined;
  const allowed = op && open ? canDecide(op, actor) : undefined;
  const inDecisionStage = app.stage === "Recommendation" || app.stage === "Approval";
  const blocked = isBreach(app.limitGate) && c.extra.exception?.decision !== "granted";
  const highValue = app.amount > threshold;
  const bdmStep = Boolean(step && op && op.stepIndex === 0 && step.approverRoles.length === 1 && step.approverRoles[0] === "bdm");
  const bdmBlocked = bdmStep && actor.roleId === "bdm" && !collateralDueDiligenceDone(c.collateral);
  const canSubmit = c.canEdit && inDecisionStage && !open && inGroup("initiators", actor.roleId) && app.createdById === actor.id;
  const preview = op ? app.approvals : freshChain(app);

  const actions: DecisionAction[] = op?.awaitingAdjudication ? ["approve", "decline"] : bdmStep ? ["recommend", "return", "decline"] : ["approve", "return", "decline"];

  const onDecide = async ({ decision, comment }: { decision: DecisionAction; comment: string }) => {
    if (!op) return;
    const res = await decideApplicationOperation(op.id, toEngine[decision], comment);
    if (!res.ok) { toast({ title: "Decision not recorded", description: res.reason, tone: "danger" }); return; }
    const after = useOperationsStore.getState().instances.find((i) => i.id === op.id);
    toast({
      title: "Decision recorded",
      description: after?.awaitingAdjudication ? "Co-signers disagree — routed to the adjudicator." : after?.status === "Approved" ? "All tiers have signed — ready to release to the offer letter." : after?.status === "Rejected" ? "The request is declined." : after?.status === "Returned" ? "Returned to the Credit Analyst; the route restarts." : "Recorded — waiting on the next signer.",
      tone: decision === "decline" ? "danger" : "success",
    });
  };

  const submit = async () => {
    setSubmitting(true);
    const res = await submitForApproval(app.id);
    setSubmitting(false);
    toast(res.ok ? { title: "Submitted for approval", description: res.message, tone: "success" } : { title: "Not submitted", description: res.reason, tone: "danger" });
  };

  let notice: React.ReactNode = null;
  if (blocked) notice = "Blocked by the portfolio-limit gate until the CRO / Board grant an exception.";
  else if (bdmBlocked) notice = "Collateral due diligence is not complete — Legal must finish the search before the BDM can concur (PRD §6.1.1, step 3). You can still return or decline.";
  else if (highValue) notice = `Above the ${moneyShort(threshold)} high-value threshold — step-up authentication is required.`;

  return (
    <Grid columns={{ base: 1, lg: 3 }} gap="large">
      <Stack gap="large" className="lg:col-span-2">
        {op ? (
          <WorkflowInstanceCard
            subject={{ title: op.title, type: getDefinition(op.operationType).name, href: operationHref(op.id), reference: op.id }}
            status={toUiOperationStatus(op.status)}
            requester={{ name: op.requestedBy.name, role: roleById[op.requestedBy.roleId]?.name }}
            submittedAt={dateTime(op.requestedAt)}
            steps={toOperationSteps(op, steps)}
            warnWithinMs={warnHours * 3_600_000}
            linkComponent={Link}
            titleAs="h2"
            actions={
              <Button as={Link} href={operationHref(op.id)} variant="tertiary" iconAfter={<ArrowUpRight aria-hidden />}>
                Open in Operations
              </Button>
            }
          />
        ) : (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Approval route — {app.flow} chart-flow (preview)</CardTitle>
                <CardDescription>
                  {money(app.amount)} routes up to {finalAuthority(preview)}. Once submitted, the route runs in Operations: co-signers sign together and dissent goes to the named adjudicator (PRD §4.2, §6.1.2).
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ApprovalTimeline tiers={toApprovalTiers(preview, users)} />
            </CardContent>
          </Card>
        )}
        {history.length > 1 ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Earlier approval rounds</CardTitle>
                <CardDescription>Returned or withdrawn rounds are kept for audit.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Stack gap="small">
                {history.slice(1).map((h) => (
                  <Text key={h.id} variant="small">
                    <TextLink as={Link} href={operationHref(h.id)}>{h.id}</TextLink> · {h.status} · {dateTime(h.completedAt ?? h.requestedAt)}
                    {h.reason ? ` — ${h.reason}` : ""}
                  </Text>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
      <Stack gap="large">
        {op && open && allowed?.ok ? (
          <DecisionPanel
            title={`Your decision — ${roleById[actor.roleId]?.name}${op.awaitingAdjudication ? " (adjudicator)" : ""}`}
            actions={bdmBlocked ? actions.filter((a) => a !== "recommend") : actions}
            onDecide={onDecide}
            notice={notice ?? undefined}
            commentRequired
            minCommentLength={minComment}
            requireStepUp={highValue}
            onStepUp={() =>
              new Promise<boolean>((resolve) => {
                resolver.current = resolve;
                setStepUpOpen(true);
              })
            }
          />
        ) : canSubmit ? (
          <Alert tone="info" title="Ready to submit for approval" action={<Button iconBefore={<Send aria-hidden />} loading={submitting} onClick={submit}>Submit for approval</Button>}>
            Analysis is complete. Submitting starts the {app.flow} chart-flow in Operations ({freshChain(app).length} signer(s), up to {finalAuthority(freshChain(app))}).
          </Alert>
        ) : (
          <Alert tone={op?.status === "Rejected" ? "danger" : op?.status === "Approved" ? "success" : "info"} title={op?.status === "Approved" ? "Fully approved" : op?.status === "Rejected" ? "Declined" : open ? "No decision needed from you" : inDecisionStage ? "Awaiting submission" : `Stage: ${app.stage}`}>
            {open
              ? allowed?.reason ?? "Waiting on another signer."
              : inDecisionStage
                ? `Waiting for the initiator (${users.find((u) => u.id === app.createdById)?.name ?? "Account Officer"}) to submit the request for approval.`
                : op
                  ? "This route is closed."
                  : "Approvals open once the Credit Analyst completes analysis."}
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="small">
              <Text variant="small">
                <KeyRound aria-hidden className="mr-1 inline size-4" />
                Step-up authentication above {moneyShort(threshold)} ({TENANT_PARAM_NOTE.toLowerCase()}).
              </Text>
              <Text variant="small">The requester ({op?.requestedBy.name ?? users.find((u) => u.id === app.createdById)?.name ?? "—"}) cannot decide any step (segregation of duties, enforced by Operations).</Text>
              <Text variant="small">Tiers, signers, adjudicators, limits and SLAs come from Operations → Business rules → Credit chart-flow.</Text>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
      <StepUpAuthDialog
        open={stepUpOpen}
        onOpenChange={(o) => {
          setStepUpOpen(o);
          if (!o && resolver.current) {
            resolver.current(false);
            resolver.current = null;
          }
        }}
        onVerify={async (code) => /^\d{6}$/.test(code)}
        onVerified={() => {
          if (op) markStepUp(op);
          resolver.current?.(true);
          resolver.current = null;
          setStepUpOpen(false);
          c.log("Step-up authentication verified", undefined, "OTP");
        }}
        summary={`${app.id} · ${c.obligor.name} · ${money(app.amount)}`}
        description="Enter the 6-digit code sent to your registered device. Demo: any 6-digit code works (e.g. 123456)."
      />
    </Grid>
  );
}
