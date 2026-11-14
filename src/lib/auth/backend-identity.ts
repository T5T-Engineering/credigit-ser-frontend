"use client";

/**
 * Who the browser is to the backend: the backend bearer token (password or Microsoft sign-in), or — for sign-ins by role in Development
 * only — the backend's development identity headers (NEXT_PUBLIC_BACKEND_DEV_IDENTITY; TD-953). Reads the session from sessionStorage
 * directly so data stores can use it without importing the session store.
 */
import { apiCall, apiFile, backendSsoEnabled, validAccessToken } from "./backend-sso";

const devIdentity = process.env.NEXT_PUBLIC_BACKEND_DEV_IDENTITY === "true";
const devTenant = process.env.NEXT_PUBLIC_BACKEND_DEV_TENANT ?? "";
/** Session store key (src/lib/auth/session.ts). */
const sessionStorageKey = "credigit.ser.session";

export type ModuleAccessLevel = "view" | "edit";

/** `GET /identity/me` — access the backend grants the signed-in user (roles + permission groups + baseline). */
export type BackendAccess = { id: string; roles: string[]; permissions: string[]; moduleAccess: Record<string, ModuleAccessLevel> };

export async function backendIdentityHeaders(): Promise<Record<string, string> | null> {
  const accessToken = await validAccessToken();
  if (accessToken) return { Authorization: `Bearer ${accessToken}` };
  if (!devIdentity || typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(sessionStorageKey);
    const session = raw ? (JSON.parse(raw) as { state?: { user?: { id: string; name: string; email: string } | null; roleId?: string | null } }) : null;
    const user = session?.state?.user;
    const roleId = session?.state?.roleId;
    if (!user || !roleId) return null;
    return { "X-Dev-User": user.id, "X-Dev-Name": user.name, "X-Dev-Email": user.email, "X-Dev-Tenant": devTenant, "X-Dev-Roles": roleId };
  } catch {
    return null;
  }
}

/** Calls the backend API as the signed-in user (null identity → throws "Sign in first."). */
export async function identityCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = await backendIdentityHeaders();
  if (!headers) throw new Error("Sign in first.");
  return apiCall<T>(path, { ...init, headers: { ...headers, ...init.headers } });
}

/** Downloads a file from the backend as the signed-in user and saves it in the browser (download, CSV export). */
export async function identityDownload(path: string, fallbackName: string): Promise<void> {
  const headers = await backendIdentityHeaders();
  if (!headers) throw new Error("Sign in first.");
  const { blob, filename } = await apiFile(path, { headers }, fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The signed-in user's backend access, or null without a backend / identity. */
export async function loadBackendAccess(): Promise<BackendAccess | null> {
  if (!backendSsoEnabled) return null;
  try {
    return await identityCall<BackendAccess>("/identity/me");
  } catch {
    return null;
  }
}
