"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlarmClock, BellRing, FilePlus2, Gavel, Hourglass, ShieldAlert } from "lucide-react";
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
import { useCan, useSession } from "@/lib/auth/session";
import { newId } from "@/lib/data/store";
import { date, dateTime } from "@/lib/format";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { addDaysIso, daysBetween, demoNowIso, hash, useAuditLog } from "../common";
import { canApproveAtTier, DELEGATED_TOLERANCE, daysToExpiry, REMINDER_DAYS, useFacilityRows, useWaivers, waiverStatus } from "../logic";
import { useCreditAdminStore, type WaiverKind, type WaiverRequest } from "../store";
import { waiverKindTones, waiverStatusTones } from "../view";
import { DEMO_NOW } from "@/lib/data/seed";

/** Sanctions for breach route to the disciplinary / escalation workflow (PRD §6.3.2) — default: Head of Risk or CRO. */
const SANCTION_ROUTE: RoleId[] = ["head-of-risk", "cro"];

function approversOf(w: WaiverRequest): RoleId[] {
  return w.kind === "Sanction for breach" ? SANCTION_ROUTE : w.approverRoleIds;
}

function roleNames(ids: RoleId[]) {
  return ids.map((r) => roleById[r]?.name ?? r).join(" / ");
}

function roleShorts(ids: RoleId[]) {
  return ids.map((r) => roleById[r]?.short ?? r).join(" / ");
}

