"use client";

/**
 * Demo-mode accounts and one-time codes (no backend). API mode uses `src/lib/iam/api.ts` instead — pages call the
 * facade in `./service.ts`, never this file directly.
 *
 * - PRD §4 / §10.1: named individuals only, MFA on every login, admin-controlled users, immutable audit.
 *   Password sign-in always needs a one-time code; self-registration is a request for access approved in Operations.
 * - Stored in this browser only. Passwords are salted SHA-256 hashes — a prototype stand-in (TD-968): the backend uses a
 *   slow KDF, rate limiting and e-mailed codes. In demo mode the code is shown on screen because no e-mail is sent.
 * - Demo credentials (invariant 7, AUTH-FR-18): no password literal ships in the bundle. Seeded users get the optional
 *   `NEXT_PUBLIC_DEMO_PASSWORD` (environment, demo deployments only); without it they have no password until they use
 *   "Set or reset your password" (one-time code).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PasswordRule } from "@credigit/web-ui";
import { backendAuthEnabled, backendChangePassword, backendForgotPassword, backendRegister, backendResetPassword, backendSignIn } from "./backend-auth";
import type { RoleId } from "../rbac/roles";
import { roleById } from "../rbac/roles";
import { useDb, newId } from "../data/store";
import { publish } from "../platform/events";
import { runHooks } from "../platform/hooks";
import { notify } from "../platform/notifications";
import { submitOperation } from "../platform/operations";
import { getRule } from "../platform/rules";

/** Optional demo password for seeded users (environment config, demo deployments only). */
export const demoPassword = (process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "").trim() || null;

/** Limits come from business rules (Operations → Business rules). */
const otpTtlMs = () => getRule<number>("auth.otpTtlMinutes") * 60_000;
const maxOtpAttempts = () => getRule<number>("auth.otpMaxAttempts");
const maxPasswordAttempts = () => getRule<number>("auth.passwordMaxAttempts");
const otpLength = () => getRule<number>("auth.otpLength");

/** Password policy (min length + "mixed" = upper, lower, digit, symbol) as checklist rules. */
export function passwordRules(policy: { minLength: number; requireMixed: boolean }): PasswordRule[] {
  const list: PasswordRule[] = [{ id: "length", label: `At least ${policy.minLength} characters`, test: (v) => v.length >= policy.minLength }];
  if (policy.requireMixed) {
    list.push(
      { id: "upper", label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
      { id: "lower", label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
      { id: "number", label: "A number", test: (v) => /\d/.test(v) },
      { id: "symbol", label: "A symbol (e.g. ! @ # ?)", test: (v) => /[^A-Za-z0-9]/.test(v) },
    );
  }
  return list;
}

/** Demo password policy from business rules. */
export function passwordPolicy(): PasswordRule[] {
  return passwordRules({ minLength: getRule<number>("auth.passwordMinLength"), requireMixed: getRule<boolean>("auth.passwordRequireMixed") });
}

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
  /** Absent = no password set yet (seeded demo user without NEXT_PUBLIC_DEMO_PASSWORD, or an invitee). */
  hash?: string;
  createdAt: string;
  passwordChangedAt?: string;
  failedAttempts: number;
  lockedAt?: string;
  lockedBy?: string;
  lockReason?: string;
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

function randomCode() {
  const digits = otpLength();
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0]! % 10 ** digits).padStart(digits, "0");
}

