"use client";

/**
 * Tenant master data (backend ADR-0021, `/api/v1/master-data`): code lists every module reads, changed through Operations
 * `master-data.value.change`. Backend only: in demo mode the hooks return empty lists.
 */
import { useEffect, useState } from "react";
import { identityCall, identityDownload } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";

export type AttributeType = "Text" | "Number" | "Boolean" | "List";
export type ChangeAction = "Add" | "Update" | "Retire" | "Reactivate";

export type AttributeDefinition = { key: string; label: string; type: AttributeType; required: boolean; description?: string | null };

export type MasterDataList = {
  code: string;
  name: string;
  description: string;
  module: string;
  parentList?: string | null;
  tenantMayAdd: boolean;
  attributes: AttributeDefinition[];
  activeCount: number;
  retiredCount: number;
};

export type Person = { id: string; name: string };

export type Snapshot = { label: string; description?: string | null; sortOrder: number; active: boolean; parent?: string | null; attributes: Record<string, string> };

export type HistoryEntry = { action: ChangeAction; by: Person; at: string; reason: string; operationId?: string | null; before?: Snapshot | null; after: Snapshot };

export type MasterDataValue = {
  id: string;
  list: string;
  code: string;
  label: string;
  description?: string | null;
  sortOrder: number;
  active: boolean;
  parent?: string | null;
  attributes: Record<string, string>;
  history: HistoryEntry[];
  updatedAt: string;
  version: number;
};

export type ChangeRequest = {
  action: ChangeAction;
  code: string;
  label?: string;
  description?: string;
  sortOrder?: number;
  parent?: string;
  attributes?: Record<string, string>;
  reason: string;
};

export type ChangeAck = { list: string; code: string; operationId?: string | null; applied: boolean };

/** Operations type of every master-data change. */
export const MASTER_DATA_CHANGE = "master-data.value.change";

const enc = encodeURIComponent;

export const masterDataApi = {
  lists: () => identityCall<MasterDataList[]>("/master-data/lists"),
  values: (list: string, opts: { includeRetired?: boolean; parent?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.includeRetired) q.set("includeRetired", "true");
    if (opts.parent) q.set("parent", opts.parent);
    const qs = q.toString();
    return identityCall<MasterDataValue[]>(`/master-data/lists/${enc(list)}/values${qs ? `?${qs}` : ""}`);
  },
  history: (list: string, code: string) => identityCall<HistoryEntry[]>(`/master-data/lists/${enc(list)}/values/${enc(code)}/history`),
  requestChange: (list: string, body: ChangeRequest) => identityCall<ChangeAck>(`/master-data/lists/${enc(list)}/changes`, { method: "POST", body: JSON.stringify(body) }),
  export: (list: string) => identityDownload(`/master-data/lists/${enc(list)}/export`, `${list}.csv`),
};

/** A list attribute that holds comma-separated items, as an array. */
export function listAttribute(value: MasterDataValue, key: string): string[] {
  return (value.attributes[key] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** All lists (definitions + counts). `reload()` re-reads them. */
export function useMasterDataLists(): { lists: MasterDataList[]; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ lists: MasterDataList[]; error: string | null; loading: boolean }>({ lists: [], error: null, loading: backendSsoEnabled });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!backendSsoEnabled) return;
    let live = true;
    masterDataApi
      .lists()
      .then((lists) => live && setState({ lists, error: null, loading: false }))
      .catch((e: unknown) => live && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false })));
    return () => {
      live = false;
    };
  }, [version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}

/** Values of one list (active only unless `includeRetired`), ordered by the backend (sort order, then label). */
export function useMasterDataValues(
  list: string | null,
  opts: { includeRetired?: boolean } = {},
): { values: MasterDataValue[]; error: string | null; loading: boolean; reload: () => void } {
  const [version, setVersion] = useState(0);
  const includeRetired = Boolean(opts.includeRetired);
  const key = `${list}|${includeRetired}|${version}`;
  // `key` = what the values on screen were read for; loading while it differs from the current request.
  const [state, setState] = useState<{ key: string; values: MasterDataValue[]; error: string | null }>({ key: "", values: [], error: null });
  useEffect(() => {
    if (!backendSsoEnabled || !list) return;
    let live = true;
    const k = `${list}|${includeRetired}|${version}`;
    masterDataApi
      .values(list, { includeRetired })
      .then((values) => live && setState({ key: k, values, error: null }))
      .catch((e: unknown) => live && setState({ key: k, values: [], error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [list, includeRetired, version]);
  const current = state.key.startsWith(`${list}|`) ? state : { values: [], error: null };
  return { values: current.values, error: current.error, loading: Boolean(backendSsoEnabled && list) && state.key !== key, reload: () => setVersion((v) => v + 1) };
}
