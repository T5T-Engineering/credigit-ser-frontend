# Credit administration — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
Client-side module over the shared Risk Data Spine (`useDb`). Facility rows are derived (`logic.ts`) from facilities, applications, offer letters and collateral; user changes (CP state, waivers, releases, CRMS, credit-file items) live in a persisted zustand store. Every state change goes `.before` hook → store write → audit → event → `.after` hook (`actions.ts`); approvals go through the Operations engine (`platform.ts`). CRMS is simulated.

```
pages/*.tsx → actions.ts (hooks, audit, events, submitOperation) → store.ts (credigit.ser.credit-admin)
                  ↘ platform.ts (rules, operation types + apply/onReject, templates, events, hook points)
logic.ts / crms.ts / credit-files.ts / register.ts → derived views from useDb + store
```

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/modules/credit-admin/platform.ts` | Rules, 4 operation types, templates, events, hook points, tier-check hook, operation-closed subscriber |
| `src/modules/credit-admin/actions.ts` | State-changing actions (CP, waiver submit/close, reminders, release, CRMS, credit file) |
| `src/modules/credit-admin/store.ts` | Persisted store `credigit.ser.credit-admin` |
| `src/modules/credit-admin/logic.ts` | Facility rows, CP derivation, tolerance check, approving-tier roles (`approverRolesFor`, `canApproveAtTier`), covenants |
| `src/modules/credit-admin/crms.ts` | CRMS simulator and reporting status |
| `src/modules/credit-admin/credit-files.ts` | Annexure 1 sections and credit-file rows |
| `src/modules/credit-admin/register.ts` | Product → facility class map, in-process stages |
| `src/modules/credit-admin/common.ts`, `view.ts`, `operations-ui.tsx` | Helpers (hash, dates, `auditAs`), UI mapping, pending-operation banner |
| `src/modules/credit-admin/pages/*.tsx` | Page compositions |
| `src/app/(app)/credit-admin/**/page.tsx` | Thin route files |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/credit-admin` | `FacilityRegisterPage` | Credit administration → Facility register |
| `/credit-admin/facility?id=` | `FacilityPage` (CPs, release, print-out, covenants, documents) | — (record page) |
| `/credit-admin/waivers` | `WaiversPage` | Waivers & deferrals |
| `/credit-admin/crms` | `CrmsDeskPage` | CRMS desk |
| `/credit-admin/credit-files` | `CreditFilesPage` | Credit files |

## 4. Data model
| Store / entity | Key fields |
|---|---|
| `cp[cpKey][conditionId]` (`CpState`) | status, byName, at, note, evidence |
| `released[facilityId]` | byName, at |
| `waivers[id]` (`WaiverRequest`) | kind (Waiver / Deferral / Sanction for breach), facilityId, cpKey, conditionId/title/category, reason, requestedBy, expiryDate, status, approverRoleIds, withinTolerance, decision fields, breachDetail, lossEventRef, operationId |
| `crmsSearches[id]` | obligorId, purpose, result, facilitiesElsewhere, outstandingElsewhere, reference |
| `crmsBatches[id]` | label, facilityIds, status, rejected |
| `crmsResolved[facilityId]`, `files[obligorId][itemId]` | byName, at / status |
| Spine (read) | facilities, applications (approvals), obligors, offer letters, collateral, users |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `credit-admin.delegatedMaxDeferralDays`, `.delegatedCategories` | `logic.ts` (`isWithinTolerance`, `toleranceNote`) |
| `credit-admin.delegatedApproverRoles` | `platform.ts` (apply, tier-check hook), `pages/waivers-page.tsx` |
| `credit-admin.waiverReminderDays` | `actions.ts` (`sendExpiryReminders`), `waivers-page.tsx` |
| `credit-admin.defaultDeferralDays`, `.minReasonLength` | `waivers-page.tsx` (request form) |
| `credit-admin.requesterRoles` | `waivers-page.tsx`, `facility-page.tsx` |
| `credit-admin.cpConfirmerRoles` | `facility-page.tsx`, `crms-desk-page.tsx`, `credit-files-page.tsx` |
| `credit-admin.crmsRecentWindowDays`, `.crmsReportingCadence` | `crms-desk-page.tsx` |
| `credit-admin.rarStalenessDays`, `.callReportStalenessDays` | `credit-files.ts` |
| Chart-flow tiers (`chartFlow` proxy) | `platform.ts` (`tierRoles`), `logic.ts` (`approverRolesFor`) — TD-110 |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| None by key | Pages gate with `useCan("credit-admin", "view" \| "edit")` plus role-list rules (`requesterRoles`, `cpConfirmerRoles`); waiver decisions by `canApproveAtTier` + `credit-admin.waiver-tier-check` hook. Catalogue keys (`credit-admin.*`) are not yet mirrored in the UI. |

