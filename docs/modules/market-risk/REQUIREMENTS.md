# Market & liquidity risk — requirements

| | |
|---|---|
| Module | `src/modules/market-risk` (nav module `market-risk`, "Market & liquidity", Phase 2; ILAAP and stress testing Phase 3) |
| Repo | credigit-ser-frontend |
| PRD | §6.8, §6.8.1–6.8.4, §6.4.4 (escalation), §9.1, §6.10 / §6.11 (consumers) |
| Owner (business) | Market Risk Analyst; Head of Risk, CRO; ALCO (MD); Board (RAS, ILAAP) |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

Gives Treasury-facing risk monitoring: FX net open position, VaR and stop-loss per desk, IRRBB (repricing gap, NII-at-Risk, ΔEVE), interbank spread, CBN liquidity ratio, LCR, NSFR, LDR, maturity ladder, funding concentration, CBN 3.13(c) illiquidity early warnings, the limit-breach log with §6.4.4 escalation, the ILAAP workspace (versioned Risk Appetite Statement, risk-factor inventory, chapters, sign-off) and static + dynamic liquidity stress testing.

In scope: the five pages under `/market-risk`; RAS thresholds as versioned rules; breach raise / escalate / close; ILAAP compile and sign-off; stress-run save and approval.

Out of scope: Treasury / CBA / market-data connectors (demo calibration only — TD-126); intraday liquidity monitoring (named in §6.8.4, not built); risk-appetite scorecard and CRO dashboard (enterprise-risk / executive consume these metrics).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Market Risk Analyst | Raises and escalates breaches, raises early warnings, requests breach closure, proposes RAS versions, updates and submits the ILAAP, runs and submits stress scenarios | `market-risk.market.view`, `market-risk.liquidity.view`, `market-risk.ilaap.view`, `market-risk.stress-testing.view`, `market-risk.governance.view`, `market-risk.data.export`, `market-risk.breaches.create`, `market-risk.breaches.escalate`, `market-risk.breaches.request-close`, `market-risk.early-warnings.raise`, `market-risk.ras.request-change`, `market-risk.ilaap.update`, `market-risk.ilaap.submit`, `market-risk.stress-runs.run`, `market-risk.stress-runs.submit` |
| Head of Risk, CRO | View; approve breach closure, RAS, ILAAP and stress scenarios (Operations steps) | view keys + `operations.items.decide` |
| MD (ALCO), Board | ILAAP / RAS sign-off steps | `operations.items.decide` |
| CCO, Middle Office Officer, MD | View | view keys |

## 3. Functional requirements

| ID | Requirement | Source |
|---|---|---|
| MR-FR-01 | NOP / Total Capital (aggregate and per currency) against limits, with amber warning. | §6.8.1; limits Assumption — MR1 (§6.8.1); aggregation — MR2 (§6.8.1) |
| MR-FR-02 | FCY loans / liabilities to total, revalued at the configured spot rate. | §6.8.1 |
| MR-FR-03 | VaR per desk vs Board-approved limit (utilisation, breach log); stop-loss trigger status per desk. Confidence level, holding period and method tenant-configurable. | §6.8.1 |
| MR-FR-04 | IRRBB: repricing gap by bucket, NII-at-Risk and ΔEVE for configured shocks. | §6.8.1 |
| MR-FR-05 | Spread between highest and lowest interbank rate vs tolerance. | §6.8.1; tolerance Assumption — MR1 (§6.8.1) |
| MR-FR-06 | Liquidity ratio, LCR, NSFR, LDR (150% qualifying uplift, CBN min 65%) vs floors with warning margin. | §6.8.2; liquidity-ratio minimum Assumption — MR3 (§6.8.2) / MR1 (§6.8.2, Operations); factors — MR4 |
| MR-FR-07 | Maturity / liquidity gap by tenor bucket (cumulative); funding concentration at top-N cut-offs and by source type. | §6.8.2; ladder Assumption — MR4 |
| MR-FR-08 | CBN 3.13(c) early-warning counters; a triggered indicator is raised as a breach and escalated to MRA, Head of Risk, CRO. | §6.8.2 |
| MR-FR-09 | Breach log: raise a detected exceedance, escalate through the §6.4.4 ladder, close only after approval. | §6.8, §6.4.4; Assumption — MR3 (§6.8, Operations) |
| MR-FR-10 | Versioned, timestamped Risk Appetite Statement (early warning + buffer per metric above the regulatory floor); changes Board-approved; compiled ILAAP states the version in force. | §6.8.3 |
| MR-FR-11 | ILAAP risk-factor inventory with Low/Medium/High relevance and tenant-specific factors; chapter review checklist; compile report. | §6.8.3; chapters Assumption — MR5 (§6.8.3) |
| MR-FR-12 | ILAAP sign-off chain Head of Risk → CRO → ALCO (MD) → Board. | §6.8.3; chain Assumption — MR5 (§6.8.3), MR2 (§6.8.3, Operations) |
| MR-FR-13 | Stress testing across tenant severity bands (BAU, adverse, severe, reverse) projecting LCR / survival horizon; reverse stress test. | §6.8.2, §6.8.3 |
| MR-FR-14 | Dynamic layer widens run-off / haircut assumptions on a sector-contraction signal, shown with justification, editable before sign-off. | §6.8.4; add-on sizes Assumption — MR6 (§6.8.4) |
| MR-FR-15 | Every stress run retained with full assumptions; approved runs feed the ILAAP stress chapter. | §6.8.4 |
| MR-FR-16 | Intraday liquidity monitoring. | §6.8.4 — not implemented |

