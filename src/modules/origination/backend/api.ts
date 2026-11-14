"use client";

/**
 * Backend CreditOrigination API (`/api/v1/origination`, backend ADR-0011). Every call is checked by the backend: permission keys on the
 * endpoints, rule role groups in the handlers, and approver eligibility / four-eyes in the Operations engine. Backend mode only.
 */
import { useCallback, useEffect, useState } from "react";
import { identityCall, identityDownload } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import type { BackendOperation } from "@/modules/operations/backend-operations";

export type ApplicationStage = "Draft" | "Analysis" | "Approval" | "Approved" | "Declined" | "Withdrawn";
export type ChartFlow = "Standard" | "Fast-Track";
export type ObligorType = "Corporate" | "Commercial" | "SME" | "Retail" | "Public sector";
export type RequestType = "New" | "Renewal" | "Enhancement" | "Restructure" | "Waiver";
export type LimitGateResult = "Within limit" | "Breach — sector" | "Breach — single obligor" | "Breach — aggregate large exposure";
export type Recommendation = "Approve" | "Approve with conditions" | "Decline" | "Refer";
export type ReviewStatus = "Pending" | "Granted" | "Refused";

export const STAGES: ApplicationStage[] = ["Draft", "Analysis", "Approval", "Approved", "Declined", "Withdrawn"];
export const OPEN_STAGES: ApplicationStage[] = ["Draft", "Analysis", "Approval"];
export const OBLIGOR_TYPES: ObligorType[] = ["Corporate", "Commercial", "SME", "Retail", "Public sector"];
export const REQUEST_TYPES: RequestType[] = ["New", "Renewal", "Enhancement", "Restructure", "Waiver"];
export const RECOMMENDATIONS: Recommendation[] = ["Approve", "Approve with conditions", "Decline", "Refer"];

export const isBreach = (r: LimitGateResult | null | undefined) => Boolean(r && r !== "Within limit");

export type Person = { id: string; name: string };

export type Customer = {
  obligorId?: string | null;
  name: string;
  type: ObligorType;
  sectorId?: string | null;
  rcNumber?: string | null;
  branch?: string | null;
  state?: string | null;
  declaredTurnoverNgn?: number | null;
};

export type FacilityRequest = {
  product: string;
  amountNgn: number;
  tenorMonths: number;
  purpose: string;
  requestType: RequestType;
  variant?: string | null;
  /** Exposure-book facility a renewal, enhancement or restructure acts on (backend ORG-FR-21). */
  existingFacilityRef?: string | null;
};

/** The four 360 RAR cardinal-point scores, 1–10 (PRD §6.2). */
export type RarScores = { internal: number; comparative: number; industry: number; macro: number };

/** Recommendation-engine inputs (backend ADR-0022). Bureau and COP values are replaced by their checks when those exist (ADR-0024). */
export type AnalysisInputs = { rar: RarScores; riskGrade: number; watchlist: boolean; copRatio?: number | null; copExplained: boolean; bureauAdverse: boolean; securityCoverPct: number };

export type RarPosition = { x: number; y: number; magnitude: number; base: string; intensity?: string | null; neutral: boolean; lead: string; label: string };
export type EngineResult = { recommendation: Recommendation; rationale: string[]; position: RarPosition; copBand?: string | null };

/** Limit gate with its figures (backend `LimitGateDetailDto`; NGN; utilisation in % of the limit). */
export type LimitGateDetail = {
  result: LimitGateResult;
  breaches: LimitGateResult[];
  nearBreaches: string[];
  obligorLinked: boolean;
  shareholdersFundsNgn: number;
  obligorExposureNgn: number;
  weightedRequestNgn: number;
  obligorTotalNgn: number;
  singleObligorLimitNgn: number;
  singleObligorUtilisationPct: number;
  largeExposure: boolean;
  aggregateLargeExposureNgn: number;
  aggregateLargeExposureLimitNgn: number;
  sectorId?: string | null;
  sectorExposureNgn: number;
  sectorLimitNgn?: number | null;
  sectorUtilisationPct?: number | null;
  bookSizeNgn: number;
  bookAsOf?: string | null;
  evaluatedAt: string;
};

