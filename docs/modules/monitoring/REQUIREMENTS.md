# Loan review & monitoring — requirements

| | |
|---|---|
| Module | `src/modules/monitoring` (nav module `monitoring`, route `/monitoring`) |
| Repo | credigit-ser-frontend |
| PRD | §6.4.1, §6.4.2, §6.4.3, §6.4.4, §6.4.5; §6.7.1 (CBN ladder / IFRS 9 stage mapping); §5.1 (CBA connector) |
| Owner (business) | Loan Review Officer (PRD §4.1); escalation ladder: Account Officer, Group Head / BDM, Credit Administration Officer, CCO, Head of Risk, CRO, Board Risk Committee |
| Counterpart | none yet |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope

Post-disbursement monitoring of the loan book: past-due obligations on the CBN days-past-due ladder, APGs and temporary overdrafts, covenant compliance and Nature-of-Business account-inflow tracking, periodic financial analysis, and one tenant-configurable exception escalation protocol that keeps every exception open until it is cured and evidenced.

In scope:
- Past-due register (value / count by obligor, product, sector, portfolio) with CBN classification and provision %.
- APG (issuance, crystallisation, expiry, call, release) and TOD (grant, regularisation window, CBN 12.10 non-performing rule) registers.
- Covenant register, covenant tests with evidence, account-inflow envelope per Nature-of-Business profile, periodic financials, external agents' fees.
- Exception board, four-level escalation ladder, SLA sweep, manual escalation, evidence-based closure.

Out of scope (owned elsewhere):
- Collateral perfection / revaluation / share margin monitoring (§6.4.2 third bullet) — `collateral` module; it raises exceptions into this protocol.
- KRI breaches (§6.9.1) — `operational-risk` module (own escalation, see OR2).
- IFRS 9 staging and ECL — `ifrs9` module (consumes the DPD ladder).

## 2. Users and permissions

| Role | What they do here | Permission keys |
|---|---|---|
| Loan Review Officer | Owns the module: assigns officers, notes, raises / reviews / comments exceptions, records covenant tests and periodic financials, signs off AI inflow flags, runs the escalation sweep, requests resolution / escalation / APG release | `monitoring.past-due.view`, `monitoring.covenants.view`, `monitoring.guarantees.view`, `monitoring.exceptions.view`, `monitoring.escalation.view`, `monitoring.registers.export`, `monitoring.facilities.assign`, `monitoring.facility-notes.create`, `monitoring.exceptions.create`, `monitoring.exceptions.review`, `monitoring.exceptions.comment`, `monitoring.exceptions.escalate`, `monitoring.exceptions.resolve`, `monitoring.escalation-sweep.run`, `monitoring.covenant-tests.create`, `monitoring.periodic-financials.update`, `monitoring.ai-flags.sign-off`, `monitoring.guarantees.update`, `monitoring.guarantees.request-release` |
| Credit Analyst, CAD, Portfolio MIS, Group Head, Directorate Head, CCO, CRO, Head of Risk, MD | View registers and exceptions (view access) | `monitoring.*.view`, `monitoring.registers.export` |
| Head of Risk / CCO | Approve resolution sign-off and manual escalation (Operations step) | `operations.items.decide` |
| CCO / Credit Admin Officer | Approve guarantee release (Operations step) | `operations.items.decide` |
| Escalation ladder roles | Receive Level 1–4 notifications | `notifications.inbox.view` |
| System Admin | Holds every permission by default (invariant 12) | all |

## 3. Functional requirements

