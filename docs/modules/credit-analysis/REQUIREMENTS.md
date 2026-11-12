# 360 RAR credit analysis — requirements

| | |
|---|---|
| Module | `src/modules/credit-analysis` (nav module `credit-analysis`) |
| Repo | credigit-ser-frontend |
| PRD | §6.2 (6.2.1–6.2.12), §6.1.4 (Confidence Overlay / COP), §8 (360 RAR metric definitions) |
| Owner (business) | Credit Analyst; CCO / CRO for overrides and referrals |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
360 RAR scores every obligor on four cardinal points (North Internal Risk, South Operating Industry, East Comparative, West Macro-Economic), each 1–10, combined into X/Y composites that place the obligor in one of 13 posture states, and drafts an editable advisory note for the relationship manager (§6.2, §6.2.5–6.2.6). Every score is traceable to its source feed.

In scope:
- Assessment list and record (overview, parameters, peers, trend, advisory tabs).
- Confidence Overlay (COP) dampening of the North average (§6.1.4, §6.2.1).
- Posture, intensity bands, Neutral/Transitional, axis dominance (§6.2.5); 36-cell interpretive layer (§6.2.12).
- Analyst enrichment adjustments (four-eyes), advisory note sign-off, Industry Life-Cycle gating and CCO/CRO override (§6.2.6).
- Phase 2: peer benchmarks (§6.2.10), Share of Wallet (§6.2.9), NGX sector corpus and life-cycle classification (§6.2.8), trend & momentum (§6.2.11).

Out of scope: application workflow and credit memo (origination), PD/ECL (ifrs9), portfolio aggregation (portfolio).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| Credit Analyst | Refreshes assessments, proposes enrichment adjustments, edits and submits the advisory note, requests gating overrides; second analyst approves another analyst's request | `credit-analysis.assessments.view`, `credit-analysis.assessments.refresh`, `credit-analysis.enrichment.request-change`, `credit-analysis.advisory-notes.sign-off`, `credit-analysis.gating-overrides.request`, `credit-analysis.assessments.export`, `credit-analysis.requests.view` |
| CCO | Approves enrichment / advisory sign-off; approves gating override (in Operations) | `credit-analysis.assessments.view`, `operations.items.decide` |
| CRO | Approves gating override; receives Defensive-posture referrals | `credit-analysis.assessments.view`, `operations.items.decide` |
| AO / BDM / GH / approvers / LRO | Read assessments and signed-off advisory notes | `credit-analysis.assessments.view`, `credit-analysis.benchmarks.view`, `credit-analysis.share-of-wallet.view`, `credit-analysis.sector-corpus.view` |
| Any approver | "My requests" queue for this module | `credit-analysis.requests.view` |

