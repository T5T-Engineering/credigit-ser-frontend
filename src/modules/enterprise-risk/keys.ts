/** Business-rule keys for the Enterprise Risk module (definitions in ./platform.ts). */
export const ermKeys = {
  rasLimit: (metricId: string) => `enterprise-risk.ras.${metricId}.limit`,
  rasTolerance: (metricId: string) => `enterprise-risk.ras.${metricId}.tolerance`,
  rasVersion: "enterprise-risk.ras.version",
  rasApprovedBy: "enterprise-risk.ras.approvedBy",
  rasApprovedAt: "enterprise-risk.ras.approvedAt",
  rasNextReview: "enterprise-risk.ras.nextReview",
  largeExposurePct: "enterprise-risk.largeExposurePct",
  policyCycleYears: "enterprise-risk.policy.reviewCycleYears",
  policyDueSoonDays: "enterprise-risk.policy.dueSoonDays",
  significantShareholdingPct: "enterprise-risk.insider.significantShareholdingPct",
  amberEscalationRoles: "enterprise-risk.appetite.amberEscalationRoles",
  redEscalationRoles: "enterprise-risk.appetite.redEscalationRoles",
  brcNotifyRoles: "enterprise-risk.brc.packReadyRoles",
} as const;
