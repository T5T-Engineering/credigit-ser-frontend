# Market & liquidity risk — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

`data.ts` holds pure calculators (balance sheet, FX positions, desks, repricing gap, NII / EVE, liquidity metrics, maturity ladder, depositor concentration, early warnings, liquidity stress and reverse stress) over the IFRS 9 ECL rows and a demo calibration of the deposit / Treasury ledgers (TD-126). All thresholds and factors are `market-risk.*` rules read with `getRule` at call time. `actions.ts` is the only writer: each action runs `market-risk.<action>.before` hooks (veto / enrich), changes the persisted store, writes the audit log, publishes an event, notifies, then runs `.after` hooks (helper `guarded`). Approvals are Operations operations registered in `platform.ts`; their `apply` / `onReject` update the store.

```text
pages/*.tsx ──► data.ts (calculators, getRule) ◄── ifrs9/data.ts (ECL rows, usdNgn) · ifrs9 capital base
     └──► actions.ts ──► hooks · store.ts · audit · publish · notify
                    └──► submitOperation ──► platform.ts apply/onReject ──► store.ts / rules (RAS)
```

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/market-risk/platform.ts` | Rules, 4 operation types, 7 templates, 16 events, 18 hook points (9 × before/after) |
| `src/modules/market-risk/actions.ts` | `raiseBreach`, `escalateBreach`, `requestBreachClose`, `requestRasChange`, `setRiskFactorRelevance`, `setChapterReviewed`, `compileIlaap`, `submitIlaap`, `saveStressRun`, `requestStressApproval`, `rasValues` |
| `src/modules/market-risk/data.ts` | Calculators, demo ledgers, seed breaches, stress bands / fields |
| `src/modules/market-risk/store.ts` | Persisted store `credigit.ser.market-risk` (v2), `RAS_METRICS` |
| `src/modules/market-risk/use-market.ts` | Hook assembling inputs for pages |
| `src/modules/market-risk/pages/market.tsx` | NOP, FCY, VaR / stop-loss, IRRBB, interbank spread, breach log, detected exceedances |
| `src/modules/market-risk/pages/liquidity.tsx` | Liquidity ratios, LCR / NSFR / LDR, ladder, concentration, early warnings |
| `src/modules/market-risk/pages/ilaap.tsx` | RAS versions and change, risk-factor inventory, chapters, compile, sign-off |
| `src/modules/market-risk/pages/stress-testing.tsx` | Scenario builder, dynamic layer, run & save, reverse stress, submit for approval |
| `src/modules/market-risk/pages/governance.tsx` | Rules panels and module approvals (reuses `ifrs9/governance.tsx`) |

## 3. Routes / endpoints / public API

| Route | Page component | Menu entry (nav.ts) |
|---|---|---|
| `/market-risk` | `MarketRiskPage` | Market & liquidity → Market risk |
| `/market-risk/liquidity` | `LiquidityPage` | → Liquidity |
| `/market-risk/ilaap` | `IlaapPage` | → ILAAP (Phase 3) |
| `/market-risk/stress-testing` | `StressTestingPage` | → Stress testing (Phase 3) |
| `/market-risk/governance` | `MarketGovernancePage` | → Limits, rules & approvals |

No backend endpoints yet.

## 4. Data model

| Store / entity | Key fields |
|---|---|
| `Breach` (`breaches`) | id, at, metric, desk, actual, limit, levelRole, status (`Open` / `Escalated` / `Closed`), raisedBy, note, closedBy, closedAt |
| `RasVersion` (`rasVersions`) | version, at, by, note, values (earlyWarning, buffer per metric), operationId |
| `RiskFactor` (`riskFactors`) | category, factor, relevance (Low / Medium / High), tenantSpecific |
| `IlaapState` (`ilaap`) | period, status (`Draft` / `In review` / `Approved` / `Returned`), operationId, approvedAt / By |
| `chapters`, `compiled` | Chapter review flags; compile history with RAS version |
| `SavedRun` (`runs`, max 20) | name, assumptions, lcr, survivalDays, minBuffer, approval |
| `draft` | Scenario builder draft assumptions |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `market-risk.nopLimitPct*`, `varLimitPct.*`, `stopLossPct.*`, `stopLossEarlyWarningPct`, `limitWarningPct`, `interbankSpreadLimitPp`, `irrbbShock*` | `data.ts`, `pages/market.tsx` |
| `market-risk.liquidityRatioMinPct`, `lcrFloorPct`, `nsfrFloorPct`, `ldr*`, `ratioWarningMarginPct`, LCR / NSFR factors, `ew.*`, `concentrationCutoffs` | `data.ts` (`liquidityMetrics`, `earlyWarnings`, `concentrationCutoffs`), `pages/liquidity.tsx` |
| `market-risk.stress.*`, `dyn.*` | `data.ts` (`bandAssumptions`, `dynamicSignal`, `runLiquidityStress`, `reverseStress`) |
| `market-risk.ras.*` | `actions.ts` `rasValues`, `platform.ts` RAS apply |
| `market-risk.escalationRoles`, `alertRoles`, `ilaapRoles` | `actions.ts`, `platform.ts` |
| `ifrs9.usdNgnSpot`, `ifrs9.capital.*` | via `ifrs9/data.ts` |

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| none — `useCan("market-risk", "edit")` (role → module access) | `pages/market.tsx`, `liquidity.tsx`, `ilaap.tsx`, `stress-testing.tsx`, `governance.tsx` |
| (engine) approver role / SoD | `src/lib/platform/operations.ts` `canDecide` |

Catalogue keys to adopt: REQUIREMENTS §2.

## 7. Workflows, notifications, events, hooks wired

| Item (REQUIREMENTS §) | Code location |
|---|---|
| `market-risk.breach.close` (§5) | `platform.ts`; requested `actions.ts` `requestBreachClose` from `pages/market.tsx` |
| `market-risk.ras.change` (§5) | `platform.ts` (applies `ras.*` rules + new `RasVersion`); `actions.ts` `requestRasChange` |
| `market-risk.ilaap.signoff` (§5) | `platform.ts` (apply → Approved, onReject → Returned); `actions.ts` `submitIlaap` |
| `market-risk.stress.approve` (§5) | `platform.ts` (apply / onReject); `actions.ts` `requestStressApproval` |
| Templates (§6) | `defineTemplates` in `platform.ts`; sent from `actions.ts` (raise, escalate, early warning) and operation `apply` |
| Events (§7) | request-side in `actions.ts`, outcome-side in `platform.ts` |
| Hooks (§7) | `guarded()` / explicit `runHooks` in `actions.ts` for every action except `setChapterReviewed` |
| Pending state | `usePendingFor("IlaapRas", …)`, `usePendingFor("IlaapDocument", period)` in `pages/ilaap.tsx` |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/risk/market-risk.spec.ts` — "analyst raises a detected limit breach, escalates it, and closure is approved in Operations @mobile" | MR-FR-09 |
| `e2e/risk/market-risk.spec.ts` — "stress test run is saved and approved by Head of Risk then CRO" | MR-FR-13, MR-FR-15 |
| `e2e/risk/pages-load.spec.ts` | All routes render |
| Unit tests | none (vitest configured, no test files) |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| MR-FR-01 | `data.ts` `fxPositions`; `pages/market.tsx` | — | Done (demo data) |
| MR-FR-02 | `data.ts` `balanceSheet`; `pages/market.tsx` | — | Done (demo) |
| MR-FR-03 | `data.ts` `desks`; `pages/market.tsx` | — | Partial — confidence level, holding period and method are copy / seed values, not rules |
| MR-FR-04 | `data.ts` `repricingGap`, `niiAtRisk`, `eveSensitivity` | — | Done (demo) |
| MR-FR-05 | `data.ts` `INTERBANK_QUOTES`; `pages/market.tsx` | — | Done (demo) |
| MR-FR-06 | `data.ts` `liquidityMetrics`; `pages/liquidity.tsx` | — | Done (demo) |
| MR-FR-07 | `data.ts` `maturityLadder`, `topDepositors`, `fundingMix` | — | Done (demo) |
| MR-FR-08 | `data.ts` `earlyWarnings`; `actions.ts` `raiseBreach(…, "early-warning")` | — | Partial — raised manually, not auto-escalated |
| MR-FR-09 | `actions.ts` raise / escalate / close; `pages/market.tsx` | market-risk.spec | Partial — detected exceedances need a manual "Raise"; no SLA-driven escalation |
| MR-FR-10 | op `market-risk.ras.change`; `store.ts` `rasVersions`; `compileIlaap` records RAS version | — | Done |
| MR-FR-11 | `actions.ts` `setRiskFactorRelevance`, `setChapterReviewed`, `compileIlaap` | — | Done |
| MR-FR-12 | op `market-risk.ilaap.signoff` | — | Done |
| MR-FR-13 | `data.ts` `runLiquidityStress`, `reverseStress`; `pages/stress-testing.tsx` | market-risk.spec | Done (demo) |
| MR-FR-14 | `data.ts` `dynamicSignal` | — | Partial — sector signal is a literal, not read from the §6.6.7 engine |
| MR-FR-15 | `actions.ts` `saveStressRun`; op `market-risk.stress.approve` | market-risk.spec | Partial — browser keeps the last 20 runs only (`RUN_LIMIT`) |
| MR-FR-16 | — | — | Missing |

