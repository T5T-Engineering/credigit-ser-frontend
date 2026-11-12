# IFRS 9 & ICAAP — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

Client-side engine over the shared Risk Data Spine (facilities, obligors, collateral, sectors). `data.ts` holds pure functions (`runEcl`, `eclFor`, `summariseByStage`, `capitalBase`, `classifyCar`, `eligibility`, …) that read every parameter with `getRule` at call time; `use-ecl.ts` re-runs them when the spine or any rule changes. Module records (models, stress runs, declassifications, postings, ICAAP approvals) live in a persisted zustand store. Every approval is an Operations operation whose `apply` performs the change; pages request operations through `useSubmitOperation()` (`governance.tsx`) and wrap each request with module hook points, audit and an event.

```text
pages/*.tsx ──► use-ecl.ts ──► data.ts (engine, getRule)        ◄── platform.ts (rules)
     │                                                              │
     └─► governance.tsx (submit, RulesPanel, ModuleApprovals) ──► Operations engine ──► platform.ts apply() ──► store.ts / spine
```

Market-risk reuses `usdNgn()`, `round`, `sum` and the capital base from this module.

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/ifrs9/platform.ts` | Rules, 5 operation types, 7 templates, 16 events, 14 hook points, 2 event subscribers |
| `src/modules/ifrs9/data.ts` | ECL / staging / prudential / capital / cure engine, seed models, source mapping, scenarios, supervisory checklist |
| `src/modules/ifrs9/store.ts` | Persisted module store `credigit.ser.ifrs9` (v2) |
| `src/modules/ifrs9/use-ecl.ts` | `useEngineInput()`, `useEcl()` hooks |
| `src/modules/ifrs9/governance.tsx` | `RulesPanel`, `PendingNotice`, `useSubmitOperation`, `ModuleApprovals`, `useRulesVersion` |
| `src/modules/ifrs9/common.tsx` | `useAuditLog`, `CalcPopover` / `CalcRegister`, `DemoNote`, number helpers |
| `src/modules/ifrs9/parts.tsx` | `StageBadge`, `EclTable`, `EclDetailDrawer` compositions |
| `src/modules/ifrs9/pages/overview.tsx` | ECL overview, IFRS vs prudential reconciliation, reserve-posting request |
| `src/modules/ifrs9/pages/staging.tsx` | CBN ↔ stage matrix, SICR triggers, stage transfers |
| `src/modules/ifrs9/pages/models.tsx` | Model register, version submission, AI finding sign-off |
| `src/modules/ifrs9/pages/icaap.tsx` | Capital adequacy, stress test, scenario change, ICAAP submission |
| `src/modules/ifrs9/pages/declassification.tsx` | Candidates, proposals, withdraw, history |
| `src/modules/ifrs9/pages/governance.tsx` | Rules & approvals page |

## 3. Routes / endpoints / public API

| Route | Page component | Menu entry (nav.ts) |
|---|---|---|
| `/ifrs9` | `Ifrs9OverviewPage` (`pages/overview.tsx`) | IFRS 9 & ICAAP → ECL overview |
| `/ifrs9/staging` | `Ifrs9StagingPage` | → Staging |
| `/ifrs9/models` | `Ifrs9ModelsPage` | → PD / LGD / EAD models |
| `/ifrs9/icaap` | `IcaapPage` | → ICAAP |
| `/ifrs9/declassification` | `DeclassificationPage` | → Declassification |
| `/ifrs9/governance` | `Ifrs9GovernancePage` | → Rules & approvals |

No backend endpoints yet (BACKEND SEAM: ECL run API, model registry, GL posting).

## 4. Data model

| Store / entity | Key fields |
|---|---|
| `EclRow` (computed) | facility, stage, cbnClass, pd, lgd, ead, ecl, prudential provision, SICR flags |
| `RiskModel` (`models`) | id, name, version, status (`Approved` / `Pending validation` / `Validation findings` / `Pending approval` / `Retired`), last calibration |
| `ModelChange` (`modelChanges`) | modelId, at, by, action, from, to, note |
| `Declassification` | facilityId, from, to, performingPortion, eclBefore, eclAfter, interestWriteBack, trigger, operationId, status |
| `ReservePosting` (`postings`) | period, amount, direction, ifrs, prudential, by |
| `StressRun` (`stressRuns`) | scenarioId, car, eclIncrease, rwaIncrease, by |
| `IcaapApproval` (`icaapApprovals`) | period, car, minimumCar, classification, results |
| `aiSignOff` | finding key → signer |
| Spine `Facility` (written on approval) | stage, cbnClass, dpd |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `ifrs9.pd.*`, `ifrs9.pdMultiplier.*`, `ifrs9.fli.*`, `ifrs9.lgd.*`, `ifrs9.ccf.*`, `ifrs9.accrual.*`, `ifrs9.usdNgnSpot` | `data.ts` (`eclParams`, `pdForGrade`, `fliOverlay`, `usdNgn`) |
| `ifrs9.stage2DpdTrigger`, `ifrs9.stage3DpdTrigger`, `ifrs9.sicr.*` | `data.ts` (`stagingParams`, `sicrTriggers`) |
| `ifrs9.cbn.*` | `data.ts` (`cbnSpecificRate`, `generalProvisionRate`, `lostHaircutWeighting`, `cbnDpdBands`), `pages/overview.tsx` |
| `ifrs9.cure.*` | `data.ts` (`cureParams`, `eligibility`) |
| `ifrs9.model.reviewIntervalMonths` | `pages/models.tsx` |
| `ifrs9.icaap.*`, `ifrs9.capital.*`, `ifrs9.scenario.*` | `data.ts` (`minimumCar`, `capitalBase`, `capitalBands`, `icaapScenarios`, `pillar2AddOns`), `pages/icaap.tsx` |
| `approvals.stepUpThresholdNgn`, `operations.*` (core) | Operations engine on decisions |

All rule groups are listed in `IFRS9_RULE_GROUPS` (platform.ts) and shown with `RulesPanel`.

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| none — `useCan("ifrs9", "edit")` (role → module access) | `pages/overview.tsx`, `staging.tsx`, `models.tsx`, `icaap.tsx`, `declassification.tsx`, `governance.tsx` |
| (engine) segregation of duties / approver role | `src/lib/platform/operations.ts` `canDecide` |

Catalogue keys to adopt: see REQUIREMENTS §2.

## 7. Workflows, notifications, events, hooks wired

| Item (REQUIREMENTS §) | Code location |
|---|---|
| `ifrs9.declassification` (§5) | registered `platform.ts`; submitted `pages/declassification.tsx` `submit()`; withdraw via `cancelOperation` |
| `ifrs9.model.approval` (§5) | registered `platform.ts`; submitted `pages/models.tsx`; subscriber `ifrs9.model-validation-passed` publishes `ifrs9.model.validated` |
| `ifrs9.ecl.post` (§5) | registered `platform.ts`; submitted `pages/overview.tsx` |
| `ifrs9.icaap.scenario.change`, `ifrs9.icaap.approval` (§5) | registered `platform.ts`; submitted `pages/icaap.tsx` |
| Subscriber `ifrs9.sync-closed-operations` | `platform.ts` — pattern `operations.request.*`, syncs returned / withdrawn records |
| Templates (§6) | `defineTemplates` in `platform.ts`; `ifrs9.car-breach` sent from `pages/icaap.tsx`, the rest from operation `apply`/`onReject` |
| Events (§7) | request-side events published in pages; outcome events in `platform.ts` |
| Hooks (§7) | `.before/.after` around propose/submit/request in pages; `apply.before` / `reserve.post.before` / `scenario.change.before` re-run inside `apply` |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/risk/ifrs9.spec.ts` — "declassification proposal is approved and the facility stage/class is updated" | IF9-FR-13 |
| `e2e/risk/ifrs9.spec.ts` — "model version approval runs Head of Risk validation then CRO approval @mobile" | IF9-FR-08 |
| `e2e/risk/ifrs9.spec.ts` — "ICAAP scenario severity change applies after Head of Risk and CRO approval" | IF9-FR-12 |
| `e2e/risk/pages-load.spec.ts` | All routes render |
| Unit tests | none (vitest configured, no test files) |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| IF9-FR-01 | `data.ts` `stagingParams`, `sicrTriggers`; `pages/staging.tsx` | — | Done (demo) |
| IF9-FR-02 | `data.ts` `eclFor`, `runEcl`, `fliOverlay` | — | Done (demo calibration) |
| IF9-FR-03 | `data.ts` `eclFor`, `eclParams` | — | Done (demo) |
| IF9-FR-04 | `data.ts` `cbnSpecificRate`, `lostHaircutWeighting`; `pages/overview.tsx` | — | Partial — haircut weightings only for cash, quoted shares, legal mortgage (no T-bills, bank guarantees, commercial mortgage split) |
| IF9-FR-05 | `pages/overview.tsx`, op `ifrs9.ecl.post` | — | Partial — posting stored locally; no Finance/GL connector |
| IF9-FR-06 | `data.ts` `stageTransfers`, `eclMovement` | — | Partial — simulated (TD-124) |
| IF9-FR-07 | `pages/models.tsx`, `data.ts` `seedModels`, `sourceMapping` | — | Done (demo) |
| IF9-FR-08 | op `ifrs9.model.approval` | ifrs9.spec | Done |
| IF9-FR-09 | `pages/models.tsx` AI finding panel | — | Partial — single hard-wired finding (`MDL-LGD-UNS`) |
| IF9-FR-10 | `pages/icaap.tsx` stress test, `ifrs9.car-breach` | — | Done (demo) |
| IF9-FR-11 | `data.ts` `classifyCar`, `supervisoryChecklist`, `pillar2AddOns` | — | Partial — checklist is code copy (TD-129) |
| IF9-FR-12 | ops `ifrs9.icaap.scenario.change`, `ifrs9.icaap.approval` | ifrs9.spec | Done |
| IF9-FR-13 | `data.ts` `eligibility`, `cureData`; `pages/declassification.tsx`; op `ifrs9.declassification` | ifrs9.spec | Done |
| IF9-FR-14 | — (copy in `staging.tsx`, `data.ts` source mapping) | — | Missing |
| IF9-FR-15 | `governance.tsx`, `pages/governance.tsx` | — | Done |

