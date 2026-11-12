# Connectors — requirements

| | |
|---|---|
| Module | `src/modules/connectors` (nav module `connectors`, route `/connectors`) |
| Repo | credigit-ser-frontend |
| PRD | §5 (incl. §5.1–5.7), Engineering README §4.6 (logging, tracing, observability) |
| Owner (business) | System Admin; IT Support (platform operations) |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Show the health of every connector that feeds the Risk Data Spine through the staging / reconciliation layer (§5), let operators trigger manual runs, and change a connector's schedule or enable / pause it through the Operations workflow. Show the staging layer's reconciliation outcome and downstream read-model freshness.

In scope:
- Connector catalogue (CBA, two bureaux, CRMS, other-bank statements, OCR, sector, macro, CBN circulars, limit engine, SEC/CSCS, Treasury, HR/IT) with status, freshness, latency, error rate, consumers.
- Manual run, run history, failure notification.
- Configuration change (schedule, enable/pause) via Operations.
- Staging / reconciliation summary: discounted inter-branch, suspense, in-and-out and reversal entries; quarantine; unreconciled ageing; projection lag.

Out of scope:
- The connector implementations, credentials and provider endpoints (backend; PRD gives none).
- Module-specific connector use (bureau checks in origination, CRMS desk in credit-admin, CSCS prices in collateral).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| System Admin, IT Support | Run connectors, request configuration changes, approve configuration changes (Operations) | `connectors.overview.view`, `connectors.runs.view`, `connectors.staging.view`, `connectors.runs.export`, `connectors.connectors.run`, `connectors.config.request-change` |
| Credit Analyst, Middle Office, Portfolio MIS, CRO / Head of Risk | Read-only health, runs, staging | `connectors.overview.view`, `connectors.runs.view`, `connectors.staging.view`, `connectors.runs.export` |

## 3. Functional requirements
| ID | Requirement | Source |
|---|---|---|
| CON-FR-01 | List every connector feeding the spine with purpose, method, schedule, consumers and phase. | §5, §5.1–5.7 |
| CON-FR-02 | Show health: status, time since last sync vs freshness SLA, latency, error-rate trend. | §4.6; SLAs: assumption CON1 |
| CON-FR-03 | Trigger a manual run; record run (records, duration, status, message) and keep run history. | §4.6 — assumption |
| CON-FR-04 | Notify operators when a run fails, listing affected downstream consumers. | §4.6 — assumption |
| CON-FR-05 | Change a connector's schedule or enable / pause it only after approval. | Assumption CON1 (OPS) |
| CON-FR-06 | All connectors write to staging; staging discounts inter-branch, suspense, in-and-out and reversal entries before promoting to the spine. | §5, §5.1 |
| CON-FR-07 | Show downstream read-model / engine freshness (lag, events, stale state). | §5, §4.3, §4.6 |
| CON-FR-08 | Export run history. | §4.6 — assumption |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `connectors.<con-id>.freshnessSlaMinutes` | Freshness SLA per connector (one rule per catalogue entry, e.g. `connectors.con-cba.freshnessSlaMinutes`) | per connector (`defaultFreshnessSlaMin` in `data.ts`) | §5 / §4.6 — demo value, CON1 |
| `connectors.freshness.warnRatio` | Share of SLA elapsed that shows a warning | 0.75 | §4.6 — demo value |
| `connectors.errorRate.warnPct` | Error-rate warning | 1% | Demo value |
| `connectors.errorRate.dangerPct` | Error-rate alert | 5% | Demo value |
| `connectors.runHistoryLimit` | Manual runs kept | 100 | Demo value |
| `connectors.scheduleOptions` | Schedules a connector can be set to | 13 options | Demo value |
| `connectors.retryPolicy` | Retry policy text | "Automatic retry with back-off" | Demo value, CON1 |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `connectors.config.change` | "Configure" → submit schedule / enable change | Configuration approval · `system-admin` or `it-support` · 8 h | Assumption CON1 (OPS) |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `connectors.run-failed` | Manual run failed | IT Support, System Admin |
| `connectors.config-changed` | Configuration change approved and applied | IT Support, System Admin |

## 7. Events and hook points
| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `connectors.run.started` | Manual run triggered | trigger |
| event | `connectors.run.completed` | Run finished (success / partial) | runId, records, status |
| event | `connectors.run.failed` | Run failed | runId, message |
| event | `connectors.config.requested` | Configuration change submitted | operationId, schedule, enabled |
| event | `connectors.config.changed` | Configuration change applied | operationId, before, after |
| hook | `connectors.run.before` / `.after` | Around a manual run | before: veto (e.g. change freeze) |
| hook | `connectors.config.change.before` / `.after` | Around a configuration change | before: veto / enrich `next` |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| CBA (`CON-CBA`) | Inbound | Near-real-time / batch | Statements, balances, product/tenor codes | Simulated |
| Credit bureau A/B (`CON-BUR-A/B`) | Inbound | On demand (origination) | Credit history / score | Simulated |
| CBN CRMS (`CON-CRMS`) | In/outbound | On demand / batch | Searches, returns | Simulated |
| Other-bank statements (`CON-OBS`) | Inbound | On upload | Statements | Simulated (Phase 1 manual) |
| Document upload & OCR (`CON-OCR`) | Inbound | On upload | Financial statements | Simulated |
| Sector, macro, CBN circulars (`CON-SECTOR/MACRO/CBN`) | Inbound | Scheduled | Reference series, circulars | Simulated |
| Portfolio extraction & limit engine (`CON-LIMIT`) | Internal | Scheduled | Exposure aggregates | Simulated |
| SEC / CSCS (`CON-CSCS`) | Inbound | Daily close / upload | Prices, liens, corporate actions | Simulated (Phase 2) |
| Treasury / FX / MM (`CON-TRY`), HR / security / IT (`CON-HRIT`) | Inbound | Scheduled / event | Positions, rates; HR/IT events | Simulated |

## 9. Non-functional
- Audit: manual runs (trigger and outcome) and configuration requests / changes are audited with before/after.
- Observability (§4.6): freshness, latency, error rate and projection lag shown per connector.
- Security: no credentials or endpoints in the frontend (invariant 7); PRD names no providers.

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| CON1 (§5, §4.6) | Freshness SLAs, schedules and retry policies per connector; bureau providers | Demo values as rules |
| CON1 (OPS) | Who approves connector schedule / enable / pause changes | System Admin or IT Support (other than requester) |
