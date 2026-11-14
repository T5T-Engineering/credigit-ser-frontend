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
export type LimitGateResult = "Within limit" | "Breach — sector" | "Breach — single obligor";
export type Recommendation = "Approve" | "Approve with conditions" | "Decline" | "Refer";
export type ReviewStatus = "Pending" | "Granted" | "Refused";

export const STAGES: ApplicationStage[] = ["Draft", "Analysis", "Approval", "Approved", "Declined", "Withdrawn"];
export const OPEN_STAGES: ApplicationStage[] = ["Draft", "Analysis", "Approval"];
export const OBLIGOR_TYPES: ObligorType[] = ["Corporate", "Commercial", "SME", "Retail", "Public sector"];
export const REQUEST_TYPES: RequestType[] = ["New", "Renewal", "Enhancement", "Restructure", "Waiver"];
export const LIMIT_GATE_RESULTS: LimitGateResult[] = ["Within limit", "Breach — sector", "Breach — single obligor"];
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

export type FacilityRequest = { product: string; amountNgn: number; tenorMonths: number; purpose: string; requestType: RequestType; variant?: string | null };

export type Analysis = { limitGate: LimitGateResult; systemRecommendation: Recommendation; copRatio?: number | null; notes?: string | null; completedBy: Person; completedAt: string };

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
};

export type ApplicationDetail = { application: CreditApplication; operations: BackendOperation[] };

/** Queue actions (backend `QueueActions`). */
export type QueueAction = "submit-draft" | "record-analysis" | "request-limit-exception" | "submit-for-approval" | "decide";
export type QueueItem = { application: CreditApplication; action: QueueAction; operationId?: string | null; operationType?: string | null; step?: string | null };

export type ApplicationAck = { applicationId: string; stage: ApplicationStage; version: number; operationId?: string | null; applied: boolean };
export type Comment = { id: string; applicationId: string; author: Person; body: string; mentioned: string[]; at: string };
export type CommentAck = { commentId: string; applicationId: string };

export type ApplicationFilter = { stage?: ApplicationStage | ""; flow?: ChartFlow | ""; product?: string; createdBy?: string; search?: string };

export const queueActionLabel: Record<QueueAction, string> = {
  "submit-draft": "Complete and submit the draft",
  "record-analysis": "Record the analysis outcome",
  "request-limit-exception": "Request a limit exception",
  "submit-for-approval": "Submit for approval",
  decide: "Decide the approval step",
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
  recordAnalysis: (id: string, body: { limitGate: LimitGateResult; systemRecommendation: Recommendation; copRatio?: number | null; notes?: string | null }) =>
    post<ApplicationAck>(`/origination/applications/${enc(id)}/analysis`, body),
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
