"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClock, FilePlus2, Gauge, Hourglass, Layers, LayoutGrid, ListChecks, ShieldAlert, Table2, Zap } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Grid,
  KanbanBoard,
  SegmentedControl,
  StatCard,
  Stack,
  StatusBadge,
  Text,
  type DataTableColumn,
  type KanbanCard,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useApplications, useLookups } from "@/lib/data/hooks";
import type { Application, Obligor } from "@/lib/data/types";
import { roleById } from "@/lib/rbac/roles";
import { date, moneyShort, money } from "@/lib/format";
import { currentSteps, inMyQueue, isBreach, isOpen, pipelineStages, slaState, slaTones, stageTones, type SlaState } from "../logic";
import { initiatorRoles, useMe } from "../use-me";

type Row = {
  id: string;
  app: Application;
  obligor?: Obligor;
  obligorName: string;
  branch: string;
  sla: SlaState;
  nextAction: string;
  officer: string;
};

const ALL = "all";

export function nextActionFor(a: Application): string {
  switch (a.stage) {
    case "Draft":
      return "AO to complete and submit";
    case "Documents":
      return "OCR / document verification";
    case "Analysis":
      return "Credit Analyst — validation & 360 RAR";
    case "Recommendation":
    case "Approval": {
      if (isBreach(a.limitGate)) return "CRO / Board — limit exception";
      const steps = currentSteps(a.approvals);
      if (!steps.length) return "Release to offer letter";
      return steps.map((s) => (s.adjudicates ? `${roleById[s.roleId].short} (adjudicator)` : roleById[s.roleId].short)).join(" + ");
    }
    case "Offer":
      return "AO — present offer letter";
    case "Conditions":
      return "Legal / Credit Admin — CPs";
    case "Disbursement":
      return "Disbursement Maker / Checker";
    default:
      return "—";
  }
}

