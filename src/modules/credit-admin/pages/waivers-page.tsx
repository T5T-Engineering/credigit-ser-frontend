"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlarmClock, BellRing, FilePlus2, Gavel, Hourglass, Send, ShieldAlert } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DecisionPanel,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  Form,
  Grid,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Spinner,
  Stack,
  StatCard,
  StatusBadge,
  Text,
  Textarea,
  TextLink,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { newId } from "@/lib/data/store";
import { date, dateTime } from "@/lib/format";
import { canDecide, decideOperation, getDefinition, useOperationsStore, usePendingFor, type OperationInstance } from "@/lib/platform/operations";
import { getRule, useRule } from "@/lib/platform/rules";
import { useScope, type Actor } from "@/lib/platform/scope";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { closeWaiver, sendExpiryReminders, submitWaiver, type ActionResult } from "../actions";
import { addDaysIso, daysBetween, demoNowIso } from "../common";
import { canApproveAtTier, daysToExpiry, isWithinTolerance, toleranceNote, useFacilityRows, useWaivers, waiverStatus } from "../logic";
import { PendingOperationNotice } from "../operations-ui";
import type { WaiverKind, WaiverRequest } from "../store";
import { waiverKindTones, waiverStatusTones } from "../view";

/** Sanction approvers come from the Operations workflow definition (tenant-configurable). */
function sanctionRoles(): RoleId[] {
  return getDefinition("credit-admin.sanction").steps.flatMap((s) => s.approverRoles);
}

function approversOf(w: WaiverRequest): RoleId[] {
  return w.kind === "Sanction for breach" ? sanctionRoles() : w.approverRoleIds;
}

function roleNames(ids: RoleId[]) {
  return ids.map((r) => roleById[r]?.name ?? r).join(" / ");
}

function roleShorts(ids: RoleId[]) {
  return ids.map((r) => roleById[r]?.short ?? r).join(" / ");
}

/** Whether the actor can decide this request now (Operations step + facility tier / delegated tolerance). */
function canActOn(w: WaiverRequest, op: OperationInstance | undefined, actor: Actor): boolean {
  if (!op || !canDecide(op, actor).ok) return false;
  if (w.kind === "Sanction for breach") return true;
  return canApproveAtTier(actor.roleId, w.approverRoleIds) || (w.withinTolerance && getRule<RoleId[]>("credit-admin.delegatedApproverRoles").includes(actor.roleId));
}

type Row = WaiverRequest & { effective: WaiverRequest["status"]; obligorName: string; daysLeft?: number; op?: OperationInstance; awaitingMe: boolean };
type Scope = "all" | "mine" | "awaiting";

export function WaiversPage() {
  return (
    <Suspense fallback={<Spinner label="Loading waivers" />}>
      <Waivers />
    </Suspense>
  );
}

