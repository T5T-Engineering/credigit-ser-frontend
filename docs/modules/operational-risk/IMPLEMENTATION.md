# Operational risk — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

Four pages compose `@credigit/web-ui` components. State lives in a persisted zustand store (`store.ts`, `credigit.ser.operational-risk`, v2) seeded from deterministic generators in `data.ts` (KRI definitions and 48-month histories, loss events, RCSA risks, BCM plans / exercises, fire drills, crisis checklist). Derived figures (KRI readings, RAG, escalation level, RCSA bands, BCM targets) are in `logic.ts`, reading rules at call time. Platform registrations are in `platform.ts`. **Commands live inside the page components** (no service layer): each action runs hooks → store update → `useAuditLog` / `logAudit` → `publish` → `notify`. Approvals go through `submitOperation`; `apply` handlers in `platform.ts` write the store / rules. `operation-ui.tsx` and `shared.ts` are reused by the enterprise-risk and AI modules.

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/operational-risk/platform.ts` | Rules (`orKeys`), 4 operation types, 3 templates, `notifyLossThresholds`, 14 events, 6 hook points, subscription `operational-risk.adopt-kri-commentary` |
| `src/modules/operational-risk/logic.ts` | `readKris` / `useKriReadings`, `escalationLevels`, `kriThresholds`, `scoreBand`, `riskScales`, `scoreLegend`, `planTargets` |
| `src/modules/operational-risk/data.ts` | Indicator categories, KRI specs, loss events, RCSA, BCM seed, Basel event types, business lines, `rcsaCycle` |
| `src/modules/operational-risk/store.ts` | `useOpRisk` (lossEvents, rcsa, bcmPlans, exercises, escalations, commentarySignedOffBy) |
| `src/modules/operational-risk/shared.ts` | PRNG, month labels, `useAuditLog`, `logAudit`, correlation (`pearson`, `bestLag`) |
| `src/modules/operational-risk/operation-ui.tsx` | `PendingBadge`, `SubmitOutcome`, `OperationRow` compositions |
| `src/modules/operational-risk/pages/kri-page.tsx` | KRI register, escalation, acknowledgement, threshold proposals, correlation / AI commentary |
| `src/modules/operational-risk/pages/loss-events-page.tsx` | Loss register, log / status / recovery / closure, loss-limit utilisation |
| `src/modules/operational-risk/pages/rcsa-page.tsx` | RCSA register, heat map, self-assessment, actions, sign-off |
| `src/modules/operational-risk/pages/bcm-page.tsx` | BCM plans, exercises, fire drills, readiness index, plan review |

## 3. Routes / endpoints / public API

| Route | Page | Menu entry |
|---|---|---|
| `/operational-risk` | `KriPage` | Operational risk → KRIs |
| `/operational-risk/loss-events` | `LossEventsPage` | Loss events |
| `/operational-risk/rcsa` | `RcsaPage` | RCSA |
| `/operational-risk/bcm` | `BcmPage` | BCM & crisis |

Exports used elsewhere: `useOpRisk`, `netLoss`, `useKriReadings`, `shared.ts` helpers, `operation-ui.tsx` (enterprise-risk, ai, executive).

## 4. Data model

| Entity | Key fields |
|---|---|
| `Kri` (code) | id, name, category, owner, ownerTitle, formula, source, frequency, unit, decimals, higherIsWorse, amber, red (defaults), history (48 months) |
| `KriEscalation` (store) | kriId, level 1–4, escalatedById, acknowledgedBy / Id / At, note |
| `LossEvent` (store) | id, title, description, eventType (Basel), category, businessLine, branch, occurredAt, discoveredAt, grossLoss, recovery, nearMiss, rootCause, controlId, status (Reported / Under investigation / Remediation / Closed), source, reportedBy / Id, actionPlan, writeOff, closedBy |
| `RcsaRisk` (store) | id, title, category, businessUnit, controlOwner, inherent / residual {likelihood, impact}, controls[] (design / operating effectiveness), kriIds[], actions[], status (Not started / In progress / Submitted / Reviewed), submittedBy / Id, reviewedBy, assessedAt |
| `BcmPlan` (store) | id, process, tier 1–3, owner, rtoTargetHrs, rtoAchievedHrs, rpoTargetMins, rpoAchievedMins, lastReviewed, nextReview, lastTest, lastResult, alternateSite, approvedBy |
| `BcmExercise` (store) | id, type, scope, date, result, findings |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `operational-risk.kri.*.amber/red` | `logic.kriThresholds`, `readKris` |
| `operational-risk.kri.escalation.level*Roles` | `logic.escalationLevels`, `kri-page.tsx` (notify) |
| `operational-risk.loss.*` | `logic.lossKriHistory` (monthly), `platform.notifyLossThresholds`, `loss-events-page.tsx` |
| `operational-risk.rcsa.*` | `logic.scoreBand`, `riskScales`, `scoreLegend`, `rcsa-page.tsx` |
| `operational-risk.bcm.*` | `logic.planTargets`, `bcm-page.tsx`, `platform.ts` (plan approval: `reviewCycleDays`) |

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| none — module access only | `useCan("operational-risk", "edit")` in all four pages; `operational-risk.*` catalogue keys not checked |

## 7. Workflows, notifications, events, hooks wired

| Item (REQUIREMENTS §) | Code location |
|---|---|
| `operational-risk.kri.threshold-change` (§5) | `platform.requestKriThresholdChange` ← `kri-page.tsx` |
| `operational-risk.loss-event.closure` (§5) | `loss-events-page.tsx` `submitOperation` |
| `operational-risk.rcsa.sign-off` (§5) | `rcsa-page.tsx` `submitOperation` |
| `operational-risk.bcm.plan-approval` (§5) | `bcm-page.tsx` `submitOperation` |
| `operational-risk.kri-red-breach` (§6) | `kri-page.tsx` escalate |
| `operational-risk.loss-above-threshold` (§6) | `platform.notifyLossThresholds` ← `loss-events-page.tsx` log |
| `operational-risk.bcm-test-failed` (§6) | `bcm-page.tsx` exercise |
| Events (§7) | `publish` in pages and `apply` handlers |
| Hooks (§7) | `runHooks` in `kri-page.tsx` (escalate), `loss-events-page.tsx` (log), `bcm-page.tsx` (exercise) |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/risk/operational-risk.spec.ts` | Loss above single-event threshold logged and escalation roles notified; KRI threshold change approved in Operations and applied (mobile); cancelling a threshold proposal; RCSA second-line sign-off through Operations |
| `e2e/risk/pages-load.spec.ts` | Pages render |
| Unit tests | none |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| OPR-FR-01 | `data.ts` KRI specs, `kri-page.tsx` | pages-load | Partial — KRI definitions are code, not tenant-editable |
| OPR-FR-02 | `logic.readKris` + rules | operational-risk.spec | Done |
| OPR-FR-03 | `kri-page.tsx` escalate / acknowledge | — | Partial — level from months outside green, no SLA clock (TD-904); control owner not notified (names only, no user) |
| OPR-FR-04 | `kri-page.tsx` correlation (`shared.bestLag`) + AI commentary via `ai.output.sign-off` | — | Done (simulated AI) |
| OPR-FR-05 | Threshold workflow | operational-risk.spec | Partial — thresholds only; KRI universe / owners / formulas have no change workflow |
| OPR-FR-06 | `data.indicatorCategories` | — | Done |
| OPR-FR-07 | `loss-events-page.tsx` | operational-risk.spec | Partial — only direct logging is live; other sources seeded |
| OPR-FR-08 | `notifyLossThresholds`, utilisation view | operational-risk.spec | Partial — single-event / Board notify on logging; annual / monthly limit breach is shown but not escalated |
| OPR-FR-09 | `operational-risk.loss-event.closure` | — | Done |
| OPR-FR-10 | `rcsa-page.tsx` | — | Partial — cadence from `rcsa.cycleMonths`, but the current cycle name / open / close dates are the code literal `rcsaCycle` |
| OPR-FR-11 | `operational-risk.rcsa.sign-off` | operational-risk.spec | Done |
| OPR-FR-12 | `bcm-page.tsx` readiness index | — | Done (demo data) |
| OPR-FR-13 | `bcm-page.tsx` exercise + notify | — | Done |
| OPR-FR-14 | `operational-risk.bcm.plan-approval` | — | Done |

