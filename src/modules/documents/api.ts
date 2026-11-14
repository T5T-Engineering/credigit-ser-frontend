"use client";

/**
 * Platform document service (backend ADR-0021, `/api/v1/documents`). Every call is checked by the backend against the permission and the
 * owning module's subject policy; deletion and purge are Operations requests. Backend only.
 */
import type { DocumentItem, DocumentStatus as ItemStatus, DocumentTag } from "@credigit/web-ui";
import { identityCall, identityDownload } from "@/lib/auth/backend-identity";
import { dateTime } from "@/lib/format";

export type DocumentStatus = "Active" | "Deleted" | "Purged";
export type ScanStatus = "NotScanned" | "Pending" | "Clean" | "Infected";
export type VerificationStatus = "NotRequired" | "Pending" | "Verified" | "Rejected";

export type Person = { id: string; name: string };
export type DocumentAction = { by: Person; at: string; reason: string; operationId?: string | null };

export type DocumentVersion = {
  number: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storeName: string;
  uploadedBy: Person;
  uploadedAt: string;
  scan: ScanStatus;
  scanDetail?: string | null;
  verification: VerificationStatus;
  reviewedBy?: Person | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  reviewNote?: string | null;
  extraction?: Record<string, string> | null;
  deleted: boolean;
  purged: boolean;
};