export type Analysis = {
  limitGate: LimitGateResult;
  systemRecommendation: Recommendation;
  copRatio?: number | null;
  notes?: string | null;
  completedBy: Person;
  completedAt: string;
  gate?: LimitGateDetail | null;
  inputs?: AnalysisInputs | null;
  engine?: EngineResult | null;
};

export type BureauSource = { runId: string; connectorId: string; name: string; kind: string; reference: string; score?: number | null; facilities: number; nonPerforming: number; outstandingNgn: number; completedAt: string };
export type BureauCheck = { requestedBy: Person; requestedAt: string; runIds: string[]; completedAt?: string | null; adverse?: boolean | null; sources: BureauSource[] };
export type StatementPull = { requestedBy: Person; requestedAt: string; runIds: string[]; receivedAt?: string | null };
export type CopStatement = { runId: string; bank: string; reference: string; periodFrom: string; periodTo: string; grossCreditsNgn: number; excludedNgn: number; verifiedNgn: number };
export type CopAssessment = {
  declaredTurnoverNgn: number;
  declaredSourceDocumentId?: string | null;
  statements: CopStatement[];
  verifiedTurnoverNgn: number;
  ratio: number;
  band: "High" | "Medium" | "Low";
  requiresExplanation: boolean;
  computedBy: Person;
  computedAt: string;
  explanation?: string | null;
  explainedBy?: Person | null;
  explainedAt?: string | null;
};
export type TaggedCovenant = { clauseId: string; library: string; category: string; title: string; reasons: string[] };
export type RemovedCovenant = { clauseId: string; reason: string; by: Person; at: string };
export type CovenantSet = { tagged: TaggedCovenant[]; added: string[]; removed: RemovedCovenant[]; taggedAt: string; updatedBy?: Person | null; updatedAt?: string | null; effective: string[] };
export type CollateralSearch = { outcome: "Complete" | "Not required"; findings: string; by: Person; at: string };

/** Connector runs (backend Connectors module, ADR-0024). */
export type ConnectorKind = "Credit bureau" | "CRMS" | "CBA statement" | "Other-bank statement";
export type BureauLine = { institution: string; facilityType: string; approvedNgn: number; outstandingNgn: number; nonPerforming: boolean };
export type StatementSummary = { bank: string; accountRef?: string | null; periodFrom: string; periodTo: string; grossCreditsNgn: number; interBranchSuspenseNgn: number; inAndOutNgn: number; reversalsNgn: number };
export type ConnectorRun = {
  id: string;
  connectorId: string;
  connectorName: string;
  kind: ConnectorKind;
  parameters: Record<string, string>;
  status: "Requested" | "Completed" | "Failed";
  requestedBy: { id: string; name: string };
  requestedAt: string;
  reference?: string | null;
  result?: { bureau?: { score?: number | null; lines: BureauLine[] } | null; statement?: StatementSummary | null; evidenceDocumentId?: string | null } | null;
  message?: string | null;
  source?: "Adapter" | "Inbound" | "Manual" | null;
  completedBy?: { id: string; name: string } | null;
  completedAt?: string | null;
};
export type LibraryClause = { id: string; library: string; category: string; title: string; text: string; version: number };
export type ChecklistItem = { typeCode: string; typeLabel: string; present: boolean; verified: boolean; documentId?: string | null };
export type Checklist = { subjectType: string; subjectId: string; items: ChecklistItem[]; complete: boolean };

export type LimitException = {
  operationId: string;
  breach: LimitGateResult;
  justification: string;
  status: ReviewStatus;
  requestedBy: Person;
  requestedAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  comment?: string | null;
};

export type RecommendationOverride = {
  operationId: string;
  from: Recommendation;
  to: Recommendation;
  reason: string;
  status: ReviewStatus;
  requestedBy: Person;
  requestedAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
};