/** "chinedu.okafor@bank.ng" → "ch•••@bank.ng" */
export function maskEmail(email: string) {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(5, user.length - 2)))}@${domain}`;
}

const userByEmail = (email: string) => useDb.getState().users.find((u) => norm(u.email) === norm(email));

function audit(action: string, email: string, before?: string, after?: string, actor?: { id: string; name: string; roleId: RoleId }) {
  const user = userByEmail(email);
  useDb.getState().log({
    actorId: actor?.id ?? user?.id ?? "anonymous",
    actorName: actor?.name ?? user?.name ?? email,
    // Pre-sign-in actions have no role; the account's own role (or none) is recorded.
    roleId: actor?.roleId ?? user?.roleId ?? ("" as RoleId),
    action,
    entityType: "Account",
    entityId: norm(email),
    before,
    after,
  });
}

const subjectFor = (email: string, name?: string) => {
  const u = userByEmail(email);
  return { type: "Account", id: norm(email), title: name ?? u?.name, href: u ? `/admin?user=${u.id}` : undefined };
};

/** Find an account; seeded platform users get an implicit account (demo password from env, or none). */
async function getAccount(email: string): Promise<Account | undefined> {
  const key = norm(email);
  const stored = useAccounts.getState().accounts[key];
  if (stored) return stored;
  const user = userByEmail(key);
  if (!user) return undefined;
  const salt = randomHex(16);
  const account: Account = {
    email: key,
    name: user.name,
    userId: user.id,
    status: "Active",
    salt,
    hash: demoPassword ? await hashPassword(demoPassword, salt) : undefined,
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
  const challenge: Challenge = { id: newId("OTP"), email: norm(email), purpose, code: randomCode(), expiresAt: Date.now() + otpTtlMs(), attempts: 0 };
  useAccounts.setState((s) => ({ challenges: { ...s.challenges, [challenge.id]: challenge } }));
  return challenge;
}

function removeChallenge(id: string) {
  useAccounts.setState((s) => ({ challenges: Object.fromEntries(Object.entries(s.challenges).filter(([key]) => key !== id)) }));
}

export function getChallenge(id: string | null | undefined): Challenge | undefined {
  return id ? useAccounts.getState().challenges[id] : undefined;
}

function lockNotify(account: Account, by: string, reason: string) {
  const u = userByEmail(account.email);
  publish("identity.user.locked", { module: "platform", subject: subjectFor(account.email, account.name), payload: { by, reason } });
  notify({ templateId: "auth.account-locked", toUserIds: u ? [u.id] : [], toRoles: ["system-admin"], href: u ? `/admin?user=${u.id}` : "/admin", data: { name: account.name, email: account.email, reason, by } });
}

// ---------------------------------------------------------------- flows

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Step 1 of password sign-in. On success a one-time code is required (MFA). */
export async function signInWithPassword(email: string, password: string): Promise<Result<{ challengeId: string }>> {
  if (backendAuthEnabled) return backendSignIn(email, password);
  const generic = "Email or password is incorrect.";
  const hook = await runHooks("identity.login.before", { email: norm(email), method: "password" });
  if (!hook.ok) return { ok: false, error: `Sign-in blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const account = await getAccount(email);
  if (!account) return { ok: false, error: generic };
  if (account.status === "Locked") return { ok: false, error: "This account is locked. Set or reset your password to unlock it, or contact your System Admin." };
  if (account.status === "Pending verification") return { ok: false, error: "Verify your email first — check for the code we sent when you registered." };
  if (account.status === "Pending approval") return { ok: false, error: "Your access request is waiting for approval by your institution's System Admin." };
  if (account.status === "Rejected") return { ok: false, error: "Your access request was not approved. Contact your System Admin." };
  const user = account.userId ? useDb.getState().users.find((u) => u.id === account.userId) : userByEmail(account.email);
  if (user?.status === "Suspended") return { ok: false, error: "This account is deactivated. Contact your System Admin." };
  const matches = account.hash ? (await hashPassword(password, account.salt)) === account.hash : false;
  if (!matches) {
    const failedAttempts = account.failedAttempts + 1;
    const lock = failedAttempts >= maxPasswordAttempts();
    const next: Account = lock
      ? { ...account, failedAttempts, status: "Locked", lockedAt: new Date().toISOString(), lockedBy: "System", lockReason: `${failedAttempts} wrong passwords` }
      : { ...account, failedAttempts };
    saveAccount(next);
    audit("Failed password sign-in", email, undefined, `${failedAttempts} of ${maxPasswordAttempts()}`);
    publish("identity.user.sign-in-failed", { module: "platform", subject: subjectFor(email, account.name), payload: { attempts: failedAttempts } });
    if (lock) {
      audit("Account locked (too many wrong passwords)", email, "Active", "Locked");
      lockNotify(next, "System", `${failedAttempts} wrong passwords`);
    }
    return { ok: false, error: lock ? "Too many attempts. The account is now locked — set or reset your password to unlock it." : generic };
  }
  saveAccount({ ...account, failedAttempts: 0 });
  return { ok: true, challengeId: createChallenge(email, "signin").id };
}

export type RegistrationInput = { name: string; email: string; password: string; institution: string; branch: string; requestedRoleId: RoleId };

/** Request access. Email is verified by one-time code, then a System Admin approves (PRD §4: admin-controlled users). */
export async function register(input: RegistrationInput): Promise<Result<{ challengeId: string }>> {
  if (backendAuthEnabled) return backendRegister(input);
  const key = norm(input.email);
  const existing = useAccounts.getState().accounts[key] ?? (userByEmail(key) ? true : undefined);
  if (existing) return { ok: false, error: "An account with this email already exists. Sign in or set or reset your password." };
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
  audit("Requested access (self-registration)", key, undefined, input.requestedRoleId);
  publish("identity.registration.started", { module: "platform", subject: subjectFor(key, input.name), payload: { roleId: input.requestedRoleId } });
  return { ok: true, challengeId: createChallenge(key, "signup").id };
}

