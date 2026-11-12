# Collateral & legal — requirements

| | |
|---|---|
| Module | `src/modules/collateral` (nav module `collateral`, route `/collateral`) |
| Repo | credigit-ser-frontend |
| PRD | §6.5, §5.7, §6.4.2 (collateral monitoring), §6.7.3 (haircuts), §6.4.4 (margin-call escalation), §4.1 (roles) |
| Owner (business) | Collateral Management Officer; Legal Officer; Middle Office Officer (verification) |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Register, value and monitor security pledged against facilities, run the legal review (searches, genuineness, vaulting, sufficiency sign-off) and track perfection. Share-backed collateral is valued from the SEC/CSCS feed with margin-call handling (§5.7).

In scope:
- Collateral register with type, valuation, valuer, perfection status and haircut weighting (§6.5, §6.7.3).
- Valuation governance: independent valuer, basis, assumptions, FSV; Middle Office verification.
- Legal workflow: search, genuineness, vaulting / check-out, legal sufficiency sign-off.
- Monitoring alerts: perfection stalled/defective, revaluation due, insurance expiry, margin shortfall (§6.4.2).
- Share-backed collateral: MTM price, lien status, corporate actions, margin call and release (§5.7).

Out of scope:
- Legal sign-off on offer-letter conditions text (offer-letters module, §7).
- The live SEC/CSCS connector itself (connectors module; Phase 2).
- Exception escalation ladder (monitoring module, §6.4.4).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| Collateral Management Officer | Register collateral, record valuations, advance perfection, record insurance, upload documents, send reminders, refresh prices, raise margin calls | `collateral.register.view`, `collateral.collateral.create`, `collateral.valuations.create`, `collateral.valuations.request-verification`, `collateral.perfection.advance`, `collateral.perfection.request-completion`, `collateral.insurance.renew`, `collateral.documents.upload`, `collateral.collateral.send-reminders`, `collateral.share-prices.refresh`, `collateral.margin-calls.create`, `collateral.margin-calls.request-release` |
| Legal Officer | Record searches, confirm genuineness, vault / check out documents, report/cure defects, submit sufficiency opinion; confirms perfection completion | `collateral.legal.view`, `collateral.legal-searches.record`, `collateral.security-documents.manage`, `collateral.legal-opinions.sign-off`, `collateral.perfection.advance` |
| Middle Office Officer | Verify or query recorded valuations; verify restored cover for margin release | `collateral.verification.view`, `collateral.shares.view` (+ Operations decision) |
| Credit Admin Officer / CCO | Accept legal sufficiency sign-off (Operations step) | `collateral.register.view` (+ Operations decision) |
| Other credit roles (AO, BDM, CA, Loan Review…) | Read-only view | `collateral.register.view`, `collateral.shares.view` |
| Any viewer | Export registers | `collateral.registers.export` |

