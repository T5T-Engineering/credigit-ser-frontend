"use client";

/**
 * Whether a backend Operations workflow applies a change on submit (no approval steps, disabled, or — ADR-0018 — the signed-in user is a
 * final approver on an eligible workflow) — the screen then offers "Save" instead of "Request …". Read from the tenant's effective workflow
 * definitions (GET /operations/workflows) and the user's backend permissions, never assumed.
 */
import { useEffect, useState } from "react";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { useSession } from "@/lib/auth/session";
import { APPLY_DIRECTLY } from "@/lib/platform/operations";

type WorkflowDto = {
  operationType: string;
  enabled: boolean;
  steps: unknown[];
  routeFromSubmitter?: boolean;
  finalApproverEligible?: boolean;
  finalApproverAppliesDirectly?: boolean | null;
};

const appliesImmediately = (w: WorkflowDto, finalApprover: boolean) =>
  !w.enabled || (!w.routeFromSubmitter && w.steps.length === 0) || (finalApprover && w.finalApproverEligible === true && w.finalApproverAppliesDirectly === true);

/** Whether the signed-in user is a final approver (holds `operations.requests.apply-directly`). */
export function useIsFinalApprover(): boolean {
  return useSession((s) => s.access?.permissions.includes(APPLY_DIRECTLY) ?? false);
}

/** Operation types (of those asked) that apply on submit; empty until loaded or when the workflows can't be read. */
export function useAppliesOnSave(types: readonly string[]): ReadonlySet<string> {
  const [applies, setApplies] = useState<ReadonlySet<string>>(new Set());
  const finalApprover = useIsFinalApprover();
  const key = types.join(",");

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let cancelled = false;
    const wanted = key.split(",");
    identityCall<WorkflowDto[]>("/operations/workflows")
      .then((list) => !cancelled && setApplies(new Set(list.filter((w) => wanted.includes(w.operationType) && appliesImmediately(w, finalApprover)).map((w) => w.operationType))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, finalApprover]);

  return applies;
}
