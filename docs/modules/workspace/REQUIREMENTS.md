# Workspace (Dashboard & My tasks) — requirements

| | |
|---|---|
| Module | `src/modules/workspace` (nav modules `dashboard`, `inbox`) |
| Repo | credigit-ser-frontend |
| PRD | §4 / §4.1 (role-based work), §6.6.1 (application & portfolio dashboards), §6.4.3 (inflow monitoring signal), §6.12 / §2.3 (AI exception flagging with human sign-off) |
| Owner (business) | Every role (own dashboard and tasks) |
| Counterpart | none yet (in-app notifications: backend Notifications module, no module doc yet) |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

The workspace is each user's landing area: a role-aware dashboard (KPIs, approvals awaiting them, quick actions, notifications, recent activity, AI-flagged exceptions, portfolio snapshot) and "My tasks", which merges assigned tasks, credit chart-flow approvals, Operations approvals and the user's own requests.

- In scope: `/dashboard`, `/inbox`, task done / reopen, AI flag sign-off / dismiss, notification mark-read, the shared `useAuditLog` writer.
- Out of scope: approval decisions themselves (Operations / origination), portfolio analytics (portfolio module), executive cockpit (executive module).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Every signed-in user | View dashboard, notifications, recent activity | `dashboard.overview.view`, `notifications.inbox.view`, `notifications.inbox.mark-read` |
| Every signed-in user | Sign off or dismiss AI-flagged exceptions for their role | `dashboard.ai-flags.sign-off`, `dashboard.ai-flags.dismiss` |
| Every signed-in user | View, complete, reopen, export own tasks | `inbox.tasks.view`, `inbox.tasks.complete`, `inbox.tasks.reopen`, `inbox.tasks.export` |

## 3. Functional requirements

| ID | Requirement | Source |
|---|---|---|
| WS-FR-01 | Dashboard adapts to the user's audience (admin, front office, approver, risk, operations) with KPIs: open tasks, awaiting my decision / recommendation, my sign-on limit and chart-flow tier, decisions in window, NPL ratio, near-limit sectors, applications by stage. | PRD §4.1, §6.6.1 |
| WS-FR-02 | Quick actions only for modules the user can access (new application, limits, exceptions, disbursement, invite user, rules, audit). | Invariant 9 (navigable, user-scoped) |
| WS-FR-03 | Notifications panel for the user's role with mark-read / mark-all-read. | Invariant 9 (notified) |
| WS-FR-04 | Recent activity from the audit log: all entries for audit viewers, otherwise own / own-role entries within `workspace.activityWindowHours`. | PRD §10.1; assumption |
| WS-FR-05 | AI-flagged exceptions (inflow shortfall below COP ratio, stalled applications, near-limit sectors) labelled AI-flagged with human sign-off or dismiss, audited and published. | PRD §6.12, §2.3, §6.4.3 |
| WS-FR-06 | My tasks lists role tasks, chart-flow approvals, Operations approvals the user may decide and own requests; high priority above `workspace.highPriorityAmountNgn` or step-up threshold; due-soon highlighting. | PRD §4; invariant 9 |
| WS-FR-07 | Mark a task done / reopen it, with before hook (veto), audit, event and after hook. | Invariant 9 |

## 4. Business rules and parameters

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `workspace.nearLimitPct` | Sector counts as near limit from this % of its limit | 90% | Tenant parameter (demo) |
| `workspace.slaDueSoonDays` | Application SLA "due soon" window | 2 days | Tenant parameter (demo) |
| `workspace.taskDueSoonDays` | Task "due soon" window | 1 day | Tenant parameter (demo) |
| `workspace.highPriorityAmountNgn` | Approvals above this amount are High priority | ₦1,000,000,000 | Tenant parameter (demo) |
| `workspace.stalledStageDays` | AI flag: application not updated for this many days | 7 | Tenant parameter (demo) |
| `workspace.inflowShortfallRatio` | AI flag: verified ÷ declared turnover below this | 0.6 | PRD §6.4.3 — demo value |
| `workspace.nplAlertPct` | NPL tile turns red above this ratio | 5% | Tenant parameter (demo) |
| `workspace.decisionsWindowDays` | "My decisions" window | 30 days | Tenant parameter (demo) |
| `workspace.activityWindowHours` | Admin audit-activity window | 24 h | Tenant parameter (demo) |
| `approvals.stepUpThresholdNgn`, `rar.*`, `origination.products` | Shown on the dashboard config glance / priority | — | Platform / other modules |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| none | Workspace has no approvals of its own; it lists Operations approvals and requests | — | `workspace/platform.ts` |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| none | Workspace sends none; it displays notifications from other modules | — |

## 7. Events and hook points

| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `workspace.task.completed` | Task marked done | `taskId` |
| event | `workspace.task.reopened` | Task reopened | `taskId` |
| event | `workspace.ai-flag.signed-off` | AI flag signed off | `by` |
| event | `workspace.ai-flag.dismissed` | AI flag dismissed | `by` |
| hook (before) | `workspace.task.update.before` | Before done / reopen | Veto (e.g. evidence required) |
| hook (after) | `workspace.task.update.after` | After status change | Observe |
| hook (before) | `workspace.ai-flag.review.before` | Before sign-off / dismiss | Veto |
| hook (after) | `workspace.ai-flag.review.after` | After sign-off / dismiss | Observe |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Backend task / notification APIs | Inbound / outbound | Load; done / reopen; mark-read | Tasks, notifications | BACKEND SEAM — shared spine store |
| AI flagging service (§6.12) | Inbound | Dashboard load | Flags | Simulated (rules over spine data) |

## 9. Non-functional

- User scope: tasks and notifications are role-scoped (not user-scoped); approvals via `canDecide`; activity filtered unless the role can access Audit.
- Audit: task status changes and AI flag reviews audited; mark-read is not.
- Demo clock: `DEMO_NOW` for ageing / due logic.

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| PF7 | Executive / dashboard sign-off of AI items by role | Role-based sign-off (executive module) |
| W3 | Credit tier numbering vs chart-flow tier | Dashboard shows chart-flow tier (`flowTierOf`) |
| — | Who signs off a dashboard AI flag, and is it per user or per role? | Any user who sees it; state kept per browser (no open-question ID yet) |
