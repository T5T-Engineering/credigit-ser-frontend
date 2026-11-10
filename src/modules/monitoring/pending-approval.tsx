"use client";

/**
 * "Awaiting approval" panel for a record with an open Operations workflow instance (composition of library parts).
 * Shows the current step, links to Operations → item, and lets an eligible approver decide inline (the engine enforces
 * segregation of duties and comment rules). Used by monitoring, collateral and connectors pages.
 */
import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Field, Stack, Text, TextLink, Textarea } from "@credigit/web-ui";
import { canDecide, currentStep, decideOperation, stepApproverLabel, usePendingFor } from "@/lib/platform/operations";
import { useScope } from "@/lib/platform/scope";
import { dateTime } from "@/lib/format";

export function PendingApproval({ subjectType, subjectId, label, compact }: { subjectType: string; subjectId: string; label?: string; compact?: boolean }) {
  const pending = usePendingFor(subjectType, subjectId);
  const { actor } = useScope();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const step = currentStep(pending);
  const allowed = canDecide(pending, actor);
  const href = `/operations/item?id=${encodeURIComponent(pending.id)}`;

  if (compact)
    return (
      <TextLink as={Link} href={href}>
        Awaiting approval · {pending.id}
      </TextLink>
    );

  const decide = async (d: "approve" | "reject" | "return") => {
    setBusy(true);
    const r = await decideOperation(pending.id, d, comment);
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setComment("");
    setError(null);
  };

  return (
    <Alert tone="info" title={label ?? `Awaiting approval — ${pending.title}`}>
      <Stack gap="small">
        <Text variant="small">
          Step “{step?.name ?? "—"}” ({step ? stepApproverLabel(step) : "—"}) · requested by {pending.requestedBy.name} on {dateTime(pending.requestedAt)} ·{" "}
          <TextLink as={Link} href={href}>
            Open {pending.id} in Operations
          </TextLink>
        </Text>
        {allowed.ok && (
          <>
            <Field label="Decision comment" htmlFor={`dec-${pending.id}`} optional>
              <Textarea id={`dec-${pending.id}`} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <Stack direction="horizontal" gap="small" wrap>
              <Button size="small" onClick={() => decide("approve")} loading={busy}>
                Approve
              </Button>
              <Button size="small" variant="secondary" onClick={() => decide("return")} disabled={busy}>
                Return
              </Button>
              <Button size="small" variant="tertiary" onClick={() => decide("reject")} disabled={busy}>
                Reject
              </Button>
            </Stack>
          </>
        )}
        {error && (
          <Text variant="small" tone="accent">
            {error}
          </Text>
        )}
      </Stack>
    </Alert>
  );
}
