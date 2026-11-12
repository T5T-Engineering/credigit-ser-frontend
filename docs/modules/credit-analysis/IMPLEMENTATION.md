# 360 RAR credit analysis — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
Pure scoring engine (`parameters.ts` + `logic.ts`, `src/lib/rar.ts` for posture geometry) runs client-side over the obligor spine and simulated feeds (`data.ts`). Approved analyst overrides, advisory sign-offs and gating overrides live in a persisted zustand store. State changes go through `actions.ts` (rules check → `.before` hook → `submitOperation` → audit → event → `.after` hook); `platform.ts` registers rules, three operation types whose `apply` handlers write results, and `commitScores()` which publishes/notifies posture changes.

```
pages/*, assessment/*-tab.tsx → actions.ts → Operations (rar.*) → platform.ts apply → store.ts + useDb.obligors.rar
parameters.ts (19+ parameters, scoring bands) → logic.ts assess() → src/lib/rar.ts rarPosition()
data.ts: NGX corpus, life-cycle, macro snapshot, wallet generator (simulated)
```

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/modules/credit-analysis/platform.ts` | Rules, operation types, templates, events, hook points, `commitScores` |
| `src/modules/credit-analysis/actions.ts` | `submitEnrichmentChange`, `refreshAssessment`, `submitAdvisorySignOff`, `requestGatingOverride` |
| `src/modules/credit-analysis/logic.ts` | `assess`, COP bands, weighting, 36-cell tables, posture guidance, flip candidates, momentum, benchmarks, gating checks, `draftAdvisory` |
| `src/modules/credit-analysis/parameters.ts` | Cardinal points, parameter catalogue with sources, scoring bands |
| `src/modules/credit-analysis/data.ts` | NGX sector corpus, life-cycle classifier, sector mapping, macro snapshot, wallet data |
| `src/modules/credit-analysis/store.ts` | Persisted store `credigit.ser.credit-analysis` |
| `src/modules/credit-analysis/shared.tsx` | Shared page helpers |
| `src/modules/credit-analysis/pages/*.tsx`, `assessment/*-tab.tsx` | Page compositions and assessment tabs |
| `src/lib/rar.ts`, `src/lib/platform/core.ts` (`rar.*`) | Posture geometry and core rules |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/credit-analysis` | `AssessmentsPage` (CSV export) | 360 RAR analysis → Assessments |
| `/credit-analysis/assessment?id=` (`&tab=`) | `AssessmentPage` (overview, parameters, peers, trend, advisory) | — (record page) |
| `/credit-analysis/benchmarks` | `BenchmarksPage` | Peer benchmarks (Phase 2) |
| `/credit-analysis/share-of-wallet` | `ShareOfWalletPage` | Share of wallet (Phase 2) |
| `/credit-analysis/sector-corpus` | `SectorCorpusPage` | NGX sector corpus (Phase 2) |
| `/credit-analysis/requests` | `RequestsPage` (module Operations items awaiting me / raised by me) | My requests |

## 4. Data model
| Store / entity | Key fields |
|---|---|
| `Obligor.rar` / `rarUpdatedAt` (spine) | Cardinal scores, last refresh |
| `overrides[obligorId][paramId]` (`ParamOverride`) | score, rationale, by, approvedBy, operationId |
| `advisory[obligorId]` (`AdvisorySignOff`) | text, signedOffBy, approvedBy, at, postureLabel, operationId |
| `gatingOverrides[applicationId]` (`GatingOverride`) | obligorId, rationale, requestedBy, approvedBy, at, operationId |
| `ngxSectors` (static, `data.ts`) | 15-year corpus, life-cycle stage, distributions |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `rar.midpoint`, `rar.neutralBelow`, `rar.marginalBelow`, `rar.moderateBelow` | `src/lib/rar.ts` |
| `credit-analysis.weightingScheme` | `logic.ts` `parameterWeight` |
| `credit-analysis.band.*`, `.qualitative.*` | `logic.ts` `bandOf`/`bandRange`, `parameters.ts` `qualitativeLabel` |
| `credit-analysis.cop.*` | `logic.ts` `copBands`, `assess` |
| `credit-analysis.staleAfterDays` | `logic.ts`, `assessments-page.tsx` |
| `credit-analysis.peer.*`, `.trend.*` | `logic.ts` (benchmarks, momentum) |
| `credit-analysis.sow.highSharePct` | `data.ts` `walletHighThreshold` |
| `credit-analysis.lifeCycle.*`, `.lifeCycleScore.*`, `.ngxMapping.*` | `data.ts` |
| `credit-analysis.gating.*` | `logic.ts` `gatingChecks`, `isExpansionPurpose` |
| `credit-analysis.enrichment.minRationale` | `actions.ts` |
| `credit-analysis.advisory.*` | `logic.ts` `flipCandidates`, `draftAdvisory`; advisory tab |
| `credit-analysis.notify.*` | `platform.ts` (`commitScores`, gating apply) |
| `credit-analysis.scoring.<id>.worst/best` | `parameters.ts` `scoreFromObserved` |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| None by key | `assessment-page.tsx` gates editing with `useCan("credit-analysis", "edit")` (Credit Analyst only in `roles.ts`); approvals by Operations step roles + SoD. Catalogue keys (`credit-analysis.*`) are not mirrored in the UI. |

## 7. Workflows, notifications, events, hooks wired
- Operations (REQUIREMENTS §5): `rar.enrichment-change`, `rar.advisory-signoff`, `rar.gating-override` in `platform.ts`; submitted from `actions.ts`; pending state via `usePendingFor` in `assessment-page.tsx` and `advisory-tab.tsx`.
- Notifications (§6): `commitScores` (posture-changed, defensive-referral), advisory apply (advisory-ready), gating apply (gating-override-approved).
- Events (§7): submitted/requested/refreshed in `actions.ts`; applied/signed-off/approved/rejected/posture.changed in `platform.ts`.
- Hooks (§7): all `runHooks` in `actions.ts`, plus `enrichment.apply.after` and `posture.change.after` in `platform.ts`.

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/risk/credit-analysis.spec.ts` | Enrichment → CCO approves → posture updated; advisory sign-off via Operations; refresh stamps date; view-only role can't adjust/refresh |
| `e2e/risk/pages-load.spec.ts` | Phase 2 pages render |
| Unit tests | None (vitest configured, no specs) — scoring engine untested at unit level |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status |
|---|---|---|---|
| RAR-FR-01 | `parameters.ts`, `parameters-tab.tsx` | credit-analysis.spec | Done (simulated feeds) |
| RAR-FR-02 | `logic.ts` `assess`, `src/lib/rar.ts` | credit-analysis.spec | Done (assumption OQ 1) |
| RAR-FR-03 | `src/lib/rar.ts`, `overview-tab.tsx` | credit-analysis.spec | Done |
| RAR-FR-04 | `logic.ts` COP | — | Done (assumption RAR3) |
| RAR-FR-05 | `overview-tab.tsx` | pages-load | Done |
| RAR-FR-06 | `submitEnrichmentChange`, `rar.enrichment-change` | credit-analysis.spec | Done |
| RAR-FR-07 | `draftAdvisory`, `advisory-tab.tsx`, `rar.advisory-signoff` | credit-analysis.spec | Done (canned AI) |
| RAR-FR-08 | `flipCandidates`, advisory tab | — | Done |
| RAR-FR-09 | `gatingChecks`, `requestGatingOverride`, `rar.gating-override` | — | Partial (override not consumed by origination) |
| RAR-FR-10 | `commitScores` defensive referral | — | Done |
| RAR-FR-11 | `commitScores` | — | Done |
| RAR-FR-12 | `refreshAssessment`, `staleAfterDays` | credit-analysis.spec | Partial (manual refresh only) |
| RAR-FR-13 | `benchmarks-page.tsx`, `peers-tab.tsx` | pages-load | Done (demo) |
| RAR-FR-14 | `share-of-wallet-page.tsx`, `walletFor` | pages-load | Partial (simulated, TD-122) |
| RAR-FR-15 | `sector-corpus-page.tsx`, `data.ts` | pages-load | Partial (simulated corpus) |
| RAR-FR-16 | `trend-tab.tsx`, `momentumOf` | — | Done (demo) |
| RAR-FR-17 | `scoring.*` rules | — | Partial (no weight table, TD-121) |

## 10. Gaps against the invariants
- Inv. 12: no named permission keys; all edit actions gated by one `useCan("credit-analysis","edit")`; export has no gate.
- Inv. 8: 1–10 scale literal (TD-120); single weighting scheme (TD-121); tenant bank name literal (TD-122); COP bands duplicated with origination (TD-123); default step SLAs literal in `defaultSteps`.
- Inv. 9 (notified): rejected enrichment / advisory / override publish events but send no module notification to the requester (relies on Operations' generic notices).
- Inv. 9 (end-to-end): approved gating override and signed-off advisory are not read back into the origination credit memo / approval gate.
- Inv. 9 (connector-ready): NGX corpus, macro, bureau / other-bank lines are recorded in [`docs/integration-points.md`](../../integration-points.md) (§2, §3) and simulated in `data.ts`; no Connectors framework yet (TD-967).
- Inv. 9 (scheduled): no automatic refresh when inputs change (§6.2.5 "refreshed automatically"); manual refresh only.
- Tests: no unit tests for `assess`, posture bands, gating or momentum.

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-120 | 1–10 score scale literal |
| TD-121 | Only "equal" weighting scheme |
| TD-122 | Tenant bank name literal in wallet generator |
| TD-123 | COP band thresholds duplicated with origination |
