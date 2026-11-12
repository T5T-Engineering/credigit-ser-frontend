# Credit administration — requirements

| | |
|---|---|
| Module | `src/modules/credit-admin` (nav module `credit-admin`) |
| Repo | credigit-ser-frontend |
| PRD | §6.3 (6.3.1–6.3.3), §6.1.1 step 15, §4.1 (Credit Administration Officer), §6.9 (loss-event feed) |
| Owner (business) | Credit Administration Officer (CAD) |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Credit Administration is the post-approval, pre- and post-disbursement control function: it confirms conditions precedent (CPs), raises waivers / deferrals / sanctions for breach, releases files for disbursement, runs the CBN CRMS desk, maintains the CBN Annexure 1 credit file and holds the definitive facility register (PRD §6.3).

In scope:
- Facility register: total approved, outstanding, disbursed vs undisbursed, facility class and Application-Type register (§6.3.1).
- CP checklist per facility, release for disbursement (§6.1.1 step 15).
- Waiver / deferral workflow with expiry and reminders; sanctions-for-breach routed to Operational Risk (§6.3.2).
- CRMS search log, CRMS reporting batches and exceptions; credit file (Annexure 1) and credit print-out (CBN 3.8) (§6.3.3).

Out of scope: facility approval (origination), offer-letter drafting (offer-letters), disbursement maker/checker (disbursement), covenant monitoring (monitoring), loss-event register (operational-risk).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| Credit Administration Officer | Confirms CPs, raises waivers/deferrals/sanctions, requests release, runs CRMS searches/batches, maintains credit files, approves within delegated tolerance | `credit-admin.facilities.view`, `credit-admin.waivers.view`, `credit-admin.crms.view`, `credit-admin.credit-files.view`, `credit-admin.conditions.confirm`, `credit-admin.waivers.request`, `credit-admin.sanctions.request`, `credit-admin.waivers.close`, `credit-admin.waivers.send-reminders`, `credit-admin.facilities.request-release`, `credit-admin.crms-searches.run`, `credit-admin.crms-batches.submit`, `credit-admin.crms-exceptions.resolve`, `credit-admin.credit-files.update` |
| Approving-tier roles (GH, CCO, Directorate Head, CRO, MD, MCC, BCC, Board) | Decide waivers/deferrals at the facility's approving tier or higher (in Operations) | `credit-admin.waivers.view`, `operations.items.decide` |
| Head of Risk / CRO | Decide sanctions for breach; confirm release (default step) | `operations.items.decide` |
| Loan Review, Collateral, Legal, Disbursement Maker/Checker | Read-only register and files | `credit-admin.facilities.view`, `credit-admin.registers.export`, `credit-admin.facilities.print` |
| Any viewer | Export registers, print-out | `credit-admin.registers.export`, `credit-admin.facilities.print` |

## 3. Functional requirements
| ID | Requirement | Source |
|---|---|---|
| CAD-FR-01 | Facility register: approved amount, tenor, product, approval date; grouped by Advances / Loans / Leases / Overdrafts / Contingent liabilities | §6.3.1; class mapping is an assumption (CA5) |
| CAD-FR-02 | Outstanding (principal + interest in arrears) refreshed from CBA at least daily | §6.3.1, §5.1 |
| CAD-FR-03 | Disbursed vs undisbursed tracking and Application-Type register (New / Renewal / Restructure / Enhancement) with volume and value in process | §6.3.1 |
| CAD-FR-04 | CP checklist per facility: confirm met / reopen, with who and when | §6.1.1 step 15, §4.1 |
| CAD-FR-05 | Raise a waiver or deferral against a specific approved condition, routed to the tier that approved the facility (or higher) | §6.3.2 |
| CAD-FR-06 | Credit Administration may approve within delegated tolerance | §4.1; tolerance definition is an assumption (CA2, CA-OPS-1) |
| CAD-FR-07 | Every waiver/deferral has an expiry date and auto-reminds before lapse; close when the condition is regularised | §6.3.2 |
| CAD-FR-08 | Sanctions for breach: log credit-policy breaches and route to the disciplinary/escalation workflow, feeding the Operational Risk loss-event register | §6.3.2, §6.9; approver is an assumption (CA1) |
| CAD-FR-09 | Release file for disbursement once every CP is met, waived or deferred | §6.1.1 step 15; second confirmation is an assumption (CA-OPS-2) |
| CAD-FR-10 | CRMS desk: log every CRMS search request and result per obligor | §6.3.3 (CBN 3.7(d)) |
| CAD-FR-11 | CRMS reporting batches and reporting exceptions | §6.3.3; cadence/approval assumption (CA3, CA-OPS-3) |
| CAD-FR-12 | Credit file per obligor with CBN Annexure 1 minimum content, staleness flags for 360 RAR and call reports | §6.3.3; staleness windows assumption (CA4) |
| CAD-FR-13 | Credit print-out with CBN 3.8 minimum fields auto-generated from the Risk Data Spine | §6.3.3 |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `credit-admin.delegatedMaxDeferralDays` | Max deferral days within CAD tolerance | 30 days | §4.1 — demo value |
| `credit-admin.delegatedCategories` | Condition categories CAD may defer | Documentation, Fees, Corporate authorisation | §4.1 — demo value |
| `credit-admin.delegatedApproverRoles` | Roles approving within tolerance | credit-admin-officer | §4.1 |
| `credit-admin.waiverReminderDays` | Reminder window before lapse | 7 days | §6.3.2 — demo value |
| `credit-admin.defaultDeferralDays` | Pre-filled deferral period | 14 days | Demo value |
| `credit-admin.minReasonLength` | Min reason characters | 10 | Demo value |
| `credit-admin.requesterRoles` | Who raises waivers/deferrals/sanctions | credit-admin-officer | §6.3.2 |
| `credit-admin.cpConfirmerRoles` | Who confirms CPs, releases, maintains files | credit-admin-officer | §4.1 |
| `credit-admin.crmsRecentWindowDays` | CRMS KPI window | 30 days | Demo value |
| `credit-admin.crmsReportingCadence` | CRMS reporting cadence | monthly | Assumption (CA-OPS-3) |
| `credit-admin.rarStalenessDays` | Credit-file 360 RAR staleness | 180 days | Assumption (CA4) |
| `credit-admin.callReportStalenessDays` | Credit-file call-report staleness | 180 days | Assumption (CA4) |
| `rbac.limit.*`, chart-flow tiers (core / origination) | Approving tier of the original facility | — | §6.1.2 |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `credit-admin.waiver` | Waiver or deferral raised | 1 step "Approving tier (or delegated tolerance)": all chart-flow tier roles + credit-admin-officer, narrowed by hook `credit-admin.waiver-tier-check` · 48 h | §6.3.2, §4.1 (CA2, CA-OPS-1) |
| `credit-admin.sanction` | Sanction for breach raised | 1 step "Escalation decision": head-of-risk / cro · 72 h | §6.3.2 — approver assumption (CA1) |
| `credit-admin.release` | Release requested after all CPs cleared | 1 step "Release confirmation": credit-admin-officer / head-of-risk · 24 h | §6.1.1 step 15 (CA-OPS-2) |
| `credit-admin.crms-batch` | CRMS batch submitted | No steps by default (applies at once; tenant may add one) | §6.3.3 (CA-OPS-3) |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `credit-admin.waiver-decided` | Waiver/deferral approved, declined; sanction routed | Requester, relationship manager; Operational Risk Analyst for routed sanctions |
| `credit-admin.waiver-expiring` | Reminder sweep finds a waiver/deferral lapsing within the window | Requester, Credit Administration Officers |
| `credit-admin.file-released` | File released for disbursement | Disbursement Maker/Checker, requester, relationship manager |
| `credit-admin.crms-batch-submitted` | CRMS batch submitted | Credit Administration Officers, requester |

