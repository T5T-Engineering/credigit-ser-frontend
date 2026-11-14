# Users & roles (admin) — implementation

| | |
|---|---|
| Status | Prototype (demo data) + Identity & Access API mode (`NEXT_PUBLIC_API_URL`) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (feature/iam-rbac) |

## 1. Design overview
Client-only pages over the shared Risk Data Spine (`useDb`, zustand + localStorage). All admin values are business rules (`src/lib/platform/rules.ts`) registered in `platform.ts`; the only module state is the list of cloned roles (`credigit.ser.admin`). Every change is submitted as an Operations instance (`submitOperation` / `requestRuleChange`) wrapped by `submitWithHooks` (`admin.config.change.*`) or explicit `runHooks` (`admin.user.change.*`); `apply` performs the change, writes audit, publishes the event and notifies. MFA reset is an Operations request (`user.mfa-reset`); lock / unlock are the only direct actions (immediate security containment, reason required, AUTH-OQ2). Identity actions go through `iam-service.ts`, which calls the Identity & Access API in API mode (202 → Operations) and the local operation types in demo mode. Every control is guarded by a catalogue permission key (`useCan` from `@/lib/iam/permissions`).

Layering: page (`*-page.tsx`) → `operation-ui.tsx` / `rule-editor.tsx` → platform services (`operations`, `rules`, `hooks`, `events`, `notifications`) → `useDb` store. BACKEND SEAM: Identity & Access API (users/roles) and Rules & Parameters Engine.

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/modules/admin/platform.ts` | Rules, operation types, templates, events, hook points |
| `src/modules/admin/rule-keys.ts` | Rule-key builders, `roleName()`, `roleSecurity()`, product list |
| `src/modules/admin/store.ts` | Custom-role store; read hooks used by other modules (`useConfiguredRoles`, `useAdminParams`, `useRoleSecurity`, `useRoleLimit`, `usePendingChanges`, `useOpenAdminOperations`) |
| `src/modules/admin/users-page.tsx` | Users list, user drawer, invite / role / status dialogs, lock / unlock and MFA-reset `ConfirmDialog`s, permission-gated export; API-mode directory |
| `src/modules/admin/permissions-page.tsx` | Roles × permissions (`PermissionMatrix`, single role at a time, `diffRoleGrants`), Request change → `ConfirmDialog reason="required"` |
| `src/modules/admin/iam-service.ts` | `requestRolePermissionChanges`, `setUserLock`, `adminExport`, `useApiDirectory`, `apiUserCommand` (API / demo dispatch) |
| `src/modules/admin/access-requests.tsx` | Pending `access.request` operations card |
| `src/modules/admin/roles-page.tsx` | Roles & limits, per-role session rules, clone/edit/delete custom roles |
| `src/modules/admin/parameters-page.tsx` | Rules & parameters (rule groups, sector limits, chart-flow read-only) |
| `src/modules/admin/rule-editor.tsx` | Rule list + change dialog (`requestRuleChange`) |
| `src/modules/admin/operation-ui.tsx` | `submitWithHooks`, `PendingBadge`, `SubmitOutcome` |
| `src/modules/admin/config-notice.tsx` | Notice on configuration screens |
| `src/modules/admin/audit-page.tsx` | Audit log viewer (nav module `audit`) |
| `src/modules/admin/backend-permissions-page.tsx` (`BackendPermissionsPage`, route picks it when `NEXT_PUBLIC_API_BASE_URL` is set — TD-976) | Role permission matrix (backend `/identity/permissions`, `/identity/roles`) |
| `src/modules/admin/groups-page.tsx` | Permission groups (backend `/identity/groups`) |
| `src/modules/admin/entra-mapping-page.tsx` | Entra role mapping (backend `/identity/entra-mappings`, ADR-0016) |
| `src/modules/admin/workflow-mode.ts` | `useAppliesOnSave` — reads `/operations/workflows`; screens show "Save" when a workflow has no approval steps |
| `src/modules/admin/backend-permissions-page.tsx` (save checks) | Reason is a required `Field` in a `ValidationScope`: Save with no reason shows "This field is required." under it and focuses it; a too-short reason shows the rule message (`operations.minCommentLength`). Unsaved toggles show an "Unsaved changes" warning and `useUnsavedChangesWarning` asks before refresh / close |
| `src/modules/admin/groups-page.tsx` (confirmations) | Delete group / add member / remove member use library `ConfirmDialog` (`reason="required"`, `minReasonLength` from `operations.minCommentLength`, danger tone for delete and remove); the reason is sent with the request and the outcome shows in `SaveOutcomeModal`. Unsaved permission ticks and the page reason are kept when a dialog action runs |
| `src/modules/admin/save-outcome.tsx` | `SaveOutcomeModal` (library `ResultDialog`: tone icon, title, message, track-request link) for save results; `refreshOwnAccess` re-reads the admin's own access after a saved change |
| `src/modules/admin/directory.ts` | Backend users and `useDirectoryRoleModules` (role → side-menu modules from current permissions, shown on Roles & limits) |
| `src/app/(app)/admin/**/page.tsx`, `src/app/(app)/audit/page.tsx` | Thin route files |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/admin` (`?user=<id>` opens drawer) | `UsersPage` | Administration → Users & roles → Users |
| `/admin/roles` | `RolesPage` | → Roles & limits |
| `/admin/permissions?role=<id>` | `PermissionsPage` | → Permissions |
| `/admin/parameters?tab=approvals\|rar\|ifrs9\|haircuts\|sectors\|products\|platform` | `ParametersPage` | → Rules & parameters |
| `/admin/permissions` | `PermissionsPage` | → Permissions |
| `/admin/groups` | `GroupsPage` | → Permission groups |
| `/admin/entra-mapping` | `EntraMappingPage` | Hidden from the menu (user decision 2026-11-13); direct URL only |
| `/audit` | `AuditPage` | Administration → Audit log |

