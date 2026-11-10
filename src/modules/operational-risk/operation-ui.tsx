"use client";

/**
 * Page compositions for Operations-routed actions, shared by the Operational Risk, ERM and AI modules:
 * pending badge (links to /operations/item?id=), submission outcome and an operations list.
 */
import Link from "next/link";
import { Alert, Badge, StatusBadge, Text, TextLink } from "@credigit/web-ui";
import { dateTime } from "@/lib/format";
import { usePendingFor, useOperationsStore, type OperationInstance, type SubmitResult } from "@/lib/platform/operations";

export const operationHref = (id: string) => `/operations/item?id=${encodeURIComponent(id)}`;

const opTones = { Pending: "warning", "In progress": "info", Approved: "success", Rejected: "danger", Returned: "warning", Cancelled: "neutral" } as const;

/** "Awaiting approval" badge linking to the open operation for a subject, or nothing. */
export function PendingBadge({ subjectType, subjectId }: { subjectType: string; subjectId: string }) {
  const pending = usePendingFor(subjectType, subjectId);
  if (!pending) return null;
  return (
    <Link href={operationHref(pending.id)} className="rounded-full focus-visible:outline-2 focus-visible:outline-focus">
      <Badge tone="warning">Awaiting approval · {pending.id}</Badge>
    </Link>
  );
}

/** Outcome of a submission: link to the operation, "applied" or the reason it failed. */
export function SubmitOutcome({ result, appliedText = "Applied — the workflow for this change has no approval steps." }: { result: SubmitResult | null; appliedText?: string }) {
  if (!result) return null;
  if (!result.ok) return <Alert tone="danger">{result.reason}</Alert>;
  return result.applied ? (
    <Alert tone="success">{appliedText}</Alert>
  ) : (
    <Alert tone="success" title="Sent for approval">
      The change applies once it&rsquo;s approved in Operations.{" "}
      <TextLink href={operationHref(result.instance.id)} as={Link}>
        Track request {result.instance.id}
      </TextLink>
    </Alert>
  );
}

/** Operations of the given types (newest first). */
export function useOperationsOfType(types: string[]): OperationInstance[] {
  const instances = useOperationsStore((s) => s.instances);
  return instances.filter((i) => types.includes(i.operationType));
}

/** Compact row for an operation instance (title, requester, status, link). */
export function OperationRow({ op }: { op: OperationInstance }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-surface-sunken p-4">
      <div className="min-w-0">
        <TextLink href={operationHref(op.id)} as={Link}>
          {op.title}
        </TextLink>
        <Text variant="small" tone="muted">
          {op.id} · requested by {op.requestedBy.name}, {dateTime(op.requestedAt)}
          {op.reason ? ` — “${op.reason}”` : ""}
        </Text>
      </div>
      <StatusBadge status={op.status} tones={opTones} />
    </div>
  );
}
