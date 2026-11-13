"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpCircle, CheckCircle2, RefreshCw } from "lucide-react";
import {
  ActivityFeed,
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CommentThread,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  Grid,
  Input,
  KanbanBoard,
  Modal,
  SegmentedControl,
  Stack,
  StatCard,
  StatusBadge,
  Steps,
  SubmitButton,
  Text,
  TextLink,
  Textarea,
  type DataTableColumn,
  type KanbanCard,
  type KanbanColumn,
} from "@credigit/web-ui";
import { OutcomePopup, outcomeCopy } from "@/lib/ui/outcome-popup";
import { ModulePage } from "@/components/module-page";
import { useCan, useRole } from "@/lib/auth/session";
import { useLookups } from "@/lib/data/hooks";
import { dateTime, moneyShort, number } from "@/lib/format";
import { useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { useLadder } from "../hooks";
import { daysBetween, levelTones, rolesUpTo, type EscalationLevel } from "../logic";
import { PendingApproval } from "../pending-approval";
import { changeExceptionStatus, commentOnException, requestEscalation, requestResolution, runEscalationSweep, slaLapsed } from "../service";
import { useMonitoring, type MonitoringException } from "../store";

type ExceptionStatus = MonitoringException["status"];
/** Kanban column ids must be valid DOM ids (the board labels each column via aria-labelledby), so statuses are slugged. */
const columnIdOf = (status: ExceptionStatus) => status.toLowerCase().replace(/\s+/g, "-");
const statusOrder: ExceptionStatus[] = ["Raised", "Under review", "Escalated", "Resolved"];
const statusOfColumn = (columnId: string) => statusOrder.find((s) => columnIdOf(s) === columnId);

const columns: KanbanColumn[] = [
  { id: columnIdOf("Raised"), title: "Raised", tone: "info" },
  { id: columnIdOf("Under review"), title: "Under review", tone: "accent" },
  { id: columnIdOf("Escalated"), title: "Escalated", tone: "danger" },
  { id: columnIdOf("Resolved"), title: "Resolved", tone: "success" },
];

const statusTones = { Raised: "info", "Under review": "accent", Escalated: "danger", Resolved: "success" } as const;

type Scope = "all" | "assigned" | "notified";

export function ExceptionsPage() {
  return (
    <Suspense fallback={null}>
      <ExceptionsInner />
    </Suspense>
  );
}

function ExceptionsInner() {
  const exceptions = useMonitoring((s) => s.exceptions);
  const { obligor, user } = useLookups();
  const canEdit = useCan("monitoring", "edit");
  const { actor } = useScope();
  const ladder = useLadder();
  const params = useSearchParams();
  const router = useRouter();
  const instances = useOperationsStore((s) => s.instances);
  const [view, setView] = useState<"board" | "report">("board");
  const [scope, setScope] = useState<Scope>("all");
  const [openIdState, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "resolve" | "escalate"; id: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const now = new Date();
  const openId = openIdState ?? params.get("id");

  /** Exception id → open Operations instance (resolution / escalation sign-off). */
  const pendingOps = useMemo(() => new Map(instances.filter((i) => i.subject.type === "Exception" && ["Pending", "In progress"].includes(i.status)).map((i) => [i.subject.id, i])), [instances]);

  const notifiedToMe = (e: MonitoringException) => rolesUpTo(e.level, e.amount).includes(actor.roleId);
  const inScope = (e: MonitoringException) => (scope === "assigned" ? e.assigneeId === actor.id : scope === "notified" ? notifiedToMe(e) : true);
  const scoped = exceptions.filter(inScope);
  const open = scoped.filter((e) => e.status !== "Resolved");

  const cards: KanbanCard[] = useMemo(
    () =>
      scoped.map((e) => ({
        id: e.id,
        columnId: columnIdOf(e.status),
        title: obligor.get(e.obligorId)?.name ?? e.obligorId,
        textTitle: obligor.get(e.obligorId)?.name ?? e.obligorId,
        meta: `${e.id} · ${e.type}`,
        badges: [
          { label: `Level ${e.level}`, tone: levelTones[e.level] },
          ...(e.source === "AI-flagged" ? [{ label: "AI-flagged", tone: "warning" as const }] : []),
          ...(slaLapsed(e, now) ? [{ label: "SLA lapsed", tone: "danger" as const }] : []),
          ...(pendingOps.has(e.id) ? [{ label: "Awaiting sign-off", tone: "accent" as const }] : []),
        ],
        assignee: e.assigneeId ? { name: user.get(e.assigneeId)?.name ?? "Officer" } : undefined,
        footer: `${e.amount ? `${moneyShort(e.amount)} · ` : ""}open ${Math.max(0, daysBetween(e.raisedAt, now))}d · ${e.comments.length} comment${e.comments.length === 1 ? "" : "s"}`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, obligor, user, pendingOps],
  );

  const move = (id: string, toColumn: string) => {
    const e = exceptions.find((x) => x.id === id);
    const to = statusOfColumn(toColumn);
    if (!e || !to || e.status === to) return;
    if (pendingOps.has(id)) return setNotice({ tone: "info", text: `${id} is awaiting sign-off (${pendingOps.get(id)!.id}) — decide it in Operations first.` });
    if (to === "Resolved") return setDialog({ kind: "resolve", id });
    if (to === "Escalated") return setDialog({ kind: "escalate", id });
    changeExceptionStatus(id, to as "Raised" | "Under review");
  };

  const sweep = async () => {
    setSweeping(true);
    const r = await runEscalationSweep();
    setSweeping(false);
    setNotice({ tone: "success", text: `Escalation sweep: ${r.escalated} escalated / re-notified${r.held ? `, ${r.held} held by an extension hook` : ""}.` });
  };

  const closeDrawer = () => {
    setOpenId(null);
    if (params.get("id")) router.replace("/monitoring/exceptions");
  };

  type Row = MonitoringException & { name: string; age: number; isLapsed: boolean; pending?: string };
  const rows: Row[] = scoped.map((e) => ({ ...e, name: obligor.get(e.obligorId)?.name ?? e.obligorId, age: Math.max(0, daysBetween(e.raisedAt, now)), isLapsed: slaLapsed(e, now), pending: pendingOps.get(e.id)?.id }));
  const reportCols: DataTableColumn<Row>[] = [
    { id: "id", header: "Exception", accessor: "id", sortable: true, cell: (r) => <span className="font-mono">{r.id}</span> },
    { id: "name", header: "Obligor", accessor: "name", sortable: true, cell: (r) => <Stack gap="none"><span className="font-medium text-fg">{r.name}</span><Text variant="caption" tone="subtle">{r.facilityId ?? r.collateralId ?? ""}</Text></Stack> },
    { id: "type", header: "Type", accessor: "type", sortable: true },
    { id: "level", header: "Level", accessor: "level", numeric: true, sortable: true },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (r) => <Stack gap="none"><StatusBadge status={r.status} tones={statusTones} />{r.pending && <Text variant="caption" tone="subtle">Sign-off {r.pending}</Text>}</Stack> },
    { id: "age", header: "Age (days)", accessor: "age", numeric: true, sortable: true },
    { id: "sla", header: "SLA to cure", accessor: "slaDueAt", sortable: true, cell: (r) => (r.status === "Resolved" ? "Cured" : <Stack gap="none"><span>{dateTime(r.slaDueAt)}</span>{r.isLapsed && <Text variant="caption" tone="accent">Lapsed</Text>}</Stack>) },
    { id: "assignee", header: "Assigned", accessor: (r) => (r.assigneeId ? (user.get(r.assigneeId)?.name ?? "") : ""), sortable: true },
    { id: "source", header: "Source", accessor: "source", sortable: true },
  ];

  const selected = exceptions.find((e) => e.id === openId) ?? null;
  const dialogFor = dialog ? exceptions.find((x) => x.id === dialog.id) : undefined;

  return (
    <ModulePage
      module="monitoring"
      description="Every exception enters one tenant-configurable escalation protocol that runs until the exception is cured and evidenced — not merely acknowledged. Resolutions and out-of-cycle escalations are signed off through Operations."
      actions={
        canEdit ? (
          <Button variant="secondary" iconBefore={<RefreshCw aria-hidden className="size-4" />} onClick={sweep} loading={sweeping} disabled={!exceptions.some((e) => slaLapsed(e, now))}>
            Run escalation sweep
          </Button>
        ) : undefined
      }
    >
      <Stack gap="large">
        <OutcomePopup value={notice} map={outcomeCopy.toneText({ success: "Done", danger: "Not done", info: "Note" })} />
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Open exceptions" value={number(open.length)} hint={`${open.filter((e) => e.source === "AI-flagged").length} AI-flagged`} />
          <StatCard label="At Level 3–4" value={number(open.filter((e) => e.level >= 3).length)} hint={ladder[2]!.notified} tone="danger" />
          <StatCard label="SLA lapsed" value={number(scoped.filter((e) => slaLapsed(e, now)).length)} hint="Due for escalation" tone="warning" />
          <StatCard label="Awaiting sign-off" value={number(open.filter((e) => pendingOps.has(e.id)).length)} hint="Operations workflow" tone="info" />
        </Grid>

        <Stack gap="medium">
          <Stack direction="horizontal" gap="medium" wrap>
            <SegmentedControl
              label="View"
              size="small"
              value={view}
              onChange={setView}
              options={[
                { value: "board", label: "Exception queue" },
                { value: "report", label: "Exception-ageing report" },
              ]}
            />
            <SegmentedControl
              label="Scope"
              size="small"
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: "All exceptions" },
                { value: "assigned", label: `Assigned to me (${exceptions.filter((e) => e.assigneeId === actor.id && e.status !== "Resolved").length})` },
                { value: "notified", label: `Notified to my role (${exceptions.filter((e) => e.status !== "Resolved" && notifiedToMe(e)).length})` },
              ]}
            />
          </Stack>
          {view === "board" ? (
            <KanbanBoard className="[&_[role=listitem]]:w-auto [&_[role=listitem]]:min-w-64 [&_[role=listitem]]:flex-1" label="Exception workflow" columns={columns} cards={cards} onMove={canEdit ? (id, to) => move(id, to) : undefined} onCardClick={(c) => setOpenId(c.id)} emptyColumnMessage="Nothing here" />
          ) : (
            <DataTable
              label="Exception-ageing report"
              data={rows}
              columns={reportCols}
              getRowId={(r) => r.id}
              searchable
              density="compact"
              defaultSort={{ id: "age", direction: "desc" }}
              filters={[
                { id: "status", label: "Status", columnId: "status" },
                { id: "type", label: "Type", columnId: "type" },
                { id: "level", label: "Level", options: [1, 2, 3, 4].map((l) => ({ value: String(l), label: `Level ${l}` })), filterFn: (r, v) => String(r.level) === v },
              ]}
              onRowClick={(r) => setOpenId(r.id)}
              exportFilename="exception-ageing-report.csv"
            />
          )}
        </Stack>

        <Card variant="filled">
          <CardHeader>
            <div>
              <CardTitle>Escalation protocol</CardTitle>
              <CardDescription>
                Alerts fire to the in-app dashboard and by email to the named officers tagged to the obligor at each level — never to a generic list only. Roles and SLAs are business rules (
                <TextLink as={Link} href="/monitoring/escalation">
                  view protocol
                </TextLink>
                ). Exception types listed in the evidence rule close only with curing evidence attached, time-stamped and signed off.
              </CardDescription>
            </div>
          </CardHeader>
          <Grid columns={{ base: 1, md: 2, xl: 4 }} gap="medium" className="mt-4">
            {ladder.map((l) => (
              <Card key={l.level} padding="small">
                <Stack gap="xsmall">
                  <Stack direction="horizontal" gap="small" align="center">
                    <StatusBadge status={`Level ${l.level}`} tones={{ [`Level ${l.level}`]: levelTones[l.level] }} />
                    <Text variant="caption" tone="subtle">
                      {l.trigger}
                    </Text>
                  </Stack>
                  <Text variant="small" className="text-fg">
                    {l.notified}
                  </Text>
                  <Text variant="caption" tone="subtle">
                    SLA: {l.sla}
                  </Text>
                </Stack>
              </Card>
            ))}
          </Grid>
        </Card>
      </Stack>

      {selected && (
        <ExceptionDrawer
          e={selected}
          name={obligor.get(selected.obligorId)?.name ?? selected.obligorId}
          assignee={selected.assigneeId ? user.get(selected.assigneeId)?.name : undefined}
          canEdit={canEdit}
          lapsed={slaLapsed(selected, now)}
          pending={pendingOps.has(selected.id)}
          onClose={closeDrawer}
          onEscalate={() => setDialog({ kind: "escalate", id: selected.id })}
          onResolve={() => setDialog({ kind: "resolve", id: selected.id })}
          onReview={() => changeExceptionStatus(selected.id, "Under review")}
        />
      )}
      {dialog?.kind === "resolve" && dialogFor && <ResolveModal e={dialogFor} onClose={() => setDialog(null)} onDone={(text) => setNotice({ tone: "success", text })} />}
      {dialog?.kind === "escalate" && dialogFor && <EscalateModal e={dialogFor} onClose={() => setDialog(null)} onDone={(text) => setNotice({ tone: "success", text })} />}
    </ModulePage>
  );
}