Exported for other modules: `roleName`, `roleSecurity`, `roleIdleTimeoutMinutes` (app shell idle sign-out), store read hooks above, `RuleEditorList`, `RuleChangeDialog`, `submitWithHooks`.

## 4. Data model
| Entity / store | Key fields |
|---|---|
| `User` (`useDb().users`) | id, name, email, roleId, branch, status (Active / Suspended / Pending), mfa, lastLogin |
| Role grant deltas (`credigit.ser.iam`, `src/lib/iam/grants-store.ts`) | overrides: Record<roleId, { grant[], revoke[] }> against catalogue defaults; seeded tenant grants (TD-974) |
| `CustomRole` (`credigit.ser.admin`) | id, clonedFrom, name, short, limitNgn, security { sessionTimeoutMin, deviceBinding, ipRanges }, createdAt |
| `Sector` (`useDb().sectors`) | id, name, limitPct |
| `AuditEvent` (`useDb().audit`) | id, at, actorId, actorName, roleId, action, entityType, entityId, before, after, ip, device |
| Rule values / history | `credigit.ser.rules` (platform) |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `admin.roleName.*` | `rule-keys.ts` `roleName()` (used app-wide) |
| `session.idleTimeoutMinutes.*`, `session.deviceBinding.*`, `session.ipAllowList.*` | `rule-keys.ts` `roleSecurity()`; `roles-page.tsx` |
| `session.idleTimeoutMinutes` (fallback) | `rule-keys.ts` |
| `rbac.limit.*` | `store.ts` (`roleLimit`), `roles-page.tsx` |
| `admin.product.maxTenorMonths.*`, `origination.products`, `origination.fastTrack.variants` | `store.ts` `productCatalogue()` |
| `admin.user.minNameParts`, `admin.user.defaultInviteRole` | `users-page.tsx` invite dialog |
| `operations.minCommentLength` | users / roles / parameters dialogs (reason length) |
| `approvals.stepUpThresholdNgn`, `workspace.nearLimitPct` | `parameters-page.tsx` |
| `rar.*` (intensity thresholds) | `store.ts` `useAdminParams()` |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| `identity.users.view` | Users tab / page |
| `identity.users.invite`, `identity.users.change-roles`, `identity.users.deactivate`, `identity.users.reactivate`, `identity.users.reset-mfa` | Users page buttons / menu items (each own key) |
| `identity.users.deactivate` / `identity.users.reactivate` | Lock / unlock (closest keys until `identity.users.lock` / `.unlock` exist, TD-972) |
| `identity.users.export`, `identity.roles.export` | Export buttons + `adminExport` re-check |
| `identity.access-requests.review` | Access-requests card |
| `identity.roles.view`, `identity.permissions.view` | Roles & limits and Permissions tabs |
| `identity.roles.change-permissions` | Permissions page editing, `requestRolePermissionChanges` |
| `identity.roles.create`, `identity.roles.delete` | Request clone / delete on Roles & limits |
| `rules.rules.request-change` | Role names / limits / session rules; Rules & parameters edits |
| `platform.parameters.view`, `platform.sector-limits.request-change` | Rules & parameters tab; sector limits |
| `audit.log.view`, `audit.log.export` | Audit log page and export |

