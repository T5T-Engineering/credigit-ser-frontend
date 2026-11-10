"use client";

import Link from "next/link";
import { ArrowRight, CircleCheck, FileSignature, Send, Undo2 } from "lucide-react";
import { Alert, Button, Stack, Text, type ChecklistItem } from "@credigit/web-ui";
import { roleById } from "@/lib/rbac/roles";
import { chainStatus, collateralDueDiligenceDone, copBand, currentSteps, isBreach, recommendationLabel, stageAfterAnalysis } from "../logic";
import { initiatorRoles } from "../use-me";
import type { AppCtx } from "./context";

/** Pre-approval gates (PRD §5.2 bureau/CRMS, §5.4 OCR, §6.1.4 COP, §6.1.5 limit gate, §6.1.1 step 3 collateral due diligence). */
export function gateItems(c: AppCtx): ChecklistItem[] {
  const { app } = c;
  const band = copBand(app.copRatio);
  const processing = c.docs.filter((d) => d.status === "Processing OCR" || d.status === "Uploaded").length;
  const items: ChecklistItem[] = [
    { id: "docs", title: "Documents extracted (OCR)", description: c.docs.length ? (processing ? `${processing} document(s) still processing` : `${c.docs.length} documents extracted or verified`) : "No documents uploaded", status: c.docs.length && !processing ? "met" : "pending", owner: "Account Officer", locked: true },
    { id: "bureau", title: "Credit bureau reports (2 bureaux)", description: "Mandatory before approval — CBN 3.7(c)", status: app.bureauChecked ? "met" : "pending", owner: "Credit Analyst", locked: true },
    { id: "crms", title: "CRMS search", description: "CBN 3.7(d)", status: app.crmsChecked ? "met" : "pending", owner: "Credit Analyst", locked: true },
    { id: "cop", title: "COP Ratio confidence", description: band ? `${app.copRatio!.toFixed(2)} — ${band.label}` : "Not yet computed", status: !band ? "pending" : band.requiresExplanation && !c.extra.copExplanation ? "breached" : "met", owner: "Credit Analyst", locked: true },
    { id: "limit", title: "Portfolio-limit gate", description: app.limitGate === "Not checked" ? "Not run" : isBreach(app.limitGate) ? `${app.limitGate}${c.extra.exception?.decision === "granted" ? " — exception granted" : " — routed to CRO / Board"}` : "Within single-obligor and sectoral limits", status: app.limitGate === "Not checked" ? "pending" : isBreach(app.limitGate) ? (c.extra.exception?.decision === "granted" ? "waived" : "breached") : "met", owner: "System", locked: true },
    { id: "collateral", title: "Collateral due diligence (Legal search)", description: c.collateral.length ? (collateralDueDiligenceDone(c.collateral) ? "Search complete on all pledged items" : "Legal search outstanding — BDM cannot submit") : "No collateral pledged", status: collateralDueDiligenceDone(c.collateral) ? "met" : "pending", owner: "Legal Officer", locked: true },
    { id: "rec", title: "Recommendation adopted", description: app.recommendation ? recommendationLabel[app.recommendation] : "Awaiting Credit Analyst", status: app.recommendation ? "met" : "pending", owner: "Credit Analyst", locked: true },
  ];
  return items;
}

