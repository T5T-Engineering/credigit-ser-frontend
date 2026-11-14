/**
 * Offer-letter clause library — PRD §7.1 (pre-conditions / conditions precedent to drawdown),
 * §7.2 (post-conditions), §7.3 (general conditions & covenants) and the special covenants the
 * Recommendation Engine tags at origination (§6.1.5).
 *
 * Each clause is a parameterised template ({{merge.fields}}), tagged by applicable loan type, and
 * versioned — Legal approves the text (§4.1 Legal Officer). Clause wording paraphrases the PRD library.
 */
import type { CollateralType, ObligorType, ProductType } from "@/lib/data/types";

export type ClauseLibrary = "pre" | "post" | "general" | "special";

export const libraryMeta: Record<ClauseLibrary, { label: string; short: string; prd: string; description: string }> = {
  pre: { label: "Conditions precedent to drawdown", short: "Pre-conditions", prd: "§7.1", description: "Must be satisfied before the facility can be drawn. Each becomes a Credit Administration checklist item." },
  post: { label: "Post-conditions", short: "Post-conditions", prd: "§7.2", description: "Continuing conditions that apply after drawdown." },
  general: { label: "General conditions & covenants", short: "General & covenants", prd: "§7.3", description: "Standard covenants, events of default and boilerplate clauses." },
  special: { label: "Special covenants (auto-tagged)", short: "Special covenants", prd: "§6.1.5", description: "Facility-specific covenants tagged by the Recommendation Engine at origination." },
};

export type ClauseStatus = "Legal-approved" | "Pending Legal approval" | "Retired";

/** Rule used by the Recommendation Engine to auto-tag a clause onto a letter (PRD §6.1.5, "tagged by applicable loan type"). */
export type TagRule = {
  all?: boolean;
  obligorTypes?: ObligorType[];
  products?: ProductType[];
  collateralTypes?: CollateralType[];
  secured?: boolean;
  foreignCurrency?: boolean;
  sectorIds?: string[];
  /** Matches application covenant tags (origination covenant strings). */
  covenantTag?: string;
};

export type ClauseVersion = { version: number; text: string; at: string; byName: string; note: string };

export type Clause = {
  id: string;
  library: ClauseLibrary;
  category: string;
  title: string;
  /** Parameterised text with {{merge.fields}}. */
  text: string;
  /** Applicable loan types as written in the PRD library. */
  loanTypes: string;
  rule: TagRule;
  version: number;
  status: ClauseStatus;
  /** Proposed wording awaiting Legal approval; `text` (the approved version) stays in use until then. */
  proposedText?: string;
  approvedByName?: string;
  approvedAt?: string;
  history: ClauseVersion[];
};

const LEGAL = "Head of Legal";
const approved = (version: number, at: string) => ({ version, status: "Legal-approved" as const, approvedByName: LEGAL, approvedAt: at });

function c(
  id: string,
  library: ClauseLibrary,
  category: string,
  title: string,
  text: string,
  loanTypes: string,
  rule: TagRule,
  version = 1,
  approvedAt = "2026-03-18T10:00:00.000Z",
): Clause {
  const history: ClauseVersion[] = Array.from({ length: version }, (_, i) => ({
    version: i + 1,
    text,
    at: i + 1 === version ? approvedAt : new Date(new Date(approvedAt).getTime() - (version - i - 1) * 120 * 86_400_000).toISOString(),
    byName: LEGAL,
    note: i === 0 ? "Initial library build" : "Wording aligned to house style",
  }));
  return { id, library, category, title, text, loanTypes, rule, ...approved(version, approvedAt), history };
}

