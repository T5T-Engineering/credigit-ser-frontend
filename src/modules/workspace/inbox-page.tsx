"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Inbox, RotateCcw, Timer } from "lucide-react";
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
import { useAdminParams } from "@/modules/admin/store";
import { isDueSoon, isOverdue, useApprovalsAwaiting, useRoleTasks } from "./data";
import { useAuditLog } from "./use-audit-log";

type Row = {
  id: string;
  kind: "Approval" | "Task";
  title: string;
  detail: string;
  module: string;
  href: string;
  dueAt: string;
  priority: Task["priority"];
  status: Task["status"];
  stepUp?: boolean;
};

type View = "Open" | "Done" | "All";

const priorityRank: Record<Task["priority"], number> = { High: 0, Medium: 1, Low: 2 };

/** My tasks (PRD §4: work routed to the signed-in role) — store tasks + live approvals from the chart-flow. */
export function InboxPage() {
  const role = useRole()!;
  const tasks = useRoleTasks(role.id);
  const awaiting = useApprovalsAwaiting(role.id);
  const { obligor } = useLookups();
  const { update } = useDbActions();
  const params = useAdminParams();
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
      priority: app.amount > 1e9 || isOverdue(app.slaDueAt) ? "High" : "Medium",
      status: "Open",
      stepUp: app.amount > params.stepUpThresholdNgn,
    }));
    const own: Row[] = tasks.map((t) => ({ id: t.id, kind: "Task", title: t.title, detail: t.module, module: t.module, href: t.href, dueAt: t.dueAt, priority: t.priority, status: t.status }));
    return [...approvals, ...own].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.dueAt.localeCompare(b.dueAt));
  }, [awaiting, tasks, obligor, params.stepUpThresholdNgn]);

  const visible = view === "All" ? rows : rows.filter((r) => r.status === view);
  const open = rows.filter((r) => r.status === "Open");

  const setStatus = (row: Row, status: Task["status"]) => {
    update("tasks", row.id, { status });
    log({ action: status === "Done" ? "Marked task done" : "Reopened task", entityType: "Task", entityId: row.id, before: row.status, after: status });
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
    { id: "kind", header: "Type", accessor: "kind", cell: (r) => <Badge tone={r.kind === "Approval" ? "info" : "neutral"}>{r.kind}</Badge> },
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
        ) : isDueSoon(r.dueAt, 1) ? (
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
        r.kind === "Approval" ? (
          <Button size="small" as={Link} href={r.href}>
            Decide
          </Button>
        ) : r.status === "Open" ? (
          <Button size="small" variant="tertiary" iconBefore={<CheckCircle2 aria-hidden className="size-4" />} onClick={() => setStatus(r, "Done")}>
            Mark done
          </Button>
        ) : (
          <Button size="small" variant="text" iconBefore={<RotateCcw aria-hidden className="size-4" />} onClick={() => setStatus(r, "Open")}>
            Reopen
          </Button>
        ),
    },
  ];

  return (
    <ModulePage module="inbox" description={`Work routed to ${role.name}: approvals from the chart-flow and tasks assigned to your role.`}>
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Open" value={open.length} icon={<Inbox aria-hidden className="size-5" />} tone="accent" hint="Tasks and approvals" />
          <StatCard label="Awaiting my decision" value={awaiting.length} icon={<ClipboardList aria-hidden className="size-5" />} tone="info" hint={awaiting.length ? moneyShort(awaiting.reduce((s, a) => s + a.app.amount, 0)) : "None"} />
          <StatCard label="Overdue" value={open.filter((r) => isOverdue(r.dueAt)).length} icon={<Timer aria-hidden className="size-5" />} tone="danger" hint="Past due date / SLA" />
          <StatCard label="Done" value={rows.filter((r) => r.status === "Done").length} icon={<CheckCircle2 aria-hidden className="size-5" />} tone="success" hint="Completed tasks" />
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
                    { value: "Done", label: "Done" },
                    { value: "All", label: "All" },
                  ]}
                />
                <Text variant="small" tone="muted">
                  Approvals close when you decide on the application; approvals above {moneyShort(params.stepUpThresholdNgn)} need step-up authentication.
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
                        <Button size="small" variant="tertiary" onClick={() => setStatus(r, "Done")}>
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
