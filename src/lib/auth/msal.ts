"use client";

/**
 * Microsoft Entra ID (Azure AD) single sign-on via MSAL.js.
 *
 * Enabled when NEXT_PUBLIC_AZURE_AD_CLIENT_ID is set. Register a Single-page application in Entra ID with
 * redirect URI = <site>/login/ (and http://localhost:3100/login/ for local dev). Optional app roles whose
 * values match our role ids (e.g. "credit-analyst", "cro") are read from the ID token to assign the role.
 */
import { PublicClientApplication, type AccountInfo, type Configuration } from "@azure/msal-browser";

const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID ?? "";
const tenantId = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || "organizations";

export const msalEnabled = clientId.length > 0;

let instance: PublicClientApplication | null = null;
let ready: Promise<PublicClientApplication> | null = null;

function config(): Configuration {
  const redirectUri = process.env.NEXT_PUBLIC_AZURE_AD_REDIRECT_URI || `${window.location.origin}/login/`;
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri,
      postLogoutRedirectUri: `${window.location.origin}/login/`,
    },
    cache: { cacheLocation: "sessionStorage" },
  };
}

export function getMsal(): Promise<PublicClientApplication> {
  if (!msalEnabled) return Promise.reject(new Error("Microsoft sign-in is not configured."));
  if (!ready) {
    instance = new PublicClientApplication(config());
    ready = instance.initialize().then(() => instance!);
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
  const result = await msal.loginPopup({ scopes: ["openid", "profile", "email"], prompt: "select_account" });
  msal.setActiveAccount(result.account);
  return toIdentity(result.account);
}

export async function signOutOfMicrosoft(): Promise<void> {
  if (!msalEnabled) return;
  const msal = await getMsal();
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (account) await msal.logoutPopup({ account, mainWindowRedirectUri: "/login/" });
}