function ExceptionDrawer({
  e,
  name,
  assignee,
  canEdit,
  lapsed,
  pending,
  onClose,
  onEscalate,
  onResolve,
  onReview,
}: {
  e: MonitoringException;
  name: string;
  assignee?: string;
  canEdit: boolean;
  lapsed: boolean;
  pending: boolean;
  onClose: () => void;
  onEscalate: () => void;
  onResolve: () => void;
  onReview: () => void;
}) {
  const { actor } = useScope();
  const role = useRole();
  const ladder = useLadder();
  const resolved = e.status === "Resolved";
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${e.id} · ${e.type}`}
      description={name}
      size="large"
      footer={
        canEdit && !resolved && !pending ? (
          <>
            {e.status === "Raised" && (
              <Button variant="tertiary" onClick={onReview}>
                Start review
              </Button>
            )}
            <Button variant="secondary" iconBefore={<ArrowUpCircle aria-hidden className="size-4" />} onClick={onEscalate}>
              {e.level >= 4 ? "Request Level 4 re-notification" : `Request escalation to Level ${e.level + 1}`}
            </Button>
            <SubmitButton iconBefore={<CheckCircle2 aria-hidden className="size-4" />} onClick={onResolve}>
              Submit curing evidence
            </SubmitButton>
          </>
        ) : canEdit && resolved ? (
          <Button variant="tertiary" onClick={() => changeExceptionStatus(e.id, "Raised")}>
            Re-open
          </Button>
        ) : undefined
      }
    >
      <Stack gap="large">
        <PendingApproval subjectType="Exception" subjectId={e.id} />
        {lapsed && (
          <Alert tone="danger" title={`Level ${e.level} SLA lapsed`}>
            The cure window ended {dateTime(e.slaDueAt)}. The escalation sweep will move it to the next level.
          </Alert>
        )}
        <Text>{e.detail}</Text>
        <DescriptionList
          columns={2}
          items={[
            { label: "Status", status: e.status, statusTones: statusTones },
            { label: "Escalation level", value: `Level ${e.level}` },
            { label: "Raised", value: dateTime(e.raisedAt) },
            { label: "SLA to cure", value: resolved ? "Cured" : dateTime(e.slaDueAt) },
            { label: "Source", value: e.source === "AI-flagged" ? "AI-flagged (human sign-off recorded)" : e.source === "Rule" ? "Rules engine" : "Raised manually" },
            { label: "Assigned officer", value: assignee },
            { label: "Exposure", value: e.amount ? moneyShort(e.amount) : undefined, mono: true },
            {
              label: "Linked record",
              value: e.collateralId ? (
                <TextLink as={Link} href={`/collateral/item?id=${e.collateralId}`}>
                  {e.collateralId}
                </TextLink>
              ) : (
                e.facilityId
              ),
            },
            { label: "Evidence", value: e.evidence ? `${e.evidence.name} — ${e.evidence.by}, ${dateTime(e.evidence.at)}` : undefined, span: 2 },
          ]}
        />
        <Stack gap="small">
          <Text variant="eyebrow">Escalation path</Text>
          <Steps
            orientation="vertical"
            items={ladder.map((l) => ({
              title: `Level ${l.level}`,
              description: l.notified,
              status: resolved || l.level < e.level ? ("complete" as const) : l.level === e.level ? ("current" as const) : ("upcoming" as const),
              meta: e.history.find((h) => h.level === l.level)?.at ? dateTime(e.history.find((h) => h.level === l.level)!.at) : undefined,
            }))}
          />
        </Stack>
        <CommentThread
          title="Comments"
          comments={e.comments.map((c) => ({ id: c.id, author: { name: c.authorName, role: c.authorRole }, body: c.body, time: dateTime(c.at) }))}
          currentUser={{ name: actor.name, role: role?.name }}
          onSubmit={(body) => commentOnException(e.id, body, role?.name)}
          placeholder="Add an update — use @name to mention an officer"
        />
        <ActivityFeed
          label="Escalation history"
          items={[...e.history].reverse().map((h) => ({ id: h.id, actor: h.by, action: h.action, timestamp: h.at, tone: h.status === "Escalated" ? "danger" : h.status === "Resolved" ? "success" : "info" }))}
        />
      </Stack>
    </Drawer>
  );
}

function ResolveModal({ e, onClose, onDone }: { e: MonitoringException; onClose: () => void; onDone: (text: string) => void }) {
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const required = useRule<string[]>("monitoring.exceptions.evidenceRequiredTypes").includes(e.type);
  const minEvidence = useRule<number>("monitoring.exceptions.minEvidenceLength");
  const valid = !required || evidence.trim().length >= minEvidence;
  const save = async () => {
    setBusy(true);
    const r = await requestResolution(e.id, evidence, note || undefined);
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    onDone(r.applied ? `${e.id} closed as cured.` : `Curing evidence for ${e.id} sent for sign-off (${r.operationId}).`);
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Submit curing evidence"
      description={`${e.id} · ${e.type}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton onClick={save} loading={busy} disabled={!valid}>
            Submit for sign-off
          </SubmitButton>
        </>
      }
    >
      <Stack gap="medium">
        {error && <Alert tone="danger">{error}</Alert>}
        {required && (
          <Alert tone="warning" title="Regulatory-relevant exception">
            A manual “mark as resolved” without evidence is not permitted for {e.type.toLowerCase()} exceptions.
          </Alert>
        )}
        <Field label="Evidence" htmlFor="evidence" description="Payment received, document submitted, covenant re-tested and passed, or reconciliation matched." required={required} optional={!required}>
          <Input id="evidence" value={evidence} onChange={(ev) => setEvidence(ev.target.value)} placeholder="e.g. CBA credit ref FT26314XK2 — arrears cleared" />
        </Field>
        <Field label="Note" htmlFor="evidence-note" optional>
          <Textarea id="evidence-note" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </Field>
        <Text variant="caption" tone="subtle">
          The exception stays open until the resolution is signed off in Operations. The evidence is time-stamped on sign-off and kept in the escalation history.
        </Text>
      </Stack>
    </Modal>
  );
}