export const seedClauses: Clause[] = [
  // ---------------- §7.1 Pre-conditions (conditions precedent to drawdown) ----------------
  c("CP-01", "pre", "Documentation", "Formal request letter", "Submission of a formal request letter by {{obligor.name}} for the {{facility.type}} facility ({{request.type}}).", "All", { all: true }),
  c("CP-02", "pre", "Documentation", "Signed acceptance of offer letter", "Signed acceptance of this offer letter by {{obligor.name}} within {{validity.days}} days of the date of this letter.", "All", { all: true }, 2),
  c(
    "CP-03",
    "pre",
    "Corporate authorisation",
    "Board resolution",
    "Submission of a Board Resolution of {{obligor.name}} authorising and accepting this offer and, where relevant, authorising the pledge of the security described herein.",
    "Corporate/SME",
    { obligorTypes: ["Corporate", "Commercial", "SME"] },
  ),
  c("CP-04", "pre", "Due diligence", "Satisfactory CRMS / credit-bureau report", "Receipt by the Bank of a satisfactory CRMS and credit-bureau report on {{obligor.name}} and its principal officers.", "All", { all: true }),
  c(
    "CP-05",
    "pre",
    "Due diligence",
    "Underlying contract / purchase order",
    "Submission of a copy of the underlying contract, purchase order or LPO for which the facility is granted, between {{obligor.name}} and its counterparty.",
    "APG, Bid Bond, Invoice/Contract Finance, Trade Finance",
    { products: ["Advance payment guarantee", "Bank guarantee", "Invoice discounting", "Trade finance (LC)"] },
  ),
  c("CP-06", "pre", "Fees", "Payment of fees", "Payment of all associated facility, legal, valuation and processing fees as set out in this letter.", "All", { all: true }),
  c(
    "CP-07",
    "pre",
    "Guarantee / security",
    "Personal guarantee of principal officers",
    "Submission of a full and unconditional personal guarantee of the principal officer(s)/directors of {{obligor.name}} for {{facility.amount}} plus accrued interest, supported by a notarised statement of net worth.",
    "Corporate/SME, APG, Overdraft",
    { products: ["Advance payment guarantee", "Overdraft"], collateralTypes: ["Personal guarantee"] },
  ),
  c(
    "CP-08",
    "pre",
    "Guarantee / security",
    "Guarantee-issuance agreement",
    "Execution of a guarantee-issuance agreement for the contingent facility.",
    "APG, Bid Bond, Custom Bond, Guarantees",
    { products: ["Advance payment guarantee", "Bank guarantee"] },
  ),
  c(
    "CP-09",
    "pre",
    "Guarantee / security",
    "Tangible acceptable security",
    "Provision of tangible security acceptable to the Bank for the facility, namely: {{collateral.summary}}.",
    "Term Loan, Overdraft, Real Estate/Object Finance",
    { products: ["Term loan", "Overdraft", "Mortgage", "Asset finance", "Lease finance"] },
  ),
  c(
    "CP-10",
    "pre",
    "Guarantee / security",
    "SEC/CSCS lien confirmation (quoted shares)",
    "Confirmation via the SEC/CSCS connector that the pledged shares are registered, lien-marked in favour of {{tenant.shortName}}, and not simultaneously pledged elsewhere.",
    "Facilities secured by quoted equities",
    { collateralTypes: ["Quoted shares"] },
  ),
  c(
    "CP-11",
    "pre",
    "Legal perfection",
    "Legal mortgage — execution and perfection",
    "Execution of all documents required to create a legal mortgage over the property pledged as security, and registration/perfection of same in favour of the Bank.",
    "Mortgage, Real Estate, Commercial Real Estate, Term Loan (secured)",
    { collateralTypes: ["Legal mortgage", "Equitable mortgage"] },
  ),
  c(
    "CP-12",
    "pre",
    "Legal perfection",
    "Debenture / floating charge",
    "Execution and registration of a debenture/floating charge over the assets of {{obligor.name}}, where applicable.",
    "Corporate Term Loan, Overdraft",
    { collateralTypes: ["Debenture"] },
  ),
  c(
    "CP-13",
    "pre",
    "Insurance",
    "Insurance of pledged assets",
    "Evidence that pledged assets are insured to an amount and against risks customary for similar businesses/property, with the Bank's interest noted on the policy.",
    "All secured facilities",
    { secured: true },
  ),
  c("CP-14", "pre", "Specialised loans", "Insurance of agricultural produce", "Evidence of insurance of agricultural produce, where applicable.", "Agriculture Finance", { sectorIds: ["SEC-AGR"] }),
  c(
    "CP-15",
    "pre",
    "Specialised loans",
    "Project Funds & Financial Completion Agreements",
    "Execution of a Project Funds Agreement (standby subordinated funding commitment from sponsors) and a Financial Completion Agreement, where applicable.",
    "Project Finance",
    { sectorIds: ["SEC-PWR"] },
  ),
  c(
    "CP-16",
    "pre",
    "Currency matching",
    "Evidence of foreign-currency revenue",
    "Evidence that {{obligor.name}} generates revenue, or holds receivables, in {{facility.currency}} (e.g. export contracts or foreign-currency off-take agreements). A Naira facility is not converted or re-denominated into foreign currency for an obligor that cannot evidence this.",
    "All foreign-currency-denominated facilities",
    { foreignCurrency: true },
  ),

  // ---------------- §7.2 Post-conditions ----------------
  c("PC-01", "post", "Costs", "Legal and statutory expenses", "All legal, statutory and regulatory expenses arising from execution of any transaction under, or enforcement of, the facility shall be for the account of {{obligor.name}}.", "All", { all: true }),
  c("PC-02", "post", "Review", "Right to review or cancel", "The Bank reserves the right to review or cancel the facility at any time it considers circumstances warrant such action, notwithstanding the stated tenor of {{facility.tenor}}.", "All", { all: true }),
  c(
    "PC-03",
    "post",
    "Contingent liabilities",
    "Crystallised guarantee",
    "Where a guarantee issued under the facility crystallises and the Bank pays any amount thereunder, the sum paid becomes immediately due and payable by {{obligor.name}} as a debt, with interest at the Bank's lending rate plus a default charge of {{default.rate}} per month until final liquidation, unless converted to a tenured facility.",
    "Guarantees, APG, Bonds",
    { products: ["Advance payment guarantee", "Bank guarantee"] },
  ),
  c(
    "PC-04",
    "post",
    "Contingent liabilities",
    "Activation on receipt of advance payment",
    "Liabilities under a performance/advance-payment guarantee instrument are activated when the advance payment is received.",
    "APG, Performance bonds",
    { products: ["Advance payment guarantee"] },
  ),
  c("PC-05", "post", "Policy", "Legal lending limit and portfolio constraints", "The facility remains subject to the Bank's legal lending limit, credit policy and portfolio constraints, and the Bank may cancel, reduce or demand repayment accordingly.", "All", { all: true }),

  // ---------------- §7.3 General conditions & covenants ----------------
  c("GC-01", "general", "Covenant", "Negative pledge", "{{obligor.name}} will not mortgage, pledge, or subject to lien or encumbrance any property or asset now owned or later acquired, without the Bank's prior written consent.", "All", { all: true }),
  c("GC-02", "general", "Covenant", "Insurance covenant", "{{obligor.name}} will maintain satisfactory insurance on its assets, in amounts and against risks customary for similar businesses, with the Bank's interest noted.", "All", { all: true }),
  c(
    "GC-03",
    "general",
    "Covenant",
    "Merger / disposal",
    "{{obligor.name}} will not merge, consolidate, or sell/lease a substantial part of its assets, or enter a lease exceeding twelve months, without the Bank's prior written consent.",
    "All",
    { all: true },
  ),
  c(
    "GC-04",
    "general",
    "Covenant",
    "Financial reporting",
    "{{obligor.name}} will provide its audited Balance Sheet and Profit & Loss Account annually, within six calendar months of financial year-end, and management accounts quarterly.",
    "All",
    { all: true },
    2,
  ),
  c(
    "GC-05",
    "general",
    "Events of default",
    "Events of default",
    "The facility becomes immediately repayable upon, among others: failure to settle any amount when due; breach of any term or covenant uncured after {{notice.days}} days' notice; a winding-up order, resolution or petition; distress or execution levied and undischarged within 5 days; appointment of a receiver; cessation of business; or statutory insolvency under the Companies and Allied Matters Act (or successor legislation).",
    "All",
    { all: true },
  ),
  c("GC-06", "general", "Default", "Cross-default", "A default on this facility constitutes a default on all other facilities granted to {{obligor.name}} and related parties, all of which become immediately due and payable.", "All", { all: true }),
  c(
    "GC-07",
    "general",
    "Rights",
    "Right of set-off",
    "The Bank may, without recourse to the customer, combine, consolidate or set off any of the accounts of {{obligor.name}} against its liabilities to the Bank, whether actual or contingent, primary or collateral, several or joint.",
    "All",
    { all: true },
  ),
  c(
    "GC-08",
    "general",
    "Representations",
    "Representations & warranties",
    "{{obligor.name}} represents that it is not in default under any other borrowed-money obligation, and that all consents, licences and approvals required for the facility have been (or will be) obtained and delivered to the Bank.",
    "All",
    { all: true },
  ),
  c("GC-09", "general", "Costs", "Expenses", "All costs and legal expenses arising from the facility, or from enforcing its terms, are for the account of {{obligor.name}}.", "All", { all: true }),
  c("GC-10", "general", "Rights", "Indulgence & waiver", "The Bank's discretionary indulgence or forbearance on any matter, or delay in exercising a right, does not operate as a waiver of that or any other right.", "All", { all: true }),
  c(
    "GC-11",
    "general",
    "Acceptance",
    "Acceptance validity",
    "This offer remains valid for {{validity.days}} days from the date of communication to {{obligor.name}}, after which it lapses if not accepted under seal.",
    "All",
    { all: true },
  ),

  // ---------------- §6.1.5 Special covenants (tagged at origination) ----------------
  c(
    "SC-01",
    "special",
    "Financial covenant",
    "Debt service cover ratio",
    "{{obligor.name}} shall maintain a debt service cover ratio of not less than 1.25x throughout the tenor, tested on the basis of its quarterly management accounts.",
    "Term Loan, Lease, Asset Finance",
    { covenantTag: "Debt service cover ratio ≥ 1.25x" },
  ),
  c(
    "SC-02",
    "special",
    "Cash-flow covenant",
    "Domiciliation of contract proceeds",
    "{{obligor.name}} shall domicile all proceeds of the underlying contract(s) financed under this facility into its account with {{tenant.shortName}}, and shall execute an irrevocable domiciliation instruction acknowledged by the paying party.",
    "Contract Finance, Invoice Discounting, APG",
    { covenantTag: "Domiciliation of contract proceeds" },
  ),
  c(
    "SC-03",
    "special",
    "Information covenant",
    "Quarterly management accounts",
    "{{obligor.name}} shall submit its quarterly management accounts to the Bank within 45 days of each quarter-end.",
    "All",
    { covenantTag: "Quarterly management accounts within 45 days" },
  ),
  c(
    "SC-04",
    "special",
    "Turnover covenant",
    "Minimum account turnover",
    "{{obligor.name}} shall route a minimum annual turnover of {{turnover.commitment}} through its accounts with the Bank (Parameter — set at approval).",
    "Overdraft, Revolving credit",
    { products: ["Overdraft", "Revolving credit"] },
  ),
];

