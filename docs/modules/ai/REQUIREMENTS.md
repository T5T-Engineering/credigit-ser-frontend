# AI analytics — requirements

| | |
|---|---|
| Module | `src/modules/ai` (nav module `ai-console`) |
| Repo | credigit-ser-frontend |
| PRD | §6.12, §6.13, §10.1, §10.3; §3 row 20 (AI Co-Pilot depth) |
| Owner (business) | CRO, Head of Risk (full scope); System Admin / IT Support (platform scope); accountable role per AI output |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Restricted natural-language query console over the Risk Data Spine (chart + narrative answer, every query audited) and a cross-module register of AI-drafted / AI-flagged outputs awaiting the accountable human's sign-off (PRD §6.12–6.13). Phase 2 (console); Phase 1 basic flagging.

- In scope: query console with role-scoped data access, conversation, deep link `?ask=`, query log, scheduled reports (save query with cadence and recipients), AI activity register with sign-off / reject.
- Out of scope: real NL→query model (rules-based simulator), document OCR, anomaly models, credit-memo drafting engines (they live in owning modules), report delivery scheduler.

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| CRO, Head of Risk | Full-scope queries, schedule reports, export results | `ai.console.view`, `ai.queries.run`, `ai.conversations.create`, `ai.query-results.export`, `ai.schedules.create`, `ai.schedules.delete`, `ai.query-log.view`, `ai.query-log.export` |
| System Admin, IT Support | Platform-scope queries only (users, audit, connectors) | `ai.console.view`, `ai.queries.run`, `ai.conversations.create`, `ai.query-log.view` |
| Accountable role of an AI output | Sign off or reject the output | `ai.activity.view`, `ai.activity.export`, `ai.outputs.sign-off`, `ai.outputs.reject` |
| Head of Risk / CRO | Approve scheduled-report distribution | `operations.items.decide` |
| Other roles | No console access (restriction shown) | — |

## 3. Functional requirements
| ID | Requirement | Source |
|---|---|---|
| AI-FR-01 | Console access is restricted to configured full-scope and platform-scope roles. | PRD §6.13; AI1 (open) |
| AI-FR-02 | Natural-language question resolves to the platform data dictionary (Section 8 metrics, KRIs) — no external free-text search. | PRD §6.13 |
| AI-FR-03 | Answer is a chart plus a short plain-language narrative, labelled with sources and model version. | PRD §6.13, §10.3 |
| AI-FR-04 | Role scope enforced at the query layer: platform scope limited to platform-health/configuration data. | PRD §6.13; AI2 (open) |
| AI-FR-05 | Every query and answer is logged (who, what, when, data touched) in the audit trail. | PRD §6.13, §10.1 |
| AI-FR-06 | Save a query as a recurring scheduled report (cadence, recipients). | PRD §6.13 |
| AI-FR-07 | Example: attrition trend against customer complaints with correlation narrative. | PRD §6.13 |
| AI-FR-08 | AI outputs across modules are labelled AI-drafted / AI-flagged, time-stamped with model/version. | PRD §6.12, §10.3 |
| AI-FR-09 | AI output requires the accountable role's sign-off before any workflow effect; AI never auto-approves. | PRD §6.12 |
| AI-FR-10 | Distribution of risk data through a scheduled report requires approval. | Assumption (PRD silent) |
| AI-FR-11 | Scheduled reports are actually generated and delivered on cadence. | PRD §6.13 — **not implemented** |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `ai.console.fullScopeRoles` | Roles with full Risk Data Spine query scope | CRO, Head of Risk | PRD §6.13 |
| `ai.console.platformScopeRoles` | Roles limited to platform data | System Admin, IT Support | PRD §6.13 (AI1) |
| `ai.console.modelVersion` | Model label on answers / audit | `SER-NLQ 0.9 (simulated, rules-based)` | PRD §6.12 — demo |
| `ai.model.trendAnalyser` | Trend commentary model label | `SER Trend Analyser v2.3 (simulated)` | Demo |
| `ai.model.narrative` | Report narrative model label | `SER Narrative v1.4 (simulated)` | Demo |
| `ai.queryLog.maxEntries` | Local query log size (no approval) | 200 | Demo |
| `ai.conversation.maxExchanges` | Exchanges shown (no approval) | 8 | Demo |
| `ai.query.minQuestionLength` | Minimum question length (no approval) | 3 | Demo |
| `ai.query.defaultTopN` / `ai.query.maxTopN` | Ranking sizes (no approval) | 10 / 50 | Demo |
| `ai.query.nearBreachPct` | Near-breach band for limit questions | 90 % | Demo |
| `ai.schedule.cadences` | Offered cadences | Daily, Weekly, Monthly | Demo |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `ai.output.sign-off` | Sign off / reject in AI activity | No steps (accountable person's decision final; tenant may add a checker) | PRD §6.12; AI1 (§6.12 second person) |
| `ai.schedule.create` | Save query as schedule | Data-distribution approval · Head of Risk / CRO · 24 h | Assumption |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `ai.schedule-subscribed` | Scheduled report approved | Recipients whose email matches a platform user |

## 7. Events and hook points
| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `ai.query.answered` / `ai.query.refused` / `ai.query.unmatched` | After each query | `{ intent, scope, touched }` |
| event | `ai.output.signed-off` / `ai.output.rejected` | Sign-off applied | `{ activityId, text, module }` |
| event | `ai.schedule.created` / `ai.schedule.removed` | Schedule approved / removed | `{ cadence, recipients }` |
| hook (before) | `ai.query.before` | Before a question is resolved | Can veto (built-in `ai.scope-guard`) / rewrite |
| hook (after) | `ai.query.after` | After answer/refusal logged | Observe |
| hook (before) | `ai.output.sign-off.before` | Before sign-off submitted | Can veto / enrich |
| hook (after) | `ai.output.sign-off.after` | After submission | Observe |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| NL→structured-query service | out/in | Each question | Question → query + chart spec | Simulated (`intents.ts`, TD-905) |
| AI output registry (per-module `*.ai-output.created`) | in | Module drafts/flags | AI outputs | Simulated feed (TD-906) |
| Report scheduler / email | out | Cadence | Scheduled answers | Not built |

## 9. Non-functional
- Audit: every query (answered / refused / unmatched), schedule request/removal and sign-off is audited.
- Data scope: hook veto plus resolver check (defence in depth); platform scope never sees customer-identifiable financial data.
- Explainability: answers show sources, data touched and model version (PRD §10.3).
- AI labelling: outputs always labelled AI-drafted / AI-flagged.

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| AI1 (§6.13) | Does "System Admin/Support Team" include IT Support? | Yes — platform scope |
| AI2 | What is "platform-health and configuration" data? | Users, audit, connectors intents |
| AI1 (§6.12) | Does AI sign-off need a second person? | No; accountable person's decision final |

Note: OPEN-QUESTIONS.md uses the ID `AI1` twice (§6.13 and §6.12) — needs renumbering.
