# Integration points — credigit-ser-frontend

Every integration connector point found in the frontend (invariant 9, "connector-ready"). For each: direction, timing, trigger, payload / contract, owning module and current frontend status. Sources: each module's `docs/modules/<module>/REQUIREMENTS.md` §8, the connector catalogue (`src/modules/connectors/data.ts` → `connectors`, 13 entries CON-CBA … CON-HRIT), and the `BACKEND SEAM` / simulator markers in code.

**State of play.** The only real external integration in the frontend is **Microsoft Entra ID (MSAL.js)**. Everything else is simulated in the browser, exists only as a hook point / event, or is not built. There is no Connectors framework other modules plug into yet (TD-967): modules simulate their own calls. When a connector is built it must plug in through the Connectors framework (connector job API, freshness SLA rule `connectors.<id>.freshnessSlaMinutes`, run hooks `connectors.run.before/after`, events `connectors.run.*`), never as an ad-hoc call from a page.

Legend — **Dir**: In (into the app), Out (from the app), Both. **Timing**: RT (real time / on request), Batch, Event (reacts to a domain event / hook point).

## 1. Core banking (CBA) — CON-CBA, PRD §5.1

Catalogue: near-real-time API every 15 min, overnight batch fallback at 01:00; JSON (API) or fixed-width batch file.

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| Statement lines, balances, product / tenor codes | In | RT + Batch | Schedule | Statements, balances | connectors | Simulated catalogue entry `connectors/data.ts` `CON-CBA` |
| Facility master (outstanding, arrears, DPD, accrued interest, undrawn) | In | Batch (daily) | Spine refresh / ECL run | Facility book | credit-admin, ifrs9, portfolio | Seed data `src/lib/data/seed.ts` via `src/lib/data/store.ts` (BACKEND SEAM) |
| Statement credits for COP reconciliation | In | RT | Financials tab | Account credits | origination | Simulated `origination/data.ts` `reconciliation` |
| Verified turnover (COP) | In | Batch | Assessment refresh | Turnover | credit-analysis | Spine seed |
| Daily monitoring feed (DPD, outstanding, credit turnover net of inter-branch / suspense / in-and-out / reversals, TOD, excess) | In | Batch (daily) | Daily refresh | Per-facility positions | monitoring | Simulated `monitoring/data.ts` (`buildInflowProfiles`, `buildTods`, `buildCovenants`) |
| Repayments for cure / declassification | In | Batch (daily) | Declassification page | Repayments since staging | ifrs9 | Simulated `ifrs9/data.ts` `cureData` |
| Spine-to-ledger reconciliation | In | Batch (daily) | Spine refresh | Totals per product ledger, breaks | portfolio | Simulated `portfolio/data.ts` `reconciliation` (TD-502) |
| Disbursement posting | Out | RT | Checker authorises (`disbursement` operation `apply`; hook `disbursement.authorise.after`) | Account, amount, narration, value date → CBA reference | disbursement | Simulated reference `CBA/DSB/nnnnnn` in `disbursement/platform.ts` (TD-857) |
| Deposit / asset / FX sub-ledgers (deposits by source, maturity & repricing, liquid assets, top depositors) | In | Batch (daily) | Reporting date | Positions, ledgers | market-risk | Simulated `market-risk/data.ts` (`balanceSheet`, `fxPositions`, `fundingMix`, `topDepositors`, `LIQUID_ASSETS`; TD-126) |
| Transaction-processing logs (error / reversal rates) | In | Batch | KRI measurement | KRI observations | operational-risk | Simulated `operational-risk/data.ts` `kris` |
| Limit engine — CON-LIMIT, §5.6 (single-obligor / sector limit checks over the full book) | In (internal service) | RT + every 30 min | Pre-approval limit gate; limit monitoring | Exposure aggregates | origination, portfolio, connectors | Computed client-side from the spine; seam in `portfolio/hooks.ts` (server limit-monitoring job) |

