# Portfolio & MIS — requirements

| | |
|---|---|
| Module | `src/modules/portfolio` (nav module `portfolio`, route `/portfolio`) |
| Repo | credigit-ser-frontend |
| PRD | §6.6.1–§6.6.9; §5.1 (CBA reconciliation), §5.6 (limit engine); §8 (formulas / source mapping); §9.1 (CBN limits, CCF, CAR); §6.10 (appetite); §6.12 (AI drafting) |
| Owner (business) | Portfolio / MIS Officer (validator); Head of Risk, CRO (release, appetite); ALCO (CRO / MD) for plans |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

Bank-wide view of the loan book: application and portfolio dashboards, sectoral / single-obligor / large-exposure / government limits with near-breach alerts, Top-N concentration, WARR, and (Phase 2) sector RAROC, forward-looking projections and annual plan ingestion. Generates CBN returns and board packs that the MIS officer validates and a second person releases.

In scope: dashboards (§6.6.1), limit report and limit monitor (§6.6.2, §5.6), concentration (§6.6.3), RAROC / capital consumption (§6.6.5), regulatory reporting (§6.6.6), projections (§6.6.7), annual plan (§6.6.8), WARR (§6.6.9).

Out of scope: limit gate at origination (`origination`, §6.1.5); IFRS 9 ECL (`ifrs9` — portfolio uses an ECL proxy); executive cockpit / BRC pack (`executive`); sector limit values themselves (tenant sector table, admin).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Portfolio / MIS Officer | Generate, validate and submit report runs, upload and submit plans, submit projection commentary, export | `portfolio.dashboards.view`, `portfolio.limits.view`, `portfolio.concentration.view`, `portfolio.warr.view`, `portfolio.sector-performance.view`, `portfolio.projections.view`, `portfolio.annual-plan.view`, `portfolio.reports.view`, `portfolio.data.export`, `portfolio.reports.download`, `portfolio.reports.generate`, `portfolio.reports.submit`, `portfolio.plans.upload`, `portfolio.plans.submit`, `portfolio.projection-commentary.submit` |
| Head of Risk / CRO | Release reports; review / approve plans (Head of Risk → CRO / MD); adopt projection commentary; receive limit alerts | `operations.items.decide` + view keys |
| MD | ALCO plan approval | `operations.items.decide` |
| Credit Analyst | Adopt projection commentary (Operations step) | `operations.items.decide`, `portfolio.projections.view` |
| BDM, Loan Review, Middle Office, Group Head, MCC, BCC, Board, other risk-view roles | View | `portfolio.*.view` |
| System Admin | Holds every permission by default (invariant 12) | all |

## 3. Functional requirements

| ID | Requirement | Source |
|---|---|---|
| PTF-FR-01 | Application & portfolio dashboards: distribution by application type, processing stage, product type, tenor range, internal risk rating, sector. | §6.6.1 |
| PTF-FR-02 | Sectoral limit report from the full CBA book: sector aggregate vs tenant limit, near-breach early warning, breach. | §6.6.2, §5.6; exposure basis: Assumption PF1 |
| PTF-FR-03 | Single-obligor limit (20 % SHF, off-balance at 33⅓ %), large exposures (≥ 10 % SHF), aggregate large-exposure ceiling (8 × SHF), all tiers of government ≤ 10 % of portfolio. | §5.6, §6.6.2, §9.1 (CBN 3.2) |
| PTF-FR-04 | Raise near-breach / breach alerts on status transition and escalate. | §6.6.2, §6.4.4; recipients: Assumption PM3 |
| PTF-FR-05 | Top 10 / 20 / 50 / 100 concentration. | §6.6.3; HHI / connected groups: Assumption PF5 |
| PTF-FR-06 | Sector performance: capital consumption (RWA × min CAR) and RAROC vs hurdle. | §6.6.5; inputs: Assumption PF3 |
| PTF-FR-07 | Auto-generate CBN returns and board packs on a configured cadence; figures drill down to §8 source mapping; human validation and release. | §6.6.6, §6.12; catalogue: Assumption PF6; releaser: Assumption PM1 |
| PTF-FR-08 | Block report release while a CBA reconciliation break is open (tenant choice). | §5.1 |
| PTF-FR-09 | Forward-looking 3 / 6 / 12-month projected NPL / roll-rate per sector and scenario; AI-drafted commentary adopted only after review. | §6.6.7, §6.12 |
| PTF-FR-10 | Ingest annual Board plan; cycle-adjusted allocation guidance; variance vs operative plan; versions retained, revisions approved. | §6.6.8; approval chain: Assumption PM2 |
| PTF-FR-11 | WARR = Σ(exposure × grade score) / Σ exposure; Board ceiling and early-warning band; migration and new-business split; drill-through to obligors. | §6.6.9; parameters: Assumption PF4; CCF: Assumption PF2 |

