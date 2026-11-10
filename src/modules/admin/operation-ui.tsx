"use client";

/** Small page compositions shared by the admin pages for Operations-routed changes. */
import Link from "next/link";
import { Alert, Badge, TextLink } from "@credigit/web-ui";
import { runHooks } from "@/lib/platform/hooks";
import { usePendingFor, type SubmitResult } from "@/lib/platform/operations";

export const operationHref = (id: string) => `/operations/item?id=${encodeURIComponent(id)}`;

/** Run `<point>.before` (vetoes block), submit, then `<point>.after`. */
export async function submitWithHooks<C>(point: string, ctx: C, submit: (ctx: C) => Promise<SubmitResult>): Promise<SubmitResult> {
  const before = await runHooks(`${point}.before`, ctx);
  if (!before.ok) return { ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` };
  const result = await submit(before.ctx);
  await runHooks(`${point}.after`, { ...before.ctx, result });
  return result;
}

/** "Awaiting approval" badge linking to the open operation for a subject, or nothing. */
export function PendingBadge({ subjectType, subjectId }: { subjectType: string; subjectId: string }) {
  const pending = usePendingFor(subjectType, subjectId);
  if (!pending) return null;
  return (
    <Link href={operationHref(pending.id)} className="rounded-full focus-visible:outline-2 focus-visible:outline-focus">
      <Badge tone="warning">Awaiting approval</Badge>
    </Link>
  );
}

/** Outcome of a submission: link to the operation or the reason it failed. */
export function SubmitOutcome({ result }: { result: SubmitResult | null }) {
  if (!result) return null;
  if (!result.ok) return <Alert tone="danger">{result.reason}</Alert>;
  return result.applied ? (
    <Alert tone="success">Applied — the workflow for this change has no approval steps.</Alert>
  ) : (
    <Alert tone="success" title="Sent for approval">
      The change applies once it&apos;s approved in Operations.{" "}
      <TextLink href={operationHref(result.instance.id)} as={Link}>
        Track request {result.instance.id}
      </TextLink>
    </Alert>
  );
}
