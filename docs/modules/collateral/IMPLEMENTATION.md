# Collateral & legal — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
Client-only module. Pages read a combined view (`useCollateralView`) of the shared Risk Data Spine (`collateral`, `facilities`) plus the module store (`credigit.ser.collateral`: MO verifications, legal records, valuation history, liens, simulated prices, margin calls, reminders, insurance). Commands live in `service.ts`; each runs before-hooks → store update → audit (`auditAs`) → event → notification → after-hooks. Approvals go through the Operations engine; `platform.ts` registers operation types whose `apply` lazily calls the service. Haircut and alert logic in `logic.ts` reads rules at call time.

```
pages/*.tsx ──► service.ts ──► useDb (spine) + useCollateralStore
                   │  runHooks / publish / notify / auditAs
                   └─► submitOperation ──► Operations ──► platform.ts apply ──► service.apply*
```

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/modules/collateral/platform.ts` | Rules, operation types, templates, events, hook points |
| `src/modules/collateral/service.ts` | Commands (register, value, verify, perfection, legal, insurance, documents, reminders, prices, margin calls) |
| `src/modules/collateral/store.ts` | Persisted module state; `useCollateralView`, `useSharePrices` |
| `src/modules/collateral/logic.ts` | Haircuts, value basis, adjusted value, perfection steps, role abilities, simulated prices, alerts, margin shortfall |
| `src/modules/collateral/data.ts` | Seed generators: valuation history, insurance, MO/lien/legal seeds, corporate actions |
| `src/modules/collateral/pages/register-page.tsx` | Collateral register, alerts, reminders, register dialog |
| `src/modules/collateral/pages/item-page.tsx` | Collateral record (valuation, perfection, legal, documents, shares tabs) |
| `src/modules/collateral/pages/legal-page.tsx` | Legal review queues (searches, perfection, vault, sign-off) |
| `src/modules/collateral/pages/verification-page.tsx` | Middle Office verification queue |
| `src/modules/collateral/pages/shares-page.tsx` | Share-backed positions, price refresh, margin calls |
| `src/app/(app)/collateral/**/page.tsx` | Thin route files |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/collateral` | `register-page.tsx` | Collateral & legal → Collateral register |
| `/collateral/legal` | `legal-page.tsx` | → Legal review |
| `/collateral/verification` | `verification-page.tsx` | → Valuation verification |
| `/collateral/shares` | `shares-page.tsx` | → Share-backed (SEC/CSCS) (Phase 2 badge) |
| `/collateral/item?id=&tab=` | `item-page.tsx` | Record page (linked from register) |

## 4. Data model
| Store | Key fields |
|---|---|
| Spine `collateral` | id, facilityId(s), obligorId, type, description, marketValue, forcedSaleValue, valuer, valuedAt, nextRevaluation, perfection, ticker/units |
| `verifications[id]` | status (Verified / Pending / Queried), by, at, note |
| `legal[id]` | searchStatus, genuineness, vaultRef, checked-out, sign-off |
| `valuations[id][]` | valuer, basis, assumptions, MV, FSV, at |
| `liens[id]` | lien status (CSCS confirmed / pending / pledged elsewhere / released) |
| `prices`, `pricesAt` | Simulated ticker prices |
| `marginCalls[id]` | at, by, exceptionId, topUp, releasedAt/By, operationId |
| `reminders`, `insurance` | Reminder dedupe by alert id; recorded insurance renewals |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `collateral.haircut.*` | `logic.ts` `haircutFor`; `shares-page.tsx` (`quotedShares`) |
| `collateral.haircut.residentialKeywords` | `logic.ts` `haircutFor` |
| `collateral.perfection.stallDays`, `collateral.revaluation.warningDays`, `collateral.insurance.warningDays` | `logic.ts` `buildCollateralAlerts`; `register-page.tsx` |
| `collateral.revaluation.cycleMonths` | `service.ts` `registerCollateral`, `recordValuation` |
| `collateral.margin.minCoverPct` | `logic.ts` `requiredCover`; `service.ts` `raiseMarginCall`; `register-page.tsx`, `shares-page.tsx` |
| `collateral.valuation.bases` | `service.ts`, `item-page.tsx` |
| `collateral.legal.minOpinionLength` | `service.ts`, `item-page.tsx`, `legal-page.tsx`, `shares-page.tsx` |
| `collateral.documents.maxSizeMb`, `collateral.documents.accept` | `item-page.tsx` |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| — (none) | Pages gate actions with `collateralAbilities(role.id)` in `logic.ts` (`roleId === "collateral-officer"` / `"legal-officer"` / `"middle-office-officer"`); module visibility via `useCan("collateral", level)` / nav filtering. No catalogue permission key is checked. |

