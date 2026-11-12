# IFRS 9 & ICAAP — requirements

| | |
|---|---|
| Module | `src/modules/ifrs9` (nav module `ifrs9`, "IFRS 9 & ICAAP", Phase 2) |
| Repo | credigit-ser-frontend |
| PRD | §6.7, §6.7.1–6.7.5, §9.1 (CBN capital / provisioning), §6.4.4 (approval protocol), §10.3 |
| Owner (business) | Predictive Analytics Officer (model governance), Head of Risk, CRO; Board (ICAAP) |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

Computes IFRS 9 expected credit loss (ECL) and staging in parallel with the CBN prudential classification and provisioning, posts the CBN 12.4 reserve-transfer entry, governs PD/LGD/EAD model versions, supports ICAAP (stress testing, capital-adequacy classification, sign-off) and runs the declassification (stage reversal) path with write-backs.

In scope:
- ECL overview, staging (CBN ↔ IFRS 9 mapping, SICR triggers, stage transfers), model register, ICAAP workspace, declassification, rules & approvals page.
- CBN Lost-facility haircut adjustment (§6.7.3) inside the prudential provision.

Out of scope (owned elsewhere):
- CBN past-due ladder and Loan Review register (monitoring, §6.4.1); collateral values and currency-mismatch flag (collateral, §6.5); Finance posting itself (GL connector, not built); CRO dashboard view of migrations (executive, §6.11).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Predictive Analytics Officer | Proposes declassifications, submits model versions, reviews AI model findings, runs stress tests, proposes scenario changes, submits ICAAP, requests reserve posting | `ifrs9.ecl.view`, `ifrs9.staging.view`, `ifrs9.models.view`, `ifrs9.icaap.view`, `ifrs9.declassification.view`, `ifrs9.governance.view`, `ifrs9.data.export`, `ifrs9.ecl.post`, `ifrs9.models.submit`, `ifrs9.model-findings.review`, `ifrs9.stress-tests.run`, `ifrs9.icaap-scenarios.request-change`, `ifrs9.icaap.submit`, `ifrs9.declassification.propose`, `ifrs9.declassification.withdraw` |
| Head of Risk, CRO | View; approve declassification, model validation/approval, reserve posting, scenario change, ICAAP (Operations steps) | view keys above + `operations.items.decide` |
| CCO, MD, Portfolio MIS Officer | View only | view keys above |
| Board | Final ICAAP approval (Operations step) | `operations.items.decide` |
| Any role changing an `ifrs9.*` rule | Generic rule-change request | `rules.rules.request-change` |

## 3. Functional requirements