/** Merge fields available to templates and clauses (PRD §7.3 build note). */
export const mergeFields: Array<{ token: string; label: string; source: string }> = [
  { token: "tenant.name", label: "Bank name", source: "Tenant profile" },
  { token: "tenant.shortName", label: "Bank short name", source: "Tenant profile" },
  { token: "letter.ref", label: "Letter reference", source: "Offer Letter Engine (sequence)" },
  { token: "letter.date", label: "Letter date", source: "Date the letter is generated / re-issued" },
  { token: "obligor.name", label: "Obligor name", source: "Risk Data Spine — Obligor" },
  { token: "obligor.rcNumber", label: "RC number / BVN", source: "Obligor KYC (CAC / BVN)" },
  { token: "obligor.address", label: "Obligor address", source: "Obligor KYC" },
  { token: "facility.type", label: "Facility type", source: "Origination approval record — product" },
  { token: "facility.amount", label: "Facility amount", source: "Origination approval record — approved amount" },
  { token: "facility.currency", label: "Currency", source: "Origination approval record" },
  { token: "facility.tenor", label: "Tenor", source: "Origination approval record" },
  { token: "facility.purpose", label: "Purpose", source: "Credit application" },
  { token: "facility.rate", label: "Interest rate", source: "Approved pricing" },
  { token: "facility.repayment", label: "Repayment", source: "Product catalogue" },
  { token: "request.type", label: "Request type", source: "Credit application (New / Renewal / …)" },
  { token: "collateral.summary", label: "Security", source: "Collateral register" },
  { token: "validity.days", label: "Validity period (days)", source: "Letter setting — 'commonly 7'" },
  { token: "notice.days", label: "Cure notice (days)", source: "Events of default clause (10 days)" },
  { token: "default.rate", label: "Default charge", source: "Parameter — set by tenant" },
  { token: "turnover.commitment", label: "Turnover commitment", source: "Parameter — set at approval" },
  { token: "ao.name", label: "Account officer", source: "Relationship manager on the obligor" },
];