export function OriginationPipelinePage() {
  const applications = useApplications();
  const lookups = useLookups();
  const { user, roleId } = useMe();
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [view, setView] = useState<"board" | "table">("board");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState(ALL);
  const [flow, setFlow] = useState(ALL);
  const [product, setProduct] = useState(ALL);
  const [branch, setBranch] = useState(ALL);
  const [sla, setSla] = useState(ALL);

  const rows: Row[] = useMemo(
    () =>
      applications.map((a) => {
        const o = lookups.obligor.get(a.obligorId);
        return {
          id: a.id,
          app: a,
          obligor: o,
          obligorName: o?.name ?? a.obligorId,
          branch: o?.branch ?? "—",
          sla: slaState(a),
          nextAction: nextActionFor(a),
          officer: lookups.user.get(a.createdById)?.name ?? "—",
        };
      }),
    [applications, lookups],
  );
  const myQueue = useMemo(() => rows.filter((r) => inMyQueue(r.app, roleId, user.id)), [rows, roleId, user.id]);
  const base = scope === "mine" ? myQueue : rows;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return base.filter(
      (r) =>
        (stage === ALL || r.app.stage === stage) &&
        (flow === ALL || r.app.flow === flow) &&
        (product === ALL || r.app.product === product) &&
        (branch === ALL || r.branch === branch) &&
        (sla === ALL || r.sla === sla) &&
        (!q || r.id.toLowerCase().includes(q) || r.obligorName.toLowerCase().includes(q) || r.app.purpose.toLowerCase().includes(q)),
    );
  }, [base, search, stage, flow, product, branch, sla]);

  const facet = (get: (r: Row) => string) => {
    const counts = new Map<string, number>();
    for (const r of base) counts.set(get(r), (counts.get(get(r)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }));
  };

  const open = rows.filter((r) => isOpen(r.app));
  const inApproval = rows.filter((r) => r.app.stage === "Approval" || r.app.stage === "Recommendation");
  const breached = open.filter((r) => r.sla === "Breached");
  const fastTrack = open.filter((r) => r.app.flow === "Fast-Track");
  const approved = rows.filter((r) => ["Offer", "Conditions", "Disbursement", "Booked"].includes(r.app.stage));
  const sum = (xs: Row[]) => xs.reduce((s, r) => s + r.app.amount, 0);

  const canInitiate = Boolean(roleId && initiatorRoles.includes(roleId));
  const columns = pipelineStages.filter((s) => s.id !== "Withdrawn" || rows.some((r) => r.app.stage === "Withdrawn"));

  const cards: KanbanCard[] = filtered.map((r) => ({
    id: r.id,
    columnId: r.app.stage,
    title: r.obligorName,
    textTitle: `${r.id} ${r.obligorName}`,
    meta: (
      <span className="font-mono">
        {r.id} · {moneyShort(r.app.amount)} · {r.app.product}
      </span>
    ),
    badges: [
      ...(r.app.flow === "Fast-Track" ? [{ label: "Fast-Track", tone: "accent" as const }] : []),
      ...(r.sla === "Breached" ? [{ label: "SLA breached", tone: "danger" as const }] : r.sla === "Due soon" ? [{ label: "SLA due soon", tone: "warning" as const }] : []),
      ...(isBreach(r.app.limitGate) ? [{ label: "Limit breach", tone: "danger" as const }] : []),
    ],
    assignee: { name: r.officer },
    href: `/origination/application/?id=${r.id}`,
    footer: <Text variant="caption" tone="muted">Next: {r.nextAction}</Text>,
  }));

  const tableColumns: DataTableColumn<Row>[] = [
    { id: "id", header: "Application", accessor: "id", sortable: true, cell: (r) => <span className="font-mono">{r.id}</span> },
    { id: "obligor", header: "Obligor", accessor: "obligorName", sortable: true },
    { id: "product", header: "Product", accessor: (r) => r.app.product, sortable: true },
    { id: "amount", header: "Amount", accessor: (r) => r.app.amount, numeric: true, sortable: true, cell: (r) => moneyShort(r.app.amount), csv: (r: Row) => String(r.app.amount) },
    { id: "flow", header: "Flow", accessor: (r) => r.app.flow, cell: (r) => <Badge tone={r.app.flow === "Fast-Track" ? "accent" : "neutral"}>{r.app.flow}</Badge> },
    { id: "stage", header: "Stage", accessor: (r) => r.app.stage, sortable: true, cell: (r) => <StatusBadge status={r.app.stage} tones={stageTones} /> },
    { id: "next", header: "Next action", accessor: "nextAction" },
    { id: "sla", header: "SLA due", accessor: (r) => r.app.slaDueAt, sortable: true, cell: (r) => (r.sla === "Closed" ? <Text variant="small" tone="muted">—</Text> : <Stack gap="xsmall"><span className="font-mono text-sm">{date(r.app.slaDueAt)}</span><StatusBadge status={r.sla} tones={slaTones} /></Stack>) },
    { id: "branch", header: "Branch", accessor: "branch", sortable: true },
    { id: "officer", header: "Account Officer", accessor: "officer", hidden: false },
  ];

  const anyFilter = [stage, flow, product, branch, sla].some((v) => v !== ALL) || search !== "";

  return (
    <ModulePage
      module="origination"
      description="Standard and Fast-Track credit requests from initiation to offer — document OCR, COP Ratio validation, bureau / CRMS gate, recommendation engine and co-signer approvals."
      actions={
        canInitiate ? (
          <Button as={Link} href="/origination/new/" iconBefore={<FilePlus2 aria-hidden />}>
            New application
          </Button>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, lg: 3 }} gap="medium">
          <StatCard label="Active pipeline" value={moneyShort(sum(open))} hint={`${open.length} applications in origination`} icon={<Layers aria-hidden />} />
          <StatCard label="Awaiting decision" value={String(inApproval.length)} hint={`${moneyShort(sum(inApproval))} at recommendation / approval`} icon={<Hourglass aria-hidden />} />
          <StatCard label="SLA breached" value={String(breached.length)} hint={breached.length ? `${moneyShort(sum(breached))} past target` : "All within target"} tone={breached.length ? "danger" : "success"} icon={<AlarmClock aria-hidden />} />
          <StatCard label="Fast-Track share" value={open.length ? `${Math.round((fastTrack.length / open.length) * 100)}%` : "—"} hint={`${fastTrack.length} of ${open.length} open requests`} icon={<Zap aria-hidden />} />
          <StatCard label="Approved to offer" value={String(approved.length)} hint={`${moneyShort(sum(approved))} through to offer / booking`} icon={<Gauge aria-hidden />} />
          <StatCard label="Limit-gate referrals" value={String(open.filter((r) => isBreach(r.app.limitGate)).length)} hint="Single-obligor / sectoral breaches routed to CRO" tone={open.some((r) => isBreach(r.app.limitGate)) ? "warning" : "neutral"} icon={<ShieldAlert aria-hidden />} />
        </Grid>

        <Stack direction="horizontal" justify="between" align="center" wrap gap="medium">
          <SegmentedControl
            label="Scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: "mine", label: `My queue (${myQueue.length})`, icon: <ListChecks aria-hidden /> },
              { value: "all", label: `All applications (${rows.length})` },
            ]}
          />
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "board", label: "Board", icon: <LayoutGrid aria-hidden /> },
              { value: "table", label: "Table", icon: <Table2 aria-hidden /> },
            ]}
          />
        </Stack>

        <FilterBar
          label="Filter applications"
          search={{ value: search, onChange: setSearch, placeholder: "Search ID, obligor or purpose" }}
          filters={[
            { id: "stage", label: "Stage", value: stage, onChange: setStage, allLabel: "All stages", options: pipelineStages.map((s) => ({ value: s.id, label: s.title, count: base.filter((r) => r.app.stage === s.id).length })).filter((o) => o.count) },
            { id: "flow", label: "Flow", value: flow, onChange: setFlow, allLabel: "Both flows", options: facet((r) => r.app.flow) },
            { id: "product", label: "Product", value: product, onChange: setProduct, allLabel: "All products", options: facet((r) => r.app.product) },
            { id: "branch", label: "Branch", value: branch, onChange: setBranch, allLabel: "All branches", options: facet((r) => r.branch) },
            { id: "sla", label: "SLA", value: sla, onChange: setSla, allLabel: "Any SLA", options: (["Breached", "Due soon", "On track", "Closed"] as SlaState[]).map((s) => ({ value: s, label: s, count: base.filter((r) => r.sla === s).length })) },
          ]}
          onClearAll={
            anyFilter
              ? () => {
                  setSearch("");
                  setStage(ALL);
                  setFlow(ALL);
                  setProduct(ALL);
                  setBranch(ALL);
                  setSla(ALL);
                }
              : undefined
          }
        />

        {filtered.length === 0 ? (
          <EmptyState
            icon={<ListChecks aria-hidden />}
            title={scope === "mine" && !anyFilter ? "Your queue is clear" : "No applications match"}
            description={scope === "mine" && !anyFilter ? `Nothing needs action from the ${roleId ? roleById[roleId].name : "current role"} right now.` : "Try clearing a filter or switching to all applications."}
            action={scope === "mine" ? <Button variant="tertiary" onClick={() => setScope("all")}>Show all applications</Button> : undefined}
          />
        ) : view === "board" ? (
          <div className="overflow-x-auto pb-2">
            <KanbanBoard label="Origination pipeline by stage" columns={columns.map((c) => ({ id: c.id, title: c.title, tone: c.tone }))} cards={cards} linkComponent={Link} emptyColumnMessage="No applications" />
          </div>
        ) : (
          <DataTable
            label="Origination applications"
            columns={tableColumns}
            data={filtered}
            getRowId={(r) => r.id}
            getRowHref={(r) => `/origination/application/?id=${r.id}`}
            linkComponent={Link}
            defaultSort={{ id: "sla", direction: "asc" }}
            exportFilename="origination-pipeline.csv"
            mobileCard={(r) => (
              <Stack gap="xsmall">
                <Text variant="small" className="font-mono">{r.id}</Text>
                <Text>{r.obligorName}</Text>
                <Text variant="small" tone="muted">{money(r.app.amount)} · {r.app.product}</Text>
                <Stack direction="horizontal" gap="small" wrap>
                  <StatusBadge status={r.app.stage} tones={stageTones} />
                  {r.sla !== "Closed" ? <StatusBadge status={r.sla} tones={slaTones} /> : null}
                </Stack>
              </Stack>
            )}
          />
        )}
      </Stack>
    </ModulePage>
  );
}
