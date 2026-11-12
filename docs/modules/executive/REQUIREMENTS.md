# Executive view — requirements

| | |
|---|---|
| Module | `src/modules/executive` (nav module `executive`, route `/executive`) |
| Repo | credigit-ser-frontend |
| PRD | §6.11 (Executive Dashboards — Head of Risk & CRO views), §3 row 19 (Phase 1 basic / Phase 2 full), §4.1 (CRO full dashboard; Head of Risk prepares BRC packs), §4.3, §6.6.6 (executive/regulatory reporting), §6.12 (AI-drafted, human-approved), §5.7 (share-collateral margin) |
| Owner (business) | Chief Risk Officer, Head of Risk |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Executive cockpit aggregating the outputs of the Phase 1 and Phase 2 modules (§3 row 19): the CRO dashboard (risk-appetite scorecard, 360 RAR posture distribution, limit heat-map, wallet mix, peer/momentum flags, IFRS 9 stage migration, WARR vs appetite, CAR, liquidity and NOP, operational KRI scorecard and losses, share-margin status — each tile drilling down to the owning module) and the Head of Risk dashboard (cross-functional exception feed, Board Risk Committee pack builder). Includes the AI-drafted executive risk summary with sign-off.

- In scope: cockpit tiles and KRI table, escalations awaiting the viewer, exception feed, executive summary sign-off, BRC pack build → submit → approve.
- Out of scope: calculating the figures (owned by portfolio, ifrs9, market-risk, operational-risk, collateral, credit-analysis); the enterprise-risk module's own BRC pack flow (see Gaps).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| Chief Risk Officer | Views the full cockpit; submits / signs off the executive summary; approves the BRC pack | `executive.cockpit.view`, `executive.board-pack.view`, `executive.summary.submit`, `executive.board-pack.build`, `executive.board-pack.submit`, `executive.kris.export`, `executive.board-pack.export`, `operations.items.decide` |
| Head of Risk | Views the cockpit and exception feed; builds and submits the BRC pack; signs off the summary | same as CRO |
| MD, BCC/MCC-level approvers, other risk roles with `executive: "view"` | View-only cockpit and pack | `executive.cockpit.view`, `executive.board-pack.view`, `executive.kris.export`, `executive.board-pack.export` |
| System Admin | Every permission by default (invariant 12) | all |

