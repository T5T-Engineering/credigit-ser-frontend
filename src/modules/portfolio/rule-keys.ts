/**
 * Business-rule keys used by the Portfolio & MIS module (definitions live in ./platform.ts).
 * Kept separate so selectors and platform registrations share one source without an import cycle.
 */
import type { Obligor, ProductType } from "@/lib/data/types";

/** Scalar portfolio parameters → business-rule key. Shareholders' funds is the core platform rule. */
export const PARAM_RULES = {
  shareholdersFunds: "platform.shareholdersFundsNgn",
  totalQualifyingCapital: "portfolio.totalQualifyingCapitalNgn",
  singleObligorLimitPct: "portfolio.singleObligorLimitPct",
  offBalanceSolWeight: "portfolio.offBalanceSolWeightPct",
  largeExposurePct: "portfolio.largeExposurePct",
  aggregateLargeExposureMultiple: "portfolio.aggregateLargeExposureMultiple",
  governmentCeilingPct: "portfolio.governmentCeilingPct",
  earlyWarningPct: "portfolio.earlyWarningPct",
  minCarPct: "portfolio.minCarPct",
  warrCeiling: "portfolio.warrCeiling",
  warrEarlyWarning: "portfolio.warrEarlyWarning",
  nplAppetitePct: "portfolio.nplAppetitePct",
  costOfFundsPct: "portfolio.costOfFundsPct",
  feeIncomePct: "portfolio.feeIncomePct",
  opexAllocationPct: "portfolio.opexAllocationPct",
  rarocHurdlePct: "portfolio.rarocHurdlePct",
} as const;

export type PortfolioParamName = keyof typeof PARAM_RULES;

/** Other portfolio rules. */
export const PORTFOLIO_RULES = {
  periodStartDate: "portfolio.periodStartDate",
  openingDateLabel: "portfolio.openingDateLabel",
  obligorReportFloorPct: "portfolio.obligorReportFloorPct",
  blockReleaseOnReconBreak: "portfolio.reports.blockReleaseOnReconBreak",
  reportReleaseNotifyRoles: "portfolio.reports.releaseNotifyRoles",
  limitAlertRoles: "portfolio.limits.alertRoles",
  planApprovedNotifyRoles: "portfolio.plan.approvedNotifyRoles",
  planDeterioratingFactor: "portfolio.plan.deterioratingFactor",
  planImprovingFactor: "portfolio.plan.improvingFactor",
  projectionDeterioratingAbovePct: "portfolio.projection.deterioratingAbovePct",
  projectionImprovingBelowPct: "portfolio.projection.improvingBelowPct",
  eclStage1Pct: "portfolio.eclProxy.stage1Pct",
  eclStage2Pct: "portfolio.eclProxy.stage2Pct",
  eclSubstandardPct: "portfolio.eclProxy.substandardPct",
  eclDoubtfulPct: "portfolio.eclProxy.doubtfulPct",
  eclLostPct: "portfolio.eclProxy.lostPct",
} as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Rule key of the credit-conversion factor for a product. */
export const ccfRuleKey = (p: ProductType) => `portfolio.ccf.${slug(p)}`;
/** Rule key of the risk weight for an obligor type. */
export const riskWeightRuleKey = (t: Obligor["type"]) => `portfolio.riskWeight.${slug(t)}`;

export const PRODUCT_TYPES: ProductType[] = [
  "Bank guarantee",
  "Advance payment guarantee",
  "Trade finance (LC)",
  "Overdraft",
  "Revolving credit",
  "Term loan",
  "Lease finance",
  "Invoice discounting",
  "Mortgage",
  "Asset finance",
];

export const OBLIGOR_TYPES: Obligor["type"][] = ["Corporate", "Commercial", "SME", "Retail", "Public sector"];
