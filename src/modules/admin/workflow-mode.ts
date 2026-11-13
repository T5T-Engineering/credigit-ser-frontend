"use client";

/**
 * Whether a backend Operations workflow applies a change on submit (no approval steps, or disabled) — the screen then offers "Save"
 * instead of "Request …". Read from the tenant's effective workflow definitions (GET /operations/workflows), never assumed.
 */
import { useEffect, useState } from "react";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";

type WorkflowDto = { operationType: string; enabled: boolean; steps: unknown[]; routeFromSubmitter?: boolean };

const appliesImmediately = (w: WorkflowDto) => !w.enabled || (!w.routeFromSubmitter && w.steps.length === 0);

/** Operation types (of those asked) that apply on submit; empty until loaded or when the workflows can't be read. */
export function useAppliesOnSave(types: readonly string[]): ReadonlySet<string> {
  const [applies, setApplies] = useState<ReadonlySet<string>>(new Set());
  const key = types.join(",");

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let cancelled = false;
    const wanted = key.split(",");
    identityCall<WorkflowDto[]>("/operations/workflows")
      .then((list) => !cancelled && setApplies(new Set(list.filter((w) => wanted.includes(w.operationType) && appliesImmediately(w)).map((w) => w.operationType))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return applies;
}