| ID | Requirement | Source |
|---|---|---|
| IF9-FR-01 | Stage every in-scope facility (Active / Restructured) into Stage 1/2/3 using DPD backstops and qualitative SICR triggers (grade, notch downgrade, watchlist, Defensive posture). | §6.7.1; SICR grade/notch values Assumption — IF5 (§6.7.1–6.7.4) |
| IF9-FR-02 | Compute ECL = PD × LGD × EAD (12-month for Stage 1, lifetime for Stages 2–3) with a probability-weighted forward-looking macro overlay. | §6.7.1, §6.7.2; calibration Assumption — IF3 (§6.7.2) |
| IF9-FR-03 | PD from master scale segmented by sector and 360 RAR posture; LGD from perfected collateral (FSV / MTM, haircut) and work-out recovery; EAD = outstanding + accrued interest + CCF × undrawn. | §6.7.2; accrual convention Assumption — IF4 (§6.7.2) |
| IF9-FR-04 | Compute the CBN prudential provision in parallel (general provision capped at 1.25% of RWA; 10/50/100% specific; Lost haircut adjustment only on perfected collateral, lapsing after 1 year). | §6.7.1, §6.7.3, §9.1; general rate Assumption — IF2 (§6.7.1) |
| IF9-FR-05 | Show the IFRS 9 vs prudential difference and request the CBN 12.4 reserve-transfer posting; post only after approval. | §6.7.1; direction Assumption — IF1 (§6.7.1); approval Assumption — IF3 (§6.7.1) |
| IF9-FR-06 | Show stage transfers and the ECL movement waterfall for the quarter. | §6.7.1, §6.11 (simulated — TD-124) |
| IF9-FR-07 | Model register with source mapping, review due dates (refresh at least annually) and full version/decision history. | §6.7.2 (CBN 12.15), §10.3 |
| IF9-FR-08 | Model version change: owner submits → independent validation → approval for production. | §6.7.2; chain Assumption — IF2 (§6.7.2, Operations) |
| IF9-FR-09 | AI-flagged model findings are labelled and need a human accept/dismiss. | §6.12, §2.3 |
| IF9-FR-10 | ICAAP stress workspace applies macro scenarios (PD multiplier, LGD add-on, FX devaluation) to project CAR; flag and notify a CAR breach. | §6.7.4 |
| IF9-FR-11 | Capital-adequacy classification (Adequately / Under / Significantly / Critically under-capitalised / Insolvent) against the licence-category minimum, with supervisory-action checklist and Pillar 2 add-ons. | §6.7.4, §9.1; checklist / Pillar 2 Assumption — IF5 (§6.7.4) |
| IF9-FR-12 | ICAAP stress-scenario changes and ICAAP report sign-off route through Operations. | §6.7.4; chain Assumption — IF4 (§6.7.4) |
| IF9-FR-13 | Declassification: engine identifies eligible facilities (cure period, probation, restructured minimum Stage 2); proposer submits with partial-cure %; approving officer approves; ECL and suspended-interest write-back; facility stage updated. | §6.7.5; approver Assumption — IF1 (§6.7.5), IF6 (§6.7.5) |
| IF9-FR-14 | Specialised-loan overlays (CBN Annexures 2–6) applied by product-type tag. | §6.7.2 — not implemented (copy only; see MON6) |
| IF9-FR-15 | Every governance page shows the rules in force and links to Operations approvals for the module. | §10.4 |

## 4. Business rules and parameters

