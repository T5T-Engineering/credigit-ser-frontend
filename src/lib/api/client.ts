"use client";

/**
 * Credigit API client (backend contract `docs/api/identity-access.md` §1, §3).
 *
 * - `Authorization: Bearer <access token>`; `X-Correlation-ID` per call; `Idempotency-Key` on POST/PUT (one per user
 *   intent — pass the same key when retrying).
 * - Errors are RFC 9457 problem details → `ApiProblem` (branch on `code`, show `detail`).
 * - Single-flight refresh: one refresh at a time per tab, `auth.tokenRefreshLeadSeconds` before expiry or on a 401;
 *   the refresh token is replaced every time. A failed refresh signs the user out (`onSessionEnded`).
 */
import { getRule } from "../platform/rules";
import { apiEnabled, apiUrl } from "./config";
import { accessTokenState, clearTokens, currentStepUpToken, externalTokenProvider, refreshToken, storeTokens, type TokenPair } from "./tokens";

export type Problem = { type?: string; title?: string; status: number; detail?: string; code?: string; stepUpRequired?: boolean; correlationId?: string };

export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly stepUpRequired: boolean;
  readonly correlationId?: string;
  readonly retryAfterSeconds?: number;
  constructor(p: Problem, retryAfterSeconds?: number) {
    super(p.detail ?? p.title ?? `Request failed (${p.status}).`);
    this.name = "ApiProblem";
    this.status = p.status;
    this.code = p.code ?? `http.${p.status}`;
    this.detail = p.detail ?? p.title ?? this.message;
    this.stepUpRequired = Boolean(p.stepUpRequired);
    this.correlationId = p.correlationId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** User-facing text for any error thrown by the client. */
export function problemText(e: unknown): string {
  if (e instanceof ApiProblem) return e.detail;
  return e instanceof Error ? e.message : String(e);
}

/** Codes that end the session (contract §3): clear tokens and go to the login page. */
const SESSION_ENDING = new Set(["auth.refresh-token-reused", "auth.session-expired", "auth.refresh-token-invalid", "auth.account-disabled"]);

let sessionEnded: ((reason: string) => void) | null = null;
/** The app registers how to sign out locally when the backend ends the session. */
export function onSessionEnded(handler: ((reason: string) => void) | null) {
  sessionEnded = handler;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Anonymous endpoints (`/auth/*`). */
  anonymous?: boolean;
  /** Reuse on retry of the same user intent; a fresh one is created per call otherwise. */
  idempotencyKey?: string;
  /** Send the step-up token instead of the normal access token (approval retried after step-up). */
  stepUp?: boolean;
  accept?: string;
};

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh; resolves false when the session can't be refreshed. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const token = refreshToken();
    if (!token) return false;
    try {
      const pair = await send<TokenPair>("/auth/token/refresh", { method: "POST", body: { refreshToken: token }, anonymous: true });
      storeTokens(pair);
      return true;
    } catch (e) {
      if (e instanceof ApiProblem && e.code === "auth.concurrent-refresh") return Boolean(accessTokenState().token);
      clearTokens();
      sessionEnded?.(e instanceof ApiProblem ? e.code : "auth.refresh-failed");
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function bearer(opts: Options): Promise<string | null> {
  if (opts.anonymous) return null;
  if (opts.stepUp) {
    const t = currentStepUpToken();
    if (t) return t;
  }
  const external = externalTokenProvider();
  if (external) return external();
  const { token, expiresAt } = accessTokenState();
  const leadMs = getRule<number>("auth.tokenRefreshLeadSeconds") * 1000;
  if (!token || expiresAt - Date.now() < leadMs) {
    if (await refreshSession()) return accessTokenState().token;
  }
  return token;
}

async function raw(path: string, opts: Options, retried = false): Promise<Response> {
  if (!apiEnabled) throw new ApiProblem({ status: 0, code: "client.api-disabled", detail: "No backend is configured (demo mode)." });
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: opts.accept ?? "application/json", "X-Correlation-ID": crypto.randomUUID() };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST" || method === "PUT") headers["Idempotency-Key"] = opts.idempotencyKey ?? newIdempotencyKey();
  const token = await bearer(opts);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(path), { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (res.status === 401 && !opts.anonymous && !retried && !externalTokenProvider()) {
    if (await refreshSession()) return raw(path, opts, true);
  }
  if (!res.ok) {
    let problem: Problem = { status: res.status };
    try {
      problem = { ...(await res.json()), status: res.status };
    } catch {
      /* not a problem document */
    }
    const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
    const error = new ApiProblem(problem, retryAfter);
    if (res.status === 401 && !opts.anonymous) {
      clearTokens();
      sessionEnded?.(error.code);
    } else if (SESSION_ENDING.has(error.code)) {
      clearTokens();
      sessionEnded?.(error.code);
    }
    throw error;
  }
  return res;
}

async function send<T>(path: string, opts: Options): Promise<T> {
  const res = await raw(path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** JSON call. Throws `ApiProblem`. */
export function apiFetch<T>(path: string, opts: Options = {}): Promise<T> {
  return send<T>(path, opts);
}

/** File download (e.g. `text/csv` exports): returns the blob and the server's file name. */
export async function apiDownload(path: string, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
  const res = await raw(path, { accept: "text/csv" });
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return { blob: await res.blob(), filename: decodeURIComponent(match?.[1] ?? fallbackName) };
}

/** Commands that need approval answer 202 with the operation (contract §1). */
export type Accepted = { operationId: string; status: string; applied: boolean };
