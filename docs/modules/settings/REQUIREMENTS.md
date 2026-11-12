# Settings — requirements

| | |
|---|---|
| Module | `src/modules/settings` |
| Repo | credigit-ser-frontend |
| PRD | §4 / §4.1 (named users, System Admin configures the tenant), §4.2 (session rules, step-up), §10.1 (MFA, least privilege, audit), §10.4 (tenant configuration) |
| Owner (business) | System Admin (tenant branding — assumption W4, ADM-OPS2); every user (own profile) |
| Counterpart | Profile / password: [credigit-ser-core-backend `docs/modules/IdentityAccess/`](../../../../credigit-ser-core-backend/docs/modules/IdentityAccess/) (if written); branding: none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

Settings is where a user sees their own account, sign-in method and session rules, changes their password, and where the tenant's runtime brand (colours, logos, font — invariant 2) is previewed and changed through an approved Operations request.

- In scope: Profile & security view, Password page (rendered from the auth module), personal brand preview, tenant brand change request, brand presets, demo-data reset (prototype only), sign-out.
- Out of scope: password / OTP / session mechanics (auth module), roles and limits (admin), per-role session rules (admin `useRoleSecurity`).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Every signed-in user | View profile & security, change own password, sign out, step-up | `settings.profile.view`, `identity.me.view`, `identity.password.change`, `identity.session.sign-out`, `identity.step-up.verify` |
| Every user (when rule `settings.brand.personalPreview` is on) | View branding, preview a brand in own browser | `settings.branding.view`, `settings.branding.preview` |
| Roles in rule `settings.brand.requesterRoles` (System Admin) | Request a tenant brand change | `settings.branding.request-change` |
| Demo access users | Reset demo data in this browser | `settings.demo-data.reset` |

## 3. Functional requirements

| ID | Requirement | Source |
|---|---|---|
| SET-FR-01 | Show the signed-in user's identity, role, sign-in method (Microsoft SSO / demo), MFA state, idle timeout and warning, sign-on limit and step-up threshold. | PRD §4.2, §10.1 |
| SET-FR-02 | Change own password (`/settings/password`, auth module page). | PRD §10.1 |
| SET-FR-03 | Users may preview colours, font and logo in their own browser only; preview changes are audited; "discard" returns to the approved tenant brand. | Assumption W4, ADM-OPS2 (rule `settings.brand.personalPreview`) |
| SET-FR-04 | A tenant brand change (colours, logos, font) is requested by an allowed role with a reason and applies to every user only after approval in Operations (`brand.change`). | Invariant 2, 9; ADM-OPS2 |
| SET-FR-05 | Approved brand is applied in every browser session that sees the new version (`TenantBrandSync`); emails use the live brand. | Invariant 2 |
| SET-FR-06 | Brand presets and shareable preview links (`?preset=…`, `?preview=pending`). | Assumption (demo); TD-801 |
| SET-FR-07 | Demo access only: reset demo data and configuration (branding kept), audited and published. | Prototype only |

## 4. Business rules and parameters

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `settings.brand.requesterRoles` | Roles that may request a tenant brand change | System Admin | PRD §4.1 — demo value |
| `settings.brand.personalPreview` | Allow personal (browser-only) brand preview | true | Tenant parameter (demo) |
| `session.idleTimeoutMinutes`, `session.warningSeconds`, `approvals.stepUpThresholdNgn` | Shown on Profile (owned by platform / auth) | 15 min, 60 s, ₦100m | PRD §4.2 (demo) |
| `operations.minCommentLength` | Minimum reason length for a brand change request | 10 | Operations |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `brand.change` | Branding → Request tenant brand change | Brand approval: any of System Admin, MD · 48 h | ADM-OPS2 (assumption) |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `settings.brand-changed` | `brand.change` approved and applied | System Admin (+ requester via `operations.request-completed`) |

## 7. Events and hook points

| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `settings.brand.changed` | Approved brand applied | `summary`, `operationId` |
| event | `settings.demo-data.reset` | User reset demo data | Tenant subject |
| hook (before) | `settings.brand.change.before` | Before the request is submitted | Veto (e.g. contrast policy); enrich brand / reason |
| hook (after) | `settings.brand.change.after` | After submission to Operations | Observe (`payload`, `result`) |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Tenant configuration API (approved brand, brand catalogue) | Inbound / outbound | Load; approved change | `BrandConfig` (colours, logos, font), presets | BACKEND SEAM — `localStorage` (`credigit.brand.tenant`); presets in code (TD-801) |
| Identity provider (Microsoft Entra ID / MSAL) | Inbound | Sign-in | Identity, MFA policy | Built for SSO; demo access otherwise |
| Backend Identity & Access (`identity.me`, password) | Outbound / inbound | Profile load, password change | Identity, password | BACKEND SEAM |

## 9. Non-functional

- Audit: preview changes (debounced), applied brand, demo reset are audited; brand request audited by the engine.
- Branding comes only from tokens / `updateBrand` (invariant 2); preset hex values are tenant configuration data, not styling.
- Tenant isolation: approved brand is per browser store today — a backend tenant configuration is required for real tenant-wide application.

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| W4 | Who may change tenant branding? | System Admin (rule `settings.brand.requesterRoles`) |
| ADM-OPS2 | Who approves a tenant brand change? | One approver: another System Admin or the MD; personal previews allowed by rule |
| W2 | Per-role session timeout / device binding / IP allow-list defaults | 15-minute idle timeout; tighter for Disbursement and Legal |
| W6 (§10.1) | IT Support access time-box | Not enforced in the prototype |
