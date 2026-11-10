/**
 * Loan-origination domain logic (PRD §6.1): flows, routing, COP banding, the portfolio-limit gate,
 * the recommendation engine and covenant tagging. Pure functions over the shared data spine.
 */
import type { Tone } from "@credigit/web-ui";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Application, ApplicationStage, ApprovalStep, Collateral, Facility, Obligor, ProductType, Sector, User } from "@/lib/data/types";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { rarPosition, type RarPosition } from "@/lib/rar";
import { getRule } from "@/lib/platform/rules";
import { actingRoles, useOperationsStore } from "@/lib/platform/operations";
import { buildApprovalChain, chainStatus, currentSteps, tierByPair } from "@/lib/workflow";
import { offBalanceProducts } from "./params";

// ---------------------------------------------------------------- Stages

export const pipelineStages: { id: ApplicationStage; title: string; tone: Tone; description: string }[] = [
  { id: "Draft", title: "Draft", tone: "neutral", description: "Being prepared by the Account Officer" },
  { id: "Documents", title: "Documents", tone: "info", description: "Documents uploaded, OCR extraction and verification" },
  { id: "Analysis", title: "Analysis", tone: "info", description: "Financial-statement validation, COP Ratio, bureau / CRMS, 360 RAR" },
  { id: "Recommendation", title: "Recommendation", tone: "accent", description: "Recommendation engine and BDM concurrence" },
  { id: "Approval", title: "Approval", tone: "warning", description: "Co-signer chart-flow up to the required tier" },
  { id: "Offer", title: "Offer", tone: "brand", description: "Offer letter generation and acceptance (§7)" },
  { id: "Conditions", title: "Conditions", tone: "brand", description: "Legal and Credit Administration conditions precedent" },
  { id: "Disbursement", title: "Disbursement", tone: "success", description: "Maker / Checker disbursement" },
  { id: "Booked", title: "Booked", tone: "success", description: "Facility booked on the CBA" },
  { id: "Declined", title: "Declined", tone: "danger", description: "Declined at a tier" },
  { id: "Withdrawn", title: "Withdrawn", tone: "neutral", description: "Withdrawn by the customer or AO" },
];

export const stageTones: Record<string, Tone> = Object.fromEntries(pipelineStages.map((s) => [s.id, s.tone]));

/** Stages still inside origination (SLA clock running). */
export const openStages: ApplicationStage[] = ["Draft", "Documents", "Analysis", "Recommendation", "Approval"];
export const isOpen = (a: Application) => openStages.includes(a.stage);

export type SlaState = "Breached" | "Due soon" | "On track" | "Closed";
export function slaState(a: Application, now = DEMO_NOW): SlaState {
  if (!isOpen(a)) return "Closed";
  const due = new Date(a.slaDueAt).getTime();
  const t = now.getTime();
  if (due < t) return "Breached";
  if (due - t < getRule<number>("origination.sla.dueSoonDays") * 86_400_000) return "Due soon";
  return "On track";
}
export const slaTones: Record<SlaState, Tone> = { Breached: "danger", "Due soon": "warning", "On track": "success", Closed: "neutral" };

/** PRD §6.1.5 wording for the stored recommendation values. */
export const recommendationLabel: Record<NonNullable<Application["recommendation"]>, string> = {
  Approve: "Proceed",
  "Approve with conditions": "Proceed with conditions",
  Decline: "Decline",
  Refer: "Refer",
};
export const recommendationTones: Record<string, Tone> = { Approve: "success", "Approve with conditions": "info", Decline: "danger", Refer: "warning" };
/** Tones keyed by the PRD label (for StatusBadge / DescriptionList status values). */
export const recommendationLabelTones: Record<string, Tone> = { Proceed: "success", "Proceed with conditions": "info", Decline: "danger", Refer: "warning" };

// ---------------------------------------------------------------- Chart-flow routing

/**
 * Approval chain for a request (PRD §6.1.2 / §6.1.3), from the chart-flow business rules (src/lib/workflow.ts).
 * Standard: BDM recommends, then co-signer pairs until within limit. Fast-Track: within the Fast-Track ceiling the
 * Fast-Track pair co-signs; beyond it the Standard ladder applies (open question O1).
 */
export function buildChainFor(flow: Application["flow"], amount: number, users: User[]): ApprovalStep[] {
  return buildApprovalChain(amount, users, flow);
}

export { chainStatus, currentSteps };

/** Highest approval authority the chain reaches (for display). */
export function finalAuthority(chain: ApprovalStep[]): string {
  const last = chain.filter((s) => !s.adjudicates).at(-1);
  if (!last) return "—";
  const pair = chain.filter((s) => s.pair && s.pair === last.pair && !s.adjudicates);
  return pair.length > 1 ? pair.map((s) => roleById[s.roleId].short).join(" + ") : roleById[last.roleId].name;
}

