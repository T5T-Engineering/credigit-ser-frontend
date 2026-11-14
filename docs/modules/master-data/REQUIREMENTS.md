# Master data — requirements

| | |
|---|---|
| Module | `src/modules/master-data` |
| Repo | credigit-ser-frontend |
| PRD | §10.4 (tenant configuration without a code release, second-person confirmation), §4 / §10.1 (audit), invariant 8 (code lists are configuration, not literals) |
| Owner (business) | System Admin (tenant configuration); list owners per module |
| Counterpart | [credigit-ser-core-backend `docs/modules/MasterData/`](../../../../credigit-ser-core-backend/docs/modules/MasterData/) (ADR-0021) |
| Last reviewed | 2026-11-14 |

## 1. Purpose and scope

Admin screen for the tenant's code lists (document types, rejection reasons, sectors, branches, product types, collateral types, KYC
lists, countries / states, banks, currencies …). The backend owns the lists, merges the shipped seeds with the tenant's changes and
routes every change through Operations `master-data.value.change`.

- In scope: browse lists and values (active and retired), see a value's attributes and history, request add / update / retire /
  reactivate with a reason, export a list as CSV, track the Operations request.
- Out of scope: declaring new lists or attribute schemas (backend configuration `config/master-data.json`), moving demo-mode screens
  that still use `useLookups()` onto master data (per module, later).
- Backend only: in demo mode (no `NEXT_PUBLIC_API_BASE_URL`) the page says the lists are managed in the backend.

## 2. Users and permissions

| Who | What | Permission keys |
|---|---|---|
| Every signed-in user | Read active values (used by pickers in other screens) | `master-data.lists.view` (baseline) |
| System Admin (default) | Open Admin → Master data, see retired values and history | `master-data.values.manage-view` |
| System Admin (default) | Request a change (add / update / retire / reactivate) | `master-data.values.request-change` |
| System Admin (default) | Export a list (CSV, audited) | `master-data.lists.export` |

Final approvers (`operations.requests.apply-directly`, ADR-0018) see "Save" instead of "Request change" when the tenant workflow lets
their own configuration requests apply directly; the request is still created, audited and notified.

## 3. Functional requirements

| ID | Requirement | Backend |
|---|---|---|
| MDUI-FR-01 | List picker with name, description, owning module, parent list, active / retired counts. | MD-FR-01 |
| MDUI-FR-02 | Values table: code (mono), label, description, sort order, parent, attributes, status; search; "show retired" toggle. | MD-FR-02, MD-FR-04, MD-FR-06 |
| MDUI-FR-03 | Add a value (only when the list allows tenant values): code, label, description, sort order, parent (from the parent list), attributes typed by the list schema (text, number, boolean, list); required attributes are required fields. | MD-FR-02, MD-FR-03 |
| MDUI-FR-04 | Edit label / description / sort order / parent / attributes; retire; reactivate. Every change asks for a reason (rule `operations.minCommentLength`). | MD-FR-03 |
| MDUI-FR-05 | The outcome is a popup: applied, or sent for approval with a link to the Operations request; backend refusals (validation, reference guard veto) are shown with the backend's reason. | MD-FR-03, MD-FR-07 |
| MDUI-FR-06 | Value history: action, who, when, reason, operation link, before → after. | MD-FR-05 |
| MDUI-FR-07 | Export the list as CSV through the backend (audited). | MD export |

## 4. Business rules

`operations.minCommentLength` (reason length, existing rule). Validation rules (code pattern, attribute types, required attributes,
parent exists) are enforced by the backend; the page mirrors the required fields only. No new frontend rule keys.

## 5. Workflows (Operations)

`master-data.value.change` (backend; step "Data owner review", final-approver eligible). The page reads the tenant's effective workflow
(`useAppliesOnSave`) to label the button "Save" or "Request change".

## 6. Notifications

Backend template `master-data.value-changed` to rule `master-data.changeNotifyRoles` + list notify roles. No frontend template.

## 7. Events and hook points

Backend: events `master-data.value.added|updated|retired|reactivated`, `master-data.list.changed`, `master-data.value.changed`; hooks
`master-data.value.change.before|after` (the reference guard is a built-in before-hook). The frontend publishes nothing of its own.

## 8. Integration points

None of its own (internal backend API `/api/v1/master-data`). See `docs/integration-points.md`.

## 9. Open questions

None new. Backend open questions apply.
