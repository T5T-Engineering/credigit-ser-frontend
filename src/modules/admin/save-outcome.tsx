"use client";

import Link from "next/link";
import { ResultDialog, TextLink } from "@credigit/web-ui";
import { loadBackendAccess } from "@/lib/auth/backend-identity";
import { useSession } from "@/lib/auth/session";
import { operationHref } from "./operation-ui";

/** What happened when an admin pressed Save: applied, waiting for approval in Operations, or refused (with the backend's reason). */
export type SaveOutcome = { ok: true; applied: boolean; operationId: string; message: string } | { ok: false; message: string };

export const failed = (e: unknown): SaveOutcome => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

/** Re-reads the signed-in admin's own access after a saved change (their role or group may be the one that changed). */
export async function refreshOwnAccess() {
  const access = await loadBackendAccess();
  if (access) useSession.getState().setAccess(access);
}

/** Popup confirming the result of a save so it can't be missed below the fold. */
export function SaveOutcomeModal({ outcome, onClose }: { outcome: SaveOutcome | null; onClose: () => void }) {
  if (!outcome) return null;
  return (
    <ResultDialog
      open
      onOpenChange={(open) => !open && onClose()}
      tone={!outcome.ok ? "danger" : outcome.applied ? "success" : "info"}
      title={!outcome.ok ? "Couldn't save" : outcome.applied ? "Saved" : "Sent for approval"}
      description={outcome.message}
      action={
        outcome.ok && !outcome.applied ? (
          <TextLink href={operationHref(outcome.operationId)} as={Link}>
            Track request {outcome.operationId}
          </TextLink>
        ) : undefined
      }
    />
  );
}
