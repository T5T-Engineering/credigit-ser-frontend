# Settings — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

Page compositions over `@credigit/web-ui` (`BrandProvider` / `useBrand`, preset picker, cards). The approved tenant brand lives in a small zustand store; the BrandProvider shows whatever this browser last applied (possibly a personal preview). `TenantBrandSync` (mounted in the app shell) applies a newly approved brand version once per browser. Tenant brand changes are an Operations request (`brand.change`) whose `apply` calls `setApprovedBrand`.

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/settings/profile-page.tsx` | Profile & security: identity, SSO / demo, MFA, idle timeout, limit, step-up, sign-out, demo-data reset |
| `src/modules/settings/branding-page.tsx` | Personal preview, presets, shareable preview links, `SubmitBrandModal` (hooks + `submitOperation("brand.change")`), pending state |
| `src/modules/settings/brand-store.ts` | `useBrandingStore` (`credigit.brand.tenant`), `setApprovedBrand`, `TenantBrandSync`, `brandFingerprint` |
| `src/modules/settings/presets.ts` | Brand presets (TD-801) |
| `src/modules/settings/platform.ts` | Rules, `brand.change`, template, events, hook points |
| `src/modules/auth/password-pages.tsx` | `ChangePasswordPage` for `/settings/password` (auth module) |

## 3. Routes / endpoints / public API

| Route | Page | Menu entry |
|---|---|---|
| `/settings` | `ProfilePage` | Settings → Profile & security |
| `/settings/password` | `ChangePasswordPage` (auth module) | Settings → Password |
| `/settings/security` | `SecurityPage` (`src/modules/settings/security-page.tsx`; backend `/identity/me/mfa…`, QR via `QrCode`) | Settings → Security |
| `/settings/branding` (`?preset=`, `?preview=pending`) | `BrandingPage` | Settings → Branding |

## 4. Data model

| Store | Key fields |
|---|---|
| `credigit.brand.tenant` | `approved: BrandConfig \| null`, `version`, `appliedVersion`, `approvedAt`, `approvedBy`, `operationId` |
| `BrandChangePayload` (operation payload) | `brand`, `summary`, `reason` |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `settings.brand.requesterRoles`, `settings.brand.personalPreview` | `branding-page.tsx` |
| `operations.minCommentLength` | `branding-page.tsx` (`SubmitBrandModal`) |
| `session.warningSeconds`, `session.idleTimeoutMinutes`, `approvals.stepUpThresholdNgn` | `profile-page.tsx` |

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| none (named keys) | Brand request allowed when `role.id` is in rule `settings.brand.requesterRoles`; preview when `settings.brand.personalPreview`; demo reset shown when `demoAccessEnabled`. Module access via `useCan("settings")` — every role has `settings: "edit"` (`roles.ts` `common`). |

## 7. Workflows, notifications, events, hooks wired

| Item | Code location |
|---|---|
| `brand.change` (REQ §5) | registered `platform.ts`; submitted `branding-page.tsx` `SubmitBrandModal`; pending via `usePendingFor("Branding", "tenant")` |
| `settings.brand-changed` (REQ §6) | `platform.ts` `apply` |
| `settings.brand.changed` | `platform.ts` `apply` |
| `settings.demo-data.reset` | `profile-page.tsx` reset confirm |
| hooks `settings.brand.change.before/after` | `branding-page.tsx` |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/platform/branding.spec.ts` | Personal preview + discard; tenant brand change approved recolours and refonts the app (SET-FR-03–05) |
| `e2e/platform/change-password.spec.ts` | Password change (SET-FR-02) |
| `e2e/platform/session-timeout.spec.ts` | Idle timeout behaviour shown on Profile |
| `e2e/risk/pages-load.spec.ts` | Settings pages load per role |
| Unit tests | None |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| SET-FR-01 | `profile-page.tsx` | pages-load | Done (MFA simulated in demo access) |
| SET-FR-02 | `auth/password-pages.tsx` | change-password | Done |
| SET-FR-03 | `branding-page.tsx` | branding | Done |
| SET-FR-04 | `branding-page.tsx`, `platform.ts` | branding | Done |
| SET-FR-05 | `brand-store.ts` `TenantBrandSync` | branding | Partial (per browser store, no tenant API) |
| SET-FR-06 | `presets.ts`, `branding-page.tsx` | — | Done (presets in code, TD-801) |
| SET-FR-07 | `profile-page.tsx` | — | Done (demo only) |

## 10. Gaps against the invariants

- **Inv 12:** requester check is a role-id list rule, not `settings.branding.request-change`; preview / reset have no permission check (`settings.branding.preview`, `settings.demo-data.reset`).
- **Inv 8:** `brand.change` default approvers (System Admin, MD) and 48 h SLA, and the `settings.brand-changed` recipient (`["system-admin"]`), are literals without a TD id.
- **Inv 9 notified:** only System Admin is told a tenant-wide brand changed; other users are not notified.
- **Inv 9 audited:** demo reset writes no before state; personal previews are audited but publish no event.
- **Inv 9 extensible:** no hook point around demo reset; brand hooks run in the page component, not a service.
- **Inv 9 tenant / backend:** approved brand and presets are browser data (`localStorage`, TD-801) — no tenant configuration API; `docs/integration-points.md` missing.
- **Tests:** no unit tests.

## 11. Tech debt

| TD id | Summary |
|---|---|
| TD-801 | Tenant brand presets (names, colours, fonts) are app data, not tenant configuration |
