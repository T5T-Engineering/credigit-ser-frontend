"use client";

/**
 * Event points (invariant 9: extensible). Modules publish domain events; extensions subscribe by name or
 * wildcard ("origination.*", "*.approved", "*"). Every event is kept in a bounded, persisted log shown in
 * Operations → Events & hooks.
 *
 * Naming: "<module>.<entity>.<past-tense-verb>", e.g. "origination.application.submitted".
 * BACKEND SEAM: replace `publish` with a call to the backend event outbox (integration events, PRD §4.2 README).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { currentActor } from "./scope";
import { newId } from "../data/store";

export type EventSubject = { type: string; id: string; title?: string; href?: string };

export type DomainEvent<P = unknown> = {
  id: string;
  name: string;
  module: string;
  subject?: EventSubject;
  payload: P;
  actorId: string;
  actorName: string;
  at: string;
  /** Number of subscribers that received it. */
  deliveredTo: number;
};

export type EventDefinition = { name: string; module: string; description: string; payloadExample?: Record<string, unknown> };

export type Subscription = {
  id: string;
  name: string;
  pattern: string;
  /** Lower runs first. */
  priority: number;
  handler: (event: DomainEvent) => void | Promise<void>;
};

type EventsState = {
  log: DomainEvent[];
  /** Enabled flags for subscriptions and hooks (true when absent). */
  enabled: Record<string, boolean>;
  lastRun: Record<string, { at: string; ok: boolean; message?: string }>;
};

/** Max events kept in the browser log (demo). Backend keeps the full outbox. */
const LOG_LIMIT = 500;

export const useEventStore = create<EventsState>()(
  persist((): EventsState => ({ log: [], enabled: {}, lastRun: {} }), { name: "credigit.ser.events", storage: createJSONStorage(() => localStorage) }),
);

const catalogue = new Map<string, EventDefinition>();
const subscriptions = new Map<string, Subscription>();

/** Declare an event point so it appears in the catalogue (call at module load). */
export function defineEvents(defs: EventDefinition[]) {
  for (const d of defs) catalogue.set(d.name, d);
}

export function eventCatalogue(): EventDefinition[] {
  return [...catalogue.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function subscriptionList(): Omit<Subscription, "handler">[] {
  return [...subscriptions.values()].map(({ handler: _h, ...meta }) => meta).sort((a, b) => a.priority - b.priority);
}

export function matches(pattern: string, name: string): boolean {
  if (pattern === "*" || pattern === name) return true;
  const re = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(name);
}

/** Subscribe to events. Returns an unsubscribe function. */
export function subscribe(sub: Omit<Subscription, "priority"> & { priority?: number }): () => void {
  subscriptions.set(sub.id, { priority: 100, ...sub });
  return () => subscriptions.delete(sub.id);
}

export function setSubscriptionEnabled(id: string, on: boolean) {
  useEventStore.setState((s) => ({ enabled: { ...s.enabled, [id]: on } }));
}

/** Publish a domain event to subscribers and the event log. Subscriber errors never break the caller. */
export function publish<P>(name: string, input: { module: string; subject?: EventSubject; payload?: P }): DomainEvent<P> {
  const actor = currentActor();
  const { enabled } = useEventStore.getState();
  const targets = [...subscriptions.values()].filter((s) => enabled[s.id] !== false && matches(s.pattern, name)).sort((a, b) => a.priority - b.priority);
  const event: DomainEvent<P> = {
    id: newId("EVT"),
    name,
    module: input.module,
    subject: input.subject,
    payload: (input.payload ?? {}) as P,
    actorId: actor.id,
    actorName: actor.name,
    at: new Date().toISOString(),
    deliveredTo: targets.length,
  };
  useEventStore.setState((s) => ({ log: [event as DomainEvent, ...s.log].slice(0, LOG_LIMIT) }));
  for (const sub of targets) {
    Promise.resolve()
      .then(() => sub.handler(event as DomainEvent))
      .then(
        () => useEventStore.setState((s) => ({ lastRun: { ...s.lastRun, [sub.id]: { at: event.at, ok: true } } })),
        (err: unknown) => useEventStore.setState((s) => ({ lastRun: { ...s.lastRun, [sub.id]: { at: event.at, ok: false, message: String(err) } } })),
      );
  }
  return event;
}
