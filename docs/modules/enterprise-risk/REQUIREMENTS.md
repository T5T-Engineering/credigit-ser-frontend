# Enterprise risk — requirements

| | |
|---|---|
| Module | `src/modules/enterprise-risk` (nav module `enterprise-risk`, route `/enterprise-risk`) |
| Repo | credigit-ser-frontend |
| PRD | §6.10 (ERM, Phase 2), §6.11 (Head of Risk dashboard — BRC pack builder), §3 row 18, §4.1 / §4.3 (CRO owns the Risk Appetite Statement; Head of Risk prepares BRC packs), §6.6.2 (CBN concentration limits), §9.2 (three lines of defence) |
| Owner (business) | Chief Risk Officer (RAS owner), Head of Risk (BRC pack, policy) |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Enterprise-level aggregation over the Risk Data Spine (no new transactional capture, §3 row 18): the Risk Appetite dashboard against the Board-approved Risk Appetite Statement with breach escalation, insider/related-party lending disclosure, CBN circular ingestion linked to a policy-currency tracker, an enterprise risk register, the Board Risk Committee (BRC) pack and a lines-of-defence view.

- In scope: RAS scorecard (11 metrics, RA-01…RA-11), RAS limit change requests, Amber/Red escalation, insider flags and CBN disclosure fields, circulars and policy reviews, risk register with acceptance, BRC pack compile → submit → approve, AI-drafted summary sign-off, lines-of-defence mapping.
- Out of scope: source calculations owned by other modules (capital — ifrs9; liquidity/NOP — market-risk; KRIs/loss — operational-risk); the CBN circulars connector itself (§5.5, connectors module).
- Assumptions: risk register and lines-of-defence are prototype additions (ER3, ER5).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| Chief Risk Officer | Owns the RAS; reviews RAS changes; approves risk acceptance and BRC packs; escalates breaches | `enterprise-risk.*.view`, `enterprise-risk.appetite-limits.request-change`, `enterprise-risk.appetite-breaches.escalate`, `enterprise-risk.risks.request-acceptance`, `operations.items.decide` |
| Head of Risk | Compiles and submits the BRC pack; reviews risks, circulars and policies; signs off the AI summary | `enterprise-risk.brc-pack.compile`, `enterprise-risk.brc-pack.submit`, `enterprise-risk.brc-summary.sign-off`, `enterprise-risk.risks.review`, `enterprise-risk.circulars.assess`, `enterprise-risk.policies.review`, `ai.outputs.sign-off` |
| Board | Approves RAS limit changes | `operations.items.decide` (Operations step), `enterprise-risk.risk-appetite.view` |
| Managing Director | Decides risk acceptance requested by the CRO | `operations.items.decide` |
| Risk analysts (Credit/Market/Op-risk, MIS, Middle office) | View-only | `enterprise-risk.risk-appetite.view`, `enterprise-risk.register.view`, `enterprise-risk.insider.view`, `enterprise-risk.regulatory.view`, `enterprise-risk.brc-pack.view`, `enterprise-risk.lines-of-defence.view`, `enterprise-risk.data.export` |
| System Admin | Every permission by default (invariant 12) | all |

