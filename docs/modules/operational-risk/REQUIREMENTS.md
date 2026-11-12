# Operational risk — requirements

| | |
|---|---|
| Module | `src/modules/operational-risk` (nav module `operational-risk`, route `/operational-risk`, Phase 2) |
| Repo | credigit-ser-frontend |
| PRD | §6.9, §6.9.1, §6.9.2; §6.4.4 (escalation standard); §6.3.2 (sanctions-for-breach feed); §6.12 (AI trending); §9.2 (COSO, ISO 22301); §10.1 (audit of threshold changes) |
| Owner (business) | Operational Risk Analyst (PRD §4.1); governance: Head of Risk / CRO; control owners per KRI |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

Gives the Operational Risk Analyst trended, leading visibility over operational indicators (KRI framework with Green / Amber / Red banding and escalation), the lagging loss-event register checked against the Loss Limit Framework, the Risk & Control Self-Assessment (RCSA) workflow and Business Continuity Management (BCM) readiness.

In scope:
- KRI register (owner, formula, source, frequency, category), RAG banding from rules, escalation, acknowledgement, AI trend / correlation commentary with human sign-off.
- Loss-event register (Basel event type + PRD indicator category), investigation stages, recoveries, closure / write-off, loss-limit utilisation.
- RCSA cycle: self-assessment, action plans, second-line sign-off, heat map.
- BCM: plan currency and review approval, RTO / RPO targets, test / exercise results, fire-drill compliance, crisis readiness index.

Out of scope:
- Enterprise risk register, RAS and regulatory-breach register — `enterprise-risk` module (§6.10).
- Credit exceptions and their protocol — `monitoring` module (§6.4.4).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Operational Risk Analyst | Acknowledge / escalate KRIs, propose KRI thresholds, log / update loss events, record recoveries, request closure, run and submit RCSA, record BCM exercises, submit BCM plan reviews | `operational-risk.kris.view`, `operational-risk.loss-events.view`, `operational-risk.rcsa.view`, `operational-risk.bcm.view`, `operational-risk.registers.export`, `operational-risk.kris.acknowledge`, `operational-risk.kris.escalate`, `operational-risk.kri-thresholds.request-change`, `operational-risk.kri-commentary.sign-off`, `operational-risk.loss-events.create`, `operational-risk.loss-events.update`, `operational-risk.loss-events.request-closure`, `operational-risk.rcsa.update`, `operational-risk.rcsa.submit`, `operational-risk.bcm-exercises.create`, `operational-risk.bcm-plans.submit` |
| Head of Risk / CRO | Approve threshold changes, loss closure / write-off, BCM plan reviews; second-line RCSA review (Head of Risk) | `operations.items.decide` + view keys |
| CCO, MD, other risk-view roles | View registers | `operational-risk.*.view` |
| Board (Risk Committee) | Receives Level 4 / material-loss notifications | `notifications.inbox.view` |
| System Admin | Holds every permission by default (invariant 12) | all |

## 3. Functional requirements

| ID | Requirement | Source |
|---|---|---|
| OPR-FR-01 | Register every KRI with owner (control owner), formula, source system, frequency, risk category and business line, traceable to an RCSA control. | §6.9.1 |
| OPR-FR-02 | Classify each KRI reading Green / Amber / Red from tenant-configurable thresholds in the Rules engine. | §6.9.1; defaults: Assumption OR1 (§6.9.1) |
| OPR-FR-03 | Amber → Level 1 notification (ORA + control owner); Red → full §6.4.4 protocol (ORA → Head of Risk → CRO, Board for material breaches). | §6.9.1, §6.9.2; mapping: Assumption OR2 (§6.9.1 / §6.4.4); SLAs: OR1 (Operations) |
| OPR-FR-04 | Trend every KRI over time; AI tests seasonality and cross-KRI correlation and drafts commentary for human review. | §6.9.1, §6.9.2, §6.12 |
| OPR-FR-05 | KRI universe and thresholds approved by Head of Risk / CRO; every change audited. | §6.9.1, §10.1 |
| OPR-FR-06 | Show the indicator inventory (8 categories with metrics and source systems). | §6.9.2 |
| OPR-FR-07 | Loss-event register: losses / near misses with root cause, business line, monetary impact; populated from direct logging, CAD sanctions-for-breach, ERM regulatory-breach register and escalated exceptions. | §6.9.2, §6.3.2, §6.4.4; taxonomy: Assumption OR4 (§6.9.2) |
| OPR-FR-08 | Check losses continuously against the Loss Limit Framework (annual / monthly limit, single-event escalation, Board materiality) and escalate breaches. | §6.9.2; values: Assumptions OR3 (§6.9.2), OR2 (§6.9) |
| OPR-FR-09 | Close a loss event and write off the unrecovered amount only after approval. | Assumption OR2 (§6.9, Operations) |
| OPR-FR-10 | RCSA workflow on a configurable cycle, mapped to indicator categories, identifying control owners; likelihood × impact heat map. | §6.9.2; scales: Assumption OR5 (§6.9.2) |
| OPR-FR-11 | RCSA second-line sign-off. | Assumption OR3 (§6.9, Operations) |
| OPR-FR-12 | BCM: plan currency, crisis-management readiness, fire-drill / evacuation compliance; visible to the CRO dashboard. | §6.9.2; targets: Assumption OR6 (§6.9.2 / §9.2) |
| OPR-FR-13 | Record BCM / DR test results; a failed Tier 1 test notifies escalation roles. | §6.9.2; Assumption OR6 |
| OPR-FR-14 | Approve BCM plan reviews and RTO / RPO target changes. | Assumption (BCM Framework / ISO 22301, §9.2) |

