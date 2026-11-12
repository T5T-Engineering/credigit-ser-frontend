# AI analytics — implementation

| | |
|---|---|
| Status | Prototype (demo data; simulated rules-based resolver) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
`AiFrame` resolves the console scope from rules (`consoleScopeFor`) and shows a restriction for other roles. A question runs `ai.query.before` hooks (scope guard), then `answerQuery()` (keyword intent detection over the spine → chart spec + narrative), is stored in `useAi` history, audited and published, then `ai.query.after`. AI activity is a derived feed (`activity.ts`) built from other modules' data; sign-off goes through Operations (`ai.output.sign-off`).

Layering: `pages/ai-console-page.tsx` → `intents.ts` (resolver) / `activity.ts` (feed) → `platform.ts` (rules, operations, hooks) → `store.ts` (`credigit.ser.ai`). Cross-module reads: operational-risk store/shared helpers, enterprise-risk store/keys, spine hooks.

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/modules/ai/platform.ts` | Rules, `ai.output.sign-off` / `ai.schedule.create` operations, template, events, hook points, `ai.scope-guard` hook, `submitAiSignOff` |
| `src/modules/ai/intents.ts` | Suggested questions, data dictionary, `detectIntent`, `answerQuery` (14 intents incl. attrition, top, npl, pastdue, concentration, kri, losses, stage, appetite, collateral, users, audit, connectors) |
| `src/modules/ai/activity.ts` | `useAiActivity` cross-module AI output feed |
| `src/modules/ai/store.ts` | Query history, saved queries, sign-offs (`credigit.ser.ai`) |
| `src/modules/ai/pages/ai-console-page.tsx` | `AiConsolePage`, `AiActivityPage`, `AiLogPage` |
| `src/app/(app)/ai/**/page.tsx` | Route files |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/ai` (`?ask=<question>` deep link) | `AiConsolePage` | Workspace → AI analytics → Query console |
| `/ai/activity` | `AiActivityPage` | → AI activity |
| `/ai/log` | `AiLogPage` | → Query log & schedules |

Exported: `AI` module key, `aiKeys`, `consoleScopeFor`, `PLATFORM_INTENTS`, `submitAiSignOff`.

## 4. Data model
| Entity / store | Key fields |
|---|---|
| `QueryRecord` | id, question, askedAt, askedBy, askedById, roleId, intent, status (answered / refused / unknown), reason |
| `SavedQuery` | id, question, cadence, createdBy, createdAt, recipients |
| `SignOff` (by activity id) | status (Signed off / Rejected), by, at |
| `AiActivity` (derived) | id, kind, capability, module, href, item, entity, generatedAt, model, confidence, accountable, phase, status |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `ai.console.fullScopeRoles`, `ai.console.platformScopeRoles` | `platform.ts` `consoleScopeFor`; `AiFrame` |
| `ai.console.modelVersion` | console answers, audit text, `intents.ts` |
| `ai.model.trendAnalyser`, `ai.model.narrative` | `activity.ts` |
| `ai.queryLog.maxEntries` | `store.ts` `addQuery` |
| `ai.conversation.maxExchanges` | console conversation |
| `ai.query.minQuestionLength`, `ai.query.defaultTopN`, `ai.query.maxTopN`, `ai.query.nearBreachPct` | `intents.ts` |
| `ai.schedule.cadences` | schedule dialog |
| Enterprise-risk keys (`ermKeys`) | `activity.ts` (limit flag text) |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| — (none) | Nav/route access by `useCan("ai-console")` role map; console scope by role-list rules; sign-off button shown only when `actor.roleId === activity.accountable` (role-name check). |

## 7. Workflows, notifications, events, hooks wired
| Item | Code location |
|---|---|
| `ai.output.sign-off` | registered `platform.ts`; `submitAiSignOff` called from `ActivityTab` |
| `ai.schedule.create` | registered `platform.ts`; submitted in schedule dialog (`ai-console-page.tsx`) |
| `ai.schedule-subscribed` | `notify` in `ai.schedule.create` apply |
| Query events, `ai.schedule.removed` | `publish` in `ai-console-page.tsx` |
| `ai.output.*` events, `ai.schedule.created` | `publish` in operation `apply` |
| `ai.query.before/after` | `Console.runQuery`; built-in `ai.scope-guard` (priority 10) |
| `ai.output.sign-off.before/after` | `submitAiSignOff` |
| Audit | `logAudit` (operational-risk shared helper) for queries, schedules, sign-offs |

## 8. Tests
| Test file / suite | Covers |
|---|---|
| `e2e/risk/ai-console.spec.ts` | CRO query → chart, table, logged & audited; role without access sees restriction; IT Support refused customer-data question |
| `e2e/platform/rbac.spec.ts` | Account Officer has no AI console; IT Support platform scope only |
| Unit tests | None (no tests for `detectIntent` / `answerQuery`) |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status |
|---|---|---|---|
| AI-FR-01 | `consoleScopeFor`, `AiFrame` | ai-console.spec, rbac.spec | Done |
| AI-FR-02 | `intents.ts` | ai-console.spec | Partial (simulated keyword resolver, TD-905) |
| AI-FR-03 | `ChartView`, answer card | ai-console.spec | Done |
| AI-FR-04 | `ai.scope-guard` + resolver | ai-console.spec | Done |
| AI-FR-05 | `runQuery` audit + query log | ai-console.spec | Done (log only in browser store) |
| AI-FR-06 | schedule dialog, `ai.schedule.create` | — | Partial (saved only) |
| AI-FR-07 | `attrition` intent | — | Done |
| AI-FR-08 | `activity.ts` | — | Partial (demo feed, TD-906) |
| AI-FR-09 | `ai.output.sign-off` | — | Partial (sign-off recorded; not propagated to owning module's workflow) |
| AI-FR-10 | `ai.schedule.create` step | — | Done (assumption) |
| AI-FR-11 | — | — | Missing |

## 10. Gaps against the invariants
- Inv. 12: no `ai.*` permission keys checked; sign-off gated by role-name equality with `accountable` (explicitly disallowed); schedule removal has no gate.
- Inv. 9 (workflow / audit): removing a schedule is direct (audited + published, but no Operations step and any console user can remove any schedule).
- Inv. 9 (user-scoped): query log shows only the actor's queries, but saved schedules are global; activity "mine" by role, not by user.
- Inv. 9 (notified): no notification when an AI output is signed off / rejected, nor to the accountable role when a new AI output is pending.
- Inv. 9 (connector-ready): NL service, AI output registry and report delivery not recorded in `docs/integration-points.md` (file doesn't exist).
- Inv. 8: intent keywords / sector aliases are a code map (TD-905); `PLATFORM_INTENTS` list is code; schedule approver roles and 24 h SLA are literals.
- Coupling: AI imports `logAudit` / `useRuleValues` from `operational-risk/shared` instead of a platform helper.
- Scheduled reports never execute (no scheduler).

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-905 | NL intent keywords and sector aliases are a code map |
| TD-906 | Cross-module AI outputs are a demo feed assembled in the AI module |
