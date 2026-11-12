# Connectors — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview
Static connector catalogue (`data.ts`) merged with persisted overrides and manual runs (`store.ts`, `credigit.ser.connectors`) into read models (`views.ts`: effective status, freshness vs rule SLA, schedule, running flag). `service.ts` holds the two commands: `runConnector` (hooks → audit → event → simulated run → audit → event/notification → after-hook) and `requestConfigChange` (hooks → Operations). The staging page renders fixed demo figures. BACKEND SEAM: runs become POSTs to the connector job API; overrides become tenant configuration.

## 2. Files and entry points
| Path | Role |
|---|---|
| `src/modules/connectors/platform.ts` | Rules, operation type, templates, events, hook points |
| `src/modules/connectors/service.ts` | `runConnector`, `requestConfigChange`, `applyConfigChange` |
| `src/modules/connectors/store.ts` | Persisted runs and overrides |
| `src/modules/connectors/views.ts` | `useConnectorViews`, `useAllRuns`, formatters |
| `src/modules/connectors/data.ts` | Connector catalogue, `freshnessRuleKey`, seed runs, `staging24h`, `projections` |
| `src/modules/connectors/pages/connectors-page.tsx` | Overview, Run now, configuration drawer |
| `src/modules/connectors/pages/runs-page.tsx` | Run history table (CSV export) |
| `src/modules/connectors/pages/staging-page.tsx` | Staging / reconciliation and projection lag |
| `src/app/(app)/connectors/**/page.tsx` | Thin route files |

## 3. Routes / endpoints / public API
| Route | Page | Menu entry |
|---|---|---|
| `/connectors` | `connectors-page.tsx` | Administration → Connectors → Overview |
| `/connectors/runs` | `runs-page.tsx` | → Recent runs |
| `/connectors/staging` | `staging-page.tsx` | → Staging & reconciliation |

## 4. Data model
| Store / type | Key fields |
|---|---|
| `Connector` (static) | id, name, purpose, method, schedule, status, lastSyncMin, latencyMs, records24h, errorRate trend, consumers, phase, defaultFreshnessSlaMin |
| `Run` | id, connectorId, startedAt, durationMs, records, status (Success / Partial / Failed), trigger, by, message |
| `overrides[id]` | lastRunAt, status, schedule, enabled |
| `staging24h`, `projections` | Received / discounted (by category) / quarantined / promoted; unreconciled ageing; engine lag |

## 5. Rule keys used
| Key | Where read |
|---|---|
| `connectors.<id>.freshnessSlaMinutes` | `data.ts` `freshnessSla` (via `views.ts`) |
| `connectors.freshness.warnRatio`, `connectors.errorRate.warnPct`, `connectors.errorRate.dangerPct` | `connectors-page.tsx` |
| `connectors.runHistoryLimit` | `store.ts` `addRun` |
| `connectors.scheduleOptions`, `connectors.retryPolicy` | `connectors-page.tsx` (config drawer) |

## 6. Permission keys enforced
| Key | Where checked |
|---|---|
| — (none) | `connectors-page.tsx` uses `useCan("connectors", "edit")` for Run now / Configure; nav filtered by module access. No catalogue key (`connectors.connectors.run`, `connectors.config.request-change`, `connectors.runs.export`…) is checked. |

## 7. Workflows, notifications, events, hooks wired
| Item (REQUIREMENTS §) | Code location |
|---|---|
| `connectors.config.change` (§5) | `service.requestConfigChange` → `platform.ts` apply → `service.applyConfigChange` |
| `connectors.run-failed` (§6) | `service.runConnector` (failed branch) |
| `connectors.config-changed` (§6) | `service.applyConfigChange` |
| Events (§7) | `service.runConnector`, `requestConfigChange`, `applyConfigChange` |
| Hooks (§7) | `connectors.run.before/after` in `runConnector`; `connectors.config.change.before` in `requestConfigChange`, `.after` in `applyConfigChange` |

## 8. Tests
| Test file / suite | Covers |
|---|---|
| — | No connectors-specific e2e spec; no unit tests (vitest configured, no `*.test.ts`) |

## 9. Requirements traceability
| FR id | Implemented in | Test | Status |
|---|---|---|---|
| CON-FR-01 | `data.connectors`, `connectors-page.tsx` | — | Done (static catalogue) |
| CON-FR-02 | `views.useConnectorViews`, `connectors-page.tsx` | — | Done (simulated metrics) |
| CON-FR-03 | `service.runConnector`, `runs-page.tsx` | — | Partial (simulated run, TD-601) |
| CON-FR-04 | `service.runConnector` notify | — | Partial (manual runs only; scheduled failures not modelled) |
| CON-FR-05 | `connectors.config.change` | — | Done |
| CON-FR-06 | `staging-page.tsx`, `data.staging24h` | — | Partial (display only, fixed demo figures) |
| CON-FR-07 | `staging-page.tsx`, `data.projections` | — | Partial (fixed demo figures) |
| CON-FR-08 | `runs-page.tsx` `exportFilename` | — | Done |

## 10. Gaps against the invariants
- Invariant 12: no catalogue permission keys checked; `useCan("connectors","edit")` module-level gate; export not gated.
- Invariant 9 (connector-ready): there is no Connectors framework other modules plug into — collateral (CSCS prices), credit-admin (CRMS) and origination (bureau) simulate their own calls; `docs/integration-points.md` does not exist.
- Invariant 9 (extensible / externally reachable): events are in-app only; no outbound webhook / inbound API seam documented.
- Invariant 9 (notified): no notification on run completion after a failure (recovery), on stale data past SLA, or on config request submission (approver reached only via Operations task).
- Invariant 8: schedule labels in the catalogue and default freshness SLAs live in `data.ts` (defaults for rules — acceptable); simulated run duration/outcomes (TD-601); downstream engine names in `projections` are literals.
- Staging/reconciliation metrics are static; no reconciliation actions (release quarantine, resolve unreconciled items).
- No tests at all for this module.

## 11. Tech debt
| TD id | Summary |
|---|---|
| TD-601 | `SIMULATED_RUN_MS` and random run outcomes are simulator constants |
| TD-502 | Simulated CBA suspense break in portfolio reconciliation (related staging data) |
