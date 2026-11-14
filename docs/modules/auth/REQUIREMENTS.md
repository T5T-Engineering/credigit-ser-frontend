# Authentication & permissions (auth) — requirements

| | |
|---|---|
| Module | `src/modules/auth` (+ `src/lib/auth/*`, `src/lib/iam/*`, `src/lib/api/*`); no nav entry (public routes) |
| Repo | credigit-ser-frontend |
| PRD | §4 (intro), §4.2, §10.1 |
| Owner (business) | System Admin (approves access, manages grants); every user (signs in) |
| Counterpart | [IdentityAccess](../../../../credigit-ser-core-backend/docs/modules/IdentityAccess/REQUIREMENTS.md) · API contract [`docs/api/identity-access.md`](../../../../credigit-ser-core-backend/docs/api/identity-access.md) (ADR-0012, ADR-0013) |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Sign-in, self-registration with e-mail verification, password reset and change, step-up, and the **permission model**
that guards every view and action in the app (invariant 12). Every login is a named individual with MFA (PRD §4, §10.1).

Exactly **one sign-in mode** is active per deployment, chosen by the anonymous `GET /api/v1/auth/config`:

- **Local** — e-mail + password → e-mailed one-time code → JWT access token (memory) + rotating refresh token
  (`sessionStorage`); lockout, password reset, step-up (`acrs` / `auth_time`).
- **MicrosoftEntra** — one "Sign in with Microsoft" button; MSAL is initialised from the `microsoftEntra` block of the
  config response (authority, client id, scopes, redirect paths), falling back to environment config. The Entra tenant /
  client details are not known yet (open question AUTH-OQ1).

**Demo mode** (no `NEXT_PUBLIC_API_URL`): the same screens and the same permission model run against browser-side seeded
users, roles and grants (prototype). The demo builds its `/auth/config` answer from business rules and
`NEXT_PUBLIC_AUTH_MODE`.

