"use client";

/** AI outputs across modules (PRD §6.12) — drafts and flags awaiting the accountable human's sign-off. */
import { useMemo } from "react";
import type { RoleId } from "@/lib/rbac/roles";
import { useApplications, useCollateral, useFacilities, useObligors } from "@/lib/data/hooks";
import { isoDaysAgo } from "../operational-risk/shared";
import { useOpRisk } from "../operational-risk/store";
import { useErm } from "../enterprise-risk/store";
import { useAi } from "./store";

export type AiActivity = {
  id: string;
  kind: "AI-drafted" | "AI-flagged";
  capability: "Document intelligence" | "Exception flagging" | "Trend tracking" | "Auto-report generation" | "Credit-memo drafting";
  module: string;
  href: string;
  item: string;
  entity: string;
  generatedAt: string;
  model: string;
  confidence: number;
  accountable: RoleId;
  phase: 1 | 2;
  status: "Pending sign-off" | "Signed off" | "Rejected";
  decidedBy?: string;
  decidedAt?: string;
};

export function useAiActivity(): AiActivity[] {
  const applications = useApplications();
  const facilities = useFacilities();
  const obligors = useObligors();
  const collateral = useCollateral();
  const kriSignedOff = useOpRisk((s) => s.commentarySignedOffBy);
  const packs = useErm((s) => s.packs);
  const signOffs = useAi((s) => s.signOffs);

  return useMemo(() => {
    const name = (oid: string) => obligors.find((o) => o.id === oid)?.name ?? oid;
    const apps = applications.filter((a) => a.stage === "Analysis" || a.stage === "Documents" || a.stage === "Recommendation").slice(0, 3);
    const pastDue = facilities.filter((f) => f.dpd >= 30).slice(0, 2);
    const shares = collateral.filter((c) => c.type === "Quoted shares").slice(0, 1);
    const items: Omit<AiActivity, "status">[] = [
      ...apps.slice(0, 2).map((a, i) => ({ id: `AIA-DOC-${a.id}`, kind: "AI-drafted" as const, capability: "Document intelligence" as const, module: "Loan origination", href: `/origination/application?id=${a.id}`, item: `OCR field extraction — audited financials FY2025 (${name(a.obligorId)})`, entity: a.id, generatedAt: isoDaysAgo(i + 1), model: "SER DocIntel 3.1", confidence: 0.91 - i * 0.05, accountable: "credit-analyst" as RoleId, phase: 1 as const })),
      ...(apps[2] ? [{ id: `AIA-MEMO-${apps[2].id}`, kind: "AI-drafted" as const, capability: "Credit-memo drafting" as const, module: "360 RAR analysis", href: `/origination/application?id=${apps[2].id}`, item: `Credit recommendation & covenant rationale — ${name(apps[2].obligorId)}`, entity: apps[2].id, generatedAt: isoDaysAgo(1), model: "SER Narrative 1.4", confidence: 0.76, accountable: "credit-analyst" as RoleId, phase: 2 as const }] : []),
      ...pastDue.map((f, i) => ({ id: `AIA-EXC-${f.id}`, kind: "AI-flagged" as const, capability: "Exception flagging" as const, module: "Loan review & monitoring", href: "/monitoring/exceptions", item: `${f.dpd} days past due — ${name(f.obligorId)} (${f.product})`, entity: f.id, generatedAt: isoDaysAgo(i), model: "SER Exception Rules 1.0", confidence: 0.99, accountable: "loan-review-officer" as RoleId, phase: 1 as const })),
      ...shares.map((c) => ({ id: `AIA-MRG-${c.id}`, kind: "AI-flagged" as const, capability: "Exception flagging" as const, module: "Collateral & legal", href: "/collateral/shares", item: `Share-collateral margin near shortfall — ${c.ticker ?? c.description}`, entity: c.id, generatedAt: isoDaysAgo(0), model: "SER Exception Rules 1.0", confidence: 0.97, accountable: "collateral-officer" as RoleId, phase: 2 as const })),
      { id: "AIA-LIM-GOV", kind: "AI-flagged", capability: "Exception flagging", module: "Enterprise risk", href: "/enterprise-risk?tab=appetite", item: "Government-sector exposure above the 10% CBN ceiling", entity: "RA-03", generatedAt: isoDaysAgo(2), model: "SER Anomaly 0.8", confidence: 0.98, accountable: "cro", phase: 2 },
      { id: "AIA-REC-SUSP", kind: "AI-flagged", capability: "Exception flagging", module: "Portfolio & MIS", href: "/portfolio", item: "Suspense-account items ageing past the clearance window (7 items)", entity: "GL-SUSP-01", generatedAt: isoDaysAgo(1), model: "SER Exception Rules 1.0", confidence: 0.95, accountable: "portfolio-mis-officer", phase: 1 },
      { id: "AIA-KRI-COMMENTARY", kind: "AI-drafted", capability: "Trend tracking", module: "Operational risk", href: "/operational-risk", item: "KRI trend & correlation commentary (attrition ↔ complaints)", entity: "KRI-HC-01, KRI-CC-01", generatedAt: isoDaysAgo(0), model: "SER Trend Analyser 2.3", confidence: 0.82, accountable: "operational-risk-analyst", phase: 2 },
      { id: "AIA-RPT-CBN", kind: "AI-drafted", capability: "Auto-report generation", module: "Portfolio & MIS", href: "/portfolio/reports", item: "CBN monthly prudential return — October 2026 (templated draft)", entity: "RPT-2026-10", generatedAt: isoDaysAgo(3), model: "SER Reports 1.2", confidence: 0.88, accountable: "portfolio-mis-officer", phase: 1 },
      ...packs.slice(0, 1).map((p) => ({ id: `AIA-BRC-${p.id}`, kind: "AI-drafted" as const, capability: "Auto-report generation" as const, module: "Enterprise risk", href: "/enterprise-risk?tab=brc", item: `Board Risk Committee pack — executive summary (${p.id})`, entity: p.id, generatedAt: p.compiledAt, model: "SER Narrative 1.4", confidence: 0.78, accountable: "head-of-risk" as RoleId, phase: 2 as const })),
    ];
    return items.map((it) => {
      if (it.id === "AIA-KRI-COMMENTARY" && kriSignedOff) return { ...it, status: "Signed off" as const, decidedBy: kriSignedOff };
      const pack = packs.find((p) => it.id === `AIA-BRC-${p.id}`);
      if (pack && pack.status !== "Draft") return { ...it, status: "Signed off" as const, decidedBy: pack.compiledBy };
      const so = signOffs[it.id];
      return so ? { ...it, status: so.status, decidedBy: so.by, decidedAt: so.at } : { ...it, status: "Pending sign-off" as const };
    });
  }, [applications, facilities, obligors, collateral, kriSignedOff, packs, signOffs]);
}