## 3. Functional requirements
| ID | Requirement | Source |
|---|---|---|
| RAR-FR-01 | Score each parameter 1–10 from its stated source; show source per parameter | §6.2, §6.2.1–6.2.4 |
| RAR-FR-02 | Cardinal averages; X = South avg + East avg, Y = North avg + West avg | §6.2.5; composite scaling assumption (OQ 1, RAR2) |
| RAR-FR-03 | Base posture by 5.5 midpoint; Magnitude = distance from (5.5, 5.5); Strong/Moderate/Marginal bands; Neutral/Transitional below a second threshold; Internally/Externally-Led tag | §6.2.5; band defaults assumption (OQ 2, RAR1) |
| RAR-FR-04 | Confidence Overlay: COP band dampens the North average; Low Confidence needs an explanation | §6.1.4, §6.2.1; dampening amount assumption (RAR3) |
| RAR-FR-05 | Radar chart and composite position chart with drill-down to parameter score and source | §6.2.5 |
| RAR-FR-06 | Analyst enrichment adjustments with rationale, applied only after second-person approval | §6.2.6; four-eyes assumption (RAR10) |
| RAR-FR-07 | AI-drafted, editable advisory note by posture, intensity, axis, SOW, peer, trend and 36-cell layers; human sign-off before use | §6.2.6, §6.2.12, §2.3 |
| RAR-FR-08 | Marginal postures flagged provisional with flip candidates; Neutral routes to mandatory analyst narrative | §6.2.5 |
| RAR-FR-09 | Industry Life-Cycle gating: long-tenor (>36 m) expansion in a Decline industry is a hard exception needing CCO/CRO override with rationale; Conservative + Maturity/Decline needs a mandatory analyst note | §6.2.6; record/effect assumption (RAR8, RAR11) |
| RAR-FR-10 | Defensive posture → mandatory CRO referral | §6.2.6 |
| RAR-FR-11 | Posture change notifies the relationship manager | §6.2 (continuous refresh) — assumption |
| RAR-FR-12 | Refresh assessment re-reads feeds; staleness flag | §6.2 ("continuously refreshed"); cadence assumption (RAR9) |
| RAR-FR-13 | Peer benchmarking: percentile / decile position, outliers vs sector | §6.2.10 (Phase 2) |
| RAR-FR-14 | Share of Business Wallet quadrant (turnover share × loan share) | §6.2.9 (Phase 2); overlay combination assumption (RAR6) |
| RAR-FR-15 | NGX historical sector corpus; life-cycle classification; tenant sector → NGX mapping | §6.2.8 (Phase 2); classification rules assumption (RAR7) |
| RAR-FR-16 | Trend & momentum per ratio vs sector | §6.2.11 |
| RAR-FR-17 | Tenant-configurable parameter scoring bands | §8; weights/bands assumption (RAR4, RAR5) |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `rar.midpoint` (core) | Posture midpoint | 5.5 | §6.2.5 |
| `rar.neutralBelow`, `rar.marginalBelow`, `rar.moderateBelow` (core) | Magnitude bands | 0.4 / 1.2 / 2.4 | §6.2.5 — demo (OQ 2) |
| `credit-analysis.weightingScheme` | Parameter weighting | equal | §6.2 — demo (RAR4, TD-121) |
| `credit-analysis.band.lowMax`, `.band.mediumMax` | 36-cell Low / Medium upper bounds | 3 / 7 | §6.2.12 (RAR5) |
| `credit-analysis.qualitative.midFrom`, `.highFrom` | Qualitative label thresholds | 4 / 8 | Demo value |
| `credit-analysis.cop.highFrom`, `.cop.mediumFrom` | COP band thresholds | 0.85 / 0.6 | §6.1.4 example (TD-123) |
| `credit-analysis.cop.dampenHigh` / `Medium` / `Low` | North dampening points | 0 / 0.5 / 1 | Demo (RAR3) |
| `credit-analysis.staleAfterDays` | Refresh cycle | 90 days | Demo (RAR9) |
| `credit-analysis.peer.minPeers`, `.outlierSd`, `.topPercentile`, `.bottomPercentile` | Peer scope and outliers | 3 / 2 SD / 90 / 10 | Demo; deciles §6.2.10 |
| `credit-analysis.trend.flatBandPct`, `.trend.inLineTolerance` | Momentum bands | 2% / 0.5 | Demo value |
| `credit-analysis.sow.highSharePct` | High wallet share | 50% | §6.2.9 — demo |
| `credit-analysis.lifeCycle.*` (introMaxCompanies, introMinCagrPct, growthMinCagrPct, declineBelowCagrPct, declineBelowMarginTrendPp) | Life-cycle classifier | 5 / 8 / 4 / 0 / 0 | §6.2.8 — demo (RAR7) |
| `credit-analysis.lifeCycleScore.<stage>` | South life-cycle score per stage | Introduction 6.5 / Growth 8.5 / Maturity 5 / Decline 2 | Demo (RAR7) |
| `credit-analysis.gating.longTenorMonths` | Long-tenor threshold | 36 months | §6.2.6 |
| `credit-analysis.gating.hardExceptionStages` / `.analystNoteStages` | Gating stages | Decline / Maturity, Decline | §6.2.6 |
| `credit-analysis.gating.expansionKeywords`, `.closedStages` | Expansion purpose words; excluded app stages | list | Demo (RAR8) |
| `credit-analysis.enrichment.minRationale` | Rationale min chars | 15 | Demo value |
| `credit-analysis.advisory.flipCandidates`, `.maxOutlierPoints` | Advisory content limits | 3 / 3 | Demo value |
| `credit-analysis.advisory.confidenceHigh` / `Medium` / `Low` | Simulated draft confidence | 0.86 / 0.74 / 0.61 | Demo value |
| `credit-analysis.notify.postureChangeRoles` / `.defensiveReferralRoles` / `.gatingOverrideRoles` | Notification recipients | LRO / CRO / CAD officer | Demo; CRO §6.2.6 |
| `credit-analysis.ngxMapping.<sectorId>` | Sector → NGX benchmark | per sector | §6.2.8 — demo |
| `credit-analysis.scoring.<paramId>.worst` / `.best` | Observed value scored 1 / 10 | per parameter | §8 — demo (RAR4) |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `rar.enrichment-change` | Analyst submits parameter adjustments | "Second analyst / CCO review": credit-analyst / cco · 24 h | §6.2.6 (RAR10) |
| `rar.advisory-signoff` | Analyst submits advisory note | "Second analyst / CCO sign-off": credit-analyst / cco · 24 h | §6.2.6 (RAR10) |
| `rar.gating-override` | Analyst requests override of a life-cycle hard exception | "CCO / CRO override": cco / cro · 48 h | §6.2.6 (RAR11) |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `credit-analysis.posture-changed` | Posture label changes (refresh or approved enrichment) | Relationship manager + `notify.postureChangeRoles` |
| `credit-analysis.defensive-referral` | Obligor moves into Defensive | `notify.defensiveReferralRoles` (CRO) + relationship manager |
| `credit-analysis.advisory-ready` | Advisory note signed off | Relationship manager |
| `credit-analysis.gating-override-approved` | Gating override approved | Relationship manager + `notify.gatingOverrideRoles` |

