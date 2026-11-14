# Master data — implementation

| | |
|---|---|
| Status | Built (backend API). Demo mode shows a "managed in the backend" notice |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-14 (feature/dms-master-data-ui) |

## 1. Design overview

A page composition over the backend API. `api.ts` wraps `/api/v1/master-data` with `identityCall` (backend token, or development
identity headers) and `identityDownload` (CSV). The page holds no copy of the lists: it reloads after a saved change. Operations,
audit, events, hooks and notifications all happen in the backend; the page shows the outcome (`SaveOutcomeModal`).

`useMasterDataValues(list)` (in `api.ts`) is the reader other screens use for pickers (e.g. document types and rejection reasons in
the Documents module).

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/app/(app)/admin/master-data/page.tsx` | Route `/admin/master-data?list=<code>` |
| `src/modules/master-data/api.ts` | DTO types, API calls, `useMasterDataLists`, `useMasterDataValues` |
| `src/modules/master-data/master-data-page.tsx` | List picker, values table, value drawer (attributes + history), change dialog, export |
| `src/lib/auth/backend-identity.ts` | `identityDownload` (file responses) |
| `src/lib/auth/backend-sso.ts` | `apiCall` leaves `Content-Type` to the browser for `FormData` bodies |
| `src/lib/nav.ts` | Admin → "Master data" tab (`master-data.values.manage-view`) |

## 3. Routes / endpoints

| Route | Backend calls | Permission |
|---|---|---|
| `/admin/master-data` | `GET /master-data/lists`, `GET /master-data/lists/{list}/values?includeRetired=true`, `GET …/values/{code}/history`, `GET …/export`, `POST …/changes` | `master-data.values.manage-view`; buttons: `master-data.values.request-change`, `master-data.lists.export` |

## 4. Data model

Backend DTOs (`MasterDataListDto`, `MasterDataValueDto`, `MasterDataHistoryDto`, `MasterDataChangeAck`) typed in `api.ts`. No local store.

## 5. Rule keys used

`operations.minCommentLength`.

## 6. Permission keys enforced (UI mirror; the backend enforces)

`master-data.values.manage-view`, `master-data.values.request-change`, `master-data.lists.export`.

## 7. Workflows, notifications, events, hooks

Backend `master-data.value.change`; `useAppliesOnSave(["master-data.value.change"])` picks the button label.

## 8. Tests

`npx tsc --noEmit`, `npm run lint`, screenshots. No unit tests in this repo yet (TD-955).

## 9. Tech debt

TD-955 (no unit tests). Screens that still read code lists from the demo spine (`useLookups()`) move to `useMasterDataValues` module
by module (TD-979).
