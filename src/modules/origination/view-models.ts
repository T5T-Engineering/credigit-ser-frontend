/** Mappers from domain records to @credigit/web-ui component shapes (no JSX). */
import type { ActivityItem, ApprovalParticipant, ApprovalTier, DocumentItem } from "@credigit/web-ui";
import type { ApprovalStep, AuditEvent, DocumentRecord, User } from "@/lib/data/types";
import { roleById } from "@/lib/rbac/roles";
import { chartFlow } from "@/lib/workflow";
import { dateTime, moneyShort } from "@/lib/format";

const docStatus: Record<DocumentRecord["status"], DocumentItem["status"]> = {
  Uploaded: "uploaded",
  "Processing OCR": "processing",
  Extracted: "extracted",
  Verified: "verified",
  Rejected: "rejected",
};

export function toDocumentItem(d: DocumentRecord, users: Map<string, User>): DocumentItem {
  return {
    id: d.id,
    name: d.name,
    size: d.sizeKb * 1024,
    version: `v${d.version}`,
    uploadedBy: users.get(d.uploadedById)?.name,
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
    target: `${e.entityType} ${e.entityId}`,
    timestamp: e.at,
    changes: e.before || e.after ? [{ field: "Value", before: e.before, after: e.after }] : undefined,
    ip: e.ip,
    device: e.device,
  };
}

/** Tier limit for a pair id (Standard from the tenant chart-flow; Fast-Track FT1 = BDM limit). */
export function pairLimit(pair: string | undefined, roleId: ApprovalStep["roleId"]): number | null {
  if (pair === "FT1") return roleById.bdm.limitNgn;
  const tier = chartFlow.find((t) => t.pair === pair) ?? chartFlow.find((t) => t.roles.includes(roleId) && t.roles.length === 1);
  return tier ? tier.limit : roleById[roleId].limitNgn;
}

function participant(s: ApprovalStep, users: User[]): ApprovalParticipant {
  const user = users.find((u) => u.id === s.assigneeId) ?? users.find((u) => u.roleId === s.roleId);
  return {
    id: s.id,
    name: user?.name ?? roleById[s.roleId].name,
    role: roleById[s.roleId].name,
    decision: s.decision,
    decidedAt: s.decidedAt ? dateTime(s.decidedAt) : undefined,
    comment: s.comment,
  };
}

/** Group a chain into ApprovalTimeline tiers: co-signer pairs side by side, adjudicator on the pair. */
export function toApprovalTiers(chain: ApprovalStep[], users: User[]): ApprovalTier[] {
  const tiers: ApprovalTier[] = [];
  for (const s of chain) {
    if (s.adjudicates) {
      const t = tiers.find((x) => x.id === s.adjudicates);
      if (t) t.adjudicator = participant(s, users);
      continue;
    }
    const key = s.pair ?? s.id;
    let t = tiers.find((x) => x.id === key);
    if (!t) {
      const limit = pairLimit(s.pair, s.roleId);
      t = {
        id: key,
        title: s.pair ? `Tier ${s.tier} — co-signers` : s.roleId === "bdm" ? `Tier ${s.tier} — recommendation` : `Tier ${s.tier} — ${roleById[s.roleId].name}`,
        role: s.pair ? undefined : roleById[s.roleId].name,
        limit: limit === null ? undefined : limit === Number.POSITIVE_INFINITY ? "Apex — no limit" : `Up to ${moneyShort(limit)}`,
        participants: [],
      };
      tiers.push(t);
    }
    t.participants.push(participant(s, users));
  }
  return tiers;
}