/** Limit of the tier a chain step belongs to (null = no limit configured). */
export function stepTierLimit(s: Pick<ApprovalStep, "pair" | "roleId">): number | null {
  const tier = tierByPair(s.pair);
  if (tier) return tier.limit;
  return null;
}

// ---------------------------------------------------------------- COP Ratio (PRD §6.1.4)

export type CopBand = "High" | "Medium" | "Low";
export function copBand(ratio: number | undefined): { band: CopBand; label: string; tone: Tone; requiresExplanation: boolean; weight: string } | undefined {
  if (ratio === undefined || Number.isNaN(ratio)) return undefined;
  if (ratio >= getRule<number>("origination.cop.highBand")) return { band: "High", label: "High confidence", tone: "success", requiresExplanation: false, weight: "Declared financials carried at full weight" };
  if (ratio >= getRule<number>("origination.cop.mediumBand")) return { band: "Medium", label: "Medium confidence", tone: "warning", requiresExplanation: false, weight: "Declared financials dampened in the Internal Risk score" };
  return { band: "Low", label: "Low confidence — requires explanation", tone: "danger", requiresExplanation: true, weight: "Declared financials heavily dampened; analyst must document a customer explanation" };
}

// ---------------------------------------------------------------- Portfolio-limit gate (PRD §5.6, §6.1.5)

export type LimitGateResult = {
  result: Application["limitGate"];
  obligorExposure: number;
  weightedRequest: number;
  obligorTotal: number;
  solLimit: number;
  solUtilisation: number;
  largeExposure: boolean;
  sector?: Sector;
  sectorExposure: number;
  sectorLimit: number;
  sectorUtilisation: number;
  bookSize: number;
};

const weightFor = (product: ProductType) => (offBalanceProducts().includes(product) ? getRule<number>("origination.offBalanceWeightPct") / 100 : 1);
const live = (f: Facility) => f.status === "Active" || f.status === "Pending disbursement" || f.status === "Restructured";

export function limitGate(
  req: { id?: string; product: ProductType; amount: number; obligorId: string },
  obligor: Pick<Obligor, "id" | "sectorId"> | undefined,
  facilities: Facility[],
  obligors: Obligor[],
  sectors: Sector[],
): LimitGateResult {
  const book = facilities.filter((f) => live(f) && (!req.id || f.applicationId !== req.id));
  const bookSize = book.reduce((s, f) => s + f.approvedAmount, 0);
  const obligorExposure = book.filter((f) => f.obligorId === req.obligorId).reduce((s, f) => s + f.approvedAmount * weightFor(f.product), 0);
  const weightedRequest = req.amount * weightFor(req.product);
  const obligorTotal = obligorExposure + weightedRequest;
  const shareholdersFunds = getRule<number>("platform.shareholdersFundsNgn");
  const solLimit = (shareholdersFunds * getRule<number>("origination.singleObligorPct")) / 100;
  const sector = sectors.find((s) => s.id === obligor?.sectorId);
  const sectorObligors = new Set(obligors.filter((o) => o.sectorId === obligor?.sectorId).map((o) => o.id));
  const sectorExposure = book.filter((f) => sectorObligors.has(f.obligorId)).reduce((s, f) => s + f.approvedAmount, 0) + req.amount;
  const sectorLimit = sector ? ((bookSize + req.amount) * sector.limitPct) / 100 : Number.POSITIVE_INFINITY;
  const result: Application["limitGate"] = obligorTotal > solLimit ? "Breach — single obligor" : sectorExposure > sectorLimit ? "Breach — sector" : "Within limit";
  return {
    result,
    obligorExposure,
    weightedRequest,
    obligorTotal,
    solLimit,
    solUtilisation: obligorTotal / solLimit,
    largeExposure: obligorTotal >= (shareholdersFunds * getRule<number>("origination.largeExposurePct")) / 100,
    sector,
    sectorExposure,
    sectorLimit,
    sectorUtilisation: sectorExposure / sectorLimit,
    bookSize,
  };
}

export const isBreach = (g: Application["limitGate"]) => g.startsWith("Breach");

// ---------------------------------------------------------------- Recommendation engine (PRD §6.1.5)

export type EngineInput = {
  obligor: Obligor;
  copRatio?: number;
  copExplained?: boolean;
  limitGate: Application["limitGate"];
  bureauAdverse: boolean;
  coverage: number;
};

export type EngineOutput = {
  recommendation: NonNullable<Application["recommendation"]>;
  rationale: string[];
  position: RarPosition;
};

/**
 * Demo rule set. The PRD specifies the outputs (proceed / proceed with conditions / decline / refer) and the
 * inputs (360 RAR, COP confidence, limits) but not the decision rules — these are tenant parameters.
 */
