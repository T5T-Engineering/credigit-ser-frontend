"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Inbox, RotateCcw, Send, Timer } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  Grid,
  SegmentedControl,
  Stack,
  StatCard,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import { useDbActions, useLookups } from "@/lib/data/hooks";
import type { Task } from "@/lib/data/types";
import { date, moneyShort } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { currentStep, getDefinition, stepDueAt, useMyApprovalQueue, useMyRequests, type OperationInstance } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { isDueSoon, isOverdue, useApprovalsAwaiting, useRoleTasks } from "./data";
import { useAuditLog } from "./use-audit-log";

type Row = {
  id: string;
  kind: "Approval" | "Operation" | "Request" | "Task";
  title: string;
  detail: string;
  module: string;
  href: string;
  dueAt: string;
  priority: Task["priority"];
  status: Task["status"];
  stepUp?: boolean;
};

type View = "Open" | "Requests" | "Done" | "All";

const openStatus = (i: OperationInstance) => i.status === "Pending" || i.status === "In progress";
const opHref = (i: OperationInstance) => `/operations/item?id=${i.id}`;

const priorityRank: Record<Task["priority"], number> = { High: 0, Medium: 1, Low: 2 };

/** My tasks (PRD §4: work routed to the signed-in user) — store tasks, chart-flow approvals, Operations approvals and my requests. */
export function InboxPage() {
  const role = useRole()!;
  const tasks = useRoleTasks(role.id);
  const awaiting = useApprovalsAwaiting(role.id);
  const { obligor } = useLookups();
  const { update } = useDbActions();
  const { actor } = useScope();
  // Credit approvals already listed from the chart-flow aren't repeated as Operations items.
  const opsQueue = useMyApprovalQueue(actor).filter((i) => !awaiting.some((a) => a.app.id === i.subject.id));
  const myRequests = useMyRequests(actor.id);
  const stepUp = useRule<number>("approvals.stepUpThresholdNgn");
  const highAmount = useRule<number>("workspace.highPriorityAmountNgn");
  const dueSoonDays = useRule<number>("workspace.taskDueSoonDays");
  const log = useAuditLog();
  const [view, setView] = useState<View>("Open");

  const rows: Row[] = useMemo(() => {
    const approvals: Row[] = awaiting.map(({ app, step }) => ({
      id: `${app.id}:${step.id}`,
      kind: "Approval",
      title: `${step.tier === 1 ? "Recommend" : step.adjudicates ? "Adjudicate" : "Approve"} ${app.id} — ${obligor.get(app.obligorId)?.name ?? ""}`,
      detail: `${app.product} · ${moneyShort(app.amount)} · ${step.adjudicates ? `dissent on ${step.adjudicates}` : step.pair ? `co-signer pair ${step.pair}` : `tier ${step.tier}`}`,
      module: "Loan origination",
      href: `/origination/application?id=${app.id}`,
      dueAt: app.slaDueAt,
      priority: app.amount > highAmount || isOverdue(app.slaDueAt) ? "High" : "Medium",
      status: "Open",
      stepUp: app.amount > stepUp,
    }));
    const operations: Row[] = opsQueue.map((i) => {
      const due = stepDueAt(i) ?? i.requestedAt;
      return {
        id: `ops:${i.id}`,
        kind: "Operation",
        title: i.title,
        detail: `${getDefinition(i.operationType).name} · step “${currentStep(i)?.name ?? "—"}” · requested by ${i.requestedBy.name}`,
        module: "Operations",
        href: opHref(i),
        dueAt: due,
        priority: isOverdue(due) ? "High" : "Medium",
        status: "Open",
      };
    });
    const requests: Row[] = myRequests.map((i) => ({
      id: `req:${i.id}`,
      kind: "Request",
      title: i.title,
      detail: `${getDefinition(i.operationType).name} · ${openStatus(i) ? `waiting on “${currentStep(i)?.name ?? "—"}”` : i.status}`,
      module: "Operations",
      href: opHref(i),
      dueAt: stepDueAt(i) ?? i.completedAt ?? i.requestedAt,
      priority: "Low",
      status: openStatus(i) ? "Open" : "Done",
    }));
    const own: Row[] = tasks.map((t) => ({ id: t.id, kind: "Task", title: t.title, detail: t.module, module: t.module, href: t.href, dueAt: t.dueAt, priority: t.priority, status: t.status }));
    return [...approvals, ...operations, ...requests, ...own].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.dueAt.localeCompare(b.dueAt));
  }, [awaiting, tasks, obligor, stepUp, highAmount, opsQueue, myRequests]);

  const work = rows.filter((r) => r.kind !== "Request");
  const visible = view === "All" ? rows : view === "Requests" ? rows.filter((r) => r.kind === "Request") : work.filter((r) => r.status === view);
  const open = work.filter((r) => r.status === "Open");

  const setStatus = async (row: Row, status: Task["status"]) => {
    const hook = await runHooks("workspace.task.update.before", { taskId: row.id, from: row.status, to: status });
    if (!hook.ok) return;
    update("tasks", row.id, { status });
    log({ action: status === "Done" ? "Marked task done" : "Reopened task", entityType: "Task", entityId: row.id, before: row.status, after: status });
    publish(status === "Done" ? "workspace.task.completed" : "workspace.task.reopened", { module: "workspace", subject: { type: "Task", id: row.id, title: row.title, href: row.href }, payload: { taskId: row.id } });
    await runHooks("workspace.task.update.after", { taskId: row.id, status });
  };

  const columns: DataTableColumn<Row>[] = [
    {
      id: "title",
      header: "Task",
      accessor: "title",
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <Link href={r.href} className="font-semibold text-fg hover:text-link focus-visible:outline-2 focus-visible:outline-focus">
            {r.title}
          </Link>
          <span className="text-sm text-fg-muted">{r.detail}</span>
        </span>
      ),
    },
    { id: "kind", header: "Type", accessor: "kind", cell: (r) => <Badge tone={r.kind === "Approval" || r.kind === "Operation" ? "info" : r.kind === "Request" ? "accent" : "neutral"}>{r.kind === "Request" ? "My request" : r.kind}</Badge> },
    { id: "module", header: "Module", accessor: "module", hidden: true },
    {
      id: "priority",
      header: "Priority",
      accessor: "priority",
      sortable: true,
      sortValue: (r) => priorityRank[r.priority],
      cell: (r) => <Badge tone={r.priority === "High" ? "danger" : r.priority === "Medium" ? "warning" : "neutral"}>{r.priority}</Badge>,
    },
    {
      id: "due",
      header: "Due",
      accessor: "dueAt",
      sortable: true,
      csv: (r) => date(r.dueAt),
      cell: (r) =>
        r.status === "Done" ? (
          <span className="font-mono text-fg-muted">{date(r.dueAt)}</span>
        ) : isOverdue(r.dueAt) ? (
          <Badge tone="danger" variant="solid">
            Overdue · {date(r.dueAt)}
          </Badge>
        ) : isDueSoon(r.dueAt, dueSoonDays) ? (
          <Badge tone="warning">Due {date(r.dueAt)}</Badge>
        ) : (
          <span className="font-mono">{date(r.dueAt)}</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      accessor: "status",
      cell: (r) => (r.status === "Done" ? <Badge tone="success">Done</Badge> : r.stepUp ? <Badge tone="accent">Step-up required</Badge> : <Badge variant="outline">Open</Badge>),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      align: "end",
      cell: (r) =>
        r.kind === "Approval" || r.kind === "Operation" ? (
          <Button size="small" as={Link} href={r.href}>
            Decide
          </Button>
        ) : r.kind === "Request" ? (
          <Button size="small" variant="tertiary" as={Link} href={r.href}>
            Track
          </Button>
        ) : r.status === "Open" ? (
          <Button size="small" variant="tertiary" iconBefore={<CheckCircle2 aria-hidden className="size-4" />} onClick={() => void setStatus(r, "Done")}>
            Mark done
          </Button>
        ) : (
          <Button size="small" variant="text" iconBefore={<RotateCcw aria-hidden className="size-4" />} onClick={() => void setStatus(r, "Open")}>
            Reopen
          </Button>
        ),
    },
  ];

  return (
    <ModulePage module="inbox" description={`Work routed to you as ${role.name}: chart-flow approvals, Operations approvals, tasks for your role — and the requests you've raised.`}>
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Open" value={open.length} icon={<Inbox aria-hidden className="size-5" />} tone="accent" hint="Tasks and approvals" />
          <StatCard label="Awaiting my decision" value={awaiting.length + opsQueue.length} icon={<ClipboardList aria-hidden className="size-5" />} tone="info" hint={`${awaiting.length} credit (${moneyShort(awaiting.reduce((s, a) => s + a.app.amount, 0))}) · ${opsQueue.length} in Operations`} />
          <StatCard label="Overdue" value={open.filter((r) => isOverdue(r.dueAt)).length} icon={<Timer aria-hidden className="size-5" />} tone="danger" hint="Past due date / SLA" />
          <StatCard label="My requests" value={myRequests.filter(openStatus).length} icon={<Send aria-hidden className="size-5" />} tone="neutral" hint={`${myRequests.length} raised · in progress`} />
        </Grid>
        <Card>
          <CardContent>
            <Stack gap="medium">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SegmentedControl
                  label="Show"
                  value={view}
                  onChange={(v) => setView(v as View)}
                  options={[
                    { value: "Open", label: `Open (${open.length})` },
                    { value: "Requests", label: `My requests (${myRequests.filter(openStatus).length})` },
                    { value: "Done", label: "Done" },
                    { value: "All", label: "All" },
                  ]}
                />
                <Text variant="small" tone="muted">
                  Credit approvals close when you decide on the application; above {moneyShort(stepUp)} they need step-up authentication. Other approvals are decided in Operations.
                </Text>
              </div>
              <DataTable
                columns={columns}
                data={visible}
                getRowId={(r) => r.id}
                label="My tasks"
                searchable
                searchPlaceholder="Search tasks…"
                filters={[
                  { id: "priority", label: "Priority", columnId: "priority" },
                  { id: "kind", label: "Type", columnId: "kind" },
                  { id: "module", label: "Module", columnId: "module" },
                ]}
                exportFilename="my-tasks.csv"
                emptyState={
                  <EmptyState
                    icon={<CheckCircle2 aria-hidden />}
                    title={view === "Done" ? "Nothing completed yet" : "You're all caught up"}
                    description={view === "Done" ? "Tasks you mark done appear here." : "New approvals and tasks appear here as soon as they're routed to your role."}
                  />
                }
                mobileCard={(r) => (
                  <div className="flex flex-col gap-2">
                    <Link href={r.href} className="font-semibold text-fg">
                      {r.title}
                    </Link>
                    <span className="text-sm text-fg-muted">{r.detail}</span>
                    <span className="flex flex-wrap gap-2">
                      <Badge tone={r.priority === "High" ? "danger" : "warning"}>{r.priority}</Badge>
                      {r.status === "Open" && isOverdue(r.dueAt) ? <Badge tone="danger">Overdue</Badge> : <Badge variant="outline">Due {date(r.dueAt)}</Badge>}
                      {r.kind === "Task" && r.status === "Open" ? (
                        <Button size="small" variant="tertiary" onClick={() => void setStatus(r, "Done")}>
                          Mark done
                        </Button>
                      ) : null}
                    </span>
                  </div>
                )}
              />
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </ModulePage>
  );
}
