# Documents (DMS) — implementation

| | |
|---|---|
| Status | Built (backend API): subject page, library, retention, store, `SubjectDocuments` composition. Demo mode shows a "managed in the backend" notice. Origination / collateral tabs not switched yet (TD-979) |
| Requirements | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Last updated | 2026-11-14 (feature/dms-master-data-ui) |

## 1. Design overview

Page compositions over `/api/v1/documents`. `api.ts` wraps the endpoints with `identityCall` (JSON and the multipart upload — `apiCall`
leaves the multipart `Content-Type` to the browser for a `FormData` body) and `identityDownload` (file responses; the browser saves the
blob under the server's file name). Document types and rejection reasons come from master data (`useMasterDataValues`). Every action
reloads the subject's documents afterwards (the read model is projected from events). Audit, events, hooks, notifications and
Operations are backend side.

`SubjectDocuments({ subjectType, subjectId, required? })` renders the list (`DocumentList` with status, tags and `renderActions`), the
upload / new-version / review / delete / hold / versions dialogs, and the checklist (`ChecklistPanel`) when `required` is given.

## 2. Files and entry points

| Path | Role |
|---|---|
| `src/app/(app)/documents/page.tsx` | `/documents?subjectType&subjectId` |
| `src/app/(app)/documents/library/page.tsx` | `/documents/library` |
| `src/app/(app)/documents/retention/page.tsx` | `/documents/retention` |
| `src/app/(app)/documents/store/page.tsx` | `/documents/store` |
| `src/modules/documents/api.ts` | DTO types, API calls, view-model mapping (`documentView`) |
| `src/modules/documents/subject-documents.tsx` | `SubjectDocuments` composition and its dialogs |
| `src/modules/documents/pages/*.tsx` | Subject, library, retention, store pages |
| `src/modules/documents/platform.ts` | Rule `documents.maxUploadMb` (mirrors the backend default) |
| `src/lib/nav.ts` | Administration → "Documents" (subject page, Library, Retention, Store tabs); `navItemPermissions` also counts the item's page keys |
| `src/lib/rbac/roles.ts` | `ModuleKey` gains `documents` |

## 3. Routes / endpoints

| Route | Backend calls | Permission |
|---|---|---|
| `/documents` | `GET /documents?subjectType&subjectId`, `GET /documents/checklist`, `POST /documents`, `POST /documents/{id}/versions`, `GET …/versions/{n}/content`, `POST …/verify`, `POST …/reject`, `POST /documents/{id}/delete-requests`, `PUT /documents/{id}/legal-hold` | `documents.documents.view`; buttons per REQUIREMENTS §2 |
| `/documents/library` | `GET /documents/library`, `GET /documents/library/export` | `documents.library.view`, export `documents.library.export` |
| `/documents/retention` | `GET /documents/retention-due`, `POST /documents/retention/purge-requests` | `documents.retention.request-purge` |
| `/documents/store` | `GET /documents/store` | `documents.store.view` |

## 4. Data model

Backend DTOs (`DocumentDto`, `DocumentVersionDto`, `DocumentAck`, `DocumentRequestAck`, `ChecklistDto`, `DocumentStoreStatusDto`)
typed in `api.ts`. Status shown = latest live version: quarantined (scan Infected) → pending / verified / rejected (verification) →
uploaded (verification not required). Tags: legal hold, deletion pending (`pendingOperationId`), deleted / purged in the library.

## 5. Rule keys used

`documents.maxUploadMb`, `operations.minCommentLength`.

## 6. Permission keys enforced (UI mirror; the backend enforces, with the subject policy on top)

`documents.documents.view|upload|verify|request-delete|legal-hold`, `documents.library.view|export`,
`documents.retention.request-purge`, `documents.store.view`.

## 7. Workflows, notifications, events, hooks

Backend `documents.document.delete` / `documents.retention.purge`; outcome popups link `/operations/item?id=`.

## 8. Tests

`npx tsc --noEmit`, `npm run lint`, screenshots. No unit tests in this repo yet (TD-955).

## 9. Tech debt

TD-979: origination's application Documents tab and collateral's item documents still run on demo data; they switch to
`SubjectDocuments` (`Application` / `Collateral`) once those records come from the backend. Other screens move their code lists from
`useLookups()` to `useMasterDataValues`. TD-955 (no unit tests).
