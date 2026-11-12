"use client";

/**
 * Identity & Access API (backend contract `credigit-ser-core-backend/docs/api/identity-access.md`).
 * Only used in API mode (`NEXT_PUBLIC_API_URL`); demo mode goes through `src/lib/auth/accounts.ts` and the admin stores.
 */
import { apiDownload, apiFetch, type Accepted } from "../api/client";
import type { TokenPair } from "../api/tokens";

export type AuthModeName = "Local" | "MicrosoftEntra";

export type AuthConfig = {
  mode: AuthModeName;
  local: {
    tenantId: string;
    tenantSelection: boolean;
    registrationEnabled: boolean;
    otpLength: number;
    otpTtlMinutes: number;
    passwordPolicy: { minLength: number; requireMixed: boolean };
  } | null;
  microsoftEntra: {
    authority: string;
    tenantId: string;
    clientId: string;
    scopes: string[];
    redirectPath: string;
    postLogoutRedirectPath: string;
  } | null;
};

export type ChallengePurpose = "SignIn" | "Registration" | "PasswordReset" | "StepUp";
export type Challenge = { challengeId: string; purpose: ChallengePurpose; maskedEmail: string; expiresAt: string; codeLength: number; maxAttempts: number };
export type Verification = {
  purpose: string;
  tokens?: TokenPair;
  resetToken?: string;
  accessRequest?: { userId: string; operationId: string; operationStatus: string; applied: boolean };
};
export type StepUpToken = { accessToken: string; tokenType: "Bearer"; expiresIn: number; expiresAt: string; stepUpAt: string };

export type CurrentUser = {
  id: string;
  name: string;
  email?: string;
  tenantId: string;
  kind: "User" | "Service" | "System";
  roles: string[];
  permissions: string[];
  status?: "Pending" | "Active" | "Deactivated" | "Locked";
  invitationPending: boolean;
  accessRequestPending: boolean;
  roleSource: "directory" | "token" | "none";
  moduleAccess: Record<string, "view" | "edit">;
  permissionCatalogueVersion: string;
  authenticationMode: AuthModeName;
};

export type ApiRole = {
  id: string;
  name: string;
  short: string;
  group: string;
  description: string;
  tier?: number;
  authority: string;
  modules: Record<string, "view" | "edit">;
  permissions: string[];
  kind: "System" | "Custom";
  clonedFrom?: string;
  customised: boolean;
  administrator: boolean;
  version: number;
};

/** `User` of the identity API (shape per contract; fields beyond `CurrentUser` are optional). */
export type ApiUser = {
  id: string;
  name: string;
  email?: string;
  roles: string[];
  status?: "Pending" | "Active" | "Deactivated" | "Locked";
  branch?: string;
  institution?: string;
  reason?: string;
  requestedRoleIds?: string[];
  createdAt?: string;
  lastSignInAt?: string;
  mfaEnrolled?: boolean;
};

const post = <T>(path: string, body?: unknown, anonymous = false) => apiFetch<T>(path, { method: "POST", body, anonymous });

export const authApi = {
  config: (tenantId?: string) => apiFetch<AuthConfig>(`/auth/config${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`, { anonymous: true }),
  login: (email: string, password: string, tenantId?: string) => post<Challenge>("/auth/login", { email, password, tenantId }, true),
  verify: (challengeId: string, code: string) => post<Verification>("/auth/otp/verify", { challengeId, code }, true),
  resend: (challengeId: string) => post<Challenge>("/auth/otp/resend", { challengeId }, true),
  forgot: (email: string, tenantId?: string) => post<Challenge>("/auth/password/forgot", { email, tenantId }, true),
  reset: (resetToken: string, newPassword: string) => post<void>("/auth/password/reset", { resetToken, newPassword }, true),
  register: (input: { email: string; name: string; password: string; requestedRoleIds: string[]; branch?: string; institution?: string; reason?: string; tenantId?: string }) =>
    post<Challenge>("/auth/register", input, true),
  logout: () => post<void>("/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) => post<void>("/auth/password/change", { currentPassword, newPassword }),
  stepUp: () => post<Challenge>("/auth/step-up"),
  stepUpVerify: (challengeId: string, code: string) => post<StepUpToken>("/auth/step-up/verify", { challengeId, code }),
};

export const identityApi = {
  me: () => apiFetch<CurrentUser>("/identity/me"),
  roles: () => apiFetch<ApiRole[]>("/identity/roles"),
  users: (filter: { status?: string; role?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => Boolean(v)) as [string, string][]).toString();
    return apiFetch<ApiUser[]>(`/identity/users${q ? `?${q}` : ""}`);
  },
  accessRequests: () => apiFetch<ApiUser[]>("/identity/access-requests"),
  exportUsers: () => apiDownload("/identity/users/export", "users.csv"),
  exportRoles: () => apiDownload("/identity/roles/export", "roles-and-limits.csv"),
  changeRolePermissions: (roleId: string, grant: string[], revoke: string[], reason: string) =>
    post<Accepted>(`/identity/roles/${encodeURIComponent(roleId)}/permission-changes`, { grant, revoke, reason }),
  inviteUser: (input: { email: string; name: string; roleIds: string[]; branch?: string; reason: string }) => post<Accepted>("/identity/users/invitations", input),
  changeUserRoles: (userId: string, roleIds: string[], reason: string) => post<Accepted>(`/identity/users/${encodeURIComponent(userId)}/role-changes`, { roleIds, reason }),
  deactivateUser: (userId: string, reason: string) => post<Accepted>(`/identity/users/${encodeURIComponent(userId)}/deactivation`, { reason }),
  reactivateUser: (userId: string, reason: string) => post<Accepted>(`/identity/users/${encodeURIComponent(userId)}/reactivation`, { reason }),
  submitAccessRequest: (input: { requestedRoleIds: string[]; name?: string; branch?: string; institution?: string; reason?: string }) => post<Accepted>("/identity/access-requests", input),
  acceptInvitation: () => post<void>("/identity/me/invitation/accept"),
};
