"use client";

/**
 * Hook points (invariant 9: extensible). Synchronous-in-order interception around actions:
 *  - "<module>.<action>.before": handlers may VETO (return { veto: "reason" }) or ENRICH (return { ctx: modified }).
 *  - "<module>.<action>.after":  handlers observe/enrich the result; vetoes are ignored after the fact.
 * Register at module load or from an extension; toggle in Operations → Events & hooks.
 */
import { useEventStore } from "./events";

export type HookOutcome<C> = void | undefined | { veto: string } | { ctx: C };

export type HookHandler<C> = {
  id: string;
  name: string;
  point: string;
  priority: number;
  run: (ctx: C) => HookOutcome<C> | Promise<HookOutcome<C>>;
};

export type HookPointDefinition = { point: string; module: string; description: string; kind: "before" | "after" };

const points = new Map<string, HookPointDefinition>();
const handlers = new Map<string, HookHandler<unknown>>();

export function defineHookPoints(defs: HookPointDefinition[]) {
  for (const d of defs) points.set(d.point, d);
}

export function hookPointCatalogue(): HookPointDefinition[] {
  return [...points.values()].sort((a, b) => a.point.localeCompare(b.point));
}

export function hookList(): Omit<HookHandler<unknown>, "run">[] {
  return [...handlers.values()].map(({ run: _r, ...meta }) => meta).sort((a, b) => a.point.localeCompare(b.point) || a.priority - b.priority);
}

/** Register a hook handler. Returns an unregister function. */
export function registerHook<C>(handler: Omit<HookHandler<C>, "priority"> & { priority?: number }): () => void {
  handlers.set(handler.id, { priority: 100, ...handler } as HookHandler<unknown>);
  return () => handlers.delete(handler.id);
}

export type HookRunResult<C> = { ok: true; ctx: C } | { ok: false; reason: string; vetoedBy: string };

/** Run every enabled handler for a point in priority order. */
export async function runHooks<C>(point: string, ctx: C): Promise<HookRunResult<C>> {
  const { enabled } = useEventStore.getState();
  const list = [...handlers.values()].filter((h) => h.point === point && enabled[h.id] !== false).sort((a, b) => a.priority - b.priority);
  let current = ctx;
  for (const h of list) {
    const at = new Date().toISOString();
    try {
      const out = (await h.run(current)) as HookOutcome<C>;
      useEventStore.setState((s) => ({ lastRun: { ...s.lastRun, [h.id]: { at, ok: true } } }));
      if (out && "veto" in out && point.endsWith(".before")) return { ok: false, reason: out.veto, vetoedBy: h.name };
      if (out && "ctx" in out) current = out.ctx;
    } catch (err) {
      useEventStore.setState((s) => ({ lastRun: { ...s.lastRun, [h.id]: { at, ok: false, message: String(err) } } }));
    }
  }
  return { ok: true, ctx: current };
}
