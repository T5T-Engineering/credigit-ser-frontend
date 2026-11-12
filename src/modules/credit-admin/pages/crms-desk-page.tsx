"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertOctagon, CloudUpload, FileSearch, Search, Send, ShieldCheck } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  EmptyState,
  Field,
  Form,
  Grid,
  Modal,
  SegmentedControl,
  Select,
  Spinner,
  Stack,
  StatCard,
  StatusBadge,
  Tabs,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { newId } from "@/lib/data/store";
import { date, dateTime, moneyShort, number } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { logCrmsSearch, resolveCrmsException, submitCrmsBatch, type ActionResult } from "../actions";
import { daysBetween, demoNowIso, hash } from "../common";
import { crmsReportTones, crmsResultTones, simulateCrms, useCrms, type CrmsReportRow } from "../crms";
import { useFacilityRows } from "../logic";
import type { CrmsBatch, CrmsSearch } from "../store";

/** TD-855: simulated CRMS connector latency (demo only — the real connector responds asynchronously). */
const SIMULATED_LATENCY_MS = 1400;

export function CrmsDeskPage() {
  const rows = useFacilityRows();
  const obligors = useObligors();
  const { searches, batches, reports } = useCrms(rows);
  const { actor } = useScope();
  const deskRoles = useRule<RoleId[]>("credit-admin.cpConfirmerRoles");
  const isDesk = deskRoles.includes(actor.roleId);
  const canSearch = useCan("credit-admin.crms-searches.run") && isDesk;
  const canSubmitBatch = useCan("credit-admin.crms-batches.submit") && isDesk;
  const canResolve = useCan("credit-admin.crms-exceptions.resolve") && isDesk;
  const canExport = useCan("credit-admin.registers.export");
  const recentDays = useRule<number>("credit-admin.crmsRecentWindowDays");
  const cadence = useRule<string>("credit-admin.crmsReportingCadence");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [tab, setTab] = useState("searches");
  const [searchOpen, setSearchOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const obName = useMemo(() => new Map(obligors.map((o) => [o.id, o.name])), [obligors]);

  const recent = searches.filter((s) => daysBetween(s.requestedAt) <= recentDays);
  const shownSearches = scope === "mine" ? searches.filter((s) => s.requestedByName === actor.name) : searches;
  const pendingReports = reports.filter((r) => r.status === "Pending submission");
  const exceptions = reports.filter((r) => r.status === "Exception");

  const submitBatch = () => {
    setSubmitting(true);
    window.setTimeout(() => {
      void submitCrmsBatch(
        pendingReports.map((r) => r.row.facility.id),
        `Ad-hoc submission ${date(DEMO_NOW)}`,
      ).then((r) => {
        setResult(r);
        setSubmitting(false);
        setSubmitOpen(false);
        if (r.ok) setTab("batches");
      });
    }, SIMULATED_LATENCY_MS);
  };

  const searchColumns: DataTableColumn<CrmsSearch>[] = [
    { id: "id", header: "Search", accessor: "id", sortable: true, cell: (s) => <span className="font-mono text-sm font-semibold whitespace-nowrap text-fg">{s.id}</span> },
    { id: "obligor", header: "Obligor", accessor: (s) => obName.get(s.obligorId) ?? s.obligorId, sortable: true },
    { id: "purpose", header: "Purpose", accessor: "purpose" },
    { id: "result", header: "Result", accessor: "result", cell: (s) => (s.result === "Awaiting response" ? <Badge tone="info"><Spinner size="xsmall" label="Awaiting" /> Awaiting response</Badge> : <StatusBadge status={s.result} tones={crmsResultTones} />) },
    { id: "elsewhere", header: "Facilities elsewhere", accessor: "facilitiesElsewhere", numeric: true },
    { id: "outstanding", header: "Outstanding elsewhere", accessor: "outstandingElsewhere", numeric: true, cell: (s) => (s.outstandingElsewhere ? moneyShort(s.outstandingElsewhere) : "—") },
    { id: "ref", header: "CRMS reference", accessor: "reference", cell: (s) => <span className="font-mono text-xs">{s.reference}</span> },
    { id: "requested", header: "Requested", accessor: "requestedAt", sortable: true, cell: (s) => <span className="font-mono text-sm">{dateTime(s.requestedAt)}</span> },
    { id: "by", header: "Requested by", accessor: "requestedByName", hidden: true },
  ];

  const reportColumns: DataTableColumn<CrmsReportRow>[] = [
    { id: "id", header: "Facility", accessor: (r) => r.row.facility.id, sortable: true, cell: (r) => <span className="font-mono text-sm font-semibold whitespace-nowrap text-fg">{r.row.facility.id}</span> },
    { id: "obligor", header: "Obligor", accessor: (r) => r.row.obligor?.name ?? "" },
    { id: "product", header: "Product", accessor: (r) => r.row.facility.product },
    { id: "limit", header: "Authorised limit", accessor: (r) => r.row.facility.approvedAmount, numeric: true, cell: (r) => moneyShort(r.row.facility.approvedAmount, r.row.facility.currency) },
    { id: "balance", header: "Balance", accessor: (r) => r.row.facility.outstanding, numeric: true, cell: (r) => moneyShort(r.row.facility.outstanding, r.row.facility.currency) },
    { id: "status", header: "CRMS status", accessor: (r) => r.status, sortable: true, cell: (r) => <StatusBadge status={r.status} tones={crmsReportTones} /> },
    { id: "detail", header: "Detail", accessor: (r) => r.reason ?? r.note ?? r.batchId ?? "",
      cell: (r) =>
        r.reason ? <span className="text-sm text-danger-strong">{r.reason}</span> : r.note ? <span className="text-sm text-fg-muted">{r.note}</span> : r.batchId ? <span className="font-mono text-xs">{r.batchId}</span> : <span className="text-fg-subtle">—</span>,
    },
    {
      id: "action",
      header: "Action",
      exportable: false,
      cell: (r) =>
        r.status === "Exception" && canResolve ? (
          <Button
            size="small"
            variant="tertiary"
            onClick={() => resolveCrmsException(r.row.facility.id, r.reason)}
          >
            Mark resolved
          </Button>
        ) : null,
    },
  ];

  const batchColumns: DataTableColumn<CrmsBatch>[] = [
    { id: "id", header: "Batch", accessor: "id", cell: (b) => <span className="font-mono text-sm font-semibold whitespace-nowrap text-fg">{b.id}</span> },
    { id: "label", header: "Period", accessor: "label" },
    { id: "submitted", header: "Submitted", accessor: "submittedAt", sortable: true, cell: (b) => <span className="font-mono text-sm">{dateTime(b.submittedAt)}</span> },
    { id: "by", header: "Submitted by", accessor: "submittedByName" },
    { id: "count", header: "Facilities", accessor: (b) => b.facilityIds.length, numeric: true },
    { id: "rejected", header: "Rejected", accessor: "rejected", numeric: true },
    { id: "status", header: "Status", accessor: "status", cell: (b) => <StatusBadge status={b.status} tones={{ "Accepted by CBN": "success", Submitted: "info", "Partially rejected": "warning" }} /> },
  ];

  return (
    <ModulePage
      module="credit-admin"
      description="CBN Credit Risk Management System desk — search requests and results per obligor (CBN 3.7(d)) and facility reporting (PRD §6.3.3)."
      actions={
        canSearch ? (
          <Button iconBefore={<Search aria-hidden className="size-4" />} onClick={() => setSearchOpen(true)}>
            New CRMS search
          </Button>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label={`Searches (${recentDays} days)`} value={number(recent.length)} icon={<FileSearch aria-hidden />} hint={`${searches.length} logged in total`} />
          <StatCard label="Adverse findings" value={number(recent.filter((s) => s.result.startsWith("Adverse")).length)} icon={<AlertOctagon aria-hidden />} tone="danger" hint={`Delinquent credit at other institutions (${recentDays} days)`} />
          <StatCard label="Pending submission" value={number(pendingReports.length)} icon={<CloudUpload aria-hidden />} tone="info" hint={`Last batch ${batches[0] ? date(batches[0].submittedAt) : "—"} · cadence: ${cadence}`} />
          <StatCard label="Reporting exceptions" value={number(exceptions.length)} icon={<ShieldCheck aria-hidden />} tone="warning" hint="Must be fixed before submission" />
        </Grid>

        <Alert tone="info" title="Simulated CRMS connector">
          In production the CRMS desk calls the CBN CRMS through the Credit Bureau + CRMS connector (§5). In this prototype responses are simulated and labelled as such. Batch submissions are recorded as Operations requests (approval steps are optional per tenant).
        </Alert>
        {result ? (
          <Alert tone={result.ok ? "success" : "danger"} title={result.ok ? "Done" : "Not done"} action={<Button size="small" variant="text" onClick={() => setResult(null)}>Dismiss</Button>}>
            {result.ok ? result.message : result.reason}
          </Alert>
        ) : null}

        <Tabs
          value={tab}
          onValueChange={setTab}
          label="CRMS desk"
          items={[
            {
              id: "searches",
              label: "Search log",
              badge: String(searches.length),
              content: (
                <Stack gap="medium">
                <div className="overflow-x-auto">
                  <SegmentedControl
                    label="Show"
                    value={scope}
                    onChange={(v) => setScope(v as "all" | "mine")}
                    options={[
                      { value: "all", label: `All searches (${searches.length})` },
                      { value: "mine", label: `My searches (${searches.filter((s) => s.requestedByName === actor.name).length})` },
                    ]}
                  />
                </div>
                <DataTable
                  label="CRMS search log"
                  columns={searchColumns}
                  data={shownSearches}
                  getRowId={(s) => s.id}
                  searchable
                  searchPlaceholder="Search obligor, reference…"
                  filters={[
                    { id: "result", label: "Result" },
                    { id: "purpose", label: "Purpose" },
                  ]}
                  defaultSort={{ id: "requested", direction: "desc" }}
                  exportFilename={canExport ? "crms-search-log.csv" : undefined}
                  emptyState={<EmptyState icon={<FileSearch aria-hidden />} title="No searches" description="CRMS searches appear here once requested." />}
                  mobileCard={(s) => (
                    <Stack gap="small">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold">{s.id}</span>
                        <StatusBadge status={s.result} tones={crmsResultTones} />
                      </div>
                      <Text variant="small">{obName.get(s.obligorId)}</Text>
                      <Text variant="caption" tone="muted">
                        {s.purpose} · {dateTime(s.requestedAt)}
                      </Text>
                    </Stack>
                  )}
                />
                </Stack>
              ),
            },
            {
              id: "queue",
              label: "Reporting queue",
              badge: String(pendingReports.length + exceptions.length),
              content: (
                <Stack gap="medium">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Text variant="small" tone="muted">
                      Facilities are reported to CRMS once disbursed. Exceptions must be resolved in the source record before they can be submitted.
                    </Text>
                    {canSubmitBatch ? (
                      <Button iconBefore={<Send aria-hidden className="size-4" />} disabled={pendingReports.length === 0} onClick={() => setSubmitOpen(true)}>
                        Submit batch to CRMS
                      </Button>
                    ) : null}
                  </div>
                  <DataTable
                    label="CRMS reporting queue"
                    columns={reportColumns}
                    data={reports}
                    getRowId={(r) => r.row.facility.id}
                    getRowHref={(r) => `/credit-admin/facility/?id=${r.row.facility.id}`}
                    linkComponent={Link}
                    searchable
                    filters={[{ id: "status", label: "CRMS status", defaultValue: "Exception" }]}
                    exportFilename={canExport ? "crms-reporting-queue.csv" : undefined}
                    emptyState={<EmptyState title="Nothing in this view" description="No facilities match the selected CRMS status." />}
                  />
                </Stack>
              ),
            },
            {
              id: "batches",
              label: "Submission batches",
              content: <DataTable label="CRMS submission batches" columns={batchColumns} data={batches} getRowId={(b) => b.id} paginate={false} emptyState={<EmptyState title="No batches yet" />} />,
            },
          ]}
        />
      </Stack>

      <NewSearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <Modal
        open={submitOpen}
        onOpenChange={(o) => !submitting && setSubmitOpen(o)}
        title="Submit batch to CRMS?"
        description="Simulated submission — no data leaves the prototype."
        footer={
          <>
            <Button variant="tertiary" disabled={submitting} onClick={() => setSubmitOpen(false)}>
              Cancel
            </Button>
            <Button loading={submitting} iconBefore={<Send aria-hidden className="size-4" />} onClick={submitBatch}>
              Submit {pendingReports.length} facilities
            </Button>
          </>
        }
      >
        <DescriptionList
          columns={2}
          items={[
            { label: "Facilities", value: String(pendingReports.length), mono: true },
            { label: "Total authorised limit", value: moneyShort(pendingReports.reduce((s, r) => s + r.row.facility.approvedAmount, 0)), mono: true },
            { label: "Excluded (exceptions)", value: String(exceptions.length), mono: true, hint: "Resolve to include in the next batch" },
          ]}
        />
      </Modal>
    </ModulePage>
  );
}

function NewSearchModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const obligors = useObligors();
  const { actor } = useScope();
  const [obligorId, setObligorId] = useState("");
  const [purpose, setPurpose] = useState<CrmsSearch["purpose"]>("New application");
  const [pending, setPending] = useState<CrmsSearch | null>(null);
  const [done, setDone] = useState<CrmsSearch | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const sorted = useMemo(() => [...obligors].sort((a, b) => a.name.localeCompare(b.name)), [obligors]);

  const run = () => {
    const o = obligors.find((x) => x.id === obligorId);
    if (!o) return;
    const at = demoNowIso();
    const s: CrmsSearch = { id: newId("CRS"), obligorId: o.id, purpose, requestedByName: actor.name, requestedAt: at, result: "Awaiting response", facilitiesElsewhere: 0, outstandingElsewhere: 0, reference: `CRMS/${String(hash(o.id + at) % 10_000_000).padStart(7, "0")}` };
    logCrmsSearch(s, "requested");
    setPending(s);
    setDone(null);
    timer.current = window.setTimeout(() => {
      const result: CrmsSearch = { ...s, ...simulateCrms(o, s.id), respondedAt: demoNowIso() };
      logCrmsSearch(result, "received");
      setPending(null);
      setDone(result);
    }, SIMULATED_LATENCY_MS);

  };

  const close = (o: boolean) => {
    if (pending) return;
    onOpenChange(o);
    if (!o) {
      setDone(null);
      setObligorId("");
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="New CRMS search"
      description="Logs the request and result against the obligor (CBN 3.7(d)). Response is simulated."
      footer={
        done ? (
          <Button onClick={() => close(false)}>Done</Button>
        ) : (
          <>
            <Button variant="tertiary" disabled={!!pending} onClick={() => close(false)}>
              Cancel
            </Button>
            <Button loading={!!pending} disabled={!obligorId} iconBefore={<Search aria-hidden className="size-4" />} onClick={run}>
              Run search
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Stack gap="medium">
          <Alert tone={done.result.startsWith("Adverse") ? "danger" : "success"} title={done.result}>
            Simulated CRMS response for {obligors.find((o) => o.id === done.obligorId)?.name}.
          </Alert>
          <DescriptionList
            columns={2}
            items={[
              { label: "Reference", value: done.reference, mono: true, copyValue: done.reference },
              { label: "Purpose", value: done.purpose },
              { label: "Facilities at other institutions", value: String(done.facilitiesElsewhere), mono: true },
              { label: "Outstanding elsewhere", value: done.outstandingElsewhere ? moneyShort(done.outstandingElsewhere) : "—", mono: true },
            ]}
          />
        </Stack>
      ) : pending ? (
        <div className="grid place-items-center py-8">
          <Spinner label="Waiting for CRMS response" />
        </div>
      ) : (
        <Form onSubmit={(e) => e.preventDefault()}>
          <Field label="Obligor" htmlFor="crms-ob" required>
            <Select id="crms-ob" value={obligorId} placeholder="Choose an obligor" onChange={(e) => setObligorId(e.target.value)} options={sorted.map((o) => ({ value: o.id, label: `${o.name} (${o.rcNumber ?? o.bvnMasked ?? o.id})` }))} />
          </Field>
          <Field label="Purpose" htmlFor="crms-purpose">
            <Select
              id="crms-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as CrmsSearch["purpose"])}
              options={["New application", "Renewal", "Enhancement", "Restructure", "Periodic review"].map((v) => ({ value: v, label: v }))}
            />
          </Field>
        </Form>
      )}
    </Modal>
  );
}