## 7. Workflows, notifications, events, hooks wired
| Item (REQUIREMENTS §) | Code location |
|---|---|
| `collateral.valuation.verify` (§5) | submitted in `service.ts` `requestVerification`/`recordValuation`; apply `applyVerification`; reject `verificationQueried` |
| `collateral.legal.signoff` (§5) | `service.ts` `requestLegalSignoff` → `applyLegalSignoff` |
| `collateral.perfection.complete` (§5) | `service.ts` `advancePerfection` (to Perfected) → `applyPerfectionComplete` |
| `collateral.margin.release` (§5) | `service.ts` `requestMarginRelease` → `applyMarginRelease` |
| Notifications (§6) | `service.ts`: `verificationQueried`, `reportDefect`, `sendReminders`, `raiseMarginCall`, `applyMarginRelease` |
| Events (§7) | `publish(...)` in every `service.ts` command |
| Hooks (§7) | `recordValuation`, `advancePerfection`/`applyPerfectionComplete`, `requestLegalSignoff`/`applyLegalSignoff`, `raiseMarginCall` |
| Exception (§8) | `raiseMarginCall` → monitoring `raiseException` |

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/risk/collateral.spec.ts` | Revaluation verified by Middle Office in Operations (recorder can't self-verify, mobile); legal sufficiency accepted by Credit Admin; margin call raised then released after verification |
| `e2e/risk/pages-load.spec.ts` | Collateral pages render |
| Unit tests | None (vitest configured, no `*.test.ts`) |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status |
|---|---|---|---|
| COL-FR-01 | `register-page.tsx`, `service.registerCollateral` | pages-load | Done |
| COL-FR-02 | `logic.haircutFor`, `adjustedValue` | — | Done |
| COL-FR-03 | `logic.valueBasis` | — | Done |
| COL-FR-04 | `service.recordValuation`, `item-page.tsx` | collateral.spec | Done |
| COL-FR-05 | `collateral.valuation.verify`, `verification-page.tsx` | collateral.spec | Done |
| COL-FR-06 | `service.advancePerfection`, `reportDefect`, `cureDefect` | — | Done |
| COL-FR-07 | `service.recordSearch`, `confirmGenuineness`, `vaultDocuments`, `checkOutDocuments`, `returnDocuments` | — | Done |
| COL-FR-08 | `collateral.legal.signoff` | collateral.spec | Done |
| COL-FR-09 | `logic.buildCollateralAlerts`, `service.sendReminders` | — | Partial (manual "send reminders"; no scheduler) |
| COL-FR-10 | `shares-page.tsx`, `logic.priceSeries`, `data.corporateActions` | — | Partial (simulated feed, TD-601) |
| COL-FR-11 | `service.raiseMarginCall` | collateral.spec | Partial (raised by user action, not automatically on shortfall) |
| COL-FR-12 | `collateral.margin.release` | collateral.spec | Done |
| COL-FR-13 | `shares-page.tsx` (Phase copy), `service.uploadDocuments` | — | Partial |
| COL-FR-14 | `service.uploadDocuments`, `item-page.tsx` | — | Done (file metadata only) |

## 10. Gaps against the invariants
- Invariant 12: no catalogue permission keys checked; actions gated by hard-coded role ids in `collateralAbilities` (role-name check, also violates invariant 8) and module-level `useCan`.
- Invariant 9 (extensible): no hook points around register, defect report/cure, legal search, genuineness, vault/check-out, insurance renewal, document upload, reminders or price refresh.
- Invariant 9 (audited): all service commands audit; reminder sweeps are audited as one batch entry (count only, not per collateral).
- Invariant 9 (connector-ready): SEC/CSCS and the monitoring exception hand-off are not recorded in `docs/integration-points.md` (file does not exist yet); price refresh is a local simulator, not a Connectors-framework call.
- Invariant 9 (notified): no notification on valuation verified, perfection completed, legal sign-off accepted, or valuation recorded (verifier is reached only through the Operations task).
- Invariant 8: notification recipient roles are code lists (TD-604); simulator constants (TD-601); seed shapes (TD-603); default approvers are proposals (TD-602).
- Margin shortfall does not auto-raise a margin call (PRD §5.7 "automatically raises"); no scheduled reminder/revaluation sweep.
- User scope: register and queues are not filtered by the actor's portfolio/branch.
- No unit tests for haircut, alert or margin logic.

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-601 | Simulated NGX/CSCS reference prices, drift/vol and price shock are code constants |
| TD-602 | Default approver roles for `collateral.*` operations are proposals (COL1–COL2) |
| TD-603 | Seed generators (valuation history, insurance cover) contain demo-shape constants |
| TD-604 | Notification recipient roles are code lists |
| TD-111 | Origination haircut rules duplicate collateral haircuts |