## 2. Credit bureaus, CBN CRMS and other banks

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| Credit bureau A (JSON) / bureau B (XML) — CON-BUR-A/B, §5.2 | In | RT | "Pull bureau / CRMS" before approval (CBN 3.7(c)); hook `bureau.pull`, event `origination.bureau.pulled` | Credit history, score, per-institution facility lines | origination, connectors | Simulated `origination/data.ts` (`bureauReports`, `bureauAdverse`); UI `origination/application/financials-tab.tsx`, `pages/new-application-page.tsx` |
| CBN CRMS search — CON-CRMS (CBN 3.7(d)) | In | RT | CRMS desk search / origination pull; event `credit-admin.crms.result-received` | Obligor → facilities and outstanding elsewhere, reference | credit-admin, origination | Simulated `credit-admin/crms.ts` `simulateCrms`, latency in `pages/crms-desk-page.tsx` (TD-855) |
| CRMS facility reporting (returns) | Out | Batch | CRMS batch submit (Operations, `credit-admin/platform.ts`); event `credit-admin.crms.batch-submitted`, hook `credit-admin.crms.batch.after` | Facility list | credit-admin | Simulated — no data leaves the prototype |
| Other-bank lines for Share of Wallet | In | Batch | Assessment refresh | Other-bank exposure | credit-analysis | Simulated `credit-analysis/data.ts` `walletFor` (TD-122) |
| Other-bank statements — CON-OBS, §5.3 | In | Event (upload) | Statement upload | PDF → structured transactions / turnover | origination, monitoring, connectors | Simulated in `origination/data.ts`; catalogue "Manual (Phase 1)", Phase 2 open-banking aggregator; monitoring inflow reconciliation not built |

## 3. Market data, NGX, CSCS and SEC

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| SEC / CSCS registry — CON-CSCS, §5.7 | In | Batch (daily close, Phase 2) / upload (Phase 1) | Schedule / price refresh; event `collateral.prices.refreshed` | Share price (MTM), holding & lien confirmation, corporate actions, SEC status | collateral, connectors | Simulated `collateral/logic.ts` (`referencePrices`, `priceSeries`), `collateral/service.ts` `setSimulatedPrices`, `pages/shares-page.tsx` price shock (TD-601) |
| Share-collateral mark-to-market for the cockpit | In | RT | Executive cockpit load | MTM | executive | Simulated `executive/data.ts` `shareMarginStatus` (TD-507) |
| NGX historical sector financials corpus | In | Batch | Corpus refresh | Sector distributions, life-cycle stage | credit-analysis, monitoring | Simulated `credit-analysis/data.ts` (`ngxSectors`, `corpusMetrics`, `classifyLifeCycle`) |
| Market-data feed (§5.5): FX history, yield curves, price series | In | Batch (daily) | Daily | Rates, series | market-risk | Simulated `market-risk/data.ts` (`fxRates`, `VAR_TREND`, `INTERBANK_QUOTES`; TD-126) |
| USD/NGN spot for ECL | In | Batch | ECL run | Rate | ifrs9 | Business rule `ifrs9.usdNgnSpot` (demo value) |
| Sector / industry feed — CON-SECTOR, §5.5 | In | Batch (daily 06:00) | Schedule | Sector observations (CSV / JSON) | connectors (360 RAR industry axis, sector limits) | Catalogue entry only |
| Macro indicators — CON-MACRO, §5.5 (inflation, FX, GDP, MPR, CRR, crude, PMI, yields) | In | Batch (daily 07:00) | Schedule / scenario refresh | Series | credit-analysis, portfolio, ifrs9, market-risk | Simulated `credit-analysis/data.ts` `macroSnapshot`, `portfolio/data.ts` `macroVariables`; ifrs9 scenarios are rules |

