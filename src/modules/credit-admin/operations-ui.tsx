"use client";

/**
 * Thin compositions of library components that show a record's Operations-workflow state
 * (shared by Offer letters, Credit administration and Disbursement).
 */
import Link from "next/link";
import { Alert, TextLink } from "@credigit/web-ui";
import { dateTime } from "@/lib/format";
import { currentStep, getDefinition, stepApproverLabel, stepDueAt, type OperationInstance } from "@/lib/platform/operations";

/** "Awaiting approval" notice for a record with an open operation, linking to Operations. */
export function PendingOperationNotice({ instance, title, children }: { instance: OperationInstance; title?: string; children?: React.ReactNode }) {
  const step = currentStep(instance);
  const due = stepDueAt(instance);
  return (
    <Alert tone="info" title={title ?? `Awaiting approval — ${getDefinition(instance.operationType).name}`}>
      {step ? `Step “${step.name}” (${stepApproverLabel(step)})${due ? `, due ${dateTime(due)}` : ""}. ` : ""}
      Requested by {instance.requestedBy.name} on {dateTime(instance.requestedAt)}.{" "}
      {children}
      <TextLink as={Link} href={`/operations/item?id=${instance.id}`}>
        Open in Operations ({instance.id})
      </TextLink>
    </Alert>
  );
}