export function runEngine(i: EngineInput): EngineOutput {
  const position = rarPosition(i.obligor.rar);
  const band = copBand(i.copRatio);
  const rationale: string[] = [];
  rationale.push(`360 RAR posture: ${position.label} (X ${position.x.toFixed(2)}, Y ${position.y.toFixed(2)}).`);
  rationale.push(`Internal risk grade ${i.obligor.riskGrade} of 10${i.obligor.watchlist ? " — obligor is on the watchlist" : ""}.`);
  if (band) rationale.push(`COP Ratio ${i.copRatio!.toFixed(2)} — ${band.label}.`);
  rationale.push(`Collateral lending-value cover ${(i.coverage * 100).toFixed(0)}% of the requested amount.`);
  if (i.bureauAdverse) rationale.push("Bureau / CRMS shows a non-performing facility at another institution.");

  if (isBreach(i.limitGate)) {
    rationale.push(`Portfolio-limit gate: ${i.limitGate}. Progression is blocked and routed to the CRO / Board for an informed exception decision.`);
    return { recommendation: "Refer", rationale, position };
  }
  rationale.push("Portfolio-limit gate: within single-obligor and sectoral limits.");
  const strongDefensive = position.base === "Defensive" && position.intensity !== "Marginally" && !position.neutral;
  if (i.obligor.riskGrade >= getRule<number>("origination.engine.declineGradeAtOrAbove") || strongDefensive || (band?.band === "Low" && !i.copExplained)) {
    return { recommendation: "Decline", rationale, position };
  }
  if (band?.band !== "High" || position.base === "Conservative" || position.base === "Defensive" || i.obligor.watchlist || i.obligor.riskGrade >= getRule<number>("origination.engine.conditionsGradeAtOrAbove") || i.bureauAdverse || i.coverage < getRule<number>("origination.engine.minCoverPct") / 100) {
    return { recommendation: "Approve with conditions", rationale, position };
  }
  return { recommendation: "Approve", rationale, position };
}

// ---------------------------------------------------------------- Covenant tagging (PRD §6.1.5 → §7 libraries)

export type CovenantContext = { product: ProductType; obligor: Obligor; tenorMonths: number; collateral: Pick<Collateral, "type">[]; position: RarPosition; variant?: string };
export type LibraryClause = { id: string; library: "§7.1 Conditions precedent" | "§7.3 General covenants"; category: string; text: string; reason: string };

const contingent: ProductType[] = ["Bank guarantee", "Advance payment guarantee"];
const contractBased: ProductType[] = ["Bank guarantee", "Advance payment guarantee", "Invoice discounting", "Trade finance (LC)"];
const physical = ["Legal mortgage", "Equitable mortgage", "Vehicle", "Equipment", "Debenture"];

