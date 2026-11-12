# Offer letters — implementation

| | |
|---|---|
| Status | Prototype (demo data) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-12 (commit 0e09af1) |

## 1. Design overview

Client-only module. Letters, clauses and templates are seed data (`library.ts`, `template.ts`, `store.ts` seed generator) merged
with user changes persisted in the zustand store (`useOfferLetterStore`). Letters for applications at Offer / Conditions /
Disbursement / Booked are derived on read (`useOfferLetters`); a letter is stored once it is changed. `merge.ts` builds the merge
context and resolves `{{field}}` tokens; `letter-document.tsx` composes the merged letter from `@credigit/web-ui` parts. State
changes go through `actions.ts` (hooks → store → audit via `auditAs` from credit-admin → event → after-hook); approvals are
Operations types registered in `platform.ts`, whose `apply` functions issue the letter / apply the clause / approve the template,
and a subscription reverts records when a request is returned, rejected or withdrawn.

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/modules/offer-letters/platform.ts` | Rules, operation types + appliers, revert subscription, templates, events, hook points |
| `actions.ts` | `editLetter`, `commentOnLetter`, `submitForSignoff`, `recordAcceptance`, `submitClauseChange`, `saveTemplateDraft`, `submitTemplate` |
| `store.ts` | Types (`OfferLetter`, statuses), persisted store, seed letters, auto-generation, display status / lapse, auto-tagging, CP / covenant selectors |
| `merge.ts` | Merge context, merge-field resolution, facility terms, security lines, approved rate (TD-851), repayment wording (TD-852) |
| `library.ts` | Seed clause library (§7.1–7.3, special covenants), tag rules, merge-field catalogue |
| `template.ts` | House-template types and seed versions per product line |
| `letter-document.tsx` | Merged letter rendering (composition of library components) |
| `pages/offer-letters-page.tsx`, `offer-letter-page.tsx`, `house-template-page.tsx`, `clause-library-page.tsx` | Route pages |

## 3. Routes / endpoints / public API

| Route | Page | Menu entry |
|---|---|---|
| `/offer-letters` | `OfferLettersPage` (list + KPIs) | Offer letters → Offer letters |
| `/offer-letters/letter?id=` (or `?applicationId=` from origination release) | `OfferLetterPage` (tabs: Letter, Clauses, Conditions precedent, Covenants; pre-release checks; print) | From list / notifications |
| `/offer-letters/template` | `HouseTemplatePage` | House template |
| `/offer-letters/library` | `ClauseLibraryPage` | Conditions library |

## 4. Data model

| Entity / store | Key fields |
|---|---|
| `OfferLetter` | id (`OL-<app>`), applicationId, ref, templateId, templateVersion, clauseIds, clauseEdits, customClauses, validityDays, status (Draft · Legal review · Issued · Accepted; display "Expired"), legal sign-off / issue / acceptance fields, versions[], comments[] |
| `Clause` | id (e.g. `CP-02`), library (pre / post / general / special), category, title, text, proposedText, version, status (Legal-approved · Pending Legal approval · Retired), tag rule, history[] |
| `HouseTemplate` | id, name, productLine (All products · Contingent facilities), version, status (Approved · Draft · Pending Legal sign-off · Retired), sections (letterhead, text, facility-terms, security, clauses, signatures, acceptance), changeNote |
| Store `useOfferLetterStore` | `letters`, `clauses`, `templates` overrides keyed by id |

## 5. Rule keys used

| Key | Where read |
|---|---|
| `offer-letters.validityDaysDefault` | `store.ts` `newLetterFor`, `merge.ts` |
| `offer-letters.validityDaysMin` / `.validityDaysMax` | `offer-letter-page.tsx` validity editor |
| `offer-letters.noticeDays` | `merge.ts` |
| `offer-letters.referencePrefix` | `store.ts` `newLetterFor` |
| `offer-letters.minClauseTextLength` | `offer-letter-page.tsx`, `clause-library-page.tsx` |
| `offer-letters.insuranceWarningDays` | `offer-letter-page.tsx` `PreReleaseChecks` |
| `offer-letters.recentAcceptanceDays` | `offer-letters-page.tsx` |
| `offer-letters.contingentTemplateProducts` | `store.ts` `templateFor` |
| `offer-letters.unsecuredCollateralTypes` | `store.ts` `tagReason` |
| `offer-letters.signoffRequesterRoles`, `.legalEditorRoles`, `.acceptanceRecorderRoles` | `offer-letter-page.tsx` |
| `offer-letters.libraryEditorRoles` | `clause-library-page.tsx`, `house-template-page.tsx` |

## 6. Permission keys enforced

| Key | Where checked |
|---|---|
| None — the catalogue keys in REQUIREMENTS §2 are not referenced | `useCan("offer-letters", "view" \| "edit")` + role-list rules in `offer-letter-page.tsx`, `clause-library-page.tsx`, `house-template-page.tsx`; `actions.ts` does not re-check role or access |

## 7. Workflows, notifications, events, hooks wired

| Item (REQUIREMENTS §) | Code location |
|---|---|
| §5 `offer-letters.letter.signoff` | `platform.ts` (apply = issue / re-issue); submitted by `actions.ts` `submitForSignoff` |
| §5 `offer-letters.clause.change` | `platform.ts`; `actions.ts` `submitClauseChange` |
| §5 `offer-letters.template.approve` | `platform.ts`; `actions.ts` `submitTemplate` |
| §5 revert on returned / rejected / cancelled | `platform.ts` subscription `offer-letters.on-operation-closed` → `revert()` |
| §6 templates | `platform.ts` `defineTemplates`; `letter-issued` / `clause-approved` / `template-approved` from appliers, `acceptance-recorded` from `recordAcceptance` |
| §7 events | `platform.ts` `defineEvents`; published in `actions.ts` and appliers |
| §7 hook points | `platform.ts` `defineHookPoints`; run in `actions.ts` and the sign-off applier (`letter.issue.after`) |

## 8. Tests

| Test file / suite | Covers |
|---|---|
| `e2e/credit/offer-letter.spec.ts` | Final approval → release → Legal sign-off via Operations → issue → acceptance → Conditions (mobile tag) |
| Unit tests | None (vitest configured, no test files) |

## 9. Requirements traceability

| FR id | Implemented in | Test | Status |
|---|---|---|---|
| OL-FR-01 | `store.ts` `useOfferLetters` / `newLetterFor`, `templateFor` | offer-letter.spec | Partial — auto-generated letters use `seedClauses` / `seedTemplates`, not the approved overrides |
| OL-FR-02 | `store.ts` `autoTag` / `tagReason`, `library.ts` tag rules | — | Done (demo rules, OL4) |
| OL-FR-03 | `merge.ts`, `library.ts` `mergeFields` | — | Done |
| OL-FR-04 | `offer-letter-page.tsx` clauses tab, `editLetter` | — | Done |
| OL-FR-05 | `saveLetterVersion` / `editLetter` versions, `templateVersion` on letter | — | Done |
| OL-FR-06 | `offer-letters.letter.signoff` applier | offer-letter.spec | Done |
| OL-FR-07 | `store.ts` `displayStatus` / `expiresAt`, re-issue mode | — | Partial — lapse is display-only (no event / notification) |
| OL-FR-08 | `PreReleaseChecks` | — | Done |
| OL-FR-09 | `recordAcceptance` (CP-02 via credit-admin store) | offer-letter.spec | Done (TD-853) |
| OL-FR-10 | `house-template-page.tsx`, `template.approve` | — | Done |
| OL-FR-11 | `clause-library-page.tsx`, `clause.change` | — | Done |
| OL-FR-12 | `commentOnLetter` | — | Done |
| OL-FR-13 | `window.print()` + print layout | — | Done (not audited) |

## 10. Gaps against the invariants

- Inv. 12: no named permission keys; UI gating by `useCan` + role-list rules; `actions.ts` doesn't re-check, so any caller can act; System Admin has no offer-letters access (OL1).
- Inv. 9 audited / events: auto-generation of a letter (derived on read in `useOfferLetters`) is not audited, published or notified; print / export are not audited.
- Inv. 9 notified / events: letter lapse (`displayStatus` "Expired") has no event, notification or reminder before lapse.
- Inv. 9 notified: no module notification when a letter is sent to Legal or returned (only the generic Operations templates).
- PRD §7.0 fidelity: new letters merge into `seedTemplates` / `seedClauses` rather than the currently approved store versions.
- Inv. 8: notification recipient roles are code lists in `platform.ts` / `actions.ts`; workflow step SLAs (48 h / 72 h) are literals in `defaultSteps` (same pattern as TD-127, no TD id here); fixed `+01:00` offset (TD-859).
- Inv. 8: CP identified by literal `CP-02` (TD-853); repayment wording and demo rate in `merge.ts` (TD-852, TD-851).
- Coupling: acceptance writes directly into the credit-admin store (`useCreditAdminStore.setCp`) and reuses `auditAs` from credit-admin instead of an event / API boundary.
- Inv. 9 connector-ready: DMS / e-signature is recorded in [`docs/integration-points.md`](../../integration-points.md) (§8) — hook point only.
- Duplication: covenant tagging also exists in `origination/logic.ts` `tagCovenants`.

## 11. Tech debt

| TD id | Summary |
|---|---|
| TD-851 | Approved interest rate for letters without a booked facility is a demo value |
| TD-852 | Repayment wording per product is a code map |
| TD-853 | "Signed acceptance" CP identified by clause id `CP-02` |
| TD-859 | Date inputs converted with fixed `+01:00` offset |
| TD-951 | No facility booked for prototype-created applications reaching Conditions (affects post-acceptance flow) |