| ID | Requirement | Source |
|---|---|---|
| MON-FR-01 | Track past-due obligations by value and number at obligor, product, sector and portfolio level, refreshed daily from the CBA connector. | §6.4.1 |
| MON-FR-02 | Apply the CBN DPD ladder (Performing → Watchlist 30–89 → Sub-Standard 90–179 → Doubtful 180–359 → Lost 360+) with IFRS 9 stage mapping and CBN provision %. | §6.4.1, §6.7.1; Watchlist bucket: Assumption MON6 |
| MON-FR-03 | Assign a monitoring officer to a facility and keep monitoring notes. | Assumption (supports §6.4.4 "named officer tagged to that obligor") |
| MON-FR-04 | APG register: issuance, crystallisation when the advance payment is received, expiry warning, call; release of the contingent exposure needs approval. | §6.4.2; Assumptions MON5 (§6.4.2), MON3 (§6.4.2) |
| MON-FR-05 | TOD register: grant, regularisation deadline, conversion to facility; unregularised excess / matured / undocumented facilities become non-performing after 90 days. | §6.4.2 (CBN 12.10); window: Assumption MON5 |
| MON-FR-06 | Every special covenant tagged at origination becomes a compliance item with due date, evidence requirement and owner; record test results with evidence; a failed test raises a covenant-breach exception. | §6.4.3 |
| MON-FR-07 | Nature-of-Business profile drives the expected inflow pattern; reconcile CBA credit turnover net of inter-branch / suspense / in-and-out / reversal entries; off-season silence of a seasonal obligor is not an exception. | §6.4.3, §5.1; profile source: Assumption MON4 (§6.4.3) |
| MON-FR-08 | AI rolling expected-inflow envelope per obligor; deviation is AI-flagged and needs human sign-off before exceptions are raised. | §6.4.3, §6.12; envelope: Assumption MON3 (§6.4.3) |
| MON-FR-09 | Record and reconcile external agents' fees (valuers, solicitors). | §6.4.3 |
| MON-FR-10 | Post-disbursement periodic analysis: periodic financials are due on a cycle; overdue submissions raise exceptions. | §6.4.5 |
| MON-FR-11 | Single escalation protocol for every exception type: Level 1 on detection, escalate one level per lapsed SLA, Level 4 re-timestamped and re-notified until cured; Board Risk Committee added above a materiality threshold. | §6.4.4; SLAs / materiality: Assumptions MON1 (§6.4.4), MON4 (§6.4.4) |
| MON-FR-12 | Close an exception only with time-stamped curing evidence; no evidence-less close for regulatory-relevant types (past-due, covenant breach, limit breach). | §6.4.4; Assumption MON2 (§6.4.4) |
| MON-FR-13 | Alerts fire to the in-app dashboard and by email to the named officers for the obligor, never only to a generic list. | §6.4.4 |
| MON-FR-14 | Retain the full escalation history (who notified, when, cured, by whom); feed the exception-ageing report. | §6.4.4 |
| MON-FR-15 | Exceptions whose root cause is control failure feed the Operational Risk loss-event register. | §6.4.4, §6.9 |
| MON-FR-16 | Manual (out-of-cycle) escalation and resolution sign-off route through Operations; the SLA sweep escalates without approval. | Assumptions MON1, MON2 (Operations, §6.4.4) |

## 4. Business rules and parameters

| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `monitoring.dpd.watchlistFromDays` | DPD at which Watchlist / Stage 2 starts | 30 days | PRD §6.4.1, §6.7.1 |
| `monitoring.dpd.substandardFromDays` | DPD at which non-performing (Sub-Standard, Stage 3) starts | 90 days | PRD §6.4.1, §6.7.1 |
| `monitoring.dpd.doubtfulFromDays` | Doubtful from | 180 days | PRD §6.4.1, §6.7.1 |
| `monitoring.dpd.lostFromDays` | Lost from | 360 days | PRD §6.4.1, §6.7.1 |
| `monitoring.cbn.substandardProvisionPct` / `doubtfulProvisionPct` / `lostProvisionPct` | CBN specific provision per bucket | 10 / 50 / 100 % | PRD §6.7.1 |
| `monitoring.escalation.l1SlaBusinessDays` … `l4SlaBusinessDays` | Cure SLA per level (L4 = re-notify cadence) | 5 business days each | PRD §6.4.4 — demo value (MON1) |
| `monitoring.escalation.l1Roles` … `l4Roles` | Roles notified per level | L1 AO + LRO; L2 GH + BDM + CAD; L3 CCO + Head of Risk; L4 CRO | PRD §6.4.4 |
| `monitoring.escalation.boardRoles` | Extra Level 4 roles above materiality | Board | PRD §6.4.4 |
| `monitoring.escalation.boardMaterialityNgn` | Materiality threshold for Board notification | ₦1bn | PRD §6.4.4 — demo value (MON4) |
| `monitoring.exceptions.evidenceRequiredTypes` | Types that close only with evidence | Past-due obligation, Covenant breach, Limit near-breach | PRD §6.4.4 |
| `monitoring.exceptions.minEvidenceLength` / `minDetailLength` / `minReasonLength` | Minimum text lengths | 3 / 5 / 10 chars | Tenant parameter (demo) |
| `monitoring.inflow.envelopeBandPct` | Envelope half-width around expected inflow | 25 % | PRD §6.4.3 — demo (MON3) |
| `monitoring.inflow.offSeasonIndexBelow` | Seasonal index below which a seasonal obligor is off-season | 0.9 | PRD §6.4.3 — demo |
| `monitoring.nature.<sectorId>` (15 sectors) / `monitoring.nature.default` | Nature-of-Business profile per sector | per sector (MON4); default Steady / Regular | PRD §6.4.3 — demo |
| `monitoring.covenant.dueSoonDays` | Covenant "due" window | 30 days | Tenant parameter (demo) |
| `monitoring.periodic.nextDueDays` | Periodic financials cycle | 92 days | PRD §6.4.5 — demo |
| `monitoring.apg.expiryWarningDays` | APG expiry warning | 30 days | Tenant parameter (demo) |
| `monitoring.tod.regularisationDays` | TOD regularisation window | 30 days | Tenant parameter (demo, MON5) |
| `monitoring.tod.nonPerformingDays` | Unregularised TOD non-performing after | 90 days | PRD §6.4.2 (CBN 12.10) |
| `monitoring.assignment.roles` | Roles assignable as monitoring officer | Loan Review Officer, Account Officer | Tenant parameter (demo) |

## 5. Workflows (Operations)

| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `monitoring.exception.resolve` | Officer submits curing evidence to close an exception | 1 step "Resolution sign-off": any of Head of Risk, CCO · 24 h | §6.4.4; MON1 (Operations) |
| `monitoring.exception.escalate` | Manual escalation ahead of SLA | 1 step "Escalation sign-off": any of Head of Risk, CCO · 8 h | §6.4.4; MON2 (Operations) |
| `monitoring.apg.release` | Request to release a guarantee on expiry / discharge | 1 step "Credit release approval": any of CCO, Credit Admin Officer · 24 h | §6.4.2; MON3 (Operations) |
| — (no approval) | SLA-lapse escalation sweep | System protocol, audited | §6.4.4 |

## 6. Notifications

| Template id | When | Recipients |
|---|---|---|
| `monitoring.exception-raised` | Exception raised (Level 1) | `monitoring.escalation.l1Roles` (+ Board roles if material at L4) + assigned officer |
| `monitoring.exception-escalated` | Level change or Level 4 re-notification | Roles for the new level + assigned officer |
| `monitoring.exception-resolved` | Resolution approved | Roles of every level reached + assigned officer |
| `monitoring.covenant-breached` | Covenant test failed | Covenant owner role + Level 1 roles |
| `operations.approval-requested` / `operations.request-completed` | Operations submissions / decisions | Eligible approvers / requester (platform) |

## 7. Events and hook points

| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `monitoring.exception.raised` | Exception entered Level 1 | type, obligorId, facilityId, collateralId, amount, source |
| event | `monitoring.exception.escalated` | Level up / L4 re-notify | from, to, reason, automatic, operationId |
| event | `monitoring.exception.status-changed` | Raised ↔ Under review / re-opened | from, to |
| event | `monitoring.exception.resolution-requested` | Evidence submitted for sign-off | operationId, evidence |
| event | `monitoring.exception.resolved` | Closed as cured | evidence, level, operationId |
| event | `monitoring.exception.commented` | Comment added | length |
| event | `monitoring.escalation.swept` | Sweep ran | escalated, held |
| event | `monitoring.covenant.tested` | Covenant test / periodic financials recorded | status, result, evidence / kind, type |
| event | `monitoring.covenant.breached` | Covenant test failed | facilityId, obligorId, result |
| event | `monitoring.apg.status-changed` | APG crystallised / called | from, to |
| event | `monitoring.apg.released` | APG release applied | operationId |
| event | `monitoring.tod.status-changed` | TOD regularised / converted | from, to |
| event | `monitoring.facility.assigned` | Officer assigned | userId |
| event | `monitoring.facility.noted` | Note added | — |
| event | `monitoring.ai-flag.signed-off` | AI inflow flag accepted / dismissed | decision |
| hook | `monitoring.exception.raise.before` / `.after` | Around raising | before: veto (e.g. duplicate) or enrich input |
| hook | `monitoring.exception.escalate.before` / `.after` | Around escalation (sweep or approved manual) | before: veto holds the level |
| hook | `monitoring.exception.resolve.before` / `.after` | Before evidence submission / after cure applied | before: veto weak evidence, enrich evidence / note |
| hook | `monitoring.covenant.test.before` / `.after` | Around a covenant test | before: veto or enrich result |

## 8. Integration points

| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Core banking (CBA) | Inbound, daily batch | Daily refresh | DPD, outstanding, credit turnover with inter-branch / suspense / in-and-out / reversal exclusions, TOD / excess positions | Simulated (seed + `data.ts` generators) |
| Other-bank statements (consented) | Inbound | Inflow reconciliation | Credit turnover | Not built |
| NGX Sector Corpus (§6.2.8) | Inbound | Envelope seasonality | Sector seasonality | Simulated |
| Document store | Inbound | Covenant test / periodic financials | Evidence references | Text reference only |
| E-mail | Outbound | Every notification | Rendered HTML | Outbox only (demo — not sent) |
| Operational Risk loss-event register | Outbound (internal) | Control-failure exception | Exception history | Not built |

## 9. Non-functional

- Audit: every state change (raise, status, comment, escalate, sweep, request / apply resolution, covenant test, periodic financials, APG / TOD status, assignment, note, AI sign-off) writes to the immutable audit log with before / after.
- User scope: actions need `monitoring` edit access; approvals respect segregation of duties (requester can't decide); covenant register has a "my role" filter.
- History: exception history and comments are retained on the record (§6.4.4).
- Explainability: inflow tab shows the source and the exclusion arithmetic (PRD §2.1, §10.3).

## 10. Open questions

| ID | Question | Current assumption |
|---|---|---|
| MON1 (§6.4.4) | SLA per level / type and Board materiality | 5 business days per level; Level 4 CRO + Board |
| MON2 (§6.4.4) | Types closable without evidence | Evidence for every exception in the UI; rule lists the regulatory types |
| MON3 (§6.4.3) | Inflow envelope width / look-back | Turnover/12 × seasonality, ±25 %, 3-month window |
| MON4 (§6.4.3) | Nature-of-Business not on the obligor | Derived from sector rules `monitoring.nature.*` |
| MON5 (§6.4.2) | TOD window, APG crystallisation / expiry | 30-day window; crystallise on "advance received" |
| MON6 (§6.4.1) | Watchlist 30–89 bucket; Annexures 2–6 grids | Ladder from §6.7.1; specialised grids not applied |
| MON1 (Operations, §6.4.4) | Who signs off a cure | Head of Risk or CCO |
| MON2 (Operations, §6.4.4) | Manual escalation needs approval? | Yes — Head of Risk or CCO |
| MON3 (Operations, §6.4.2) | Who approves APG release | CCO or Credit Admin Officer |
| MON4 (Operations, §6.4.4) | Board materiality value | ₦1bn |
