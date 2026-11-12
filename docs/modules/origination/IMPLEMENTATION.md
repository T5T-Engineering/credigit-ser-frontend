# Loan origination — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

Client-only Next.js module. Pages compose `@credigit/web-ui` components; all state changes go through `actions.ts`, which wraps
each action in `origination.<action>.before/after` hooks, writes the audit log (`useDb().log`), publishes a domain event and sends
notifications. Approvals are Operations instances (`src/lib/platform/operations.ts`); a subscription mirrors each credit operation
back onto `Application.approvals` and `stage`. Shared entities (applications, obligors, collateral, documents) live in the Risk Data
Spine (`src/lib/data`); module-only state (COP explanation, memo, override, exception, comments, Fast-Track variant) lives in the
persisted store `credigit.ser.origination`. Connector outputs (OCR, statements, bureau / CRMS) are deterministic generators in
`data.ts` (backend seam).

```text
pages/* + application/*  →  actions.ts (hooks · audit · publish · notify)  →  useDb (spine) / useOriginationStore
                                   │ submitOperation()                         ▲
                                   ▼                                           │ origination.credit-approval-sync
                         Operations engine (credit.facility-approval.*, limit-exception, recommendation-override)
```

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/origination/platform.ts` | Rules, operation types, templates, events, hook points, built-in decide hook, sync subscription, seed credit operations |
| `src/lib/workflow.ts` | Chart-flow rules (`origination.chartFlow.*`, `origination.fastTrack.*`), `tiersFor`, `creditOperationType`, `approvalStepsFor`, `chainFromOperation` |
| `actions.ts` | All state-changing actions (create, submit, analysis, approval submit / decide, release, withdraw, limit gate, exception, recommendation, documents, comments, step-up marker, operation sync, seed) |
| `logic.ts` | SLA state, chain building, COP banding, limit gate, recommendation engine, covenant tagging, "my queue" predicate |
| `params.ts`, `use-params.ts`, `use-me.ts` | Rule readers, role-group mapping, rule-version subscription, current user |
| `data.ts` | Simulated OCR / reconciliation / bureau & CRMS generators; `useOriginationStore` |
| `view-models.ts`, `application/context.ts`, `application/memo.ts` | View models for timelines / record context; AI memo draft |
| `application/*-tab.tsx`, `next-step.tsx`, `operation-status.tsx` | Record tabs and next-step / pending-operation panels |
| `pages/pipeline-page.tsx`, `new-application-page.tsx`, `application-page.tsx`, `chart-flows-page.tsx` | Route pages |

## 3. Routes / endpoints / public API

| Route | Page | Menu entry |
|---|---|---|
| `/origination` (`?scope=mine`, `?scope=created`) | `OriginationPipelinePage` | Loan origination → Applications / My queue / My applications |
| `/origination/new` | `NewApplicationPage` | New application |
| `/origination/application?id=&tab=` | `ApplicationRecordPage` (tabs overview, financials, rar, documents, collateral, recommendation, approvals, comments, activity) | From pipeline / notifications |
| `/origination/chart-flows` | `ChartFlowsPage` | Approval chart-flows |

## 4. Data model

| Entity / store | Key fields |
|---|---|
| `Application` (spine, `src/lib/data/types.ts`) | id, obligorId, product, amount, tenorMonths, purpose, flow, requestType, stage (Draft → Documents → Analysis → Recommendation → Approval → Offer → Conditions → Disbursement → Booked / Declined / Withdrawn), createdById, slaDueAt, approvals[], documentIds, collateralIds, copRatio, recommendation, limitGate |
| `ApprovalStep` | tier, roleId, assigneeId, decision, pair, adjudicates |
| `ApplicationExtra` (`credigit.ser.origination`) | variant, copExplanation, memo, override, exception, comments, bureauRunAt |
| `OperationInstance` (Operations store) | payload `CreditPayload { applicationId, flow, amount }`, steps snapshot, decisions |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `origination.singleObligorPct`, `.largeExposurePct`, `.offBalanceWeightPct`, `.offBalanceProducts`, `platform.shareholdersFundsNgn` | `logic.ts` `limitGate`, `params.ts` |
| `origination.cop.*` | `logic.ts` `copBand`, `application/financials-tab.tsx` |
| `origination.engine.*`, `origination.override.minReasonLength` | `logic.ts` `runEngine`, `actions.ts` `adoptRecommendation` |
| `origination.sla.*` | `logic.ts` `slaState`, `params.ts`, `platform.ts` (exception / override step SLAs) |
| `origination.products`, `.fastTrack.variants`, `.defaultTenorMonths`, `.docs.*`, `.ocr.reviewBelowPct` | `params.ts`, wizard, documents tab |
| `origination.roles.*` | `params.ts` `rolesFor` / `inGroup` |
| `origination.haircut.*`, `origination.collateral.*` | `params.ts`, wizard collateral step |
| `origination.chartFlow.*`, `origination.fastTrack.*`, `rbac.limit.*` | `src/lib/workflow.ts` (`getChartFlow`, `getFastTrackTier`, `signOnLimit`) |
| `approvals.stepUpThresholdNgn` | `platform.ts` decide hook, `use-params.ts` |
| `origination.limitGate.warnUtilisationPct`, `origination.coverage.warnPct` | Recommendation / overview tabs |

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| None — the catalogue keys in REQUIREMENTS §2 are not referenced | Access uses `useCan("origination", "view" \| "edit")` (`application-page.tsx`, `new-application-page.tsx`, `application/context.ts`) plus role-group rules (`params.ts` `inGroup`) and literal role checks (see §10) |

## 7. Workflows, notifications, events, hooks wired

| Item (REQUIREMENTS §) | Code location |
|---|---|
| §5 credit types `.t1…t7`, `.fast-track` | `platform.ts` (`TIER_SLOTS.forEach` → `registerOperation`); type chosen by `creditOperationType` in `src/lib/workflow.ts`; submitted in `actions.ts` `submitForApproval` |
| §5 `origination.limit-exception` | `platform.ts`; `actions.ts` `requestLimitException` / `applyLimitException` |
| §5 `origination.recommendation-override` | `platform.ts`; `actions.ts` `adoptRecommendation` / `applyOverride` |
| §6 templates | `platform.ts` `defineTemplates`; sent from `actions.ts` (`notify`) |
| §7 events | `platform.ts` `defineEvents`; published in `actions.ts` (and via `recordChange` for bureau, COP, memo, covenants) |
| §7 hook points | `platform.ts` `defineHookPoints`; run via `guarded()` in `actions.ts` |
| §7 built-in hook / subscription | `platform.ts` `origination.credit-approval-controls`, `origination.credit-approval-sync` |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/credit/origination.spec.ts` | Account Officer creates and submits an application through every wizard step (mobile tag) |
| `e2e/credit/approval.spec.ts` | BDM recommends → co-signer dissent → CCO adjudicates → next tier, step-up and SoD |
| `e2e/credit/offer-letter.spec.ts` | Final approval → release to offer (handover) |
| `e2e/platform/rule-change.spec.ts`, `operations-config.spec.ts` | Rule / workflow changes via Operations (shared) |
| Unit tests | None (vitest configured, no test files) |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| ORG-FR-01 | `new-application-page.tsx`, `actions.ts` `createApplication` / `submitApplication` | origination.spec | Done |
| ORG-FR-02 | `submitApplication` notify BDM + Legal | origination.spec | Done |
| ORG-FR-03 | `documents-tab.tsx`, `uploadDocument`, `verifyDocuments`, `data.ts` OCR | — | Partial (OCR simulated) |
| ORG-FR-04 | `financials-tab.tsx`, `logic.ts` `copBand`, `data.ts` reconciliation | — | Partial (statements simulated) |
| ORG-FR-05 | `financials-tab.tsx`, `data.ts` `bureauReports` | — | Partial (simulated connector) |
| ORG-FR-06 | `rar-tab.tsx` | — | Done (read-only) |
| ORG-FR-07 | `logic.ts` `limitGate`, `recordLimitGate`, `requestLimitException`, decide hook | — | Partial (blocks approval, not submission — see §12) |
| ORG-FR-08 | `logic.ts` `runEngine`, `recommendation-tab.tsx`, override operation | — | Done (demo rules) |
| ORG-FR-09 | `logic.ts` `tagCovenants`, `covenants.tag` | — | Done |
| ORG-FR-10 | `src/lib/workflow.ts`, credit operation types | approval.spec | Done |
| ORG-FR-11 | `.fast-track` type, `getFastTrackTier` | — | Done (untested) |
| ORG-FR-12 | decide hook (BDM step) | — | Done |
| ORG-FR-13 | `onCreditReturned` | — | Done |
| ORG-FR-14 | decide hook + `markStepUp`; engine `requiresStepUp` | approval.spec | Partial (demo OTP, TD-858 pattern) |
| ORG-FR-15 | Operations `canDecide`, `allowRepeatApprover` | approval.spec | Done |
| ORG-FR-16 | `releaseToOffer` | offer-letter.spec | Done |
| ORG-FR-17 | `withdrawApplication` | — | Done |
| ORG-FR-18 | `pipeline-page.tsx`, `logic.ts` `slaState`, `inMyQueue` | — | Done |
| ORG-FR-19 | `chart-flows-page.tsx` | — | Done |
| ORG-FR-20 | `overview-tab.tsx`, `memo.ts`, `memo.sign-off` | — | Done (canned AI) |
| ORG-FR-21 | `discussion-tabs.tsx`, `addComment` | — | Done |
| ORG-FR-22 | `submitForApproval` gated to initiators | approval.spec | Done |

## 10. Gaps against the invariants

- Inv. 12: no named permission keys; gating is `useCan("origination", …)` + role-group rules; System Admin has no origination access by default.
- Inv. 8 / 12: literal role checks — `platform.ts` decide hook (`"bdm"`), `application/approvals-tab.tsx` (`"bdm"`), `logic.ts` `inMyQueue` (`"account-officer"`, `"credit-analyst"`); no TD id.
- Inv. 8: notification recipient roles are code lists in `actions.ts` (e.g. `["bdm", "legal-officer"]`, `["credit-analyst", "cro"]`); TD-604 covers only monitoring / collateral.
- Inv. 8: demo bureau / bank names in `data.ts` (`"CRC Credit Bureau"`, `"FirstCentral Credit Bureau"`, other-bank names) — demo data, no TD id; CON1 (§5) assumed generic labels.
- Inv. 9 user scope: "All applications" shows every application to any origination viewer; no branch / portfolio scoping.
- Inv. 9 connector-ready: CBA, other-bank, OCR and bureau / CRMS calls are in-module simulators, not the Connectors framework; no `docs/integration-points.md` in this repo.
- Inv. 9 notified: limit-exception and override requests rely only on the generic `operations.approval-requested`; no origination notification on `approval.withdrawn`.
- Inv. 9 workflow: limit breach does not block submission for approval (vetoed at decision time) — differs from PRD "blocks progression" reading and backend (BE-27).
- Duplication: covenant auto-tagging exists in both `logic.ts` `tagCovenants` and `offer-letters/store.ts` `autoTag`.
- Tests: no unit tests for `limitGate`, `runEngine`, `copBand`, `tiersFor`.

## 11. Tech debt

| TD id | Summary |
|---|---|
| TD-110 | Deprecated live `chartFlow` proxy in `src/lib/workflow.ts` |
| TD-111 | New-pledge haircuts are origination rules, duplicating collateral haircuts |
| TD-113 | One credit operation type per route length; steps generated from rules on read |
| TD-114 | Seed picks flow with ₦50m literal; seeded credit operations written directly to the store |
| TD-123 | COP bands duplicated with credit-analysis |
| TD-804 | Admin shows chart-flow read-only from the static chart-flow |
| TD-951 | No facility booked for prototype-created applications reaching Conditions |

## 12. Backend divergence

Backend counterpart: [`credigit-ser-core-backend/docs/modules/CreditOrigination/`](../../../../credigit-ser-core-backend/docs/modules/CreditOrigination/IMPLEMENTATION.md),
decision record [ADR-0011](../../../../credigit-ser-core-backend/docs/adr/0011-credit-origination-and-per-instance-routes.md).

| Topic | Frontend (this repo) | Backend | Reference |
|---|---|---|---|
| Credit approval type | Eight types `credit.facility-approval.t1…t7` / `.fast-track`; `defaultSteps` is a getter regenerated from chart-flow rules on every read. The engine now snapshots `instance.steps` at `submitOperation`, so new submissions keep their route; instances without a snapshot (older records) still fall back to the live definition | One type `credit.facility-approval` (`RouteFromSubmitter`), route planned by `ChartFlowRouter` and snapshotted per instance; route key `t1…t7` / `fast-track` + `legacyOperationType` keep `isCreditOp` matching | TD-113, ADR-0011 §1–3 |
| Limit breach | Submission allowed; `origination.credit-approval-controls` vetoes every *approve* decision until the exception is granted | Breach without a granted `origination.limit-exception` refuses submission for approval; refusal declines the request | BE-27 (`../../../../credigit-ser-core-backend/docs/decisions/open-questions.md`) |
| Exception / override SLAs | Rules `origination.sla.limitExceptionHours` / `.overrideHours` | Workflow definitions (tenant-editable via `workflow.change`) | Backend TD-025 |
| Lifecycle | Draft → Documents → Analysis → Recommendation → Approval → Offer … | Draft → Analysis → Approval → Approved / Declined; documents/OCR, due-diligence check and withdrawal not yet built | ADR-0011 §4, Consequences |
| Permissions | `useCan` module access | `origination.view/edit` from role module access (catalogue keys exist) | ADR-0011 §4, ADR-0012 |
