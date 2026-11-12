"use client";

/**
 * Backend Operations requests (user, role, permission-group and other platform changes routed through the backend engine): the
 * signed-in user's approval queue, one request, and decisions (approve / reject / return). Approver eligibility, four-eyes and
 * segregation of duties are enforced by the backend.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Alert, Badge, Button, Card, CardContent, DescriptionList, Field, Grid, Spinner, Stack, Text, Textarea, WorkflowInstanceCard } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { identityCall } from "@/lib/auth/backend-identity";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { dateTime } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { roleName } from "./logic";

export type BackendOperation = {
  id: string;
  operationType: string;
  title: string;
  subject: { type: string; id: string; title?: string | null; href?: string | null };
  summary: Array<{ label: string; value: string }>;
  steps: Array<{ id: string; name: string }>;
  requestedBy: { id: string; name: string; roles: string[] };
  requestedAt: string;
  status: string;
  stepIndex: number;
  stepDueAt?: string | null;
  decisions: Array<{ decision: string; byName?: string; actorName?: string; comment?: string; at?: string; decidedAt?: string }>;
  reason?: string | null;
};

export const backendItemHref = (id: string) => `/operations/item?id=${encodeURIComponent(id)}&source=platform`;

const statusTone = (s: string) => (s === "Approved" || s === "Applied" ? "success" : s === "Rejected" || s === "Failed" ? "danger" : s === "Returned" ? "warning" : "info");

export function useBackendQueue(): { items: BackendOperation[]; loading: boolean; error: string | null; reload: () => void } {
  const [items, setItems] = useState<BackendOperation[]>([]);
  const [loading, setLoading] = useState(backendSsoEnabled);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!backendSsoEnabled) return;
    let cancelled = false;
    identityCall<BackendOperation[]>("/operations/queue")
      .then((list) => !cancelled && (setItems(list), setError(null)))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [version]);
  return { items, loading, error, reload: useCallback(() => setVersion((v) => v + 1), []) };
}

/** "Platform requests" section of Operations → Approvals. */
export function BackendApprovalQueue() {
  const { items, loading, error } = useBackendQueue();
  if (!backendSsoEnabled) return null;
  return (
    <Stack gap="medium">
      <Text variant="eyebrow" tone="muted">
        Platform requests — users, roles, permissions and groups
      </Text>
      {error ? <Alert tone="warning">{error}</Alert> : null}
      {loading ? (
        <Spinner label="Loading platform requests" />
      ) : items.length === 0 ? (
        <Text variant="small" tone="muted">
          No platform request awaits your decision.
        </Text>
      ) : (
        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          {items.map((i) => (
            <WorkflowInstanceCard
              key={i.id}
              subject={{ title: i.title, type: i.operationType, href: backendItemHref(i.id), reference: i.id }}
              status="pending"
              requester={{ name: i.requestedBy.name, role: roleName(i.requestedBy.roles[0] ?? "") }}
              submittedAt={dateTime(i.requestedAt)}
              currentStep={i.steps[i.stepIndex]?.name ?? "—"}
              dueAt={i.stepDueAt ?? undefined}
              linkComponent={Link}
              actions={
                <Button href={backendItemHref(i.id)} as={Link} size="small">
                  Review & decide
                </Button>
              }
            />
          ))}
        </Grid>
      )}
    </Stack>
  );
}

/** One backend request: details, history and the decision form. */
export function BackendOperationPage() {
  const id = useSearchParams().get("id") ?? "";
  const minComment = useRule<number>("operations.minCommentLength");
  const [op, setOp] = useState<BackendOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    identityCall<BackendOperation>(`/operations/${encodeURIComponent(id)}`)
      .then((o) => !cancelled && setOp(o))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const decide = async (decision: "Approve" | "Reject" | "Return") => {
    if (decision !== "Approve" && comment.trim().length < minComment) return setError(`Give a comment of at least ${minComment} characters.`);
    setBusy(true);
    setError(null);
    try {
      const r = await identityCall<{ status: string }>(`/operations/${encodeURIComponent(id)}/decisions`, { method: "POST", body: JSON.stringify({ decision, comment: comment.trim() || decision }) });
      setDone(r.status);
      setComment("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const open = op && (op.status === "Pending" || op.status === "InProgress" || op.status === "In progress");
  return (
    <ModulePage module="operations" title={op?.title ?? "Platform request"} description={op ? `${op.operationType} · ${op.id}` : id}>
      <Stack gap="large">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {done ? (
          <Alert tone="success" title={`Decision recorded — ${done}`}>
            The request is updated; the change applies when the workflow completes.
          </Alert>
        ) : null}
        {!op ? (
          error ? null : <Spinner label="Loading the request" />
        ) : (
          <>
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(op.status)}>{op.status}</Badge>
                  <Text variant="small" tone="muted">
                    Requested by {op.requestedBy.name} ({roleName(op.requestedBy.roles[0] ?? "")}) · {dateTime(op.requestedAt)} · Step: {op.steps[op.stepIndex]?.name ?? "—"}
                  </Text>
                </div>
                <DescriptionList items={op.summary.filter((s) => s.value).map((s) => ({ label: s.label, value: s.value }))} />
              </CardContent>
            </Card>
            {op.decisions.length ? (
              <Card>
                <CardContent className="flex flex-col gap-2 pt-6">
                  <Text variant="small" className="font-semibold">
                    Decisions
                  </Text>
                  {op.decisions.map((d, n) => (
                    <Text key={n} variant="small">
                      {d.decision} — {d.byName ?? d.actorName ?? "—"} {d.at || d.decidedAt ? `· ${dateTime((d.at ?? d.decidedAt)!)}` : ""} {d.comment ? `· “${d.comment}”` : ""}
                    </Text>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            {open ? (
              <Card>
                <CardContent className="flex flex-col gap-3 pt-6">
                  <Field label="Comment" htmlFor="op-comment" description="Required to reject or return; kept in the audit log.">
                    <Textarea id="op-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button iconBefore={<CheckCheck aria-hidden className="size-4" />} loading={busy} disabled={busy} onClick={() => void decide("Approve")}>
                      Approve
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void decide("Return")}>
                      Return for rework
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => void decide("Reject")}>
                      Reject
                    </Button>
                  </div>
                  <Text variant="caption" tone="subtle">
                    You can&apos;t decide a request you made; the backend checks your role for this step.
                  </Text>
                </CardContent>
              </Card>
            ) : null}
            <Button href="/operations" as={Link} variant="tertiary">
              Back to approvals
            </Button>
          </>
        )}
      </Stack>
    </ModulePage>
  );
}
