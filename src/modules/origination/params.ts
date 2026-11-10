import { SHAREHOLDERS_FUNDS } from "@/lib/params";
/**
 * Loan-origination parameters for the demo tenant.
 *
 * Every value here is tenant configuration held in the Rules & Parameters Engine (Admin → Rules & parameters).
 * Where the PRD states a value (CBN single-obligor 20%, off-balance-sheet 33⅓% weighting, the example COP bands)
 * it is used as written; everything else is an illustrative demo default and is labelled as such in the UI.
 */
import type { CollateralType, ProductType } from "@/lib/data/types";

/** Shown next to any value that is a demo default rather than a PRD rule. */
export const TENANT_PARAM_NOTE = "Parameter — set by tenant (demo default)";

/** Where these values are maintained. */
export const PARAMS_HREF = "/admin/parameters/";

export const originationParams = {
  /** Step-up authentication above this amount (PRD §4.2). Fallback only — the live value comes from Admin → Rules & parameters (useStepUpThreshold). */
  highValueThreshold: 100_000_000,
  /** SLA targets in calendar days from initiation to final approval. Demo defaults. */
  slaDays: { Standard: 10, "Fast-Track": 3 } as const,
  /** COP Ratio banding (PRD §6.1.4 example banding). */
  copBands: { high: 0.85, medium: 0.6 },
  /** Shareholders' funds unimpaired by losses (NGN). Demo default — would come from the tenant's latest audited accounts. */
  shareholdersFunds: SHAREHOLDERS_FUNDS,
  /** Single-obligor limit as % of shareholders' funds (CBN 3.2(a), PRD §5.6). */
  singleObligorPct: 20,
  /** Weighting applied to off-balance-sheet engagements (CBN 3.2(b), PRD §5.6). */
  offBalanceWeight: 1 / 3,
  /** Large-exposure definition: ≥ 10% of shareholders' funds (CBN 3.2(d)). */
  largeExposurePct: 10,
} as const;

/** Off-balance-sheet (contingent) products — weighted at 33⅓% for the single-obligor test. */
export const offBalanceProducts: ProductType[] = ["Bank guarantee", "Advance payment guarantee", "Trade finance (LC)"];

/** Fast-Track eligible product variants (PRD §6.1.3) and the catalogue product each maps to. */
export const fastTrackVariants: { id: string; label: string; product: ProductType }[] = [
  { id: "apg", label: "APG issuance", product: "Advance payment guarantee" },
  { id: "bid-bond", label: "Bid bond", product: "Bank guarantee" },
  { id: "custom-bond", label: "Custom bond", product: "Bank guarantee" },
  { id: "tod", label: "Temporary overdraft (TOD)", product: "Overdraft" },
  { id: "cash-backed", label: "Cash-backed facility", product: "Term loan" },
];

export const productOptions: ProductType[] = [
  "Term loan",
  "Overdraft",
  "Revolving credit",
  "Lease finance",
  "Trade finance (LC)",
  "Bank guarantee",
  "Advance payment guarantee",
  "Invoice discounting",
  "Mortgage",
  "Asset finance",
];

/** Collateral haircuts by type (demo defaults, matching the seeded register; tenant-configurable). */
export const collateralHaircuts: Record<CollateralType, number> = {
  "Legal mortgage": 30,
  "Equitable mortgage": 40,
  Debenture: 50,
  "Quoted shares": 40,
  "Cash / lien on deposit": 0,
  Vehicle: 40,
  Equipment: 45,
  "Domiciliation of proceeds": 60,
  "Personal guarantee": 100,
  "Corporate guarantee": 70,
  "Insurance policy": 50,
};
