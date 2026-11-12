"use client";

/**
 * Executive governance state shared by the cockpit and the Board Risk Committee pack page: executive-summary
 * sign-off and the BRC pack, both routed through the Operations workflow (see ./platform.ts).
 */
import { useCallback } from "react";
import { format, getQuarter } from "date-fns";
import { useToast, type ChecklistItem } from "@credigit/web-ui";
import { DEMO_NOW } from "@/lib/data/seed";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { getDefinition, stepApproverLabel, usePendingFor } from "@/lib/platform/operations";
import { useScope } from "@/lib/platform/scope";
import { useSubmitOperation } from "@/modules/portfolio/components/governance";
import { useActor } from "@/modules/portfolio/hooks";
import { usePortfolioStore, type ReportRunStatus } from "@/modules/portfolio/store";
import { PACK_HREF, type PackApprovalPayload, type SummarySignOffPayload } from "./platform";

const PACK_REPORT_ID = "RPT-BRC";
const PACK_SUBMITTABLE: ReportRunStatus[] = ["AI-drafted — awaiting validation", "Validated", "Returned for correction"];

/** Current board-reporting period (quarter of the as-at date). */
export const boardPeriod = () => `Q${getQuarter(DEMO_NOW)} ${format(DEMO_NOW, "yyyy")}`;

export function useExecutiveGovernance() {
  const actor = useActor();
  const { actor: me } = useScope();
  const { toast } = useToast();
  const submit = useSubmitOperation();
  const period = boardPeriod();
  const summaryKey = `exec-summary:${period}`;
  const signOff = usePortfolioStore((s) => s.signOffs[summaryKey]);
  const runs = usePortfolioStore((s) => s.runs);
  const addRun = usePortfolioStore((s) => s.addRun);
  const updateRun = usePortfolioStore((s) => s.updateRun);
  const summaryPending = usePendingFor("ExecutiveSummary", summaryKey);
  const packRuns = runs.filter((r) => r.reportId === PACK_REPORT_ID);
  const brcRun = packRuns.find((r) => r.period.startsWith(period));
  const packPending = usePendingFor("BoardPack", brcRun?.id ?? "-");
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

  const buildPack = useCallback(async () => {
    const draftPeriod = `${period} (draft)`;
    const hook = await runHooks("executive.brcPack.build.before", { period: draftPeriod, actor: me });
    if (!hook.ok) {
      toast({ title: "Pack not built", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const id = `RUN-${Date.now().toString(36).toUpperCase()}`;
    addRun({ id, reportId: PACK_REPORT_ID, period: hook.ctx.period, status: "AI-drafted — awaiting validation", generatedAt: new Date().toISOString(), generatedBy: actor.name, generatedById: me.id, reconciled: true });
    actor.log("Built Board Risk Committee pack", "Report", id, undefined, hook.ctx.period);
    publish("executive.brcPack.built", { module: "executive", subject: { type: "BoardPack", id, title: `Board Risk Committee pack — ${hook.ctx.period}`, href: PACK_HREF }, payload: { period: hook.ctx.period } });
    await runHooks("executive.brcPack.build.after", { runId: id, period: hook.ctx.period });
  }, [period, me, toast, addRun, actor]);

  const submitPack = useCallback(async () => {
    if (!brcRun || !PACK_SUBMITTABLE.includes(brcRun.status)) return;
    const hook = await runHooks("executive.brcPack.submit.before", { summaryKey, run: brcRun, actor: me });
    if (!hook.ok) {
      toast({ title: "Can't submit pack", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const before = brcRun.status;
    updateRun(brcRun.id, { status: "Submitted for release", validatedBy: actor.name, validatedById: me.id, returnReason: undefined });
    const res = await submit<PackApprovalPayload>("executive.brc-pack.approve", {
      title: `Approve Board Risk Committee pack — ${brcRun.period}`,
      subject: { type: "BoardPack", id: brcRun.id, title: `Board Risk Committee pack — ${brcRun.period}`, href: PACK_HREF },
      payload: { runId: brcRun.id, period: brcRun.period },
      summary: [
        { label: "Period", value: brcRun.period },
        { label: "Run", value: brcRun.id },
        { label: "Executive summary", value: signOff ? `Signed off by ${signOff.by}` : "Not signed off" },
        { label: "Prepared by", value: brcRun.generatedBy },
      ],
    });
    if (!res.ok) {
      updateRun(brcRun.id, { status: before });
      return;
    }
    if (!res.applied) updateRun(brcRun.id, { operationId: res.instance.id });
    actor.log("Submitted Board Risk Committee pack for approval", "Report", brcRun.id, before, "Submitted for release");
    publish("executive.brcPack.submitted", { module: "executive", subject: { type: "BoardPack", id: brcRun.id, title: `Board Risk Committee pack — ${brcRun.period}`, href: PACK_HREF }, payload: { operationId: res.instance.id } });
    await runHooks("executive.brcPack.submit.after", { runId: brcRun.id, operationId: res.instance.id });
  }, [brcRun, summaryKey, me, toast, updateRun, actor, submit, signOff]);

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
    packRuns,
    brcRun,
    packPending,
    packItems,
    buildPack,
    submitPack,
    canSubmitPack: !!brcRun && PACK_SUBMITTABLE.includes(brcRun.status),
  };
}