## 4. Business rules and parameters

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `operational-risk.kri.<kriId>.amber` / `.red` (16 KRIs) | Amber / Red threshold per KRI | per KRI in `data.ts` | PRD §6.9.1 — demo (OR1) |
| `operational-risk.kri.escalation.level1Roles` … `level4Roles` | Roles per KRI escalation level | ORA; Head of Risk; CRO; Board | PRD §6.9.1 / §6.4.4 |
| `operational-risk.loss.annualNetLimitNgn` | Annual net loss limit | ₦1.2bn | PRD §6.9 — demo (OR3) |
| `operational-risk.loss.monthlyNetLimitNgn` | Monthly net loss limit (drives KRI-LE-01) | ₦100m | PRD §6.9 — demo |
| `operational-risk.loss.singleEventThresholdNgn` | Single-event escalation threshold | ₦25m | PRD §6.9 — demo |
| `operational-risk.loss.boardMaterialityNgn` | Board materiality | ₦100m | PRD §6.9.1 — demo |
| `operational-risk.loss.limitWarningPct` | Annual-limit early warning | 75 % | Tenant parameter (demo) |
| `operational-risk.loss.escalationRoles` | Notified above single-event threshold | Head of Risk, ORA | PRD §6.9 / §6.4.4 — demo |
| `operational-risk.loss.boardNotifyRoles` | Notified above Board materiality | CRO, Board | PRD §6.9.1 — demo |
| `operational-risk.rcsa.likelihoodLabels` / `impactLabels` | Scale labels (size = count) | 5 labels each | Tenant parameter (demo, OR5) |
| `operational-risk.rcsa.mediumFromScore` / `highFromScore` / `criticalFromScore` | Heat-map bands | 5 / 10 / 15 | Tenant parameter (demo, OR5) |
| `operational-risk.rcsa.cycleMonths` | RCSA cycle | 6 months | PRD §6.9 (configurable cycle) — demo |
| `operational-risk.bcm.<planId>.rtoHours` / `.rpoMinutes` | RTO / RPO per BCM plan | per plan | PRD §6.9 BCM — demo (OR6) |
| `operational-risk.bcm.reviewCycleDays` | Plan review cycle | 365 days | Tenant parameter (demo) |
| `operational-risk.bcm.reviewDueWindowDays` | "Due for review" window | 60 days | Tenant parameter (demo) |
| `operational-risk.bcm.fireDrillsPerYear` | Drills per branch per year | 2 | Tenant parameter (demo) |
| `operational-risk.bcm.drillComplianceTargetPct` | Drill compliance green from | 90 % | Tenant parameter (demo) |
| `operational-risk.bcm.readinessRedBelow` / `readinessAmberBelow` | Readiness index bands | 60 / 80 | Tenant parameter (demo) |
| `operational-risk.bcm.weightPlanCurrency` / `weightRtoMet` / `weightDrillCompliance` / `weightCrisisChecklist` | Readiness index weights | 25 % each | Tenant parameter (demo) |
| `operational-risk.bcm.failureEscalationRoles` | Notified on a failed Tier 1 test | Head of Risk, CRO | PRD §6.9 BCM — demo |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `operational-risk.kri.threshold-change` | ORA proposes new Amber / Red values | 1 step: any of Head of Risk, CRO · 48 h; applies both rule values | §6.9.1 |
| `operational-risk.loss-event.closure` | Request to close and write off | 1 step: any of Head of Risk, CRO · 72 h | OR2 (§6.9, Operations) |
| `operational-risk.rcsa.sign-off` | Self-assessment submitted | 1 step "Second-line review": any of Head of Risk, ORA · 120 h (SoD stops self-approval); reject returns to "In progress" | OR3 (§6.9, Operations) |
| `operational-risk.bcm.plan-approval` | Plan review (± RTO / RPO change) submitted | 1 step: any of Head of Risk, CRO · 72 h; applies RTO / RPO rules and next review date | Assumption (BCM Framework) |
| `ai.output.sign-off` (ai module) | KRI commentary adoption | Subscribed via `operational-risk.adopt-kri-commentary` | §6.12 |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `operational-risk.kri-red-breach` | KRI escalated to a level | Roles of `operational-risk.kri.escalation.level<n>Roles` |
| `operational-risk.loss-above-threshold` | Logged loss ≥ single-event threshold and / or ≥ Board materiality | `operational-risk.loss.escalationRoles`; `operational-risk.loss.boardNotifyRoles` |
| `operational-risk.bcm-test-failed` | Tier 1 BCM test recorded as Failed | `operational-risk.bcm.failureEscalationRoles` |
| `operations.*` | Approvals requested / decided | Platform |

