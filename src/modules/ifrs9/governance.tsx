"use client";

/**
 * Governance compositions shared by the IFRS 9 / ICAAP and Market & Liquidity Risk modules (invariants 8 & 9):
 * business-rule panels (values from the rules registry, changes routed through Operations), pending-approval
 * notices, Operations submit helper and the module approvals list. Compositions of @credigit/web-ui only.
 */
import { useCallback, type ReactNode } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  RuleRow,
  Stack,
  Text,
  WorkflowInstanceCard,
  useToast,
  type OperationStep,
  type OperationStatus as UiOperationStatus,
} from "@credigit/web-ui";
import { roleById } from "@/lib/rbac/roles";
import { dateTime } from "@/lib/format";
import {
  getDefinition,
  operationTypes,
  stepApproverLabel,
  stepDueAt,
  submitOperation,
  useOperationsStore,
  usePendingFor,
  type OperationInstance,
  type SubmitInput,
} from "@/lib/platform/operations";
import { ruleDefinition, useRule, useRulesStore, type RuleValue } from "@/lib/platform/rules";

export const operationHref = (id: string) => `/operations/item?id=${encodeURIComponent(id)}`;
export const ruleHref = (key: string) => `/operations/rules?key=${encodeURIComponent(key)}`;

/** Re-render when any business rule changes (engine functions read rules with getRule at call time). */
export function useRulesVersion() {
  return useRulesStore((s) => s.values);
}

// ---------------------------------------------------------------- business rules

function RuleLine({ ruleKey, canRequest }: { ruleKey: string; canRequest: boolean }) {
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
        canRequest ? (
          <Button as={Link} href={ruleHref(def.key)} size="small" variant="secondary">
            {pending ? "View request" : "Request change"}
          </Button>
        ) : undefined
      }
    />
  );
}

/** Card listing business rules with their current value, PRD source and pending changes. */
export function RulesPanel({ title, description, keys, canRequest }: { title: ReactNode; description?: ReactNode; keys: string[]; canRequest: boolean }) {
  return (
    <Card variant="outlined">
      <CardHeader>
        <Stack gap="xsmall">
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {description ?? "Business rules (Rules & Parameters Engine). Changes are requested in Operations and take effect only after approval."}
          </CardDescription>
        </Stack>
      </CardHeader>
      <CardContent>
        <div>
          {keys.map((k) => (
            <RuleLine key={k} ruleKey={k} canRequest={canRequest} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- operations

/** "Awaiting approval" notice with a link to the Operations item. */
export function PendingNotice({ subjectType, subjectId, children }: { subjectType: string; subjectId: string; children?: ReactNode }) {
  const pending = usePendingFor(subjectType, subjectId);
  if (!pending) return null;
  const step = getDefinition(pending.operationType).steps[pending.stepIndex];
  return (
    <Alert tone="info" title="Awaiting approval in Operations">
      <Stack gap="small">
        <Text variant="small">
          {pending.title} — requested by {pending.requestedBy.name}, {dateTime(pending.requestedAt)}
          {step ? ` · current step “${step.name}” (${stepApproverLabel(step)})` : ""}. {children}
        </Text>
        <div>
          <Button as={Link} href={operationHref(pending.id)} size="small" variant="secondary">
            Open approval
          </Button>
        </div>
      </Stack>
    </Alert>
  );
}

/** Submit to the Operations workflow with consistent toasts. Returns the result. */
export function useSubmitOperation() {
  const { toast } = useToast();
  return useCallback(
    async <P,>(type: string, input: SubmitInput<P>) => {
      const res = await submitOperation<P>(type, input);
      if (!res.ok) toast({ title: "Not submitted", description: res.reason, tone: "danger" });
      else if (res.applied) toast({ title: "Applied", description: `${input.title} — workflow has no approval steps, applied directly.`, tone: "success" });
      else toast({ title: "Submitted for approval", description: `${input.title} — follow it in Operations → Approvals (${res.instance.id}).`, tone: "success" });
      return res;
    },
    [toast],
  );
}

export const uiStatus: Record<OperationInstance["status"], UiOperationStatus> = {
  Pending: "pending",
  "In progress": "in_progress",
  Approved: "approved",
  Rejected: "rejected",
  Returned: "returned",
  Cancelled: "cancelled",
};

export function stepsFor(i: OperationInstance): OperationStep[] {
  const def = getDefinition(i.operationType);
  const open = i.status === "Pending" || i.status === "In progress";
  return def.steps.map((s, idx) => {
    const decisions = i.decisions.filter((d) => d.stepId === s.id);
    let status: OperationStep["status"] = "pending";
    if (idx < i.stepIndex) status = "approved";
    else if (idx === i.stepIndex) status = open ? "current" : i.status === "Approved" ? "approved" : i.status === "Rejected" ? "rejected" : i.status === "Returned" ? "returned" : "pending";
    else if (i.status === "Approved") status = "approved";
    return {
      id: s.id,
      name: s.name,
      mode: s.mode,
      approvers: stepApproverLabel(s),
      status,
      dueAt: status === "current" ? stepDueAt(i) : undefined,
      decisions: decisions.map((d) => ({
        actor: { name: d.actorName, role: roleById[d.roleId]?.name },
        decision: d.decision === "approve" ? "approved" : d.decision === "reject" ? "rejected" : "returned",
        time: dateTime(d.at),
        comment: d.comment || undefined,
      })),
    };
  });
}

/** Operations (approvals) belonging to the given modules, newest first. */
export function useModuleOperations(modules: string[]) {
  const instances = useOperationsStore((s) => s.instances);
  const types = new Set(operationTypes().filter((h) => modules.includes(h.module)).map((h) => h.type));
  return instances.filter((i) => types.has(i.operationType));
}

/** Approvals list for a module page. */
export function ModuleApprovals({ modules, title = "Approvals in Operations", limit }: { modules: string[]; title?: ReactNode; limit?: number }) {
  const list = useModuleOperations(modules);
  const shown = limit ? list.slice(0, limit) : list;
  return (
    <Card variant="outlined">
      <CardHeader>
        <Stack gap="xsmall">
          <CardTitle>{title}</CardTitle>
          <CardDescription>Every approval in this module is routed through the Operations workflow (configurable steps, approvers and SLAs).</CardDescription>
        </Stack>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <EmptyState title="No approvals yet" description="Requests submitted from this module appear here with their workflow progress." />
        ) : (
          <Stack gap="medium">
            {shown.map((i) => (
              <WorkflowInstanceCard
                key={i.id}
                linkComponent={Link}
                subject={{ title: i.title, type: getDefinition(i.operationType).name, href: operationHref(i.id), reference: i.id }}
                status={uiStatus[i.status]}
                requester={{ name: i.requestedBy.name, role: roleById[i.requestedBy.roleId]?.name }}
                submittedAt={dateTime(i.requestedAt)}
                steps={stepsFor(i)}
                showTimeline={i.status === "Pending" || i.status === "In progress"}
                actions={
                  <Button as={Link} href={operationHref(i.id)} size="small" variant="secondary">
                    Open
                  </Button>
                }
              />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
