"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClock, CheckCheck, Inbox } from "lucide-react";
import { Button, EmptyState, FilterBar, Grid, Spinner, Stack, StatCard, WorkflowInstanceCard } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { dateTime } from "@/lib/format";
import { useMyApprovalQueue, useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { allNavItems } from "@/lib/nav";
import { BackendApprovalQueue } from "./backend-operations";
import { currentStepName, MS_PER_HOUR, roleName, safeDefinition, safeDueAt, uiStatus, useDefinitions, useNow, useOpsHydrated } from "./logic";

const moduleLabel = (m: string) => allNavItems.find((n) => n.module === m)?.label ?? (m === "platform" ? "Platform" : m);

/** Operations → Approvals: the signed-in user's approval queue (role match + segregation of duties). */
export function ApprovalsPage() {
  const { actor } = useScope();
  const queue = useMyApprovalQueue(actor);
  const instances = useOperationsStore((s) => s.instances);
  useDefinitions();
  const hydrated = useOpsHydrated();
  const now = useNow();
  const warnHours = useRule<number>("operations.slaWarningHours");
  const [moduleFilter, setModuleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [overdueFilter, setOverdueFilter] = useState("");
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () =>
      queue.map((i) => {
        const def = safeDefinition(i.operationType);
        const due = safeDueAt(i);
        return { i, def, due, overdue: !!due && now > 0 && new Date(due).getTime() < now };
      }),
    [queue, now],
  );

  const decidedToday = useMemo(() => {
    if (!now) return 0;
    const today = new Date(now).toDateString();
    return instances.reduce((n, i) => n + i.decisions.filter((d) => d.actorId === actor.id && new Date(d.at).toDateString() === today).length, 0);
  }, [instances, actor.id, now]);

  const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
  const modules = [...new Set(rows.map((r) => r.def?.module ?? "—"))];
  const types = [...new Map(rows.map((r) => [r.i.operationType, r.def?.name ?? r.i.operationType])).entries()];

  const filtered = rows.filter(
    (r) =>
      (!moduleFilter || r.def?.module === moduleFilter) &&
      (!typeFilter || r.i.operationType === typeFilter) &&
      (!overdueFilter || (overdueFilter === "overdue" ? r.overdue : !r.overdue)) &&
      (!search || `${r.i.title} ${r.i.id} ${r.i.requestedBy.name}`.toLowerCase().includes(search.toLowerCase())),
  );
  // Most urgent first.
  filtered.sort((a, b) => (a.due ? new Date(a.due).getTime() : Infinity) - (b.due ? new Date(b.due).getTime() : Infinity));

  return (
    <ModulePage module="operations" description={`Operations awaiting your decision as ${roleName(actor.roleId)}. You never see requests you raised yourself (segregation of duties).`}>
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 3 }} gap="medium">
          <StatCard label="Awaiting me" value={String(rows.length)} icon={<Inbox aria-hidden />} hint="Steps where your role acts now" />
          <StatCard label="Overdue vs SLA" value={String(count((r) => r.overdue))} icon={<AlarmClock aria-hidden />} tone={count((r) => r.overdue) ? "danger" : "neutral"} hint={`Amber within ${warnHours} h of due (business rule)`} />
          <StatCard label="Decided today" value={String(decidedToday)} icon={<CheckCheck aria-hidden />} hint="Your decisions since midnight" />
        </Grid>

        <FilterBar
          label="Filter approvals"
          search={{ value: search, onChange: setSearch, placeholder: "Search title, reference or requester", label: "Search approvals" }}
          filters={[
            { id: "module", label: "Module", value: moduleFilter, onChange: setModuleFilter, options: modules.map((m) => ({ value: m, label: moduleLabel(m), count: count((r) => r.def?.module === m) })) },
            { id: "type", label: "Operation", value: typeFilter, onChange: setTypeFilter, options: types.map(([v, l]) => ({ value: v, label: l, count: count((r) => r.i.operationType === v) })) },
            {
              id: "overdue",
              label: "SLA",
              value: overdueFilter,
              onChange: setOverdueFilter,
              options: [
                { value: "overdue", label: "Overdue", count: count((r) => r.overdue) },
                { value: "on-time", label: "Within SLA", count: count((r) => !r.overdue) },
              ],
            },
          ]}
          onClearAll={() => {
            setModuleFilter("");
            setTypeFilter("");
            setOverdueFilter("");
            setSearch("");
          }}
        />

        <BackendApprovalQueue />
        {!hydrated ? (
          <Spinner label="Loading approvals" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Inbox aria-hidden />}
            title={rows.length ? "No approvals match these filters" : "Nothing awaits your decision"}
            description={rows.length ? "Clear the filters to see your whole queue." : "When a request reaches a step for your role it appears here and you're notified."}
            action={
              <Button href="/operations/requests" as={Link} variant="tertiary">
                See my requests
              </Button>
            }
          />
        ) : (
          <Grid columns={{ base: 1, lg: 2 }} gap="medium">
            {filtered.map(({ i, def, due }) => (
              <WorkflowInstanceCard
                key={i.id}
                subject={{ title: i.title, type: `${def?.name ?? i.operationType} · ${moduleLabel(def?.module ?? "")}`, href: `/operations/item?id=${i.id}`, reference: i.id }}
                status={uiStatus(i.status)}
                requester={{ name: i.requestedBy.name, role: roleName(i.requestedBy.roleId) }}
                submittedAt={dateTime(i.requestedAt)}
                currentStep={currentStepName(i, def)}
                dueAt={due}
                now={now || undefined}
                warnWithinMs={warnHours * MS_PER_HOUR}
                linkComponent={Link}
                actions={
                  <Button href={`/operations/item?id=${i.id}`} as={Link} size="small">
                    Review & decide
                  </Button>
                }
              />
            ))}
          </Grid>
        )}
      </Stack>
    </ModulePage>
  );
}
