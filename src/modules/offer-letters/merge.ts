/**
 * Merge behaviour (PRD §7.0): obligor/facility data, collateral detail and the selected clauses are merged
 * into the tenant's currently-approved house template at generation time.
 */
import type { Application, Collateral, Facility, Obligor, Tenant, User } from "@/lib/data/types";
import { date, money } from "@/lib/format";
import { getRule } from "@/lib/platform/rules";
import { rand } from "../credit-admin/common";
import type { Clause, ClauseLibrary } from "./library";
import type { OfferLetter } from "./store";

export type MergeContext = Record<string, string>;

/** Repayment wording per product (TD-852: product catalogue copy — move to the tenant product configuration). */
const repaymentByProduct: Record<string, string> = {
  "Term loan": "Equal monthly instalments of principal and interest after any agreed moratorium",
  Overdraft: "Interest monthly; principal from the cash flows of the business on demand / at expiry",
  "Revolving credit": "Each drawing repaid from the underlying receivables within the cycle",
  "Lease finance": "Monthly lease rentals over the tenor",
  "Trade finance (LC)": "On maturity of the LC from the proceeds of sale of the goods",
  "Bank guarantee": "Contingent — payable only if the guarantee is called",
  "Advance payment guarantee": "Contingent — reduces pro-rata with certified works",
  "Invoice discounting": "From the proceeds of the discounted invoices",
  Mortgage: "Monthly instalments of principal and interest",
  "Asset finance": "Monthly instalments of principal and interest",
};

/** Approved pricing: the facility's rate when booked, else the application's approved pricing (demo value — TD-851: the approved rate isn't on the Application spine yet). */
export function approvedRate(app: Application, facility?: Facility): number {
  return facility?.ratePct ?? Math.round((21.5 + rand(app.id, "rate") * 6) * 2) / 2;
}

export function buildMergeContext(args: {
  app: Application;
  obligor?: Obligor;
  facility?: Facility;
  collateral: Collateral[];
  tenant: Tenant;
  users: User[];
  letter?: Pick<OfferLetter, "ref" | "validityDays" | "issuedAt" | "createdAt">;
}): MergeContext {
  const { app, obligor, facility, collateral, tenant, users, letter } = args;
  const cols = collateral.filter((c) => app.collateralIds.includes(c.id));
  const currency = facility?.currency ?? "NGN";
  return {
    "tenant.name": tenant.name.replace(/ \$/, ""),
    "tenant.shortName": tenant.shortName,
    "letter.ref": letter?.ref ?? "—",
    "letter.date": date(letter?.issuedAt ?? letter?.createdAt ?? app.updatedAt),
    "obligor.name": obligor?.name ?? app.obligorId,
    "obligor.rcNumber": obligor?.rcNumber ?? obligor?.bvnMasked ?? "—",
    "obligor.address": obligor ? `${obligor.state === "FCT" ? "Federal Capital Territory" : `${obligor.state} State`}, Nigeria` : "—",
    "facility.type": app.product,
    "facility.amount": money(app.amount, currency),
    "facility.currency": currency === "NGN" ? "Naira (NGN)" : "US Dollars (USD)",
    "facility.tenor": `${app.tenorMonths} months`,
    "facility.purpose": app.purpose,
    "facility.rate": `${approvedRate(app, facility).toFixed(1)}% per annum (subject to review in line with money-market conditions)`,
    "facility.repayment": repaymentByProduct[app.product] ?? "As agreed",
    "request.type": app.requestType.toLowerCase(),
    "collateral.summary": cols.length ? cols.map((c) => `${c.type} — ${c.description} (OMV ${money(c.marketValue)})`).join("; ") : "as approved",
    "validity.days": String(letter?.validityDays ?? getRule<number>("offer-letters.validityDaysDefault")),
    "notice.days": String(getRule<number>("offer-letters.noticeDays")),
    "default.rate": "[default charge — set by tenant]",
    "turnover.commitment": "[turnover commitment — set at approval]",
    "ao.name": users.find((u) => u.id === (obligor?.relationshipManagerId ?? app.createdById))?.name ?? "your Relationship Manager",
  };
}

export type MergedPart = { text: string; field?: string; unresolved?: boolean };

/** Splits text into literal and merged parts so the composer can highlight merge fields. */
export function mergeParts(text: string, ctx: MergeContext): MergedPart[] {
  const parts: MergedPart[] = [];
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const value = ctx[m[1]!];
    parts.push(value === undefined ? { text: `{{${m[1]}}}`, field: m[1], unresolved: true } : { text: value, field: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function mergeText(text: string, ctx: MergeContext): string {
  return mergeParts(text, ctx)
    .map((p) => p.text)
    .join("");
}

export function fieldsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))];
}

/** Clauses that go into a letter section, in library order, with letter-level edits applied. */
export function clausesForSection(letter: OfferLetter, clauses: Clause[], library: ClauseLibrary) {
  const lib = clauses
    .filter((c) => c.library === library && letter.clauseIds.includes(c.id))
    .map((c) => ({ id: c.id, title: c.title, text: letter.clauseEdits[c.id] ?? c.text, edited: c.id in letter.clauseEdits, source: undefined as string | undefined, version: c.version }));
  const custom = letter.customClauses
    .filter((c) => c.library === library)
    .map((c) => ({ id: c.id, title: c.title, text: c.text, edited: false, source: c.source as string | undefined, version: 1 }));
  return [...lib, ...custom];
}

/** Facility terms table (values may contain merge fields). */
export function facilityTerms(): Array<{ label: string; value: string }> {
  return [
    { label: "Lender", value: "{{tenant.name}}" },
    { label: "Borrower", value: "{{obligor.name}} ({{obligor.rcNumber}})" },
    { label: "Facility type", value: "{{facility.type}}" },
    { label: "Amount", value: "{{facility.amount}}" },
    { label: "Currency", value: "{{facility.currency}}" },
    { label: "Purpose", value: "{{facility.purpose}}" },
    { label: "Tenor", value: "{{facility.tenor}}" },
    { label: "Interest rate", value: "{{facility.rate}}" },
    { label: "Repayment", value: "{{facility.repayment}}" },
    { label: "Default charge", value: "{{default.rate}}" },
  ];
}

export function securityLines(app: Application, collateral: Collateral[]): string[] {
  return collateral
    .filter((c) => app.collateralIds.includes(c.id))
    .map((c) => `${c.type}${c.description && c.description !== c.type ? `: ${c.description}` : ""}${c.marketValue ? ` — open market value ${money(c.marketValue)}, forced-sale value ${money(c.forcedSaleValue)}` : ""}.`);
}
