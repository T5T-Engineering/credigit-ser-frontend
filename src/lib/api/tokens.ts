"use client";

/**
 * Token storage (API contract §3): the access token lives in memory only; the refresh token in `sessionStorage`
 * (tab-scoped, cleared on close — backend TD-032 moves it to an httpOnly cookie). Never `localStorage`, URLs or logs.
 */
export type TokenPair = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  expiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
};

const REFRESH_KEY = "credigit.ser.refresh";

let accessToken: string | null = null;
let accessExpiresAt = 0;
/** Short-lived step-up token (carries `acrs` + `auth_time`); used for decisions until it expires. */
let stepUpToken: { token: string; expiresAt: number } | null = null;
/** Entra mode: MSAL acquires the access token; set by `msal.ts`. */
let externalProvider: (() => Promise<string | null>) | null = null;

export function storeTokens(pair: TokenPair) {
  accessToken = pair.accessToken;
  accessExpiresAt = Date.parse(pair.expiresAt) || Date.now() + pair.expiresIn * 1000;
  try {
    sessionStorage.setItem(REFRESH_KEY, pair.refreshToken);
  } catch {
    /* storage unavailable: the session ends with the page */
  }
}

export function refreshToken(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function accessTokenState() {
  return { token: accessToken, expiresAt: accessExpiresAt };
}

export function setExternalTokenProvider(provider: (() => Promise<string | null>) | null) {
  externalProvider = provider;
}

export function externalTokenProvider() {
  return externalProvider;
}

export function storeStepUpToken(token: string, expiresAt: string) {
  stepUpToken = { token, expiresAt: Date.parse(expiresAt) };
}

/** A valid step-up token, if one was verified recently. */
export function currentStepUpToken(): string | null {
  if (stepUpToken && stepUpToken.expiresAt > Date.now()) return stepUpToken.token;
  stepUpToken = null;
  return null;
}

export function clearTokens() {
  accessToken = null;
  accessExpiresAt = 0;
  stepUpToken = null;
  externalProvider = null;
  try {
    sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}
