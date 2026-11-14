"use client";

/**
 * Email + password sign-in, registration and password reset / change through the backend (backend ADR-0013 local flows) instead of
 * browser-only accounts. Enabled with NEXT_PUBLIC_API_BASE_URL. Passwords are hashed and checked by the backend; the browser only keeps
 * the open one-time-code challenges of this tab (sessionStorage) to show the masked e-mail and, in Development, the code itself
 * (`developmentCode`, backend Authentication:Local:ShowCodesInDevelopment).
 */
import type { RoleId } from "@/lib/rbac/roles";
import { ApiError, apiCall, backendSsoEnabled, loadBackendMe, validAccessToken, type BackendMe, type BackendTokens } from "./backend-sso";

export const backendAuthEnabled = backendSsoEnabled;

const challengesKey = "credigit.ser.backend-challenges";

export type BackendChallenge = {
  challengeId: string;
  purpose: "SignIn" | "Registration" | "PasswordReset" | "StepUp";
  maskedEmail: string;
  expiresAt: string;
  codeLength: number;
  maxAttempts: number;
  developmentCode?: string | null;
  /** "authenticator": the code comes from the person's authenticator app — nothing was e-mailed and there is no resend (ADR-0017). */
  channel?: "email" | "authenticator";
};

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function readChallenges(): Record<string, BackendChallenge> {
  try {
    return JSON.parse(sessionStorage.getItem(challengesKey) ?? "{}") as Record<string, BackendChallenge>;
  } catch {
    return {};
  }
}

function remember(challenge: BackendChallenge): BackendChallenge {
  sessionStorage.setItem(challengesKey, JSON.stringify({ ...readChallenges(), [challenge.challengeId]: challenge }));
  return challenge;
}

function forget(id: string): void {
  const all = readChallenges();
  delete all[id];
  sessionStorage.setItem(challengesKey, JSON.stringify(all));
}

export function backendChallenge(id: string | null | undefined): BackendChallenge | undefined {
  return id && typeof window !== "undefined" ? readChallenges()[id] : undefined;
}

export async function backendSignIn(email: string, password: string): Promise<Result<{ challengeId: string }>> {
  try {
    const c = remember(await apiCall<BackendChallenge>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
    return { ok: true, challengeId: c.challengeId };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export type BackendRegistration = { name: string; email: string; password: string; institution: string; branch: string; requestedRoleId: RoleId };

export async function backendRegister(input: BackendRegistration): Promise<Result<{ challengeId: string }>> {
  try {
    const c = remember(
      await apiCall<BackendChallenge>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: input.email, name: input.name, password: input.password, requestedRoleIds: [input.requestedRoleId], branch: input.branch, institution: input.institution }),
      }),
    );
    return { ok: true, challengeId: c.challengeId };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Always answers the same way for unknown e-mails (the backend sends a decoy challenge). */
export async function backendForgotPassword(email: string): Promise<{ challengeId: string | null }> {
  try {
    return { challengeId: remember(await apiCall<BackendChallenge>("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) })).challengeId };
  } catch {
    return { challengeId: null };
  }
}

export async function backendResend(id: string): Promise<BackendChallenge | undefined> {
  try {
    return remember(await apiCall<BackendChallenge>("/auth/otp/resend", { method: "POST", body: JSON.stringify({ challengeId: id }) }));
  } catch {
    return undefined;
  }
}

export type BackendVerifyOutcome =
  | { ok: true; purpose: "signin"; me: BackendMe }
  | { ok: true; purpose: "signup" }
  | { ok: true; purpose: "reset"; token: string }
  | { ok: false; error: string; expired?: boolean };

export async function backendVerify(id: string, code: string): Promise<BackendVerifyOutcome> {
  try {
    const result = await apiCall<{ purpose: string; tokens?: BackendTokens; resetToken?: string }>("/auth/otp/verify", { method: "POST", body: JSON.stringify({ challengeId: id, code }) });
    forget(id);
    if (result.purpose === "PasswordReset" && result.resetToken) return { ok: true, purpose: "reset", token: result.resetToken };
    if (result.purpose === "Registration") return { ok: true, purpose: "signup" };
    if (!result.tokens) return { ok: false, error: "The sign-in did not return a session. Start again.", expired: true };
    return { ok: true, purpose: "signin", me: await loadBackendMe(result.tokens) };
  } catch (e) {
    const expired = e instanceof ApiError && (e.code === "auth.otp-expired" || e.code === "auth.challenge-invalid");
    return { ok: false, error: message(e), expired };
  }
}

export async function backendResetPassword(token: string, password: string): Promise<Result> {
  try {
    await apiCall<void>("/auth/password/reset", { method: "POST", body: JSON.stringify({ resetToken: token, newPassword: password }) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function backendChangePassword(current: string, next: string): Promise<Result> {
  const token = await validAccessToken();
  if (!token) return { ok: false, error: "Sign in with your email and password to change it." };
  try {
    await apiCall<void>("/auth/password/change", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) }, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
