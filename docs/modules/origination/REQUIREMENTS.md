# Loan origination — requirements

| | |
|---|---|
| Module | `src/modules/origination` (nav module `origination`) |
| Repo | credigit-ser-frontend |
| PRD | §6.1, §6.1.1–6.1.5, §4.1–4.2, §5.1–5.6 (inputs), §8 (COP Ratio) |
| Owner (business) | Account Officer / BDM (initiation), Credit Analyst (analysis), chart-flow approvers GH → CCO → HD → CRO → MD → MCC → BCC → Board |
| Counterpart | [credigit-ser-core-backend `docs/modules/CreditOrigination/`](../../../../credigit-ser-core-backend/docs/modules/CreditOrigination/REQUIREMENTS.md) |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

Digitises the credit request lifecycle from initiation to final approval on the Standard and Fast-Track chart-flows (PRD §6.1). The
module captures the request, documents and collateral, runs financial-statement validation (COP Ratio), bureau / CRMS checks, the
portfolio-limit gate and the recommendation engine, and routes the request through the tenant-configured co-signer / adjudicator
ladder in Operations. A fully approved request is released to the Offer Letter module.

- In scope: application wizard, pipeline and queues, application record (overview, financials & COP, 360 RAR summary, documents,
  collateral, recommendation & covenants, approvals, comments, activity), chart-flow matrices and route simulator, limit exceptions,
  recommendation overrides, release to offer.
- Out of scope: 360 RAR scoring (credit-analysis module), offer-letter generation (offer-letters), conditions / disbursement
  (credit-admin, disbursement), collateral perfection (collateral), self-service customer portal (PRD §6.1.1 step 1 — not built).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Account Officer, BDM (rule `origination.roles.initiators`) | Create, submit, withdraw, submit for approval, upload documents, release to offer | `origination.applications.create`, `.update`, `.submit`, `.withdraw`, `origination.documents.upload`, `origination.approvals.submit`, `origination.applications.release-to-offer`, `origination.applications.view-mine` |
| Credit Analyst (rule `origination.roles.analysts`) | Verify OCR, run bureau / CRMS and limit gate, record COP explanation, complete analysis, sign off memo | `origination.documents.verify`, `origination.bureau-checks.run`, `origination.limit-gate.run`, `origination.cop-explanations.update`, `origination.analysis.record`, `origination.analysis.complete`, `origination.credit-memos.sign-off`, `origination.limit-exceptions.request` |
| Credit Analyst, CCO (rule `origination.roles.recommenders`) | Adopt / override recommendation, tag covenants | `origination.recommendations.adopt`, `origination.recommendations.request-override`, `origination.covenants.update` |
| Chart-flow approvers (BDM, GH, CA, CCO, HD, CRO, MD, MCC, BCC, Board) | Decide credit-approval steps in Operations; CRO / Board decide limit exceptions | `operations.items.decide`, `operations.queue.view` |
| Any origination viewer | Pipeline, record, queue, chart-flows, comments | `origination.applications.view`, `origination.queue.view`, `origination.chart-flows.view`, `origination.applications.export`, `origination.comments.create` |

## 3. Functional requirements

