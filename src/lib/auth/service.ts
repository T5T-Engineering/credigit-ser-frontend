"use client";

/**
 * Auth facade used by every auth page (AUTH-FR-03…19). Each function talks to the Identity & Access API in API mode
 * (`NEXT_PUBLIC_API_URL`) or to the demo account store (`./accounts.ts`) otherwise — pages never branch on the mode.
 */
import { useSyncExternalStore } from "react";
import { apiEnabled } from "../api/config";
import { ApiProblem, onSessionEnded, problemText } from "../api/client";
import { clearTokens, setExternalTokenProvider, storeStepUpToken, storeTokens } from "../api/tokens";
import { useDb } from "../data/store";
import { authApi, identityApi, type Challenge as ApiChallenge, type CurrentUser } from "../iam/api";
import { publish } from "../platform/events";
import { runHooks } from "../platform/hooks";
import { getRule } from "../platform/rules";
import { roleById, type RoleId } from "../rbac/roles";
import * as demo from "./accounts";
import { acquireApiToken, signInWithMicrosoft } from "./msal";
import { useSession, type SessionUser } from "./session";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type ChallengeKind = "signin" | "signup" | "reset" | "stepup";

/** What the code screen needs, in either mode. */
export type ChallengeView = {
  id: string;
  kind: ChallengeKind;
  maskedEmail: string;
  codeLength: number;
  expiresAt: number;
  maxAttempts: number;
  /** Demo only: the code is shown on screen because no e-mail is sent. */
  demoCode?: string;
};

// ---------------------------------------------------------------- API challenges (sessionStorage)

const CHALLENGES_KEY = "credigit.ser.challenges";
const kindOf: Record<ApiChallenge["purpose"], ChallengeKind> = { SignIn: "signin", Registration: "signup", PasswordReset: "reset", StepUp: "stepup" };

