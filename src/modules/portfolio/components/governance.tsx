"use client";

/**
 * Operations-workflow compositions shared by Portfolio & MIS and Executive: the pending-approval card with the
 * inline decision form (approvers decide here or in Operations → Approvals), a consistent submit helper and a
 * business-rules panel. All approval logic lives in the Operations engine — nothing here decides on its own.
 */
import { useCallback, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DecisionPanel, RuleRow, Stack, WorkflowInstanceCard, useToast, type DecisionSubmission, type OperationStep } from "@credigit/web-ui";
import { dateTime } from "@/lib/format";
import { roleById } from "@/lib/rbac/roles";
import {
  canDecide,
  decideOperation,
  getDefinition,
  stepApproverLabel,
  stepDueAt,
  submitOperation,
  usePendingFor,
  type OperationInstance,
  type SubmitInput,
} from "@/lib/platform/operations";
import { ruleDefinition, useRule, useRulesStore, type RuleValue } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";

export const operationHref = (id: string) => `/operations/item?id=${encodeURIComponent(id)}`;
export const ruleHref = (key: string) => `/operations/rules?key=${encodeURIComponent(key)}`;

const statusMap = { Pending: "pending", "In progress": "in_progress", Approved: "approved", Rejected: "rejected", Returned: "returned", Cancelled: "cancelled", Failed: "failed" } as const;
const decisionMap = { approve: "approved", reject: "rejected", return: "returned" } as const;

function steps(instance: OperationInstance): OperationStep[] {
  const def = getDefinition(instance.operationType);
  return def.steps.map((s, i) => ({
    id: s.id,
    name: s.name,
    mode: s.mode,
    approvers: stepApproverLabel(s),
    status: i < instance.stepIndex ? "approved" : i === instance.stepIndex ? "current" : "pending",
    dueAt: i === instance.stepIndex ? stepDueAt(instance) : undefined,
    decisions: instance.decisions
      .filter((d) => d.stepId === s.id)
      .map((d, j) => ({ id: `${d.stepId}-${j}`, actor: { name: d.actorName, role: roleById[d.roleId]?.name }, decision: decisionMap[d.decision], time: dateTime(d.at), comment: d.comment || undefined })),
  }));
}

/** Pending operation for a subject: timeline, SLA, and (for an eligible approver) the inline decision form. */
export function PendingApproval({ subjectType, subjectId, notice }: { subjectType: string; subjectId: string; notice?: ReactNode }) {
  const pending = usePendingFor(subjectType, subjectId);
  const { actor } = useScope();
  const { toast } = useToast();
  const minComment = useRule<number>("operations.minCommentLength");
  const alwaysComment = useRule<boolean>("operations.commentAlwaysRequired");
  if (!pending) return null;
  const allowed = canDecide(pending, actor);
  const decide = async ({ decision, comment }: DecisionSubmission) => {
    const res = await decideOperation(pending.id, decision === "approve" ? "approve" : decision === "return" ? "return" : "reject", comment);
    if (!res.ok) toast({ title: "Decision not recorded", description: res.reason, tone: "danger" });
    else toast({ title: "Decision recorded", description: `${pending.title} — ${res.instance.status.toLowerCase()}.`, tone: "success" });
  };
  return (
    <Stack gap="medium">
      <WorkflowInstanceCard
        subject={{ title: pending.title, type: getDefinition(pending.operationType).name, href: operationHref(pending.id), reference: pending.id }}
        status={statusMap[pending.status]}
        requester={{ name: pending.requestedBy.name, role: roleById[pending.requestedBy.roleId]?.name }}
        submittedAt={dateTime(pending.requestedAt)}
        steps={steps(pending)}
        linkComponent={Link}
        actions={
          <Button as={Link} href={operationHref(pending.id)} size="small" variant="tertiary">
            Open in Operations
          </Button>
        }
      />
      {allowed.ok ? (
        <DecisionPanel
          actions={["approve", "return", "decline"]}
          commentRequired={alwaysComment ? true : ["return", "decline"]}
          minCommentLength={Math.max(1, minComment)}
          notice={notice}
          onDecide={decide}
        />
      ) : null}
    </Stack>
  );
}

/** Submit to the Operations workflow with consistent toasts. */
export function useSubmitOperation() {
  const { toast } = useToast();
  return useCallback(
    async <P,>(type: string, input: SubmitInput<P>) => {
      const res = await submitOperation<P>(type, input);
      if (!res.ok) toast({ title: "Not submitted", description: res.reason, tone: "danger" });
      else if (res.applied) toast({ title: "Applied", description: `${input.title} — the workflow has no approval steps, so it was applied directly.`, tone: "success" });
      else toast({ title: "Submitted for approval", description: `${input.title} — follow it in Operations → Approvals (${res.instance.id}).`, tone: "success" });
      return res;
    },
    [toast],
  );
}

function RuleLine({ ruleKey }: { ruleKey: string }) {
  const def = ruleDefinition(ruleKey);
  const value = useRule<RuleValue>(ruleKey);
  const pending = usePendingFor("Rule", ruleKey);
  const history = useRulesStore((s) => s.history.find((h) => h.key === ruleKey));
  if (!def) return null;
  return (
    <RuleRow
      linkComponent={Link}
      rule={{
        key: def.key,
        label: def.label,
        description: def.description,
        type: def.type,
        value,
        defaultValue: def.default,
        unit: def.unit,
        options: def.options,
        source: def.source,
        pending: pending ? { requestedBy: pending.requestedBy.name, requestedAt: dateTime(pending.requestedAt), href: operationHref(pending.id) } : false,
        changedBy: history?.byName,
        changedAt: history ? dateTime(history.at) : undefined,
      }}
      actions={
        <Button as={Link} href={ruleHref(def.key)} size="small" variant="tertiary">
          {pending ? "View request" : "Request change"}
        </Button>
      }
    />
  );
}

/** Business rules in force, with PRD source, pending changes and a link to request a change in Operations. */
export function RulesPanel({ title, description, keys }: { title: ReactNode; description?: ReactNode; keys: string[] }) {
  return (
    <Card>
      <CardHeader>
        <Stack gap="xsmall">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description ?? "Business rules (Rules & Parameters Engine). Changes are requested in Operations and apply everywhere once approved."}</CardDescription>
        </Stack>
      </CardHeader>
      <CardContent>
        <div>
          {keys.map((k) => (
            <RuleLine key={k} ruleKey={k} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