| ID | Requirement | Source (PRD § / assumption + Q-id) |
|---|---|---|
| ORG-FR-01 | Initiator creates a request (obligor, product, amount, tenor, purpose, request type, flow, collateral, documents) in a wizard; draft or submit. | §6.1.1 step 2 |
| ORG-FR-02 | On submission the request flows in parallel to the BDM and to Legal (collateral search). | §6.1.1 step 2 |
| ORG-FR-03 | Documents are uploaded with versioning; OCR extracts fields; low-confidence fields are flagged for analyst verification. | §5.4 |
| ORG-FR-04 | Compute the COP Ratio (verified CBA + other-bank turnover ÷ declared turnover) with tenant banding; Low band needs a documented customer explanation. | §6.1.4, §8 |
| ORG-FR-05 | Pull credit bureau report(s) and CRMS search as an independent check. | §6.1.4, §5.2 |
| ORG-FR-06 | Show the 360 RAR posture for the obligor (from credit-analysis). | §6.2 |
| ORG-FR-07 | Check single-obligor and sectoral limits before the next approval tier; a breach blocks progression and routes to CRO / Board for an informed exception. | §6.1.5, §5.6 |
| ORG-FR-08 | Recommendation engine proposes proceed / with conditions / decline / refer with rationale; analyst or CCO adopts, amends or overrides with a mandatory reason. | §6.1.5; rules Assumption (O4) |
| ORG-FR-09 | Auto-tag special covenants and conditions for the offer letter from the conditions library by product, sector, tenor, collateral and posture. | §6.1.5, §7 |
| ORG-FR-10 | Route approval through the tenant-configured Standard chart-flow (tier 1 BDM recommends; co-signer pairs per tier until amount ≤ tier limit; dissent → adjudicator). | §6.1.1–6.1.2; pairing Assumption (Q 4) |
| ORG-FR-11 | Fast-Track flow for Fast-Track products within the Fast-Track ceiling: one co-signing pair with adjudicator. | §6.1.3; Assumption (O1, O2, W5) |
| ORG-FR-12 | BDM cannot concur until collateral due diligence is complete. | §6.1.1 step 3; Assumption (O6) |
| ORG-FR-13 | Approvers may approve, decline or return for rework; a return restarts the route from Analysis. | §6.1.1; Assumption (O7) |
| ORG-FR-14 | Step-up authentication for approvals above the high-value threshold. | §4.2; Assumption (W2, DS1) |
| ORG-FR-15 | Segregation of duties: requester can't decide their own approval; one person per step except where the chart-flow needs it (CCO adjudicates tier 2 and co-signs tier 3). | §4.2, §6.1.2 |
| ORG-FR-16 | Fully approved request is released to offer-letter generation. | §6.1.1 step 13 |
| ORG-FR-17 | Initiator may withdraw a request (retained for audit). | Assumption (none recorded) |
| ORG-FR-18 | Pipeline with SLA status (on track / due soon / overdue), "My queue" and "My applications" views. | §6.1; SLA days Assumption |
| ORG-FR-19 | Approval chart-flow matrices and route simulator re-derived from tenant rules. | §6.1.2 ("re-derived automatically") |
| ORG-FR-20 | AI-drafted credit memo shown with a human sign-off action. | §2.3, §6.12 |
| ORG-FR-21 | Comments with @mentions on a request. | Assumption |
| ORG-FR-22 | Submission for approval is made by the initiator after analysis (not the analyst). | Assumption (O9, O10, O3) |