## 7. Events and hook points
| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `credit-admin.cp.confirmed` / `.cp.reopened` | CP status changed | conditionId, before, after |
| event | `credit-admin.waiver.requested` / `.approved` / `.declined` / `.closed` / `.reminded` | Waiver lifecycle | facilityId, conditionId, kind, delegated/withinTolerance, operationId |
| event | `credit-admin.sanction.routed` | Sanction approved → loss event | facilityId, conditionId, lossEventRef, breachDetail |
| event | `credit-admin.facility.release-requested` / `.released` | Release lifecycle | operationId |
| event | `credit-admin.crms.search-requested` / `.result-received` / `.batch-submitted` / `.exception-resolved` | CRMS desk | searchId, purpose, result / facilities |
| event | `credit-admin.credit-file.updated` | Annexure 1 item changed | itemId, before, after |
| hook | `credit-admin.cp.confirm.before` / `.after` | Around CP confirm/reopen | before: can veto |
| hook | `credit-admin.waiver.submit.before` / `.after` | Around waiver/deferral/sanction submit | before: veto or enrich request |
| hook | `credit-admin.release.submit.before` / `.after` | Around release request | before: can veto |
| hook | `credit-admin.crms.batch.before` / `.after` | Around CRMS batch | before: veto or enrich batch |
| hook | `credit-admin.credit-file.update.before` / `.after` | Around credit-file item change | before: can veto |
| hook (handler) | `credit-admin.waiver-tier-check` on `operations.decide.before` | Waiver decision | Vetoes deciders below the approving tier unless within tolerance |
| subscriber | `credit-admin.on-operation-closed` on `operations.request.*` | Waiver/sanction returned or withdrawn | Updates waiver status |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| CBA (core banking) | In | Daily refresh | Facility master, outstanding, arrears | Seed data (spine) |
| CBN CRMS | In / out | Search request; reporting batch | Search results; facility reporting | Simulated (TD-855) |
| Operational Risk loss-event register | Out | Sanction approved | Loss event | Simulated reference (TD-854) |
| Origination / offer letters | In | Approval record, CP clauses | Approving tier, CPs | Shared spine; facility not booked for new apps (TD-951) |
| Disbursement | Out | File released | Release flag | Built (shared store) |

## 9. Non-functional
- Audit: every CP change, waiver/sanction request and decision, release, CRMS search/batch/exception and credit-file change writes `auditAs(...)` with before/after (§10.3).
- User scope: requester / decider identity from `currentActor()`; segregation of duties enforced by the Operations engine (requester can't decide).
- Persistence: browser-local `credigit.ser.credit-admin` (prototype); backend seam noted in `actions.ts`/`store.ts`.
- Time zone: date inputs assume Lagos offset (TD-859).

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| CA1 | Default approver for sanctions for breach | Head of Risk / CRO |
| CA2 | Does CAD have a delegated tolerance? | Deferrals ≤ 30 days on three categories |
| CA3 | CRMS cadence / reportable changes | Month-end |
| CA4 | Credit-file staleness thresholds | 180 days |
| CA5 | Product → facility class mapping | Code map in `register.ts` |
| CA-OPS-1 | Meaning of "or higher" tier | Any role with tier ≥ the approving tier |
| CA-OPS-2 | Does release need a second confirmation? | Yes: CAD or Head of Risk (not the requester) |
| CA-OPS-3 | CRMS batch approval | No step by default |
| DS4 | Does an approved deferral clear a CP for drawdown? | Met, waived and approved-deferred count as cleared; lapsed deferrals become breached |
