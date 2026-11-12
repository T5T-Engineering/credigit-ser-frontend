"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  Grid,
  Menu,
  Modal,
  Stack,
  StatCard,
  StatusBadge,
  Tabs,
  Text,
  TextLink,
  Textarea,
  type DataTableColumn,
  type Tone,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { useFacilities, useLookups, useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, money, moneyShort, number } from "@/lib/format";
import { buildCollateralAlerts } from "@/modules/collateral/logic";
import { useCollateralView } from "@/modules/collateral/store";
import { usePendingFor } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { buildApgs, buildTods, type Apg, type Tod } from "../data";
import { useRuleValues } from "../hooks";
import { daysBetween } from "../logic";
import { PendingApproval } from "../pending-approval";
import { requestApgRelease, setApgStatus, setTodStatus } from "../service";
import { RaiseExceptionModal, type RaiseExceptionTarget } from "../raise-exception";
import { openExceptionFor, useMonitoring } from "../store";

const apgTones: Record<string, Tone> = {
  "Awaiting advance": "info",
  Crystallised: "success",
  "Expiring soon": "warning",
  Expired: "neutral",
  Called: "danger",
  Released: "neutral",
};
const todTones: Record<string, Tone> = {
  "Within regularisation window": "info",
  "Regularisation overdue": "warning",
  "Classified non-performing": "danger",
  Regularised: "success",
  "Converted to facility": "success",
};

type ActionTarget = { kind: "apg"; row: Apg & { name: string }; status: string; label: string } | { kind: "tod"; row: Tod & { name: string }; status: string; label: string };