## 7. Events and hook points

| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `operational-risk.kri.escalated` | KRI escalated | from, to, rag, value |
| event | `operational-risk.kri.acknowledged` | Amber / Red reading acknowledged | rag, value |
| event | `operational-risk.kri.thresholds-changed` | Threshold change applied | before, after, operationId |
| event | `operational-risk.kri.commentary-adopted` | AI commentary signed off | — |
| event | `operational-risk.loss-event.logged` | Loss / near miss logged | netLoss, aboveThreshold |
| event | `operational-risk.loss-event.status-changed` | Investigation stage moved | from, to |
| event | `operational-risk.loss-event.recovery-recorded` | Recovery recorded | before, after |
| event | `operational-risk.loss-event.closed` | Closure applied | writeOff, netLoss |
| event | `operational-risk.rcsa.submitted` / `.signed-off` / `.returned` / `.action-completed` | RCSA lifecycle | operationId / residual / actionId |
| event | `operational-risk.bcm.exercise-recorded` / `.plan-approved` | BCM lifecycle | result / rtoHours, rpoMinutes |
| hook | `operational-risk.kri.escalate.before` / `.after` | Around KRI escalation | before: veto or enrich note |
| hook | `operational-risk.loss-event.log.before` / `.after` | Around logging a loss event | before: veto (duplicate) or enrich |
| hook | `operational-risk.bcm.exercise.before` / `.after` | Around recording a test | before: veto or enrich |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| HRIS | Inbound, periodic | KRI measurement | Headcount, attrition, vacancies | Simulated (`data.ts`) |
| Security / incident-management system | Inbound | KRI measurement | Physical incidents, access violations | Simulated |
| CBA transaction logs | Inbound | KRI measurement | Error / reversal rates | Simulated |
| IT / channel monitoring | Inbound | KRI measurement | Downtime, failed transactions, batch failures | Simulated |
| SIEM / cyber tooling | Inbound | KRI measurement | Intrusions, MTTD / MTTC, phishing | Simulated |
| CRM / complaints | Inbound | KRI measurement | Complaint volume, repeat rate | Simulated |
| Credit Admin sanctions-for-breach (§6.3.2) | Inbound (internal) | Sanction approved | Loss-event entry | Simulated reference (TD-854) |
| ERM regulatory-breach register (§6.10) | Inbound (internal) | Breach recorded | Loss-event entry | Seeded source only |
| Monitoring exceptions (§6.4.4) | Inbound (internal) | Control-failure exception | Loss-event entry | Not built |
| E-mail | Outbound | Notifications | Rendered HTML | Outbox only (demo) |

## 9. Non-functional

- Audit: KRI acknowledge / escalate / threshold request / apply, loss log / status / recovery / closure request / apply, RCSA start / submit / action / sign-off / return, BCM exercise / plan submit / approve.
- User scope: "Reported by me" loss view via `reportedById`; edit actions need `operational-risk` edit access; SoD on all Operations steps.
- Explainability: KRI formula, source system and owner shown per KRI.

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| OR1 (§6.9.1) | Default Amber / Red thresholds | Demo thresholds, Head of Risk / CRO approval for changes |
| OR2 (§6.9.1 / §6.4.4) | Amber / Red → escalation levels | Amber L1; Red one level per month uncured |
| OR3 (§6.9.2) | Loss Limit Framework values | ₦1.2bn / ₦100m / ₦25m / ₦100m |
| OR4 (§6.9.2) | Loss-event taxonomy | Basel II seven types + PRD category |
| OR5 (§6.9.2) | RCSA scales, banding, cadence | 5×5, Low 1–4 … Critical 15–25, semi-annual |
| OR6 (§6.9.2 / §9.2) | BCM RTO / RPO, review cadence, drills, readiness | Demo values as rules |
| OR1 (Operations, §6.9.1 / §6.4.4) | KRI escalation SLAs per level; Level 4 materiality | Level from months outside green (TD-904) |
| OR2 (Operations, §6.9) | Who approves loss closure / write-off | Head of Risk / CRO |
| OR3 (Operations, §6.9) | RCSA sign-off by ORA or Head of Risk | Any of Head of Risk, ORA |
