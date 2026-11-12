# Offer letters — requirements

| | |
|---|---|
| Module | `src/modules/offer-letters` (nav module `offer-letters`) |
| Repo | credigit-ser-frontend |
| PRD | §7.0, §7.1, §7.2, §7.3 (incl. build note), §6.1.1 steps 13–14, §6.1.5, §4.1 |
| Owner (business) | Legal Officer (clause text, sign-off), Account Officer (presentation, acceptance), Credit Administration (conditions), System Admin with Legal sign-off (house template, §7.0) |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

Generates the offer letter for a fully approved credit request by merging obligor / facility / collateral data and the auto-tagged
conditions and covenants into the tenant's currently approved house template (PRD §7.0). Legal reviews and edits clauses, signs the
letter off (Operations), the Account Officer presents it, and customer acceptance clears the "Signed acceptance" condition precedent
and moves the application to Conditions.

- In scope: offer-letter list and record, auto-generation, clause selection / letter-level edits / bespoke clauses, validity and
  lapse, Legal sign-off and re-issue, acceptance, print, versioned house templates per product line, versioned clause library
  (pre-conditions, post-conditions, general conditions & covenants, special covenants).
- Out of scope: condition-precedent clearance beyond acceptance (credit-admin), disbursement, e-signature / DMS (hook only).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Account Officer, Credit Admin Officer (rule `offer-letters.signoffRequesterRoles`) | Send letter to Legal; request re-issue after lapse | `offer-letters.letters.submit`, `offer-letters.letters.request-reissue` |
| Legal Officer (rule `offer-letters.legalEditorRoles`) | Edit clauses / wording / validity in Legal review; sign off (Operations step) | `offer-letters.letters.update`, `operations.items.decide` |
| AO, CAD, Legal (rule `offer-letters.acceptanceRecorderRoles`) | Record customer acceptance | `offer-letters.letters.record-acceptance` |
| Legal Officer (rule `offer-letters.libraryEditorRoles`) | Propose clause changes and house-template versions | `offer-letters.clauses.request-change`, `offer-letters.template.update`, `offer-letters.template.submit` |
| Legal Officer / Head of Risk | Approve clause and template changes (Operations) | `operations.items.decide` |
| Any offer-letters viewer | List, record, template, library, comment, print, export | `offer-letters.letters.view`, `.template.view`, `.clauses.view`, `.letters.comment`, `.letters.print`, `.letters.export`, `.clauses.export` |

## 3. Functional requirements

| ID | Requirement | Source (PRD § / assumption + Q-id) |
|---|---|---|
| OL-FR-01 | Auto-generate a letter when an application reaches the offer stage, merged into the currently approved house template for its product line. | §7.0 merge behaviour, §6.1.1 step 13 |
| OL-FR-02 | Auto-tag special covenants and conditions from the library by product, obligor type, collateral, security, currency, sector and origination covenant tags. | §6.1.5; Assumption (OL4) |
| OL-FR-03 | Clauses are parameterised templates with merge fields (obligor, amount, currency, rate, notice days, validity days…); unresolved fields are flagged. | §7.3 build note; Assumption (OL3) |
| OL-FR-04 | Legal may add, remove or edit clauses and add bespoke clauses on a letter before release, regardless of template. | §7.0 |
| OL-FR-05 | Every letter change creates a version-history entry; letters keep the template version they were issued on. | §7.0 |
| OL-FR-06 | Legal sign-off releases (issues) the letter and starts the acceptance validity clock. | §6.1.1 step 14, §4.1; Assumption (OL1, OL2) |
| OL-FR-07 | An issued letter lapses if not accepted within its validity (default 7 days); a lapsed letter can be re-issued with a new validity. | §7.3 Acceptance Validity; Assumption (OL-OPS-2) |
| OL-FR-08 | Pre-release checks (e.g. unresolved merge fields, collateral insurance expiring soon). | Assumption (OL3) |
| OL-FR-09 | Record customer acceptance (signed duplicate + Memorandum of Acceptance); clears the signed-acceptance CP and moves the application to Conditions. | §6.1.1 step 13, §7.1; Assumption (DS4) |
| OL-FR-10 | Tenant house templates per product line: letterhead, section order, preamble / closing, defined terms, signature / witness block; versioned; the approved version is used for new letters. | §7.0 template management |
| OL-FR-11 | Clause library (§7.1 pre-conditions, §7.2 post-conditions, §7.3 general conditions & covenants, special covenants) with versioning; new / wording / retire / reinstate changes need approval; edits don't affect letters already in review or issued. | §7.1–7.3 build note; Assumption (OL5) |
| OL-FR-12 | Internal review comments on a letter. | Assumption |
| OL-FR-13 | Print the merged letter. | §7.0 |

