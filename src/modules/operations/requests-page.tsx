"use client";

import { useState } from "react";
import Link from "next/link";
import { Send, Undo2 } from "lucide-react";
import { Button, EmptyState, Field, Grid, Modal, Spinner, Stack, SubmitButton, Tabs, Textarea, WorkflowInstanceCard } from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { ModulePage } from "@/components/module-page";
import { dateTime } from "@/lib/format";
import { cancelOperation, useMyRequests, type OperationInstance, type OperationStatus } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { useCan } from "@/lib/iam/permissions";
import { currentStepName, isOpen, MS_PER_HOUR, roleName, safeDefinition, safeDueAt, timelineSteps, uiStatus, useDefinitions, useNow, useOpsHydrated } from "./logic";

const tabs: { id: string; label: string; match: (s: OperationStatus) => boolean }[] = [
  { id: "open", label: "Open", match: (s) => s === "Pending" || s === "In progress" },
  { id: "approved", label: "Approved", match: (s) => s === "Approved" },
  { id: "rejected", label: "Rejected", match: (s) => s === "Rejected" },
  { id: "returned", label: "Returned", match: (s) => s === "Returned" },
  { id: "cancelled", label: "Withdrawn", match: (s) => s === "Cancelled" },
];

/** Operations → My requests: everything the signed-in user submitted, by status; withdraw open ones. */
export function RequestsPage() {
  const { actor } = useScope();
  const requests = useMyRequests(actor.id);
  const hydrated = useOpsHydrated();
  useDefinitions();
  const now = useNow();
  const warnHours = useRule<number>("operations.slaWarningHours");
  const minComment = useRule<number>("operations.minCommentLength");
  const canWithdraw = useCan("operations.items.withdraw");
  const { toast } = useSaveFeedback();
  const [withdrawing, setWithdrawing] = useState<OperationInstance | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirmWithdraw() {
    if (!withdrawing) return;
    setBusy(true);
    const res = await cancelOperation(withdrawing.id, reason.trim());
    setBusy(false);
    if (res.ok) {
      toast({ title: "Request withdrawn", description: withdrawing.title, tone: "success" });
      setWithdrawing(null);
      setReason("");
    } else toast({ title: "Couldn't withdraw", description: res.reason, tone: "danger" });
  }

  const list = (items: OperationInstance[], tabLabel: string) =>
    items.length === 0 ? (
      <EmptyState icon={<Send aria-hidden />} title={`No ${tabLabel.toLowerCase()} requests`} description="Requests you submit anywhere in the platform (rule changes, workflow edits, waivers…) appear here." />
    ) : (
      <Grid columns={{ base: 1, lg: 2 }} gap="medium">
        {items.map((i) => {
          const def = safeDefinition(i.operationType);
          return (
            <WorkflowInstanceCard
              key={i.id}
              subject={{ title: i.title, type: def?.name ?? i.operationType, href: `/operations/item?id=${i.id}`, reference: i.id }}
              status={uiStatus(i.status)}
              requester={{ name: i.requestedBy.name, role: roleName(i.requestedBy.roleId) }}
              submittedAt={dateTime(i.requestedAt)}
              currentStep={currentStepName(i, def)}
              dueAt={safeDueAt(i)}
              steps={timelineSteps(i, def)}
              showTimeline={false}
              now={now || undefined}
              warnWithinMs={warnHours * MS_PER_HOUR}
              linkComponent={Link}
              actions={
                <Stack direction="horizontal" gap="small" wrap>
                  <Button as={Link} href={`/operations/item?id=${i.id}`} size="small" variant="tertiary">
                    Open
                  </Button>
                  {canWithdraw && isOpen(i) ? (
                    <SubmitButton size="small" variant="danger" iconBefore={<Undo2 aria-hidden />} onClick={() => setWithdrawing(i)}>
                      Withdraw
                    </SubmitButton>
                  ) : null}
                </Stack>
              }
            />
          );
        })}
      </Grid>
    );

  return (
    <ModulePage module="operations" description="Everything you've submitted for approval, across every module.">
      {!hydrated ? (
        <Spinner label="Loading your requests" />
      ) : (
        <Tabs
          variant="underline"
          defaultValue="open"
          items={tabs.map((t) => {
            const items = requests.filter((r) => t.match(r.status));
            return { id: t.id, label: t.label, badge: items.length ? String(items.length) : undefined, content: list(items, t.label) };
          })}
        />
      )}
      <Modal
        open={!!withdrawing}
        onOpenChange={(o) => {
          if (!o) setWithdrawing(null);
        }}
        title="Withdraw request"
        description={withdrawing?.title}
        footer={
          <Stack direction="horizontal" gap="small" justify="end">
            <Button variant="tertiary" onClick={() => setWithdrawing(null)}>
              Keep request
            </Button>
            <SubmitButton variant="danger" loading={busy} disabled={reason.trim().length < minComment} onClick={confirmWithdraw}>
              Withdraw
            </SubmitButton>
          </Stack>
        }
      >
        <Field label="Reason" description={`At least ${minComment} characters. Approvers see this.`} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      </Modal>
    </ModulePage>
  );
}