/** Auto-tag clauses from the master conditions / covenants library for this request. */
export function tagCovenants(c: CovenantContext): LibraryClause[] {
  const out: LibraryClause[] = [];
  const add = (x: LibraryClause) => out.push(x);
  const corporate = c.obligor.type === "Corporate" || c.obligor.type === "Commercial" || c.obligor.type === "SME";
  const types = new Set(c.collateral.map((x) => x.type));
  add({ id: "cp-request", library: "§7.1 Conditions precedent", category: "Documentation", text: "Submission of a formal request letter for the facility.", reason: "All facilities" });
  add({ id: "cp-acceptance", library: "§7.1 Conditions precedent", category: "Documentation", text: "Signed acceptance of the bank's offer letter.", reason: "All facilities" });
  add({ id: "cp-bureau", library: "§7.1 Conditions precedent", category: "Due diligence", text: "Receipt of a satisfactory CRMS / credit-bureau report on the company and its principal officers.", reason: "All facilities" });
  if (corporate) add({ id: "cp-board", library: "§7.1 Conditions precedent", category: "Corporate authorisation", text: "Board Resolution authorising and accepting the offer letter and the pledge of security.", reason: `Obligor type: ${c.obligor.type}` });
  if (contractBased.includes(c.product)) add({ id: "cp-contract", library: "§7.1 Conditions precedent", category: "Due diligence", text: "Copy of the underlying contract / purchase order / LPO for which the facility is granted.", reason: `Product: ${c.product}` });
  if (contingent.includes(c.product)) add({ id: "cp-guarantee-agreement", library: "§7.1 Conditions precedent", category: "Guarantee / security", text: "Execution of a guarantee-issuance agreement for the contingent facility.", reason: `Contingent product: ${c.product}` });
  if (c.product === "Advance payment guarantee" || c.product === "Overdraft" || (corporate && c.obligor.type === "SME"))
    add({ id: "cp-pg", library: "§7.1 Conditions precedent", category: "Guarantee / security", text: "Full and unconditional personal guarantee of the principal officers, supported by a notarised statement of net worth.", reason: c.obligor.type === "SME" ? "SME obligor" : `Product: ${c.product}` });
  if (types.has("Legal mortgage") || types.has("Equitable mortgage") || c.product === "Mortgage")
    add({ id: "cp-mortgage", library: "§7.1 Conditions precedent", category: "Legal perfection", text: "Execution and registration / perfection of a legal mortgage over the pledged property.", reason: "Mortgage collateral" });
  if (types.has("Debenture")) add({ id: "cp-debenture", library: "§7.1 Conditions precedent", category: "Legal perfection", text: "Execution and registration of a debenture / floating charge over the company's assets.", reason: "Debenture collateral" });
  if (types.has("Quoted shares")) add({ id: "cp-cscs", library: "§7.1 Conditions precedent", category: "Guarantee / security", text: "SEC / CSCS confirmation that pledged shares are registered, lien-marked to the bank and not pledged elsewhere.", reason: "Share-backed collateral" });
  if ([...types].some((t) => physical.includes(t))) add({ id: "cov-insurance", library: "§7.3 General covenants", category: "Insurance", text: "Maintain satisfactory insurance on pledged assets with the bank's interest noted.", reason: "Physical collateral pledged" });
  if (c.obligor.sectorId === "SEC-AGR") add({ id: "cp-agri-insurance", library: "§7.1 Conditions precedent", category: "Specialised loans", text: "Evidence of insurance of agricultural produce, where applicable.", reason: "Sector: Agriculture" });
  add({ id: "cov-reporting", library: "§7.3 General covenants", category: "Financial reporting", text: "Audited accounts within six months of year-end and quarterly management accounts.", reason: "All facilities" });
  if (c.tenorMonths > 12 || c.position.base === "Defensive" || c.position.base === "Conservative")
    add({ id: "cov-negative-pledge", library: "§7.3 General covenants", category: "Negative pledge", text: "No further mortgage, pledge or encumbrance over assets without the bank's prior written consent.", reason: c.tenorMonths > 12 ? `Tenor ${c.tenorMonths} months` : `360 RAR posture: ${c.position.base}` });
  if (corporate && c.tenorMonths > 12) add({ id: "cov-merger", library: "§7.3 General covenants", category: "Merger / disposal", text: "No merger, consolidation or disposal of a substantial part of assets without the bank's consent.", reason: "Corporate obligor, tenor > 12 months" });
  add({ id: "cov-cross-default", library: "§7.3 General covenants", category: "Cross-default", text: "A default on this facility is a default on all facilities to the obligor and related parties.", reason: "All facilities" });
  if (c.position.base === "Defensive" || c.obligor.watchlist) add({ id: "cov-setoff", library: "§7.3 General covenants", category: "Right of set-off", text: "Bank may combine or set off any of the obligor's accounts against its liabilities.", reason: c.obligor.watchlist ? "Watchlist obligor" : "Defensive 360 RAR posture" });
  return out;
}

// ---------------------------------------------------------------- Collateral cover

export const lendingValue = (c: Pick<Collateral, "marketValue" | "haircutPct">) => c.marketValue * (1 - c.haircutPct / 100);
export const collateralDueDiligenceDone = (list: Pick<Collateral, "perfection">[]) => list.every((c) => c.perfection !== "Not started" && c.perfection !== "Search in progress");

// ---------------------------------------------------------------- Queues

/** Whether the application needs action from this role / user now. */
export function inMyQueue(a: Application, roleId: RoleId | undefined, userId: string | undefined): boolean {
  if (!roleId) return false;
  switch (a.stage) {
    case "Draft":
    case "Documents":
      return roleId === "account-officer" ? a.createdById === userId : roleId === "credit-analyst" && a.stage === "Documents";
    case "Analysis":
      return roleId === "credit-analyst";
    case "Recommendation":
    case "Approval":
      return openOperations(a.id).some((op) => op.requestedBy.id !== userId && actingRoles(op).includes(roleId));
    case "Offer":
      return roleId === "account-officer" && a.createdById === userId;
    default:
      return false;
  }
}

/** Open Operations instances (credit approval, limit exception, override) for an application. */
export function openOperations(appId: string) {
  return useOperationsStore.getState().instances.filter((i) => i.subject.id === appId && (i.operationType.startsWith("credit.facility-approval") || i.operationType.startsWith("origination.")) && (i.status === "Pending" || i.status === "In progress"));
}

/** Stage the application moves to once the Credit Analyst completes analysis. */
export function stageAfterAnalysis(chain: ApprovalStep[]): ApplicationStage {
  const first = currentSteps(chain)[0];
  return first && first.roleId === "bdm" && !first.pair ? "Recommendation" : "Approval";
}