function EscalateModal({ e, onClose, onDone }: { e: MonitoringException; onClose: () => void; onDone: (text: string) => void }) {
  const ladder = useLadder();
  const minReason = useRule<number>("monitoring.exceptions.minReasonLength");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const to = Math.min(4, e.level + 1) as EscalationLevel;
  const save = async () => {
    setBusy(true);
    const r = await requestEscalation(e.id, reason);
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    onDone(`Escalation of ${e.id} sent for sign-off (${r.operationId}).`);
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={e.level >= 4 ? "Request Level 4 re-notification" : `Request escalation to Level ${to}`}
      description={`${e.id} · ${e.type}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton onClick={save} loading={busy} disabled={reason.trim().length < minReason}>
            Submit for sign-off
          </SubmitButton>
        </>
      }
    >
      <Stack gap="medium">
        {error && <Alert tone="danger">{error}</Alert>}
        <Alert tone="info" title="Out-of-cycle escalation">
          SLA lapses escalate automatically. Escalating early needs sign-off; once approved, Level {to} is notified: {ladder[to - 1]!.notified}.
        </Alert>
        <Field label="Reason" htmlFor="esc-reason" required description={`At least ${minReason} characters.`}>
          <Textarea id="esc-reason" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Obligor has stopped responding; further arrears expected this week" />
        </Field>
      </Stack>
    </Modal>
  );
}