## 4. GL, Finance and Treasury

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| GL capital accounts / RWA (Tier 1/2, deductions, RWA) | In | Batch | Reporting date / ICAAP | Capital figures | ifrs9, market-risk | Not built — calibration rules `ifrs9.capital.*` (TD-125) |
| Regulatory capital return (shareholders' funds, qualifying capital, cost of funds) | In | Batch | Period close | Values | portfolio, platform | Business rules (e.g. `platform.shareholdersFundsNgn`) with demo values |
| CBN 12.4 regulatory-reserve posting to Finance | Out | Event | Operations approval → event `ifrs9.reserve.posted`, hook `ifrs9.reserve.post.after` | Reserve-transfer entry | ifrs9 | Not built (event + hook only) |
| Treasury / FX / money market — CON-TRY (FIX / CSV, every 5 min in market hours) | In | RT + Batch | Schedule | Desk positions, VaR, MTM P&L, interbank quotes | market-risk | Simulated `market-risk/data.ts` (`desks`, `INTERBANK_QUOTES`; TD-126) |
| CAR, liquidity, LCR, NOP, VaR actuals for ERM and the cockpit | In (internal) | RT | Page load | Ratios | enterprise-risk, executive | Demo literals `enterprise-risk/data.ts`, `executive/data.ts` `demoFeeds` (TD-507) |

## 5. Regulatory (CBN circulars, returns, submissions)

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| CBN circulars feed — CON-CBN (PDF + metadata) | In | Batch (daily 08:00) | Schedule | Circular ref, title, area, impact → Rules review queue | enterprise-risk, connectors | Seeded `enterprise-risk/data.ts` `seedCirculars` |
| CBN returns / regulator portal | Out | Event | Report release; hook `portfolio.report.release.after` | Return files | portfolio | Not built; generation simulated (TD-506) |
| ILAAP submission to CBN | Out | Event | ILAAP approval | ILAAP document | market-risk | Not built; PDF export simulated (`pages/ilaap.tsx`) |
| BRC pack rendering / archive / distribution | Out | Event | Pack compiled / approved; hook `enterprise-risk.brc-pack.compile.after`, event `enterprise-risk.brc-pack.approved` | Rendered pack | enterprise-risk (single BRC pack flow) | Not built (TD-902); distribution simulated |

## 6. Identity (Entra ID, accounts, step-up)

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| Microsoft Entra ID SSO (MSAL.js) | In | RT | Sign-in when `/auth/config` mode = `MicrosoftEntra` | MSAL from `/auth/config` → `microsoftEntra` { authority, clientId, scopes, redirectPath, postLogoutRedirectPath } or env `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` / `_AUTHORITY` / `_SCOPES` / `_REDIRECT_URI`; API mode sends the Entra access token as Bearer and reads `/identity/me` | auth | **Built** `src/lib/auth/msal.ts`, `auth-config.ts`; tenant/client per environment = open question AUTH-OQ1 |
| Identity & Access API — auth (`GET /api/v1/auth/config`, `POST /auth/login`, `/otp/verify`, `/otp/resend`, `/token/refresh`, `/password/forgot`, `/password/reset`, `/register`, `/logout`, `/password/change`, `/step-up`, `/step-up/verify`) | Both | RT | Login page load, every auth action, token refresh (single-flight, `auth.tokenRefreshLeadSeconds` before expiry / on 401) | Contract `credigit-ser-core-backend/docs/api/identity-access.md` §2–3: Challenge, Verification, TokenPair, StepUpToken; RFC 9457 problems | auth | **Built** (API mode, `NEXT_PUBLIC_API_URL`) `src/lib/api/*`, `src/lib/iam/api.ts`, `src/lib/auth/service.ts`; demo mode = browser store `accounts.ts` (TD-968); no e2e against a backend (TD-970) |
| Identity & Access API — RBAC (`GET /identity/me`, `/identity/roles`, `/identity/users`, `/identity/access-requests`, `/identity/users/export`, `/identity/roles/export`; `POST /identity/roles/{id}/permission-changes`, `/identity/users/invitations`, `/users/{id}/role-changes`, `/deactivation`, `/reactivation`) | Both | RT | Sign-in (`/me` → permissions), admin screens, exports; commands answer 202 → Operations | Contract §4: CurrentUser, Role, User, CSV; `role.permissions-change`, `user.*` operations | auth, admin | **Built** (API mode) `src/modules/admin/iam-service.ts`, `permissions-page.tsx`, `users-page.tsx`; lock/unlock and MFA reset have no endpoint (TD-972, BE-31) |
| Permission catalogue sync | In | Build time | `node scripts/sync-permissions.mjs [backendConfigDir]` | Backend `config/permissions.json` + `config/roles.json` → `src/lib/iam/permission-catalogue.json`, `permission-keys.ts` | auth | **Built** (manual script; run when the backend catalogue changes) |
| Step-up provider (OTP / transaction PIN) | Out | RT | Approval above rule `approvals.stepUpThresholdNgn` | Challenge, verification | operations (platform), origination, disbursement | API mode built in `src/lib/auth/service.ts` (`startStepUp`, `verifyStepUp` → `/auth/step-up/verify`, step-up token in memory), not yet wired to decisions (TD-975); demo accepts any complete code (TD-858) — `operations/item-page.tsx`, `origination/application/approvals-tab.tsx`, `disbursement/pages/disbursement-page.tsx`; enforced in `src/lib/platform/operations.ts` `requiresStepUp` |

## 7. Notifications (e-mail / SMS)

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| Notification service (credigit-ser-notification-service via the backend) — e-mail, SMS, in-app | Out | Event | `notify()` from any module; event `platform.notification.sent` | Template id + variables → branded HTML e-mail per recipient; in-app text (role broadcast or personal) | operations (platform) | Simulated `src/lib/platform/notifications.ts` `notify` — outbox "Queued (demo — not sent)"; no SMS channel |
| One-time code delivery (register / sign-in / reset) | Out | RT | Auth flows | Code | auth | Simulated — code shown on screen (`accounts.ts`) |
| Scheduled AI report delivery | Out | Batch | Schedule cadence | Answers | ai | Not built (no scheduler) |

## 8. Documents (DMS, OCR, e-signature)

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| Document upload + OCR / financial-statement extraction — CON-OCR, §5.4 | In | Event (queue) | Upload | PDF / DOCX / image → fields + confidence | origination, connectors | Simulated `origination/data.ts` (`extractedFinancials`, `ratiosFrom`), `application/documents-tab.tsx` `useSimulatedOcr` |
| DMS / e-signature for issued offer letters | Out | Event | Hook `offer-letters.letter.issue.after` | Issued letter | offer-letters | Hook point only |
| Evidence store (covenant tests, periodic financials) | In | RT | Covenant test | Evidence references | monitoring | Text reference only |
| Board annual-plan upload | In | Event (upload) | Plan ingestion | Sector allocation | portfolio | Simulated parse `portfolio/pages/annual-plan-page.tsx` (TD-506) |

## 9. Operational-risk sources — CON-HRIT

Catalogue: daily CSV extract at 02:00 (bundle of HR, security and IT sources). Indicator sources in `operational-risk/data.ts` `indicatorCategories`, values in `kris`.

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| HRIS | In | Batch | KRI measurement | Headcount, attrition, vacancies | operational-risk | Simulated |
| Security / incident management | In | Batch | KRI measurement | Physical incidents, access violations | operational-risk | Simulated |
| IT / channel monitoring | In | Batch | KRI measurement | Downtime, failed transactions, batch failures | operational-risk | Simulated |
| SIEM / cyber tooling | In | Batch | KRI measurement | Intrusions, MTTD / MTTC, phishing | operational-risk | Simulated |
| CRM / complaints | In | Batch | KRI measurement | Volume, repeat rate | operational-risk | Simulated |
| Loss-event intake from other modules (credit-admin sanctions, ERM breaches, monitoring control failures) | In (internal) | Event | Sanction approved / breach / exception | Loss-event entry | operational-risk | Sanctions: simulated reference (TD-854); others not built |

## 10. Backend platform APIs

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| Operations / workflow API | Both | RT | `submitOperation`, `decideOperation`, `cancelOperation`, queues, definitions | Operation instances (incl. Failed status), definitions | operations | BACKEND SEAM — zustand store `src/lib/platform/operations.ts` |
| Rules & Parameters Engine API | Both | RT | `getRule` / `useRule`; approved `rule.change` | Rule values, history | operations | BACKEND SEAM — `src/lib/platform/rules.ts` |
| Event outbox → outbound webhooks / message publisher | Out | Event | `publish()` | `DomainEvent {name, module, subject, payload, actor, at}` | operations | Not built — in-browser bounded log `src/lib/platform/events.ts` (TD-963) |
| Hook points (before / after, veto / enrich) for external extensions | Both | RT | `runHooks()` | Hook context | all modules | In-browser only `src/lib/platform/hooks.ts` (TD-963) |
| Inbound action APIs for external systems | In | RT | — | — | operations | Not built (TD-963) |
| Audit log | Out | Event | Every state change | `AuditEvent` | all modules | Browser store `src/lib/data/store.ts` `log` (not immutable) |
| Risk Data Spine / domain data API | Both | RT | All reads and writes | Collections | all modules | BACKEND SEAM `src/lib/data/store.ts`; each module `store.ts` / `service.ts` / `actions.ts` marks its seam |
| Credit origination API (backend, ADR-0011) | Both | RT | Origination actions | Applications, analysis, approvals | origination | Not wired |
| Connector / job health API (§4.6) | In | RT | Connectors pages, manual run | Freshness, lag, run results | connectors | Simulated `connectors/data.ts` (`seedRuns`, `staging24h`, `projections`), `connectors/service.ts` `runConnector` (TD-601) |
| Tenant configuration API (brand, presets) | Both | RT | Load; approved `brand.change` | `BrandConfig`, presets | settings | BACKEND SEAM `settings/brand-store.ts` (TD-801) |
| Tasks / notifications API (incl. per-user read state) | Both | RT | Load; done / reopen; mark-read | Tasks, notifications | workspace, operations | BACKEND SEAM — shared spine store |

## 11. AI services (no external model is called)

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| NL → structured-query service | Both | RT | Console question | Question → query + chart spec | ai | Simulated `ai/intents.ts` (TD-905) |
| AI output registry (`*.ai-output.created`) | In | Event | Module drafts / flags | AI outputs | ai | Simulated feed `ai/activity.ts` (TD-906) |
| Drafting copilots / narrative engine | Both | RT | Page views | Drafted notes, narratives | credit-analysis, origination, offer-letters, executive, enterprise-risk, monitoring, portfolio, workspace, ifrs9 | Simulated, rule-based |

## 12. Other

| Integration point | Dir | Timing | Trigger | Payload / contract | Owning module | Frontend status |
|---|---|---|---|---|---|---|
| Projection engine (§6.6.7): sector NPL / roll rates | In | RT | Scenario run | Projections | portfolio, market-risk | Simulated `portfolio/data.ts` (TD-503) |
| Related-party links (directors, shareholders) | In | Batch | Insider register | Links | enterprise-risk | Simulated (ER2) |

Module-to-module reads over the shared spine (collateral → monitoring / ifrs9, origination → offer-letters → credit-admin → disbursement, op-risk → enterprise-risk) are in-app and involve no external system.

## Keeping this file current

Add a row whenever a feature introduces, simulates or retires an external call, and mirror it in the owning module's REQUIREMENTS.md §8. When a connector goes live through the Connectors framework, replace the "Frontend status" with the connector id and job API, and close the matching TD entry.