export type StoredDocument = {
  id: string;
  subjectType: string;
  subjectId: string;
  typeCode: string;
  title: string;
  status: DocumentStatus;
  legalHold: boolean;
  legalHoldBy?: DocumentAction | null;
  deletedBy?: DocumentAction | null;
  purgedBy?: DocumentAction | null;
  pendingOperationId?: string | null;
  retainUntil: string;
  versions: DocumentVersion[];
  createdBy: Person;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type DocumentAck = { documentId: string; version: number; scan: ScanStatus; verification: VerificationStatus };
export type RequestAck = { operationId?: string | null; applied: boolean };
export type ChecklistItem = { typeCode: string; typeLabel: string; present: boolean; verified: boolean; documentId?: string | null };
export type Checklist = { subjectType: string; subjectId: string; items: ChecklistItem[]; complete: boolean };
export type StoreStatus = { active: string; configured: string[]; healthy: boolean; detail?: string | null };

export type LibraryFilter = { type?: string; status?: DocumentStatus | ""; subjectType?: string; subjectId?: string; uploadedBy?: string; from?: string; to?: string; q?: string };

/** Operations types of the DMS (four-eyes; never applied directly). */
export const DOCUMENT_DELETE = "documents.document.delete";
export const RETENTION_PURGE = "documents.retention.purge";

const enc = encodeURIComponent;

const query = (f: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
};

export const documentsApi = {
  forSubject: (subjectType: string, subjectId: string) => identityCall<StoredDocument[]>(`/documents${query({ subjectType, subjectId })}`),
  get: (id: string) => identityCall<StoredDocument>(`/documents/${enc(id)}`),
  checklist: (subjectType: string, subjectId: string, required: string[]) =>
    identityCall<Checklist>(`/documents/checklist${query({ subjectType, subjectId, required: required.join(",") })}`),
  library: (f: LibraryFilter) => identityCall<StoredDocument[]>(`/documents/library${query(f)}`),
  exportLibrary: (f: LibraryFilter) => identityDownload(`/documents/library/export${query(f)}`, "document-library.csv"),
  retentionDue: () => identityCall<StoredDocument[]>("/documents/retention-due"),
  store: () => identityCall<StoreStatus>("/documents/store"),
  upload: (subjectType: string, subjectId: string, typeCode: string, title: string, file: File) => {
    const form = new FormData();
    form.set("subjectType", subjectType);
    form.set("subjectId", subjectId);
    form.set("typeCode", typeCode);
    form.set("title", title);
    form.set("file", file);
    return identityCall<DocumentAck>("/documents", { method: "POST", body: form });
  },
  addVersion: (id: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return identityCall<DocumentAck>(`/documents/${enc(id)}/versions`, { method: "POST", body: form });
  },
  download: (id: string, version: DocumentVersion) => identityDownload(`/documents/${enc(id)}/versions/${version.number}/content`, version.fileName),
  verify: (id: string, version: number, note: string) =>
    identityCall<DocumentAck>(`/documents/${enc(id)}/versions/${version}/verify`, { method: "POST", body: JSON.stringify({ note: note || null }) }),
  reject: (id: string, version: number, reason: string, note: string) =>
    identityCall<DocumentAck>(`/documents/${enc(id)}/versions/${version}/reject`, { method: "POST", body: JSON.stringify({ reason, note: note || null }) }),
  requestDelete: (id: string, version: number | null, reason: string) =>
    identityCall<RequestAck>(`/documents/${enc(id)}/delete-requests`, { method: "POST", body: JSON.stringify({ version, reason }) }),
  legalHold: (id: string, hold: boolean, reason: string) => identityCall<DocumentAck>(`/documents/${enc(id)}/legal-hold`, { method: "PUT", body: JSON.stringify({ hold, reason }) }),
  requestPurge: (documentIds: string[], reason: string) =>
    identityCall<RequestAck>("/documents/retention/purge-requests", { method: "POST", body: JSON.stringify({ documentIds, reason }) }),
};

/** Subject page link (backend `Documents:Links:SubjectPathTemplate`). */
export const subjectHref = (subjectType: string, subjectId: string) => `/documents${query({ subjectType, subjectId })}`;

/** Versions still held (not deleted / purged), latest last. */
export const liveVersions = (d: StoredDocument) => d.versions.filter((v) => !v.deleted && !v.purged);

/** The version shown for a document: the latest live one, else the latest. */
export const currentVersion = (d: StoredDocument): DocumentVersion | undefined => liveVersions(d).at(-1) ?? d.versions.at(-1);

/** Whether a version can be downloaded (quarantined, deleted and purged versions can't). */
export const downloadable = (v: DocumentVersion) => v.scan !== "Infected" && !v.deleted && !v.purged;

export function versionStatus(v: DocumentVersion): ItemStatus {
  if (v.scan === "Infected") return "quarantined";
  if (v.verification === "Pending") return "pending";
  if (v.verification === "Verified") return "verified";
  if (v.verification === "Rejected") return "rejected";
  return "uploaded";
}

/** Library `DocumentList` row for a stored document; `typeLabel` maps master-data codes to labels. */
export function documentView(d: StoredDocument, typeLabel: (code: string) => string, reasonLabel: (code: string) => string = (c) => c): DocumentItem {
  const v = currentVersion(d);
  const tags: DocumentTag[] = [];
  if (d.status === "Deleted") tags.push({ label: "Deleted", tone: "neutral" });
  if (d.status === "Purged") tags.push({ label: "Purged", tone: "neutral" });
  if (d.legalHold) tags.push({ label: "Legal hold", tone: "warning" });
  if (d.pendingOperationId) tags.push({ label: "Deletion requested", tone: "info" });
  const note =
    v?.scan === "Infected"
      ? (v.scanDetail ?? "Malware found — the file can't be downloaded.")
      : v?.verification === "Rejected"
        ? [reasonLabel(v.rejectionReason ?? ""), v.reviewNote].filter(Boolean).join(" — ")
        : undefined;
  return {
    id: d.id,
    name: d.title || v?.fileName || d.id,
    type: v?.contentType ?? v?.fileName,
    size: v?.sizeBytes,
    version: v ? `v${v.number}${d.versions.length > 1 ? ` of ${d.versions.length}` : ""}` : undefined,
    uploadedBy: v?.uploadedBy.name,
    uploadedAt: v ? dateTime(v.uploadedAt) : undefined,
    status: v ? versionStatus(v) : undefined,
    category: typeLabel(d.typeCode),
    note,
    tags,
  };
}
