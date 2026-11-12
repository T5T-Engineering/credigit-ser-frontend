# Portfolio & MIS — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

`usePortfolioModel()` (`hooks.ts`) builds one memoised model over the shared Risk Data Spine (facilities, obligors, sectors, applications) with pure selectors (`selectors.ts`) that read rules at call time; every page uses it so figures agree. `data.ts` holds demo generators (history, projections, reconciliation, report catalogue, CBN sector map). User changes (report runs, plan versions, sign-offs, operative plan, last limit states) persist in `store.ts` (`credigit.ser.portfolio`). Rule keys are centralised in `rule-keys.ts` and defined in `platform.ts` with the operation types, templates, events, hook points, the recon-break hook and the limit-alert raiser. Page components run the commands (hooks → store → audit via `useActor().log` → publish → submit). `components/governance.tsx` composes library workflow parts (`WorkflowInstanceCard`, `DecisionPanel`, `RuleRow`) and is shared with the executive module.

Limit monitoring (`useLimitMonitor`) runs **in the browser** when the dashboards, limits or executive page is open, comparing current statuses with `limitStates` and calling `raiseLimitAlert` on transitions.

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/portfolio/platform.ts` | Rules, 3 operation types, 7 templates, 13 events, 13 hook points, `portfolio.recon-break-gate` hook, `portfolio.operations-closed` subscription, `raiseLimitAlert` |
| `src/modules/portfolio/rule-keys.ts` | `PARAM_RULES`, `PORTFOLIO_RULES`, `ccfRuleKey`, `riskWeightRuleKey`, product / obligor type lists |
| `src/modules/portfolio/selectors.ts` | Totals, NPL, distributions, exposures (SOL, CCF), sector limits, large exposures, concentration, WARR, ECL proxy, profitability / RAROC |
| `src/modules/portfolio/hooks.ts` | `usePortfolioModel`, `useActor`, `limitAlerts`, `useLimitMonitor` |
| `src/modules/portfolio/data.ts` | History, projections (TD-503), reconciliation (TD-502), report catalogue (TD-505), CBN sector map (TD-504), `reportCadenceRuleKey` |
| `src/modules/portfolio/store.ts` | `usePortfolioStore` (runs, uploadedPlans, activePlanId, signOffs, planStatus, operativePlanId, limitStates) |
| `src/modules/portfolio/components/*.tsx` | `calc-note`, `governance`, `panel` compositions |
| `src/modules/portfolio/pages/*.tsx` | Eight pages (below) |

## 3. Routes / endpoints / public API

| Route | Page | Menu entry |
|---|---|---|
| `/portfolio` | `PortfolioDashboardsPage` | Portfolio & MIS → Dashboards |
| `/portfolio/limits` | `LimitsPage` | Limits |
| `/portfolio/concentration` | `ConcentrationPage` | Concentration |
| `/portfolio/warr` | `WarrPage` | WARR |
| `/portfolio/sector-performance` | `SectorPerformancePage` (Phase 2) | Sector performance |
| `/portfolio/projections` | `ProjectionsPage` (Phase 2) | Projections |
| `/portfolio/annual-plan` | `AnnualPlanPage` (Phase 2) | Annual plan |
| `/portfolio/reports` (`?run=RUN-…`) | `ReportsPage` | Regulatory reports |

Used by other modules: `usePortfolioModel`, `useLimitMonitor`, `useActor`, selectors, `components/governance.tsx` (executive).

## 4. Data model

| Entity | Key fields |
|---|---|
| `ReportRun` (store) | id, reportId, period, status (Generating / AI-drafted — awaiting validation / Validated / Submitted for release / Returned for correction / Released), generatedAt / By / ById, validatedBy / ById, releasedBy / At, reconciled, operationId, returnReason |
| `PlanVersion` + `planStatus` (store) | id, name, version, sector allocations; status (Board-approved / Approved / Draft / Uploaded — validating / Submitted for approval / Rejected / Superseded); `operativePlanId` |
| `SignOff` (store) | by, role, at, operationId — keyed by AI output id |
| `limitStates` (store) | last status per limit id (`SEC:`, `OBL:`, `LEX:AGG`, `WARR:BOOK`) |
| `ReportDef` (`data.ts`) | id, name, audience, PRD basis, default cadence |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `PARAM_RULES.*` (incl. `platform.shareholdersFundsNgn`) | `selectors.param` / `getPortfolioParams` / `usePortfolioParams`; `hooks.limitAlerts` |
| `portfolio.ccf.*`, `portfolio.riskWeight.*`, `portfolio.eclProxy.*` | `selectors.ccfTable`, `riskWeightTable`, `eclProxyPct` |
| `portfolio.periodStartDate`, `openingDateLabel`, `obligorReportFloorPct` | WARR / limits pages, selectors |
| `portfolio.reports.blockReleaseOnReconBreak` | `platform.ts` recon-break hook |
| `portfolio.reports.releaseNotifyRoles`, `portfolio.limits.alertRoles`, `portfolio.plan.approvedNotifyRoles` | `platform.ts` |
| `portfolio.reportCadence.*` | `data.reportCadence`, `reports-page.tsx` |
| `portfolio.plan.*Factor`, `portfolio.projection.*` | `data.ts` projections / plan guidance |

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| none — module access only | `useCan("portfolio", "edit")` on reports and annual-plan pages; `projections-page.tsx` uses `useCan("portfolio", "view")` for submitting commentary; `portfolio.*` catalogue keys not checked |

## 7. Workflows, notifications, events, hooks wired

| Item (REQUIREMENTS §) | Code location |
|---|---|
| `portfolio.report.release` (§5) | `reports-page.tsx` submit → `platform.ts` apply / onReject |
| `portfolio.plan.approve` (§5) | `annual-plan-page.tsx` submit → `platform.ts` apply / onReject |
| `portfolio.projection.adopt` (§5) | `projections-page.tsx` → `platform.ts` apply |
| Returned / withdrawn reset | subscription `portfolio.operations-closed` |
| Limit templates / events (§6–7) | `platform.raiseLimitAlert` ← `hooks.useLimitMonitor` |
| Report / plan / projection events and hooks (§7) | `reports-page.tsx`, `annual-plan-page.tsx`, `projections-page.tsx` |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/risk/portfolio.spec.ts` | MIS officer generates a run (AI-drafted, gated by recon break); validate & submit a reconciled run → Head of Risk releases in Operations; Head of Risk submits AI executive summary → CRO signs off (mobile) |
| `e2e/risk/pages-load.spec.ts` | Pages render |
| Unit tests | none |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| PTF-FR-01 | `dashboards-page.tsx`, `selectors.bookBy`, `pipelineTotals` | pages-load | Done (demo data) |
| PTF-FR-02 | `limits-page.tsx`, `selectors.sectorExposures` | — | Done |
| PTF-FR-03 | `selectors.obligorExposures`, `largeExposures`, government ceiling | — | Done |
| PTF-FR-04 | `useLimitMonitor`, `raiseLimitAlert` | — | Partial — client-side, per-browser monitor; no escalation ladder beyond one notification |
| PTF-FR-05 | `concentration-page.tsx`, `selectors.concentration` | — | Partial — no connected groups (PF5) |
| PTF-FR-06 | `sector-performance-page.tsx`, `selectors.profitability` | — | Partial — ECL proxy, demo inputs |
| PTF-FR-07 | `reports-page.tsx`, `portfolio.report.release` | portfolio.spec | Partial — catalogue literal (TD-505); simulated generation; no scheduler for cadence |
| PTF-FR-08 | `portfolio.recon-break-gate` | portfolio.spec | Done |
| PTF-FR-09 | `projections-page.tsx`, `portfolio.projection.adopt` | — | Partial — simulated engine (TD-503) |
| PTF-FR-10 | `annual-plan-page.tsx`, `portfolio.plan.approve` | — | Partial — simulated ingestion (TD-506) |
| PTF-FR-11 | `warr-page.tsx`, `selectors.computeWarr` | — | Done |

## 10. Gaps against the invariants

- Invariant 12: no named permission checks; projection commentary submission is allowed for any `portfolio` **view** role; System Admin has no portfolio access in `roles.ts`.
- Invariant 9 (scoped / audited): limit monitoring runs per browser on page view, so alerts depend on who opens which page and may repeat across users; audit row uses a literal `system-admin` role id for the system actor.
- Invariant 8: `portfolio.projection-adopted` recipient role (`portfolio-mis-officer`) is a code literal without TD id; report catalogue, CBN sector map, unmapped-obligor 100 % risk weight and simulated latencies are recorded (TD-501…506).
- Invariant 9 (notified): return within limit is not notified (PM3, by design); report generation / plan upload send no notification.
- Invariant 9 (connector-ready): CBA, GL, projection engine and CBN return filing are recorded in [`docs/integration-points.md`](../../integration-points.md) (§1, §4, §5, §12); release filing is a hook point only.
- Domain commands sit in page components (no service seam).
- No unit tests.

## 11. Tech debt

| TD id | Summary |
|---|---|
| TD-501 | Unmapped obligor falls back to 100 % risk weight |
| TD-502 | Simulated CBA suspense break literal |
| TD-503 | Simulated projection-engine calibration constants |
| TD-504 | Sector → CBN classification map is a code literal |
| TD-505 | Report catalogue is a literal (only cadence is a rule) |
| TD-506 | Simulated generation / ingestion latency |