- In scope: `/login` (mode-driven), `/register` → `/verify` (access request), `/forgot-password` ("Set or reset your
  password"), `/reset-password`, Settings → Password, lockout, idle sign-out, step-up for high-value approvals, token
  refresh/rotation, permission catalogue, effective permissions of the signed-in user, nav/route/action guards.
- Out of scope: managing users and role grants (admin module), approving access (Operations `access.request`), device
  binding / IP allow-list enforcement (not built).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| Unauthenticated person | Register, verify e-mail, request access, set / reset password | — (anonymous endpoints) |
| Any signed-in principal (Baseline) | View own identity, sign out, Entra access request / invitation accept | `identity.me.view`, `identity.session.sign-out`, `identity.access-requests.submit`, `identity.invitations.accept` |
| Signed-in user (Local mode) | Change password | `identity.password.change` |
| Approver of a high-value action | Step-up verification | `identity.step-up.verify` |
| System Admin | Approve access requests (Operations) | `identity.access-requests.review`, `operations.items.decide` |

Permission model (mirrors backend ADR-0012):

- Catalogue: `config/permissions.json` of the backend (270 keys `<module>.<resource>.<action>`, each with `area` = nav
  module and `level` = view | edit). The frontend imports a **generated copy** (`src/lib/iam/permission-catalogue.json`,
  `scripts/sync-permissions.mjs`) — keys are never hand-typed.
- Default grants of a role: every permission whose `area` the role holds at that `level` (edit ⇒ view) + Baseline.
  **System Admin holds every permission** by default (including permissions added later); tenants may revoke, except the
  protected administrator patterns (`identity.users.*`, `identity.roles.*`, `identity.permissions.*`,
  `identity.access-requests.review`).
- API mode: effective permissions come from `GET /identity/me` → `permissions`. Demo mode: role defaults ± approved
  `role.permissions-change` deltas.
- Guards fail closed: no session or unknown key → denied. Holding a permission never bypasses Operations approver
  eligibility, four-eyes or segregation of duties.

## 3. Functional requirements
| ID | Requirement | Source |
|---|---|---|
| AUTH-FR-01 | Every login is tied to a named individual; no shared logins. | PRD §4 |
| AUTH-FR-02 | MFA on all logins (Entra ID MFA; e-mailed one-time code for Local sign-in). | PRD §4, §10.1 |
| AUTH-FR-03 | Read `GET /auth/config` before rendering the login page; render only the active mode (Local form **or** Microsoft button). | ADR-0013 |
| AUTH-FR-04 | Local sign-in: `login` → code screen (masked e-mail, `codeLength`, resend) → `otp/verify` → tokens → `GET /identity/me`. | ADR-0013 |
| AUTH-FR-05 | Lockout after `auth.passwordMaxAttempts` wrong passwords; reset unlocks; System Admin can lock / unlock (admin). | Assumption (demo default); backend lockout |
| AUTH-FR-06 | One-time codes: length, lifetime, attempts and resend cooldown come from the challenge / config (API) or rules (demo). | ADR-0013; library TD-002/003 |
| AUTH-FR-07 | Self-registration → e-mail verification → access request approved by System Admin in Operations (only when `registrationEnabled`). | PRD §4 |
| AUTH-FR-08 | Password policy from config (`passwordPolicy.minLength`, `requireMixed`) or rules; shown as a checklist. | ADR-0013; library TD-012 |
| AUTH-FR-09 | Forgot / first password ("Set or reset your password") via one-time code; change password while signed in; notify the user. | ADR-0013 |
| AUTH-FR-10 | Idle sign-out with warning; timeout and warning lead time from rules (per role). | PRD §4.2; library TD-001 |
| AUTH-FR-11 | Device binding and IP allow-listing per role. | PRD §4.2 — **not enforced** |
| AUTH-FR-12 | Audit every sign-in, sign-out, failure, lockout, registration, verification, reset, change. | PRD §4, §10.1 |
| AUTH-FR-13 | Demo access by role (prototype only; `NEXT_PUBLIC_DEMO_ACCESS=false` disables). | Prototype convention |
| AUTH-FR-14 | Tokens: access token in memory; refresh token in `sessionStorage`; single-flight refresh ~60 s before expiry or on 401; replace the refresh token every time; sign out on `auth.refresh-token-reused` / `auth.session-expired` / `auth.refresh-token-invalid`. | API contract §3 |
| AUTH-FR-15 | Step-up: an approval answered 403 `stepUpRequired` → `step-up` → code → `step-up/verify` → retry with the step-up token. | API contract §3 |
| AUTH-FR-16 | Every view, menu item, sub-page tab, button, export, approval and configuration change is guarded by a catalogue permission key (fail closed). | Invariant 12; API contract §5 |
| AUTH-FR-17 | Menus: nav item shown when any permission of its area is held; sub-page shown when its `<area>.<resource>.view` key is held; direct URLs to a page without the key show the lock state. | API contract §5 |
| AUTH-FR-18 | No demo credential literal in the client bundle: seeded demo users either use `NEXT_PUBLIC_DEMO_PASSWORD` (env, optional) or set their own password through "Set or reset your password". | Invariant 7 |
| AUTH-FR-19 | API base URL from `NEXT_PUBLIC_API_URL`; never hard-coded. | Invariant 8 |
| AUTH-FR-20 | Brand storage is tenant-scoped (`BrandProvider tenantId`, `brandStorageKey(tenantId)`). | Invariant 2; library TD-009 |
| AUTH-FR-21 | When the backend is configured (`NEXT_PUBLIC_API_BASE_URL`), "Sign in with Microsoft" uses the backend server-side code flow: `POST /auth/microsoft/start` → Microsoft → `/callback/` → `POST /auth/microsoft/token`; the role comes from the backend directory (`GET /identity/me`), not from the browser. | User instruction 2026-11-12; backend ADR-0013 amendment 1 |
| AUTH-FR-22 | With the backend configured, email + password sign-in, registration, password reset and change use the backend (`/auth/login`, `/otp/verify`, `/otp/resend`, `/register`, `/password/forgot`, `/password/reset`, `/password/change`); passwords are checked and hashed by the backend; the role comes from the directory. In Development the one-time code is shown on the code screen (`developmentCode`). | User instruction 2026-11-12; backend ADR-0013 am. 2 |
| AUTH-FR-23 | When the backend asks for an authenticator-app code (`channel = authenticator`), the code screen says to open the app, shows no "sent to" address and no resend. | Backend ADR-0017 |

## 4. Business rules and parameters
All registered in core (`src/lib/platform/core.ts`, module `platform`) or admin. In API mode the challenge / config values
from the backend win (they are the backend's tenant configuration).

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `auth.otpLength` | Digits in a one-time code (demo; API uses `codeLength`) | 6 | Demo (backend `otpLength`) |
| `auth.otpResendCooldownSeconds` | Wait before a code can be resent | 30 s | Demo |
| `auth.otpTtlMinutes` | One-time code lifetime | 10 min | Demo |
| `auth.otpMaxAttempts` | Wrong codes allowed | 5 | Demo |
| `auth.passwordMaxAttempts` | Wrong passwords before lockout | 5 | Demo |
| `auth.passwordMinLength` | Minimum password length | 12 | Demo |
| `auth.passwordRequireMixed` | Upper, lower, digit, symbol | true | Demo |
| `auth.registrationEnabled` | Self-registration offered (demo `/auth/config`) | true | Demo |
| `auth.tokenRefreshLeadSeconds` | Refresh the access token this long before it expires | 60 s | API contract §3 |
| `session.idleTimeoutMinutes` | Tenant default idle timeout | 15 min | PRD §4.2 — demo |
| `session.idleTimeoutMinutes.<roleId>` | Per-role idle timeout (admin) | 15 / 10 min | PRD §4.2; W2 |
| `session.warningSeconds` | Warning before idle sign-out | 60 s | Demo |
| `approvals.stepUpThresholdNgn` | Approvals above this need step-up | ₦100m | PRD §4.2; DS1 |

Environment config (never secrets): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_MODE` (demo only), `NEXT_PUBLIC_TENANT_ID`,
`NEXT_PUBLIC_AZURE_AD_CLIENT_ID`, `NEXT_PUBLIC_AZURE_AD_AUTHORITY`, `NEXT_PUBLIC_AZURE_AD_SCOPES`,
`NEXT_PUBLIC_AZURE_AD_REDIRECT_URI`, `NEXT_PUBLIC_DEMO_ACCESS`, `NEXT_PUBLIC_DEMO_PASSWORD` (demo only, optional).

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `access.request` (core) | E-mail verified after registration | System Admin approval · 48 h; approve sets role, reject marks account Rejected | PRD §4 |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `auth.access-requested` | E-mail verified, access requested | System Admin |
| `auth.access-request-decided` | Access request approved / rejected | Applicant (on approval), System Admin |
| `auth.password-changed` | Password changed or reset | The user |
| `auth.account-locked` | Account locked (wrong passwords or by an admin) | The user, System Admin |
| `auth.account-unlocked` | Account unlocked by an admin | The user, System Admin |

## 7. Events and hook points
| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `identity.user.signed-in` | Sign-in completes (any mode) | `{ method }` |
| event | `identity.user.sign-in-failed` | Wrong password | `{ attempts }` |
| event | `identity.user.locked` | Account locked | `{ by, reason }` |
| event | `identity.user.unlocked` | Account unlocked by an admin | `{ by, reason }` |
| event | `identity.user.signed-out` | Sign-out / idle timeout | `{ reason }` |
| event | `identity.password.changed` / `identity.password.reset` | Change / reset | — |
| event | `identity.registration.started`, `auth.access.requested` | Registration / verification | `{ roleId }` |
| event | `identity.access-request.decided` | Access request approved / rejected | `{ decision, roleId }` |
| event | `identity.step-up.verified` | Step-up code verified | — |
| hook (before) | `identity.login.before` | Before a password sign-in is checked | Can veto (`auth.vetoed`) |
| hook (after) | `identity.login.after` | After a sign-in completes | Observe |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Identity & Access API `/api/v1/auth/*`, `/identity/*` | out/in | Every auth action; `/identity/me` after sign-in | Config, challenges, tokens, current user, catalogue | Built (enabled by `NEXT_PUBLIC_API_URL`) |
| Microsoft Entra ID (MSAL.js) | in | Sign-in (Entra mode) | Access token for the API; ID token in demo | Built; config-driven (AUTH-OQ1) |
| E-mail delivery (OTP, notifications) | out | Registration / sign-in / reset / step-up | One-time code | Backend (notification service); demo shows the code on screen |
| Step-up provider | in | High-value approvals | OTP | API mode built; demo accepts any code (TD-858) |

## 9. Non-functional
- Security: API mode keeps the access token in memory and the refresh token in `sessionStorage` (TD-032 backend moves it
  to an httpOnly cookie); demo passwords are salted SHA-256 in browser storage (prototype only).
- Generic error on failed sign-in; e-mail masked on the code screen; problem `detail` shown, branch on `code`.
- Audit: account actions (`accounts.ts`), sessions (`session.ts`); backend audits in API mode.

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| AUTH-OQ1 | Entra ID tenant, SPA client id, API scope and redirect URIs for each environment. | Read from `/auth/config` (`microsoftEntra`) or `NEXT_PUBLIC_AZURE_AD_*`; Microsoft button shows "not configured" otherwise. |
| AUTH-OQ2 | Should an admin unlock (clear a lockout) need second-person approval? | Lock and unlock are immediate, reason-required, audited and notified (security containment); deactivation/reactivation go through Operations. |
| W2 | Per-role session timeout / device binding / IP allow-list defaults | 15 / 10 min; internal range for tighter roles |
| DS1 | Step-up threshold default | ₦100m (`approvals.stepUpThresholdNgn`) |