All keys are `ifrs9.*` in `src/modules/ifrs9/platform.ts`. Default values are demo values unless the source is a PRD/CBN figure.

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `pd.grade1…grade10` | 12-month PD master scale | 0.0012 … 0.06 | §6.7.2 (demo) — IF3 |
| `pdMultiplier.sector.<sectorId>` | Sector PD multiplier | 1.1–1.25 | §6.7.2 (demo) |
| `pdMultiplier.posture.<posture>` | 360 RAR posture PD multiplier | 1.1 / 1.0 / 0.95 / 1.2 | §6.7.2 (demo) |
| `pd.floor`, `pd.cap`, `pd.minTenorYears` | PD bounds, term-structure minimum tenor | 0.0005, 0.95, 0.25 y | Demo |
| `fli.<scenario>.weight`, `fli.<scenario>.pdFactor` | Macro scenario weights and PD factors | per scenario | §6.7.2 / §5.5 (demo) |
| `lgd.floor`, `lgd.unsecuredCap`, `lgd.recoveryRate` | LGD floor / cap / work-out recovery | 10%, 75%, 85% | Demo |
| `ccf.revolving`, `ccf.guarantee` | CCF on undrawn revolving / guarantees | 75%, 50% | §6.7.2 (demo), §9.1 |
| `accrual.dpdCap`, `accrual.windowDays` | Accrued-interest convention | 90, 30 days | Demo — IF4 |
| `usdNgnSpot` | USD/NGN spot (also used by market-risk) | 1535 | Demo — IF7 |
| `stage2DpdTrigger`, `stage3DpdTrigger` | DPD backstops | 30, 90 | §6.7.1 |
| `sicr.gradeTrigger`, `sicr.notchDowngrade`, `sicr.watchlistTrigger`, `sicr.defensiveTrigger` | Qualitative SICR triggers | 7, 3, on, on | Demo / §6.7.1 |
| `cbn.generalProvisionRate`, `cbn.generalProvisionCapRwa` | General provision and cap | 1%, 1.25% | IF2 / CBN 3.16(d) |
| `cbn.substandardRate`, `cbn.doubtfulRate`, `cbn.lostRate` | Specific provision rates | 10%, 50%, 100% | CBN 12.2(a)(2) |
| `cbn.dpd.watchlist/substandard/doubtful/lost` | CBN DPD bands | 30, 90, 180, 360 | §6.7.1 |
| `cbn.haircut.cash/quotedShares/legalMortgage`, `cbn.haircutLapseDays` | Lost haircut weightings, lapse | 0%, 20%, 50%, 365 | CBN 12.13 |
| `cure.stage3DpdThreshold`, `cure.periods`, `cure.stage2ProbationMonths`, `cure.restructuredProbationMonths`, `cure.watchlistExtraPeriods`, `cure.suspendedInterestPolicy` | Declassification triggers and write-back policy | 90, 3, 3, 12, 3, "On cash receipt" | §6.7.5 (demo) — IF6 |
| `model.reviewIntervalMonths` | Model refresh interval | 12 | CBN 12.15 |
| `icaap.licenceCategory`, `icaap.minCarOther`, `icaap.minCarInternational`, `icaap.tier2CapPctOfTier1` | Minimum CAR and Tier 2 cap | international, 10%, 15%, 33.33% | §9.1 |
| `icaap.band.significantly`, `icaap.band.critically` | Capital-class bands | 5%, 2% | CBN 3.16(f)-(g) |
| `icaap.taxShield`, `icaap.pillar2.<risk>` | Tax shield on ECL increase, Pillar 2 add-ons | 30%, per risk | Demo — IF5 |
| `capital.rw.*`, `capital.loanBookShareOfCreditRwa`, `capital.marketRwaPct`, `capital.operationalRwaPct`, `capital.tier1Pct`, `capital.deductionsPct`, `capital.tier2Pct`, `capital.fxMarketRwaSensitivity` | Capital-base demo calibration | various | Demo — TD-125 |
| `scenario.<id>.<field>` | ICAAP stress scenario severities | per scenario | §6.7.4 (demo) — TD-128 |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `ifrs9.declassification` | PAO proposes a declassification | Approving officer: any of Head of Risk, CRO · 48 h | §6.7.5 — IF1 (§6.7.5) |
| `ifrs9.model.approval` | Model owner submits a version | Independent validation: Head of Risk · 120 h → Approval for production: CRO · 72 h | §6.7.2 — IF2 (§6.7.2, Operations) |
| `ifrs9.ecl.post` | Reserve-transfer posting requested | Head of Risk · 24 h → CRO · 24 h | §6.7.1 — IF3 (§6.7.1, Operations) |
| `ifrs9.icaap.scenario.change` | Scenario severity change proposed | Head of Risk · 48 h → CRO · 48 h | §6.7.4 — IF4 (§6.7.4, Operations) |
| `ifrs9.icaap.approval` | ICAAP report submitted | Head of Risk · 72 h → CRO · 72 h → Board · 240 h | §6.7.4 — IF4 (§6.7.4, Operations) |
| `rule.change` (core) | Any single `ifrs9.*` rule changed | Head of Risk/CRO → System Admin/CRO | §10.4 — TD-128 (bypasses the scenario workflow) |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `ifrs9.declassification-approved` | Declassification approved and written back | Predictive Analytics Officer, Head of Risk |
| `ifrs9.model-approved` | Model version approved for production | Predictive Analytics Officer, Head of Risk |
| `ifrs9.model-findings` | Validation rejected / returned with findings | Predictive Analytics Officer |
| `ifrs9.reserve-posted` | Reserve-transfer entry posted | Head of Risk, CRO, Predictive Analytics Officer |
| `ifrs9.car-breach` | Stress test projects CAR below minimum | CRO, Head of Risk, Predictive Analytics Officer |
| `ifrs9.scenario-approved` | Scenario change applied | Predictive Analytics Officer, Head of Risk, CRO |
| `ifrs9.icaap-approved` | ICAAP approved by the Board | Head of Risk, CRO, Predictive Analytics Officer, MD |
| `operations.approval-requested` / `operations.request-completed` (core) | Each workflow step / completion | Eligible approvers / requester |

## 7. Events and hook points

| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `ifrs9.declassification.proposed` / `.approved` / `.rejected` | Proposal routed / approved / rejected | declassificationId, from, to, writeBack, interestWriteBack |
| event | `ifrs9.model.submitted` / `.validated` / `.findings-raised` / `.approved` | Model governance steps | version, operationId, reason |
| event | `ifrs9.reserve.post-requested` / `ifrs9.reserve.posted` | Posting requested / posted | amount, direction, ifrs, prudential |
| event | `ifrs9.stresstest.completed`, `ifrs9.car.breached` | Stress test run / CAR below minimum | results, minimum, scenarios |
| event | `ifrs9.scenario.change-requested` / `ifrs9.scenario.changed` | Scenario change requested / applied | changes |
| event | `ifrs9.icaap.submitted` / `ifrs9.icaap.approved` | ICAAP submitted / Board-approved | car, classification |
| event | `ifrs9.ai-finding.reviewed` | AI model finding accepted / dismissed | finding, outcome |
| hook | `ifrs9.declassification.propose.before/after` | Proposal | before: veto / enrich |
| hook | `ifrs9.declassification.apply.before/after` | Approved stage change and write-back | before: veto blocks write-back |
| hook | `ifrs9.model.submit.before/after` | Model submission | before: veto |
| hook | `ifrs9.reserve.post.before/after` | Request and posting | before: veto / enrich entry |
| hook | `ifrs9.stresstest.run.before/after` | Stress test | before: veto |
| hook | `ifrs9.scenario.change.before/after` | Scenario change request and apply | before: veto / enrich changes |
| hook | `ifrs9.icaap.submit.before/after` | ICAAP submission | before: veto |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| CBA facility book | Inbound | ECL run | Outstanding, accrued interest, undrawn limits, DPD | Simulated (shared spine) |
| Loan Review past-due register | Inbound (internal) | ECL / staging run | DPD history, watchlist | Shared spine |
| Collateral register / SEC-CSCS MTM | Inbound (internal / §5.7) | ECL, Lost haircut | FSV / MTM, perfection | Shared spine |
| External macro feed (§5.5) | Inbound | Scenario refresh | Macro scenarios, weights | Rules only (demo) |
| General ledger — capital accounts / RWA | Inbound | ICAAP | Tier 1/2, deductions, RWA | Not built — TD-125 |
| Finance module / GL posting | Outbound | `ifrs9.reserve.posted` | CBN 12.4 reserve-transfer entry | Not built (event only) |
| Spot-rate feed | Inbound | ECL (USD facilities) | USD/NGN | Rule `ifrs9.usdNgnSpot` (demo) |

## 9. Non-functional

- Audit: every proposal, request, decision, stage change, write-back, stress run and AI-finding review writes to the audit log with before/after (§10.3).
- Explainability: each computed figure carries a formula/source popover (`CalcPopover` / `CalcRegister`), §2.1, §10.3.
- User scoping: actions limited to roles with `ifrs9` edit; segregation of duties enforced by the Operations engine (proposer cannot approve).
- AI output labelled "AI-flagged" with human sign-off (§2.3, §6.12).

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| IF1 (§6.7.1) | CBN 12.4 reserve-transfer direction wording | Prudential > IFRS → transfer to regulatory reserve, else release |
| IF2 (§6.7.1) | General-provision rate on performing book | 1% on Performing and Watchlist |
| IF3 (§6.7.2) | PD scale, multipliers, LGD floor/cap, CCF, scenario weights | Demo calibrations as rules |
| IF4 (§6.7.2) | Accrued / suspended interest convention | Accrued = outstanding × rate × (min(DPD, 90) + 30)/365 |
| IF5 (§6.7.4) | Supervisory checklist, Pillar 2 add-ons | Illustrative, labelled demo (TD-129) |
| IF6 (§6.7.5) | Cure / probation periods; approving officer | 3 periods / 3 months / 12 months; CRO or Head of Risk |
| IF7 (§5 / types) | USD facility amounts | NGN-equivalent |
| IF1 (§6.7.5, Operations) | Declassification approving officer | `ifrs9.declassification`: Head of Risk or CRO |
| IF2 (§6.7.2, Operations) | Model governance roles | Head of Risk validates → CRO approves |
| IF3 (§6.7.1, Operations) | Does reserve posting need approval? | Head of Risk → CRO |
| IF4 (§6.7.4, Operations) | ICAAP and scenario sign-off chains | ICAAP: HoR → CRO → Board; scenarios: HoR → CRO |
| IF5 (§6.7.1–6.7.4, Operations) | No defaults for model parameters | Demo defaults as `ifrs9.*` rules |
| MON6 (§6.4.1) | Specialised-loan grids (Annexures 2–6) | Not applied |