## 3. Functional requirements
| ID | Requirement | Source (PRD § / assumption + Q-id) |
|---|---|---|
| EXE-FR-01 | Risk-appetite scorecard with KRIs (credit, capital, market, liquidity, operational) against appetite and early-warning, RAG-coloured. | §6.11 CRO dashboard |
| EXE-FR-02 | Portfolio distribution across the thirteen 360 RAR posture states. | §6.11, §6.2.5 |
| EXE-FR-03 | Single-obligor and sectoral limit heat-map (tenant taxonomy; CBN view in Portfolio). | §6.11, §6.6.1 |
| EXE-FR-04 | Share of Business Wallet mix and peer-benchmark outliers / momentum flags. | §6.11, §6.2.9–6.2.11 |
| EXE-FR-05 | IFRS 9 stage migration trend; WARR trend vs Board appetite with new-vs-existing split and link to migration matrix. | §6.11, §6.6.9 |
| EXE-FR-06 | Capital-adequacy trend, liquidity and NOP status, operational KRI RAG scorecard and loss trend. | §6.11 |
| EXE-FR-07 | Share-backed collateral margin-shortfall status (MTM after quoted-equity haircut). | §6.11, §5.7, §6.7.3 |
| EXE-FR-08 | Each tile drills down to the owning module. | §6.11 |
| EXE-FR-09 | Head of Risk: consolidated cross-functional exception feed (Credit, Market, Liquidity, Operational, Collateral) and escalations awaiting the viewer. | §6.11 Head of Risk dashboard; §4.1 |
| EXE-FR-10 | AI-drafted executive risk summary, labelled, signed off by CRO / Head of Risk through Operations before use. | §6.12; PF7 |
| EXE-FR-11 | Board Risk Committee pack builder: build draft, submit for approval, approve / reject; submission requires the period's summary to be signed off (configurable). | §6.11, §6.6.6; EX1 |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `executive.stage2ShareRedPct` | Stage 2 share at/above → Red | 12% | §6.7.1 / §6.10 — demo |
| `executive.stage2ShareAmberPct` | Stage 2 share at/above → Amber | 10% | §6.10 — demo |
| `executive.appetiteAmberPct` | Share of appetite at which NPL / op-loss turn Amber | 80% | Demo |
| `executive.carAmberBufferPp` | CAR Amber buffer above minimum | 2.5 pp | Demo |
| `executive.ldrMinPct` | Minimum LDR (Red below) | 65% | §9.1 — CBN minimum LDR (TD-508) |
| `executive.ldrAmberBufferPp` | LDR Amber buffer | 3 pp | Demo |
| `executive.liquidityRatioMinPct` | Minimum liquidity ratio | 30% | §6.8 — demo (TD-508) |
| `executive.nopLimitPct` | NOP limit (% of capital) | 20% | §6.8 — demo (TD-508) |
| `executive.varLimitNgn` | 1-day 99% VaR limit | ₦600m | §6.8.1 — demo (TD-508) |
| `executive.opLossAppetitePct` | Op-loss appetite (% gross income) | 0.5% | §6.9 — demo (TD-508) |
| `executive.quotedEquityHaircutPct` | Quoted-equity haircut for margin status | 20% | §6.7.3 / §5.7 (TD-508) |
| `executive.brcPack.requiresSignedSummary` | Pack submission needs a signed-off summary | true | §6.12 — tenant choice |
| `executive.summary.notifyRoles` | Notified on summary sign-off | cro, head-of-risk, md | Demo |
| `executive.brcPack.notifyRoles` | Notified on pack approval | cro, head-of-risk, md, board, portfolio-mis-officer | Demo |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `executive.summary.signoff` | Summary submitted | 1 step · `cro`, `head-of-risk` (any) · 24 h; requester can't approve | §6.11, §6.12 |
| `executive.brc-pack.approve` | Pack submitted | 1 step · `cro`, `head-of-risk` (any) · 48 h; reject → "Returned for correction" | §6.6.6, §6.11; EX1 |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `executive.summary-signed-off` | Summary signed off | Rule `executive.summary.notifyRoles` + requester |
| `executive.brc-pack-approved` | Pack approved | Rule `executive.brcPack.notifyRoles` |
| `executive.brc-pack-returned` | Pack rejected | Requester |

## 7. Events and hook points
| Kind (event / hook) | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `executive.summary.submitted` / `.summary.signedOff` | Summary lifecycle | period, operationId |
| event | `executive.brcPack.built` / `.submitted` / `.approved` / `.rejected` | Pack lifecycle | period, operationId, reason |
| hook | `executive.summary.submit.before` / `.after` | Around summary submission | key, period, headline, actor · before can veto / enrich |
| hook | `executive.brcPack.build.before` / `.after` | Around pack build | period, actor · before can veto / add sections |
| hook | `executive.brcPack.submit.before` / `.after` | Around pack submission | summaryKey, run · built-in veto `executive.pack-needs-signed-summary` |
| subscriber | `operations.request.*` → `executive.operations-closed` | Pack request returned / withdrawn | resets run to "Returned for correction" |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Owning modules (ifrs9, market-risk, operational-risk) | Inbound | Page load | CAR, liquidity, LDR, NOP, VaR, op-loss, KRI RAG | Demo feed `demoFeeds` (TD-507) |
| Risk Data Spine / portfolio / credit-analysis | Inbound | Page load | Exposures, postures, stages, WARR, limits | Built (computed from spine) |
| CSCS / NGX price feed (§5.7) | Inbound | Page load | Share mark-to-market | Simulated (TD-507) |
| Portfolio report runs store | Both | Pack build / approval | Pack run records | Built (shared store) |

## 9. Non-functional
- Audit: summary submission / sign-off, pack build / submit / approve / reject are audited.
- User-scoped: "Escalations awaiting your decision" lists only items the viewer can decide.
- AI output labelled with model version; no effect until signed off (§6.12).
- Read-only aggregation; every figure links to its owning module for traceability.

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| PF7 | Executive module view-only for all roles, yet CRO / Head of Risk sign off and build the pack | CRO and Head of Risk now have `executive: "edit"` |
| EX1 | Does the BRC pack need MD / Board secretary approval after CRO / Head of Risk? | One step, CRO or Head of Risk; signed summary required |
| ER4 | BRC pack contents, approval chain and format (enterprise-risk) | Separate flow in enterprise-risk (CRO approves) |
| MR1 / MR3 (market-risk) | NOP / VaR limits, CBN liquidity minimum | Duplicated here as executive rules (TD-508) |