## 7. Workflows, notifications, events, hooks wired
| Item | Code location |
|---|---|
| `user.invite`, `user.role-change`, `user.deactivate`, `user.reactivate` | registered `platform.ts`; submitted `users-page.tsx` |
| `role.custom-change` | registered `platform.ts`; submitted `roles-page.tsx` |
| `role.permissions-change` | registered `platform.ts` (apply → `applyRolePermissionChange`); submitted `iam-service.ts` (demo) / `POST /identity/roles/{id}/permission-changes` (API) |
| `user.mfa-reset` | registered `platform.ts`; submitted from the users page (demo; API mode disabled, BE-31) |
| `admin.role-permissions-changed`, `auth.account-locked`, `auth.account-unlocked` | templates `platform.ts` / `core.ts`; notify in apply / `accounts.ts` |
| `identity.role.permissions-changed`, `identity.user.locked`, `identity.user.unlocked`, `admin.users.exported`, `admin.roles.exported` | publish in apply / `accounts.ts` / `iam-service.ts` |
| `identity.role.permissions-change.before/after` | `iam-service.ts` `requestRolePermissionChanges` |
| `admin.sector-limits.change` | registered `platform.ts`; submitted `parameters-page.tsx` (`SectorLimitsSection`) |
| `rule.change` | `requestRuleChange` from `rule-editor.tsx`, `roles-page.tsx` |
| All 7 templates (REQ §6) | defined `platform.ts`; `notify` in each `apply`; MFA reset in `users-page.tsx` |
| All events (REQ §7) | `publish` in each `apply`; `admin.user.mfa-reset` in `users-page.tsx` |
| `admin.user.change.before/after` | `users-page.tsx` (MFA reset, role/status, invite) |
| `admin.config.change.before/after` | `operation-ui.tsx` `submitWithHooks` (rule-editor, roles-page) |
| Audit | `log()` inside every `apply`; MFA reset; audit-page IT Support view |

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/platform/rbac.spec.ts` | Account Officer has no Admin; direct URLs gated |
| `e2e/iam/permissions-nav.spec.ts` | System Admin sees every module; limited role sees only its own; Board reads BRC pack only |
| `e2e/iam/role-permissions.spec.ts` | Grant via matrix → Operations → requester can't approve → CRO approves → role gains the module |
| `e2e/iam/user-lock.spec.ts` | Lock (reason required) → sign-in refused → unlock → sign-in works |
| `e2e/platform/registration.spec.ts` | Access request approved by System Admin |
| `e2e/platform/rule-change.spec.ts` | Rule change request → approvals → applied, history, notification |
| Unit tests | None (vitest configured, no `*.test.ts`) |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status |
|---|---|---|---|
| ADM-FR-01 | `users-page.tsx` invite validation | — | Done |
| ADM-FR-02 | `users-page.tsx` MFA stat/badges | — | Partial (flag only; enforcement is auth/Entra) |
| ADM-FR-03 | `platform.ts` `user.invite` | — | Done |
| ADM-FR-04 | `platform.ts` role-change / deactivate / reactivate | — | Done |
| ADM-FR-05 | `users-page.tsx` `resetMfa` | — | Done |
| ADM-FR-06 | `access-requests.tsx` | registration.spec | Done |
| ADM-FR-07 | `admin.roleName.*` + `roleName()` | — | Done |
| ADM-FR-08 | `roles-page.tsx` (`rbac.limit.*`) | — | Done |
| ADM-FR-09 | session rules + `app-frame.tsx` idle timer | session-timeout.spec | Partial (device binding / IP allow-list stored, not enforced) |
| ADM-FR-10 | `roles-page.tsx`, `role.custom-change` | — | Partial — "Request clone" hidden (`CLONE_ROLES_ENABLED = false`) because custom roles can't be assigned (TD-805); existing custom roles can still be edited or deleted |
| ADM-FR-11 | `parameters-page.tsx`, `rule-editor.tsx` | rule-change.spec | Done |
| ADM-FR-12 | `admin.sector-limits.change` | — | Done |
| ADM-FR-13 | `admin.product.maxTenorMonths.*` | — | Done |
| ADM-FR-14 | `audit-page.tsx` | — | Done |
| ADM-FR-15 | `audit-page.tsx` IT Support effect | — | Done (once per browser session) |
| ADM-FR-16 | — | — | Missing |
| ADM-FR-17 | `rule.change` for all rules | rule-change.spec | Partial (no regulatory distinction, W1) |
| ADM-FR-18 | `backend-permissions-page.tsx` | backend tests | Done |
| ADM-FR-19 | `groups-page.tsx` | backend tests | Done |
| ADM-FR-20 | `entra-mapping-page.tsx` (actions gated by `identity.entra-mappings.change`) | backend `EntraMappingTests` | Done |
| ADM-FR-26 | `permissions-page.tsx`, `role.permissions-change` | role-permissions.spec | Done |
| ADM-FR-27 | `iam-service.ts` `setUserLock`, `accounts.ts` | user-lock.spec | Done (demo; backend endpoint TD-972) |
| ADM-FR-28 | `adminExport` | — | Done |
| ADM-FR-29 | `user.mfa-reset` | — | Done (demo; API disabled, BE-31) |
| ADM-FR-30 | `useCan` call sites, nav | permissions-nav.spec | Done |

## 10. Gaps against the invariants
- Inv. 12: every admin control uses a catalogue key; lock / unlock borrow deactivate / reactivate keys (TD-972); IT Support audit-view logging reads the role id (TD-969).
- Inv. 9 (workflow): lock / unlock apply immediately by design (AUTH-OQ2); MFA reset goes through Operations.
- Inv. 9 (notified): invitee receives nothing (ADM-OPS3); deactivation notifies before suspension as a workaround.
- Inv. 9 (connector-ready): Identity & Access API and Entra ID are recorded in [`docs/integration-points.md`](../../integration-points.md) (§6); the RBAC API is a BACKEND SEAM.
- Inv. 8: approver roles in `confirm()` / sector-limit step and SLA hours (24/48) are literals in default workflow definitions; demo tenor function `demoTenor` and tighter-role list are code (defaults only).
- Inv. 8 / PRD §4.0: role set and tiers are a static `RoleId` union; tier add/remove/merge not possible (TD-805, TD-110, TD-804).
- Audit: audit log is client-side (localStorage) and therefore not immutable; IP/device are demo values.
- Device binding / IP allow-list are not enforced at sign-in.
- No unit tests for rule-key helpers or operation `apply` functions.

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-804 | Rules & parameters shows chart-flow read-only from static chart-flow |
| TD-805 | Cloned roles are dynamic data; can't be assigned to users |
| TD-110 | Deprecated `chartFlow` proxy still read by `admin/store.ts`, `parameters-page.tsx` |
| TD-972 | Lock / unlock demo only; borrowed permission keys |
| TD-974 | Seeded tenant grants in code until the backend roles carry them |
| TD-971 | API mode: operations returned by the backend aren't visible in the local Operations pages |

## 12. Backend changes requested (credigit-ser-core-backend, not edited here)
| Request | Why |
|---|---|
| `config/roles.json`: `ExtraPermissions: ["enterprise-risk.brc-pack.view"]` for `board`, `mcc`, `bcc`, `portfolio-mis-officer` | BRC pack readers (frontend TD-964 / TD-974) |
| `config/roles.json`: `ExtraPermissions: ["offer-letters.letters.submit", "offer-letters.letters.request-reissue", "offer-letters.letters.record-acceptance"]` for `account-officer`, `credit-admin-officer` | They present / handle offer letters (PRD §6.1.1) without offer-letters edit |
| `POST /identity/users/{id}/lock` · `/unlock` + keys `identity.users.lock`, `identity.users.unlock` | Admin lock / unlock (TD-972) |
| MFA reset endpoint (BE-31 / TD-036) | `identity.users.reset-mfa` has no command |
| Catalogue keys: `monitoring.temporary-overdrafts.update`; `credit-admin.crms.export`, `.waivers.export`, `.credit-files.export`; optional `disbursement.history.export`, `ifrs9.rules.request-change`, `market-risk.rules.request-change` | Closest generic keys are borrowed today |
| `User` shape of `GET /identity/users`: document `branch`, `lastSignInAt`, `mfaEnrolled`, `requestedRoleIds`, `createdAt` | Frontend maps them as optional |
