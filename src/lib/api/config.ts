/**
 * Backend API location (invariant 8: environment config, never a literal).
 * `NEXT_PUBLIC_API_URL` = origin (and optional base path) of the Credigit API gateway.
 * Unset → demo mode: every screen runs on browser-side seeded data.
 */
const raw = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");

export const apiBaseUrl = raw;
/** True when a backend is configured (API mode). */
export const apiEnabled = raw.length > 0;
/** API version prefix from the backend contract (`/api/v1`). */
export const apiPrefix = "/api/v1";

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${apiPrefix}${path.startsWith("/") ? path : `/${path}`}`;
}
