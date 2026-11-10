"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { Badge, DataTable, EmptyState, Grid, Stack, StatCard, Tabs, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useHydrated } from "@/lib/auth/session";
import { dateTime } from "@/lib/format";
import { canDecide, getDefinition, stepDueAt, useOperationsStore, type OperationInstance, type OperationStatus } from "@/lib/platform/operations";
import { useScope } from "@/lib/platform/scope";
import { CREDIT_ANALYSIS_OPERATIONS } from "../platform";

const statusTone: Record<OperationStatus, "info" | "success" | "danger" | "warning" | "neutral"> = {
  Pending: "info",
  "In progress": "info",
  Approved: "success",
  Rejected: "danger",
  Returned: "warning",
  Cancelled: "neutral",
};

const opHref = (i: OperationInstance) => `/operations/item?id=${encodeURIComponent(i.id)}`;

/** "My 360 RAR requests": enrichment adjustments, advisory sign-offs and gating overrides scoped to the signed-in user. */
export function RequestsPage() {
  const hydrated = useHydrated();
  const { actor } = useScope();
  const instances = useOperationsStore((s) => s.instances);
  const mine = useMemo(() => instances.filter((i) => CREDIT_ANALYSIS_OPERATIONS.includes(i.operationType)), [instances]);
  const awaiting = useMemo(() => mine.filter((i) => canDecide(i, actor).ok), [mine, actor]);
  const requested = useMemo(() => mine.filter((i) => i.requestedBy.id === actor.id), [mine, actor.id]);
  const open = requested.filter((i) => i.status === "Pending" || i.status === "In progress");

  const columns: DataTableColumn<OperationInstance>[] = [
    {
      id: "title",
      header: "Request",
      accessor: (i) => i.title,
      sortable: true,
      cell: (i) => (
        <span className="flex flex-col">
          <span className="font-semibold text-fg">{i.title}</span>
          <span className="font-mono text-xs text-fg-muted">
            {i.id} · {getDefinition(i.operationType).name}
          </span>
        </span>
      ),
    },
    { id: "requestedBy", header: "Requested by", accessor: (i) => i.requestedBy.name, sortable: true },
    { id: "requestedAt", header: "Submitted", accessor: (i) => i.requestedAt, sortable: true, cell: (i) => <span className="font-mono text-sm">{dateTime(i.requestedAt)}</span> },
    {
      id: "due",
      header: "Step due",
      accessor: (i) => stepDueAt(i) ?? "",
      cell: (i) => {
        const due = i.status === "Pending" || i.status === "In progress" ? stepDueAt(i) : undefined;
        return <span className="font-mono text-sm">{due ? dateTime(due) : "—"}</span>;
      },
    },
    { id: "status", header: "Status", accessor: (i) => i.status, cell: (i) => <Badge tone={statusTone[i.status]}>{i.status}</Badge> },
  ];

  const table = (data: OperationInstance[], label: string, empty: string) => (
    <DataTable
      label={label}
      columns={columns}
      data={data}
      getRowId={(i) => i.id}
      getRowHref={opHref}
      linkComponent={Link}
      loading={!hydrated}
      searchable
      searchPlaceholder="Search request or obligor"
      defaultSort={{ id: "requestedAt", direction: "desc" }}
      filters={[{ id: "status", label: "Status" }]}
      emptyState={<EmptyState icon={<Inbox aria-hidden />} title="Nothing here" description={empty} />}
    />
  );

  return (
    <ModulePage
      module="credit-analysis"
      title="My 360 RAR requests"
      description="Enrichment adjustments, advisory-note sign-offs and life-cycle gating overrides routed through the Operations workflow — waiting for you, or raised by you."
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 3 }} gap="medium">
          <StatCard label="Awaiting my decision" value={String(awaiting.length)} tone="warning" hint="Segregation of duties: never your own requests" />
          <StatCard label="My open requests" value={String(open.length)} tone="info" hint="Pending or in progress" />
          <StatCard label="My decided requests" value={String(requested.length - open.length)} hint="Approved, rejected, returned or withdrawn" />
        </Grid>
        <Tabs
          label="Request views"
          defaultValue="awaiting"
          items={[
            { id: "awaiting", label: "Awaiting my decision", badge: awaiting.length ? String(awaiting.length) : undefined, content: table(awaiting, "360 RAR requests awaiting my decision", "No 360 RAR requests are waiting for your role.") },
            { id: "mine", label: "Raised by me", content: table(requested, "360 RAR requests raised by me", "You haven’t raised any 360 RAR requests.") },
          ]}
        />
      </Stack>
    </ModulePage>
  );
}