## 3. Functional requirements
| ID | Requirement | Source |
|---|---|---|
| COL-FR-01 | Maintain a collateral register: type, description, value, valuation date, valuer, perfection status, haircut, linked facility. | §6.5 |
| COL-FR-02 | Apply haircut weightings by collateral type; adjusted value = value × (1 − haircut). | §6.7.3; types outside the table: assumption COL1 |
| COL-FR-03 | Value basis is FSV for mortgages and MTM for shares. | §6.7.3; other types: assumption COL2 |
| COL-FR-04 | Record valuations with valuer, basis, assumptions and FSV; next revaluation date set from the revaluation cycle. | §6.5 (CBN 3.11, 12.13(3)) |
| COL-FR-05 | Every recorded valuation is independently verified by Middle Office before it is relied on; the recorder cannot verify their own. Rejection = valuation queried. | §4.1 |
| COL-FR-06 | Track perfection through ordered steps; completion confirmed by Legal; report and cure defects. | §6.5; who advances each step: assumption COL4 |
| COL-FR-07 | Legal workflow: record searches, confirm genuineness, vault / check out / return documents. | §6.5 |
| COL-FR-08 | Legal sufficiency opinion accepted by Credit Administration. | §6.5; acceptor: assumption COL1 (OPS) |
| COL-FR-09 | Alerts for perfection stalled/defective, revaluation due/overdue, insurance expiring/expired, margin shortfall; reminders to owners. | §6.4.2 |
| COL-FR-10 | Share-backed collateral valued from CSCS MTM; valuer recorded as "CSCS market data"; lien status and corporate actions shown. | §5.7, §6.5 |
| COL-FR-11 | Margin shortfall (adjusted MTM < exposure × threshold) raises a margin-call exception through the §6.4.4 protocol. | §5.7; threshold/top-up: assumption COL3 |
| COL-FR-12 | Margin-call release after cover verification; closes the linked exception. | §5.7; authority: assumption COL2 (OPS) |
| COL-FR-13 | Phase 1: manual upload of CSCS share-statement evidence; Phase 2: automated scheduled MTM refresh. | §5.7 |
| COL-FR-14 | Upload documents to a collateral record within size/type limits. | Assumption (tenant parameter) |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `collateral.haircut.cash` | Haircut — cash / deposits with the lending bank | 0% | §6.7.3 |
| `collateral.haircut.quotedShares` | Haircut — quoted equities & traded securities | 20% | §6.7.3 |
| `collateral.haircut.residentialMortgage` | Haircut — residential legal mortgage | 50% | §6.7.3 |
| `collateral.haircut.commercialMortgage` | Haircut — commercial legal mortgage | 50% | §6.7.3 |
| `collateral.haircut.<type-slug>` | Haircut for types outside the PRD table (equitable mortgage 50, debenture 50, vehicle 40, equipment 45, domiciliation 60, personal guarantee 100, corporate guarantee 70, insurance policy 50) | as listed | §6.7.3 (type not listed) — demo value, COL1 |
| `collateral.haircut.residentialKeywords` | Words classifying a mortgage as residential | `duplex`, `plot` | Demo value |
| `collateral.perfection.stallDays` | Perfection stall alert after valuation | 90 days | §6.4.2 — demo value |
| `collateral.revaluation.warningDays` | Revaluation due warning window | 90 days | §6.4.2 — demo value |
| `collateral.revaluation.cycleMonths` | Months to next revaluation | 36 | §6.5 — demo value |
| `collateral.insurance.warningDays` | Insurance expiry warning window | 30 days | §6.4.2 — demo value |
| `collateral.margin.minCoverPct` | Margin-call cover threshold | 100% | §5.7, §6.4.2 — demo value, COL3 |
| `collateral.valuation.bases` | Valuation bases offered | 3 bases | Demo value |
| `collateral.legal.minOpinionLength` | Minimum opinion / query / defect text | 5 chars | Demo value |
| `collateral.documents.maxSizeMb` | Document size limit | 20 MB | Demo value |
| `collateral.documents.accept` | Accepted file extensions | `.pdf,.jpg,.png,.docx` | Demo value |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `collateral.valuation.verify` | Valuation recorded / "Request verification" | Middle Office verification · `middle-office-officer` · 48 h; reject = queried | §4.1 |
| `collateral.legal.signoff` | Legal Officer submits sufficiency opinion | Credit Administration acceptance · `credit-admin-officer` or `cco` · 48 h | §6.5; COL1 (TD-602) |
| `collateral.perfection.complete` | Perfection advanced to "Perfected" | Legal confirmation · `legal-officer` · 48 h | §6.5 (CBN 12.13(a)(1)); COL4 |
| `collateral.margin.release` | Request margin-call release with evidence | Cover verification · `middle-office-officer` or `head-of-risk` · 24 h | §5.7; COL2 (TD-602) |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `collateral.margin-call` | Margin call raised | Collateral Officer, Account Officer, Middle Office, Loan Review Officer |
| `collateral.margin-call-released` | Margin call released (approved) | Collateral Officer, Account Officer, Loan Review Officer |
| `collateral.insurance-expiring` | Reminder sweep — insurance expiring/expired | Collateral Officer, Credit Admin Officer |
| `collateral.revaluation-due` | Reminder sweep — revaluation due/overdue | Collateral Officer |
| `collateral.perfection-defect` | Legal reports a defect | Collateral Officer, Credit Admin Officer |
| `collateral.valuation-queried` | Middle Office rejects a verification | Collateral Officer + requester |

