# Executive view — implementation

| | |
|---|---|
| Status | Prototype (demo data) — partial: capital, liquidity, market and op-risk actuals are demo feeds |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
Two pages. The cockpit (`executive-page.tsx`) computes credit KRIs, postures, limits, stages and WARR from the Risk Data Spine and the portfolio module, reads non-credit actuals from `demoFeeds` (TD-507) and colours them with `executive.*` rules. Governance (summary sign-off, BRC pack build / submit) lives in the `useExecutiveGovernance()` hook (`hooks.ts`), which runs hook points, submits Operations requests, audits and publishes. Pack runs and sign-offs are stored in the portfolio module's store (`usePortfolioStore`, report runs with the BRC pack report id).

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/app/(app)/executive/page.tsx` | Route (thin client page) |
| `src/app/(app)/executive/board-pack/page.tsx` | Legacy route — client redirect to `/enterprise-risk/brc-pack` (consolidated BRC pack flow) |
| `src/modules/executive/pages/executive-page.tsx` | Cockpit: AI summary, appetite scorecard, escalations, exception feed, BRC pack card, KRI table, heat-map, posture, stage, WARR, CAR, liquidity/NOP, share margin, op-risk, drill-down |
| `src/modules/executive/hooks.ts` | `useExecutiveGovernance()` (submitSummary, buildPack, submitPack), `boardPeriod()` |
| `src/modules/executive/platform.ts` | Rules (`EXEC_RULES`), operations, signed-summary gate hook, templates, events, hook points, operations subscriber |
| `src/modules/executive/data.ts` | `demoFeeds`, `shareMarginStatus`, `demoExceptions`, `Kri` type |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry (Workspace → Executive view, §6.11, §3 row 19, Phase 1) |
|---|---|---|
| `/executive` | `ExecutivePage` | Cockpit |
| `/executive/board-pack` | redirect → `/enterprise-risk/brc-pack` | (removed from the menu; Enterprise risk → BRC pack) |

Exported: `EXEC_RULES`, `PACK_HREF`, payload types, `useExecutiveGovernance`.

## 4. Data model
| Entity / store | Key fields |
|---|---|
| `Kri` (computed) | id, domain, name, value, appetite, rag, href |
| `ExceptionItem` (`demoExceptions` + derived credit exceptions) | id, domain, title, severity, href |
| Portfolio store `signOffs[exec-summary:<period>]` | by, role, at, operationId |
| Enterprise-risk store `packs` (read-only here) | latest pack id, meeting, status — shown on the cockpit BRC card |
| `demoFeeds` | carPct, carHistory, liquidityRatioPct, ldrPct, nopToCapitalPct, varNgn, opLossRatePct, opLossTrend, kriRag, walletMix, peerOutliers, momentumFlags |

## 5. Rule keys used
| Key | Where read |
|---|---|
| All `executive.*` thresholds (`stage2ShareRedPct` … `quotedEquityHaircutPct`) | `executive-page.tsx` (`useRule`) |
| `executive.summary.notifyRoles` | `platform.ts` apply |
| Portfolio / RAR rules (limits, WARR appetite) | via portfolio selectors |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| — (none) | `useCan("executive", "edit")` in both pages gates summary submit, pack build / submit. Catalogue keys `executive.cockpit.view`, `executive.summary.submit`, `executive.board-pack.build/submit`, `executive.kris.export`, `executive.board-pack.export` are not checked by name (gap, invariant 12). |

## 7. Workflows, notifications, events, hooks wired
| Item (REQUIREMENTS §) | Code location |
|---|---|
| §5 `executive.summary.signoff` | `platform.ts` register; submitted in `hooks.ts` `submitSummary` |
| §5 returned / withdrawn | `platform.ts` subscriber `executive.operations-closed` |
| §6 templates | `platform.ts` apply / onReject → `notify` |
| §7 events | `hooks.ts` (summary.submitted); `platform.ts` (summary.signedOff) |
| §7 hooks | `hooks.ts` (all six before/after points); built-in veto handler in `platform.ts` |

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/risk/pages-load.spec.ts` | Both pages load per role |
| `e2e/risk/portfolio.spec.ts` — "Head of Risk submits the AI executive summary → CRO signs it off" | EXE-FR-10 |
| BRC pack build / submit / approve e2e | `e2e/risk/enterprise-risk.spec.ts` (consolidated flow, incl. `/executive/board-pack` redirect) |
| Unit tests | None (vitest configured, no tests) |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status (Done / Partial / Missing) |
|---|---|---|---|
| EXE-FR-01 | `executive-page.tsx` scorecard + KRI table (non-credit actuals demo, TD-507) | pages-load | Partial |
| EXE-FR-02 | `executive-page.tsx` posture panel | pages-load | Done |
| EXE-FR-03 | `executive-page.tsx` heat-map | pages-load | Done |
| EXE-FR-04 | `executive-page.tsx` (wallet mix, outliers, momentum from `demoFeeds`) | — | Partial |
| EXE-FR-05 | `executive-page.tsx` stage trend (synthetic history), WARR panel | — | Partial |
| EXE-FR-06 | `executive-page.tsx` CAR / liquidity / NOP / op-risk panels (demo feeds) | — | Partial |
| EXE-FR-07 | `data.ts` `shareMarginStatus` (simulated MTM) | — | Partial |
| EXE-FR-08 | Drill-down links on each panel | — | Done |
| EXE-FR-09 | Escalations + exception feed (non-credit items `demoExceptions`) | — | Partial |
| EXE-FR-10 | `hooks.ts` `submitSummary`, `executive.summary.signoff` | portfolio.spec | Done |
| EXE-FR-11 | `executive-page.tsx` BRC card (reads `useErm` packs), legacy route redirect | enterprise-risk.spec | Done |

## 10. Gaps against the invariants
- Invariant 12: module-level `useCan("executive", "edit")` only; export permissions not mirrored.
- Board / MCC / BCC hold `enterprise-risk.brc-pack.view` as a seeded tenant grant, so they open the consolidated BRC pack page (TD-964 closed in the frontend; backend `ExtraPermissions` pending, TD-974).
- Invariant 8: KRI thresholds owned by other modules duplicated as executive rules (TD-508); workflow SLAs are literals in `defaultSteps` (TD-127 pattern).
- Invariant 9 (end-to-end): non-credit actuals and exception items are demo feeds, not owning-module data (TD-507); no events consumed from those modules.
- Invariant 9 (notified): no notification to approvers beyond the generic `operations.approval-requested`; no alert when a KRI turns Red.
- Invariant 9 (connector-ready): CSCS mark-to-market and module actuals are recorded in [`docs/integration-points.md`](../../integration-points.md) (§3, §4); simulated (TD-507).
- No unit tests.

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-507 | Demo actuals for capital, liquidity, market, op-risk KRIs and simulated CSCS MTM |
| TD-508 | KRI thresholds owned by other modules defined as executive rules |
