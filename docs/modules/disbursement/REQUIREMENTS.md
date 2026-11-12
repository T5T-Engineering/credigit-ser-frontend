# Disbursement — requirements

| | |
|---|---|
| Module | `src/modules/disbursement` (nav module `disbursement`, route `/disbursement`) |
| Repo | credigit-ser-frontend |
| PRD | §4.1 (Domestic Operations — Disbursement Maker-Checker), §4.2 (sign-on and session rules), §6.1.1 steps 15–16, §5.1 (CBA connector) |
| Owner (business) | Domestic Operations / Credit Administration (Disbursement Maker, Disbursement Checker) |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Executes the drawdown of an approved, released facility into the customer's account under strict maker-checker control. A Maker prepares the disbursement within the approved (undisbursed) amount; a different Checker authorises it, with step-up re-authentication above the high-value threshold. The first authorised drawdown activates the facility and books the application.

- In scope: disbursement queue (facilities "Pending disbursement"), Maker preparation, Checker authorisation / return / rejection, Maker withdrawal, segregation-of-duties checks, step-up for high-value amounts, facility activation, history.
- Out of scope: release for disbursement and condition-precedent confirmation (credit-admin), repayment schedules, real CBA posting (simulated — TD-857).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| Disbursement Maker | Prepares a disbursement within the undisbursed approved amount; withdraws own pending request | `disbursement.queue.view`, `disbursement.disbursements.prepare`, `disbursement.disbursements.withdraw` |
| Disbursement Checker | Authorises / returns / rejects a prepared disbursement (never their own; step-up above threshold) | `disbursement.queue.view`, `disbursement.disbursements.authorise`, `operations.items.decide` |
| Credit Admin Officer | Views the queue and history (release itself is done in credit-admin) | `disbursement.queue.view`, `disbursement.queue.export` |
| System Admin | Holds every permission by default (invariant 12); still bound by SoD and Operations eligibility | all of the above |

## 3. Functional requirements
| ID | Requirement | Source (PRD § / assumption + Q-id) |
|---|---|---|
| DSB-FR-01 | List facilities in status "Pending disbursement" with undisbursed amount, CP status and release status. | §6.1.1 steps 15–16 |
| DSB-FR-02 | A Maker may prepare a disbursement only when the facility is released and all conditions precedent are cleared. | §6.1.1 step 15; assumption DS4 (met / waived / approved-deferred count as cleared) |
| DSB-FR-03 | Amount must be > 0 and ≤ the undisbursed approved amount (approved − outstanding); partial drawdowns allowed. | §4.1 ("within approved facility amount"); assumption DS2 |
| DSB-FR-04 | Beneficiary account number is validated against the configured length (NUBAN). | Assumption — rule `disbursement.accountNumberLength` |
| DSB-FR-05 | Preparation submits an Operations request for Checker authorisation (no ad-hoc approval). | §4.1, invariant 9 |
| DSB-FR-06 | The Checker must be a different individual from the Maker (no self-approval). | §4.1, §4.2 |
| DSB-FR-07 | The individual who initiated or recommended the facility cannot be Maker or Checker. | §4.2; assumption DS3 (initiator, tier-1 step, any "recommended" decision) |
| DSB-FR-08 | Above the high-value threshold the Checker re-authenticates (OTP/PIN) before authorising. | §4.2; assumption DS1 (rule `approvals.stepUpThresholdNgn`) |
| DSB-FR-09 | On authorisation: post to the CBA and record the reference; set the facility Active (outstanding, start/maturity dates) and the application Booked. | §6.1.1 step 16, §5.1; assumption DS2; CBA simulated (TD-857) |
| DSB-FR-10 | The Checker may return to the Maker (with comment) or reject; the Maker may withdraw a pending request. | §4.2; assumption |
| DSB-FR-11 | "My work" view: requests I prepared, decided or am eligible to decide. | Invariant 9 (user-scoped) |
| DSB-FR-12 | History of all disbursements with status, maker, checker, step-up and CBA reference. | §10.3 traceability |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `disbursement.accountNumberLength` | Digits in a beneficiary account number | 10 | Tenant parameter (demo) — CBN NUBAN |
| `disbursement.makerRoles` | Roles that may prepare disbursements | `["disbursement-maker"]` | §4.1 |
| `approvals.stepUpThresholdNgn` (core) | Amount above which the Checker must step up | ₦100,000,000 (demo) | §4.2; DS1 / W2 |
| `operations.minCommentLength` (core) | Minimum decision comment length used by the Operations engine | see core | §10.4 |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `disbursement.authorise` | Maker submits a prepared disbursement | 1 step "Checker authorisation" · `disbursement-checker` (any) · 8 h. Requester barred by the engine; hook `disbursement.sod-and-step-up` vetoes initiator/recommender and missing step-up. | §4.1, §4.2 |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `disbursement.authorised` | Checker authorised (posted to CBA) | Maker, relationship manager / application creator, `credit-admin-officer` role |
| `operations.approval-requested` (core) | Request submitted | Eligible Checkers (not the Maker) |
| `operations.request-completed` (core) | Request approved / rejected | Maker (requester) |

## 7. Events and hook points
| Kind (event / hook) | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `disbursement.request.prepared` | Maker submitted | facilityId, amount, operationId |
| event | `disbursement.request.authorised` | Checker authorised | facilityId, amount, cbaReference, stepUpVerified, operationId |
| event | `disbursement.request.returned` / `.rejected` / `.withdrawn` | Request closed without posting | facilityId, operationId |
| event | `disbursement.facility.activated` | Authorised drawdown on the facility | outstanding |
| hook | `disbursement.prepare.before` | Before the Maker submits | request, actor · can veto / enrich |
| hook | `disbursement.prepare.after` | After submission | request, instance |
| hook | `disbursement.authorise.after` | After authorisation and activation | request, instance (e.g. CBA posting, repayment schedule) |
| hook handler | `disbursement.sod-and-step-up` on `operations.decide.before` | Checker decides | vetoes SoD conflict / missing step-up |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Core banking application (CBA, §5.1) | Outbound | Authorisation | Posting: account, amount, narration, value date → reference | Simulated (TD-857) |
| Step-up provider (OTP / transaction PIN) | Outbound | Checker approval above threshold | OTP challenge / verification | Simulated — any 6 digits (TD-858) |
| credit-admin / origination (Risk Data Spine) | Inbound | Queue and gating | Facility, release state, CPs, application approvals | Built (prototype store) |

## 9. Non-functional
- Audit: prepare, authorise, return, reject, withdraw, facility activation and application booking are written to the audit log with before/after.
- Segregation of duties is enforced twice: Operations engine (requester ≠ approver) and the SoD hook (initiator/recommender), and shown as checklists to Maker and Checker.
- Session security: tighter idle timeout, device binding and IP allow-list defaults for Maker and Checker roles (admin rules `session.*`, §4.2).
- Value dates use a fixed Lagos offset (TD-859).

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| DS1 | Default high-value step-up threshold | ₦100m demo value (core rule `approvals.stepUpThresholdNgn`) |
| DS2 | Tranches; when the facility becomes Active | Any amount ≤ undisbursed; first authorised drawdown → Active / Booked |
| DS3 | Definition of "recommended" for the SoD bar | Initiator, tier-1 step, any "recommended" decision |
| DS4 | Does an approved deferral clear a CP for drawdown? | Yes (met, waived, approved-deferred count as cleared) |
| CA-OPS-2 | Does release for disbursement need a second confirmation? | Owned by credit-admin; release is final in the prototype |