## 4. Business rules and parameters

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `platform.shareholdersFundsNgn` (core) | Base for single-obligor / large-exposure limits | ₦60bn | PRD §6.6.2 / §8 — demo |
| `portfolio.totalQualifyingCapitalNgn` | Large exposures to capital denominator | ₦52bn | PRD §6.6.5 — demo |
| `portfolio.singleObligorLimitPct` | Single-obligor limit | 20 % | PRD §5.6 — CBN 3.2(a) |
| `portfolio.offBalanceSolWeightPct` | Off-balance weighting in SOL | 33⅓ % | PRD §5.6, §9.1 — CBN 3.2(b) |
| `portfolio.largeExposurePct` | Large-exposure threshold | 10 % | PRD §5.6 — CBN 3.2(d) |
| `portfolio.aggregateLargeExposureMultiple` | Aggregate large-exposure ceiling | 8 × SHF | PRD §5.6 — CBN 3.2(e) |
| `portfolio.governmentCeilingPct` | All tiers of government | 10 % | PRD §6.6.2 — CBN 3.2(c) |
| `portfolio.earlyWarningPct` | Near-breach threshold | 90 % of limit | PRD §6.6.2 — demo |
| `portfolio.minCarPct` | Minimum CAR for capital consumption | 10 % | PRD §9.1 |
| `portfolio.warrCeiling` / `warrEarlyWarning` | WARR appetite | 4.5 / 4.3 | PRD §6.6.9 / §6.10 — demo (PF4) |
| `portfolio.nplAppetitePct` | NPL appetite | 5 % | PRD §6.10 — demo |
| `portfolio.costOfFundsPct` / `feeIncomePct` / `opexAllocationPct` / `rarocHurdlePct` | RAROC inputs | 13.5 / 1 / 2.5 / 20 % | PRD §6.6.5 — demo (PF3) |
| `portfolio.eclProxy.stage1Pct` / `stage2Pct` / `substandardPct` / `doubtfulPct` / `lostPct` | ECL proxy for RAROC | 1 / 6 / 10 / 50 / 100 % | PRD §6.7 (proxy), §6.7.1 |
| `portfolio.ccf.<product>` (10 products) | Credit-conversion factor | 0–100 % per product | PRD §9.1; demo classification (PF2) |
| `portfolio.riskWeight.<obligorType>` (5 types) | RWA risk weight | Corporate / Commercial 100, SME / Retail 75, Public sector 20 % | PRD §6.6.5 — demo (PF3) |
| `portfolio.periodStartDate` / `openingDateLabel` | YTD period start / opening label | 2026-01-01 / 31 Dec 2025 | PRD §6.6.9 — demo |
| `portfolio.obligorReportFloorPct` | Hide obligors below this SOL utilisation | 25 % | Tenant parameter (demo) |
| `portfolio.reports.blockReleaseOnReconBreak` | Recon-break gate on/off | true | PRD §5.1 |
| `portfolio.reports.releaseNotifyRoles` | Notified on release | MIS, Head of Risk, CRO | Tenant parameter (demo) |
| `portfolio.limits.alertRoles` | Limit alert recipients | Head of Risk, CRO, MIS | PRD §6.6.2, §6.4.4 (PM3) |
| `portfolio.plan.approvedNotifyRoles` | Notified on plan approval | MIS, Head of Risk, CRO, MD | Tenant parameter (demo) |
| `portfolio.reportCadence.<reportId>` | Cadence per catalogue report | per report | PRD §6.6.6 |
| `portfolio.plan.deterioratingFactor` / `improvingFactor` | Cycle adjustment of planned share | 0.8 / 1.15 | PRD §6.6.8 — demo |
| `portfolio.projection.deterioratingAbovePct` / `improvingBelowPct` | Projection direction bands | 8 / 5 % | PRD §6.6.7 — demo |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `portfolio.report.release` | MIS officer validates and submits a run | 1 step: any of Head of Risk, CRO · 24 h | PM1 |
| `portfolio.plan.approve` | Plan version submitted | 2 steps: Head of Risk review · 48 h → ALCO (any of CRO, MD) · 72 h | PM2 |
| `portfolio.projection.adopt` | AI projection commentary submitted | 1 step: any of Credit Analyst, Head of Risk, CRO · 48 h | §6.6.7 governance |
| `executive.*` (executive module) | Executive summary sign-off uses `components/governance.tsx` | — | PF7 |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `portfolio.limit-breach` | Limit enters Breach | `portfolio.limits.alertRoles` |
| `portfolio.limit-near-breach` | Limit enters Near breach | `portfolio.limits.alertRoles` |
| `portfolio.report-released` | Run released | `portfolio.reports.releaseNotifyRoles` |
| `portfolio.report-returned` | Release rejected | Requester |
| `portfolio.plan-approved` | Plan approved | `portfolio.plan.approvedNotifyRoles` |
| `portfolio.plan-rejected` | Plan rejected | Requester |
| `portfolio.projection-adopted` | Commentary adopted | Requester + MIS officer role |

