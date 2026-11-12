# Disbursement — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
One page (queue + workspace drawer) over a small persisted store. State changes go through `actions.ts`, which runs hook points, submits the `disbursement.authorise` operation and audits. The Checker step is the Operations step; `platform.ts` `apply` performs the posting (simulated), activates the facility and books the application. An `operations.request.*` subscriber maps returned / cancelled requests back onto the disbursement. Segregation of duties and step-up are a hook on `operations.decide.before`.

```text
disbursement-page.tsx ──► actions.ts ──► runHooks(prepare.before) ─► submitOperation("disbursement.authorise")
                                                         │
Operations engine ── decide ─► hook disbursement.sod-and-step-up (veto?) ─► apply(): CBA ref, facility Active, app Booked, notify, publish
```

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/app/(app)/disbursement/page.tsx` | Route (thin client page) |
| `src/modules/disbursement/pages/disbursement-page.tsx` | Queue, KPIs, history, Maker/Checker workspace, step-up dialog |
| `src/modules/disbursement/actions.ts` | `prepareDisbursement`, `decideDisbursement`, `withdrawDisbursement` |
| `src/modules/disbursement/platform.ts` | Rules, operation type, SoD/step-up hook, template, events, hook points, operations subscriber |
| `src/modules/disbursement/store.ts` | Zustand store `credigit.ser.disbursement`; `conflictedPeople`, `makerChecks`, `checkerChecks`, `checkerRoles` |
| `src/modules/credit-admin/common.ts` | Shared `auditAs`, `demoNowIso`, `hash` helpers (borrowed) |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/disbursement` (`?facility=<id>` opens the workspace) | `DisbursementPage` | Credit lifecycle → Disbursement (§4.1, §4.2, Phase 1); no sub-tabs |

Backend seam: replace store writes and `apply` with the disbursement API and CBA connector (comment in `actions.ts`).

## 4. Data model
| Entity / store | Key fields |
|---|---|
| `Disbursement` (store `requests`, persisted) | id, facilityId, obligorId, amount, currency, accountNumber, accountName, valueDate, narration, status (`Awaiting authorisation` / `Authorised` / `Returned to maker` / `Rejected` / `Withdrawn`), makerId/Name, checkerId/Name, decidedAt, comment, stepUpVerified, cbaReference, operationId |
| Spine `facilities` (shared) | status → `Active`, outstanding, startDate, maturityDate updated on authorisation |
| Spine `applications` (shared) | stage → `Booked` on authorisation; approvals used for SoD |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `disbursement.accountNumberLength` | `disbursement-page.tsx` (workspace validation) |
| `disbursement.makerRoles` | `store.ts` `makerChecks`; `disbursement-page.tsx` |
| `approvals.stepUpThresholdNgn` | `platform.ts` (apply, SoD hook); `disbursement-page.tsx` (KPI, column, step-up prompt) |
| `operations.minCommentLength` | via the Operations decision UI |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| — (none) | Pages gate actions with `useCan("disbursement", "edit")` (module level) plus role checks from `disbursement.makerRoles` and the workflow step's approver roles. Named keys `disbursement.queue.view`, `disbursement.disbursements.prepare/withdraw/authorise`, `disbursement.queue.export` are not yet checked (gap, invariant 12). |

## 7. Workflows, notifications, events, hooks wired
| Item (REQUIREMENTS §) | Code location |
|---|---|
| §5 `disbursement.authorise` (register, apply, onReject) | `platform.ts` `registerOperation` |
| §5 submit / decide / cancel | `actions.ts` |
| §5 returned / withdrawn mapping | `platform.ts` `subscribe("operations.request.*")` → `close()` |
| §6 `disbursement.authorised` | `platform.ts` `apply` → `notify` |
| §7 events `prepared` | `actions.ts`; `authorised`, `facility.activated` in `apply`; `returned` / `rejected` / `withdrawn` in `close()` |
| §7 hooks `prepare.before/after` | `actions.ts`; `authorise.after` in `apply` |
| §7 SoD / step-up handler | `platform.ts` `registerHook("disbursement.sod-and-step-up")`; proof via `recordStepUp` |

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/credit/disbursement.spec.ts` — "CP confirmed → release via Operations → Maker prepares → same person can't check → Checker authorises → Active / Booked" | DSB-FR-01–03, 05, 06, 09 |
| `e2e/credit/disbursement.spec.ts` — "high-value disbursement needs Checker step-up; cancelling it records nothing" | DSB-FR-08 |
| `e2e/risk/pages-load.spec.ts` | Page loads per role |
| Unit tests | None (vitest configured, no tests) |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status (Done / Partial / Missing) |
|---|---|---|---|
| DSB-FR-01 | `disbursement-page.tsx` queue | disbursement.spec | Done |
| DSB-FR-02 | `disbursement-page.tsx` (`gateOk`: released + no open CPs) | disbursement.spec | Done |
| DSB-FR-03 | `disbursement-page.tsx` (`amountError`) | disbursement.spec | Done |
| DSB-FR-04 | `disbursement-page.tsx` (`accountLength`) | — | Done |
| DSB-FR-05 | `actions.ts` `prepareDisbursement` | disbursement.spec | Done |
| DSB-FR-06 | Operations engine + `checkerChecks` | disbursement.spec | Done |
| DSB-FR-07 | `store.ts` `conflictedPeople`; `platform.ts` SoD hook | — | Done (not e2e-covered) |
| DSB-FR-08 | SoD/step-up hook; step-up dialog (OTP simulated, TD-858) | disbursement.spec | Partial |
| DSB-FR-09 | `platform.ts` `apply` (CBA simulated, TD-857); only seeded facilities reach the queue (TD-951) | disbursement.spec | Partial |
| DSB-FR-10 | `actions.ts` decide / withdraw; `close()` | — | Done (return/reject not e2e-covered) |
| DSB-FR-11 | `disbursement-page.tsx` `myWork` | — | Done |
| DSB-FR-12 | `disbursement-page.tsx` history table | — | Done |

## 10. Gaps against the invariants
- Invariant 12: no named permission checks — UI uses `useCan("disbursement", "edit")` and role lists; export/withdraw/authorise keys from the catalogue are not mirrored.
- Invariant 9 (notified): no module template for return / rejection / withdrawal — only the generic `operations.request-completed`; the RM is not told about a rejected drawdown.
- Invariant 8: Checker step SLA (8 h) is a literal in `defaultSteps` (same pattern as TD-127); time-zone offset literal (TD-859).
- Invariant 9 (end-to-end): applications created in the prototype never produce a facility, so they can't be disbursed (TD-951).
- Step-up is client-side only (TD-858); CBA posting simulated (TD-857).
- Module reuses `credit-admin/common.ts` helpers — cross-module coupling rather than a shared lib.
- Invariant 9 (connector-ready): CBA posting and step-up provider are not recorded in `docs/integration-points.md` (file doesn't exist yet) and don't go through the Connectors framework.
- No unit tests for `conflictedPeople` / `makerChecks` / `checkerChecks`.

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-857 | CBA posting reference simulated on authorisation |
| TD-858 | Step-up OTP accepts any 6 digits; in-memory proof token |
| TD-859 | Date inputs use a fixed `+01:00` offset |
| TD-951 | Prototype applications don't book a facility, so only seeded facilities can be disbursed |
