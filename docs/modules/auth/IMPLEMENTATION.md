# Authentication (auth) — implementation

| | |
|---|---|
| Status | Prototype (browser-side accounts; Entra ID SSO built, env-gated) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
Pages in `src/modules/auth` are thin forms over `src/lib/auth`: `accounts.ts` (account store `useAccounts`, password hashing, OTP challenges, registration, verification, reset/change, access-request decision), `msal.ts` (Entra ID via `@azure/msal-browser`), `session.ts` (session store, `useCan`, sign-in/out audit). `components/auth-guard.tsx` protects `(app)` routes and provides demo sign-in; `components/app-frame.tsx` runs the idle timer. Access requests are core `access.request` operations whose `apply` / `onReject` call `decideAccessRequest`.

BACKEND SEAM: replace `accounts.ts` with Identity & Access API calls; keep MSAL.

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/modules/auth/login-page.tsx` | Microsoft / email + password / demo role sign-in |
| `src/modules/auth/register-page.tsx` | Self-registration form |
| `src/modules/auth/verify-page.tsx` | One-time code entry (sign-in, sign-up, reset) |
| `src/modules/auth/password-pages.tsx` | `ForgotPasswordPage`, `ResetPasswordPage`, `ChangePasswordPage` |
| `src/modules/auth/auth-shell.tsx` | Auth page layout wrapper |
| `src/lib/auth/accounts.ts` | Accounts, challenges, policy, audit/notify/publish |
| `src/lib/auth/msal.ts` | MSAL config and sign-in |
| `src/lib/data/workspace-storage.ts` | Database-backed persisted stores (ADR-0015): load / save through `/workspace-data`, development identity for browser sign-ins (TD-953); `onSignedIn` reloads once |
| `src/lib/auth/backend-auth.ts` | Backend email + password sign-in, registration, reset, change; tab-scoped challenges (AUTH-FR-15) |
| `src/modules/auth/backend-verify-page.tsx` | Code screen for backend challenges (`/verify` picks it when the backend is configured) |
| `src/lib/auth/backend-sso.ts` | Backend Microsoft sign-in (start → callback → token), backend tokens, `/identity/me`, backend logout |
| `src/modules/auth/microsoft-callback-page.tsx` | `/callback/`: finishes the backend Microsoft sign-in |
| `src/lib/auth/session.ts` | Session store, `useRole`, `useCan`, `useHydrated` |
| `src/components/auth-guard.tsx` | Route guard, `demoSignIn`, `?demoRole=` |
| `src/components/app-frame.tsx` | Idle-timeout warning and sign-out |
| `src/lib/platform/core.ts` | `auth.*` / `session.*` rules, `access.request`, auth templates and events |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/login` | `LoginPage` | — (public) |
| `/register` | `RegisterPage` | link from login |
| `/verify?challenge=<id>` | `VerifyPage` | — |
| `/callback?code=&state=` | `MicrosoftCallbackPage` (backend SSO; Entra redirect URI `<site>/callback/`) | — |
| `/forgot-password` | `ForgotPasswordPage` | link from login |
| `/reset-password` | `ResetPasswordPage` | — |
| `/settings/password` | `ChangePasswordPage` | Administration → Settings → Password |
| `/` | redirect to dashboard or login | — |

Public API (`accounts.ts`): `signInWithPassword`, `register`, `verifyCode`, `resendCode`, `requestPasswordReset`, `resetPassword`, `changePassword`, `decideAccessRequest`, `usePendingAccessRequests`, `passwordPolicy`, `maskEmail`.

## 4. Data model
| Entity / store | Key fields |
|---|---|
| `Account` (`useAccounts`, localStorage) | email, name, userId, status (Pending verification / Pending approval / Active / Locked / Rejected), salt, hash, failedAttempts, institution, branch, requestedRoleId, createdAt, passwordChangedAt |
| `Challenge` | id, email, purpose (signin / signup / reset), code, expiresAt, attempts |
| `SessionUser` (`credigit.ser.session`, sessionStorage) | id, name, email, source (microsoft / password / demo), roleId |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `auth.otpTtlMinutes`, `auth.otpMaxAttempts` | `accounts.ts`; `verify-page.tsx` copy |
| `auth.passwordMaxAttempts` | `accounts.ts`; `password-pages.tsx` copy |
| `auth.passwordMinLength`, `auth.passwordRequireMixed` | `accounts.ts` `passwordPolicy()` |
| `session.idleTimeoutMinutes`, `session.warningSeconds`, `session.idleTimeoutMinutes.<role>` | `app-frame.tsx` (via admin `roleIdleTimeoutMinutes`) |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| — (none) | Public routes need no permission; `(app)` routes guarded by session presence (`auth-guard.tsx`) and role → module map. Baseline `identity.*` keys not checked. |

