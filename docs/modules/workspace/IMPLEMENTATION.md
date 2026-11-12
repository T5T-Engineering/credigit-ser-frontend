# Workspace (Dashboard & My tasks) — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

Two pages composed from `@credigit/web-ui` (StatCard, ActivityFeed, notification panel, AI insight cards, charts, DataTable). `data.ts` derives approvals awaiting a role from the application approval chains (`currentSteps`), role tasks from the spine, and a portfolio snapshot; Operations items come from `useMyApprovalQueue` / `useMyRequests`. AI-flag review state is a small persisted zustand store. `useAuditLog` is the shared audit writer bound to the signed-in user (also used by settings and other modules).

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/workspace/dashboard-page.tsx` | Role-aware dashboard: KPIs, approvals awaiting me, quick actions, notifications, activity, config glance (admin), portfolio panels, AI-flagged items |
| `src/modules/workspace/inbox-page.tsx` | My tasks: merged rows (Task / Approval / Operation / Request), views, done / reopen |
| `src/modules/workspace/data.ts` | `approvalsAwaiting`, `useApprovalsAwaiting`, `useRoleTasks`, `isOverdue`, `isDueSoon`, `portfolioSnapshot`, `classTone`, `useWorkspaceStore` |
| `src/modules/workspace/use-audit-log.ts` | `useAuditLog()` audit writer |
| `src/modules/workspace/platform.ts` | Rules, events, hook points |

## 3. Routes / endpoints / public API

| Route | Page | Menu entry |
|---|---|---|
| `/dashboard` | `DashboardPage` | Workspace → Dashboard |
| `/inbox` | `InboxPage` | Workspace → My tasks |

Public API: `useAuditLog()`.

## 4. Data model

| Store / source | Key fields |
|---|---|
| Spine `tasks` | `id`, `title`, `module`, `href`, `assigneeRoleId`, `dueAt`, `priority`, `status` (Open / Done) |
| Spine `notifications` | `title`, `body`, `tone`, `href`, `roleIds[]` (broadcast), `userIds[]` (personal), `readBy[]` (per-user read), legacy `read` |
| Spine `applications.approvals` | Chart-flow steps (`roleId`, `decidedAt`) |
| `credigit.ser.workspace` | `signedOff {id → by, at}`, `dismissed[]` |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `workspace.nplAlertPct`, `workspace.nearLimitPct`, `workspace.decisionsWindowDays`, `workspace.activityWindowHours` | `dashboard-page.tsx` |
| `workspace.inflowShortfallRatio`, `workspace.stalledStageDays` | `dashboard-page.tsx` (AI flags) |
| `workspace.slaDueSoonDays`, `workspace.nearLimitPct` | `data.ts` |
| `workspace.highPriorityAmountNgn`, `workspace.taskDueSoonDays`, `approvals.stepUpThresholdNgn` | `inbox-page.tsx` |
| `approvals.stepUpThresholdNgn`, `rar.neutralBelow/marginalBelow/moderateBelow`, `origination.products` | `dashboard-page.tsx` config glance |

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| none (named keys) | Quick actions and panels use `canAccess(role, module)`; audience chosen by role group and role ids (`account-officer`, `bdm`); portfolio panel also by `role.id === "credit-analyst"`; tasks by `assigneeRoleId`. |

## 7. Workflows, notifications, events, hooks wired

| Item | Code location |
|---|---|
| `workspace.task.completed/reopened`, hooks `workspace.task.update.before/after` | `inbox-page.tsx` `setStatus` |
| `workspace.ai-flag.signed-off/dismissed`, hooks `workspace.ai-flag.review.before/after` | `dashboard-page.tsx` `review` |
| Operations queue / requests (read) | `useMyApprovalQueue`, `useMyRequests` in both pages |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/smoke.spec.ts` | Demo sign-in lands on a role-aware dashboard (WS-FR-01) |
| `e2e/risk/pages-load.spec.ts` | Dashboard and My tasks load per role |
| `e2e/credit/*.spec.ts` | Approvals reached through tasks / dashboard during credit flows |
| Unit tests | None |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| WS-FR-01 | `dashboard-page.tsx` | smoke | Done |
| WS-FR-02 | `dashboard-page.tsx` quick actions | pages-load | Done |
| WS-FR-03 | `dashboard-page.tsx` + `app-frame.tsx` via `useMyNotifications` / `markNotificationsRead` (`src/lib/platform/notifications.ts`) | operations-scope | Done |
| WS-FR-04 | `dashboard-page.tsx` activity | — | Done |
| WS-FR-05 | `dashboard-page.tsx` AI flags | — | Partial (state per browser, not per user / tenant) |
| WS-FR-06 | `inbox-page.tsx`, `data.ts` | pages-load | Done |
| WS-FR-07 | `inbox-page.tsx` `setStatus` | — | Done |

## 10. Gaps against the invariants

- **Inv 12:** no named permission keys (`dashboard.*`, `inbox.*`, `notifications.inbox.*`); role-id literals decide the dashboard audience and the portfolio panel (`account-officer`, `bdm`, `credit-analyst`, also `cro` / `md` KPI sets).
- **Inv 9 user-scoped:** tasks are assigned to a role (`assigneeRoleId`), so every member of the role shares one task list; AI-flag sign-off / dismiss is stored per browser (`credigit.ser.workspace`).
- **Inv 9 audited:** AI-flag audit has no before state.
- **Inv 9 notified / workflow:** completing or reopening a task notifies nobody; AI-flag sign-off is a direct action (acceptable as human review, no approval defined).
- **Inv 9 externally reachable:** events / hooks in-browser only (TD-963); tasks / notifications API recorded in [`docs/integration-points.md`](../../integration-points.md) (§10).
- **Tests:** no unit tests for `approvalsAwaiting` / `portfolioSnapshot`.

## 11. Tech debt

| TD id | Summary |
|---|---|
| — | No workspace TD rows; the role-id literals in §10 are unrecorded and need a TD id |