## 4. Business rules and parameters

All keys `market-risk.*` in `src/modules/market-risk/platform.ts`.

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `nopLimitPct`, `nopLimitPct.<USD/EUR/GBP/CNY>` | Aggregate / per-currency NOP limit (% capital) | 20%; 15/5/5/3% | §6.8.1 (demo) — MR1 |
| `varLimitPct.<FX/FI/MM/INV>`, `stopLossPct.<desk>` | Desk VaR limit, stop-loss trigger (% capital) | 0.3/0.6/0.15/0.8; 0.4/0.5/0.2/0.6 | §6.8.1 (demo) |
| `stopLossEarlyWarningPct`, `limitWarningPct` | Amber thresholds | 60%, 80% | Demo |
| `interbankSpreadLimitPp` | Interbank spread tolerance | 2.5 pp | Demo — MR1 |
| `irrbbShockBps`, `irrbbShockLadderBps` | Headline shock, sensitivity ladder | 200; −200/−100/100/200 | §6.8.1 (demo) |
| `liquidityRatioMinPct` | CBN liquidity ratio minimum | 30% | Demo — MR3 |
| `lcrFloorPct`, `nsfrFloorPct` | Basel III floors | 100%, 100% | §6.8.2 |
| `ldrMinPct`, `ldrQualifyingUpliftPct` | LDR minimum and uplift | 65%, 50% | §6.8.2, §9.1 |
| `ratioWarningMarginPct` | Amber zone above floors | 10% | Demo |
| `runOffPct.<segment>`, `asfPct.<segment>`, `undrawnOutflowPct`, `inflowCapPct`, `monthlyRepaymentPct`, `lcrInflowRecognitionPct`, `interbankInflowPct`, `rsfLoansPct`, `rsfHqlaPct`, `rsfOtherPct` | LCR / NSFR factors | various | Basel III / demo — MR4 |
| `ew.overdrawnDays`, `ew.clearingDeficitDays`, `ew.unableToPayDays`, `ew.interbankTakerPct`, `ew.interbankTakerDays`, `ew.watchPct` | CBN 3.13(c) triggers, watch level | 5, 5, 5, 25%, 90, 30% | §6.8.2 (CBN 3.13(c)) |
| `concentrationCutoffs` | Depositor top-N cut-offs | 5/10/25/50/100/200 | §6.8.2 |
| `stress.<band>.<field>` | Severity-band assumptions (run-offs, withdrawal, drawdown, haircut, FX, rate shock, inflow) | per band | §6.8.4 (demo) |
| `dyn.retailAddPp`, `dyn.corporateAddPp`, `dyn.haircutAddPp` | Dynamic add-ons | 2, 6, 3 pp | §6.8.4 (demo) — MR6 |
| `stress.horizonDays`, `stress.fgnDurationYears`, `stress.frontLoadExponent`, `stress.tailRunOffPct`, `stress.reverseMaxMultiplier` | Stress model shape | 90, 4, 0.7, 45%, 6 | Demo |
| `ras.<metric>.earlyWarning`, `ras.<metric>.buffer` (lcr, nsfr, ldr, lr, top20, survival) | RAS thresholds | e.g. LCR 120 / 135 | §6.8.3 (demo) — changed via `market-risk.ras.change` (TD-128) |
| `escalationRoles` | Breach escalation ladder | MRA → Head of Risk → CRO → Board | §6.4.4 |
| `alertRoles` | Breach / early-warning / approval recipients | MRA, Head of Risk, CRO | §6.8.2 |
| `ilaapRoles` | ILAAP approval recipients | MRA, Head of Risk, CRO, MD, Board | Demo |
| `ifrs9.usdNgnSpot` (ifrs9) | USD spot | 1535 | Demo |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `market-risk.breach.close` | MRA requests closure with a note | Any of Head of Risk, CRO · 24 h | §6.8, §6.4.4 — MR3 (§6.8, Operations) |
| `market-risk.ras.change` | New RAS version submitted | Head of Risk · 48 h → CRO · 48 h → Board · 168 h | §6.8.3 |
| `market-risk.ilaap.signoff` | ILAAP submitted | Head of Risk · 72 h → CRO · 72 h → ALCO (MD) · 120 h → Board · 336 h | §6.8.3 — MR2 (§6.8.3, Operations) |
| `market-risk.stress.approve` | Saved stress run submitted | Head of Risk · 48 h → CRO · 48 h | §6.8.3–6.8.4 |
| `rule.change` (core) | Any single `market-risk.*` rule | Head of Risk/CRO → System Admin/CRO | TD-128 (bypasses Board for RAS keys) |