type Row = WaiverRequest & { effective: WaiverRequest["status"]; obligorName: string; daysLeft?: number };

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
  const roleId = useSession((s) => s.roleId) ?? undefined;
  const canEdit = useCan("credit-admin", "edit");
  const isCad = roleId === "credit-admin-officer" && canEdit;
  const [newOpen, setNewOpen] = useState(params.get("new") === "1" && isCad);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows: Row[] = useMemo(
    () =>
      waivers.map((w) => {
        const effective = waiverStatus(w);
        return {
          ...w,
          effective,
          obligorName: facilityRows.find((r) => r.facility.id === w.facilityId)?.obligor?.name ?? "",
          daysLeft: w.kind !== "Sanction for breach" && (effective === "Approved" || effective === "Pending approval") ? daysToExpiry(w.expiryDate) : undefined,
        };
      }),
    [waivers, facilityRows],
  );
  const filtered = prefillFacility && !newOpen ? rows.filter((r) => r.facilityId === prefillFacility) : rows;
  const selected = rows.find((r) => r.id === selectedId);

  const kpi = {
    pending: rows.filter((r) => r.effective === "Pending approval").length,
    active: rows.filter((r) => r.effective === "Approved").length,
    expiring: rows.filter((r) => r.effective === "Approved" && r.daysLeft !== undefined && r.daysLeft <= REMINDER_DAYS).length,
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
    { id: "approver", header: "Approver", accessor: (r) => (r.withinTolerance ? "Credit Administration (within tolerance)" : roleNames(approversOf(r))), cell: (r) => (
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
              r.daysLeft <= REMINDER_DAYS ? (
                <Badge tone={r.daysLeft < 0 ? "danger" : "warning"}>
                  <BellRing aria-hidden className="size-3" /> {r.daysLeft < 0 ? "Overdue" : `${r.daysLeft} days left — reminder sent`}
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
    { id: "status", header: "Status", accessor: (r) => r.effective, sortable: true, cell: (r) => <StatusBadge status={r.effective} tones={waiverStatusTones} /> },
  ];

  return (
    <ModulePage
      module="credit-admin"
      description="Waivers and deferrals of approved conditions, and sanctions for credit-policy breaches (PRD §6.3.2)."
      actions={
        isCad ? (
          <Button iconBefore={<FilePlus2 aria-hidden className="size-4" />} onClick={() => setNewOpen(true)}>
            New request
          </Button>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Pending approval" value={String(kpi.pending)} icon={<Hourglass aria-hidden />} tone="info" hint="Routed to the approving tier" />
          <StatCard label="Active waivers & deferrals" value={String(kpi.active)} icon={<Gavel aria-hidden />} hint="Approved and not yet lapsed" />
          <StatCard label={`Expiring ≤ ${REMINDER_DAYS} days`} value={String(kpi.expiring)} icon={<AlarmClock aria-hidden />} tone="warning" hint="Auto-reminder sent before lapse" />
          <StatCard label="Sanctions for breach" value={String(kpi.sanctions)} icon={<ShieldAlert aria-hidden />} tone="danger" hint="Feed the Operational Risk loss-event register" />
        </Grid>

        <Alert tone="info" title="Routing">
          A waiver or deferral is approved at the same tier that approved the original facility (PRD §6.3.2). Requests within Credit Administration&apos;s delegated tolerance can be approved by Credit Administration — {DELEGATED_TOLERANCE.note}. Sanctions for breach route to the
          escalation workflow ({roleNames(SANCTION_ROUTE)}) and feed the{" "}
          <TextLink as={Link} href="/operational-risk/loss-events/">
            loss-event register
          </TextLink>
          . Reminder window: {REMINDER_DAYS} days before expiry (Parameter — set by tenant).
        </Alert>

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
          emptyState={<EmptyState icon={<Gavel aria-hidden />} title="No requests" description="No waivers, deferrals or sanctions match the current filters." />}
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
      {selected ? <RequestDrawer row={selected} onClose={() => setSelectedId(null)} /> : null}
    </ModulePage>
  );
}

function RequestDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const roleId = useSession((s) => s.roleId) ?? undefined;
  const user = useSession((s) => s.user);
  const saveWaiver = useCreditAdminStore((s) => s.saveWaiver);
  const setCp = useCreditAdminStore((s) => s.setCp);
  const log = useAuditLog();
  const approvers = approversOf(row);
  const isSanction = row.kind === "Sanction for breach";
  const canDecide = row.effective === "Pending approval" && (canApproveAtTier(roleId, approvers) || (row.withinTolerance && roleId === "credit-admin-officer"));
  const canClose = roleId === "credit-admin-officer" && row.effective === "Approved" && !isSanction;
  const now = () => demoNowIso();

  const decide = (decision: string, comment: string) => {
    const by = user?.name ?? "Approver";
    const { effective: _e, obligorName: _o, daysLeft: _d, ...base } = row;
    void _e;
    void _o;
    void _d;
    if (decision === "decline") {
      saveWaiver({ ...base, status: "Declined", decidedByName: by, decidedAt: now(), decisionComment: comment });
      log(`Declined ${row.kind.toLowerCase()}`, "Waiver", row.id, "Pending approval", "Declined");
      return;
    }
    if (isSanction) {
      const ref = `LE-2026-${String(100 + (hash(row.id) % 800))}`;
      saveWaiver({ ...base, status: "Routed to Operational Risk", lossEventRef: ref, decidedByName: by, decidedAt: now(), decisionComment: comment });
      setCp(row.cpKey, row.conditionId, { status: "breached", byName: by, at: now(), note: `Sanction ${row.id}` });
      log("Routed sanction for breach to Operational Risk", "Waiver", row.id, "Pending approval", `Loss event ${ref}`);
      return;
    }
    saveWaiver({ ...base, status: "Approved", decidedByName: by, decidedAt: now(), decisionComment: comment });
    setCp(row.cpKey, row.conditionId, {
      status: row.kind === "Waiver" ? "waived" : "deferred",
      byName: by,
      at: now(),
      note: row.kind === "Waiver" ? `Waived under ${row.id}` : `Deferred to ${row.expiryDate ? date(row.expiryDate) : "—"} under ${row.id}`,
    });
    log(`Approved ${row.kind.toLowerCase()}`, "Waiver", row.id, "Pending approval", `Approved${row.withinTolerance && roleId === "credit-admin-officer" ? " (within delegated tolerance)" : ""}`);
    log(`Condition ${row.kind === "Waiver" ? "waived" : "deferred"}`, "Facility", row.facilityId, `${row.conditionId}: pending`, `${row.conditionId}: ${row.kind === "Waiver" ? "waived" : "deferred"}`);
  };

  const close = () => {
    const by = user?.name ?? "Credit Administration";
    const { effective: _e, obligorName: _o, daysLeft: _d, ...base } = row;
    void _e;
    void _o;
    void _d;
    saveWaiver({ ...base, status: "Closed", decisionComment: `${base.decisionComment ?? ""} Regularised — condition met.`.trim() });
    setCp(row.cpKey, row.conditionId, { status: "met", byName: by, at: now(), note: `Regularised (${row.id})` });
    log(`Closed ${row.kind.toLowerCase()} — condition regularised`, "Waiver", row.id, "Approved", "Closed");
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
          {canClose ? <Button onClick={close}>Mark regularised (close)</Button> : null}
        </Stack>
      }
    >
      <Stack gap="large">
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
        {row.effective === "Pending approval" ? (
          canDecide ? (
            <DecisionPanel
              title={isSanction ? "Escalation decision" : "Your decision"}
              actions={["approve", "decline"]}
              actionLabels={isSanction ? { approve: "Route to Operational Risk", decline: "Dismiss" } : { approve: `Approve ${row.kind.toLowerCase()}` }}
              commentRequired={["decline"]}
              notice={row.withinTolerance && roleId === "credit-admin-officer" ? `Within Credit Administration's delegated tolerance (${DELEGATED_TOLERANCE.note}).` : `You are approving at the ${roleNames(approvers)} tier or above.`}
              onDecide={({ decision, comment }) => decide(decision, comment)}
            />
          ) : (
            <Alert tone="warning" title="Awaiting the approving tier">
              This request needs a decision from {row.withinTolerance ? "Credit Administration or " : ""}
              {roleNames(approvers)} (or a higher tier). Switch role from the user menu to act on it.
            </Alert>
          )
        ) : null}
      </Stack>
    </Drawer>
  );
}

function NewRequestModal({ open, onOpenChange, defaultFacility, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; defaultFacility: string; onCreated: (id: string) => void }) {
  const rows = useFacilityRows();
  const user = useSession((s) => s.user);
  const saveWaiver = useCreditAdminStore((s) => s.saveWaiver);
  const log = useAuditLog();
  const [kind, setKind] = useState<WaiverKind>("Deferral");
  const [facilityId, setFacilityId] = useState(defaultFacility);
  const [conditionId, setConditionId] = useState("");
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState(addDaysIso(DEMO_NOW, 14).slice(0, 10));
  const [breach, setBreach] = useState("");
  const [error, setError] = useState<string | null>(null);

  const eligible = useMemo(() => rows.filter((r) => r.cps.length > 0 && (r.facility.status === "Pending disbursement" || r.facility.status === "Active")).sort((a, b) => a.facility.status.localeCompare(b.facility.status) * -1 || a.facility.id.localeCompare(b.facility.id)), [rows]);
  const fac = eligible.find((r) => r.facility.id === facilityId);
  const conditions = fac ? (kind === "Sanction for breach" ? fac.cps : fac.cps.filter((c) => c.status === "pending" || c.status === "breached" || c.status === "deferred")) : [];
  const cp = conditions.find((c) => c.id === conditionId);
  const days = daysBetween(DEMO_NOW, expiry);
  const withinTolerance = kind === "Deferral" && !!cp && DELEGATED_TOLERANCE.categories.includes(cp.category) && days <= DELEGATED_TOLERANCE.maxDeferralDays;

  const submit = () => {
    if (!fac || !cp) return setError("Choose a facility and a condition.");
    if (reason.trim().length < 10) return setError("Give a reason (at least 10 characters).");
    if (kind !== "Sanction for breach" && days <= 0) return setError("The expiry / deferred-to date must be in the future.");
    const id = newId("WVR");
    saveWaiver({
      id,
      kind,
      facilityId: fac.facility.id,
      cpKey: fac.cpKey,
      conditionId: cp.id,
      conditionTitle: cp.title,
      conditionCategory: cp.category,
      reason: reason.trim(),
      requestedById: user?.id ?? "USR-DEMO",
      requestedByName: user?.name ?? "Credit Administration",
      requestedAt: demoNowIso(),
      expiryDate: kind === "Sanction for breach" ? undefined : new Date(`${expiry}T17:00:00+01:00`).toISOString(),
      status: "Pending approval",
      approverRoleIds: kind === "Sanction for breach" ? SANCTION_ROUTE : fac.approverRoleIds,
      withinTolerance,
      breachDetail: kind === "Sanction for breach" ? breach.trim() || undefined : undefined,
    });
    log(`Raised ${kind.toLowerCase()} request`, "Waiver", id, undefined, `${fac.facility.id} · ${cp.id} ${cp.title}`);
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
      description="Raised by Credit Administration against a specific approved condition (PRD §6.3.2)."
      footer={
        <>
          <Button variant="tertiary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Submit for approval</Button>
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
              ? `Routes to ${roleNames(SANCTION_ROUTE)} for the disciplinary / escalation workflow and the Operational Risk loss-event register.`
              : withinTolerance
                ? `Within Credit Administration's delegated tolerance — Credit Administration can approve. (${DELEGATED_TOLERANCE.note})`
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
