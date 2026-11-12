# Authentication (auth) — requirements

| | |
|---|---|
| Module | `src/modules/auth` (+ `src/lib/auth/*`); no nav entry (public routes) |
| Repo | credigit-ser-frontend |
| PRD | §4 (intro), §4.2, §10.1 |
| Owner (business) | System Admin (approves access); every user (signs in) |
| Counterpart | [IdentityAccess](../../../../credigit-ser-core-backend/docs/modules/IdentityAccess/REQUIREMENTS.md) |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Sign-in, self-registration with email verification, password reset and change. Every login is a named individual with MFA (PRD §4, §10.1); production sign-in is Microsoft Entra ID SSO, with email + password + one-time code and (prototype only) demo role access.

- In scope: `/login` (Microsoft SSO, email + password + OTP, demo access), `/register` → `/verify` (access request), `/forgot-password`, `/reset-password`, Settings → Password (change), account lockout, idle sign-out (app shell, rules from admin/core).
- Out of scope: user provisioning and role assignment (admin), approving access (Operations `access.request`), step-up authentication for approvals (core / disbursement), device binding and IP allow-list enforcement (not built).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| Unauthenticated person | Register, verify email, request access, reset password | `identity.access-requests.submit`, `identity.invitations.accept` (Baseline) |
| Any signed-in user | Sign out, change password, view own identity | `identity.session.sign-out`, `identity.password.change`, `identity.me.view` |
| Approver of a high-value action | Step-up verification | `identity.step-up.verify` |
| System Admin | Approve / reject access requests (in Operations) | `identity.access-requests.review`, `operations.items.decide` |

## 3. Functional requirements
| ID | Requirement | Source |
|---|---|---|
| AUTH-FR-01 | Every login is tied to a named individual; no shared logins. | PRD §4 |
| AUTH-FR-02 | MFA on all logins (Entra ID MFA; email one-time code for password sign-in). | PRD §4, §10.1 |
| AUTH-FR-03 | Sign in with Microsoft Entra ID; role from ID-token app roles or the provisioned user. | Assumption (PRD names MFA, not the IdP) |
| AUTH-FR-04 | Sign in with email + password + one-time code. | Assumption |
| AUTH-FR-05 | Lock the account after `auth.passwordMaxAttempts` wrong passwords; reset unlocks. | Assumption (demo default) |
| AUTH-FR-06 | One-time codes expire after `auth.otpTtlMinutes` and allow `auth.otpMaxAttempts` tries. | Assumption (demo default) |
| AUTH-FR-07 | Self-registration (name, work email, institution, branch, requested role, password) → email verification → access request approved by System Admin, who confirms the role. | PRD §4 (admin-controlled named users) |
| AUTH-FR-08 | Password policy: minimum length, mixed character types. | Assumption (rules `auth.password*`) |
| AUTH-FR-09 | Forgot / reset password via one-time code; change password while signed in; notify the user. | Assumption |
| AUTH-FR-10 | Idle-session sign-out with warning, per-role timeout. | PRD §4.2 |
| AUTH-FR-11 | Device binding and IP allow-listing per role. | PRD §4.2 — **not enforced** |
| AUTH-FR-12 | Audit every sign-in, sign-out, failure, registration, verification, reset, change. | PRD §4, §10.1 |
| AUTH-FR-13 | Demo access by role (prototype only; disable with `NEXT_PUBLIC_DEMO_ACCESS=false`). | Prototype convention |
| AUTH-FR-14 | When the backend is configured (`NEXT_PUBLIC_API_BASE_URL`), "Sign in with Microsoft" uses the backend server-side code flow: `POST /auth/microsoft/start` → Microsoft → `/callback/` → `POST /auth/microsoft/token`; the role comes from the backend directory (`GET /identity/me`), not from the browser. | User instruction 2026-11-12; backend ADR-0013 amendment 1 |
| AUTH-FR-15 | With the backend configured, email + password sign-in, registration, password reset and change use the backend (`/auth/login`, `/otp/verify`, `/otp/resend`, `/register`, `/password/forgot`, `/password/reset`, `/password/change`); passwords are checked and hashed by the backend; the role comes from the directory. In Development the one-time code is shown on the code screen (`developmentCode`). | User instruction 2026-11-12; backend ADR-0013 am. 2 |

## 4. Business rules and parameters
All registered in core (`src/lib/platform/core.ts`, module `platform`) or admin.

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `auth.otpTtlMinutes` | One-time code lifetime | 10 min | Demo |
| `auth.otpMaxAttempts` | Wrong codes allowed | 5 | Demo |
| `auth.passwordMaxAttempts` | Wrong passwords before lockout | 5 | Demo |
| `auth.passwordMinLength` | Minimum password length | 12 | Demo |
| `auth.passwordRequireMixed` | Upper, lower, digit, symbol | true | Demo |
| `session.idleTimeoutMinutes` | Tenant default idle timeout | 15 min | PRD §4.2 — demo |
| `session.idleTimeoutMinutes.<roleId>` | Per-role idle timeout (admin) | 15 / 10 min | PRD §4.2; W2 |
| `session.warningSeconds` | Warning before idle sign-out | 60 s | Demo |
| `session.deviceBinding.<roleId>`, `session.ipAllowList.<roleId>` | Per-role device / network (admin) | see admin | PRD §4.2 |

Environment config: `NEXT_PUBLIC_AZURE_AD_CLIENT_ID`, `NEXT_PUBLIC_AZURE_AD_TENANT_ID`, `NEXT_PUBLIC_AZURE_AD_REDIRECT_URI`, `NEXT_PUBLIC_DEMO_ACCESS`.

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `access.request` (core) | Email verified after registration | System Admin approval · 48 h; approve sets role, reject marks account Rejected | PRD §4 |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `auth.access-requested` | Email verified, access requested | System Admin |
| `auth.password-changed` | Password changed or reset | The user |
| (none) | Access approved / rejected | Applicant — not notified (gap) |

## 7. Events and hook points
| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `auth.access.requested` | Verification completes | `{ roleId }` |
| event | `auth.password.changed` | Change or reset | — |
| event | `auth.session.started` | Sign-in | Defined in catalogue, **never published** |
| hook | — | No `auth.*` hook points defined | — |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Microsoft Entra ID (MSAL.js) | in | Sign-in | ID token, app roles | Built (enabled by env) |
| Email delivery (OTP, notifications) | out | Registration / sign-in / reset | One-time code | Simulated (code shown on screen in demo) |
| Identity & Access API | out/in | Register, verify, sign-in, password | Accounts, challenges | Not wired (browser store) |
| Step-up provider | in | High-value approvals | OTP / PIN | Simulated (TD-858) |

## 9. Non-functional
- Security: passwords stored salted SHA-256 in browser storage (prototype only — must move server-side with a slow KDF); OTPs generated with `crypto.getRandomValues`; generic error messages on failed sign-in; email masked on verify page.
- Session: session in `sessionStorage`; MSAL cache in `sessionStorage`.
- Audit: account actions audited via `accounts.ts` `audit()`; sessions via `session.ts`.
- Accessibility: forms use library `Field` with errors.

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| W2 | Per-role session timeout / device binding / IP allow-list defaults | 15 / 10 min; internal range for tighter roles |
| ADM-OPS3 | Pending users get no notification | Applies to applicants too |
| DS1 | Step-up threshold default | ₦100m (`approvals.stepUpThresholdNgn`) |
| — (new) | Is email + password sign-in in scope for production, or Entra ID only? | Both offered |
