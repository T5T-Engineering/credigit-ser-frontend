"use client";

/**
 * Database-backed storage for the app's persisted stores (backend ADR-0015, workspace data store).
 *
 * When NEXT_PUBLIC_API_BASE_URL is set, every store that uses `dataStorage()` loads its state from
 * `GET /api/v1/workspace-data/stores/{store}` and saves only what changed through `PATCH …/stores/{store}`: upserted items, removed keys
 * and the order of arrays. In MongoDB each top-level field is its own collection with one document per item, so the data can be read and
 * changed there and every screen shows it. When a store is empty, the first signed-in user's built-in initial data is written (seed).
 *
 * Identity: a backend sign-in (Microsoft) sends its bearer token; browser-only sign-ins (demo role picker, browser email + password) send
 * the backend's development identity headers when NEXT_PUBLIC_BACKEND_DEV_IDENTITY=true — Development only (TD-953).
 * Without NEXT_PUBLIC_API_BASE_URL the stores keep using localStorage.
 */
import { createJSONStorage, type PersistStorage, type StorageValue } from "zustand/middleware";
import { backendTokens } from "@/lib/auth/backend-sso";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
export const workspaceDataEnabled = apiBase.length > 0;

const devIdentity = process.env.NEXT_PUBLIC_BACKEND_DEV_IDENTITY === "true";
const devTenant = process.env.NEXT_PUBLIC_BACKEND_DEV_TENANT ?? "";
/** Request-size and batching limits (TD-953: defaults below the backend's 1 MB body limit and WorkspaceData:MaxPatchDocuments). */
const maxPatchBytes = Number(process.env.NEXT_PUBLIC_WORKSPACE_MAX_PATCH_BYTES ?? 400_000);
const maxPatchDocuments = Number(process.env.NEXT_PUBLIC_WORKSPACE_MAX_PATCH_DOCUMENTS ?? 500);
const saveDelayMs = Number(process.env.NEXT_PUBLIC_WORKSPACE_SAVE_DELAY_MS ?? 400);

/** Session store key (src/lib/auth/session.ts) — read directly to avoid an import cycle. */
const sessionStorageKey = "credigit.ser.session";
const storePrefix = /^credigit\.ser\./;

type Shape = "array" | "map" | "value";
type FieldSnapshot = { shape: Shape; items: Map<string, string>; order: string[] };
type Snapshot = Map<string, FieldSnapshot>;
type Patch = {
  version: number;
  shapes: Record<string, Shape>;
  upserts: Record<string, Record<string, unknown>>;
  removes: Record<string, string[]>;
  orders: Record<string, string[]>;
};

const snapshots = new Map<string, Snapshot>();
/** Stores the database had nothing for: their initial data is written once they finish loading. */
const emptyStores = new Set<string>();
const pending = new Map<string, StorageValue<unknown>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let waitingForSignIn = false;