## 10. Gaps against the invariants

- Invariant 12: no named permission checks; `useCan("operational-risk","edit")` only; System Admin has no module access in `roles.ts`.
- Invariant 9 (extensible): no hook points for KRI acknowledge, threshold request, loss status / recovery / closure request, RCSA start / submit / action, BCM plan submit; RCSA "started" publishes no event.
- Invariant 9 (notified): KRI Amber Level 1 has no control-owner recipient (owners are names, not users); RCSA submission, loss closure and BCM plan approval outcomes rely only on generic Operations notices.
- Invariant 9 (workflow): KRI universe changes (designation, owner, formula) — required by §6.9.1 governance — have no Operations workflow.
- Invariant 8: `rcsaCycle` name / dates, `LAST_MONTH`, Basel event types, business lines and KRI definitions are code literals without TD ids (only TD-901 / TD-904 recorded); op-loss appetite thresholds are owned by executive rules (TD-508).
- Design: domain commands sit in page components, not a service seam (harder to move to the backend).
- Invariant 9 (connector-ready): HRIS, security, SIEM, CRM, IT-monitoring and CBA-log sources are recorded in [`docs/integration-points.md`](../../integration-points.md) (§9); simulated.
- No unit tests.

## 11. Tech debt

| TD id | Summary |
|---|---|
| TD-901 | Seed BCM next-review dates use a 365-day literal (seed only) |
| TD-904 | KRI escalation level derived from months outside green; no per-level SLA clocks |
| TD-508 | Op-loss appetite threshold defined as an executive rule instead of in this module |
| TD-854 | Sanction-for-breach loss-event reference simulated (credit-admin → op-risk) |
