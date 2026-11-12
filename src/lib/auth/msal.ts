"use client";

/**
 * Microsoft Entra ID sign-in via MSAL.js (auth mode `MicrosoftEntra`).
 *
 * Configuration comes from the backend's anonymous `GET /auth/config` → `microsoftEntra` (authority, clientId, scopes,
 * redirectPath, postLogoutRedirectPath) and falls back to environment config (`NEXT_PUBLIC_AZURE_AD_CLIENT_ID`,
 * `NEXT_PUBLIC_AZURE_AD_AUTHORITY`, `NEXT_PUBLIC_AZURE_AD_SCOPES`, `NEXT_PUBLIC_AZURE_AD_REDIRECT_URI`). The Entra
 * tenant / client of each environment is still an open question (AUTH-OQ1) — without either source the Microsoft
 * button explains that sign-in isn't configured.
 *
 * API mode sends the Entra **access token** (scopes from config) as Bearer and reads `GET /identity/me`.
 */
import { PublicClientApplication, type AccountInfo, type Configuration } from "@azure/msal-browser";

export type EntraSettings = {
  authority: string;
  clientId: string;
  scopes: string[];
  redirectPath: string;
  postLogoutRedirectPath: string;
};

/** Settings from environment config (used when the backend config doesn't provide them, e.g. demo mode). */
export function entraSettingsFromEnv(): EntraSettings | null {
  const clientId = (process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID ?? "").trim();
  const authority = (process.env.NEXT_PUBLIC_AZURE_AD_AUTHORITY ?? "").trim();
  if (!clientId || !authority) return null;
  const redirect = (process.env.NEXT_PUBLIC_AZURE_AD_REDIRECT_URI ?? "").trim();
  return {
    clientId,
    authority,
    scopes: (process.env.NEXT_PUBLIC_AZURE_AD_SCOPES ?? "").split(/[\s,]+/).filter(Boolean),
    redirectPath: redirect || "/login/",
    postLogoutRedirectPath: "/login/",
  };
}

let settings: EntraSettings | null = null;
let ready: Promise<PublicClientApplication> | null = null;

const absolute = (path: string) => (/^https?:\/\//i.test(path) ? path : `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`);

/** Initialise (or re-initialise) MSAL from the active configuration. */
export function configureMsal(next: EntraSettings | null) {
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  settings = next;
  ready = null;
}

export function msalConfigured(): boolean {
  return settings !== null;
}

function getMsal(): Promise<PublicClientApplication> {
  if (!settings) return Promise.reject(new Error("Microsoft sign-in is not configured."));
  if (!ready) {
    const config: Configuration = {
      auth: { clientId: settings.clientId, authority: settings.authority, redirectUri: absolute(settings.redirectPath), postLogoutRedirectUri: absolute(settings.postLogoutRedirectPath) },
      cache: { cacheLocation: "sessionStorage" },
    };
    const instance = new PublicClientApplication(config);
    ready = instance.initialize().then(() => instance);
  }
  return ready;
}

export type MicrosoftIdentity = { name: string; email: string; oid: string; tenantId: string; appRoles: string[] };

function toIdentity(account: AccountInfo): MicrosoftIdentity {
  const claims = (account.idTokenClaims ?? {}) as { roles?: string[]; preferred_username?: string; email?: string };
  return {
    name: account.name ?? account.username,
    email: claims.email ?? claims.preferred_username ?? account.username,
    oid: account.localAccountId,
    tenantId: account.tenantId,
    appRoles: claims.roles ?? [],
  };
}

/** Interactive sign-in in a popup (keeps the static site simple; no redirect handling needed). */
export async function signInWithMicrosoft(): Promise<MicrosoftIdentity> {
  const msal = await getMsal();
  const scopes = ["openid", "profile", "email", ...(settings?.scopes ?? [])];
  const result = await msal.loginPopup({ scopes, prompt: "select_account" });
  msal.setActiveAccount(result.account);
  return toIdentity(result.account);
}

/** Access token for the backend API (Entra mode): silent first, popup when interaction is needed. */
export async function acquireApiToken(): Promise<string | null> {
  const msal = await getMsal();
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account || !settings?.scopes.length) return null;
  try {
    return (await msal.acquireTokenSilent({ account, scopes: settings.scopes })).accessToken;
  } catch {
    return (await msal.acquireTokenPopup({ account, scopes: settings.scopes })).accessToken;
  }
}

export async function signOutOfMicrosoft(): Promise<void> {
  if (!settings) return;
  const msal = await getMsal();
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (account) await msal.logoutPopup({ account, mainWindowRedirectUri: settings.postLogoutRedirectPath });
}
