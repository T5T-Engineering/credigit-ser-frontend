"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
  Text,
  TextLink,
  Textarea,
  type DataTableColumn,
  type KanbanCard,
  type KanbanColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan, useRole } from "@/lib/auth/session";
import { useLookups } from "@/lib/data/hooks";
import { dateTime, moneyShort, number } from "@/lib/format";
import { useActor, useAuditLog } from "../audit";
import { addBusinessDays, daysBetween, DEMO_SLA_BUSINESS_DAYS, escalationLadder, levelTones, regulatoryRelevant, type EscalationLevel } from "../logic";
import { useMonitoring, type ExceptionStatus, type MonitoringException } from "../store";

const columns: KanbanColumn[] = [
  { id: "Raised", title: "Raised", tone: "info" },
  { id: "Under review", title: "Under review", tone: "accent" },
  { id: "Escalated", title: "Escalated", tone: "danger" },
  { id: "Resolved", title: "Resolved", tone: "success" },
];

const statusTones = { Raised: "info", "Under review": "accent", Escalated: "danger", Resolved: "success" } as const;

export function ExceptionsPage() {
  const exceptions = useMonitoring((s) => s.exceptions);
  const patch = useMonitoring((s) => s.patchException);
  const { obligor, user } = useLookups();
  const canEdit = useCan("monitoring", "edit");
  const role = useRole();
  const audit = useAuditLog();
  const actor = useActor();
  const [view, setView] = useState<"board" | "report">("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const now = new Date();

  const lapsed = (e: MonitoringException) => e.status !== "Resolved" && new Date(e.slaDueAt) < now;
  const open = exceptions.filter((e) => e.status !== "Resolved");
  const mine = role ? open.filter((e) => escalationLadder.filter((l) => l.level <= e.level).some((l) => l.roles.includes(role.id))) : [];

  const cards: KanbanCard[] = useMemo(
    () =>
      exceptions.map((e) => ({
        id: e.id,
        columnId: e.status,
        title: obligor.get(e.obligorId)?.name ?? e.obligorId,
        textTitle: obligor.get(e.obligorId)?.name ?? e.obligorId,
        meta: `${e.id} · ${e.type}`,
        badges: [
          { label: `Level ${e.level}`, tone: levelTones[e.level] },
          ...(e.source === "AI-flagged" ? [{ label: "AI-flagged", tone: "warning" as const }] : []),
          ...(lapsed(e) ? [{ label: "SLA lapsed", tone: "danger" as const }] : []),
        ],
        assignee: e.assigneeId ? { name: user.get(e.assigneeId)?.name ?? "Officer" } : undefined,
        footer: `${e.amount ? `${moneyShort(e.amount)} · ` : ""}open ${Math.max(0, daysBetween(e.raisedAt, now))}d · ${e.comments.length} comment${e.comments.length === 1 ? "" : "s"}`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exceptions, obligor, user],
  );

  const escalate = (e: MonitoringException, reason = "Escalated manually") => {
    if (e.level >= 4) {
      patch(e.id, { slaDueAt: addBusinessDays(new Date(), DEMO_SLA_BUSINESS_DAYS).toISOString(), status: "Escalated" }, { by: actor.name, action: "Level 4 — re-timestamped and re-notified (remains open until cured)", level: 4, status: "Escalated" });
      audit({ action: "Re-notified exception at Level 4", entityType: "Exception", entityId: e.id });
      return;
    }
    const level = (e.level + 1) as EscalationLevel;
    patch(e.id, { level, status: "Escalated", slaDueAt: addBusinessDays(new Date(), DEMO_SLA_BUSINESS_DAYS).toISOString() }, { by: actor.name, action: `${reason} — Level ${level} notified: ${escalationLadder[level - 1]!.notified}`, level, status: "Escalated" });
    audit({ action: "Escalated exception", entityType: "Exception", entityId: e.id, before: `Level ${e.level}`, after: `Level ${level}` });
  };

  const move = (id: string, to: string) => {
    const e = exceptions.find((x) => x.id === id);
    if (!e || e.status === to) return;
    if (to === "Resolved") return setResolveId(id);
    if (to === "Escalated") return escalate(e);
    patch(id, { status: to as ExceptionStatus }, { by: actor.name, action: e.status === "Resolved" ? "Re-opened" : `Moved to ${to}`, status: to as ExceptionStatus });
    audit({ action: "Changed exception status", entityType: "Exception", entityId: id, before: e.status, after: to });
  };

  const sweep = () => {
    const due = exceptions.filter(lapsed);
    due.forEach((e) => escalate(e, `Level ${e.level} SLA lapsed uncured`));
    audit({ action: "Ran escalation sweep", entityType: "Exception", entityId: "-", after: `${due.length} escalated / re-notified` });
  };

  type Row = MonitoringException & { name: string; age: number; isLapsed: boolean };
  const rows: Row[] = exceptions.map((e) => ({ ...e, name: obligor.get(e.obligorId)?.name ?? e.obligorId, age: Math.max(0, daysBetween(e.raisedAt, now)), isLapsed: lapsed(e) }));
  const reportCols: DataTableColumn<Row>[] = [
    { id: "id", header: "Exception", accessor: "id", sortable: true, cell: (r) => <span className="font-mono">{r.id}</span> },
    { id: "name", header: "Obligor", accessor: "name", sortable: true, cell: (r) => <Stack gap="none"><span className="font-medium text-fg">{r.name}</span><Text variant="caption" tone="subtle">{r.facilityId ?? r.collateralId ?? ""}</Text></Stack> },
    { id: "type", header: "Type", accessor: "type", sortable: true },
    { id: "level", header: "Level", accessor: "level", numeric: true, sortable: true },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (r) => <StatusBadge status={r.status} tones={statusTones} /> },
    { id: "age", header: "Age (days)", accessor: "age", numeric: true, sortable: true },
    { id: "sla", header: "SLA to cure", accessor: "slaDueAt", sortable: true, cell: (r) => (r.status === "Resolved" ? "Cured" : <Stack gap="none"><span>{dateTime(r.slaDueAt)}</span>{r.isLapsed && <Text variant="caption" tone="accent">Lapsed</Text>}</Stack>) },
    { id: "source", header: "Source", accessor: "source", sortable: true },
  ];

  const selected = exceptions.find((e) => e.id === openId) ?? null;

  return (
    <ModulePage
      module="monitoring"
      description="Every exception enters one tenant-configurable escalation protocol that runs until the exception is cured and evidenced — not merely acknowledged (PRD §6.4.4)."
      actions={
        canEdit ? (
          <Button variant="secondary" iconBefore={<RefreshCw aria-hidden className="size-4" />} onClick={sweep} disabled={!exceptions.some(lapsed)}>
            Run escalation sweep
          </Button>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Open exceptions" value={number(open.length)} hint={`${open.filter((e) => e.source === "AI-flagged").length} AI-flagged`} />
          <StatCard label="At Level 3–4" value={number(open.filter((e) => e.level >= 3).length)} hint="CCO / Head of Risk / CRO notified" tone="danger" />
          <StatCard label="SLA lapsed" value={number(exceptions.filter(lapsed).length)} hint="Due for escalation" tone="warning" />
          <StatCard label="Notified to your role" value={number(mine.length)} hint={role?.name} tone="info" />
        </Grid>

        <Stack gap="medium">
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
                Alerts fire to the in-app dashboard and by email to the named officers tagged to the obligor at each level — never to a generic list only. SLAs are tenant parameters. Past-due,
                covenant-breach and limit-breach exceptions close only with curing evidence attached and time-stamped.
              </CardDescription>
            </div>
          </CardHeader>
          <Grid columns={{ base: 1, md: 2, xl: 4 }} gap="medium" className="mt-4">
            {escalationLadder.map((l) => (
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
          lapsed={lapsed(selected)}
          onClose={() => setOpenId(null)}
          onEscalate={() => escalate(selected)}
          onResolve={() => setResolveId(selected.id)}
          onReview={() => move(selected.id, "Under review")}
        />
      )}
      {resolveId && <ResolveModal e={exceptions.find((x) => x.id === resolveId)!} onClose={() => setResolveId(null)} />}
    </ModulePage>
  );
}

function ExceptionDrawer({
  e,
  name,
  assignee,
  canEdit,
  lapsed,
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
  onClose: () => void;
  onEscalate: () => void;
  onResolve: () => void;
  onReview: () => void;
}) {
  const comment = useMonitoring((s) => s.comment);
  const audit = useAuditLog();
  const actor = useActor();
  const role = useRole();
  const resolved = e.status === "Resolved";
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${e.id} · ${e.type}`}
      description={name}
      size="large"
      footer={
        canEdit && !resolved ? (
          <>
            {e.status === "Raised" && (
              <Button variant="tertiary" onClick={onReview}>
                Start review
              </Button>
            )}
            <Button variant="secondary" iconBefore={<ArrowUpCircle aria-hidden className="size-4" />} onClick={onEscalate}>
              {e.level >= 4 ? "Re-notify Level 4" : `Escalate to Level ${e.level + 1}`}
            </Button>
            <Button iconBefore={<CheckCircle2 aria-hidden className="size-4" />} onClick={onResolve}>
              Attach evidence & resolve
            </Button>
          </>
        ) : undefined
      }
    >
      <Stack gap="large">
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
            items={escalationLadder.map((l) => ({
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
          onSubmit={(body) => {
            comment(e.id, { authorName: actor.name, authorRole: role?.name, body });
            audit({ action: "Commented on exception", entityType: "Exception", entityId: e.id, after: body.slice(0, 120) });
          }}
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

function ResolveModal({ e, onClose }: { e: MonitoringException; onClose: () => void }) {
  const patch = useMonitoring((s) => s.patchException);
  const audit = useAuditLog();
  const actor = useActor();
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const regulatory = regulatoryRelevant.includes(e.type);
  const valid = evidence.trim().length > 2;
  const save = () => {
    const at = new Date().toISOString();
    patch(e.id, { status: "Resolved", evidence: { name: evidence.trim(), at, by: actor.name, note } }, { by: actor.name, action: `Cured — evidence attached: ${evidence.trim()}`, status: "Resolved" });
    audit({ action: "Resolved exception with evidence", entityType: "Exception", entityId: e.id, before: e.status, after: `Resolved · ${evidence.trim()}` });
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Attach curing evidence"
      description={`${e.id} · ${e.type}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            Resolve exception
          </Button>
        </>
      }
    >
      <Stack gap="medium">
        {regulatory && (
          <Alert tone="warning" title="Regulatory-relevant exception">
            A manual “mark as resolved” without evidence is not permitted for {e.type.toLowerCase()} exceptions.
          </Alert>
        )}
        <Field label="Evidence" htmlFor="evidence" description="Payment received, document submitted, covenant re-tested and passed, or reconciliation matched." required>
          <Input id="evidence" value={evidence} onChange={(ev) => setEvidence(ev.target.value)} placeholder="e.g. CBA credit ref FT26314XK2 — arrears cleared" />
        </Field>
        <Field label="Note" htmlFor="evidence-note" optional>
          <Textarea id="evidence-note" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </Field>
        <Text variant="caption" tone="subtle">
          The evidence is time-stamped on save and kept in the exception’s escalation history.
        </Text>
      </Stack>
    </Modal>
  );
}