## 7. Workflows, notifications, events, hooks wired
- Operations (REQUIREMENTS §5): all four types registered in `platform.ts`; submitted from `actions.ts` (`submitWaiver`, `requestRelease`, `submitCrmsBatch`). `onReject` / returned / withdrawn handled by `decline()` and the `operations.request.*` subscriber.
- Notifications (§6): `notifyDecision()` and `apply` handlers in `platform.ts`; expiry reminder in `actions.ts` `sendExpiryReminders`.
- Events (§7): published in `actions.ts` (cp, waiver requested/closed/reminded, release-requested, crms search/result/exception, credit-file) and `platform.ts` (approved, declined, sanction routed, released, batch submitted).
- Hooks (§7): `runHooks` calls in `actions.ts`; tier-check handler in `platform.ts`.

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/credit/waiver.spec.ts` | Waiver raised → approving tier decides in Operations → condition waived; role below tier can't approve |
| `e2e/credit/disbursement.spec.ts` | Release → disbursement path (seeded facilities) |
| `e2e/risk/pages-load.spec.ts`, `e2e/smoke.spec.ts` | Pages render |
| Unit tests | None (vitest configured, no specs) |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status |
|---|---|---|---|
| CAD-FR-01 | `facility-register-page.tsx`, `register.ts` | pages-load | Partial (class map literal, CA5) |
| CAD-FR-02 | Spine seed `outstanding` | — | Partial (no CBA connector) |
| CAD-FR-03 | `facility-register-page.tsx` | pages-load | Done |
| CAD-FR-04 | `actions.ts` `setConditionStatus`, `facility-page.tsx` | waiver / disbursement e2e | Done |
| CAD-FR-05 | `submitWaiver`, `credit-admin.waiver`, tier-check hook | waiver.spec | Done |
| CAD-FR-06 | `isWithinTolerance`, `delegatedApproverRoles` | — | Done (assumption) |
| CAD-FR-07 | `sendExpiryReminders` (manual sweep), `closeWaiver` | — | Partial (no scheduler; lapse not auto-set) |
| CAD-FR-08 | `credit-admin.sanction` | — | Partial (loss event simulated, TD-854) |
| CAD-FR-09 | `requestRelease`, `credit-admin.release` | disbursement.spec | Partial (seeded facilities only, TD-951) |
| CAD-FR-10 | `logCrmsSearch`, `crms.ts` | — | Partial (simulated) |
| CAD-FR-11 | `submitCrmsBatch`, `resolveCrmsException` | — | Partial (simulated) |
| CAD-FR-12 | `credit-files.ts`, `setCreditFileItem` | — | Partial (call-report status demo, TD-856) |
| CAD-FR-13 | `facility-page.tsx` `usePrintOut` | — | Done |

## 10. Gaps against the invariants
- Inv. 12: no named permission keys checked; actions gated by `useCan` module level + role-list rules, not `credit-admin.*` catalogue keys. Export/print have no gate.
- Inv. 8: notification recipient roles are code lists in `platform.ts`/`actions.ts` (disbursement-maker/checker, operational-risk-analyst, credit-admin-officer); product → facility class map in `register.ts` (CA5); CRMS latency literal (TD-855); `canApproveAtTier` uses static `roles.ts` tiers.
- Inv. 8: default workflow SLAs (48/72/24 h) are literals in `defaultSteps` (same pattern as TD-127).
- Inv. 9 (notified/scheduled): waiver expiry reminders and lapse need a manual sweep; no scheduler marks waivers "Lapsed".
- Inv. 9 (end-to-end): sanctions create no real loss event (TD-854); facilities for newly originated applications are never booked (TD-951).
- Inv. 9 (user-scoped): register, waivers and credit files show the whole book to every role with view access; no "mine" filter.
- Inv. 9 (connector-ready): CBA, CRMS and the loss-event intake are recorded in [`docs/integration-points.md`](../../integration-points.md) (§1, §2, §9); CRMS is called from the page, no Connectors framework yet (TD-967).
- Tests: no unit tests for tolerance, tier check or reminder logic.

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-110 | Deprecated `chartFlow` proxy still read by `credit-admin/logic.ts` (and `platform.ts`) |
| TD-854 | Sanction loss-event reference simulated |
| TD-855 | Simulated CRMS connector latency |
| TD-856 | Call-report / site-visit status is demo state |
| TD-859 | Waiver date inputs use fixed `+01:00` offset |
| TD-951 | New applications reach Conditions without a booked facility |
