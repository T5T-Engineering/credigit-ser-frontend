# Enterprise risk — implementation

| | |
|---|---|
| Status | Prototype (demo data) — Phase 2 module, fully designed |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
Six thin pages each render one section component inside the `ModulePage` wrapper. Section components compose `@credigit/web-ui` controls, read rules at call time and write through the persisted `useErm` store. Appetite metrics are computed in `logic.ts` (`useAppetite`) from the Risk Data Spine plus the operational-risk store; limits come from rules. Approvals (RAS change, risk acceptance, BRC pack) are Operations operation types registered in `platform.ts`. Audit uses the shared `useAuditLog` / `logAudit` helpers from `operational-risk/shared`.

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/app/(app)/enterprise-risk/**/page.tsx` | Six routes (thin client pages) |
| `src/modules/enterprise-risk/pages/*.tsx` | `erm-page` (appetite), `register-page`, `insider-page`, `regulatory-page`, `brc-pack-page`, `lines-of-defence-page` — wrappers |
| `src/modules/enterprise-risk/sections/appetite.tsx` | RAS scorecard, escalation, RAS change request |
| `src/modules/enterprise-risk/sections/register.tsx` | Risk register, heat map, review, acceptance request |
| `src/modules/enterprise-risk/sections/insider.tsx` | Insider / related-party disclosure |
| `src/modules/enterprise-risk/sections/regulatory.tsx` | CBN circulars, policy currency, regulatory breaches |
| `src/modules/enterprise-risk/sections/brc-pack.tsx` | BRC pack compile / submit / decide, AI summary sign-off |
| `src/modules/enterprise-risk/sections/lines-of-defence.tsx` | Three lines of defence (literal mapping, TD-903) |
| `src/modules/enterprise-risk/platform.ts` | Rules, operations, templates, events, hook points, AI-summary subscriber |
| `src/modules/enterprise-risk/keys.ts` | `ermKeys` rule-key map |
| `src/modules/enterprise-risk/data.ts` | Metric defaults, `spineFigures`, `appetiteMetrics`, `appetiteRag`, seeds (risks, circulars, policies, breaches), `insiderFlags`, `policyStatus`, `packSections` |
| `src/modules/enterprise-risk/logic.ts` | `useAppetite()` |
| `src/modules/enterprise-risk/store.ts` | Zustand store `credigit.ser.enterprise-risk` |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry (Portfolio & risk → Enterprise risk, §6.10, Phase 2) |
|---|---|---|
| `/enterprise-risk` | `ErmPage` → `AppetiteSection` | Risk appetite |
| `/enterprise-risk/register` | `RegisterPage` | Risk register |
| `/enterprise-risk/insider` | `InsiderPage` | Insider & related party |
| `/enterprise-risk/regulatory` | `RegulatoryPage` | Regulatory & policies |
| `/enterprise-risk/brc-pack` | `BrcPackPage` | BRC pack |
| `/enterprise-risk/lines-of-defence` | `LinesOfDefencePage` | Lines of defence |

Exported API: `requestRasChange()`, `ermKeys`, `ERM`, payload types.

## 4. Data model
| Entity / store | Key fields |
|---|---|
| `AppetiteMetric` (computed) | id RA-01…RA-11, name, type, limit, tolerance, direction (max/min), unit, actual, history, formula, source, basis, owner, rag |
| `EnterpriseRisk` (store `risks`) | id, title, category, owner/ownerRole, inherent, residual, trend, response (Treat/Tolerate/Transfer/Terminate), COSO stage, keyControls, linkedMetric, acceptedBy/At, acceptanceRationale |
| `Circular` (store) | id, ref, title, issuedAt, area, impact, status (New / Under assessment / Linked to policy / No action required), policyId |
| `Policy` (store) | id, name, owner, lastReviewed, required |
| `RegBreach` (store) | id, area, description, identifiedBy, severity, status, penalty |
| `BrcPack` (store `packs`) | id, meeting, sections, summary, status (Draft / Submitted to CRO / Approved for BRC), approvedBy, summaryAdoptedBy |
| `appetiteEscalations` (store) | metricId → by, at, to |
| `Insider` (computed) | obligorId, insider, relationship, holdingPct |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `enterprise-risk.ras.<id>.limit` / `.tolerance` | `data.ts` `rasLimits` (via `appetiteMetrics`); `platform.ts` apply |
| `enterprise-risk.ras.version` etc. | `data.ts` `rasVersion()`; appetite section |
| `enterprise-risk.appetite.amberEscalationRoles` / `.redEscalationRoles` | `sections/appetite.tsx` |
| `enterprise-risk.brc.packReadyRoles` | `platform.ts` BRC approval apply |
| `enterprise-risk.brcPack.requiresAdoptedSummary` | `platform.ts` hook `enterprise-risk.brc-pack-needs-adopted-summary`; `sections/brc-pack.tsx` (notice, submit disabled) |
| `enterprise-risk.policy.reviewCycleYears` / `.dueSoonDays` | `data.ts` `policyStatus`; `sections/regulatory.tsx` |
| `enterprise-risk.insider.significantShareholdingPct` | `sections/insider.tsx` |
| `enterprise-risk.largeExposurePct` | `data.ts` `spineFigures` |
| `operational-risk.loss.annualNetLimitNgn` | `logic.ts` |
| `ai.model.narrative` | `sections/brc-pack.tsx` |
| `operations.minCommentLength` | `sections/appetite.tsx`, `sections/register.tsx` |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| — (none) | Sections gate actions with `useCan("enterprise-risk", "edit")` (CRO and Head of Risk have edit; others view). None of the catalogue keys (`enterprise-risk.risk-appetite.view` … `enterprise-risk.brc-pack.submit`) are checked by name (gap, invariant 12). |

## 7. Workflows, notifications, events, hooks wired
| Item (REQUIREMENTS §) | Code location |
|---|---|
| §5 `enterprise-risk.ras.change` | `platform.ts` register + `requestRasChange`; submitted from `sections/appetite.tsx` |
| §5 `enterprise-risk.risk.acceptance` | `platform.ts`; submitted from `sections/register.tsx` |
| §5 `enterprise-risk.brc-pack.approval` | `platform.ts`; submit / decide in `sections/brc-pack.tsx` |
| §5 AI summary sign-off | `sections/brc-pack.tsx` → `submitAiSignOff` (ai module); adopted by subscriber in `platform.ts` |
| §6 `enterprise-risk.appetite-breach` | `sections/appetite.tsx` escalate |
| §6 `enterprise-risk.brc-pack-ready` | `platform.ts` BRC approval apply |
| §6 `enterprise-risk.brc-pack-returned` | `platform.ts` `onReject` and `enterprise-risk.brc-pack-reopen` subscriber (returned) |
| §7 events | `platform.ts` (ras.changed, risk.accepted, brc-pack.approved/returned/summary-adopted); sections (appetite.breach-escalated, risk.reviewed, brc-pack.compiled/submitted, circular.assessed/linked, policy.reviewed) |
| §7 hooks | `sections/appetite.tsx` (appetite.escalate.before/after); `sections/brc-pack.tsx` (brc-pack.compile.before/after, brc-pack.submit.before/after); built-in submit veto in `platform.ts` |

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/risk/enterprise-risk.spec.ts` — "Head of Risk compiles and submits the BRC pack; CRO approves it in Operations" (adopts the AI summary first; submit gate) and "the old executive board-pack route redirects" | ERM-FR-10, EXE-FR-11 |
| `e2e/risk/enterprise-risk.spec.ts` — "a role with view-only access can't compile a pack" | Module-level access gate |
| `e2e/risk/pages-load.spec.ts` | All six pages load per role |
| Unit tests | None (vitest configured, no tests) — `appetiteRag`, `policyStatus`, `insiderFlags` untested |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status (Done / Partial / Missing) |
|---|---|---|---|
| ERM-FR-01 | `data.ts` `appetiteMetrics`, `logic.ts`, `sections/appetite.tsx` (CAR, liquidity, LCR, NOP actuals simulated) | pages-load | Partial |
| ERM-FR-02 | `sections/appetite.tsx` escalate — manual button, not automatic | — | Partial |
| ERM-FR-03 | `platform.ts` `enterprise-risk.ras.change` | — | Done |
| ERM-FR-04 | `data.ts` `insiderFlags` (fixed demo set, ER2) | — | Partial |
| ERM-FR-05 | `sections/insider.tsx` (provision column deferred) | — | Partial |
| ERM-FR-06 | `sections/regulatory.tsx` (seeded circulars, no feed) | — | Partial |
| ERM-FR-07 | `data.ts` `policyStatus`, `sections/regulatory.tsx` | — | Done |
| ERM-FR-08 | `sections/register.tsx` | — | Done |
| ERM-FR-09 | `platform.ts` `enterprise-risk.risk.acceptance` | — | Done |
| ERM-FR-10 | `sections/brc-pack.tsx`, `platform.ts` | enterprise-risk.spec | Done |
| ERM-FR-11 | `sections/brc-pack.tsx` + ai sign-off subscriber | — | Done |
| ERM-FR-12 | `sections/lines-of-defence.tsx` (literal mapping, TD-903) | pages-load | Partial |

## 10. Gaps against the invariants
- Invariant 12: no named permission checks — `useCan("enterprise-risk", "edit")` only; view-level keys per tab and export key not mirrored.
- Invariant 9 (automated escalation): PRD §6.10 asks for automated breach escalation; escalation is a user action and there is no scheduler or SLA.
- Invariant 9 (notified): RAS change approval and risk acceptance have no module notification (generic `operations.request-completed` to the requester only); metric owners aren't notified of breaches.
- Invariant 8: workflow step SLAs are literals in `defaultSteps` (TD-127 pattern); role-to-line mapping literal (TD-903); BRC page count heuristic (TD-902); CAR / liquidity / LCR / NOP actuals and insider names are demo literals in `data.ts` without a TD entry (cf. TD-507 for executive).
- Duplication: RAS-style KRI thresholds also defined as executive rules (TD-508).
- Invariant 9 (connector-ready): CBN circulars feed and BRC pack rendering are recorded in [`docs/integration-points.md`](../../integration-points.md) (§5); circulars are seeded.
- Shares audit helpers from `operational-risk/shared` (cross-module coupling).

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-902 | BRC pack page count is a layout heuristic |
| TD-903 | Role-to-line-of-defence mapping is a code literal |
| TD-127 | Pattern: workflow step SLA literals in `defaultSteps` (raised for ifrs9 / market-risk; applies here too, not yet listed for this module) |
