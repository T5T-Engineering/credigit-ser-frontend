"use client";

/**
 * Microsoft sign-in through the backend (server-side code flow, backend ADR-0013 amendment 1).
 *
 * Enabled when NEXT_PUBLIC_API_BASE_URL is set. The backend holds the Entra client secret; the browser only carries an opaque state
 * handle between `POST /auth/microsoft/start` and the `/callback/` page, which posts the returned code to `POST /auth/microsoft/token`.
 * Register `<site>/callback/` as a Web redirect URI in Entra and as `Authentication:MicrosoftSignIn:PortalRedirectUri` in the backend.
 * Tokens stay in sessionStorage for now (TD-952).
 */
const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

export const backendSsoEnabled = apiBase.length > 0;

const pendingKey = "credigit.ser.microsoft-sign-in";
const tokensKey = "credigit.ser.backend-tokens";

export type BackendTokens = { accessToken: string; refreshToken: string; expiresAt: string; refreshTokenExpiresAt: string; sessionId: string };

/** `GET /identity/me` — the fields the session needs. */
export type BackendMe = { id: string; name: string; email?: string; tenantId: string; roles: string[]; permissions: string[] };

type Problem = { title?: string; detail?: string; code?: string };

async function call<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
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
  if (!response.ok) throw new Error(body.detail || body.title || `The server answered ${response.status}.`);
  return body;
}

/** Step 1: ask the backend where to send the browser, remember the state handle in this tab, then leave for Microsoft. */
export async function startMicrosoftSignIn(next: string): Promise<void> {
  const start = await call<{ authorizeUrl: string; stateHandle: string }>("/auth/microsoft/start", { method: "POST" });
  sessionStorage.setItem(pendingKey, JSON.stringify({ stateHandle: start.stateHandle, next }));
  window.location.assign(start.authorizeUrl);
}

/** Step 2 (on `/callback/`): exchange the code for backend tokens and load the signed-in user. */
export async function completeMicrosoftSignIn(code: string, state: string): Promise<{ me: BackendMe; next: string }> {
  const raw = sessionStorage.getItem(pendingKey);
  sessionStorage.removeItem(pendingKey);
  if (!raw) throw new Error("This sign-in wasn't started in this browser tab, or it has already been used. Start again.");
  const pending = JSON.parse(raw) as { stateHandle: string; next: string };
  const tokens = await call<BackendTokens>("/auth/microsoft/token", { method: "POST", body: JSON.stringify({ code, state, stateHandle: pending.stateHandle }) });
  sessionStorage.setItem(tokensKey, JSON.stringify(tokens));
  const me = await call<BackendMe>("/identity/me", {}, tokens.accessToken);
  return { me, next: pending.next };
}

export function backendTokens(): BackendTokens | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(tokensKey);
  return raw ? (JSON.parse(raw) as BackendTokens) : null;
}

/** Revokes the backend session (best effort) and forgets the tokens. */
export async function signOutOfBackend(): Promise<void> {
  const tokens = backendTokens();
  sessionStorage.removeItem(tokensKey);
  if (backendSsoEnabled && tokens) await call<void>("/auth/logout", { method: "POST" }, tokens.accessToken).catch(() => undefined);
}
