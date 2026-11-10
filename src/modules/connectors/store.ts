"use client";

/**
 * Connectors module state (`credigit.ser.connectors`): manual runs, schedule / enable overrides.
 * BACKEND SEAM: "Run now" becomes a POST to the connector job API; overrides become tenant configuration commands.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Run } from "./data";

type Override = { lastRunAt?: string; status?: "Healthy" | "Degraded" | "Failed" | "Paused"; schedule?: string; enabled?: boolean };

type State = {
  runs: Run[];
  overrides: Record<string, Override>;
  running: Record<string, boolean>;
  addRun: (r: Run) => void;
  setOverride: (id: string, o: Override) => void;
  setRunning: (id: string, v: boolean) => void;
};

export const useConnectors = create<State>()(
  persist(
    (set) => ({
      runs: [],
      overrides: {},
      running: {},
      addRun: (r) => set((s) => ({ runs: [r, ...s.runs].slice(0, 100) })),
      setOverride: (id, o) => set((s) => ({ overrides: { ...s.overrides, [id]: { ...s.overrides[id], ...o } } })),
      setRunning: (id, v) => set((s) => ({ running: { ...s.running, [id]: v } })),
    }),
    { name: "credigit.ser.connectors", version: 1, storage: createJSONStorage(() => localStorage), partialize: ({ runs, overrides }) => ({ runs, overrides }) },
  ),
);
