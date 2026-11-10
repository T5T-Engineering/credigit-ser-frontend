"use client";

import { useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  Alert,
  ApprovalTimeline,
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
  useToast,
  type DecisionAction,
} from "@credigit/web-ui";
import { money, moneyShort } from "@/lib/format";
import { roleById } from "@/lib/rbac/roles";
import { buildChainFor, chainStatus, collateralDueDiligenceDone, currentSteps, decide, finalAuthority, isBreach } from "../logic";
import { TENANT_PARAM_NOTE } from "../params";
import { toApprovalTiers } from "../view-models";
import type { AppCtx } from "./context";
import { useStepUpThreshold } from "../use-params";

const toDecision: Record<DecisionAction, "approved" | "declined" | "recommended" | "returned"> = {
  approve: "approved",
  decline: "declined",
  recommend: "recommended",
  return: "returned",
};
const verb: Record<DecisionAction, string> = { approve: "Approved", decline: "Declined", recommend: "Recommended", return: "Returned for rework" };

export function ApprovalsTab({ c }: { c: AppCtx }) {
  const { app, roleId, me, users } = c;
  const { toast } = useToast();
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const steps = currentSteps(app.approvals);
  const mine = steps.find((s) => s.roleId === roleId);
  const inDecisionStage = app.stage === "Recommendation" || app.stage === "Approval";
  const isInitiator = app.createdById === me.id;
  const blocked = isBreach(app.limitGate) && c.extra.exception?.decision !== "granted";
  const threshold = useStepUpThreshold();
  const highValue = app.amount > threshold;
  const bdmBlocked = mine?.roleId === "bdm" && !collateralDueDiligenceDone(c.collateral);
  const status = chainStatus(app.approvals);
  const current = steps[0];
  const currentTierId = current ? (current.adjudicates ?? current.pair ?? current.id) : undefined;

  const actions: DecisionAction[] = !mine
    ? []
    : mine.adjudicates
      ? ["approve", "decline"]
      : mine.roleId === "bdm" && !mine.pair
        ? ["recommend", "return", "decline"]
        : ["approve", "return", "decline"];

  const onDecide = ({ decision, comment }: { decision: DecisionAction; comment: string }) => {
    if (!mine) return;
    const label = `${verb[decision]} at tier ${mine.tier} (${roleById[mine.roleId].short}${mine.adjudicates ? ", adjudicator" : ""})`;
    if (decision === "return") {
      const fresh = buildChainFor(app.flow, app.amount, users);
      c.change({ approvals: fresh, stage: "Analysis" }, label, app.stage, "Analysis — rework");
      toast({ title: "Returned for rework", description: "The request is back with the Credit Analyst; the approval route restarts.", tone: "warning" });
      return;
    }
    const next = decide(app.approvals, mine.id, toDecision[decision], comment, users);
    const result = chainStatus(next);
    const dissent = next.find((s) => s.adjudicates && !app.approvals.some((x) => x.id === s.id));
    const stage = result === "Declined" ? "Declined" : app.stage === "Recommendation" && decision === "recommend" ? "Approval" : app.stage;
    c.change({ approvals: next, stage }, label, mine.decision, comment);
    if (dissent) c.log(`Co-signer dissent — routed to ${roleById[dissent.roleId].name} for adjudication`, "Dissent", roleById[dissent.roleId].name);
    toast({
      title: verb[decision],
      description: dissent ? `Co-signers disagree — routed to the ${roleById[dissent.roleId].name}.` : result === "Approved" ? "All tiers have signed — ready to release to the offer letter." : result === "Declined" ? "The request is declined." : "Routed to the next tier.",
      tone: decision === "decline" ? "danger" : "success",
    });
  };

  let notice: React.ReactNode = null;
  if (mine && isInitiator) notice = "Segregation of duties: you initiated this request, so you cannot decide on it (PRD §4.2).";
  else if (mine && blocked) notice = "Blocked by the portfolio-limit gate until the CRO / Board grants an exception.";
  else if (bdmBlocked) notice = "Collateral due diligence is not complete — Legal must finish the search before the BDM can submit (PRD §6.1.1, step 3). You can still return or decline.";

  return (
    <Grid columns={{ base: 1, lg: 3 }} gap="large">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <div><CardTitle>Approval route — {app.flow} chart-flow</CardTitle>
            <CardDescription>
              {money(app.amount)} routes up to {finalAuthority(app.approvals)}. Co-signers sign together; dissent routes automatically to the named adjudicator so an approval never sits idle (PRD §4.2, §6.1.2).
            </CardDescription></div>
          </CardHeader>
          <CardContent>
            <ApprovalTimeline tiers={toApprovalTiers(app.approvals, users)} currentTierId={inDecisionStage ? currentTierId : undefined} />
          </CardContent>
        </Card>
      </div>
      <Stack gap="large">
        {inDecisionStage && mine ? (
          <DecisionPanel
            title={`Your decision — ${roleById[mine.roleId].name}${mine.adjudicates ? " (adjudicator)" : ""}`}
            actions={bdmBlocked ? actions.filter((a) => a !== "recommend") : actions}
            onDecide={onDecide}
            disabled={isInitiator || blocked}
            notice={notice ?? (highValue ? `Above the ${moneyShort(threshold)} high-value threshold — step-up authentication is required.` : undefined)}
            commentRequired
            minCommentLength={5}
            requireStepUp={highValue}
            onStepUp={() =>
              new Promise<boolean>((resolve) => {
                resolver.current = resolve;
                setStepUpOpen(true);
              })
            }
          />
        ) : (
          <Alert tone={status === "Declined" ? "danger" : status === "Approved" ? "success" : "info"} title={status === "Approved" ? "Fully approved" : status === "Declined" ? "Declined" : inDecisionStage ? "No decision needed from your role" : `Stage: ${app.stage}`}>
            {inDecisionStage && steps.length
              ? `Waiting on ${steps.map((s) => roleById[s.roleId].name + (s.adjudicates ? " (adjudicator)" : "")).join(" and ")}. Switch role from the user menu to act as an approver.`
              : !inDecisionStage && status === "In progress"
                ? "Approvals open once the Credit Analyst completes analysis."
                : "This route is closed."}
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
              <Text variant="small">Initiator ({users.find((u) => u.id === app.createdById)?.name ?? "—"}) cannot approve, or act as Disbursement Maker / Checker.</Text>
              <Text variant="small">Approvers act only on their own step; both co-signers of a pair decide in parallel.</Text>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
      <StepUpAuthDialog
        open={stepUpOpen}
        onOpenChange={(open) => {
          setStepUpOpen(open);
          if (!open && resolver.current) {
            resolver.current(false);
            resolver.current = null;
          }
        }}
        onVerify={async (code) => /^\d{6}$/.test(code)}
        onVerified={() => {
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
