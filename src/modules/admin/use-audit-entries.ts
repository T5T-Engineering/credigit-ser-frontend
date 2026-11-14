"use client";

import { useEffect, useMemo, useState } from "react";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { useAudit } from "@/lib/data/hooks";
import type { AuditEvent } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";

/** Most backend entries the page loads (paged under the backend's Audit:Query:MaxResults). */
const maxRows = Number(process.env.NEXT_PUBLIC_AUDIT_MAX_ROWS ?? 2000);

type BackendAuditEntry = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRoles: string[];
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: string | null;
  after?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  kind: string;
};

type BackendAuditPage = { total: number; skip: number; take: number; entries: BackendAuditEntry[] };

function device(ua?: string | null): string {
  if (!ua) return "—";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /curl/i.test(ua) ? "API client" : "Other OS";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Client";
  return `${os} · ${browser}`;
}

function toEvent(e: BackendAuditEntry): AuditEvent {
  return {
    id: e.id,
    at: e.at,
    actorId: e.actorId,
    actorName: e.actorName,
    roleId: (e.actorRoles[0] ?? "") as RoleId,
    action: e.kind === "http" ? `${e.action} (request)` : e.action,
    entityType: e.entityType,
    entityId: e.entityId || "-",
    before: e.before ?? undefined,
    after: e.after ?? undefined,
    ip: e.clientIp ?? "—",
    device: device(e.userAgent),
  };
}

/**
 * Audit entries for the admin audit log: the backend's immutable audit trail (sign-ins, approvals, configuration, data changes, API
 * requests — GET /api/v1/audit) merged with the app's own activity log, newest first. Without a backend, only the app log.
 */
export function useAuditEntries(): { entries: AuditEvent[]; loading: boolean; error: string | null; backendTotal: number | null } {
  const local = useAudit();
  const [remote, setRemote] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(backendSsoEnabled);
  const [error, setError] = useState<string | null>(null);
  const [backendTotal, setBackendTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let cancelled = false;
    (async () => {
      const all: AuditEvent[] = [];
      let total = 0;
      try {
        do {
          const page = await identityCall<BackendAuditPage>(`/audit?skip=${all.length}`);
          total = page.total;
          all.push(...page.entries.map(toEvent));
          if (page.entries.length === 0) break;
        } while (all.length < Math.min(total, maxRows) && !cancelled);
        if (!cancelled) {
          setRemote(all);
          setBackendTotal(total);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(() => [...remote, ...local].sort((a, b) => b.at.localeCompare(a.at)), [remote, local]);
  return { entries, loading, error, backendTotal };
}