export function NextStepCard({ c, onOpenTab }: { c: AppCtx; onOpenTab: (tab: string) => void }) {
  const { app, roleId, canEdit } = c;
  const isInitiatorRole = Boolean(roleId && initiatorRoles.includes(roleId));
  const gates = gateItems(c);
  const gate = (id: string) => gates.find((g) => g.id === id)!;
  const status = chainStatus(app.approvals);
  const steps = currentSteps(app.approvals);
  const withdraw =
    canEdit && isInitiatorRole && ["Draft", "Documents", "Analysis"].includes(app.stage) ? (
      <Button variant="text" iconBefore={<Undo2 aria-hidden />} onClick={() => c.change({ stage: "Withdrawn" }, "Withdrew application", app.stage, "Withdrawn")}>
        Withdraw
      </Button>
    ) : null;

  let tone: "info" | "success" | "warning" | "danger" = "info";
  let title = "";
  let body = "";
  let action: React.ReactNode = null;

  switch (app.stage) {
    case "Draft": {
      title = "Draft — not yet submitted";
      body = "Complete the request and submit it. It flows in parallel to the BDM and to Legal for collateral search (PRD §6.1.1, step 2).";
      const docsReady = gate("docs").status === "met";
      if (canEdit && isInitiatorRole)
        action = (
          <Button iconBefore={<Send aria-hidden />} onClick={() => c.change({ stage: docsReady ? "Analysis" : "Documents" }, "Submitted application", "Draft", docsReady ? "Analysis" : "Documents")}>
            Submit application
          </Button>
        );
      break;
    }
    case "Documents": {
      title = "Documents — OCR extraction and verification";
      body = gate("docs").description as string;
      if (canEdit && (roleId === "credit-analyst" || isInitiatorRole))
        action = (
          <Button disabled={gate("docs").status !== "met"} iconAfter={<ArrowRight aria-hidden />} onClick={() => c.change({ stage: "Analysis" }, "Documents complete — sent to analysis", "Documents", "Analysis")}>
            Send to analysis
          </Button>
        );
      break;
    }
    case "Analysis": {
      const needed = ["bureau", "crms", "cop", "limit", "rec"].map(gate).filter((g) => g.status === "pending" || (g.status === "breached" && g.id === "cop"));
      title = "Analysis — Credit Analyst validation";
      body = needed.length ? `Outstanding before release: ${needed.map((g) => String(g.title).toLowerCase()).join("; ")}.` : "All analysis gates are complete. Release the request for recommendation and approval.";
      tone = needed.length ? "info" : "success";
      if (canEdit && roleId === "credit-analyst") {
        const next = stageAfterAnalysis(app.approvals);
        action = (
          <Button disabled={needed.length > 0} iconBefore={<CircleCheck aria-hidden />} onClick={() => c.change({ stage: next }, "Completed credit analysis", "Analysis", next)}>
            Complete analysis
          </Button>
        );
      }
      break;
    }
    case "Recommendation":
    case "Approval": {
      if (isBreach(app.limitGate) && c.extra.exception?.decision !== "granted") {
        tone = "danger";
        title = `Blocked by the portfolio-limit gate — ${app.limitGate}`;
        body = "Progression is blocked and the request is routed to the CRO / Board for an informed exception decision (PRD §6.1.5).";
      } else if (status === "Approved") {
        tone = "success";
        title = "Fully approved";
        body = "All required tiers have signed. Release the request to offer-letter generation (PRD §7).";
        if (canEdit && (isInitiatorRole || roleId === "cco" || roleId === "credit-analyst"))
          action = (
            <Button iconBefore={<FileSignature aria-hidden />} onClick={() => c.change({ stage: "Offer" }, "Released to offer letter", app.stage, "Offer")}>
              Release to offer letter
            </Button>
          );
      } else {
        const who = steps.map((s) => `${roleById[s.roleId].name}${s.adjudicates ? " (adjudicator)" : ""}`).join(" and ");
        const mine = steps.some((s) => s.roleId === roleId);
        tone = mine ? "warning" : "info";
        title = mine ? "Your decision is required" : `Awaiting ${who}`;
        body = app.stage === "Recommendation" ? "BDM concurs, declines or returns for rework; cannot submit until collateral due diligence is complete." : `Co-signer chart-flow in progress — ${app.approvals.filter((s) => s.decision !== "pending").length} of ${app.approvals.length} steps decided.`;
        action = (
          <Button variant={mine ? "primary" : "tertiary"} iconAfter={<ArrowRight aria-hidden />} onClick={() => onOpenTab("approvals")}>
            {mine ? "Decide now" : "View approval route"}
          </Button>
        );
      }
      break;
    }
    case "Offer":
      tone = "success";
      title = "Approved — offer letter stage";
      body = "The Account Officer presents the system-generated offer letter and collects acceptance documents (PRD §6.1.1, step 13).";
      action = (
        <Button as={Link} href={`/offer-letters/letter/?applicationId=${app.id}`} iconBefore={<FileSignature aria-hidden />}>
          Open offer letter
        </Button>
      );
      break;
    case "Conditions":
      title = "Conditions precedent with Legal and Credit Administration";
      body = "Security documents are being verified and vaulted; Credit Administration confirms all terms before release.";
      action = (
        <Button as={Link} href="/credit-admin/" variant="tertiary" iconAfter={<ArrowRight aria-hidden />}>
          Credit administration
        </Button>
      );
      break;
    case "Disbursement":
      tone = "success";
      title = "With Disbursement (Maker / Checker)";
      body = "Segregation of duties: the initiator and recommender cannot act as Maker or Checker (PRD §4.2).";
      action = (
        <Button as={Link} href="/disbursement/" variant="tertiary" iconAfter={<ArrowRight aria-hidden />}>
          Disbursement
        </Button>
      );
      break;
    case "Booked":
      tone = "success";
      title = "Booked on the core banking system";
      body = "The facility is live and now monitored in Loan review & monitoring.";
      break;
    case "Declined":
      tone = "danger";
      title = "Declined";
      body = app.approvals.find((s) => s.decision === "declined")?.comment ?? "Declined during origination.";
      break;
    case "Withdrawn":
      title = "Withdrawn";
      body = "This request was withdrawn and is retained for audit.";
      break;
  }

  return (
    <Alert
      tone={tone}
      title={title}
      action={
        action || withdraw ? (
          <Stack direction="horizontal" gap="small" wrap>
            {action}
            {withdraw}
          </Stack>
        ) : undefined
      }
    >
      <Text variant="small">{body}</Text>
    </Alert>
  );
}