## 10. Gaps against the invariants

- Invariant 12: actions gated by `useCan("market-risk", level)`, not catalogue permission keys; System Admin is not granted the module.
- Invariant 8: VaR confidence / holding period / method not rules; `dynamicSignal()` sector, phase and justification are literals; `RUN_LIMIT = 20` and breach-close note minimum (5 chars, `pages/market.tsx`) are literals; none carry a TD id. Workflow SLA literals (TD-127); demo ledger calibrations (TD-126).
- Invariant 8 / 9 (workflow-routed): `market-risk.ras.*` keys can change one by one via generic `rule.change`, skipping Board approval (TD-128).
- Invariant 9 (workflow / extensible): `market-risk.breach.close` and `market-risk.ras.change` have no `onReject` (rejection not published or reflected on the record); no subscriber syncs Returned / withdrawn operations (ifrs9 has one); `setChapterReviewed` has no hook point.
- Invariant 9 (notified): no notification on ILAAP return, stress-run rejection, RAS rejection or ILAAP submission (generic approval-requested only).
- PRD §6.8.2 / §6.4.4: breaches and early warnings are not raised or escalated automatically; no SLA clock per escalation level.
- Invariant 9 (connector-ready): Treasury, CBA deposit / asset ledgers, market-data feed and GL capital are recorded in [`docs/integration-points.md`](../../integration-points.md) (§1, §3, §4); simulated (TD-126).
- Tests: no unit tests for liquidity / stress calculators.

## 11. Tech debt

| TD id | Summary |
|---|---|
| TD-126 | Demo calibrations stand in for CBA deposit / Treasury connectors (LDR, FCY share, profiles, holdings, VaR / MTM, FX history, interbank quotes, early-warning counters) |
| TD-127 | Workflow step SLA hours are literals in default definitions |
| TD-128 | `market-risk.ras.*` changeable via generic `rule.change`, bypassing `market-risk.ras.change` (Board) |
| TD-125 | Total capital comes from the ifrs9 capital-base calibration |
