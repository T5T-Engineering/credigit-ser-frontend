"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Alert, Button, DecisionPanel, Stack, Text, type DecisionAction } from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { roleById } from "@/lib/rbac/roles";
import { actingRoles, canDecide, currentStep, stepDueAt, type OperationInstance } from "@/lib/platform/operations";
import { useScope } from "@/lib/platform/scope";
import { useRule } from "@/lib/platform/rules";
import { dateTime } from "@/lib/format";
import { decideApplicationOperation } from "../actions";

export const operationHref = (id: string) => `/operations/item?id=${id}`;

const toEngine: Record<DecisionAction, "approve" | "reject" | "return"> = { approve: "approve", recommend: "approve", decline: "reject", return: "return" };

/** Pending operation notice with a link to Operations; shows an inline decision panel when the signed-in user can act. */
export function PendingOperation({ instance, title, actions = ["approve", "decline"], actionLabels }: { instance: OperationInstance; title: string; actions?: DecisionAction[]; actionLabels?: Partial<Record<DecisionAction, string>> }) {
  const { actor } = useScope();
  const { toast } = useSaveFeedback();
  const minComment = useRule<number>("operations.minCommentLength");
  const allowed = canDecide(instance, actor);
  const step = currentStep(instance);
  const due = stepDueAt(instance);
  const waiting = actingRoles(instance).map((r) => roleById[r]?.name ?? r).join(", ");
  return (
    <Stack gap="medium">
      <Alert
        tone="warning"
        title={title}
        action={
          <Button as={Link} href={operationHref(instance.id)} variant="tertiary" size="small" iconAfter={<ArrowUpRight aria-hidden />}>
            Open in Operations
          </Button>
        }
      >
        <Text variant="small">
          {step ? `${step.name} — waiting on ${waiting || "—"}` : instance.status}
          {due ? ` · due ${dateTime(due)}` : ""} · requested by {instance.requestedBy.name} · {instance.id}
        </Text>
      </Alert>
      {allowed.ok ? (
        <DecisionPanel
          title={`Your decision — ${roleById[actor.roleId]?.name ?? actor.roleId}`}
          actions={actions}
          actionLabels={actionLabels}
          commentRequired
          minCommentLength={minComment}
          onDecide={async ({ decision, comment }) => {
            const res = await decideApplicationOperation(instance.id, toEngine[decision], comment);
            toast(res.ok ? { title: "Decision recorded", description: `${instance.title}`, tone: "success" } : { title: "Decision not recorded", description: res.reason, tone: "danger" });
          }}
        />
      ) : null}
    </Stack>
  );
}
