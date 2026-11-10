/** View helpers shared by Credit Administration pages (mapping shared records onto library component shapes). */
import type { ActivityItem, DocumentItem, DocumentStatus as UiDocumentStatus } from "@credigit/web-ui";
import type { AuditEvent, DocumentRecord, User } from "@/lib/data/types";
import { dateTime } from "@/lib/format";
import { roleById } from "@/lib/rbac/roles";

const docStatus: Record<DocumentRecord["status"], UiDocumentStatus> = {
  Uploaded: "uploaded",
  "Processing OCR": "processing",
  Extracted: "extracted",
  Verified: "verified",
  Rejected: "rejected",
};

export function toDocumentItem(d: DocumentRecord, users: User[]): DocumentItem {
  return {
    id: d.id,
    name: d.name,
    size: d.sizeKb * 1024,
    version: `v${d.version}`,
    uploadedBy: users.find((u) => u.id === d.uploadedById)?.name,
    uploadedAt: dateTime(d.uploadedAt),
    status: docStatus[d.status],
    category: d.kind,
  };
}

export function toActivityItem(e: AuditEvent): ActivityItem {
  return {
    id: e.id,
    actor: { name: e.actorName, role: roleById[e.roleId]?.name },
    action: e.action,
    target: e.entityId !== "-" ? `${e.entityType} ${e.entityId}` : undefined,
    type: e.entityType,
    timestamp: e.at,
    changes: e.before || e.after ? [{ field: "Value", before: e.before, after: e.after }] : undefined,
    ip: e.ip,
    device: e.device,
  };
}

export const waiverStatusTones = {
  "Pending approval": "info",
  Approved: "success",
  Declined: "danger",
  Lapsed: "warning",
  "Routed to Operational Risk": "danger",
  Closed: "neutral",
} as const;

export const waiverKindTones = { Waiver: "info", Deferral: "brand", "Sanction for breach": "danger" } as const;