/** Always "succeeds" to avoid revealing which emails exist; a code is only created for real accounts. */
export async function requestPasswordReset(email: string): Promise<{ challengeId: string | null }> {
  if (backendAuthEnabled) return backendForgotPassword(email);
  const account = await getAccount(email);
  if (!account || account.status === "Pending verification" || account.status === "Rejected") return { challengeId: null };
  audit("Requested password reset", email);
  return { challengeId: createChallenge(email, "reset").id };
}

/** Send a fresh code for an existing challenge (invalidates the old code). */
export function resendCode(challengeId: string): Challenge | undefined {
  const c = getChallenge(challengeId);
  if (!c) return undefined;
  const fresh = { ...c, code: randomCode(), expiresAt: Date.now() + otpTtlMs(), attempts: 0 };
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
  if (c.attempts >= maxOtpAttempts()) return { ok: false, error: "Too many wrong codes. Request a new one.", expired: true };
  if (code !== c.code) {
    useAccounts.setState((s) => ({ challenges: { ...s.challenges, [c.id]: { ...c, attempts: c.attempts + 1 } } }));
    return { ok: false, error: `That code isn't right. ${maxOtpAttempts() - c.attempts - 1} attempts left.` };
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
    audit("Verified email for access request", c.email, "Pending verification", "Pending approval");
    const roleId = updated.requestedRoleId ?? "account-officer";
    const roleName = roleById[roleId]?.name ?? roleId;
    void submitOperation("access.request", {
      title: `Access request — ${updated.name} (${roleName})`,
      subject: { type: "Account", id: updated.email, title: updated.name, href: "/admin" },
      payload: { email: updated.email, name: updated.name, roleId },
      summary: [
        { label: "Name", value: updated.name },
        { label: "Email", value: updated.email },
        { label: "Institution / branch", value: `${updated.institution ?? ""} · ${updated.branch ?? ""}` },
        { label: "Requested role", value: roleName },
      ],
    });
    publish("auth.access.requested", { module: "platform", subject: { type: "Account", id: updated.email, title: updated.name }, payload: { roleId } });
    notify({ templateId: "auth.access-requested", toRoles: ["system-admin"], href: "/operations", data: { name: updated.name, email: updated.email, institution: updated.institution ?? "", branch: updated.branch ?? "", role: roleName } });
    return { ok: true, purpose: "signup", account: updated };
  }
  return { ok: true, purpose: "signin", account };
}

/** Complete a reset with the verified challenge token. Unlocks a locked account (also sets a first password). */
export async function resetPassword(token: string, password: string): Promise<Result> {
  if (backendAuthEnabled) return backendResetPassword(token, password);
  const c = getChallenge(token);
  if (!c || c.purpose !== "reset" || !c.verifiedAt || Date.now() > c.expiresAt) return { ok: false, error: "This reset link has expired. Request a new code." };
  const account = await getAccount(c.email);
  if (!account) return { ok: false, error: "Account not found." };
  const salt = randomHex(16);
  const unlock = account.status === "Locked";
  saveAccount({ ...account, salt, hash: await hashPassword(password, salt), passwordChangedAt: new Date().toISOString(), failedAttempts: 0, status: unlock ? "Active" : account.status, lockedAt: undefined, lockedBy: undefined, lockReason: undefined });
  removeChallenge(c.id);
  audit(account.hash ? "Reset password" : "Set first password", c.email, unlock ? "Locked" : undefined, unlock ? "Active" : undefined);
  publish("identity.password.reset", { module: "platform", subject: subjectFor(c.email, account.name), payload: { unlocked: unlock } });
  const u = userByEmail(c.email);
  if (u) notify({ templateId: "auth.password-changed", toUserIds: [u.id], href: "/settings/password", data: { email: c.email, when: new Date().toUTCString() } });
  return { ok: true };
}

