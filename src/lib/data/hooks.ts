"use client";

/** Read hooks over the prototype store. Components use these, never the store's internals directly. */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDb } from "./store";
import type { ID } from "./types";

export const useTenant = () => useDb((s) => s.tenant);
export const useUsers = () => useDb((s) => s.users);
export const useSectors = () => useDb((s) => s.sectors);
export const useObligors = () => useDb((s) => s.obligors);
export const useFacilities = () => useDb((s) => s.facilities);
export const useApplications = () => useDb((s) => s.applications);
export const useCollateral = () => useDb((s) => s.collateral);
export const useDocuments = () => useDb((s) => s.documents);
export const useTasks = () => useDb((s) => s.tasks);
export const useNotifications = () => useDb((s) => s.notifications);
export const useAudit = () => useDb((s) => s.audit);

/** Write actions (the backend seam). */
export const useDbActions = () =>
  useDb(useShallow((s) => ({ upsert: s.upsert, update: s.update, remove: s.remove, log: s.log, resetDemo: s.resetDemo })));

export function useObligor(id: ID | null | undefined) {
  const obligors = useObligors();
  return useMemo(() => obligors.find((o) => o.id === id), [obligors, id]);
}
export function useApplication(id: ID | null | undefined) {
  const list = useApplications();
  return useMemo(() => list.find((x) => x.id === id), [list, id]);
}
export function useFacility(id: ID | null | undefined) {
  const list = useFacilities();
  return useMemo(() => list.find((x) => x.id === id), [list, id]);
}
export function useCollateralItem(id: ID | null | undefined) {
  const list = useCollateral();
  return useMemo(() => list.find((x) => x.id === id), [list, id]);
}

/** Lookup maps for joining in tables. */
export function useLookups() {
  const obligors = useObligors();
  const sectors = useSectors();
  const users = useUsers();
  return useMemo(
    () => ({
      obligor: new Map(obligors.map((o) => [o.id, o])),
      sector: new Map(sectors.map((s) => [s.id, s])),
      user: new Map(users.map((u) => [u.id, u])),
    }),
    [obligors, sectors, users],
  );
}
