"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Banknote, Clock, Gauge as GaugeIcon, Inbox, ShieldCheck } from "lucide-react";
import {
  ActivityFeed,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChecklistPanel,
  DataTable,
  DecisionPanel,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  Form,
  FormActions,
  Grid,
  Input,
  ProgressBar,
  RagIndicator,
  StatCard,
  StatusBadge,
  Stack,
  StepUpAuthDialog,
  Tabs,
  Text,
  TextLink,
  type ChecklistItem,
  type DataTableColumn,
  type DecisionSubmission,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { useApplications, useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { newId } from "@/lib/data/store";
import { date, dateTime, money, moneyShort } from "@/lib/format";
import { canDecide, useOperationsStore, usePendingFor } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { demoNowIso } from "../../credit-admin/common";
import { isCleared, useFacilityRows, type FacilityRow } from "../../credit-admin/logic";
import { PendingOperationNotice } from "../../credit-admin/operations-ui";
import { decideDisbursement, prepareDisbursement, withdrawDisbursement } from "../actions";
import {
  accountFor,
  checkerRoles,
  checkerChecks,
  disbursementTones,
  makerChecks,
  useDisbursements,
  type Disbursement,
  type SodCheck,
} from "../store";

type QueueRow = { row: FacilityRow; request?: Disbursement };

const inMonth = (iso: string | undefined) => !!iso && new Date(iso).getFullYear() === DEMO_NOW.getFullYear() && new Date(iso).getMonth() === DEMO_NOW.getMonth();

export function DisbursementPage() {
  const rows = useFacilityRows();
  const requests = useDisbursements();
  const apps = useApplications();
  const obligors = useObligors();
  const canEdit = useCan("disbursement", "edit");
  const { actor } = useScope();
  const stepUpThreshold = useRule<number>("approvals.stepUpThresholdNgn");
  const makerRoles = useRule<RoleId[]>("disbursement.makerRoles");
  const instances = useOperationsStore((s) => s.instances);
  const isMaker = canEdit && makerRoles.includes(actor.roleId);
  const isChecker = canEdit && checkerRoles().includes(actor.roleId);
  const [tab, setTab] = useState("queue");
  // `?facility=FAC-…` opens the workspace directly (deep link from other modules).
  const [openId, setOpenId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("facility")));

  const latestByFacility = useMemo(() => {
    const m = new Map<string, Disbursement>();
    for (const r of requests) if (!m.has(r.facilityId)) m.set(r.facilityId, r); // requests are newest first
    return m;
  }, [requests]);

  const queue: QueueRow[] = useMemo(
    () => rows.filter((r) => r.facility.status === "Pending disbursement").map((row) => ({ row, request: latestByFacility.get(row.facility.id) })),
    [rows, latestByFacility],
  );
  const awaiting = requests.filter((r) => r.status === "Awaiting authorisation");
  const awaitingMe = new Set(instances.filter((i) => i.operationType === "disbursement.authorise" && canDecide(i, actor).ok).map((i) => i.subject.id));
  const myWork = requests.filter((r) => r.makerId === actor.id || r.checkerId === actor.id || awaitingMe.has(r.id));
  const authorisedMonth = requests.filter((r) => r.status === "Authorised" && inMonth(r.decidedAt));
  const comingThrough = apps.filter((a) => a.stage === "Conditions");
  const obligorName = (id: string) => obligors.find((o) => o.id === id)?.name ?? id;
  const openRow = openId ? rows.find((r) => r.facility.id === openId) : undefined;

  const queueColumns: DataTableColumn<QueueRow>[] = [
    { id: "facility", header: "Facility", accessor: (q) => q.row.facility.id, cell: (q) => <span className="font-mono">{q.row.facility.id}</span>, sortable: true },
    {
      id: "obligor",
      header: "Obligor",
      accessor: (q) => q.row.obligor?.name ?? q.row.facility.obligorId,
      cell: (q) => (
        <div className="min-w-40">
          <Text className="font-medium text-fg">{q.row.obligor?.name ?? q.row.facility.obligorId}</Text>
          <Text variant="small" tone="muted">
            {q.row.facility.product}
          </Text>
        </div>
      ),
      sortable: true,
    },
    { id: "product", header: "Product", accessor: (q) => q.row.facility.product, hidden: true },
    { id: "undisbursed", header: "Undisbursed", accessor: (q) => q.row.undisbursed, cell: (q) => moneyShort(q.row.undisbursed, q.row.facility.currency), numeric: true, sortable: true },
    {
      id: "cps",
      header: "CPs",
      accessor: (q) => q.row.cleared / Math.max(1, q.row.cps.length),
      cell: (q) => (
        <div className="min-w-28">
          <ProgressBar value={q.row.cleared / Math.max(1, q.row.cps.length)} tone={q.row.cleared === q.row.cps.length ? "success" : "warning"} size="small" ariaLabel="Conditions precedent cleared" />
          <Text variant="small" tone="muted" className="mt-1 font-mono">
            {q.row.cleared}/{q.row.cps.length} cleared
          </Text>
        </div>
      ),
      csv: (q) => `${q.row.cleared}/${q.row.cps.length}`,
    },
    {
      id: "release",
      header: "Credit Admin",
      accessor: (q) => (q.row.released ? "Released" : "Not released"),
      cell: (q) => (q.row.released ? <Badge tone="success">Released</Badge> : <Badge tone="warning">Not released</Badge>),
    },
    {
      id: "status",
      header: "Disbursement",
      accessor: (q) => q.request?.status ?? "Not prepared",
      cell: (q) => <StatusBadge status={q.request?.status ?? "Not prepared"} tones={{ ...disbursementTones, "Not prepared": "neutral" }} />,
    },
    {
      id: "action",
      header: "Action",
      exportable: false,
      cell: (q) => (
        <Button size="small" variant="tertiary" onClick={() => setOpenId(q.row.facility.id)}>
          {nextActionLabel(q, isMaker, isChecker)}
        </Button>
      ),
    },
  ];

  const historyColumns: DataTableColumn<Disbursement>[] = [
    { id: "id", header: "Request", accessor: "id", cell: (d) => <span className="font-mono">{d.id}</span>, sortable: true },
    { id: "facility", header: "Facility", accessor: "facilityId", cell: (d) => <TextLink as={Link} href={`/credit-admin/facility/?id=${d.facilityId}`} className="font-mono">{d.facilityId}</TextLink> },
    { id: "obligor", header: "Obligor", accessor: (d) => obligorName(d.obligorId), sortable: true },
    { id: "amount", header: "Amount", accessor: "amount", cell: (d) => money(d.amount, d.currency), numeric: true, sortable: true },
    { id: "status", header: "Status", accessor: "status", cell: (d) => <StatusBadge status={d.status} tones={disbursementTones} /> },
    { id: "maker", header: "Maker", accessor: "makerName" },
    { id: "checker", header: "Checker", accessor: (d) => d.checkerName ?? "—" },
    { id: "stepUp", header: "Step-up", accessor: (d) => (d.stepUpVerified ? "Verified" : d.amount > stepUpThreshold ? "Required" : "Not required"), cell: (d) => (d.stepUpVerified ? <Badge tone="success">Verified</Badge> : d.amount > stepUpThreshold ? <Badge tone="info" variant="outline">Required</Badge> : <Text variant="small" tone="subtle">Not required</Text>) },
    { id: "cba", header: "CBA reference", accessor: (d) => d.cbaReference ?? "—", cell: (d) => <span className="font-mono text-sm">{d.cbaReference ?? "—"}</span> },
    { id: "prepared", header: "Prepared", accessor: "preparedAt", cell: (d) => dateTime(d.preparedAt), sortable: true },
    { id: "decided", header: "Decided", accessor: (d) => d.decidedAt ?? "", cell: (d) => (d.decidedAt ? dateTime(d.decidedAt) : "—"), sortable: true },
  ];

  const requestCard = (d: Disbursement) => (
    <Stack gap="xsmall">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm">{d.id}</span>
        <StatusBadge status={d.status} tones={disbursementTones} />
      </div>
      <Text className="font-medium text-fg">{obligorName(d.obligorId)}</Text>
      <Text variant="small" tone="muted">
        <span className="font-mono">{money(d.amount, d.currency)}</span> · Maker {d.makerName}
        {d.checkerName ? ` · Checker ${d.checkerName}` : ""}
      </Text>
    </Stack>
  );

  return (
    <ModulePage module="disbursement" description="Domestic Operations maker-checker: a Maker prepares the disbursement within the approved amount; a different Checker authorises it.">
      <Stack gap="large">
        {!canEdit ? (
          <Alert tone="info" title="Read-only view">
            Only the Disbursement Maker and Disbursement Checker roles can prepare or authorise disbursements. You can follow the queue and history.
          </Alert>
        ) : null}
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="Pending disbursement" value={String(queue.length)} hint={`${moneyShort(queue.reduce((s, q) => s + q.row.undisbursed, 0))} undisbursed`} icon={<Inbox aria-hidden />} />
          <StatCard label="Awaiting authorisation" value={String(awaiting.length)} hint={`${moneyShort(awaiting.reduce((s, d) => s + d.amount, 0))} prepared by Makers`} icon={<Clock aria-hidden />} tone="info" />
          <StatCard label="Authorised this month" value={moneyShort(authorisedMonth.reduce((s, d) => s + d.amount, 0))} hint={`${authorisedMonth.length} disbursements · ${DEMO_NOW.toLocaleString("en-NG", { month: "long", year: "numeric" })}`} icon={<Banknote aria-hidden />} tone="success" />
          <StatCard label="Step-up threshold" value={moneyShort(stepUpThreshold)} hint="Business rule approvals.stepUpThresholdNgn (PRD §4.2). Above this the Checker re-authenticates." icon={<GaugeIcon aria-hidden />} tone="accent" />
        </Grid>

        <Tabs
          value={tab}
          onValueChange={setTab}
          label="Disbursement views"
          items={[
            {
              id: "queue",
              label: "Queue",
              badge: String(queue.length),
              content: (
                <Stack gap="large">
                  <DataTable
                    label="Facilities pending disbursement"
                    columns={queueColumns}
                    data={queue}
                    getRowId={(q) => q.row.facility.id}
                    onRowClick={(q) => setOpenId(q.row.facility.id)}
                    searchable
                    searchPlaceholder="Search facility or obligor"
                    exportFilename="disbursement-queue.csv"
                    emptyState={<EmptyState icon={<Inbox aria-hidden />} title="Nothing pending disbursement" description="Facilities appear here once the offer letter is accepted and Credit Administration has the file." />}
                    mobileCard={(q) => (
                      <Stack gap="xsmall">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm">{q.row.facility.id}</span>
                          <StatusBadge status={q.request?.status ?? "Not prepared"} tones={{ ...disbursementTones, "Not prepared": "neutral" }} />
                        </div>
                        <Text className="font-medium text-fg">{q.row.obligor?.name}</Text>
                        <Text variant="small" tone="muted">
                          {q.row.facility.product} · <span className="font-mono">{moneyShort(q.row.undisbursed)}</span> undisbursed · CPs {q.row.cleared}/{q.row.cps.length} · {q.row.released ? "Released" : "Not released"}
                        </Text>
                      </Stack>
                    )}
                  />
                  <Card variant="outlined">
                    <CardHeader>
                      <CardTitle>Coming through — awaiting CP clearance</CardTitle>
                      <CardDescription>
                        Applications at the Conditions stage (PRD §6.1.1 steps 14–15). They join the queue once Credit Administration releases the file.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {comingThrough.length === 0 ? (
                        <Text tone="muted">No applications are at the Conditions stage.</Text>
                      ) : (
                        <ul className="flex flex-col divide-y divide-line">
                          {comingThrough.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                              <div>
                                <Text className="font-medium text-fg">{obligorName(a.obligorId)}</Text>
                                <Text variant="small" tone="muted">
                                  <span className="font-mono">{a.id}</span> · {a.product} · <span className="font-mono">{moneyShort(a.amount)}</span>
                                </Text>
                              </div>
                              <div className="flex flex-wrap gap-3">
                                <TextLink as={Link} href={`/offer-letters/letter/?applicationId=${a.id}`}>Offer letter & CPs</TextLink>
                                <TextLink as={Link} href={`/origination/application/?id=${a.id}`}>Application</TextLink>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </Stack>
              ),
            },
            {
              id: "awaiting",
              label: "Awaiting authorisation",
              badge: String(awaiting.length),
              content: (
                <DataTable
                  label="Disbursements awaiting authorisation"
                  columns={historyColumns.filter((c) => !["checker", "cba", "decided"].includes(c.id))}
                  data={awaiting}
                  getRowId={(d) => d.id}
                  onRowClick={(d) => setOpenId(d.facilityId)}
                  emptyState={<EmptyState icon={<ShieldCheck aria-hidden />} title="Nothing to authorise" description="Requests prepared by a Disbursement Maker appear here for a different Checker to authorise." />}
                  mobileCard={requestCard}
                />
              ),
            },
            {
              id: "mine",
              label: "My work",
              badge: String(myWork.length),
              content: (
                <DataTable
                  label="Disbursements I prepared, authorised or must decide"
                  columns={historyColumns}
                  data={myWork}
                  getRowId={(d) => d.id}
                  onRowClick={(d) => setOpenId(d.facilityId)}
                  defaultSort={{ id: "prepared", direction: "desc" }}
                  emptyState={<EmptyState icon={<Inbox aria-hidden />} title="Nothing for you yet" description="Disbursements you prepare, authorise or need to decide appear here." />}
                  mobileCard={requestCard}
                />
              ),
            },
            {
              id: "history",
              label: "History",
              content: (
                <DataTable
                  label="Disbursement history"
                  columns={historyColumns}
                  data={requests}
                  getRowId={(d) => d.id}
                  searchable
                  searchPlaceholder="Search request, facility, obligor or person"
                  filters={[
                    { id: "status", label: "Status" },
                    { id: "stepUp", label: "Step-up" },
                  ]}
                  defaultSort={{ id: "prepared", direction: "desc" }}
                  exportFilename="disbursement-history.csv"
                  emptyState={<EmptyState title="No disbursements yet" />}
                  mobileCard={requestCard}
                />
              ),
            },
          ]}
        />
      </Stack>

      {openRow ? <Workspace key={openRow.facility.id} row={openRow} requests={requests.filter((r) => r.facilityId === openRow.facility.id)} onClose={() => setOpenId(null)} /> : null}
    </ModulePage>
  );
}

function nextActionLabel(q: QueueRow, isMaker: boolean, isChecker: boolean) {
  if (isChecker && q.request?.status === "Awaiting authorisation") return "Review & authorise";
  if (isMaker && (!q.request || q.request.status !== "Awaiting authorisation")) return "Prepare";
  return "Open";
}

function SodPanel({ title, checks }: { title: string; checks: SodCheck[] }) {
  return (
    <Stack gap="small">
      <Text variant="eyebrow" tone="muted">
        {title}
      </Text>
      <ul className="flex flex-col gap-2">
        {checks.map((c) => (
          <li key={c.id} className="squircle flex flex-wrap items-start justify-between gap-2 rounded-2xl bg-surface-sunken px-4 py-3">
            <div>
              <Text className="font-medium text-fg">{c.label}</Text>
              <Text variant="small" tone="muted">
                {c.detail}
              </Text>
            </div>
            <RagIndicator status={c.ok ? "green" : "red"} label={c.ok ? "Pass" : "Blocked"} size="small" />
          </li>
        ))}
      </ul>
    </Stack>
  );
}

function Workspace({ row, requests, onClose }: { row: FacilityRow; requests: Disbursement[]; onClose: () => void }) {
  const { facility, obligor, app } = row;
  const { actor } = useScope();
  const canEdit = useCan("disbursement", "edit");
  const stepUpThreshold = useRule<number>("approvals.stepUpThresholdNgn");
  const accountLength = useRule<number>("disbursement.accountNumberLength");
  const makerRoles = useRule<RoleId[]>("disbursement.makerRoles");
  const userId = actor.id;
  const roleId = actor.roleId;
  const isMakerRole = canEdit && makerRoles.includes(roleId);
  const isCheckerRole = canEdit && checkerRoles().includes(roleId);
  const latest = requests[0];
  const awaiting = latest?.status === "Awaiting authorisation" ? latest : undefined;
  const pendingOp = usePendingFor("Disbursement", awaiting?.id ?? "-");
  const stepUpPassed = useRef(false);
  const pendingFacility = facility.status === "Pending disbursement";
  const openCps = row.cps.filter((c) => !isCleared(c.status));
  const mChecks = makerChecks(userId, roleId, app);
  const cChecks = checkerChecks(userId, roleId, app, awaiting);
  const makerOk = mChecks.every((c) => c.ok);
  const checkerOk = cChecks.every((c) => c.ok);
  const gateOk = !!row.released && openCps.length === 0;
  const canPrepare = pendingFacility && !awaiting && makerOk && gateOk;

  const returned = latest && (latest.status === "Returned to maker" || latest.status === "Rejected") ? latest : undefined;
  const [amount, setAmount] = useState(String(returned?.amount ?? row.undisbursed));
  const [account, setAccount] = useState(returned?.accountNumber ?? accountFor(obligor));
  const [accountName, setAccountName] = useState(returned?.accountName ?? obligor?.name ?? "");
  const [valueDate, setValueDate] = useState(DEMO_NOW.toISOString().slice(0, 10));
  const [narration, setNarration] = useState(`${facility.product} drawdown — ${facility.id}`);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const amt = Number(amount.replace(/[^\d.]/g, ""));
  const amountError = !amt || amt <= 0 ? "Enter an amount greater than zero" : amt > row.undisbursed ? `Can't exceed the undisbursed approved amount (${money(row.undisbursed, facility.currency)})` : undefined;
  const accountError = new RegExp(`^\\d{${accountLength}}$`).test(account) ? undefined : `Enter the ${accountLength}-digit NUBAN account number`;
  const nameError = accountName.trim() ? undefined : "Enter the account name";

  async function prepare() {
    setTouched(true);
    if (amountError || accountError || nameError || !canPrepare) return;
    const at = demoNowIso();
    const d: Disbursement = {
      id: newId("DSB"),
      facilityId: facility.id,
      obligorId: facility.obligorId,
      amount: amt,
      currency: facility.currency,
      accountNumber: account,
      accountName: accountName.trim(),
      valueDate: new Date(`${valueDate}T09:00:00+01:00`).toISOString(),
      narration,
      status: "Awaiting authorisation",
      makerId: userId,
      makerName: actor.name,
      preparedAt: at,
    };
    const r = await prepareDisbursement(d, app?.id);
    setDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.reason });
  }

  async function decide({ decision, comment }: DecisionSubmission) {
    if (!awaiting || !checkerOk || !pendingOp) return;
    const r = await decideDisbursement(pendingOp.id, decision === "approve" ? "approve" : decision === "return" ? "return" : "reject", comment, stepUpPassed.current);
    stepUpPassed.current = false;
    setDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.reason });
  }

  function stepUp(): Promise<boolean> {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setStepUpOpen(true);
    });
  }

  const cpItems: ChecklistItem[] = row.cps.map((c) => ({ id: c.id, title: c.title, description: c.category, status: c.status, owner: c.byName }));

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      size="large"
      title={`${obligor?.name ?? facility.obligorId} — ${facility.product}`}
      description={`Facility ${facility.id}${app ? ` · application ${app.id}` : ""}`}
    >
      <Stack gap="large">
        {done ? (
          <Alert tone={done.ok ? "success" : "danger"} title={done.ok ? "Done" : "Not done"}>
            {done.text}
          </Alert>
        ) : null}
        {pendingOp ? (
          <PendingOperationNotice instance={pendingOp} title="Awaiting Checker authorisation">
            {pendingOp.requestedBy.id === userId ? "You prepared it, so a different Checker must decide. " : ""}
          </PendingOperationNotice>
        ) : null}

        <DescriptionList
          columns={2}
          items={[
            { label: "Approved amount", value: money(facility.approvedAmount, facility.currency), mono: true },
            { label: "Undisbursed", value: money(row.undisbursed, facility.currency), mono: true, hint: "Approved amount − outstanding" },
            { label: "Facility status", status: facility.status, statusTones: { Active: "success", "Pending disbursement": "info" } },
            { label: "Tenor / rate", value: `${facility.tenorMonths} months · ${facility.ratePct.toFixed(1)}% p.a.` },
            { label: "Branch", value: facility.branch },
            {
              label: "Credit Admin release",
              value: row.released ? `Released by ${row.released.byName} · ${date(row.released.at)}` : "Not yet released for disbursement",
            },
            {
              label: "Records",
              span: 2,
              value: (
                <span className="flex flex-wrap gap-3">
                  <TextLink as={Link} href={`/credit-admin/facility/?id=${facility.id}`}>Facility record</TextLink>
                  {app ? <TextLink as={Link} href={`/offer-letters/letter/?applicationId=${app.id}`}>Offer letter</TextLink> : null}
                  {app ? <TextLink as={Link} href={`/origination/application/?id=${app.id}`}>Application</TextLink> : null}
                </span>
              ),
            },
          ]}
        />

        {pendingFacility && !gateOk ? (
          <Alert tone="warning" title="Not ready for disbursement">
            {!row.released ? "Credit Administration hasn't released this file for disbursement yet. " : ""}
            {openCps.length ? `${openCps.length} condition${openCps.length > 1 ? "s" : ""} precedent still open: ${openCps.map((c) => c.title).join(", ")}. ` : ""}
            The Maker can prepare the disbursement once every condition is met, waived or deferred and the file is released.
          </Alert>
        ) : null}
        {!pendingFacility && !awaiting ? (
          <Alert tone="success" title="Disbursed">
            This facility is {facility.status.toLowerCase()} with {money(facility.outstanding, facility.currency)} outstanding.
          </Alert>
        ) : null}

        {isMakerRole && pendingFacility && !awaiting ? (
          <Card variant="outlined">
            <CardHeader>
              <CardTitle>Prepare disbursement</CardTitle>
              <CardDescription>
                {returned ? `Last request ${returned.id} was ${returned.status.toLowerCase()}${returned.comment ? `: “${returned.comment}”` : ""}. Correct and resubmit.` : "Execution only, within the approved facility amount (PRD §4.1)."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!makerOk ? (
                <Alert tone="danger" title="You can't prepare this disbursement">
                  {mChecks.filter((c) => !c.ok).map((c) => c.detail).join(". ")}.
                </Alert>
              ) : (
                <Form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void prepare();
                  }}
                >
                  <Grid columns={{ base: 1, md: 2 }} gap="medium">
                    <Field label="Amount" required error={touched ? amountError : undefined} description={`Up to ${money(row.undisbursed, facility.currency)}`}>
                      <Input prefix={facility.currency === "USD" ? "$" : "₦"} numeric inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!gateOk} />
                    </Field>
                    <Field label="Value date" required>
                      <Input type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} disabled={!gateOk} />
                    </Field>
                    <Field label="Beneficiary account (NUBAN)" required error={touched ? accountError : undefined} description="Customer's operating account in the CBA">
                      <Input inputMode="numeric" maxLength={accountLength} className="font-mono" value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))} disabled={!gateOk} />
                    </Field>
                    <Field label="Account name" required error={touched ? nameError : undefined}>
                      <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} disabled={!gateOk} />
                    </Field>
                  </Grid>
                  <Field label="Narration">
                    <Input value={narration} onChange={(e) => setNarration(e.target.value)} disabled={!gateOk} />
                  </Field>
                  <FormActions>
                    <Button type="submit" disabled={!canPrepare}>
                      Submit for authorisation
                    </Button>
                  </FormActions>
                </Form>
              )}
            </CardContent>
          </Card>
        ) : null}

        {awaiting ? (
          <Card variant="outlined">
            <CardHeader>
              <CardTitle>Authorisation</CardTitle>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <DescriptionList
                  columns={2}
                  items={[
                    { label: "Request", value: awaiting.id, mono: true },
                    { label: "Amount", value: money(awaiting.amount, awaiting.currency), mono: true },
                    { label: "Beneficiary", value: `${awaiting.accountName} · ${awaiting.accountNumber}` },
                    { label: "Value date", value: date(awaiting.valueDate) },
                    { label: "Prepared by", value: `${awaiting.makerName} · ${dateTime(awaiting.preparedAt)}` },
                    { label: "Step-up", value: awaiting.amount > stepUpThreshold ? `Required — above ${moneyShort(stepUpThreshold)}` : "Not required" },
                    { label: "Narration", value: awaiting.narration, span: 2 },
                  ]}
                />
                {!pendingOp ? (
                  <Alert tone="warning" title="Not yet routed to Operations">
                    This request pre-dates the Operations workflow.{" "}
                    {awaiting.makerId === userId && isMakerRole ? (
                      <Button size="small" variant="text" onClick={() => void prepareDisbursement(awaiting, app?.id).then((r) => setDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.reason }))}>
                        Route to Operations
                      </Button>
                    ) : (
                      "The Maker who prepared it must route it to Operations."
                    )}
                  </Alert>
                ) : pendingOp.requestedBy.id === userId ? (
                  <Button variant="secondary" onClick={() => void withdrawDisbursement(pendingOp.id, "Withdrawn by the Maker").then((r) => setDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.reason }))}>
                    Withdraw request
                  </Button>
                ) : isCheckerRole ? (
                  <DecisionPanel
                    title="Checker decision"
                    actions={["approve", "return", "decline"]}
                    actionLabels={{ approve: "Authorise", return: "Return to maker", decline: "Reject" }}
                    commentRequired={["return", "decline"]}
                    requireStepUp={(d) => d === "approve" && awaiting.amount > stepUpThreshold}
                    onStepUp={stepUp}
                    onDecide={decide}
                    disabled={!checkerOk}
                    notice={
                      checkerOk ? (
                        <Text variant="small" tone="muted">
                          Your decision is recorded on Operations request {pendingOp.id}. Authorising posts the disbursement to the CBA (simulated) and activates the facility.
                        </Text>
                      ) : (
                        <Alert tone="danger" title="You can't authorise this disbursement">
                          {cChecks.filter((c) => !c.ok).map((c) => c.detail).join(". ")}.
                        </Alert>
                      )
                    }
                  />
                ) : (
                  <Alert tone="info" title="Awaiting a Disbursement Checker">
                    A Disbursement Checker who isn&apos;t the Maker, initiator or recommender must authorise this request.
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>
        ) : null}

        <Card variant="outlined">
          <CardHeader>
            <CardTitle>Segregation of duties</CardTitle>
            <CardDescription>
              PRD §4.2: whoever initiated or recommended the facility can&apos;t be its Maker or Checker, and the Checker must be a different person from the Maker. Switching role from the user menu keeps you the same person — try it to see no-self-approval enforced.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              {!isCheckerRole ? <SodPanel title={`You (${actor.name}) as Maker`} checks={mChecks} /> : null}
              {!isMakerRole ? <SodPanel title={`You (${actor.name}) as Checker`} checks={cChecks} /> : null}
            </Stack>
          </CardContent>
        </Card>

        <ChecklistPanel
          title="Conditions precedent to drawdown"
          description="Confirmed by Credit Administration (PRD §6.1.1 step 15, §7.1). Approved deferrals count as cleared."
          items={cpItems}
          action={
            <Button as={Link} href={`/credit-admin/facility/?id=${facility.id}`} size="small" variant="tertiary">
              Open in Credit Admin
            </Button>
          }
        />

        {requests.length ? (
          <ActivityFeed
            label="Disbursement activity"
            items={requests.flatMap((r) => [
              ...(r.decidedAt ? [{ id: `${r.id}-d`, actor: r.checkerName ?? "Checker", action: r.status === "Authorised" ? "authorised" : r.status === "Rejected" ? "rejected" : "returned", target: `${r.id} · ${money(r.amount, r.currency)}`, timestamp: r.decidedAt, note: r.comment || (r.cbaReference ? `CBA ref ${r.cbaReference}` : undefined) }] : []),
              { id: `${r.id}-p`, actor: r.makerName, action: "prepared", target: `${r.id} · ${money(r.amount, r.currency)}`, timestamp: r.preparedAt },
            ])}
          />
        ) : null}
      </Stack>

      <StepUpAuthDialog
        open={stepUpOpen}
        onOpenChange={(o) => {
          setStepUpOpen(o);
          if (!o && resolver.current) {
            resolver.current(false);
            resolver.current = null;
          }
        }}
        onVerify={async (code) => {
          // TD-858: demo OTP check (any 6 digits) until the step-up provider is integrated.
          const ok = /^\d{6}$/.test(code);
          if (ok) stepUpPassed.current = true;
          if (ok && resolver.current) {

            resolver.current(true);
            resolver.current = null;
          }
          return ok;
        }}
        summary={awaiting ? `Authorise ${money(awaiting.amount, awaiting.currency)} to ${awaiting.accountName}` : undefined}
        description="High-value disbursement — enter the one-time code sent to your registered device. Demo: any 6-digit code works."
        errorMessage="Enter all 6 digits."
      />
    </Drawer>
  );
}
