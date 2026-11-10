"use client";

/**
 * Credit file management (PRD §6.3.3): minimum credit-file content per obligor per CBN Annexure 1.
 * Item status is derived from the Risk Data Spine where possible (documents, RAR date, collateral
 * perfection, offer-letter acceptance); the rest is deterministic demo state. Credit Admin overrides persist.
 */
import { useMemo } from "react";
import type { ChecklistStatus } from "@credigit/web-ui";
import { useCollateral, useDocuments, useObligors } from "@/lib/data/hooks";
import type { Obligor } from "@/lib/data/types";
import { useRule } from "@/lib/platform/rules";
import { daysBetween, rand } from "./common";
import type { FacilityRow } from "./logic";
import { useCreditAdminStore } from "./store";

export type FileSection = { id: string; title: string; items: Array<{ id: string; title: string; description: string; corporateOnly?: boolean }> };

export const annexure1: FileSection[] = [
  {
    id: "A",
    title: "Borrower information",
    items: [
      { id: "A1", title: "Customer information & KYC", description: "Account-opening KYC, address verification and customer information sheet." },
      { id: "A2", title: "Incorporation documents", description: "Certificate of incorporation, CAC status report, memorandum & articles.", corporateOnly: true },
      { id: "A3", title: "BVN of borrower / directors", description: "Bank Verification Numbers validated for the borrower or each director." },
      { id: "A4", title: "Board resolution to borrow", description: "Board resolution authorising the borrowing and the pledge of security.", corporateOnly: true },
    ],
  },
  {
    id: "B",
    title: "Facility description, terms, collateral & guarantors",
    items: [
      { id: "B1", title: "Approved credit memorandum", description: "Approval record with approving tier, terms and conditions." },
      { id: "B2", title: "Executed offer letter", description: "Signed acceptance and Memorandum of Acceptance under seal." },
      { id: "B3", title: "Collateral & perfection documents", description: "Title documents, valuation reports and evidence of perfection." },
      { id: "B4", title: "Guarantor details", description: "Guarantor identity, net-worth statement and executed guarantee where applicable." },
    ],
  },
  {
    id: "C",
    title: "Appraisal information",
    items: [
      { id: "C1", title: "Account officer assessment", description: "Account officer's credit assessment and call memo." },
      { id: "C2", title: "Basis of approval", description: "Rationale for approval and any conditions or overrides." },
      { id: "C3", title: "Qualitative & quantitative analysis", description: "Financial analysis and 360 RAR scoring (refreshed within 6 months)." },
      { id: "C4", title: "Industry / business risk", description: "Industry and business-risk assessment for the obligor's sector." },
      { id: "C5", title: "Single-customer concentration", description: "Single-obligor limit check against the legal lending limit." },
    ],
  },
  {
    id: "D",
    title: "Periodic review information",
    items: [
      { id: "D1", title: "Credit grading", description: "Latest internal risk rating with rating date." },
      { id: "D2", title: "Provisioning", description: "IFRS 9 stage and ECL / prudential provision." },
      { id: "D3", title: "Interest suspension", description: "Interest-in-suspense status for non-performing facilities." },
      { id: "D4", title: "Latest facility utilisation", description: "Current utilisation versus approved limits." },
      { id: "D5", title: "Conduct of account", description: "Turnover, lodgements and excesses over the review period." },
      { id: "D6", title: "Call reports / site visits", description: "Most recent call report or site-visit memo (within 6 months)." },
    ],
  },
];

export type FileItem = { id: string; section: string; title: string; description: string; status: ChecklistStatus; note?: string; byName?: string; at?: string };
export type CreditFileRow = { obligor: Obligor; facilities: FacilityRow[]; exposure: number; items: FileItem[]; complete: number; applicable: number; missing: number; defective: number; completeness: number };

export function useCreditFiles(rows: FacilityRow[]): CreditFileRow[] {
  const obligors = useObligors();
  const documents = useDocuments();
  const collateral = useCollateral();
  const stored = useCreditAdminStore((s) => s.files);
  const rarStaleDays = useRule<number>("credit-admin.rarStalenessDays");
  const callStaleDays = useRule<number>("credit-admin.callReportStalenessDays");
  return useMemo(() => {
    return obligors
      .map((o) => {
        const facs = rows.filter((r) => r.facility.obligorId === o.id && r.facility.status !== "Closed");
        const appIds = new Set(facs.map((f) => f.app?.id).filter(Boolean));
        const docs = documents.filter((d) => d.ownerId === o.id || appIds.has(d.ownerId));
        const cols = collateral.filter((c) => c.obligorId === o.id);
        const corporate = o.type !== "Retail";
        const derive = (id: string): { status: ChecklistStatus; note?: string } => {
          const r = rand(o.id, id);
          switch (id) {
            case "A1":
              return docs.some((d) => d.kind === "KYC") || r > 0.04 ? { status: "met" } : { status: "pending", note: "KYC refresh outstanding" };
            case "A4":
              return docs.some((d) => d.kind === "Board resolution") || r > 0.06 ? { status: "met" } : { status: "pending" };
            case "B2": {
              const unaccepted = facs.some((f) => f.letter && f.letter.status !== "Accepted");
              return unaccepted ? { status: "pending", note: "Offer letter not yet accepted" } : { status: "met" };
            }
            case "B3": {
              if (cols.some((c) => c.perfection === "Defective")) return { status: "breached", note: "Defective perfection on a pledged asset" };
              if (cols.some((c) => c.perfection === "Search in progress" || c.perfection === "Not started")) return { status: "pending", note: "Perfection in progress" };
              return { status: "met" };
            }
            case "C3":
              return daysBetween(o.rarUpdatedAt) <= rarStaleDays ? { status: "met" } : { status: "breached", note: `360 RAR older than ${rarStaleDays} days` };
            case "D3":
              return { status: "met", note: facs.some((f) => f.facility.dpd >= 90) ? "Interest suspended on non-performing facility" : undefined };
            case "D6":
              // Demo state: call-report dates aren't on the spine yet (TD-856); the staleness window is a business rule.
              return r < 0.1 ? { status: "breached", note: `Last call report older than ${callStaleDays} days` } : r < 0.14 ? { status: "pending" } : { status: "met" };
            default:
              return r < 0.012 ? { status: "pending" } : { status: "met" };
          }
        };
        const items: FileItem[] = annexure1.flatMap((s) =>
          s.items
            .filter((i) => corporate || !i.corporateOnly)
            .map((i) => {
              const ov = stored[o.id]?.[i.id];
              const d = derive(i.id);
              return { id: i.id, section: s.id, title: i.title, description: i.description, status: ov?.status ?? d.status, note: ov ? undefined : d.note, byName: ov?.byName, at: ov?.at };
            }),
        );
        const complete = items.filter((i) => i.status === "met" || i.status === "waived").length;
        return {
          obligor: o,
          facilities: facs,
          exposure: facs.reduce((s, f) => s + f.facility.approvedAmount, 0),
          items,
          complete,
          applicable: items.length,
          missing: items.filter((i) => i.status === "pending").length,
          defective: items.filter((i) => i.status === "breached").length,
          completeness: items.length ? complete / items.length : 1,
        };
      })
      .filter((r) => r.facilities.length > 0);
  }, [obligors, documents, collateral, rows, stored, rarStaleDays, callStaleDays]);
}