export type RouteStep = { id: string; name: string; tier: number; approverRoles: string[]; coSign: boolean; adjudicatorRole?: string | null; slaHours: number; limitNgn?: number | null };
export type ApprovalRoute = { routeKey: string; flow: ChartFlow; operationType: string; legacyOperationType: string; steps: RouteStep[] };
export type Approval = { operationId: string; route: ApprovalRoute; submittedBy: Person; submittedAt: string };
export type ApprovalAttempt = { operationId: string; routeKey: string; outcome: string; at: string; by?: string | null; comment?: string | null };
export type Withdrawal = { by: Person; from: ApplicationStage; reason: string; at: string };

export type CreditApplication = {
  id: string;
  tenantId: string;
  stage: ApplicationStage;
  flow: ChartFlow;
  customer: Customer;
  facility: FacilityRequest;
  createdBy: Person;
  createdAt: string;
  updatedAt: string;
  slaDueAt: string;
  submittedAt?: string | null;
  analysis?: Analysis | null;
  recommendation?: Recommendation | null;
  limitException?: LimitException | null;
  override?: RecommendationOverride | null;
  approval?: Approval | null;
  approvalHistory: ApprovalAttempt[];
  decidedAt?: string | null;
  version: number;
  withdrawal?: Withdrawal | null;
  collateralSearch?: CollateralSearch | null;
  documentsCompletedAt?: string | null;
  bureauCheck?: BureauCheck | null;
  statements?: StatementPull | null;
  cop?: CopAssessment | null;
  covenants?: CovenantSet | null;
};

export type ApplicationDetail = { application: CreditApplication; operations: BackendOperation[] };

/** Queue actions (backend `QueueActions`). */
export type QueueAction = "submit-draft" | "record-analysis" | "request-limit-exception" | "submit-for-approval" | "decide" | "record-collateral-search";
export type QueueItem = { application: CreditApplication; action: QueueAction; operationId?: string | null; operationType?: string | null; step?: string | null };

export type ApplicationAck = { applicationId: string; stage: ApplicationStage; version: number; operationId?: string | null; applied: boolean };
export type Comment = { id: string; applicationId: string; author: Person; body: string; mentioned: string[]; at: string };
export type CommentAck = { commentId: string; applicationId: string };

export type ApplicationFilter = { stage?: ApplicationStage | ""; flow?: ChartFlow | ""; product?: string; createdBy?: string; search?: string; requestType?: RequestType | "" };

export const queueActionLabel: Record<QueueAction, string> = {
  "submit-draft": "Complete and submit the draft",
  "record-analysis": "Record the analysis outcome",
  "request-limit-exception": "Request a limit exception",
  "submit-for-approval": "Submit for approval",
  decide: "Decide the approval step",
  "record-collateral-search": "Record the collateral search",
};

const enc = encodeURIComponent;

