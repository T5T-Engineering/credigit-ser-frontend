"use client";

/** Connector read models for the pages: effective status / schedule / freshness (from business rules) and run history. */
import { useMemo, useState } from "react";
import { useRulesStore } from "@/lib/platform/rules";
import { connectors, freshnessSla, seedRuns, type Connector, type ConnectorStatus, type Run } from "./data";
import { useConnectors } from "./store";

export type ConnectorView = Connector & {
  effectiveStatus: ConnectorStatus;
  lastSyncAt: number;
  /** Elapsed share of the freshness SLA (1 = at SLA). */
  freshness: number;
  freshnessSlaMin: number;
  enabled: boolean;
  scheduleNow: string;
  isRunning: boolean;
};

export function useLoadedAt() {
  const [loadedAt] = useState(() => Date.now());
  return loadedAt;
}

export function useConnectorViews(loadedAt: number): ConnectorView[] {
  const overrides = useConnectors((s) => s.overrides);
  const running = useConnectors((s) => s.running);
  // Freshness SLAs are business rules read in freshnessSla(); recompute when rule values change.
  const ruleValues = useRulesStore((s) => s.values);
  return useMemo(
    () =>
      connectors.map((c) => {
        const o = overrides[c.id] ?? {};
        const sla = freshnessSla(c);
        const lastSyncAt = o.lastRunAt ? new Date(o.lastRunAt).getTime() : loadedAt - c.lastSyncMin * 60_000;
        const enabled = o.enabled ?? true;
        const effectiveStatus: ConnectorStatus = !enabled ? "Paused" : (o.status ?? c.status);
        return { ...c, effectiveStatus, lastSyncAt, freshnessSlaMin: sla, freshness: (loadedAt - lastSyncAt) / 60_000 / sla, enabled, scheduleNow: o.schedule ?? c.schedule, isRunning: !!running[c.id] };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrides, running, loadedAt, ruleValues],
  );
}

export function useAllRuns(loadedAt: number): Run[] {
  const runs = useConnectors((s) => s.runs);
  const ruleValues = useRulesStore((s) => s.values);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => [...runs, ...seedRuns(loadedAt)].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [runs, loadedAt, ruleValues]);
}

export function fmtAge(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} d ${h % 24} h ago`;
}
export const fmtLatency = (ms: number) => (ms === 0 ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
export const fmtLag = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
