"use client";

/**
 * Backend sign-in plumbing: API calls, backend tokens (with refresh) and Microsoft sign-in through the backend code flow
 * (backend ADR-0013 amendment 1).
 *
 * Enabled when NEXT_PUBLIC_API_BASE_URL is set. For Microsoft, the backend holds the Entra client secret; the browser only carries an
 * opaque state handle between `POST /auth/microsoft/start` and the `/callback/` page, which posts the returned code to
 * `POST /auth/microsoft/token`. Register `<site>/callback/` as a Web redirect URI in Entra and as
 * `Authentication:MicrosoftSignIn:PortalRedirectUri` in the backend. Tokens stay in sessionStorage for now (TD-952).
 */
const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

export const backendSsoEnabled = apiBase.length > 0;

const pendingKey = "credigit.ser.microsoft-sign-in";
const tokensKey = "credigit.ser.backend-tokens";
/** Refresh the access token this long before it expires. */
const refreshMarginMs = 60_000;

export type BackendTokens = { accessToken: string; refreshToken: string; expiresAt: string; refreshTokenExpiresAt: string; sessionId: string };

/** `GET /identity/me` — the fields the session needs. */
export type BackendMe = { id: string; name: string; email?: string; tenantId: string; roles: string[]; permissions: string[] };

type Problem = { title?: string; detail?: string; code?: string };

/** Error from the API, with the backend's error code (e.g. "auth.invalid-credentials"). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function apiCall<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as T & Problem;
  if (!response.ok) throw new ApiError(body.detail || body.title || `The server answered ${response.status}.`, response.status, body.code);
  return body;
}

export function backendTokens(): BackendTokens | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(tokensKey);
  return raw ? (JSON.parse(raw) as BackendTokens) : null;
}

export function saveBackendTokens(tokens: BackendTokens): void {
  sessionStorage.setItem(tokensKey, JSON.stringify(tokens));
}

let refreshing: Promise<BackendTokens | null> | null = null;

/** A usable access token: refreshed (single-flight, the refresh token rotates) shortly before it expires. */
export async function validAccessToken(): Promise<string | null> {
  const tokens = backendTokens();
  if (!tokens) return null;
  if (Date.parse(tokens.expiresAt) - Date.now() > refreshMarginMs) return tokens.accessToken;
  refreshing ??= apiCall<BackendTokens>("/auth/token/refresh", { method: "POST", body: JSON.stringify({ refreshToken: tokens.refreshToken }) })
    .then((fresh) => {
      saveBackendTokens(fresh);
      return fresh;
    })
    .catch(() => {
      sessionStorage.removeItem(tokensKey);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return (await refreshing)?.accessToken ?? null;
}

/** The signed-in backend user (after password or Microsoft sign-in). */
export async function loadBackendMe(tokens: BackendTokens): Promise<BackendMe> {
  saveBackendTokens(tokens);
  return apiCall<BackendMe>("/identity/me", {}, tokens.accessToken);
}

/** Step 1: ask the backend where to send the browser, remember the state handle in this tab, then leave for Microsoft. */
export async function startMicrosoftSignIn(next: string): Promise<void> {
  const start = await apiCall<{ authorizeUrl: string; stateHandle: string }>("/auth/microsoft/start", { method: "POST" });
  sessionStorage.setItem(pendingKey, JSON.stringify({ stateHandle: start.stateHandle, next }));
  window.location.assign(start.authorizeUrl);
}

/** Step 2 (on `/callback/`): exchange the code for backend tokens and load the signed-in user. */
export async function completeMicrosoftSignIn(code: string, state: string): Promise<{ me: BackendMe; next: string }> {
  const raw = sessionStorage.getItem(pendingKey);
  sessionStorage.removeItem(pendingKey);
  if (!raw) throw new Error("This sign-in wasn't started in this browser tab, or it has already been used. Start again.");
  const pending = JSON.parse(raw) as { stateHandle: string; next: string };
  const tokens = await apiCall<BackendTokens>("/auth/microsoft/token", { method: "POST", body: JSON.stringify({ code, state, stateHandle: pending.stateHandle }) });
  return { me: await loadBackendMe(tokens), next: pending.next };
}

/** Revokes the backend session (best effort) and forgets the tokens. */
export async function signOutOfBackend(): Promise<void> {
  const tokens = backendTokens();
  sessionStorage.removeItem(tokensKey);
  if (backendSsoEnabled && tokens) await apiCall<void>("/auth/logout", { method: "POST" }, tokens.accessToken).catch(() => undefined);
}