const query = (f: Record<string, string | number | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

const post = <T>(path: string, body?: unknown) => identityCall<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const originationApi = {
  list: (f: ApplicationFilter = {}) => identityCall<CreditApplication[]>(`/origination/applications${query(f)}`),
  mine: () => identityCall<CreditApplication[]>("/origination/applications/mine"),
  queue: () => identityCall<QueueItem[]>("/origination/queue"),
  get: (id: string) => identityCall<ApplicationDetail>(`/origination/applications/${enc(id)}`),
  routePreview: (amountNgn: number, flow: ChartFlow) => identityCall<ApprovalRoute>(`/origination/chart-flow/route${query({ amountNgn, flow })}`),
  exportPipeline: (f: ApplicationFilter = {}) => identityDownload(`/origination/applications/export${query(f)}`, "origination-pipeline.csv"),
  create: (customer: Customer, facility: FacilityRequest) => post<ApplicationAck>("/origination/applications", { customer, facility }),
  update: (id: string, customer: Customer, facility: FacilityRequest, expectedVersion: number) =>
    identityCall<ApplicationAck>(`/origination/applications/${enc(id)}`, { method: "PUT", body: JSON.stringify({ customer, facility, expectedVersion }) }),
  submit: (id: string) => post<ApplicationAck>(`/origination/applications/${enc(id)}/submit`),
  recordAnalysis: (id: string, body: { inputs: AnalysisInputs; notes?: string | null }) => post<ApplicationAck>(`/origination/applications/${enc(id)}/analysis`, body),
  limitGate: (id: string) => identityCall<LimitGateDetail>(`/origination/applications/${enc(id)}/limit-gate`),
  checklist: (id: string) => identityCall<Checklist>(`/origination/applications/${enc(id)}/documents/checklist`),
  recordCollateralSearch: (id: string, outcome: CollateralSearch["outcome"], findings: string) => post<ApplicationAck>(`/origination/applications/${enc(id)}/collateral-search`, { outcome, findings }),
  connectorRuns: (id: string) => identityCall<ConnectorRun[]>(`/origination/applications/${enc(id)}/connector-runs`),
  runBureauChecks: (id: string) => post<ApplicationAck>(`/origination/applications/${enc(id)}/bureau-checks`),
  recordBureauResult: (id: string, runId: string, body: { reference: string; score: number | null; lines: BureauLine[]; evidenceDocumentId?: string | null }) =>
    post<ApplicationAck>(`/origination/applications/${enc(id)}/bureau-checks/${enc(runId)}/result`, body),
  requestStatements: (id: string, otherBanks: string[]) => post<ApplicationAck>(`/origination/applications/${enc(id)}/statements`, { otherBanks }),
  recordStatement: (id: string, runId: string, body: { reference: string; statement: StatementSummary; evidenceDocumentId?: string | null }) =>
    post<ApplicationAck>(`/origination/applications/${enc(id)}/statements/${enc(runId)}/result`, body),
  computeCop: (id: string, declaredTurnoverNgn: number | null, declaredSourceDocumentId: string | null) =>
    post<ApplicationAck>(`/origination/applications/${enc(id)}/cop`, { declaredTurnoverNgn, declaredSourceDocumentId }),
  explainCop: (id: string, explanation: string) => identityCall<ApplicationAck>(`/origination/applications/${enc(id)}/cop/explanation`, { method: "PUT", body: JSON.stringify({ explanation }) }),
  covenantLibrary: () => identityCall<LibraryClause[]>("/origination/covenants/library"),
  updateCovenants: (id: string, add: string[], remove: { clauseId: string; reason: string }[]) =>
    identityCall<ApplicationAck>(`/origination/applications/${enc(id)}/covenants`, { method: "PUT", body: JSON.stringify({ add, remove }) }),
  requestLimitException: (id: string, justification: string) => post<ApplicationAck>(`/origination/applications/${enc(id)}/limit-exception`, { justification }),
  requestOverride: (id: string, to: Recommendation, reason: string) => post<ApplicationAck>(`/origination/applications/${enc(id)}/recommendation-override`, { to, reason }),
  submitForApproval: (id: string) => post<ApplicationAck>(`/origination/applications/${enc(id)}/approval`),
  withdraw: (id: string, reason: string) => post<ApplicationAck>(`/origination/applications/${enc(id)}/withdrawal`, { reason }),
  comments: (id: string) => identityCall<Comment[]>(`/origination/applications/${enc(id)}/comments`),
  addComment: (id: string, body: string, mentioned: string[] = []) => post<CommentAck>(`/origination/applications/${enc(id)}/comments`, { body, mentioned }),
};

/** Record page link (backend `CreditOrigination:Links:ApplicationPath`). */
export const applicationHref = (id: string) => `/origination/application/?id=${enc(id)}`;

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Loads a backend value, re-read on `reload()`; nothing is loaded without a backend. */
export function useBackend<T>(load: (() => Promise<T>) | null, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [version, setVersion] = useState(0);
  const enabled = Boolean(backendSsoEnabled && load);
  const key = `${JSON.stringify(deps)}|${enabled}|${version}`;
  // `key` = what the data on screen was read for; loading while it differs from the current request. Data stays visible on reload.
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: "", data: null, error: null });
  useEffect(() => {
    if (!enabled || !load) return;
    let live = true;
    load()
      .then((data) => live && setState({ key, data, error: null }))
      .catch((e: unknown) => live && setState({ key, data: null, error: errorText(e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the callers' deps and reloads
  }, [key]);
  return { data: state.data, error: state.error, loading: enabled && state.key !== key, reload: useCallback(() => setVersion((v) => v + 1), []) };
}
