# Operations (platform engine) — requirements

| | |
|---|---|
| Module | `src/modules/operations` + platform engine `src/lib/platform/*` (`operations.ts`, `core.ts`, `rules.ts`, `notifications.ts`, `events.ts`, `hooks.ts`, `scope.ts`, `registry.ts`) |
| Repo | credigit-ser-frontend |
| PRD | §4.2 (sign-on limits, step-up, dissent → adjudicator, segregation of duties), §6.1.2 (co-signer / adjudicator pattern), §10.1 (audit), §10.3 (auditability), §10.4 (configurability with second-person confirmation); Engineering README §4.2 (integration events / outbox) |
| Owner (business) | System Admin (tenant configuration, PRD §10.4); Head of Risk / CRO (default reviewers of configuration changes — assumption, W1) |
| Counterpart | [credigit-ser-core-backend `docs/modules/Operations/`](../../../../credigit-ser-core-backend/docs/modules/Operations/) (being written); see also backend [ADR-0005 operations parity](../../../../credigit-ser-core-backend/docs/adr/0005-operations-engine-parity.md), [ADR-0009 SLA escalation](../../../../credigit-ser-core-backend/docs/adr/0009-operations-sla-escalation.md) |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

The "Operations" workflow is the single approval engine required by invariant 9: every module registers operation types with a configurable workflow (steps, approver roles, co-sign mode, SLA, adjudicator) and an `apply` action that runs only after final approval. The same area hosts the platform services every feature depends on: the business-rules registry (invariant 8), notification templates and outbox, domain events and hook points (extensibility), and user scope.