/** Change password while signed in (requires the current password). */
export async function changePassword(email: string, current: string, next: string): Promise<Result> {
  if (backendAuthEnabled) return backendChangePassword(current, next);
  const account = await getAccount(email);
  if (!account?.hash) return { ok: false, error: "No password is set for this account yet. Use Set or reset your password on the sign-in page." };
  if ((await hashPassword(current, account.salt)) !== account.hash) {
    audit("Failed password change (wrong current password)", email);
    return { ok: false, error: "Your current password is incorrect." };
  }
  if (current === next) return { ok: false, error: "Choose a password you haven't used for this account." };
  const salt = randomHex(16);
  saveAccount({ ...account, salt, hash: await hashPassword(next, salt), passwordChangedAt: new Date().toISOString() });
  audit("Changed password", email);
  publish("identity.password.changed", { module: "platform", subject: subjectFor(email, account.name), payload: {} });
  const u = userByEmail(email);
  if (u) notify({ templateId: "auth.password-changed", toUserIds: [u.id], href: "/settings/password", data: { email: norm(email), when: new Date().toUTCString() } });
  return { ok: true };
}

/**
 * Called only by the `access.request` operation (approve on final approval, reject on rejection).
 * Approval creates the platform user with the confirmed role.
 */
export function decideAccessRequest(email: string, decision: "approve" | "reject", roleId?: RoleId, by = "System Admin") {
  const key = norm(email);
  const account = useAccounts.getState().accounts[key];
  if (!account || account.status !== "Pending approval") return;
  const role = roleId ?? account.requestedRoleId ?? "account-officer";
  const roleName = roleById[role]?.name ?? role;
  if (decision === "reject") {
    saveAccount({ ...account, status: "Rejected" });
    audit("Rejected access request", key, "Pending approval", "Rejected");
  } else {
    const userId = newId("USR");
    useDb.getState().upsert("users", { id: userId, name: account.name, email: key, roleId: role, branch: account.branch ?? "Head office", status: "Active", mfa: true });
    saveAccount({ ...account, status: "Active", userId });
    audit("Approved access request", key, "Pending approval", role);
  }
  const decided = decision === "approve" ? "approved" : "rejected";
  const u = userByEmail(key);
  publish("identity.access-request.decided", { module: "platform", subject: subjectFor(key, account.name), payload: { decision: decided, roleId: role } });
  notify({ templateId: "auth.access-request-decided", toUserIds: u ? [u.id] : [], toRoles: ["system-admin"], href: u ? `/admin?user=${u.id}` : "/admin", data: { name: account.name, email: key, decision: decided, role: roleName, by } });
}

/** Lock state of an account (demo); seeded users without a stored account are unlocked. */
export function useAccountLock(email: string | undefined): Pick<Account, "status" | "lockedAt" | "lockedBy" | "lockReason"> | undefined {
  return useAccounts((s) => (email ? s.accounts[norm(email)] : undefined));
}

/**
 * Admin: lock a user's sign-in immediately (security containment, AUTH-OQ2). Reason required; audited, evented, notified.
 * Callers check the permission and run the `admin.user.change` hooks.
 */
export async function lockAccount(email: string, reason: string, actor: { id: string; name: string; roleId: RoleId }): Promise<Result> {
  const account = await getAccount(email);
  if (!account) return { ok: false, error: "Account not found." };
  if (account.status === "Locked") return { ok: false, error: "This account is already locked." };
  if (account.status !== "Active") return { ok: false, error: `Only active accounts can be locked (this one is ${account.status.toLowerCase()}).` };
  const next: Account = { ...account, status: "Locked", lockedAt: new Date().toISOString(), lockedBy: actor.name, lockReason: reason };
  saveAccount(next);
  audit("Locked account", email, "Active", `Locked — ${reason}`, actor);
  lockNotify(next, actor.name, reason);
  return { ok: true };
}

/** Admin: unlock a locked account (clears failed attempts). A one-time code is still required at sign-in. */
export async function unlockAccount(email: string, reason: string, actor: { id: string; name: string; roleId: RoleId }): Promise<Result> {
  const account = await getAccount(email);
  if (!account) return { ok: false, error: "Account not found." };
  if (account.status !== "Locked") return { ok: false, error: "This account isn't locked." };
  saveAccount({ ...account, status: "Active", failedAttempts: 0, lockedAt: undefined, lockedBy: undefined, lockReason: undefined });
  audit("Unlocked account", email, `Locked — ${account.lockReason ?? ""}`, `Active — ${reason}`, actor);
  const u = userByEmail(email);
  publish("identity.user.unlocked", { module: "platform", subject: subjectFor(email, account.name), payload: { by: actor.name, reason } });
  notify({ templateId: "auth.account-unlocked", toUserIds: u ? [u.id] : [], toRoles: ["system-admin"], href: u ? `/admin?user=${u.id}` : "/admin", data: { name: account.name, email: account.email, reason, by: actor.name } });
  return { ok: true };
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
