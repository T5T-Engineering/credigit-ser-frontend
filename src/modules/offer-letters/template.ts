/**
 * Tenant-configurable, versioned offer-letter house template (PRD §7.0).
 * Defines letterhead, section order, static preamble/closing wording, defined terms and the
 * signature/witness block. The clause library (§7.1–7.3) is merged into the `clauses` sections at generation.
 */
import type { ClauseLibrary } from "./library";

export type TemplateSectionKind = "letterhead" | "text" | "facility-terms" | "security" | "clauses" | "signatures" | "acceptance";

export type TemplateSection = {
  id: string;
  title: string;
  kind: TemplateSectionKind;
  /** Static wording with {{merge.fields}} (text, signatures, acceptance sections). */
  body?: string;
  /** Library merged into a `clauses` section. */
  library?: ClauseLibrary;
  enabled: boolean;
  /** Show the section heading in the letter. */
  showTitle: boolean;
};

export type TemplateStatus = "Approved" | "Draft" | "Pending Legal sign-off" | "Retired";

export type HouseTemplate = {
  id: string;
  name: string;
  /** Product line the template applies to (PRD §7.0: per product line where the tenant issues different templates). */
  productLine: "All products" | "Contingent facilities";
  version: number;
  status: TemplateStatus;
  sections: TemplateSection[];
  letterhead: { addressLine: string; contactLine: string; footer: string };
  changeNote: string;
  createdByName: string;
  createdAt: string;
  approvedByName?: string;
  approvedAt?: string;
};

const baseSections: TemplateSection[] = [
  { id: "letterhead", title: "Letterhead & reference", kind: "letterhead", enabled: true, showTitle: false },
  {
    id: "addressee",
    title: "Addressee & salutation",
    kind: "text",
    enabled: true,
    showTitle: false,
    body: "The Managing Director\n{{obligor.name}}\n{{obligor.address}}\n\nDear Sir/Madam,",
  },
  { id: "subject", title: "Subject line", kind: "text", enabled: true, showTitle: false, body: "OFFER OF {{facility.type}} FACILITY OF {{facility.amount}}" },
  {
    id: "preamble",
    title: "Preamble",
    kind: "text",
    enabled: true,
    showTitle: false,
    body: "We are pleased to inform you that the Management of {{tenant.name}} (\"the Bank\") has approved the facility described below in favour of {{obligor.name}} (\"the Borrower\"), subject to the terms and conditions set out in this letter.",
  },
  { id: "terms", title: "Facility terms", kind: "facility-terms", enabled: true, showTitle: true },
  { id: "security", title: "Security", kind: "security", enabled: true, showTitle: true },
  { id: "pre", title: "Conditions precedent to drawdown", kind: "clauses", library: "pre", enabled: true, showTitle: true },
  { id: "special", title: "Special covenants", kind: "clauses", library: "special", enabled: true, showTitle: true },
  { id: "post", title: "Other conditions", kind: "clauses", library: "post", enabled: true, showTitle: true },
  { id: "general", title: "General conditions & covenants", kind: "clauses", library: "general", enabled: true, showTitle: true },
  {
    id: "defined",
    title: "Defined terms",
    kind: "text",
    enabled: true,
    showTitle: true,
    body: "\"Bank\" means {{tenant.name}}, its successors and assigns.\n\"Borrower\" means {{obligor.name}} ({{obligor.rcNumber}}).\n\"Facility\" means the {{facility.type}} facility of {{facility.amount}} described in this letter.\n\"Business Day\" means a day (other than a Saturday, Sunday or public holiday) on which banks are open for business in Lagos.",
  },
  {
    id: "closing",
    title: "Closing",
    kind: "text",
    enabled: true,
    showTitle: false,
    body: "If the terms and conditions of this offer are acceptable to you, kindly sign and return the duplicate copy of this letter, together with the Memorandum of Acceptance below, within {{validity.days}} days of the date of this letter. Your Relationship Manager, {{ao.name}}, will be pleased to assist with any enquiries.\n\nWe thank you for your patronage.",
  },
  { id: "signatures", title: "Signature block", kind: "signatures", enabled: true, showTitle: false, body: "Yours faithfully,\nFor: {{tenant.name}}" },
  {
    id: "acceptance",
    title: "Memorandum of acceptance",
    kind: "acceptance",
    enabled: true,
    showTitle: true,
    body: "We, {{obligor.name}}, hereby accept the terms and conditions of the above offer, reference {{letter.ref}}, and confirm that the common seal of the company has been affixed hereto in the presence of:",
  },
];

const letterhead = {
  addressLine: "Harbourline Towers, 14 Marina Road, Lagos Island, Lagos",
  contactLine: "credit.admin@harbourline.example · +234 1 000 0000",
  footer: "Harbourline Bank Plc · RC 000000 · Licensed by the Central Bank of Nigeria",
};

export const seedTemplates: HouseTemplate[] = [
  {
    id: "TPL-STD-1",
    name: "Standard credit offer letter",
    productLine: "All products",
    version: 1,
    status: "Retired",
    sections: baseSections,
    letterhead,
    changeNote: "Initial house template uploaded at tenant onboarding",
    createdByName: "System Admin",
    createdAt: "2025-09-02T09:00:00.000Z",
    approvedByName: "Head of Legal",
    approvedAt: "2025-09-05T09:00:00.000Z",
  },
  {
    id: "TPL-STD-2",
    name: "Standard credit offer letter",
    productLine: "All products",
    version: 2,
    status: "Retired",
    sections: baseSections,
    letterhead,
    changeNote: "Added defined-terms schedule; witness block moved under Memorandum of Acceptance",
    createdByName: "System Admin",
    createdAt: "2026-02-10T09:00:00.000Z",
    approvedByName: "Head of Legal",
    approvedAt: "2026-02-12T09:00:00.000Z",
  },
  {
    id: "TPL-STD-3",
    name: "Standard credit offer letter",
    productLine: "All products",
    version: 3,
    status: "Approved",
    sections: baseSections,
    letterhead,
    changeNote: "Special covenants section placed before general conditions",
    createdByName: "System Admin",
    createdAt: "2026-06-11T09:00:00.000Z",
    approvedByName: "Head of Legal",
    approvedAt: "2026-06-14T09:00:00.000Z",
  },
  {
    id: "TPL-CON-1",
    name: "Contingent facilities (guarantees & bonds)",
    productLine: "Contingent facilities",
    version: 1,
    status: "Approved",
    sections: baseSections.map((s) =>
      s.id === "subject"
        ? { ...s, body: "OFFER OF {{facility.type}} LINE OF {{facility.amount}} (CONTINGENT LIABILITY)" }
        : s.id === "preamble"
          ? {
              ...s,
              body: "We are pleased to advise that {{tenant.name}} (\"the Bank\") has approved the issuance of the instrument(s) described below on behalf of {{obligor.name}} (\"the Applicant\"), subject to the terms and conditions set out in this letter.",
            }
          : s,
    ),
    letterhead,
    changeNote: "Product-line template for APG, bid bonds and bank guarantees",
    createdByName: "System Admin",
    createdAt: "2026-04-20T09:00:00.000Z",
    approvedByName: "Head of Legal",
    approvedAt: "2026-04-22T09:00:00.000Z",
  },
];

export const productLines: HouseTemplate["productLine"][] = ["All products", "Contingent facilities"];