## 7. Events and hook points

| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `portfolio.report.generated` / `.submitted` / `.released` / `.returned` | Report run lifecycle | reportId, period, operationId, outcome, reason |
| event | `portfolio.plan.uploaded` / `.submitted` / `.approved` / `.rejected` | Plan lifecycle | version, supersedes, reason |
| event | `portfolio.projection.submitted` / `.adopted` | Commentary lifecycle | scenario, operationId |
| event | `portfolio.limit.breached` / `.nearBreached` / `.restored` | Limit status transition | kind, name, status, utilisation, limit, previous |
| hook | `portfolio.report.generate.before` / `.after` | Around generating a run | before: veto / enrich period |
| hook | `portfolio.report.submit.before` / `.after` | Around submit for release | before: veto — built-in `portfolio.recon-break-gate` |
| hook | `portfolio.report.release.after` | After release (e.g. file to regulator portal) | after only |
| hook | `portfolio.plan.upload.before` / `.after` | Around plan ingestion | before: veto file |
| hook | `portfolio.plan.submit.before` / `.after` | Around plan submission | before: veto |
| hook | `portfolio.projection.submit.before` / `.after` | Around commentary submission | before: veto |
| hook | `portfolio.limit.alert.before` / `.after` | Around a limit alert | before: veto (suppress) / enrich |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Core banking (CBA) | Inbound, daily | Spine refresh | Facility book, balances, reconciliation breaks (§5.1) | Simulated (TD-502) |
| GL / regulatory capital return | Inbound | Period close | SHF, qualifying capital, cost of funds | Rules (demo values) |
| Projection engine (§6.6.7) | Inbound | Scenario run | Sector NPL / roll-rate projections | Simulated (TD-503) |
| Board plan file | Inbound, upload | Plan ingestion | Sector allocation | Simulated parse (TD-506) |
| CBN returns / regulator portal | Outbound | Report release | Return files | Not built (hook `portfolio.report.release.after`) |
| IFRS 9 engine | Inbound (internal) | ECL run | ECL per facility | Not wired — ECL proxy rules |
| E-mail | Outbound | Notifications | Rendered HTML | Outbox only (demo) |

## 9. Non-functional

- Audit: report generate / submit / release / return, plan upload / submit / approve / reject, projection submit / adopt, limit status transitions (system actor).
- Explainability: calculation notes (`components/calc-note.tsx`) show formula and source (PRD §2.1, §10.3, §8); WARR drill-through to obligors.
- Segregation: requester can't release / approve their own run, plan or commentary (Operations engine).
- Exports: CSV on every register.

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| PF1 | Sector exposure on outstanding or approved? | Funded outstanding (§8) |
| PF2 | CCF for undrawn term / overdraft | OD / revolving 0 %, committed undrawn 50 % |
| PF3 | Risk weights, CoF, fees, opex, hurdle | Demo values as rules |
| PF4 | Grade-to-score, WARR ceiling / early warning, new-business period | Grade n = score n; 4.5 / 4.3; YTD |
| PF5 | HHI; connected groups | No HHI; per obligor |
| PF6 | CBN return templates / codes / cadences | Generic catalogue (TD-505) |
| PF7 | Executive sign-off on a view-only module | Sign-off by role id (executive module) |
| PM1 | Who releases each report | MIS submits; Head of Risk / CRO releases |
| PM2 | Plan approval chain | Head of Risk → CRO / MD (ALCO) |
| PM3 | Limit alert recipients; notify on return within limit? | Rule `portfolio.limits.alertRoles`; restore audited + published, not notified |
| O5 (§5.6 / §6.6.2) | SHF and sector-limit base (origination) | Differs from PF1 — origination uses approved book |