## 4. Business rules and parameters

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `origination.singleObligorPct` | Single-obligor limit, % of shareholders' funds | 20 | §5.6 — CBN 3.2(a) |
| `origination.largeExposurePct` | Large-exposure threshold | 10 | §5.6 — CBN 3.2(d) |
| `origination.offBalanceWeightPct` / `.offBalanceProducts` | Contingent product weighting and product list | 33.33 / BG, APG, LC | §5.6 — CBN 3.2(b) |
| `platform.shareholdersFundsNgn` (core) | Limit base | ₦60bn | §6.6.2 / §8 demo (O5) |
| `origination.limitGate.warnUtilisationPct` | Amber utilisation | 85 | Demo |
| `origination.coverage.warnPct` | Security-cover red threshold | 70 | Demo |
| `origination.cop.highBand` / `.mediumBand` | COP banding | 0.85 / 0.60 | §6.1.4 example banding |
| `origination.cop.gaugeMax`, `.explanationMinLength` | Gauge max; Low-band explanation length | 1.2 / 10 | Demo |
| `origination.engine.declineGradeAtOrAbove` / `.conditionsGradeAtOrAbove` / `.minCoverPct` | Engine thresholds | 8 / 6 / 100 | Demo (O4) |
| `origination.override.minReasonLength` | Override reason length | 10 | Demo |
| `origination.sla.standardDays` / `.fastTrackDays` / `.dueSoonDays` / `.warnWithinHours` | End-to-end SLA and warnings | 10 / 3 / 2 d / 4 h | Demo |
| `origination.sla.limitExceptionHours` / `.overrideHours` | Step SLAs of exception / override workflows | 48 / 24 | Demo |
| `origination.products`, `origination.fastTrack.variants`, `origination.defaultTenorMonths` | Product catalogue, Fast-Track variants, default tenor | 10 products / 5 variants / 12 | §6.1.3 (O2), demo |
| `origination.docs.required` / `.requiredNonRetail` / `.acceptedTypes` / `.maxUploadMb` / `origination.ocr.reviewBelowPct` | Document rules | see code / 25 MB / 90% | Demo (§5.4) |
| `origination.roles.initiators` / `.analysts` / `.recommenders` / `.releasers` / `.uploaders` | Role mappings | see §2 | §6.1.1, §6.1.5, demo |
| `origination.haircut.<type>` (11), `origination.collateral.forcedSalePct` / `.revaluationDays` | New-pledge haircuts, FSV, first revaluation | 0–100 / 70 / 365 | Demo (TD-111) |
| `origination.chartFlow.T1…T12.{roles,adjudicator,limitRole,slaHours}` | Standard chart-flow tiers (defined in `src/lib/workflow.ts`); up to 12 tiers, T8–T12 empty (skipped) by default; an empty limit role = the last signer | PRD default ladder (T1–T7) | §6.1.2 (Q 4) |
| `origination.fastTrack.{roles,adjudicator,limitRole,slaHours}` | Fast-Track pair | BDM + CA, CCO, BDM limit | §6.1.3 (O1) |
| `rbac.limit.<role>` (core) | Sign-on limits | illustrative NGN | §4.1 (Q 3) |
| `approvals.stepUpThresholdNgn` (core) | Step-up threshold | ₦100m | §4.2 (W2, DS1) |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `credit.facility-approval.t1` … `.t12` | Initiator submits for approval (Standard flow); type picked by route length | Steps generated from `origination.chartFlow.*`: single-signer tiers "any", co-signer tiers "all" + adjudicator; SLA `…slaHours`; repeat approver allowed | §6.1.1–6.1.2 (TD-113) |
| `credit.facility-approval.fast-track` | Submit for approval, Fast-Track within ceiling | One "all" step: Fast-Track pair + adjudicator | §6.1.3 (O1) |
| `origination.limit-exception` | Analyst requests an exception after a limit-gate breach | One step: CRO or Board, `origination.sla.limitExceptionHours` | §6.1.5, §5.6 |
| `origination.recommendation-override` | Recommender picks an outcome other than the engine's | One step: CCO or CRO, `origination.sla.overrideHours` | §6.1.5 |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `origination.application-submitted` | Initiator submits | BDM, Legal Officer (roles) |
| `origination.ready-for-analysis` | Sent to analysis | Credit Analyst |
| `origination.analysis-complete` | Analysis completed | Initiator |
| `origination.credit-approved` / `.credit-declined` / `.returned-for-rework` | Credit operation approved / rejected / returned | Credit Analyst + initiator |
| `origination.limit-breach` | Limit gate breached | Credit Analyst, CRO, initiator |
| `origination.limit-exception-decided` | Exception granted / refused | Credit Analyst, initiator |
| `origination.recommendation-overridden` | Override approved | CCO, initiator |
| `origination.document-uploaded` / `.documents-verified` | Upload (non-draft) / verification | Credit Analyst / initiator |
| `origination.released-to-offer` | Released to offer letter | Initiator |
| `origination.comment-mention` | @mention | Mentioned users |
| `origination.application-withdrawn` | Withdrawn | Credit Analyst, BDM |
| `operations.approval-requested` / `.request-completed` (core) | Each approval step / final outcome | Eligible approvers / requester |

## 7. Events and hook points