Breach raise and escalation are direct audited actions (MR3 (§6.8, Operations)).

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `market-risk.breach-raised` | Breach raised | rule `market-risk.alertRoles` |
| `market-risk.breach-escalated` | Breach escalated | Next role on `market-risk.escalationRoles` |
| `market-risk.breach-closed` | Closure approved | `alertRoles` |
| `market-risk.early-warning-triggered` | Early-warning indicator raised | `alertRoles` |
| `market-risk.ras-approved` | RAS version approved | `alertRoles` |
| `market-risk.ilaap-signed` | ILAAP Board-approved | rule `market-risk.ilaapRoles` |
| `market-risk.stress-approved` | Stress scenario approved | `alertRoles` |
| `operations.approval-requested` / `operations.request-completed` (core) | Each step / completion | Approvers / requester |

## 7. Events and hook points

| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `market-risk.breach.raised` / `.escalated` / `.close-requested` / `.closed` | Breach lifecycle | metric, utilisation, from, to, note |
| event | `market-risk.early-warning.triggered` | Early warning raised | current, limit |
| event | `market-risk.ras.change-requested` / `.approved` | RAS version | changes |
| event | `market-risk.risk-factor.rescored`, `market-risk.ilaap-chapter.updated` | ILAAP inventory / chapter | before, after / reviewed |
| event | `market-risk.ilaap.compiled` / `.submitted` / `.signed` / `.returned` | ILAAP lifecycle | rasVersion, chapters |
| event | `market-risk.stress-run.saved` / `.submitted` / `.approved` | Stress run | lcr, survivalDays |
| hook | `market-risk.breach.raise.before/after` | Raise breach | before: veto / enrich |
| hook | `market-risk.breach.escalate.before/after` | Escalate | before: veto |
| hook | `market-risk.breach.close.before/after` | Submit closure | before: veto |
| hook | `market-risk.ras.change.before/after` | Submit RAS version | before: veto |
| hook | `market-risk.risk-factor.rescore.before/after` | Rescore factor | before: veto |
| hook | `market-risk.ilaap.compile.before/after`, `market-risk.ilaap.submit.before/after` | Compile / submit ILAAP | before: veto |
| hook | `market-risk.stress.run.before/after`, `market-risk.stress.approve.before/after` | Save / submit stress run | before: veto |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| CBA / Treasury FX sub-ledger | Inbound | Daily | FX long/short positions | Simulated — TD-126 |
| Treasury / dealing system | Inbound | Daily | Desk positions, VaR, MTM P&L, interbank quotes | Simulated — TD-126 |
| Market-data feed (§5.5) | Inbound | Daily | FX history, yield curves, price series | Simulated — TD-126 |
| CBA deposit / asset ledgers | Inbound | Daily / reporting date | Deposits by source, maturity / repricing schedules, liquid assets, top depositors | Simulated — TD-126 |
| GL capital accounts | Inbound | Reporting date | Total capital | Uses ifrs9 capital calibration (TD-125) |
| Sector-cycle engine (portfolio §6.6.7) | Inbound (internal) | Stress set-up | Contraction signal | Literal demo signal in `data.ts` |
| CBN (early warning / ILAAP submission) | Outbound | ILAAP approval | ILAAP document | Not built |

## 9. Non-functional

- Audit: every raise, escalation, request, rescore, chapter update, compile, stress run and approval outcome is logged with before/after (§10.3).
- RAS versions are retained with timestamp, requester and approver (§6.8.3 versioning).
- Every stress run stored with its full assumption set (§6.8.4).
- User scoping: actions limited to `market-risk` edit roles; SoD enforced by Operations.

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| MR1 (§6.8.1) | NOP, per-currency, VaR, stop-loss and spread limits | Demo tenant parameters |
| MR2 (§6.8.1) | Aggregate NOP convention | Σ net positions |
| MR3 (§6.8.2) | CBN minimum liquidity ratio | 30% (demo) |
| MR4 (§6.8.2) | LCR / NSFR factors, HQLA levels, tenor ladder | Illustrative Basel-style factors; ≤7d … >3y |
| MR5 (§6.8.3) | ILAAP chapters, governance chain | Chapters from §6.8.3 layers; MRA → HoR → CRO → ALCO (MD) → Board |
| MR6 (§6.8.4) | Dynamic add-on sizes | +2 pp retail, +6 pp corporate, +3 pp haircut |
| MR1 (§6.8.2, Operations) | CBN minimum liquidity ratio | `market-risk.liquidityRatioMinPct` = 30% |
| MR2 (§6.8.3, Operations) | ALCO committee or MD alone | MD step "ALCO (chaired by MD/CEO)" |
| MR3 (§6.8, Operations) | Does escalation need approval; who closes breaches | Escalation direct + audited; closure Head of Risk or CRO |
