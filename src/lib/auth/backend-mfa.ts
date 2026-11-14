"use client";

/**
 * The second sign-in step through the backend (ADR-0017): e-mailed codes (default) or an authenticator app. The person sets it up in
 * Settings → Security; an administrator can reset it (lost phone) through Operations user.mfa-reset.
 */
import { identityCall } from "./backend-identity";

export type MfaMethod = "email" | "authenticator";

export type MfaStatus = { method: MfaMethod; authenticatorEnrolledAt?: string | null; setupPending: boolean; setupExpiresAt?: string | null };

/** Returned once when set-up starts: the key for manual entry and the otpauth:// URI shown as a QR code. */
export type AuthenticatorSetup = { secret: string; otpAuthUri: string; issuer: string; accountName: string; digits: number; periodSeconds: number; expiresAt: string };

export type MfaChange = { method: MfaMethod; changedAt: string };

export type MfaResetSubmission = { operationId: string; status: string; applied: boolean };

export const loadMyMfa = () => identityCall<MfaStatus>("/identity/me/mfa");

export const startAuthenticatorSetup = () => identityCall<AuthenticatorSetup>("/identity/me/mfa/authenticator", { method: "POST" });

export const confirmAuthenticator = (code: string) =>
  identityCall<MfaChange>("/identity/me/mfa/authenticator/confirmation", { method: "POST", body: JSON.stringify({ code }) });

export const switchToEmailCodes = (code: string) => identityCall<MfaChange>("/identity/me/mfa/email", { method: "POST", body: JSON.stringify({ code }) });

export const resetUserMfa = (userId: string, reason: string) =>
  identityCall<MfaResetSubmission>(`/identity/users/${encodeURIComponent(userId)}/mfa-reset`, { method: "POST", body: JSON.stringify({ reason }) });

/** How a method reads in the UI. */
export const mfaMethodLabel = (method: string | undefined) => (method === "authenticator" ? "Authenticator app" : "Code sent by e-mail");

/** Groups a manual-entry key in fours so it's easier to type into an app. */
export const groupedKey = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();