/** URL-safe store name: "credigit.ser.credit-admin" → "credit-admin". */
export function storeSlug(name: string): string {
  return name.replace(storePrefix, "").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

function identityHeaders(): Record<string, string> | null {
  const tokens = backendTokens();
  if (tokens) return { Authorization: `Bearer ${tokens.accessToken}` };
  if (!devIdentity || typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(sessionStorageKey);
    const session = raw ? (JSON.parse(raw) as { state?: { user?: { id: string; name: string; email: string } | null; roleId?: string | null } }) : null;
    const user = session?.state?.user;
    const roleId = session?.state?.roleId;
    if (!user || !roleId) return null;
    return { "X-Dev-User": user.id, "X-Dev-Name": user.name, "X-Dev-Email": user.email, "X-Dev-Tenant": devTenant, "X-Dev-Roles": roleId };
  } catch {
    return null;
  }
}

function shapeOf(value: unknown): Shape {
  if (Array.isArray(value)) {
    const ids = value.map((x) => (x && typeof x === "object" && "id" in x ? String((x as { id: unknown }).id) : null));
    return ids.every((id) => id !== null) && new Set(ids).size === ids.length ? "array" : "value";
  }
  return value !== null && typeof value === "object" ? "map" : "value";
}

/** One field as keyed JSON documents (the shape of an existing field is kept). */
function fieldSnapshot(value: unknown, known?: Shape): FieldSnapshot {
  let shape = known ?? shapeOf(value);
  if (shape === "array" && shapeOf(value) !== "array") shape = "value";
  if (shape === "map" && (value === null || typeof value !== "object" || Array.isArray(value))) shape = "value";
  const items = new Map<string, string>();
  const order: string[] = [];
  if (shape === "array") {
    for (const item of value as Array<{ id: unknown }>) {
      const key = String(item.id);
      items.set(key, JSON.stringify(item));
      order.push(key);
    }
  } else if (shape === "map") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) items.set(key, JSON.stringify(item));
  } else {
    items.set("_value", JSON.stringify(value ?? null));
  }
  return { shape, items, order };
}

function snapshotOf(state: Record<string, unknown>, previous?: Snapshot): Snapshot {
  const snapshot: Snapshot = new Map();
  for (const [field, value] of Object.entries(state)) {
    if (typeof value === "function" || value === undefined) continue;
    snapshot.set(field, fieldSnapshot(value, previous?.get(field)?.shape));
  }
  return snapshot;
}

function diff(previous: Snapshot, next: Snapshot, version: number): Patch {
  const patch: Patch = { version, shapes: {}, upserts: {}, removes: {}, orders: {} };
  for (const [field, now] of next) {
    const before = previous.get(field);
    const upserts: Record<string, unknown> = {};
    for (const [key, json] of now.items) if (before?.items.get(key) !== json) upserts[key] = JSON.parse(json);
    const removes = before ? [...before.items.keys()].filter((key) => !now.items.has(key)) : [];
    const orderChanged = now.shape === "array" && (!before || before.order.join("\u0000") !== now.order.join("\u0000"));
    if (Object.keys(upserts).length || removes.length || orderChanged) patch.shapes[field] = now.shape;
    if (Object.keys(upserts).length) patch.upserts[field] = upserts;
    if (removes.length) patch.removes[field] = removes;
    if (orderChanged && now.order.length) patch.orders[field] = now.order;
  }
  return patch;
}

/** Splits a patch into requests under the size and document limits; array orders go with the last request. */
function chunks(patch: Patch): Patch[] {
  const out: Patch[] = [];
  let current: Patch = { version: patch.version, shapes: {}, upserts: {}, removes: {}, orders: {} };
  let bytes = 0;
  let documents = 0;
  const flush = () => {
    if (documents > 0) out.push(current);
    current = { version: patch.version, shapes: {}, upserts: {}, removes: {}, orders: {} };
    bytes = 0;
    documents = 0;
  };
  for (const [field, items] of Object.entries(patch.upserts)) {
    for (const [key, item] of Object.entries(items)) {
      const size = JSON.stringify(item).length + key.length + 8;
      if (documents > 0 && (bytes + size > maxPatchBytes || documents + 1 > maxPatchDocuments)) flush();
      current.shapes[field] = patch.shapes[field]!;
      (current.upserts[field] ??= {})[key] = item;
      bytes += size;
      documents += 1;
    }
  }
  for (const [field, keys] of Object.entries(patch.removes)) {
    for (const key of keys) {
      if (documents > 0 && documents + 1 > maxPatchDocuments) flush();
      current.shapes[field] = patch.shapes[field]!;
      (current.removes[field] ??= []).push(key);
      bytes += key.length + 4;
      documents += 1;
    }
  }
  current.orders = patch.orders;
  for (const field of Object.keys(patch.orders)) current.shapes[field] = patch.shapes[field]!;
  if (documents > 0 || Object.keys(patch.orders).length) out.push(current);
  return out;
}

