"use client";

/**
 * Executive governance state for the cockpit: executive-summary sign-off (Operations workflow, ./platform.ts)
 * and the readiness of the Board Risk Committee pack, whose one flow lives in enterprise-risk.
 */
import { useCallback } from "react";
import { format, getQuarter } from "date-fns";
import { type ChecklistItem } from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { DEMO_NOW } from "@/lib/data/seed";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { getDefinition, stepApproverLabel, usePendingFor } from "@/lib/platform/operations";
import { useScope } from "@/lib/platform/scope";
import { useSubmitOperation } from "@/modules/portfolio/components/governance";
import { useActor } from "@/modules/portfolio/hooks";
import { usePortfolioStore } from "@/modules/portfolio/store";
import { useErm } from "@/modules/enterprise-risk/store";
import type { SummarySignOffPayload } from "./platform";


/** Current board-reporting period (quarter of the as-at date). */
export const boardPeriod = () => `Q${getQuarter(DEMO_NOW)} ${format(DEMO_NOW, "yyyy")}`;

export function useExecutiveGovernance() {
  const actor = useActor();
  const { actor: me } = useScope();
  const { toast } = useSaveFeedback();
  const submit = useSubmitOperation();
  const period = boardPeriod();
  const summaryKey = `exec-summary:${period}`;
  const signOff = usePortfolioStore((s) => s.signOffs[summaryKey]);
  const summaryPending = usePendingFor("ExecutiveSummary", summaryKey);
  // Latest pack from the single BRC pack flow (enterprise-risk).
  const latestPack = useErm((s) => s.packs[0] as (typeof s.packs)[number] | undefined);
  const signers = getDefinition("executive.summary.signoff").steps.map(stepApproverLabel).join(" → ");

  const submitSummary = useCallback(
    async (headline: string) => {
      const hook = await runHooks("executive.summary.submit.before", { key: summaryKey, period, headline, actor: me });
      if (!hook.ok) {
        toast({ title: "Can't submit summary", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
        return;
      }
      const res = await submit<SummarySignOffPayload>("executive.summary.signoff", {
        title: `Sign off executive risk summary — ${period}`,
        subject: { type: "ExecutiveSummary", id: summaryKey, title: `Executive risk summary — ${period}`, href: "/executive" },
        payload: { key: summaryKey, period, headline: hook.ctx.headline },
        summary: [
          { label: "Period", value: period },
          { label: "Headline", value: hook.ctx.headline },
        ],
      });
      if (!res.ok) return;
      actor.log("Submitted AI executive summary for sign-off", "ExecutiveSummary", summaryKey, "AI-drafted", "Submitted for sign-off");
      publish("executive.summary.submitted", { module: "executive", subject: { type: "ExecutiveSummary", id: summaryKey, title: `Executive risk summary — ${period}`, href: "/executive" }, payload: { operationId: res.instance.id } });
      await runHooks("executive.summary.submit.after", { key: summaryKey, operationId: res.instance.id });
    },
    [summaryKey, period, me, toast, submit, actor],
  );

  const packItems: ChecklistItem[] = [
    { id: "appetite", title: "Risk appetite scorecard", description: "Actual vs Board-approved thresholds", status: "met", owner: "Head of Risk" },
    { id: "conc", title: "Concentration — Top 20 and sectoral limits", description: "", status: "met", owner: "Portfolio & MIS Officer" },
    { id: "warr", title: "WARR with migration matrix and new vs existing split", description: "", status: "met", owner: "Portfolio & MIS Officer" },
    { id: "ifrs9", title: "IFRS 9 stage migration and ECL movement", description: "", status: "pending", owner: "Predictive Analytics Officer" },
    { id: "market", title: "Market & liquidity: LDR, NOP, liquidity ratio", description: "", status: "pending", owner: "Market Risk Analyst" },
    { id: "op", title: "Operational risk KRI scorecard and loss trend", description: "", status: "pending", owner: "Operational Risk Analyst" },
    { id: "summary", title: "Executive summary signed off", description: `AI-drafted, human-approved — ${signers || "no approval step"}`, status: signOff ? "met" : "pending", owner: "CRO / Head of Risk" },
  ];

  return {
    period,
    summaryKey,
    signOff,
    summaryPending,
    submitSummary,
    signers,
    latestPack,
    packItems,
  };
}