## 7. Events and hook points
| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `collateral.collateral.registered` | Collateral registered | facilityId, type, marketValue |
| event | `collateral.valuation.recorded` / `.verified` / `.queried` | Valuation recorded / verified / queried | marketValue, FSV, valuer / operationId, reason |
| event | `collateral.perfection.advanced` / `.completed` / `.defect-reported` / `.defect-cured` | Perfection changes | from, to / operationId / reason |
| event | `collateral.legal.search-recorded` / `.genuineness-confirmed` / `.vaulted` / `.checked-out` / `.signed-off` | Legal workflow steps | result / vaultRef / purpose, out / operationId |
| event | `collateral.insurance.renewed` | Insurance renewal recorded | expiry |
| event | `collateral.document.uploaded` | Document uploaded | name |
| event | `collateral.margin-call.raised` / `.released` | Margin call raised / released | exceptionId, topUp, cover / operationId |
| event | `collateral.prices.refreshed` | Simulated CSCS refresh or reset | counters, reset |
| event | `collateral.reminder.sent` | Reminder sweep | count |
| hook | `collateral.valuation.record.before` / `.after` | Around recording a valuation | before: veto / enrich |
| hook | `collateral.perfection.advance.before` / `.after` | Around advancing perfection / requesting completion | before: veto |
| hook | `collateral.legal.signoff.before` / `.after` | Around submitting the sufficiency opinion | before: veto |
| hook | `collateral.margin-call.raise.before` / `.after` | Around raising a margin call | before: veto / enrich |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| SEC / CSCS (`CON-CSCS`) | Inbound | Scheduled daily close / on demand | Share price, shareholding & lien confirmation, corporate actions, SEC status | Simulated price refresh (TD-601); Phase 1 manual upload |
| Monitoring exceptions (§6.4.4) | Outbound | Margin call raised / released | Exception (type, amount, obligor, facility, collateral) | Built (in-app) |
| Risk Data Spine (`collateral`, `facilities`) | Read/write | All commands | Register fields (value, perfection, valuer) | Built (local store) |
| IFRS 9 LGD / provisioning (§6.7.2–6.7.3) | Outbound | Haircut-adjusted value | Adjusted value | Read by other modules via logic |

## 9. Non-functional
- Audit: every state change written via `auditAs` (who, what, before/after); CSCS feed refresh logged with source and timestamp (§6.5).
- Segregation of duties: recorder of a valuation cannot verify it (engine rule).
- Tenant isolation / user scope: all data local to the demo tenant; no per-user filtering of the register.

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| COL1 (§6.7.3) | Haircuts for types not in the PRD table | Demo haircuts as rules |
| COL2 (§6.7.3) | Value basis for non-mortgage, non-share types | Market value |
| COL3 (§5.7) | Margin-call threshold and top-up computation | Cover < 100% of exposure; top-up restores cover |
| COL4 (§6.5) | Who advances each perfection step; Legal sign-off before/after registration | Steps owned by Collateral / Legal Officer as in `perfectionSteps` |
| COL5 (§5.7) | Seeded share units inconsistent with market value | Units derived from value / reference price |
| COL1 (OPS) | Who accepts the Legal Officer's sufficiency sign-off | Credit Admin Officer or CCO |
| COL2 (OPS) | Margin-call trigger and release authority | Middle Office or Head of Risk |
| — (§6.4.2, CBN 3.11) | Fixed-asset revaluation permissible only every 7 years on own premises vs 36-month demo cycle | Revaluation cycle is a rule (36 months) |