## 3. Functional requirements
| ID | Requirement | Source (PRD § / assumption + Q-id) |
|---|---|---|
| ERM-FR-01 | Risk Appetite dashboard tracks actuals (single-obligor, sector concentration, government exposure, large exposures, NPL, CAR, liquidity ratio, LCR, NOP, op-loss, KRI Red share) against RAS limit and early-warning tolerance with RAG and trend. | §6.10; limits ER1 |
| ERM-FR-02 | Automated breach escalation: Amber / Red metrics escalate to configured roles with notification. | §6.10 ("automated breach escalation"); role mapping assumption |
| ERM-FR-03 | RAS limit / tolerance changes go through Operations (CRO review → Board approval) and update the rules. | §4.3, §6.10; assumption ERM1 |
| ERM-FR-04 | Flag facilities to directors, significant shareholders (≥ 5%) and their related interests. | §6.10; source ER2 |
| ERM-FR-05 | Populate CBN disclosure fields: aggregate insider-related credit; non-performing component by security / maturity / performance / provision. | §6.10; provision column deferred (ER2) |
| ERM-FR-06 | CBN circular feed linked to policies; track impact assessment and policy linkage. | §6.10, §5.5 |
| ERM-FR-07 | Policy-currency tracker: credit, project-finance, real-estate, SME, agriculture and retail-financing policies reviewed at least every 3 years; due-soon / overdue status. | §6.10 |
| ERM-FR-08 | Enterprise risk register (inherent/residual, owner, response, COSO stage, heat map) with review recording. | Assumption ER3 (§9.2 COSO/ISO 31000) |
| ERM-FR-09 | Risk acceptance (Tolerate) routed through Operations. | Assumption ERM2 |
| ERM-FR-10 | Head of Risk compiles a BRC pack (selectable sections, AI-drafted executive summary) and submits it to the CRO for approval; notified on approval. | §4.1, §6.11; assumption ER4 |
| ERM-FR-11 | AI-drafted summary is labelled and adopted only after human sign-off. | §6.12 |
| ERM-FR-12 | Lines-of-defence view mapping roles to the three lines. | §9.2; assumption ER5 |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `enterprise-risk.ras.<RA-xx>.limit` (RA-01…RA-11) | Board appetite limit per metric | RA-01 20%, RA-02 100%, RA-03 10%, RA-04 8×, RA-05 5%, RA-06 15%, RA-07 30%, RA-08 100%, RA-09 20%, RA-10 100%, RA-11 20% | CBN 3.2 via §6.6.2; §9.1; §6.8.3; others Board RAS demo (ER1) |
| `enterprise-risk.ras.<RA-xx>.tolerance` | Early-warning (Amber) level | e.g. RA-01 18%, RA-06 16.5% | Board RAS demo |
| `enterprise-risk.ras.version` / `.approvedBy` / `.approvedAt` / `.nextReview` | RAS in force metadata | RAS 2026.1 / Board / 2026-01-28 / 2027-01-31 | Demo |
| `enterprise-risk.largeExposurePct` | Large-exposure definition (% of shareholders' funds) | 10% | §6.6.2 (CBN 3.2(d)) |
| `enterprise-risk.policy.reviewCycleYears` | Policy review cycle | 3 years | §6.10 |
| `enterprise-risk.policy.dueSoonDays` | Due-soon window | 182 days | Demo |
| `enterprise-risk.insider.significantShareholdingPct` | Significant-shareholder threshold | 5% | §6.10 |
| `enterprise-risk.appetite.amberEscalationRoles` | Amber escalation targets | `["cro"]` | §6.10 — demo mapping |
| `enterprise-risk.appetite.redEscalationRoles` | Red escalation targets | `["cro","board"]` | §6.10 / §6.11 — demo mapping |
| `enterprise-risk.brc.packReadyRoles` | Notified when BRC pack approved | `["board","head-of-risk","cro"]` | §6.11 — demo mapping |
| `operational-risk.loss.annualNetLimitNgn` (operational-risk rule) | Annual loss limit for RA-10 | ₦1.2bn (owned by operational-risk) | §6.9 |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `enterprise-risk.ras.change` | RAS limit/tolerance change requested | CRO review (`cro`, 72 h) → Board approval (`board`, 168 h) | §4.3, §6.10; ERM1 |
| `enterprise-risk.risk.acceptance` | Request to tolerate a risk | CRO / MD approval (`cro`, `md`, any, 72 h) | ERM2 |
| `enterprise-risk.brc-pack.approval` | Head of Risk submits pack | CRO approval (`cro`, 72 h); reject → Draft | §6.11; ER4 |
| `ai.output.sign-off` (ai module) | BRC executive summary sign-off | Accountable role decides (no extra steps) | §6.12 |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `enterprise-risk.appetite-breach` | Amber/Red metric escalated | Rule `amberEscalationRoles` / `redEscalationRoles` |
| `enterprise-risk.brc-pack-ready` | BRC pack approved for circulation | Rule `enterprise-risk.brc.packReadyRoles` |
| `operations.*` (core) | Approval requested / completed | Approvers / requester |

## 7. Events and hook points
| Kind (event / hook) | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `enterprise-risk.ras.changed` | RAS change applied | before, after |
| event | `enterprise-risk.appetite.breach-escalated` | Escalation sent | rag, actual, escalatedTo |
| event | `enterprise-risk.risk.reviewed` / `.risk.accepted` | Review recorded / acceptance approved | residual |
| event | `enterprise-risk.brc-pack.compiled` / `.submitted` / `.approved` / `.returned` / `.summary-adopted` | Pack lifecycle | meeting, sections, operationId |
| event | `enterprise-risk.circular.assessed` / `.circular.linked` / `.policy.reviewed` | Regulatory tracker actions | policyId |
| hook | `enterprise-risk.appetite.escalate.before` / `.after` | Around escalation | metric, roles, actor · before can veto / enrich targets |
| hook | `enterprise-risk.brc-pack.compile.before` / `.after` | Around pack compile | pack, actor · before can veto / add sections |
| subscriber | `ai.output.signed-off` → `enterprise-risk.adopt-brc-summary` | AI summary signed off | writes adopted text to the pack |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| CBN circulars feed (§5.5) | Inbound | Scheduled | Circular ref, title, area, impact | Seeded demo list |
| Risk Data Spine (facilities, obligors, sectors) | Inbound | Page load | Exposures, CBN class, sector limits | Built |
| ifrs9 / market-risk (CAR, liquidity, LCR, NOP) | Inbound | Page load | Actuals | Simulated literals in `data.ts` |
| operational-risk (loss events, KRI readings, loss limit) | Inbound | Page load | Net loss YTD, Red share | Built (module store) |
| Obligor related-party links | Inbound | Page load | Director / shareholder links | Simulated (ER2) |
| Report / PDF service | Outbound | BRC pack approval | Rendered pack | Not built (TD-902) |

## 9. Non-functional
- Audit: escalation, risk review/acceptance, circular/policy actions, pack compile/submit/approve/return and RAS changes are audited.
- Segregation: Operations engine bars requesters from deciding (Head of Risk can't approve own pack).
- AI output labelled "AI-drafted" with model label from rule `ai.model.narrative`; adoption needs sign-off (§6.12).
- Read-only aggregation: no transactional capture (§3 row 18).

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| ER1 | RAS limits beyond regulatory floors; shareholders' funds | Demo RAS 2026.1; shareholders' funds ₦60bn |
| ER2 | Where insider / related-party links are captured | Fixed demo set of obligors; needs `Obligor.relatedParty` |
| ER3 | Is the enterprise risk register in scope? | Included (ISO 31000 responses, COSO stages) |
| ER4 | BRC pack contents, approval chain, format | Head of Risk compiles → CRO approves |
| ER5 | Lines-of-defence placement of unplaced roles | Only PRD-named roles shown |
| ERM1 | Approval route for RAS changes | CRO review → Board |
| ERM2 | Who approves risk acceptance | CRO, or MD when the CRO requested it |
| EX1 | Does the BRC pack need MD / Board secretary approval? | Not in this module; see executive |