function readApiChallenges(): Record<string, ChallengeView> {
  try {
    return JSON.parse(sessionStorage.getItem(CHALLENGES_KEY) ?? "{}") as Record<string, ChallengeView>;
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
let snapshot: Record<string, ChallengeView> | null = null;

function saveApiChallenge(c: ApiChallenge): ChallengeView {
  const view: ChallengeView = { id: c.challengeId, kind: kindOf[c.purpose], maskedEmail: c.maskedEmail, codeLength: c.codeLength, expiresAt: Date.parse(c.expiresAt), maxAttempts: c.maxAttempts };
  const all = { ...readApiChallenges(), [view.id]: view };
  try {
    sessionStorage.setItem(CHALLENGES_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  snapshot = all;
  listeners.forEach((l) => l());
  return view;
}

function dropApiChallenge(id: string) {
  const all = readApiChallenges();
  delete all[id];
  try {
    sessionStorage.setItem(CHALLENGES_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  snapshot = all;
  listeners.forEach((l) => l());
}

function demoView(c: demo.Challenge): ChallengeView {
  return { id: c.id, kind: c.purpose, maskedEmail: demo.maskEmail(c.email), codeLength: c.code.length, expiresAt: c.expiresAt, maxAttempts: getRule<number>("auth.otpMaxAttempts"), demoCode: c.code };
}

/** The challenge for the code screen (reactive; resends update it). */
export function useChallenge(id: string | null): ChallengeView | undefined {
  const demoChallenge = demo.useAccounts((s) => (id ? s.challenges[id] : undefined));
  const api = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (snapshot ??= typeof window === "undefined" ? {} : readApiChallenges()),
    () => ({}) as Record<string, ChallengeView>,
  );
  if (!id) return undefined;
  if (apiEnabled) return api[id];
  return demoChallenge ? demoView(demoChallenge) : undefined;
}

// ---------------------------------------------------------------- session completion

/** Sign the user in locally and publish `identity.user.signed-in` (+ `identity.login.after` hook). */
async function completeSignIn(user: SessionUser, roleId: RoleId, me?: CurrentUser) {
  useSession.getState().signIn(user, roleId, me ? { permissions: me.permissions, roles: me.roles, tenantId: me.tenantId, authMode: me.authenticationMode } : undefined);
  const method = user.source === "microsoft" ? "microsoft" : user.source === "password" ? "password+otp" : "demo";
  publish("identity.user.signed-in", { module: "platform", subject: { type: "User", id: user.id, title: user.name }, payload: { method } });
  await runHooks("identity.login.after", { userId: user.id, method });
}

const knownRole = (roles: string[]): RoleId => (roles.find((r) => r in roleById) ?? roles[0] ?? "account-officer") as RoleId;

/** API mode: read `/identity/me` and start the local session from it. */
async function signInFromMe(source: SessionUser["source"]): Promise<Result> {
  const me = await identityApi.me();
  if (!me.roles.length && !me.permissions.length) return { ok: false, error: "Your account has no role yet. Ask your System Admin, or request access." };
  await completeSignIn({ id: me.id, name: me.name, email: me.email ?? "", source }, knownRole(me.roles), me);
  return { ok: true };
}

/** Demo access by role (prototype only): sign in as the seeded user for a role. */
export function signInDemo(roleId: RoleId) {
  const user = useDb.getState().users.find((u) => u.roleId === roleId);
  void completeSignIn({ id: user?.id ?? "USR-DEMO", name: user?.name ?? roleById[roleId].name, email: user?.email ?? "", source: "demo" }, roleId);
}

// The backend ended the session (refresh token reused / expired): sign out locally.
onSessionEnded(() => {
  void useSession.getState().signOut();
});

// ---------------------------------------------------------------- flows

/** Step 1 of Local sign-in: e-mail + password → a one-time code is sent. */
export async function startSignIn(email: string, password: string): Promise<Result<{ challengeId: string }>> {
  if (!apiEnabled) return demo.signInWithPassword(email, password);
  try {
    return { ok: true, challengeId: saveApiChallenge(await authApi.login(email.trim(), password)).id };
  } catch (e) {
    return { ok: false, error: problemText(e) };
  }
}

export type VerifyResult =
  | { ok: true; kind: "signedIn" }
  | { ok: true; kind: "reset"; token: string }
  | { ok: true; kind: "registered"; name?: string; operationId?: string }
  | { ok: false; error: string; expired?: boolean };

/** Verify a one-time code for sign-in, registration or reset. */
export async function verifyChallenge(challengeId: string, code: string): Promise<VerifyResult> {
  if (!apiEnabled) {
    const outcome = await demo.verifyCode(challengeId, code);
    if (!outcome.ok) return outcome;
    if (outcome.purpose === "reset") return { ok: true, kind: "reset", token: outcome.token };
    if (outcome.purpose === "signup") return { ok: true, kind: "registered", name: outcome.account.name };
    const user = demo.platformUserFor(outcome.account);
    if (!user) return { ok: false, error: "Your account isn't linked to a platform user yet. Contact your System Admin." };
    await completeSignIn({ id: user.id, name: user.name, email: user.email, source: "password" }, user.roleId);
    return { ok: true, kind: "signedIn" };
  }
  try {
    const v = await authApi.verify(challengeId, code);
    dropApiChallenge(challengeId);
    if (v.resetToken) return { ok: true, kind: "reset", token: v.resetToken };
    if (v.accessRequest) return { ok: true, kind: "registered", operationId: v.accessRequest.operationId };
    if (!v.tokens) return { ok: false, error: "The sign-in couldn't be completed. Start again.", expired: true };
    storeTokens(v.tokens);
    const done = await signInFromMe("password");
    return done.ok ? { ok: true, kind: "signedIn" } : done;
  } catch (e) {
    const expired = e instanceof ApiProblem && ["auth.otp-expired", "auth.challenge-invalid"].includes(e.code);
    if (expired) dropApiChallenge(challengeId);
    return { ok: false, error: problemText(e), expired };
  }
}

/** Send a new code (the old one stops working). */
export async function resendChallenge(challengeId: string): Promise<Result> {
  if (!apiEnabled) return demo.resendCode(challengeId) ? { ok: true } : { ok: false, error: "This code request has expired. Start again." };
  try {
    dropApiChallenge(challengeId);
    saveApiChallenge(await authApi.resend(challengeId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: problemText(e) };
  }
}

/** "Set or reset your password": always answers the same way, whether or not the e-mail exists. */
export async function forgotPassword(email: string): Promise<{ challengeId: string | null; error?: string }> {
  if (!apiEnabled) return demo.requestPasswordReset(email);
  try {
    return { challengeId: saveApiChallenge(await authApi.forgot(email.trim())).id };
  } catch (e) {
    return { challengeId: null, error: problemText(e) };
  }
}

export async function resetPassword(token: string, password: string): Promise<Result> {
  if (!apiEnabled) return demo.resetPassword(token, password);
  try {
    await authApi.reset(token, password);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: problemText(e) };
  }
}

export async function registerAccount(input: demo.RegistrationInput): Promise<Result<{ challengeId: string }>> {
  if (!apiEnabled) return demo.register(input);
  try {
    const c = await authApi.register({ email: input.email.trim(), name: input.name.trim(), password: input.password, requestedRoleIds: [input.requestedRoleId], branch: input.branch, institution: input.institution });
    return { ok: true, challengeId: saveApiChallenge(c).id };
  } catch (e) {
    return { ok: false, error: problemText(e) };
  }
}

export async function changeMyPassword(email: string, current: string, next: string): Promise<Result> {
  if (!apiEnabled) return demo.changePassword(email, current, next);
  try {
    await authApi.changePassword(current, next);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: problemText(e) };
  }
}

/** Microsoft Entra sign-in. API mode: Entra access token → `/identity/me`; demo: match the seeded user by e-mail. */
export async function completeEntraSignIn(): Promise<Result<{ pickRole?: { id: string; name: string; email: string } }>> {
  try {
    const identity = await signInWithMicrosoft();
    if (apiEnabled) {
      setExternalTokenProvider(acquireApiToken);
      return await signInFromMe("microsoft");
    }
    const mapped = identity.appRoles.find((r): r is RoleId => r in roleById);
    const existing = useDb.getState().users.find((u) => u.email.toLowerCase() === identity.email.toLowerCase());
    const user = { id: existing?.id ?? identity.oid, name: identity.name, email: identity.email };
    const roleId = mapped ?? existing?.roleId;
    if (!roleId) return { ok: true, pickRole: user };
    await completeSignIn({ ...user, source: "microsoft" }, roleId);
    return { ok: true };
  } catch (e) {
    const message = problemText(e);
    if (/user_cancelled|popup_window_error/i.test(message)) return { ok: false, error: "" };
    return { ok: false, error: `Microsoft sign-in failed: ${message}` };
  }
}

/** Demo Entra user without a role picks one for the session (prototype only). */
export function signInMicrosoftWithRole(user: { id: string; name: string; email: string }, roleId: RoleId) {
  void completeSignIn({ ...user, source: "microsoft" }, roleId);
}

/** Step-up (API mode): ask for a code. Demo mode has no step-up provider (TD-858) and returns null. */
export async function startStepUp(): Promise<Result<{ challenge: ChallengeView | null }>> {
  if (!apiEnabled) return { ok: true, challenge: null };
  try {
    return { ok: true, challenge: saveApiChallenge(await authApi.stepUp()) };
  } catch (e) {
    return { ok: false, error: problemText(e) };
  }
}

/** Verify a step-up code. API mode keeps the returned step-up token for the retried decision. */
export async function verifyStepUp(challengeId: string | null, code: string): Promise<Result> {
  if (!apiEnabled || !challengeId) {
    // TD-858: demo mode accepts any complete code.
    if (code.length < getRule<number>("auth.otpLength")) return { ok: false, error: "Enter the full code." };
    publish("identity.step-up.verified", { module: "platform", subject: { type: "Session", id: useSession.getState().user?.id ?? "-" }, payload: { demo: true } });
    return { ok: true };
  }
  try {
    const t = await authApi.stepUpVerify(challengeId, code);
    storeStepUpToken(t.accessToken, t.expiresAt);
    dropApiChallenge(challengeId);
    publish("identity.step-up.verified", { module: "platform", subject: { type: "Session", id: useSession.getState().user?.id ?? "-" }, payload: {} });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: problemText(e) };
  }
}

/** Sign out (any mode): backend logout, clear tokens, publish `identity.user.signed-out`. */
export async function signOut(reason: "user" | "idle-timeout" = "user") {
  const { user } = useSession.getState();
  if (apiEnabled) {
    try {
      await authApi.logout();
    } catch {
      /* the session is ended locally regardless */
    }
    clearTokens();
  }
  if (user) publish("identity.user.signed-out", { module: "platform", subject: { type: "User", id: user.id, title: user.name }, payload: { reason } });
  await useSession.getState().signOut();
}
