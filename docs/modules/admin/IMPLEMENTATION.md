# Users & roles (admin) — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
Client-only pages over the shared Risk Data Spine (`useDb`, zustand + localStorage). All admin values are business rules (`src/lib/platform/rules.ts`) registered in `platform.ts`; the only module state is the list of cloned roles (`credigit.ser.admin`). Every change is submitted as an Operations instance (`submitOperation` / `requestRuleChange`) wrapped by `submitWithHooks` (`admin.config.change.*`) or explicit `runHooks` (`admin.user.change.*`); `apply` performs the change, writes audit, publishes the event and notifies. MFA reset is the only direct action.

Layering: page (`*-page.tsx`) → `operation-ui.tsx` / `rule-editor.tsx` → platform services (`operations`, `rules`, `hooks`, `events`, `notifications`) → `useDb` store. BACKEND SEAM: Identity & Access API (users/roles) and Rules & Parameters Engine.

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/modules/admin/platform.ts` | Rules, operation types, templates, events, hook points |
| `src/modules/admin/rule-keys.ts` | Rule-key builders, `roleName()`, `roleSecurity()`, product list |
| `src/modules/admin/store.ts` | Custom-role store; read hooks used by other modules (`useConfiguredRoles`, `useAdminParams`, `useRoleSecurity`, `useRoleLimit`, `usePendingChanges`, `useOpenAdminOperations`) |
| `src/modules/admin/users-page.tsx` | Users list, user drawer, invite / role / status dialogs, MFA reset |
| `src/modules/admin/access-requests.tsx` | Pending `access.request` operations card |
| `src/modules/admin/roles-page.tsx` | Roles & limits, per-role session rules, clone/edit/delete custom roles |
| `src/modules/admin/parameters-page.tsx` | Rules & parameters (rule groups, sector limits, chart-flow read-only) |
| `src/modules/admin/rule-editor.tsx` | Rule list + change dialog (`requestRuleChange`) |
| `src/modules/admin/operation-ui.tsx` | `submitWithHooks`, `PendingBadge`, `SubmitOutcome` |
| `src/modules/admin/config-notice.tsx` | Notice on configuration screens |
| `src/modules/admin/audit-page.tsx` | Audit log viewer (nav module `audit`) |
| `src/modules/admin/permissions-page.tsx` | Role permission matrix (backend `/identity/permissions`, `/identity/roles`) |
| `src/modules/admin/groups-page.tsx` | Permission groups (backend `/identity/groups`) |
| `src/modules/admin/entra-mapping-page.tsx` | Entra role mapping (backend `/identity/entra-mappings`, ADR-0016) |
| `src/modules/admin/workflow-mode.ts` | `useAppliesOnSave` — reads `/operations/workflows`; screens show "Save" when a workflow has no approval steps |
| `src/modules/admin/directory.ts` | Backend users and `useDirectoryRoleModules` (role → side-menu modules from current permissions, shown on Roles & limits) |
| `src/app/(app)/admin/**/page.tsx`, `src/app/(app)/audit/page.tsx` | Thin route files |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/admin` (`?user=<id>` opens drawer) | `UsersPage` | Administration → Users & roles → Users |
| `/admin/roles` | `RolesPage` | → Roles & limits |
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
| — (none) | Pages gate edit actions with `useCan("admin", "edit")` (module-level role access, `src/lib/auth/session.ts`); nav filtered by `canAccess`. No named permission key from the catalogue is checked. Audit page relies on nav access to module `audit`. |

## 7. Workflows, notifications, events, hooks wired
| Item | Code location |
|---|---|
| `user.invite`, `user.role-change`, `user.deactivate`, `user.reactivate` | registered `platform.ts`; submitted `users-page.tsx` |
| `role.custom-change` | registered `platform.ts`; submitted `roles-page.tsx` |
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
| ADM-FR-10 | `roles-page.tsx`, `role.custom-change` | — | Partial (custom roles can't be assigned, TD-805) |
| ADM-FR-11 | `parameters-page.tsx`, `rule-editor.tsx` | rule-change.spec | Done |
| ADM-FR-12 | `admin.sector-limits.change` | — | Done |
| ADM-FR-13 | `admin.product.maxTenorMonths.*` | — | Done |
| ADM-FR-14 | `audit-page.tsx` | — | Done |
| ADM-FR-15 | `audit-page.tsx` IT Support effect | — | Done (once per browser session) |
| ADM-FR-16 | — | — | Missing |
| ADM-FR-17 | `rule.change` for all rules | rule-change.spec | Partial (no regulatory distinction, W1) |
| ADM-FR-18 | `permissions-page.tsx` | backend tests | Done |
| ADM-FR-19 | `groups-page.tsx` | backend tests | Done |
| ADM-FR-20 | `entra-mapping-page.tsx` (actions gated by `identity.entra-mappings.change`) | backend `EntraMappingTests` | Done |

## 10. Gaps against the invariants
- Inv. 12: no named permission checks (`identity.users.*`, `identity.roles.*`, `platform.*`, `audit.log.*`); gating is `useCan("admin","edit")` by role → module map.
- Inv. 9 (workflow): MFA reset applies directly with no Operations step and no permission check.
- Inv. 9 (notified): invitee receives nothing (ADM-OPS3); deactivation notifies before suspension as a workaround.
- Inv. 9 (connector-ready): no `docs/integration-points.md` entry for Identity & Access / Entra ID.
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
