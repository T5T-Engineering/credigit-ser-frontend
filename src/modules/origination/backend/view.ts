/**
 * Display helpers for backend applications (stage tones, SLA state, next action).
 */
import type { Tone } from "@credigit/web-ui";
import { getRule } from "@/lib/platform/rules";
import { slaTones, type SlaState } from "../logic";
import { OPEN_STAGES, isBreach, type ApplicationStage, type CreditApplication } from "./api";

export { slaTones, type SlaState };

export const backendStageTones: Record<ApplicationStage, Tone> = {
  Draft: "neutral",
  Analysis: "info",
  Approval: "warning",
  Approved: "success",
  Declined: "danger",
  Withdrawn: "neutral",
};

export const isOpenStage = (a: CreditApplication) => OPEN_STAGES.includes(a.stage);

/** SLA state against the backend due date; the "due soon" window is rule `origination.sla.dueSoonDays` (TD-980). */
export function backendSlaState(a: CreditApplication, now = new Date()): SlaState {
  if (!isOpenStage(a)) return "Closed";
  const due = new Date(a.slaDueAt).getTime();
  const t = now.getTime();
  if (due < t) return "Breached";
  if (due - t < getRule<number>("origination.sla.dueSoonDays") * 86_400_000) return "Due soon";
  return "On track";
}

/** What has to happen next, from the backend state. */
export function backendNextAction(a: CreditApplication): string {
  switch (a.stage) {
    case "Draft":
      return "Initiator to complete and submit";
    case "Analysis":
      if (!a.analysis) return "Credit Analyst — record the analysis outcome";
      if (isBreach(a.analysis.limitGate) && a.limitException?.status !== "Granted")
        return a.limitException?.status === "Pending" ? "Limit exception awaiting decision" : "Credit Analyst — request a limit exception";
      if (a.override?.status === "Pending") return "Recommendation override awaiting decision";
      return "Initiator — submit for approval";
    case "Approval":
      return "Approvers — chart-flow decision";
    case "Approved":
      return "Approved — ready for offer";
    default:
      return "—";
  }
}
