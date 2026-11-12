# Loan review & monitoring — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

Pages (`pages/*`) compose `@credigit/web-ui` components and call **commands in `service.ts`** (the backend seam). Each command: hook point `.before` (veto / enrich) → zustand store update (`store.ts`, persisted as `credigit.ser.monitoring`) → audit (`auditAs`) → domain event → notification → hook `.after`. Approvals go through `submitOperation`; the operation `apply` handlers in `platform.ts` load `service.ts` lazily and call `applyResolution`, `escalateException`, `applyApgRelease`. Pure rule-driven logic (DPD ladder, escalation ladder, business days, nature of business) lives in `logic.ts`; deterministic demo registers (covenants, inflows, periodic reviews, agents' fees, APGs, TODs) in `data.ts`, derived from the shared Risk Data Spine (`useFacilities`, `useObligors`).

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/monitoring/platform.ts` | Rules, 3 operation types, 4 templates, 15 events, 8 hook points |
| `src/modules/monitoring/service.ts` | Commands (raise, escalate, sweep, request escalation / resolution, covenant test, periodic financials, APG / TOD, assignment, notes, AI sign-off) |
| `src/modules/monitoring/logic.ts` | DPD buckets, CBN class / provision, exception types, escalation ladder, business days, Nature-of-Business |
| `src/modules/monitoring/store.ts` | Exceptions, notes, assignments, covenant tests, APG / TOD actions, AI sign-offs; seed of exceptions (TD-603) |
| `src/modules/monitoring/data.ts` | Demo generators: covenants, inflow profiles, periodic reviews, agents' fees, APGs, TODs |
| `src/modules/monitoring/hooks.ts` | Reactive rule-derived ladders (`useLadder`, `useDpdLadder`) |
| `src/modules/monitoring/audit.ts` | `auditAs` / `useAuditLog` (shared with collateral, connectors) |
| `src/modules/monitoring/raise-exception.tsx` | Raise-exception modal composition |
| `src/modules/monitoring/pending-approval.tsx` | "Awaiting approval" panel composition (shared with collateral, connectors) |
| `src/modules/monitoring/pages/*.tsx` | Five pages (below) |
| `src/app/(app)/monitoring/**/page.tsx` | Thin route files |

## 3. Routes / endpoints / public API

| Route | Page | Menu entry |
|---|---|---|
| `/monitoring` | `PastDuePage` | Loan review & monitoring → Past-due obligations |
| `/monitoring/covenants` (`?tab=register\|inflows\|periodic\|fees`) | `CovenantsPage` | Covenants & inflows |
| `/monitoring/guarantees` | `GuaranteesPage` | Guarantees & overdrafts |
| `/monitoring/exceptions` (`?id=EXC-…`) | `ExceptionsPage` (board + ageing report CSV export) | Exceptions & escalations |
| `/monitoring/escalation` | `EscalationPage` (ladder from rules; change via `rule.change`) | Escalation protocol |

Public API used by other modules: `raiseException`, `openExceptionFor`, `useMonitoring`, `exceptionHref`, `PendingApproval`, `auditAs`, DPD helpers in `logic.ts`.

## 4. Data model

| Entity / store | Key fields |
|---|---|
| `MonitoringException` (store) | id, type (10 `ExceptionType`s), title, detail, obligorId, facilityId?, collateralId?, amount?, source (Rule / AI-flagged / Manual), raisedAt, level 1–4, status (Raised / Under review / Escalated / Resolved), slaDueAt, assigneeId?, evidence?, history[], comments[] |
| `notes`, `assignments` (store) | per facility |
| `covenantTests` (store) | status, at, by, result, evidence, nextTestAt (also `PR-<obligorId>` for periodic financials) |
| `apgActions`, `todActions`, `aiSignoffs` (store) | status / decision, at, by, note |
| `Covenant`, `InflowProfile`, `PeriodicReview`, `AgentFee`, `Apg`, `Tod` (`data.ts`) | Generated from spine facilities / obligors |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `monitoring.dpd.*`, `monitoring.cbn.*ProvisionPct` | `logic.ts` (`dpdThresholds`, `dpdBuckets`, `provisionLabel`, `isNonPerforming`, `isWatchlist`) |
| `monitoring.escalation.l{n}SlaBusinessDays`, `l{n}Roles`, `boardRoles`, `boardMaterialityNgn` | `logic.ts` (`slaBusinessDays`, `ladderRoles`, `rolesUpTo`, `escalationLadder`); `escalation-page.tsx` |
| `monitoring.exceptions.evidenceRequiredTypes` | `logic.ts` (`evidenceRequired`), `exceptions-page.tsx` |
| `monitoring.exceptions.minEvidenceLength` / `minDetailLength` / `minReasonLength` | `service.ts`, `raise-exception.tsx`, `exceptions-page.tsx`, `covenants-page.tsx`, `guarantees-page.tsx`, `past-due-page.tsx` |
| `monitoring.inflow.envelopeBandPct`, `offSeasonIndexBelow` | `data.ts`, `covenants-page.tsx` |
| `monitoring.nature.*` | `logic.ts` (`natureOfSector`) |
| `monitoring.covenant.dueSoonDays` | `covenants-page.tsx` |
| `monitoring.periodic.nextDueDays` | `service.ts` (`recordPeriodicFinancials`) |
| `monitoring.apg.expiryWarningDays`, `monitoring.tod.*` | `data.ts`, `guarantees-page.tsx` |
| `monitoring.assignment.roles` | `past-due-page.tsx` |

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| none — module access only | `useCan("monitoring", "edit")` in every page hides actions; `escalation-page.tsx` uses `useCan("operations", "edit")` for rule-change requests; view access from `src/lib/rbac/roles.ts`. Catalogue keys (`monitoring.*`) are not checked yet. |

## 7. Workflows, notifications, events, hooks wired

| Item (REQUIREMENTS §) | Code location |
|---|---|
| `monitoring.exception.resolve` (§5) | `platform.ts` → `service.requestResolution` / `applyResolution` / `resolutionRejected` |
| `monitoring.exception.escalate` (§5) | `platform.ts` → `service.requestEscalation` / `escalateException` |
| `monitoring.apg.release` (§5) | `platform.ts` → `service.requestApgRelease` / `applyApgRelease` |
| SLA sweep (§5) | `service.runEscalationSweep` — triggered by a button on the exceptions page |
| Templates (§6) | `service.notifyLevel` (raised / escalated / resolved), `recordCovenantTest` (covenant-breached) |
| Events (§7) | `publish(...)` in each `service.ts` command |
| Hooks (§7) | `runHooks` in `raiseException`, `escalateException`, `requestResolution` / `applyResolution`, `recordCovenantTest` |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/risk/monitoring.spec.ts` | Raise from past-due → manual escalation (Head of Risk) → resolve with evidence (CCO); covenant test with evidence; board move menu / evidence prompt (mobile); drag to Under review; view-only role sees no actions |
| `e2e/risk/pages-load.spec.ts` | Pages render |
| Unit tests | none (vitest configured, no test files) |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| MON-FR-01 | `past-due-page.tsx` (spine facilities, CSV export) | pages-load | Partial — demo data, no CBA feed |
| MON-FR-02 | `logic.ts` DPD ladder | monitoring.spec (indirect) | Done |
| MON-FR-03 | `service.assignFacility`, `addFacilityNote` | — | Done |
| MON-FR-04 | `guarantees-page.tsx`, `service.setApgStatus`, `requestApgRelease` | — | Done (demo data) |
| MON-FR-05 | `data.buildTods`, `service.setTodStatus` | — | Done (demo data) |
| MON-FR-06 | `covenants-page.tsx`, `service.recordCovenantTest` | monitoring.spec | Partial — breach notifies but the breach exception is raised from the UI, not automatically by the command |
| MON-FR-07 | `data.buildInflowProfiles`, `logic.natureOfSector` | — | Partial — profile derived from sector (MON4) |
| MON-FR-08 | Inflows tab + `service.signOffAiFlag` | — | Done (simulated AI) |
| MON-FR-09 | Fees tab (`data.buildAgentFees`) | — | Partial — read-only, no reconciliation action |
| MON-FR-10 | Periodic tab, `service.recordPeriodicFinancials` | — | Done (demo) |
| MON-FR-11 | `service.escalateException`, `runEscalationSweep`, `logic.ladderRoles` | monitoring.spec | Partial — sweep is manual, no scheduler |
| MON-FR-12 | `service.requestResolution` + rule | monitoring.spec | Done |
| MON-FR-13 | `service.notifyLevel` | — | Partial — role-wide notification plus assignee, not only officers tagged to the obligor |
| MON-FR-14 | `MonitoringException.history`, ageing CSV | — | Done |
| MON-FR-15 | — | — | Missing |
| MON-FR-16 | `platform.ts` operations | monitoring.spec | Done |

## 10. Gaps against the invariants

- Invariant 12: no named permission checks (`monitoring.*` catalogue keys); `useCan("monitoring","edit")` only; System Admin has no monitoring access in `roles.ts`.
- Invariant 9 (extensible): no hook points around APG / TOD status changes, assignment, notes, comments, AI sign-off, periodic financials; no `monitoring.apg.release-requested` event.
- Invariant 9 (notified): APG crystallise / call / release, TOD regularise / convert, and assignment send no notifications; recipients outside the ladder are code lists (TD-604).
- Invariant 9 (workflow): TOD "converted to facility" is a direct action although conversion implies a credit decision (not routed through Operations).
- Invariant 8: exception type list and covenant frequency months are code literals without TD id; `evidenceRequiredTypes` default says "Limit near-breach" where the PRD says "limit breach".
- Invariant 9 (connector-ready): CBA, other-bank and document connectors are recorded in [`docs/integration-points.md`](../../integration-points.md) (§1, §2, §8); simulated, no Connectors framework yet (TD-967).
- MON-FR-15 (feed to op-risk loss-event register) not built; SLA sweep has no scheduler (manual button).
- No unit tests.

## 11. Tech debt

| TD id | Summary |
|---|---|
| TD-602 | Default approver roles of the monitoring operation types are proposals (MON1–MON3) |
| TD-603 | Seed generators contain demo-shape constants |
| TD-604 | Notification recipient roles outside the escalation ladder are code lists |
