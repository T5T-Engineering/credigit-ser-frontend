"use client";

/**
 * Email + password accounts and one-time codes (PROTOTYPE — no backend yet).
 *
 * - PRD §4 / §10.1: named individuals only, MFA on every login, admin-controlled users, immutable audit.
 *   So: password sign-in always needs a one-time code (second factor); self-registration is a *request for
 *   access* that a System Admin approves before the account works.
 * - Stored in this browser only. Passwords are kept as salted SHA-256 hashes (never plain text), but this is
 *   a stand-in: the backend must use a slow password hash (e.g. Argon2id), rate limiting, and deliver codes
 *   by email/SMS. In demo mode the code is shown on screen because no email is sent.
 * - BACKEND SEAM: replace the functions in this file with API calls; pages only call these functions.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { RoleId } from "../rbac/roles";
import { useDb, newId } from "../data/store";

/** Seeded demo users sign in with this password (shown on the sign-in page in demo mode). */
export const DEMO_PASSWORD = "Credigit@2026!";
export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
export const MAX_PASSWORD_ATTEMPTS = 5;

export type AccountStatus = "Pending verification" | "Pending approval" | "Active" | "Locked" | "Rejected";

export type Account = {
  email: string;
  name: string;
  /** Linked platform user once approved. */
  userId?: string;
  requestedRoleId?: RoleId;
  institution?: string;
  branch?: string;
  status: AccountStatus;
  salt: string;
  hash: string;
  createdAt: string;
  passwordChangedAt?: string;
  failedAttempts: number;
};

export type OtpPurpose = "signin" | "signup" | "reset";

export type Challenge = {
  id: string;
  email: string;
  purpose: OtpPurpose;
  code: string;
  expiresAt: number;
  attempts: number;
  /** Set once verified (reset flow uses it as a one-time token). */
  verifiedAt?: number;
};

type AccountsState = {
  accounts: Record<string, Account>;
  challenges: Record<string, Challenge>;
};

const useAccounts = create<AccountsState>()(
  persist(() => ({ accounts: {}, challenges: {} }), {
    name: "credigit.ser.accounts",
    storage: createJSONStorage(() => localStorage),
  }),
);

export { useAccounts };

// ---------------------------------------------------------------- helpers

const norm = (email: string) => email.trim().toLowerCase();

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sixDigits() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0]! % 1_000_000).padStart(6, "0");
}

