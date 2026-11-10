"use client";

import { useState } from "react";
import { DataTable, EmptyState, SegmentedControl, Stack, StatCard, Grid, StatusBadge, Text, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { dateTime, number } from "@/lib/format";
import { useScope } from "@/lib/platform/scope";
import { connectors, type Run } from "../data";
import { fmtLatency, useAllRuns, useLoadedAt } from "../views";

type Row = Run & { name: string };

export function RunsPage() {
  const loadedAt = useLoadedAt();
  const allRuns = useAllRuns(loadedAt);
  const { actor } = useScope();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const nameOf = new Map(connectors.map((c) => [c.id, c.name]));
  const mine = allRuns.filter((r) => r.by === actor.name);
  const rows: Row[] = (scope === "mine" ? mine : allRuns).map((r) => ({ ...r, name: nameOf.get(r.connectorId) ?? r.connectorId }));

  const columns: DataTableColumn<Row>[] = [
    { id: "id", header: "Run", accessor: "id", cell: (r) => <span className="font-mono">{r.id}</span> },
    { id: "name", header: "Connector", accessor: "name", sortable: true },
    { id: "started", header: "Started", accessor: "startedAt", sortable: true, cell: (r) => dateTime(r.startedAt) },
    { id: "duration", header: "Duration", accessor: "durationMs", numeric: true, sortable: true, cell: (r) => fmtLatency(r.durationMs) },
    { id: "records", header: "Records", accessor: "records", numeric: true, sortable: true, cell: (r) => number(r.records) },
    { id: "trigger", header: "Trigger", accessor: "trigger", sortable: true, cell: (r) => (r.by ? `${r.trigger} · ${r.by}` : r.trigger) },
    {
      id: "status",
      header: "Result",
      accessor: "status",
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <StatusBadge status={r.status} tones={{ Success: "success", Partial: "warning", Failed: "danger" }} />
          {r.message && (
            <Text variant="caption" tone="subtle">
              {r.message}
            </Text>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <ModulePage module="connectors" description="Scheduled, event-driven and manual connector runs into the staging layer (PRD §5, §4.6). Simulated.">
      <Stack gap="large">
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Runs shown" value={number(allRuns.length)} />
          <StatCard label="Failed" value={number(allRuns.filter((r) => r.status === "Failed").length)} tone="danger" />
          <StatCard label="Partial" value={number(allRuns.filter((r) => r.status === "Partial").length)} tone="warning" />
          <StatCard label="Triggered by me" value={number(mine.length)} tone="info" />
        </Grid>
        <SegmentedControl
          label="Runs"
          size="small"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All runs" },
            { value: "mine", label: "Triggered by me" },
          ]}
        />
        <DataTable
          label="Recent connector runs"
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          density="compact"
          defaultSort={{ id: "started", direction: "desc" }}
          filters={[
            { id: "name", label: "Connector", columnId: "name" },
            { id: "status", label: "Result", columnId: "status" },
          ]}
          emptyState={scope === "mine" ? <EmptyState title="No runs triggered by you" description="Runs you start with “Run now” on the connectors overview appear here." /> : undefined}
          exportFilename="connector-runs.csv"
        />
      </Stack>
    </ModulePage>
  );
}