## 4. Business rules and parameters

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `offer-letters.validityDaysDefault` | Acceptance validity | 7 days | §7.3 Acceptance Validity |
| `offer-letters.validityDaysMin` / `.validityDaysMax` | Bounds Legal may set | 1 / 90 days | Demo |
| `offer-letters.noticeDays` | `{{notice.days}}` merge value | 10 days | §7.3 build note (demo) |
| `offer-letters.referencePrefix` | Letter reference prefix | `HLB/CAD/OL` | Demo |
| `offer-letters.minClauseTextLength` | Minimum clause text | 20 | Demo |
| `offer-letters.insuranceWarningDays` | Pre-release insurance-expiry window | 30 days | Demo |
| `offer-letters.recentAcceptanceDays` | "Accepted" KPI window | 30 days | Demo |
| `offer-letters.contingentTemplateProducts` | Products using the contingent-facilities template | BG, APG | §7.0 (demo) |
| `offer-letters.unsecuredCollateralTypes` | Collateral that doesn't make a facility "secured" (tagging) | PG, CG, domiciliation | Demo |
| `offer-letters.signoffRequesterRoles` / `.legalEditorRoles` / `.acceptanceRecorderRoles` / `.libraryEditorRoles` | Role mappings | see §2 | §6.1.1, §4.1, §7 (demo) |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `offer-letters.letter.signoff` | Requester sends a letter to Legal (mode `issue`) or requests re-issue after lapse (`reissue`) | One step "Legal sign-off": Legal Officer, 48 h | §6.1.1 steps 13–14; Assumption (OL-OPS-2) |
| `offer-letters.clause.change` | Library editor proposes new / wording / retire / reinstate | One step "Legal approval": Legal Officer or Head of Risk, 72 h | §7.1–7.3; Assumption (OL-OPS-1) |
| `offer-letters.template.approve` | Library editor submits a house-template version | One step "Legal sign-off": Legal Officer or Head of Risk, 72 h | §7.0; Assumption (OL1, OL-OPS-1) |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `offer-letters.letter-issued` | Letter issued / re-issued | Account Officer (RM), requester, Credit Admin Officer |
| `offer-letters.acceptance-recorded` | Acceptance recorded | Credit Admin Officer, Legal Officer, RM |
| `offer-letters.clause-approved` | Clause change approved | Legal Officer, Credit Admin Officer |
| `offer-letters.template-approved` | Template version approved | Legal Officer, Credit Admin Officer |
| `operations.approval-requested` / `.request-completed` (core) | Each sign-off / approval step; outcome | Eligible approvers / requester |

## 7. Events and hook points

| Kind (event / hook) | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `offer-letters.letter.{edited,submitted,issued,reissued,returned,accepted,commented}` | Letter lifecycle | summary, mode, operationId, applicationId, validityDays, acceptedAt |
| event | `offer-letters.clause.{proposed,approved,retired,reinstated,rejected}` | Clause library | change, version, operationId |
| event | `offer-letters.template.{drafted,submitted,approved,returned}` | House templates | productLine, version, operationId |
| hook | `offer-letters.signoff.submit.before/after` | Send to Legal / re-issue | before: veto (extra pre-release checks) |
| hook | `offer-letters.letter.edit.before/after` | Letter change | before: veto / enrich |
| hook | `offer-letters.letter.issue.after` | After issue | after only (e.g. DMS / e-signature push) |
| hook | `offer-letters.acceptance.record.before/after` | Acceptance | before: veto (e.g. signature verification) |
| hook | `offer-letters.clause.submit.before/after`, `offer-letters.template.submit.before/after` | Library / template submission | before: veto |
| subscription | `offer-letters.on-operation-closed` on `operations.request.*` | Returned / rejected / withdrawn | Reverts letter / clause / template state |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Origination | Inbound (internal) | Application reaches Offer stage | Application, obligor, collateral, covenant tags | In-app read |
| Credit administration | Outbound (internal) | Acceptance recorded | CP `CP-02` met; application → Conditions | Direct store call |
| Document management / e-signature | Outbound | `offer-letters.letter.issue.after` | Issued letter | Hook point only; no connector |
| E-mail | Outbound | Notifications | Rendered HTML | Outbox (demo, not sent) |

## 9. Non-functional

- Audit: every letter, clause and template change audited with before/after (PRD §10.3); clause / template / letter version history retained (§7.0).
- User scope: actions gated by module access + role rules; letters visible to every offer-letters viewer.
- Consistency: issued letters keep their template and clause versions (§7.0, §7.3 build note).

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| OL1 | System Admin maintains the template (§7.0) but has no offer-letter access | Legal edits and signs off (two steps) |
| OL2 | Letter states between generation and acceptance | Draft → Legal review → Issued → Accepted; Expired on lapse |
| OL3 | Charge rate, pricing, turnover-commitment merge sources | Placeholders flagged in pre-release checks |
| OL4 | Recommendation-engine tagging rules | Derived from §7.1 "Applicable loan types" |
| OL5 | Do library edits affect letters in Legal review? | No; proposals until approved |
| OL-OPS-1 | Second approver for library / template changes with one Legal Officer | Legal Officer or Head of Risk |
| OL-OPS-2 | Who sends to Legal and who requests re-issue | AO or Credit Admin |
| DS4 | Does an approved deferral clear a CP? | Met / waived / deferred count as cleared |
