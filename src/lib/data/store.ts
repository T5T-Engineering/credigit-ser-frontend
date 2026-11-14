"use client";

/**
 * Core data store.
 *
 * - With NEXT_PUBLIC_API_BASE_URL set, it is loaded from and saved to MongoDB (backend ADR-0015, `dataStorage()`): each collection
 *   below is a `workspace_<collection>` collection with one document per item. An empty database is seeded with `createSeed()`.
 * - Without a backend it persists in this browser (localStorage). "Reset demo data" restores the seed.
 * - BACKEND SEAM: components read through the hooks in ./hooks.ts and change data through the actions
 *   below. When the API exists, replace these actions with API calls (e.g. React Query mutations)
 *   and keep component code unchanged.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSeed, type SeedData } from "./seed";
import type { AuditEvent, ID } from "./types";
import { dataStorage, registerDatabaseStore } from "@/lib/data/workspace-storage";

export type Collections = Omit<SeedData, "tenant">;
export type CollectionKey = keyof Collections;
type Item<K extends CollectionKey> = Collections[K][number];

type DbState = SeedData & {
  /** Insert or replace an item by id. */
  upsert: <K extends CollectionKey>(key: K, item: Item<K>) => void;
  /** Shallow-merge changes into an item by id. */
  update: <K extends CollectionKey>(key: K, id: ID, changes: Partial<Item<K>>) => void;
  remove: <K extends CollectionKey>(key: K, id: ID) => void;
  /** Append to the immutable audit log. */
  log: (event: Omit<AuditEvent, "id" | "at" | "ip" | "device"> & Partial<Pick<AuditEvent, "ip" | "device">>) => void;
  resetDemo: () => void;
};

const STORE_VERSION = 3;

export const useDb = create<DbState>()(
  persist(
    (set) => ({
      ...createSeed(),
      upsert: (key, item) =>
        set((s) => {
          const list = s[key] as Array<{ id: ID }>;
          const exists = list.some((x) => x.id === (item as { id: ID }).id);
          return { [key]: exists ? list.map((x) => (x.id === (item as { id: ID }).id ? item : x)) : [item, ...list] } as Partial<DbState>;
        }),
      update: (key, id, changes) =>
        set((s) => ({ [key]: (s[key] as Array<{ id: ID }>).map((x) => (x.id === id ? { ...x, ...changes } : x)) }) as Partial<DbState>),
      remove: (key, id) => set((s) => ({ [key]: (s[key] as Array<{ id: ID }>).filter((x) => x.id !== id) }) as Partial<DbState>),
      log: (event) =>
        set((s) => ({
          audit: [
            {
              id: `AUD-${Date.now().toString(36).toUpperCase()}`,
              at: new Date().toISOString(),
              ip: event.ip ?? "10.20.1.15",
              device: event.device ?? (typeof navigator !== "undefined" ? summariseDevice(navigator.userAgent) : "Unknown"),
              ...event,
            },
            ...s.audit,
          ],
        })),
      resetDemo: () => set(() => createSeed()),
    }),
    {
      name: "credigit.ser.demo-data",
      version: STORE_VERSION,
      storage: dataStorage(),
      // Data only; actions come from the initializer.
      partialize: (state) => Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== "function")) as SeedData,
      migrate: () => createSeed() as unknown as DbState,
    },
  ),
);

function summariseDevice(ua: string): string {
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : "Other OS";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${browser}`;
}

/** Simple id generator for records created in the prototype. */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase()}`;
}

registerDatabaseStore(useDb);