## 7. Events and hook points
| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `credit-analysis.enrichment.submitted` / `.applied` / `.rejected` | Enrichment lifecycle | obligorId, changes, before/after posture, operationId |
| event | `credit-analysis.assessment.refreshed` | Refresh | obligorId, posture, previous |
| event | `credit-analysis.posture.changed` | Posture label changed | obligorId, before, after, base, reason |
| event | `credit-analysis.advisory.submitted` / `.signed-off` / `.rejected` | Advisory lifecycle | obligorId, posture, approvedBy, operationId |
| event | `credit-analysis.gating-override.requested` / `.approved` / `.rejected` | Override lifecycle | obligorId, applicationId, operationId |
| hook | `credit-analysis.enrichment.submit.before` / `.after` | Around enrichment submit | before: veto or enrich payload |
| hook | `credit-analysis.enrichment.apply.after` | After approved adjustments applied | scores, posture |
| hook | `credit-analysis.assessment.refresh.before` / `.after` | Around refresh | before: veto (e.g. feed outage) |
| hook | `credit-analysis.advisory.submit.before` / `.after` | Around advisory submit | before: veto or enrich text |
| hook | `credit-analysis.gating-override.submit.before` / `.after` | Around override request | before: can veto |
| hook | `credit-analysis.posture.change.after` | After posture change | before, after |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| CBA account turnover | In | Refresh | Verified turnover (COP) | Spine seed |
| Audited financials / origination spreads | In | Refresh | Ratios (North) | Spine seed |
| NGX historical sector financials | In | Periodic corpus refresh | Sector distributions, life-cycle | Simulated corpus (`data.ts`) |
| Macro data (NBS / CBN) | In | Refresh | West parameters | Simulated snapshot |
| Credit bureaus / CRMS (other-bank lines) | In | Refresh | Share of Wallet | Simulated (`walletFor`, TD-122) |
| Origination | Out / in | Gating checks, advisory into credit memo | Applications, advisory | Shared spine |

## 9. Non-functional
- Audit: enrichment submit/apply, refresh, advisory submit/sign-off, gating override request/approval write `useDb().log` with before/after.
- Traceability: each parameter shows source and observed value; AI output labelled "AI-drafted" with simulated confidence and human sign-off (§2.3, §6.12).
- User scope: "mine" filter by relationship manager on the assessment list; SoD by the Operations engine.
- Persistence: browser-local `credigit.ser.credit-analysis` (prototype).

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| 1 | X/Y composite "average + average" vs 5.5 midpoint | Mean of the two averages |
| 2 | Strong/Moderate/Marginal/Neutral defaults | 0.4 / 1.2 / 2.4 |
| RAR1 | Worked example called "Strong" at magnitude 1.41 | Demo bands kept; ties go to Internally-Led |
| RAR2 | §8 vs §6.2 axis definitions | §6.2 followed (1–10 scores, magnitude from midpoint) |
| RAR3 | COP dampening amount | 0 / 0.5 / 1 points |
| RAR4 | Parameter weights and value→score bands | Equal weights; linear bands |
| RAR5 | Integer bands vs decimal averages | Round to nearest whole point before banding |
| RAR6 | SOW overlay combination with COP | Shown with the overlay, doesn't change the score |
| RAR7 | Life-cycle classification thresholds and scores | CAGR / margin-slope demo rules; scores 6.5 / 8.5 / 5 / 2 |
| RAR8 | Expansion purpose codes | Keyword list rule |
| RAR9 | Refresh cadence | 90 days |
| RAR10 | Second person for enrichment / advisory | Second analyst or CCO |
| RAR11 | Override record / effect | Stored override, notifies RM + CAD |