/** "chinedu.okafor@bank.ng" → "ch•••@bank.ng" */
export function maskEmail(email: string) {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(5, user.length - 2)))}@${domain}`;
}

function audit(action: string, email: string, after?: string) {
  const user = useDb.getState().users.find((u) => norm(u.email) === norm(email));
  useDb.getState().log({
    actorId: user?.id ?? "anonymous",
    actorName: user?.name ?? email,
    roleId: user?.roleId ?? "account-officer",
    action,
    entityType: "Account",
    entityId: norm(email),
    after,
  });
}

/** Find an account; seeded platform users get an implicit account with the demo password. */
async function getAccount(email: string): Promise<Account | undefined> {
  const key = norm(email);
  const stored = useAccounts.getState().accounts[key];
  if (stored) return stored;
  const user = useDb.getState().users.find((u) => norm(u.email) === key);
  if (!user) return undefined;
  const salt = randomHex(16);
  const account: Account = {
    email: key,
    name: user.name,
    userId: user.id,
    status: user.status === "Suspended" ? "Locked" : "Active",
    salt,
    hash: await hashPassword(DEMO_PASSWORD, salt),
    createdAt: new Date().toISOString(),
    failedAttempts: 0,
  };
  saveAccount(account);
  return account;
}

function saveAccount(account: Account) {
  useAccounts.setState((s) => ({ accounts: { ...s.accounts, [account.email]: account } }));
}

function createChallenge(email: string, purpose: OtpPurpose): Challenge {
  const challenge: Challenge = { id: newId("OTP"), email: norm(email), purpose, code: sixDigits(), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 };
  useAccounts.setState((s) => ({ challenges: { ...s.challenges, [challenge.id]: challenge } }));
  return challenge;
}

function removeChallenge(id: string) {
  useAccounts.setState((s) => ({ challenges: Object.fromEntries(Object.entries(s.challenges).filter(([key]) => key !== id)) }));
}

export function getChallenge(id: string | null | undefined): Challenge | undefined {
  return id ? useAccounts.getState().challenges[id] : undefined;
}

// ---------------------------------------------------------------- flows

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Step 1 of password sign-in. On success a one-time code is required (MFA). */
export async function signInWithPassword(email: string, password: string): Promise<Result<{ challengeId: string }>> {
  const generic = "Email or password is incorrect.";
  const account = await getAccount(email);
  if (!account) return { ok: false, error: generic };
  if (account.status === "Locked") return { ok: false, error: "This account is locked after too many attempts. Reset your password or contact your System Admin." };
  if (account.status === "Pending verification") return { ok: false, error: "Verify your email first — check for the code we sent when you registered." };
  if (account.status === "Pending approval") return { ok: false, error: "Your access request is waiting for approval by your institution's System Admin." };
  if (account.status === "Rejected") return { ok: false, error: "Your access request was not approved. Contact your System Admin." };
  const hash = await hashPassword(password, account.salt);
  if (hash !== account.hash) {
    const failedAttempts = account.failedAttempts + 1;
    saveAccount({ ...account, failedAttempts, status: failedAttempts >= MAX_PASSWORD_ATTEMPTS ? "Locked" : account.status });
    audit("Failed password sign-in", email, `${failedAttempts} of ${MAX_PASSWORD_ATTEMPTS}`);
    return { ok: false, error: failedAttempts >= MAX_PASSWORD_ATTEMPTS ? "Too many attempts. The account is now locked — reset your password to unlock it." : generic };
  }
  saveAccount({ ...account, failedAttempts: 0 });
  return { ok: true, challengeId: createChallenge(email, "signin").id };
}

export type RegistrationInput = { name: string; email: string; password: string; institution: string; branch: string; requestedRoleId: RoleId };

/** Request access. Email is verified by one-time code, then a System Admin approves (PRD §4: admin-controlled users). */
export async function register(input: RegistrationInput): Promise<Result<{ challengeId: string }>> {
  const key = norm(input.email);
  const existing = useAccounts.getState().accounts[key] ?? (useDb.getState().users.some((u) => norm(u.email) === key) ? true : undefined);
  if (existing) return { ok: false, error: "An account with this email already exists. Sign in or reset your password." };
  const salt = randomHex(16);
  saveAccount({
    email: key,
    name: input.name.trim(),
    requestedRoleId: input.requestedRoleId,
    institution: input.institution.trim(),
    branch: input.branch,
    status: "Pending verification",
    salt,
    hash: await hashPassword(input.password, salt),
    createdAt: new Date().toISOString(),
    failedAttempts: 0,
  });
  audit("Requested access (self-registration)", key, input.requestedRoleId);
  return { ok: true, challengeId: createChallenge(key, "signup").id };
}

/** Always "succeeds" to avoid revealing which emails exist; a code is only created for real accounts. */
export async function requestPasswordReset(email: string): Promise<{ challengeId: string | null }> {
  const account = await getAccount(email);
  if (!account || account.status === "Pending verification" || account.status === "Rejected") return { challengeId: null };
  audit("Requested password reset", email);
  return { challengeId: createChallenge(email, "reset").id };
}

/** Send a fresh code for an existing challenge (invalidates the old code). */
export function resendCode(challengeId: string): Challenge | undefined {
  const c = getChallenge(challengeId);
  if (!c) return undefined;
  const fresh = { ...c, code: sixDigits(), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 };
  useAccounts.setState((s) => ({ challenges: { ...s.challenges, [c.id]: fresh } }));
  return fresh;
}

export type VerifyOutcome =
  | { ok: true; purpose: "signin"; account: Account }
  | { ok: true; purpose: "signup"; account: Account }
  | { ok: true; purpose: "reset"; token: string }
  | { ok: false; error: string; expired?: boolean };

export async function verifyCode(challengeId: string, code: string): Promise<VerifyOutcome> {
  const c = getChallenge(challengeId);
  if (!c) return { ok: false, error: "This code request has expired. Start again.", expired: true };
  if (Date.now() > c.expiresAt) return { ok: false, error: "This code has expired. Request a new one.", expired: true };
  if (c.attempts >= MAX_OTP_ATTEMPTS) return { ok: false, error: "Too many wrong codes. Request a new one.", expired: true };
  if (code !== c.code) {
    useAccounts.setState((s) => ({ challenges: { ...s.challenges, [c.id]: { ...c, attempts: c.attempts + 1 } } }));
    return { ok: false, error: `That code isn't right. ${MAX_OTP_ATTEMPTS - c.attempts - 1} attempts left.` };
  }
  const account = await getAccount(c.email);
  if (!account) return { ok: false, error: "Account not found.", expired: true };
  if (c.purpose === "reset") {
    useAccounts.setState((s) => ({ challenges: { ...s.challenges, [c.id]: { ...c, verifiedAt: Date.now() } } }));
    return { ok: true, purpose: "reset", token: c.id };
  }
  removeChallenge(c.id);
  if (c.purpose === "signup") {
    const updated = { ...account, status: "Pending approval" as const };
    saveAccount(updated);
    audit("Verified email for access request", c.email);
    return { ok: true, purpose: "signup", account: updated };
  }
  return { ok: true, purpose: "signin", account };
}