## 10. Gaps against the invariants

- Invariant 12: actions gated by `useCan("ifrs9", level)` (role → module access), not catalogue permission keys; System Admin is not granted every permission (has no `ifrs9` access at all).
- Invariant 8: notification recipient roles are code lists in `platform.ts` / `pages/icaap.tsx` (no `ifrs9.*Roles` rules, compare TD-604); workflow SLA literals (TD-127); ECL-movement quarter start uses a `90`-day literal in `pages/overview.tsx` without a TD id; `GAUGE_MAX_CAR = 30` display constant in `pages/icaap.tsx`.
- Invariant 8 / 9: rule-by-rule `rule.change` bypasses the scenario workflow (TD-128); capital base is a rules calibration instead of GL data (TD-125).
- Invariant 9 (connector-ready): frontend has no `docs/integration-points.md`; GL capital accounts, Finance posting, macro feed and spot-rate feed are not recorded or connected.
- Invariant 9 (extensible): AI finding accept/dismiss has no hook points; stress-run records not published to an outbound channel (events are browser-only).
- Invariant 9 (notified): model submission, declassification proposal and reserve-posting request notify only via generic `operations.approval-requested`; no notification on declassification rejection.
- PRD: specialised-loan overlays (Annexures 2–6) not applied (IF9-FR-14); currency-mismatch 150% overlay not reflected in RWA.
- Tests: no unit tests for the ECL / prudential / capital engine.

## 11. Tech debt

| TD id | Summary |
|---|---|
| TD-124 | Stage-transfer history and ECL movement shares are simulated |
| TD-125 | Capital base / non-loan RWA held as calibration rules, not GL data |
| TD-127 | Workflow step SLA hours are literals in default definitions |
| TD-128 | `ifrs9.scenario.*` changeable via generic `rule.change`, bypassing `ifrs9.icaap.scenario.change` |
| TD-129 | Supervisory checklist and scenario descriptions are code copy |