| Kind (event / hook) | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `origination.application.{created,submitted,sent-to-analysis,analysis-completed,approved,declined,returned,released-to-offer,withdrawn}` | Lifecycle transitions | stage, amount, flow, operationId |
| event | `origination.approval.{submitted,withdrawn}` | Credit operation created / withdrawn | operationId, operationType, steps |
| event | `origination.limit-gate.{checked,breached}`, `origination.limit-exception.{requested,granted,refused}` | Limit gate and exceptions | before/result, breach, operationId |
| event | `origination.recommendation.{adopted,override-requested,overridden}`, `origination.covenants.tagged` | Recommendation and covenants | recommendation, from/to |
| event | `origination.{bureau.pulled,cop.explained,memo.signed-off,comment.added,document.uploaded,document.verified}` | Analysis actions | kind, version, ids |
| hook | `origination.<action>.before/after` for `application.{create,submit,analysis-start,analysis-complete,release,withdraw}`, `approval.submit`, `limit-gate.check`, `limit-exception.request`, `recommendation.adopt`, `document.{upload,verify}`, `covenants.tag`, `bureau.pull`, `cop.explain`, `memo.sign-off`, `comment.add` | Around each action | before: veto / enrich (`approval.submit` may change `operationType`) |
| hook (built-in) | `origination.credit-approval-controls` on `operations.decide.before` | Credit approval decision | Vetoes: wrong stage, missing step-up, limit breach without granted exception, BDM before due diligence |
| subscription | `origination.credit-approval-sync` on `operations.*` | Any credit operation event | Mirrors steps onto `Application.approvals` / stage |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Core banking (CBA) statement | Inbound | Financials tab / analysis | Account credits for COP reconciliation (§5.1) | Simulated (`data.ts`) |
| Other-bank statement connector | Inbound | Analysis | Other-bank turnover (§5.3) | Simulated |
| OCR / document ingestion | Inbound | Document upload | Extracted fields + confidence (§5.4) | Simulated |
| Credit bureaux + CBN CRMS | Inbound | "Pull bureau / CRMS" | Bureau lines, scores, CRMS reference (§5.2) | Simulated |
| Portfolio limit engine | Internal | Limit gate | Obligor / sector exposure (§5.6) | Computed client-side from spine |
| Credit-analysis (360 RAR) | Internal | Record / engine | Posture, grade | In-app read |
| Offer letters | Outbound (internal) | Release to offer | Approved application | Stage change + event |
| Backend CreditOrigination API | Both | All actions | Application, analysis, approval | Not wired (backend exists, ADR-0011) |

## 9. Non-functional

- Audit: every action writes `Application` audit entries with before/after (PRD §10.3); Operations audits its own transitions.
- User scope: "My queue" / "My applications" filter by actor; record pages gated by module access; no branch / portfolio scoping.
- Security: step-up above `approvals.stepUpThresholdNgn` (§4.2); SoD enforced by the engine and the controls hook.
- Explainability: COP, limit gate and engine rationale shown with their inputs (§10.3).

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| 3, 4 | Sign-on limits and co-signer pairing per tier | Illustrative limits; PRD default ladder |
| W3 | Role tier numbers vs chart-flow tiers | Chart-flow tier shown |
| W5, O2 | Fast-Track products and ceiling | PRD product list as variants; ₦50m (BDM limit) |
| O1 | Fast-Track rule reads circularly | BDM + CA within BDM limit; Standard ladder above |
| O3, O10 | PRD order AO → BDM → GH → CA vs stage model | Analysis before BDM recommendation |
| O4 | Recommendation engine rules | Demo rule set as tenant parameters |
| O5 | Shareholders' funds and sector-limit base | Demo value; approved live book |
| O6 | What counts as collateral due diligence done | Legal search complete |
| O7 | Do signatures survive a return? | Route resets to Analysis |
| O9 | Who submits for approval | Initiator |
| BE-27 (backend) | Does a breach block submission or approval? | Frontend vetoes approval; backend blocks submission |