export function GuaranteesPage() {
  const facilities = useFacilities();
  const obligors = useObligors();
  const { obligor } = useLookups();
  const canEdit = useCan("monitoring", "edit");
  const apgActions = useMonitoring((s) => s.apgActions);
  const todActions = useMonitoring((s) => s.todActions);
  const exceptions = useMonitoring((s) => s.exceptions);
  const collateralView = useCollateralView();
  const [raiseTarget, setRaiseTarget] = useState<RaiseExceptionTarget | null>(null);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ruleValues = useRuleValues();
  const apgWarnDays = useRule<number>("monitoring.apg.expiryWarningDays");
  const todWindow = useRule<number>("monitoring.tod.regularisationDays");
  const todNpl = useRule<number>("monitoring.tod.nonPerformingDays");

  const apgs = useMemo(
    () => buildApgs(facilities).map((a) => ({ ...a, name: obligor.get(a.obligorId)?.name ?? a.obligorId, ...(apgActions[a.id] ? { status: apgActions[a.id]!.status as Apg["status"] } : {}) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facilities, obligor, apgActions, ruleValues],
  );
  const tods = useMemo(
    () => buildTods(facilities, obligors).map((t) => ({ ...t, name: obligor.get(t.obligorId)?.name ?? t.obligorId, ...(todActions[t.id] ? { status: todActions[t.id]!.status as Tod["status"] } : {}) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facilities, obligors, obligor, todActions, ruleValues],
  );
  const alerts = useMemo(() => {
    const mtm = new Map(collateralView.map((c) => [c.id, c.mtm]));
    return buildCollateralAlerts(collateralView, facilities, (c) => mtm.get(c.id)).map((a) => ({ ...a, name: obligor.get(a.obligorId)?.name ?? "", type: collateralView.find((c) => c.id === a.collateralId)?.type ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collateralView, facilities, obligor, ruleValues]);

  type ApgRow = (typeof apgs)[number];
  type TodRow = (typeof tods)[number];
  type AlertRow = (typeof alerts)[number];

  const apgCols: DataTableColumn<ApgRow>[] = [
    { id: "id", header: "APG", accessor: "id", sortable: true, cell: (a) => <span className="whitespace-nowrap font-mono">{a.id}</span> },
    { id: "name", header: "Applicant", accessor: "name", sortable: true, cell: (a) => <Stack gap="none"><span className="font-medium text-fg">{a.name}</span><Text variant="caption" tone="subtle">{a.facilityId}</Text></Stack> },
    { id: "beneficiary", header: "Beneficiary / contract", accessor: "beneficiary", cell: (a) => <Stack gap="none"><span>{a.beneficiary}</span><Text variant="caption" tone="subtle">{a.contractRef}</Text></Stack> },
    { id: "amount", header: "Amount", accessor: "amount", numeric: true, sortable: true, cell: (a) => moneyShort(a.amount) },
    { id: "issued", header: "Issued", accessor: "issuedAt", sortable: true, cell: (a) => date(a.issuedAt) },
    { id: "advance", header: "Advance received", accessor: (a) => a.advanceReceivedAt ?? "", cell: (a) => (a.advanceReceivedAt ? date(a.advanceReceivedAt) : <Text variant="small" tone="subtle">Awaiting</Text>) },
    { id: "expiry", header: "Expiry", accessor: "expiryAt", sortable: true, cell: (a) => <Stack gap="none"><span>{date(a.expiryAt)}</span><Text variant="caption" tone="subtle">{daysBetween(DEMO_NOW, a.expiryAt) >= 0 ? `${daysBetween(DEMO_NOW, a.expiryAt)} days left` : "Expired"}</Text></Stack> },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (a) => <Stack gap="none"><StatusBadge status={a.status} tones={apgTones} /><PendingApproval subjectType="APG" subjectId={a.id} compact /></Stack> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (a) =>
        canEdit ? (
          <Menu
            align="end"
            triggerLabel={`Actions for ${a.id}`}
            trigger={<MoreHorizontal aria-hidden className="size-4" />}
            items={[
              { label: "Confirm advance received (crystallise)", disabled: a.status !== "Awaiting advance", onSelect: () => setAction({ kind: "apg", row: a, status: "Crystallised", label: "Confirm advance payment received" }) },
              { label: "Record call / claim", onSelect: () => setAction({ kind: "apg", row: a, status: "Called", label: "Record call on guarantee" }) },
              { label: "Request release (approval)", disabled: a.status === "Released", onSelect: () => setAction({ kind: "apg", row: a, status: "Released", label: "Request guarantee release" }) },
              {
                label: "Raise exception",
                onSelect: () => setRaiseTarget({ obligorId: a.obligorId, obligorName: a.name, facilityId: a.facilityId, amount: a.amount, type: "APG expiry", title: `APG ${a.id} — ${a.status}`, detail: `${a.name}: APG ${a.id} in favour of ${a.beneficiary} (${money(a.amount)}) expires ${date(a.expiryAt)}.` }),
              },
            ]}
          />
        ) : null,
    },
  ];

  const todCols: DataTableColumn<TodRow>[] = [
    { id: "id", header: "TOD", accessor: "id", sortable: true, cell: (t) => <span className="whitespace-nowrap font-mono">{t.id}</span> },
    { id: "name", header: "Obligor", accessor: "name", sortable: true, cell: (t) => <Stack gap="none"><span className="font-medium text-fg">{t.name}</span><Text variant="caption" tone="subtle">{t.facilityId}</Text></Stack> },
    { id: "type", header: "Type", accessor: "type", sortable: true },
    { id: "amount", header: "Amount", accessor: "amount", numeric: true, sortable: true, cell: (t) => moneyShort(t.amount) },
    { id: "granted", header: "Granted", accessor: "grantedAt", sortable: true, cell: (t) => <Stack gap="none"><span>{date(t.grantedAt)}</span><Text variant="caption" tone="subtle">by {t.grantedBy}</Text></Stack> },
    { id: "age", header: "Days outstanding", accessor: (t) => daysBetween(t.grantedAt), numeric: true, sortable: true },
    { id: "deadline", header: "Regularise by", accessor: "regulariseBy", sortable: true, cell: (t) => date(t.regulariseBy) },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (t) => <StatusBadge status={t.status} tones={todTones} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (t) =>
        canEdit && t.status !== "Regularised" && t.status !== "Converted to facility" ? (
          <Menu
            align="end"
            triggerLabel={`Actions for ${t.id}`}
            trigger={<MoreHorizontal aria-hidden className="size-4" />}
            items={[
              { label: "Mark regularised", onSelect: () => setAction({ kind: "tod", row: t, status: "Regularised", label: "Mark TOD regularised" }) },
              { label: "Converted to approved facility", onSelect: () => setAction({ kind: "tod", row: t, status: "Converted to facility", label: "Record conversion to an approved facility" }) },
              {
                label: openExceptionFor(exceptions, { facilityId: t.facilityId, type: "Temporary overdraft not regularised" }) ? "Exception already open" : "Raise exception",
                disabled: !!openExceptionFor(exceptions, { facilityId: t.facilityId, type: "Temporary overdraft not regularised" }),
                onSelect: () =>
                  setRaiseTarget({
                    obligorId: t.obligorId,
                    obligorName: t.name,
                    facilityId: t.facilityId,
                    amount: t.amount,
                    type: "Temporary overdraft not regularised",
                    title: `${t.type} not regularised`,
                    detail: `${t.name}: ${t.id} (${money(t.amount)}) granted ${date(t.grantedAt)} — regularisation deadline ${date(t.regulariseBy)} passed.`,
                  }),
              },
            ]}
          />
        ) : null,
    },
  ];

  const alertCols: DataTableColumn<AlertRow>[] = [
    { id: "collateral", header: "Collateral", accessor: "collateralId", sortable: true, cell: (a) => <TextLink as={Link} href={`/collateral/item?id=${a.collateralId}`}>{a.collateralId}</TextLink> },
    { id: "name", header: "Obligor", accessor: "name", sortable: true, cell: (a) => <Stack gap="none"><span className="font-medium text-fg">{a.name}</span><Text variant="caption" tone="subtle">{a.type}</Text></Stack> },
    { id: "kind", header: "Alert", accessor: "kind", sortable: true, cell: (a) => <StatusBadge status={a.kind} tones={{ [a.kind]: a.tone }} /> },
    { id: "detail", header: "Detail", accessor: "detail" },
    { id: "due", header: "Date", accessor: (a) => a.dueAt ?? "", sortable: true, cell: (a) => (a.dueAt ? date(a.dueAt) : "—") },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (a) =>
        canEdit ? (
          openExceptionFor(exceptions, { collateralId: a.collateralId }) ? (
            <Text variant="caption" tone="subtle">Exception open</Text>
          ) : (
            <Button size="small" variant="tertiary" onClick={() => setRaiseTarget(alertToTarget(a))}>
              Raise exception
            </Button>
          )
        ) : null,
    },
  ];

  const apgExposure = apgs.filter((a) => a.status !== "Released" && a.status !== "Expired").reduce((s, a) => s + a.amount, 0);
  const todOverdue = tods.filter((t) => t.status === "Regularisation overdue" || t.status.startsWith("Classified"));

  return (
    <ModulePage module="monitoring" description="Advance payment guarantees, temporary overdrafts and collateral monitoring.">
      <Stack gap="large">
        {notice && (
          <Alert
            tone="success"
            action={
              <Button size="small" variant="text" onClick={() => setNotice(null)}>
                Dismiss
              </Button>
            }
          >
            {notice}
          </Alert>
        )}
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Live APG exposure" value={moneyShort(apgExposure)} hint={`${apgs.length} guarantees tracked`} />
          <StatCard label={`APGs expiring ≤ ${apgWarnDays} days`} value={number(apgs.filter((a) => a.status === "Expiring soon").length)} tone="warning" />
          <StatCard label="TODs past regularisation" value={number(todOverdue.length)} hint={`${tods.filter((t) => t.status.startsWith("Classified")).length} classified non-performing`} tone="danger" />
          <StatCard label="Collateral alerts" value={number(alerts.length)} hint={`${alerts.filter((a) => a.tone === "danger").length} critical`} tone="info" />
        </Grid>
        <Tabs
          label="Guarantees, overdrafts and collateral"
          variant="underline"
          items={[
            {
              id: "apg",
              label: "Advance payment guarantees",
              content: (
                <Stack gap="medium">
                  <Text variant="small" tone="muted">
                    Tracks issuance, crystallisation (activated when the advance payment is received per the offer letter’s post-conditions) and expiry, per the APG Policy.
                  </Text>
                  <DataTable label="Advance payment guarantees" data={apgs} columns={apgCols} getRowId={(a) => a.id} searchable density="compact" defaultSort={{ id: "expiry", direction: "asc" }} filters={[{ id: "status", label: "Status", columnId: "status" }]} exportFilename="apg-register.csv" emptyState={<EmptyState title="No guarantees" />} />
                </Stack>
              ),
            },
            {
              id: "tod",
              label: "Temporary overdrafts",
              badge: todOverdue.length ? String(todOverdue.length) : undefined,
              content: (
                <Stack gap="medium">
                  <Alert tone="warning" title="CBN 12.10">
                    Excess-over-limit, matured-loan-without-renewal and undocumented facilities not regularised within {todNpl} days are classified and provisioned as non-performing. Regularisation window for
                    TODs: {todWindow} days (business rule — tenant parameter).
                  </Alert>
                  <DataTable label="Temporary overdrafts" data={tods} columns={todCols} getRowId={(t) => t.id} searchable density="compact" defaultSort={{ id: "age", direction: "desc" }} filters={[{ id: "type", label: "Type", columnId: "type" }, { id: "status", label: "Status", columnId: "status" }]} exportFilename="tod-register.csv" />
                </Stack>
              ),
            },
            {
              id: "collateral",
              label: "Collateral monitoring",
              badge: alerts.length ? String(alerts.length) : undefined,
              content: (
                <Stack gap="medium">
                  <Text variant="small" tone="muted">
                    Perfection status, revaluation due-dates and insurance currency for every collateral securing a live facility. Share-backed collateral is tracked on its SEC/CSCS mark-to-market
                    value and lien status, not a periodic manual revaluation. Fixed-asset revaluation rules per CBN 3.11 apply to the bank’s own premises.
                  </Text>
                  <DataTable label="Collateral monitoring alerts" data={alerts} columns={alertCols} getRowId={(a) => a.id} searchable density="compact" filters={[{ id: "kind", label: "Alert", columnId: "kind" }]} exportFilename="collateral-alerts.csv" emptyState={<EmptyState title="No collateral alerts" />} />
                </Stack>
              ),
            },
          ]}
        />
      </Stack>
      <RaiseExceptionModal target={raiseTarget} onClose={() => setRaiseTarget(null)} />
      {action && <StatusActionModal target={action} onClose={() => setAction(null)} onDone={setNotice} />}
    </ModulePage>
  );

  function alertToTarget(a: AlertRow): RaiseExceptionTarget {
    return {
      obligorId: a.obligorId,
      obligorName: a.name,
      collateralId: a.collateralId,
      facilityId: collateralView.find((c) => c.id === a.collateralId)?.facilityIds[0],
      type: a.kind === "Margin shortfall" ? "Share-collateral margin shortfall" : "Collateral perfection / insurance",
      title: `${a.kind} — ${a.collateralId}`,
      detail: `${a.name}: ${a.type} ${a.collateralId} — ${a.detail}`,
    };
  }
}

function StatusActionModal({ target, onClose, onDone }: { target: ActionTarget; onClose: () => void; onDone: (text: string) => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const minNote = useRule<number>(target.status === "Released" ? "monitoring.exceptions.minReasonLength" : "monitoring.exceptions.minEvidenceLength");
  const pending = usePendingFor(target.kind === "apg" ? "APG" : "Temporary overdraft", target.row.id);
  const save = async () => {
    if (target.kind === "apg" && target.status === "Released") {
      const r = await requestApgRelease(target.row, note);
      if (!r.ok) return setError(r.reason);
      onDone(`Release of ${target.row.id} sent for approval (${r.operationId}).`);
    } else if (target.kind === "apg") setApgStatus(target.row, target.status as "Crystallised" | "Called", note);
    else setTodStatus(target.row, target.status as "Regularised" | "Converted to facility", note);
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={target.label}
      description={`${target.row.name} · ${target.row.id}`}
      size="small"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={note.trim().length < minNote || !!pending}>
            {target.status === "Released" ? "Submit for approval" : "Confirm"}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {pending && <PendingApproval subjectType="APG" subjectId={target.row.id} />}
      <Field label="Evidence / note" htmlFor="status-note" description="e.g. CBA credit reference, beneficiary letter, approval reference." required>
        <Textarea id="status-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

