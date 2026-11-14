# Documents (DMS) — requirements

| | |
|---|---|
| Module | `src/modules/documents` |
| Repo | credigit-ser-frontend |
| PRD | §5.4 (document upload, OCR, version control — "never overwritten"), §4 / §10.1 (audit), upload points of §6.1 (origination), §6.5 (collateral); later §6.4, §6.9, §6.3, §7 (backend TD-046) |
| Owner (business) | Records management (library, retention, legal hold); owning modules for their subjects |
| Counterpart | [credigit-ser-core-backend `docs/modules/Documents/`](../../../../credigit-ser-core-backend/docs/modules/Documents/) (ADR-0021) |
| Last reviewed | 2026-11-14 |

## 1. Purpose and scope

Screens for the platform document service. The backend stores the files (Local / S3 store), checks every action against the
permission and the owning module's subject policy, and routes deletion and purge through Operations.

- In scope: documents of one subject (list, versions, upload, new version, download, verify / reject, delete request, legal hold,
  required-type checklist); the library (search, CSV export); documents past retention (purge request); store status.
- Reusable composition `SubjectDocuments` for record pages (origination application, collateral item, later monitoring / BCM /
  credit files / offer letters).
- Out of scope: OCR and malware scanning (backend connector points; DMS-1, DMS-2), editing extracted fields (connector API).
- Backend only: in demo mode the pages say documents are managed in the backend; the origination and collateral demo tabs keep their
  demo documents until those records come from the backend (TD-979).

## 2. Users and permissions

| Who | What | Permission keys |
|---|---|---|
| Every signed-in user | Open `/documents?subjectType&subjectId` and download, when the subject policy lets them see the subject | `documents.documents.view` (baseline) |
| Users the subject policy lets upload | Upload a document or a new version | `documents.documents.upload` (baseline) + the owning module's key (e.g. `origination.documents.upload`) |
| Credit admin (default) | Verify / reject a version (not their own upload when rule `documents.verify.segregation` is on) | `documents.documents.verify` |
| Credit admin (default) | Request deletion of a document or a version | `documents.documents.request-delete` |
| System Admin (default) | Place / lift a legal hold | `documents.documents.legal-hold` |
| System Admin (default) | Library search / CSV export | `documents.library.view`, `documents.library.export` |
| System Admin (default) | Documents past retention; request a purge | `documents.retention.request-purge` |
| System Admin (default) | Store status | `documents.store.view` |

## 3. Functional requirements

| ID | Requirement | Backend |
|---|---|---|
| DMSUI-FR-01 | Subject page: subject type + id from the query string (backend link template `/documents?subjectType=&subjectId=`); documents with type label, title, latest version (file, size, uploader, time), verification / scan status, legal hold and pending deletion tags. Without a subject, a form opens one. | DMS-FR-06 |
| DMSUI-FR-02 | Upload dialog: document type (active master data `document-type` values whose `modules` attribute names the subject type), title, file. The picker accepts the type's `acceptedTypes` and `maxSizeMb` (else rule `documents.maxUploadMb`); the backend re-checks size, extension and magic bytes. | DMS-FR-01, DMS-FR-03 |
| DMSUI-FR-03 | New version of a document (earlier versions kept); version history with every version downloadable unless quarantined, deleted or purged. | DMS-FR-02 |
| DMSUI-FR-04 | Download through the backend (audited there); quarantined versions show "Quarantined" and no download. | DMS-FR-04, DMS-FR-07 |
| DMSUI-FR-05 | Review dialog: verify with an optional note, or reject with a reason from master data `document-rejection-reason` and a note. Backend refusals (segregation of duties) are shown with the backend's reason. | DMS-FR-05 |
| DMSUI-FR-06 | Delete request for a document or one version with a reason (`operations.minCommentLength`); the outcome popup links the Operations request. Not offered while a request is pending or a legal hold is set. | DMS-FR-08 |
| DMSUI-FR-07 | Legal hold place / lift with a reason. | DMS-FR-08 |
| DMSUI-FR-08 | Checklist of required types for a subject when the caller passes them (owning module's rule). | DMS-FR-10 |
| DMSUI-FR-09 | Library: filters type, status, subject type, uploader, date range, text; results link to the subject page; CSV export through the backend. | DMS-FR-06 |
| DMSUI-FR-10 | Retention: documents past retention (not on hold); select some and request a purge with a reason. | DMS-FR-09 |
| DMSUI-FR-11 | Store: active store, configured stores, health. | DMS-FR-11 |

## 4. Business rules

`documents.maxUploadMb` (fallback file-size limit for the picker), `operations.minCommentLength`. Every other DMS rule
(`documents.verify.segregation`, `documents.retentionYearsDefault`, notify roles, subject roles) is applied by the backend.

## 5. Workflows (Operations)

`documents.document.delete`, `documents.retention.purge` (backend; four-eyes, not final-approver eligible).

## 6. Notifications

Backend templates `documents.document-uploaded`, `-verified`, `-rejected`, `-quarantined`, `documents.retention-due`. No frontend template.

## 7. Events and hook points

Backend `DocumentsEventCatalogue` (upload, version, verify / reject, quarantine, extraction, download, delete, hold, purge, retention
due) and hook points (upload / verify / download / delete before / after). The frontend publishes nothing of its own.

## 8. Integration points

Scanner and OCR connectors are backend connector points (backend `docs/integration-points.md`). The frontend's only call is the
internal API `/api/v1/documents` (multipart upload, file download).

## 9. Open questions

None new (backend DMS-1 … DMS-4).