async function request(path: string, init: RequestInit = {}, keepalive = false): Promise<Response | null> {
  const identity = identityHeaders();
  if (!identity) return null;
  return fetch(`${apiBase}/api/v1/workspace-data${path}`, {
    ...init,
    keepalive,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...identity, ...init.headers },
  });
}

async function save(name: string, keepalive = false): Promise<void> {
  const value = pending.get(name);
  const previous = snapshots.get(name);
  if (!value || !previous) return;
  pending.delete(name);
  const next = snapshotOf(value.state as Record<string, unknown>, previous);
  const parts = chunks(diff(previous, next, value.version ?? 0));
  for (const part of parts) {
    const response = await request(`/stores/${storeSlug(name)}`, { method: "PATCH", body: JSON.stringify(part) }, keepalive).catch(() => null);
    if (!response?.ok) {
      // Keep the last confirmed snapshot; the next change retries the whole difference.
      if (!pending.has(name)) pending.set(name, value);
      console.warn(`Saving "${name}" to the database failed (${response?.status ?? "network"}).`);
      return;
    }
  }
  snapshots.set(name, next);
}

function workspaceStorage<S>(): PersistStorage<S> {
  return {
    getItem: async (name) => {
      const response = await request(`/stores/${storeSlug(name)}`).catch(() => null);
      if (!response || response.status === 401 || response.status === 403) {
        // Not signed in (or no backend identity): nothing is loaded and nothing is saved until sign-in.
        waitingForSignIn = true;
        return null;
      }
      if (!response.ok) {
        console.warn(`Loading "${name}" from the database failed (${response.status}).`);
        return null;
      }
      const body = (await response.json()) as { version: number; state: Record<string, unknown> | null };
      snapshots.set(name, body.state ? snapshotOf(body.state) : new Map());
      if (!body.state) emptyStores.add(name);
      return body.state ? ({ state: body.state as S, version: body.version } satisfies StorageValue<S>) : null;
    },
    setItem: (name, value) => {
      // Never save before this store was loaded from the database (that would overwrite it with initial data).
      if (!snapshots.has(name)) return;
      pending.set(name, value as StorageValue<unknown>);
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => void save(name), saveDelayMs));
    },
    removeItem: () => undefined,
  };
}

/** Storage for a persisted store: the database when the backend is configured, otherwise this browser. */
export function dataStorage<S>(): PersistStorage<S> | undefined {
  return workspaceDataEnabled ? workspaceStorage<S>() : createJSONStorage<S>(() => localStorage);
}

type PersistedStoreApi = {
  setState: (partial: object) => void;
  persist: { getOptions: () => { name?: string }; onFinishHydration: (listener: () => void) => () => void; hasHydrated: () => boolean };
};

/**
 * Seeds the database with a store's initial data when it had nothing stored (zustand only saves on a change). An empty `setState`
 * makes persist save the store's partialized state through `dataStorage()`.
 */
export function registerDatabaseStore(api: PersistedStoreApi): void {
  if (!workspaceDataEnabled) return;
  const seed = () => {
    const name = api.persist.getOptions().name;
    if (name && emptyStores.delete(name)) api.setState({});
  };
  api.persist.onFinishHydration(seed);
  if (api.persist.hasHydrated()) seed();
}

/** After a sign-in, stores that could not load (no identity yet) are loaded by reloading the page once. */
export function onSignedIn(): void {
  if (workspaceDataEnabled && waitingForSignIn && typeof window !== "undefined") {
    waitingForSignIn = false;
    setTimeout(() => window.location.reload(), 0);
  }
}

if (typeof window !== "undefined" && workspaceDataEnabled) {
  // Save what is still waiting when the tab closes.
  window.addEventListener("pagehide", () => {
    for (const name of [...pending.keys()]) {
      clearTimeout(timers.get(name));
      void save(name, true);
    }
  });
}