/** Complete a reset with the verified challenge token. Unlocks a locked account. */
export async function resetPassword(token: string, password: string): Promise<Result> {
  const c = getChallenge(token);
  if (!c || c.purpose !== "reset" || !c.verifiedAt || Date.now() > c.expiresAt) return { ok: false, error: "This reset link has expired. Request a new code." };
  const account = await getAccount(c.email);
  if (!account) return { ok: false, error: "Account not found." };
  const salt = randomHex(16);
  saveAccount({ ...account, salt, hash: await hashPassword(password, salt), passwordChangedAt: new Date().toISOString(), failedAttempts: 0, status: account.status === "Locked" ? "Active" : account.status });
  removeChallenge(c.id);
  audit("Reset password", c.email);
  return { ok: true };
}

/** Change password while signed in (requires the current password). */
export async function changePassword(email: string, current: string, next: string): Promise<Result> {
  const account = await getAccount(email);
  if (!account) return { ok: false, error: "No password is set for this account." };
  if ((await hashPassword(current, account.salt)) !== account.hash) {
    audit("Failed password change (wrong current password)", email);
    return { ok: false, error: "Your current password is incorrect." };
  }
  if (current === next) return { ok: false, error: "Choose a password you haven't used for this account." };
  const salt = randomHex(16);
  saveAccount({ ...account, salt, hash: await hashPassword(next, salt), passwordChangedAt: new Date().toISOString() });
  audit("Changed password", email);
  return { ok: true };
}

/** Admin: approve or reject a self-registration. Approval creates the platform user with the given role. */
export function decideAccessRequest(email: string, decision: "approve" | "reject", roleId?: RoleId) {
  const key = norm(email);
  const account = useAccounts.getState().accounts[key];
  if (!account || account.status !== "Pending approval") return;
  if (decision === "reject") {
    saveAccount({ ...account, status: "Rejected" });
    audit("Rejected access request", key);
    return;
  }
  const role = roleId ?? account.requestedRoleId ?? "account-officer";
  const userId = newId("USR");
  useDb.getState().upsert("users", { id: userId, name: account.name, email: key, roleId: role, branch: account.branch ?? "Head office", status: "Active", mfa: true });
  saveAccount({ ...account, status: "Active", userId });
  audit("Approved access request", key, role);
}

/** Pending access requests (for Admin → Users). */
export function usePendingAccessRequests() {
  const accounts = useAccounts((s) => s.accounts);
  return Object.values(accounts).filter((a) => a.status === "Pending approval");
}

/** Look up the role and platform user for a signed-in account. */
export function platformUserFor(account: Account) {
  const db = useDb.getState();
  return db.users.find((u) => u.id === account.userId) ?? db.users.find((u) => norm(u.email) === account.email);
}
