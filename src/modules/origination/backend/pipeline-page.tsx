"use client";

/**
 * Origination pipeline on the backend API: all applications, my queue (`/origination/queue`) and my applications
 * (`/origination/applications/mine`), with filters and the audited CSV export.
 */
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlarmClock, Download, FilePlus2, Hourglass, Layers, ListChecks, ShieldAlert, Zap } from "lucide-react";
import { Alert, Badge, Button, DataTable, EmptyState, FilterBar, Grid, SegmentedControl, Spinner, StatCard, Stack, StatusBadge, Text, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { date, money, moneyShort } from "@/lib/format";
import { useCan } from "@/lib/iam/permissions";
import { OutcomePopup } from "@/lib/ui/outcome-popup";
import { STAGES, applicationHref, errorText, isBreach, originationApi, queueActionLabel, useBackend, type ApplicationFilter, type CreditApplication, type QueueItem } from "./api";
import { backendNextAction, backendSlaState, backendStageTones, isOpenStage, slaTones, type SlaState } from "./view";

type Scope = "mine" | "created" | "all";

type Row = { id: string; app: CreditApplication; sla: SlaState; nextAction: string };

const ALL = "all";

export function BackendPipelinePage() {
  return (
    <Suspense fallback={<Spinner label="Loading applications" />}>
      <Pipeline />
    </Suspense>
  );
}

function Pipeline() {
  const params = useSearchParams();
  const canViewAll = useCan("origination.applications.view");
  const canViewMine = useCan("origination.applications.view-mine");
  const canQueue = useCan("origination.queue.view");
  const canCreate = useCan("origination.applications.create");
  const canExport = useCan("origination.applications.export");
  const initial = params.get("scope");
  const [scope, setScope] = useState<Scope>(initial === "mine" || initial === "created" ? initial : canViewAll ? "all" : canQueue ? "mine" : "created");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState(ALL);
  const [flow, setFlow] = useState(ALL);
  const [product, setProduct] = useState(ALL);
  const [requestType, setRequestType] = useState(ALL);
  const [sla, setSla] = useState(ALL);
  const [exportError, setExportError] = useState<string | null>(null);

  const all = useBackend(canViewAll ? () => originationApi.list() : null, [canViewAll]);
  const mine = useBackend(canViewMine ? () => originationApi.mine() : null, [canViewMine]);
  const queue = useBackend(canQueue ? () => originationApi.queue() : null, [canQueue]);

  const queueById = useMemo(() => new Map((queue.data ?? []).map((q) => [q.application.id, q])), [queue.data]);
  const toRow = (a: CreditApplication, q?: QueueItem): Row => ({
    id: a.id,
    app: a,
    sla: backendSlaState(a),
    nextAction: q ? `You: ${queueActionLabel[q.action]}${q.step ? ` (${q.step})` : ""}` : backendNextAction(a),
  });
  const rows = useMemo(() => (all.data ?? []).map((a) => toRow(a, queueById.get(a.id))), [all.data, queueById]);
  const myQueue = useMemo(() => (queue.data ?? []).map((q) => toRow(q.application, q)), [queue.data]);
  const created = useMemo(() => (mine.data ?? []).map((a) => toRow(a, queueById.get(a.id))), [mine.data, queueById]);
  const base = scope === "mine" ? myQueue : scope === "created" ? created : rows;
  const source = scope === "mine" ? queue : scope === "created" ? mine : all;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return base.filter(
      (r) =>
        (stage === ALL || r.app.stage === stage) &&
        (flow === ALL || r.app.flow === flow) &&
        (product === ALL || r.app.facility.product === product) &&
        (requestType === ALL || r.app.facility.requestType === requestType) &&
        (sla === ALL || r.sla === sla) &&
        (!q || r.id.toLowerCase().includes(q) || r.app.customer.name.toLowerCase().includes(q) || r.app.facility.purpose.toLowerCase().includes(q)),
    );
  }, [base, search, stage, flow, product, requestType, sla]);

  const facet = (get: (r: Row) => string) => {
    const counts = new Map<string, number>();
    for (const r of base) counts.set(get(r), (counts.get(get(r)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }));
  };

  const stats = scope === "all" ? rows : base;
  const open = stats.filter((r) => isOpenStage(r.app));
  const inApproval = stats.filter((r) => r.app.stage === "Approval");
  const breached = open.filter((r) => r.sla === "Breached");
  const fastTrack = open.filter((r) => r.app.flow === "Fast-Track");
  const referrals = open.filter((r) => isBreach(r.app.analysis?.limitGate));
  const sum = (xs: Row[]) => xs.reduce((s, r) => s + r.app.facility.amountNgn, 0);

  const exportFilter: ApplicationFilter = {
    stage: stage === ALL ? undefined : (stage as ApplicationFilter["stage"]),
    flow: flow === ALL ? undefined : (flow as ApplicationFilter["flow"]),
    product: product === ALL ? undefined : product,
    requestType: requestType === ALL ? undefined : (requestType as ApplicationFilter["requestType"]),
    search: search.trim() || undefined,
  };

  const columns: DataTableColumn<Row>[] = [
    { id: "id", header: "Application", accessor: "id", sortable: true, cell: (r) => <span className="font-mono">{r.id}</span> },
    { id: "customer", header: "Customer", accessor: (r) => r.app.customer.name, sortable: true },
    { id: "product", header: "Product", accessor: (r) => r.app.facility.product, sortable: true },
    { id: "amount", header: "Amount", accessor: (r) => r.app.facility.amountNgn, numeric: true, sortable: true, cell: (r) => moneyShort(r.app.facility.amountNgn) },
    { id: "flow", header: "Flow", accessor: (r) => r.app.flow, cell: (r) => <Badge tone={r.app.flow === "Fast-Track" ? "accent" : "neutral"}>{r.app.flow}</Badge> },
    { id: "stage", header: "Stage", accessor: (r) => r.app.stage, sortable: true, cell: (r) => <StatusBadge status={r.app.stage} tones={backendStageTones} /> },
    { id: "next", header: "Next action", accessor: "nextAction" },
    {
      id: "sla",
      header: "SLA due",
      accessor: (r) => r.app.slaDueAt,
      sortable: true,
      cell: (r) =>
        r.sla === "Closed" ? (
          <Text variant="small" tone="muted">—</Text>
        ) : (
          <Stack gap="xsmall">
            <span className="font-mono text-sm">{date(r.app.slaDueAt)}</span>
            <StatusBadge status={r.sla} tones={slaTones} />
          </Stack>
        ),
    },
    { id: "branch", header: "Branch", accessor: (r) => r.app.customer.branch ?? "—", sortable: true },
    { id: "officer", header: "Initiator", accessor: (r) => r.app.createdBy.name, sortable: true },
  ];

  const anyFilter = [stage, flow, product, requestType, sla].some((v) => v !== ALL) || search !== "";

  return (
    <ModulePage
      module="origination"
      description="Standard and Fast-Track credit requests from initiation to final approval, on the backend origination service."
      actions={
        <Stack direction="horizontal" gap="small" wrap>
          {canExport && scope === "all" ? (
            <Button variant="tertiary" iconBefore={<Download aria-hidden />} onClick={() => originationApi.exportPipeline(exportFilter).catch((e: unknown) => setExportError(errorText(e)))}>
              Export CSV
            </Button>
          ) : null}
          {canCreate ? (
            <Button as={Link} href="/origination/new/" iconBefore={<FilePlus2 aria-hidden />}>
              New application
            </Button>
          ) : null}
        </Stack>
      }
    >
      <Stack gap="large">
        <OutcomePopup value={exportError} map={(m) => ({ tone: "danger", title: "Export failed", description: m })} />
        <Grid columns={{ base: 1, sm: 2, lg: 3 }} gap="medium">
          <StatCard label="Active pipeline" value={moneyShort(sum(open))} hint={`${open.length} open applications`} icon={<Layers aria-hidden />} />
          <StatCard label="Awaiting decision" value={String(inApproval.length)} hint={`${moneyShort(sum(inApproval))} in chart-flow approval`} icon={<Hourglass aria-hidden />} />
          <StatCard label="SLA breached" value={String(breached.length)} hint={breached.length ? `${moneyShort(sum(breached))} past target` : "All within target"} tone={breached.length ? "danger" : "success"} icon={<AlarmClock aria-hidden />} />
          <StatCard label="Fast-Track share" value={open.length ? `${Math.round((fastTrack.length / open.length) * 100)}%` : "—"} hint={`${fastTrack.length} of ${open.length} open requests`} icon={<Zap aria-hidden />} />
          <StatCard label="Limit-gate referrals" value={String(referrals.length)} hint="Recorded single-obligor / sectoral breaches" tone={referrals.length ? "warning" : "neutral"} icon={<ShieldAlert aria-hidden />} />
        </Grid>

        <SegmentedControl
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            ...(canQueue ? [{ value: "mine" as const, label: `My queue (${myQueue.length})`, icon: <ListChecks aria-hidden /> }] : []),
            ...(canViewMine ? [{ value: "created" as const, label: `My applications (${created.length})` }] : []),
            ...(canViewAll ? [{ value: "all" as const, label: `All applications (${rows.length})` }] : []),
          ]}
        />

        <FilterBar
          label="Filter applications"
          search={{ value: search, onChange: setSearch, placeholder: "Search ID, customer or purpose" }}
          filters={[
            { id: "stage", label: "Stage", value: stage, onChange: setStage, allLabel: "All stages", options: STAGES.map((s) => ({ value: s, label: s, count: base.filter((r) => r.app.stage === s).length })).filter((o) => o.count) },
            { id: "flow", label: "Flow", value: flow, onChange: setFlow, allLabel: "Both flows", options: facet((r) => r.app.flow) },
            { id: "product", label: "Product", value: product, onChange: setProduct, allLabel: "All products", options: facet((r) => r.app.facility.product) },
            { id: "requestType", label: "Request type", value: requestType, onChange: setRequestType, allLabel: "All types", options: facet((r) => r.app.facility.requestType) },
            { id: "sla", label: "SLA", value: sla, onChange: setSla, allLabel: "Any SLA", options: (["Breached", "Due soon", "On track", "Closed"] as SlaState[]).map((s) => ({ value: s, label: s, count: base.filter((r) => r.sla === s).length })) },
          ]}
          onClearAll={
            anyFilter
              ? () => {
                  setSearch("");
                  setStage(ALL);
                  setFlow(ALL);
                  setProduct(ALL);
                  setSla(ALL);
                }
              : undefined
          }
        />

        {source.error ? <Alert tone="danger">{source.error}</Alert> : null}
        {source.loading ? (
          <Spinner label="Loading applications" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ListChecks aria-hidden />}
            title={scope === "mine" && !anyFilter ? "Your queue is clear" : "No applications match"}
            description={scope === "mine" && !anyFilter ? "Nothing needs action from you right now." : "Try clearing a filter or switching scope."}
          />
        ) : (
          <DataTable
            label="Origination applications"
            columns={columns}
            data={filtered}
            getRowId={(r) => r.id}
            getRowHref={(r) => applicationHref(r.id)}
            linkComponent={Link}
            defaultSort={{ id: "sla", direction: "asc" }}
            mobileCard={(r) => (
              <Stack gap="xsmall">
                <Text variant="small" className="font-mono">{r.id}</Text>
                <Text>{r.app.customer.name}</Text>
                <Text variant="small" tone="muted">{money(r.app.facility.amountNgn)} · {r.app.facility.product}</Text>
                <Stack direction="horizontal" gap="small" wrap>
                  <StatusBadge status={r.app.stage} tones={backendStageTones} />
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