## 7. Workflows, notifications, events, hooks wired
| Item | Code location |
|---|---|
| `access.request` | registered `core.ts`; submitted in `accounts.ts` `verifyCode` (signup) |
| `auth.access-requested` | `notify` in `accounts.ts` `verifyCode` |
| `auth.password-changed` | `notify` in `resetPassword`, `changePassword` |
| `auth.access.requested`, `auth.password.changed` | `publish` in `accounts.ts` |
| Audit | `accounts.ts` `audit()` (failed sign-in, registration, verification, reset, change, access decision); `session.ts` (sign-in, demo role switch, sign-out) |

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/smoke.spec.ts` | Login page shows Microsoft, email and demo roles; demo sign-in |
| `e2e/platform/auth-password.spec.ts` | Password + OTP sign-in; lockout after N wrong passwords; reset unlocks |
| `e2e/platform/registration.spec.ts` | Request access → verify → System Admin approves → sign in with approved role |
| `e2e/platform/change-password.spec.ts` | Change password, sign in with new one |
| `e2e/platform/session-timeout.spec.ts` | Idle warning, stay signed in, auto sign-out; sign-out from `?demoRole` link |
| Unit tests | None |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status |
|---|---|---|---|
| AUTH-FR-01 | seeded named users; registration | registration.spec | Done |
| AUTH-FR-02 | MSAL (Entra MFA); OTP step | auth-password.spec | Partial (OTP shown on screen; no TOTP enrolment) |
| AUTH-FR-03 | `msal.ts`, `login-page.tsx` | — | Done (env-gated) |
| AUTH-FR-04 | `signInWithPassword` + `verifyCode` | auth-password.spec | Done |
| AUTH-FR-05 | `signInWithPassword`, `resetPassword` | auth-password.spec | Done |
| AUTH-FR-06 | `verifyCode` | — | Done |
| AUTH-FR-07 | `register-page.tsx`, `access.request` | registration.spec | Done |
| AUTH-FR-08 | `passwordPolicy()` | — | Done |
| AUTH-FR-09 | `password-pages.tsx` | change-password.spec | Done |
| AUTH-FR-10 | `app-frame.tsx` | session-timeout.spec | Done |
| AUTH-FR-11 | — | — | Missing |
| AUTH-FR-12 | `audit()`, `session.ts` | — | Partial (anonymous actions attributed to `account-officer` role) |
| AUTH-FR-13 | `auth-guard.tsx` | smoke.spec | Done |
| AUTH-FR-14 | `backend-sso.ts`, `microsoft-callback-page.tsx`, `login-page.tsx` | — (needs a live tenant; manual) | Done (env-gated) |

## 10. Gaps against the invariants
- Inv. 7: shared demo password `DEMO_PASSWORD` is a literal in `accounts.ts` (demo credential, shipped to the client bundle).
- Inv. 9 (extensible): no `auth.*` hook points (e.g. `auth.sign-in.before` for policy veto); `auth.session.started` is declared but never published.
- Inv. 9 (notified): applicant not notified when access is approved or rejected; no notification on account lockout.
- Inv. 9 (audit): pre-sign-in actions are audited with a fallback role `account-officer`; audit log is browser-side, not immutable.
- Inv. 12: Baseline / `identity.password.change` / `identity.step-up.verify` keys not checked.
- PRD §4.2: device binding and IP allow-list rules exist but are not enforced at sign-in.
- Security: password hashing (single SHA-256) and accounts in localStorage are prototype-only.
- Inv. 9 (connector-ready): Entra ID and email/OTP delivery not recorded in `docs/integration-points.md` (file doesn't exist).
- Inv. 8: registration branch list comes from seed (`branches`), not tenant configuration.

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-952 | Backend SSO tokens kept in `sessionStorage`; only the Microsoft sign-in uses the backend — the rest of the app still reads browser data |
| TD-858 | Step-up OTP accepts any 6 digits (used by approvals; auth has no real step-up provider) |
| — | No TD entry yet for `DEMO_PASSWORD`, browser-side accounts, or the unpublished `auth.session.started` event |