- In scope: operation registry, submit / decide / return / withdraw, segregation of duties, co-sign + adjudication, step-up above threshold, SLA due time and overdue escalation, tenant workflow overrides, business rules (typed, bounded, approved changes, history), notification templates (HTML, approved wording changes, test send, outbox), event catalogue + log, hook points + handlers, extension enable/disable, the Operations UI (`/operations/*`).
- Out of scope: module-specific operation types (documented in each module's docs), credit chart-flow tier rules (origination), user/role administration (admin), real email/SMS delivery and external event transport (backend).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Every signed-in user | Own approval queue, own requests, withdraw own requests, open items, see events they caused and mail addressed to them | `operations.queue.view`, `operations.requests.view`, `operations.items.decide`, `operations.items.withdraw`, `operations.workflows.view`, `rules.rules.view`, `rules.history.view`, `notifications.templates.view`, `notifications.templates.preview`, `operations.catalogue.view`, `operations.catalogue.export`, `operations.events.view`, `identity.roles.view`, `identity.permissions.view` |
| System Admin, CRO, Head of Risk (`operations: "edit"` in `roles.ts`) | Request rule / workflow / template changes, toggle extensions, see every event and the full outbox | `rules.rules.request-change`, `operations.workflows.request-change`, `notifications.templates.request-change`, `operations.extensions.toggle`, `operations.oversight.view` |
| Roles in rule `operations.testSendRoles` | Send a template test to themselves | `notifications.templates.test` |
| Approvers named in a workflow step | Decide the step (approve / reject / return); adjudicate dissent | `operations.items.decide` (eligibility still decided by the workflow step + SoD, invariant 12) |

## 3. Functional requirements

| ID | Requirement | Source |
|---|---|---|
| OPS-FR-01 | Modules register operation types with a default workflow (steps: approver roles, mode any/all, SLA hours, optional adjudicator) and an `apply` / `onReject` action. | Invariant 9; FRONTEND-CONVENTIONS "Platform services" |
| OPS-FR-02 | Submitting runs `operations.submit.before` (veto / enrich), creates the instance with a snapshot of the steps, audits, publishes, notifies eligible approvers; a disabled workflow or one with no steps applies immediately. | Invariant 9 |
| OPS-FR-03 | The requester can never decide their own operation; one person decides at most one step unless the type allows repeat approvers. | PRD §4.2 (SoD); ADR-0005 |
| OPS-FR-04 | "All" steps wait for every role; a split goes to the step's adjudicator, otherwise rejects; a tied approval never sits idle. | PRD §4.2, §6.1.2 |
| OPS-FR-05 | Approving an operation above `approvals.stepUpThresholdNgn` needs step-up re-authentication (OTP / PIN). | PRD §4.2 |
| OPS-FR-06 | Reject and return need a comment of at least `operations.minCommentLength` characters (on approve too when `operations.commentAlwaysRequired`). | Assumption (demo rule) |
| OPS-FR-07 | Approvers may approve, reject or return; requesters may withdraw an open request with a reason. | Invariant 9; O7 (return resets the route) |
| OPS-FR-08 | Approvals queue (operations the user may decide now), My requests, and an item page with timeline, decisions, payload facts, SLA due time and amber warning within `operations.slaWarningHours`. | Invariant 9 (user-scoped) |
| OPS-FR-09 | An overdue step is escalated once per step (event `operations.sla.breached` + `operations.sla-overdue` notification). | Assumption — PRD defines no Operations escalation target (backend ADR-0009) |
| OPS-FR-10 | Workflow definitions are tenant configuration; edits (steps, approvers, SLAs, enabled) go through `workflow.change`; in-flight requests keep their original route. | PRD §10.4; invariant 9 |
| OPS-FR-11 | Every limit / threshold / rate / duration / mapping is a typed rule (default, bounds, unit, PRD source); changes go through `rule.change` (second-person approval) and keep a history. | PRD §10.4; invariant 8 |
| OPS-FR-12 | Notification templates (subject, HTML body with `{{vars}}`, in-app text, tone, documented variables) are registered per module; wording changes go through `template.change`; emails are rendered in the tenant brand into an outbox; users can send a test to themselves. | Invariant 9 (notified) |
| OPS-FR-13 | Event catalogue + event log (wildcard subscriptions) and hook-point catalogue + handlers are browsable; enabling / disabling an extension goes through `extension.toggle`. | Invariant 9 (extensible) |
| OPS-FR-14 | Every transition (submit, decision, final status, rule / workflow / template / extension change, notification sent) writes to the audit log. | PRD §10.1, §10.3 |
| OPS-FR-15 | Event and hook points must be reachable by external systems (outbound webhooks / message publisher, inbound APIs). | Invariant 9 (externally reachable) — not met in the prototype |
| OPS-FR-16 | An operation item (`/operations/item?id=`) is visible only to its requester, anyone who decided a step, holders of a role named as approver / adjudicator in any of its (snapshotted) steps, and Operations oversight (`operations: "edit"` today; permission `operations.oversight.view` once the IAM catalogue lands). Anyone else sees "no access"; the denied attempt is audited and published (`operations.request.access-denied`). | Invariant 9 (user-scoped), invariant 12 |
| OPS-FR-17 | Final approval is atomic: the instance becomes **Approved** only after `apply` succeeds. If `apply` throws, the instance becomes **Failed** (reason = error), the failure is audited (before / after status), published (`operations.request.failed`) and the requester and the deciding approver are notified (`operations.apply-failed`). A failed request is closed; the requester resubmits after the cause is fixed. | Invariant 9 (audited, notified); backend ADR-0005 parity |
| OPS-FR-18 | Notifications addressed to users (`notify({ toUserIds })`) are personal: one in-app notification per addressed user, shown only to that user. Role broadcasts (`toRoles`) stay visible to the whole role. Read state is per user (`readBy`); marking read is audited and published (`platform.notification.read`). | Invariant 9 (user-scoped, audited) |
| OPS-FR-19 | The item page shows the route snapshotted on the instance (`instance.steps`), not the live definition, and decides "needs step-up" with the engine rule (`requiresStepUp`: `amountNgn` above threshold) as well as the largest amount in the payload. | OPS-FR-02, OPS-FR-05 |

## 4. Business rules and parameters

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `approvals.stepUpThresholdNgn` | Decisions above this amount need step-up | ₦100,000,000 | PRD §4.2 (demo value; W2, DS1) |
| `operations.minCommentLength` | Comment length for reject / return | 10 | Tenant parameter (demo) |
| `operations.commentAlwaysRequired` | Comment also required on approve | false | Tenant parameter (demo) |
| `operations.defaultSlaHours` | SLA for new workflow steps | 24 h | Tenant parameter (demo) |
| `operations.slaWarningHours` | Amber warning window before SLA | 4 h | Tenant parameter (demo) |
| `operations.rulesPageSize` | Rules listed before "Show more" | 60 | Tenant parameter (demo) |
| `operations.testSendRoles` | Roles that may send template tests | System Admin, CRO, Head of Risk | Tenant parameter (demo) |
| `operations.extensionToggleApproverRoles` | Approvers of `extension.toggle` | System Admin, CRO | Tenant parameter (demo) |
| `operations.extensionToggleSlaHours` | SLA of `extension.toggle` | 24 h | Tenant parameter (demo) |
| `operations.example.largeExposurePct` | Example hook: flag amounts ≥ this % of shareholders' funds | 10% | PRD §6.6.2 / §8 |

Also registered in `core.ts` but owned by other modules: `session.*`, `auth.*` (auth), `platform.shareholdersFundsNgn` (portfolio / capital), `rar.*` (credit-analysis), `rbac.limit.<role>` (admin, PRD §4.1–4.2).

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `rule.change` | Business rules → Request change (also Admin → Rules & parameters) | Risk review: any of Head of Risk, CRO · 24 h → Confirmation: any of System Admin, CRO · 24 h | PRD §10.4; assumption W1 |
| `workflow.change` | Workflows → edit steps / enable | Head of Risk / CRO review · 48 h | Assumption (no PRD approver) |
| `template.change` | Notifications → edit wording | Compliance / risk review: Head of Risk, CRO · 48 h | Assumption |
| `extension.toggle` | Events & hooks → enable / disable | Platform owner approval: rule `operations.extensionToggleApproverRoles` · rule SLA | Assumption |
| `access.request` (platform; owned by auth / admin) | Registration after email verification | System Admin approval · 48 h | PRD §4 |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `operations.approval-requested` | Submission / next step reached / co-signer pending / adjudication | Active users holding an acting role, minus requester and prior deciders |
| `operations.request-completed` | Approved / rejected / returned / cancelled | Requester |
| `operations.apply-failed` | Final approval recorded but `apply` threw (instance → Failed) | Requester + deciding approver (personal) |
| `operations.sla-overdue` | Eligible approver opens an overdue item (once per step) | Acting roles of the current step |
| `operations.workflow-changed` | `workflow.change` applied | System Admin, Head of Risk, CRO |
| `operations.template-changed` | `template.change` applied | System Admin, Head of Risk |
| `rules.changed` | `rule.change` applied | System Admin, Head of Risk, CRO |
| `operations.extension-toggled` | `extension.toggle` applied | Approver roles rule + requester |

(`auth.access-requested`, `auth.password-changed` are defined in `core.ts` for the auth module.)

## 7. Events and hook points

| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `operations.request.submitted` | Instance created | `operationType`, `subject` |
| event | `operations.step.decided` | Decision recorded | `stepId`, `decision`, `roleId` |
| event | `operations.step.dissent` | Co-signers split | `stepId`, `adjudicator` |
| event | `operations.request.approved` / `.rejected` / `.returned` / `.cancelled` | Final status (approved only after `apply` succeeded) | `operationType`, `subject` |
| event | `operations.request.failed` | `apply` threw after final approval | `operationType`, `subject`, `error` |
| event | `operations.request.access-denied` | A user without visibility opened an item | `operationId` |
| event | `platform.notification.read` | A user marked notifications read | `count` |
| event | `operations.workflow.changed` | Workflow override applied | `version`, `steps`, `enabled` |
| event | `operations.template.changed` | Template override applied | — |
| event | `operations.template.tested` | Template test sent | `templateId` |
| event | `operations.extension.toggled` | Extension toggled | `kind`, `enabled`, `operationId` |
| event | `operations.sla.breached` | Overdue item opened by an approver | `key`, `stepId`, `dueAt` |
| event | `rules.rule.changed` | Rule value applied | `before`, `after` |
| event | `platform.notification.sent` | `notify()` ran | `recipients` |
| hook (before) | `operations.submit.before` | Before an instance is created | Veto; enrich payload |
| hook (after) | `operations.submit.after` | After creation + notification | Observe |
| hook (before) | `operations.decide.before` | Before a decision is recorded | Veto (e.g. credit controls, SoD checks of other modules) |
| hook (after) | `operations.decide.after` | After a decision | Observe |
| hook (before) | `operations.extension.toggle.before` | Before an extension toggle request | Veto |
| hook (before) | `operations.template.test.before` | Before a template test | Veto; enrich data |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Backend Operations API (workflow engine) | Outbound / inbound | submit, decide, withdraw, queue, definitions | Operation instances, definitions | BACKEND SEAM — local zustand store today |
| Rules & Parameters Engine API | Inbound / outbound | Rule read; approved change | Rule values, history | BACKEND SEAM — local store |
| Notification service (email / SMS / in-app) | Outbound | `notify()` | Rendered HTML email per recipient | Simulated — outbox "Queued (demo — not sent)" |
| Event outbox / webhooks / message publisher | Outbound | `publish()` | Domain events | Not built — in-browser log only (README §4.2) |
| Inbound action APIs for external systems | Inbound | — | — | Not built |

## 9. Non-functional

- Audit: every transition audited by the engine (`useDb.log`), but entries carry no before/after state snapshot of the instance and no "where" (device / IP) (PRD §10.1).
- User scope: queue filtered by `canDecide`; requests by requester; item page by `canViewOperation` (OPS-FR-16); personal notifications by addressee (OPS-FR-18); event log and outbox filtered unless `operations: "edit"`.
- Tenant isolation: actor carries `tenantId`; single demo tenant, no tenant filter on stores.
- Security: step-up is a UI flag (`stepUpVerified`); backend verifies from token claims (ADR-0005, BE-02).
- Bounded browser logs: 500 events, 300 outbox items (demo only; backend keeps the full outbox).

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| W1 | Who gives the second-person confirmation for regulatory-parameter changes (PRD §10.4)? | `rule.change`: Head of Risk / CRO review → System Admin / CRO confirmation |
| W2 / DS1 | Step-up threshold default (§4.2) | ₦100m |
| O7 (§4.2) | Do signatures survive a return? | Return resets the route |
| TD-128 | Module-owned rules can also change via generic `rule.change`, bypassing module workflows | Open (tech debt) |
| — (backend ADR-0009) | Escalation target for overdue Operations steps is not defined by the PRD | Acting roles notified once per step |