function Waivers() {
  const params = useSearchParams();
  const prefillFacility = params.get("facility") ?? "";
  const waivers = useWaivers();
  const facilityRows = useFacilityRows();
  const { actor } = useScope();
  const instances = useOperationsStore((s) => s.instances);
  const requesterRoles = useRule<RoleId[]>("credit-admin.requesterRoles");
  const reminderDays = useRule<number>("credit-admin.waiverReminderDays");
  const canEdit = useCan("credit-admin", "edit");
  const isRequester = canEdit && requesterRoles.includes(actor.roleId);
  const [newOpen, setNewOpen] = useState(params.get("new") === "1" && isRequester);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [notice, setNotice] = useState<ActionResult | null>(null);

  const rows: Row[] = useMemo(() => {
    const open = new Map(instances.filter((i) => i.subject.type === "Waiver" && ["Pending", "In progress"].includes(i.status)).map((i) => [i.subject.id, i]));
    return waivers.map((w) => {
      const effective = waiverStatus(w);
      const op = open.get(w.id);
      return {
        ...w,
        effective,
        op,
        awaitingMe: canActOn(w, op, actor),
        obligorName: facilityRows.find((r) => r.facility.id === w.facilityId)?.obligor?.name ?? "",
        daysLeft: w.kind !== "Sanction for breach" && (effective === "Approved" || effective === "Pending approval") ? daysToExpiry(w.expiryDate) : undefined,
      };
    });
  }, [waivers, facilityRows, instances, actor]);
  const scoped = scope === "all" ? rows : rows.filter((r) => (scope === "mine" ? r.requestedById === actor.id : r.awaitingMe));
  const filtered = prefillFacility && !newOpen ? scoped.filter((r) => r.facilityId === prefillFacility) : scoped;
  const selected = rows.find((r) => r.id === selectedId);

  const kpi = {
    pending: rows.filter((r) => r.effective === "Pending approval").length,
    active: rows.filter((r) => r.effective === "Approved").length,
    expiring: rows.filter((r) => r.effective === "Approved" && r.daysLeft !== undefined && r.daysLeft <= reminderDays).length,
    sanctions: rows.filter((r) => r.kind === "Sanction for breach").length,
  };

  const columns: DataTableColumn<Row>[] = [
    { id: "id", header: "Request", accessor: "id", sortable: true, cell: (r) => <span className="font-mono text-sm font-semibold whitespace-nowrap text-fg">{r.id}</span> },
    { id: "kind", header: "Type", accessor: "kind", sortable: true, cell: (r) => <Badge tone={waiverKindTones[r.kind]}>{r.kind === "Sanction for breach" ? "Sanction" : r.kind}</Badge> },
    {
      id: "facility",
      header: "Facility",
      accessor: (r) => `${r.facilityId} ${r.obligorName}`,
      cell: (r) => (
        <Stack gap="none">
          <span className="font-mono text-sm whitespace-nowrap">{r.facilityId}</span>
          <span className="text-xs text-fg-muted">{r.obligorName}</span>
        </Stack>
      ),
    },
    { id: "condition", header: "Condition", accessor: "conditionTitle", cell: (r) => <span className="text-fg">{r.conditionTitle}</span> },
    {
      id: "approver",
      header: "Approver",
      accessor: (r) => (r.withinTolerance ? "Credit Administration (within tolerance)" : roleNames(approversOf(r))),
      cell: (r) => (
        <span className="whitespace-nowrap text-sm" title={roleNames(approversOf(r))}>
          {r.withinTolerance ? "CAD · within tolerance" : roleShorts(approversOf(r))}
        </span>
      ),
    },
    {
      id: "expiry",
      header: "Expiry",
      accessor: (r) => r.expiryDate ?? "",
      sortable: true,
      cell: (r) =>
        r.expiryDate ? (
          <Stack gap="none">
            <span className="font-mono text-sm">{date(r.expiryDate)}</span>
            {r.daysLeft !== undefined ? (
              r.daysLeft <= reminderDays ? (
                <Badge tone={r.daysLeft < 0 ? "danger" : "warning"}>
                  <BellRing aria-hidden className="size-3" /> {r.daysLeft < 0 ? "Overdue" : `${r.daysLeft} days left`}
                </Badge>
              ) : (
                <span className="text-xs text-fg-muted">{r.daysLeft} days left</span>
              )
            ) : null}
          </Stack>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { id: "requested", header: "Requested", accessor: "requestedAt", sortable: true, cell: (r) => <span className="font-mono text-sm">{date(r.requestedAt)}</span> },
    {
      id: "status",
      header: "Status",
      accessor: (r) => r.effective,
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <StatusBadge status={r.effective} tones={waiverStatusTones} />
          {r.awaitingMe ? <Badge tone="accent">Awaiting your decision</Badge> : r.effective === "Pending approval" && !r.op ? <span className="text-xs text-fg-subtle">Not yet routed</span> : null}
        </Stack>
      ),
    },
  ];

  return (
    <ModulePage
      module="credit-admin"
      description="Waivers and deferrals of approved conditions, and sanctions for credit-policy breaches (PRD §6.3.2). Every decision runs through the Operations workflow."
      actions={
        isRequester ? (
          <Stack direction="horizontal" gap="small" wrap>
            <Button variant="tertiary" iconBefore={<BellRing aria-hidden className="size-4" />} onClick={() => setNotice(sendExpiryReminders(waivers))}>
              Send expiry reminders
            </Button>
            <Button iconBefore={<FilePlus2 aria-hidden className="size-4" />} onClick={() => setNewOpen(true)}>
              New request
            </Button>
          </Stack>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Pending approval" value={String(kpi.pending)} icon={<Hourglass aria-hidden />} tone="info" hint="Routed to the approving tier" />
          <StatCard label="Active waivers & deferrals" value={String(kpi.active)} icon={<Gavel aria-hidden />} hint="Approved and not yet lapsed" />
          <StatCard label={`Expiring ≤ ${reminderDays} days`} value={String(kpi.expiring)} icon={<AlarmClock aria-hidden />} tone="warning" hint="Reminder sweep notifies before lapse" />
          <StatCard label="Sanctions for breach" value={String(kpi.sanctions)} icon={<ShieldAlert aria-hidden />} tone="danger" hint="Feed the Operational Risk loss-event register" />
        </Grid>

        {notice ? (
          <Alert tone={notice.ok ? "success" : "danger"} title={notice.ok ? "Done" : "Not done"} action={<Button size="small" variant="text" onClick={() => setNotice(null)}>Dismiss</Button>}>
            {notice.ok ? notice.message : notice.reason}
          </Alert>
        ) : null}

        <Alert tone="info" title="Routing (Operations workflow)">
          A waiver or deferral is approved at the same tier that approved the original facility, or higher (PRD §6.3.2). Requests within Credit Administration&apos;s delegated tolerance — {toleranceNote()} — can be approved by Credit Administration. Sanctions for breach route to the escalation
          workflow ({roleNames(sanctionRoles())}) and feed the{" "}
          <TextLink as={Link} href="/operational-risk/loss-events/">
            loss-event register
          </TextLink>
          . Reminder window: {reminderDays} days before expiry. Steps, approvers and SLAs are configured in{" "}
          <TextLink as={Link} href="/operations/workflows">
            Operations → Workflows
          </TextLink>
          .
        </Alert>

        <div className="overflow-x-auto">
          <SegmentedControl
            label="Show"
            value={scope}
            onChange={(v) => setScope(v as Scope)}
            options={[
              { value: "all", label: `All requests (${rows.length})` },
              { value: "mine", label: `My requests (${rows.filter((r) => r.requestedById === actor.id).length})` },
              { value: "awaiting", label: `Awaiting my decision (${rows.filter((r) => r.awaitingMe).length})` },
            ]}
          />
        </div>

        {prefillFacility && !newOpen ? (
          <Alert tone="info" title={`Showing requests for ${prefillFacility}`} action={<Button as={Link} href="/credit-admin/waivers/" size="small" variant="tertiary">Show all</Button>}>
            {filtered.length} request(s) on this facility.
          </Alert>
        ) : null}

        <DataTable
          label="Waivers, deferrals and sanctions"
          columns={columns}
          data={filtered}
          getRowId={(r) => r.id}
          onRowClick={(r) => setSelectedId(r.id)}
          searchable
          searchPlaceholder="Search request, facility, condition…"
          filters={[
            { id: "kind", label: "Type" },
            { id: "status", label: "Status" },
          ]}
          defaultSort={{ id: "requested", direction: "desc" }}
          exportFilename="waivers-deferrals.csv"
          emptyState={<EmptyState icon={<Gavel aria-hidden />} title="No requests" description={scope === "awaiting" ? "Nothing is waiting for your decision." : "No waivers, deferrals or sanctions match the current filters."} />}
          mobileCard={(r) => (
            <Stack gap="small">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{r.id}</span>
                <StatusBadge status={r.effective} tones={waiverStatusTones} />
              </div>
              <Text variant="small">
                {r.kind} — {r.conditionTitle}
              </Text>
              <Text variant="caption" tone="muted">
                {r.facilityId} · {r.obligorName}
              </Text>
            </Stack>
          )}
        />
      </Stack>

      <NewRequestModal open={newOpen} onOpenChange={setNewOpen} defaultFacility={prefillFacility} onCreated={(id) => setSelectedId(id)} />
      {selected ? <RequestDrawer row={selected} isRequester={isRequester} onClose={() => setSelectedId(null)} /> : null}
    </ModulePage>
  );
}

function strip(row: Row): WaiverRequest {
  const { effective: _e, obligorName: _o, daysLeft: _d, op: _p, awaitingMe: _a, ...base } = row;
  void _e;
  void _o;
  void _d;
  void _p;
  void _a;
  return base;
}

function RequestDrawer({ row, isRequester, onClose }: { row: Row; isRequester: boolean; onClose: () => void }) {
  const { actor } = useScope();
  const pending = usePendingFor("Waiver", row.id);
  const [result, setResult] = useState<ActionResult | null>(null);
  const approvers = approversOf(row);
  const isSanction = row.kind === "Sanction for breach";
  const mayDecide = canActOn(row, pending, actor);
  const canClose = isRequester && row.effective === "Approved" && !isSanction;
  const canResubmit = isRequester && !pending && (row.effective === "Returned to requester" || row.effective === "Withdrawn" || row.effective === "Pending approval");

  const decide = async (decision: string, comment: string) => {
    if (!pending) return;
    const r = await decideOperation(pending.id, decision === "decline" ? "reject" : decision === "return" ? "return" : "approve", comment);
    setResult(r.ok ? { ok: true, message: `Decision recorded on ${pending.id}.` } : { ok: false, reason: r.reason });
  };

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      size="large"
      title={`${row.kind} ${row.id}`}
      description={`${row.facilityId} · ${row.obligorName}`}
      footer={
        <Stack direction="horizontal" gap="small" wrap>
          <Button as={Link} href={`/credit-admin/facility/?id=${row.facilityId}`} variant="tertiary">
            Open facility
          </Button>
          {canResubmit ? (
            <Button iconBefore={<Send aria-hidden className="size-4" />} onClick={() => void submitWaiver(strip(row)).then(setResult)}>
              {row.effective === "Pending approval" ? "Route to Operations" : "Resubmit for approval"}
            </Button>
          ) : null}
          {canClose ? <Button onClick={() => setResult(closeWaiver(strip(row)))}>Mark regularised (close)</Button> : null}
        </Stack>
      }
    >
      <Stack gap="large">
        {result ? (
          <Alert tone={result.ok ? "success" : "danger"} title={result.ok ? "Done" : "Not done"}>
            {result.ok ? result.message : result.reason}
          </Alert>
        ) : null}
        <DescriptionList
          columns={2}
          items={[
            { label: "Status", status: row.effective, statusTones: waiverStatusTones },
            { label: "Type", value: row.kind },
            { label: "Condition", value: `${row.conditionId} — ${row.conditionTitle}`, span: 2 },
            { label: "Category", value: row.conditionCategory },
            { label: isSanction ? "Raised" : "Expiry / deferred to", value: isSanction ? dateTime(row.requestedAt) : row.expiryDate ? date(row.expiryDate) : "—", mono: true },
            { label: "Requested by", value: `${row.requestedByName} · ${dateTime(row.requestedAt)}` },
            { label: "Approver", value: row.withinTolerance ? "Credit Administration — within delegated tolerance" : roleNames(approvers), hint: isSanction ? "Disciplinary / escalation workflow" : "Tier that approved the original facility" },
            { label: "Reason", value: row.reason, span: 2 },
            ...(row.breachDetail ? [{ label: "Breach detail", value: row.breachDetail, span: 2 as const }] : []),
            ...(row.decidedByName ? [{ label: "Decision by", value: `${row.decidedByName}${row.decidedAt ? ` · ${dateTime(row.decidedAt)}` : ""}` }] : []),
            ...(row.decisionComment ? [{ label: "Decision comment", value: row.decisionComment }] : []),
            ...(row.lossEventRef ? [{ label: "Loss event", value: row.lossEventRef, mono: true, hint: "Operational Risk loss-event register (§6.9)" }] : []),
            ...(row.operationId ? [{ label: "Operations request", value: <TextLink as={Link} href={`/operations/item?id=${row.operationId}`}>{row.operationId}</TextLink> }] : []),
          ]}
        />
        {row.lossEventRef ? (
          <Alert tone="danger" title="Fed to Operational Risk">
            Logged as loss event {row.lossEventRef} and counted in the credit-policy-breach KRI.{" "}
            <TextLink as={Link} href="/operational-risk/loss-events/">
              Open loss events
            </TextLink>
          </Alert>
        ) : null}
        {pending ? (
          mayDecide ? (
            <DecisionPanel
              title={isSanction ? "Escalation decision" : "Your decision"}
              actions={["approve", "return", "decline"]}
              actionLabels={isSanction ? { approve: "Route to Operational Risk", decline: "Dismiss" } : { approve: `Approve ${row.kind.toLowerCase()}` }}
              commentRequired={["decline", "return"]}
              notice={row.withinTolerance && !canApproveAtTier(actor.roleId, row.approverRoleIds) ? `Within Credit Administration's delegated tolerance (${toleranceNote()}).` : isSanction ? "Routes the breach to Operational Risk as a loss event." : `You are approving at the ${roleNames(approvers)} tier or above.`}
              onDecide={({ decision, comment }) => decide(decision, comment)}
            />
          ) : (
            <PendingOperationNotice instance={pending} title="Awaiting the approving tier">
              Needs {row.withinTolerance ? "Credit Administration or " : ""}
              {roleNames(approvers)} (or a higher tier); the requester can&apos;t decide their own request.{" "}
            </PendingOperationNotice>
          )
        ) : row.effective === "Pending approval" ? (
          <Alert tone="warning" title="Not yet routed to Operations">
            This request pre-dates the Operations workflow. {isRequester ? "Route it to Operations to get a decision." : "Credit Administration needs to route it to Operations."}
          </Alert>
        ) : null}
      </Stack>
    </Drawer>
  );
}

function NewRequestModal({ open, onOpenChange, defaultFacility, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; defaultFacility: string; onCreated: (id: string) => void }) {
  const rows = useFacilityRows();
  const { actor } = useScope();
  const minReason = useRule<number>("credit-admin.minReasonLength");
  const defaultDays = useRule<number>("credit-admin.defaultDeferralDays");
  const [kind, setKind] = useState<WaiverKind>("Deferral");
  const [facilityId, setFacilityId] = useState(defaultFacility);
  const [conditionId, setConditionId] = useState("");
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState(addDaysIso(DEMO_NOW, defaultDays).slice(0, 10));
  const [breach, setBreach] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const eligible = useMemo(() => rows.filter((r) => r.cps.length > 0 && (r.facility.status === "Pending disbursement" || r.facility.status === "Active")).sort((a, b) => a.facility.status.localeCompare(b.facility.status) * -1 || a.facility.id.localeCompare(b.facility.id)), [rows]);
  const fac = eligible.find((r) => r.facility.id === facilityId);
  const conditions = fac ? (kind === "Sanction for breach" ? fac.cps : fac.cps.filter((c) => c.status === "pending" || c.status === "breached" || c.status === "deferred")) : [];
  const cp = conditions.find((c) => c.id === conditionId);
  const days = daysBetween(DEMO_NOW, expiry);
  const withinTolerance = isWithinTolerance(kind, cp?.category, days);

  const submit = async () => {
    if (!fac || !cp) return setError("Choose a facility and a condition.");
    if (reason.trim().length < minReason) return setError(`Give a reason (at least ${minReason} characters).`);
    if (kind !== "Sanction for breach" && days <= 0) return setError("The expiry / deferred-to date must be in the future.");
    const id = newId("WVR");
    setBusy(true);
    const r = await submitWaiver({
      id,
      kind,
      facilityId: fac.facility.id,
      cpKey: fac.cpKey,
      conditionId: cp.id,
      conditionTitle: cp.title,
      conditionCategory: cp.category,
      reason: reason.trim(),
      requestedById: actor.id,
      requestedByName: actor.name,
      requestedAt: demoNowIso(),
      expiryDate: kind === "Sanction for breach" ? undefined : new Date(`${expiry}T17:00:00+01:00`).toISOString(),
      status: "Pending approval",
      approverRoleIds: kind === "Sanction for breach" ? sanctionRoles() : fac.approverRoleIds,
      withinTolerance,
      breachDetail: kind === "Sanction for breach" ? breach.trim() || undefined : undefined,
    });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setError(null);
    setReason("");
    setBreach("");
    setConditionId("");
    onOpenChange(false);
    onCreated(id);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="large"
      title="New waiver, deferral or sanction"
      description="Raised by Credit Administration against a specific approved condition and routed through the Operations workflow (PRD §6.3.2)."
      footer={
        <>
          <Button variant="tertiary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Submit for approval
          </Button>
        </>
      }
    >
      <Form onSubmit={(e) => e.preventDefault()}>
        <Field label="Request type" htmlFor="w-kind">
          <Select
            id="w-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as WaiverKind);
              setConditionId("");
            }}
            options={[
              { value: "Deferral", label: "Deferral — condition satisfied after drawdown by a set date" },
              { value: "Waiver", label: "Waiver — condition set aside until expiry" },
              { value: "Sanction for breach", label: "Sanction for breach — credit-policy breach" },
            ]}
          />
        </Field>
        <Field label="Facility" htmlFor="w-fac">
          <Select
            id="w-fac"
            value={facilityId}
            placeholder="Choose a facility"
            onChange={(e) => {
              setFacilityId(e.target.value);
              setConditionId("");
            }}
            options={eligible.map((r) => ({ value: r.facility.id, label: `${r.facility.id} — ${r.obligor?.name ?? ""} (${r.facility.status})` }))}
          />
        </Field>
        <Field label="Condition" htmlFor="w-cp" description={fac && conditions.length === 0 ? "No open conditions on this facility." : undefined}>
          <Select id="w-cp" value={conditionId} placeholder="Choose a condition" disabled={!fac} onChange={(e) => setConditionId(e.target.value)} options={conditions.map((c) => ({ value: c.id, label: `${c.id} · ${c.title} (${c.status})` }))} />
        </Field>
        {kind !== "Sanction for breach" ? (
          <Field label={kind === "Deferral" ? "Deferred to" : "Waiver expiry"} htmlFor="w-exp" description={days > 0 ? `${days} days from today` : undefined}>
            <Input id="w-exp" type="date" value={expiry} min={DEMO_NOW.toISOString().slice(0, 10)} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        ) : (
          <Field label="Breach detail" htmlFor="w-breach" optional description="Unit / staff involved and how the breach was identified">
            <Input id="w-breach" value={breach} onChange={(e) => setBreach(e.target.value)} />
          </Field>
        )}
        <Field label="Reason" htmlFor="w-reason" required>
          <Textarea id="w-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {fac && cp ? (
          <Alert tone={withinTolerance ? "success" : "info"} title="Routing">
            {kind === "Sanction for breach"
              ? `Routes to ${roleNames(sanctionRoles())} for the disciplinary / escalation workflow and the Operational Risk loss-event register.`
              : withinTolerance
                ? `Within Credit Administration's delegated tolerance — Credit Administration can approve (${toleranceNote()}).`
                : `Routes to ${roleNames(fac.approverRoleIds)} — the tier that approved the original facility.`}
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="danger" title="Check the form">
            {error}
          </Alert>
        ) : null}
      </Form>
    </Modal>
  );
}
