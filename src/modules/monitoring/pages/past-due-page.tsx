"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, MoreHorizontal, StickyNote, UserPlus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  Grid,
  Menu,
  MiniBarList,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  StackedBarChart,
  StatCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  TextLink,
  Textarea,
  Tooltip,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { useFacilities, useLookups, useUsers } from "@/lib/data/hooks";
import type { Facility } from "@/lib/data/types";
import { date, dateTime, money, moneyShort, number, pct } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { useDpdLadder } from "../hooks";
import { cbnClassFromDpd, cbnClassTones, dpdBucket, dpdBucketDef, exposureOf, pastDueSince, provisionLabel, stageTones } from "../logic";
import { addFacilityNote, assignFacility, exceptionHref } from "../service";
import { RaiseExceptionModal, type RaiseExceptionTarget } from "../raise-exception";
import { openExceptionFor, useMonitoring } from "../store";

type Row = Facility & { obligorName: string; sectorName: string; obligorType: string; exposure: number; bucket: string; assignee?: string; assigneeId?: string; exceptionId?: string; noteCount: number };

type Dimension = "sector" | "product" | "obligorType" | "branch";

export function PastDuePage() {
  const facilities = useFacilities();
  const { obligor, sector, user } = useLookups();
  const users = useUsers();
  const canRaise = useCan("monitoring.exceptions.create");
  const canAssign = useCan("monitoring.facilities.assign");
  const canNote = useCan("monitoring.facility-notes.create");
  const canExport = useCan("monitoring.registers.export");
  const exceptions = useMonitoring((s) => s.exceptions);
  const notes = useMonitoring((s) => s.notes);
  const assignments = useMonitoring((s) => s.assignments);
  const [dimension, setDimension] = useState<Dimension>("sector");
  const [raiseTarget, setRaiseTarget] = useState<RaiseExceptionTarget | null>(null);
  const [assignFor, setAssignFor] = useState<Row | null>(null);
  const [noteFor, setNoteFor] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const { actor } = useScope();
  const { buckets, t } = useDpdLadder();
  const assignableRoles = useRule<RoleId[]>("monitoring.assignment.roles");

  const active = useMemo(() => facilities.filter((f) => f.status === "Active" || f.status === "Restructured"), [facilities]);
  const rows: Row[] = useMemo(
    () =>
      active.map((f) => {
        const o = obligor.get(f.obligorId);
        return {
          ...f,
          obligorName: o?.name ?? f.obligorId,
          sectorName: o ? (sector.get(o.sectorId)?.name ?? o.sectorId) : "—",
          obligorType: o?.type ?? "—",
          exposure: exposureOf(f),
          bucket: dpdBucket(f.dpd),
          assignee: assignments[f.id] ? user.get(assignments[f.id]!)?.name : undefined,
          assigneeId: assignments[f.id],
          exceptionId: openExceptionFor(exceptions, { facilityId: f.id })?.id,
          noteCount: notes[f.id]?.length ?? 0,
        };
      }),
    // `t` (rule thresholds) changes the bucket labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, obligor, sector, user, assignments, exceptions, notes, t],
  );

  const pastDue = useMemo(() => rows.filter((r) => r.dpd > 0), [rows]);
  const book = rows.reduce((a, r) => a + r.exposure, 0);
  const pdValue = pastDue.reduce((a, r) => a + r.exposure, 0);
  const npl = rows.filter((r) => r.dpd >= t.substandard);
  const nplValue = npl.reduce((a, r) => a + r.exposure, 0);
  const watch = rows.filter((r) => r.dpd >= t.watchlist && r.dpd < t.substandard);
  const tableRows = scope === "mine" ? rows.filter((r) => r.assigneeId === actor.id) : rows;
  const openPd = exceptions.filter((e) => e.type === "Past-due obligation" && e.status !== "Resolved").length;

  const ladder = buckets.filter((b) => b.id !== "Current");
  const ladderSeries = ladder.map((b) => ({
    name: `${b.cbnClass === "Performing" ? "Performing (arrears)" : b.cbnClass}`,
    tone: b.tone,
    values: ladder.map((c) => (c.id === b.id ? pastDue.filter((r) => r.bucket === b.id).reduce((a, r) => a + r.exposure, 0) : 0)),
  }));

  const byDimension = useMemo(() => {
    const m = new Map<string, { value: number; count: number }>();
    for (const r of pastDue) {
      const key = dimension === "sector" ? r.sectorName : dimension === "product" ? r.product : dimension === "obligorType" ? r.obligorType : r.branch;
      const cur = m.get(key) ?? { value: 0, count: 0 };
      m.set(key, { value: cur.value + r.exposure, count: cur.count + 1 });
    }
    return [...m.entries()].map(([label, v]) => ({ label, value: v.value, meta: `${v.count} facilit${v.count === 1 ? "y" : "ies"}` }));
  }, [pastDue, dimension]);

  const raiseFor = (r: Row) =>
    setRaiseTarget({
      obligorId: r.obligorId,
      obligorName: r.obligorName,
      facilityId: r.id,
      amount: r.exposure,
      type: "Past-due obligation",
      title: `${r.dpd} days past due — ${r.product}`,
      detail: `${r.obligorName}: ${r.product} ${r.id} is ${r.dpd} days past due (CBN class ${r.cbnClass}, IFRS 9 Stage ${r.stage}). Outstanding ${money(r.exposure, r.currency)}.`,
      source: "Manual",
    });

  const columns: DataTableColumn<Row>[] = [
    { id: "id", header: "Facility", accessor: "id", sortable: true, cell: (r) => <span className="font-mono">{r.id}</span> },
    {
      id: "obligor",
      header: "Obligor",
      accessor: "obligorName",
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <span className="font-medium text-fg">{r.obligorName}</span>
          <Text variant="caption" tone="subtle">
            {r.sectorName}
          </Text>
        </Stack>
      ),
    },
    { id: "product", header: "Product", accessor: "product", sortable: true },
    { id: "exposure", header: "Outstanding", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure, r.currency) },
    {
      id: "dpd",
      header: "DPD",
      accessor: "dpd",
      numeric: true,
      sortable: true,
      cell: (r) => (
        <Tooltip content={`Past due since ${date(pastDueSince(r.dpd))} (ageing from ${date(DEMO_NOW)})`}>
          <span className="font-mono">{r.dpd}</span>
        </Tooltip>
      ),
    },
    { id: "bucket", header: "Ageing bucket", accessor: "bucket", hidden: true },
    {
      id: "cbn",
      header: "CBN class",
      accessor: "cbnClass",
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <StatusBadge status={r.cbnClass} tones={cbnClassTones} />
          {cbnClassFromDpd(r.dpd) !== r.cbnClass && (
            <Text variant="caption" tone="subtle">
              Qualitative trigger
            </Text>
          )}
        </Stack>
      ),
    },
    { id: "stage", header: "IFRS 9", accessor: (r) => `Stage ${r.stage}`, sortable: true, cell: (r) => <StatusBadge status={`Stage ${r.stage}`} tones={stageTones} /> },
    { id: "assignee", header: "Assigned", accessor: (r) => r.assignee ?? "", cell: (r) => r.assignee ?? <Text variant="small" tone="subtle">Unassigned</Text> },
    {
      id: "exception",
      header: "Exception",
      accessor: (r) => r.exceptionId ?? "",
      cell: (r) =>
        r.exceptionId ? (
          <TextLink as={Link} href={exceptionHref(r.exceptionId)}>
            {r.exceptionId}
          </TextLink>
        ) : (
          <Text variant="small" tone="subtle">
            None
          </Text>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (r) => (
        <Menu
          align="end"
          triggerLabel={`Actions for ${r.id}`}
          trigger={<MoreHorizontal aria-hidden className="size-4" />}
          items={[
            { label: "View monitoring detail", onSelect: () => setDetail(r) },
            ...(canRaise ? [{ label: r.exceptionId ? "Exception already open" : "Raise exception", icon: <AlertTriangle aria-hidden className="size-4" />, onSelect: () => raiseFor(r), disabled: !!r.exceptionId }] : []),
            ...(canAssign ? [{ label: "Assign officer", icon: <UserPlus aria-hidden className="size-4" />, onSelect: () => setAssignFor(r) }] : []),
            ...(canNote ? [{ label: "Add note", icon: <StickyNote aria-hidden className="size-4" />, onSelect: () => setNoteFor(r) }] : []),
            ...(r.collateralIds[0] ? [{ label: "View collateral", href: `/collateral/item?id=${r.collateralIds[0]}` }] : []),
          ]}
          linkComponent={Link}
        />
      ),
    },
  ];

  return (
    <ModulePage module="monitoring" description="Past-due obligations by value and number at obligor, product, sector and portfolio level — refreshed daily from the CBA connector, with the CBN days-past-due ladder applied automatically.">
      <Stack gap="large">
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Past-due facilities" value={number(pastDue.length)} hint={`${moneyShort(pdValue)} · ${pct((pdValue / book) * 100)} of the active book`} tone="warning" />
          <StatCard label={`Non-performing (${t.substandard}+ DPD)`} value={moneyShort(nplValue)} hint={`${npl.length} facilities · NPL ratio ${pct((nplValue / book) * 100)}`} tone="danger" />
          <StatCard label={`Watchlist (${t.watchlist}–${t.substandard - 1} DPD)`} value={moneyShort(watch.reduce((a, r) => a + r.exposure, 0))} hint={`${watch.length} facilities · IFRS 9 Stage 2`} tone="info" />
          <StatCard label="Open past-due exceptions" value={number(openPd)} hint="In the escalation protocol" />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>CBN days-past-due ladder</CardTitle>
                <CardDescription>Outstanding exposure by ageing bucket. Performing → Non-Performing at {t.substandard}+ days.</CardDescription>
              </div>
            </CardHeader>
            <StackedBarChart categories={ladder.map((b) => b.id)} series={ladderSeries} orientation="horizontal" valueFormatter={(v) => moneyShort(v)} label="Past-due exposure by DPD bucket" />
            <Table className="mt-4">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Bucket</TableHeaderCell>
                  <TableHeaderCell className="hidden sm:table-cell">CBN class</TableHeaderCell>
                  <TableHeaderCell numeric>Facilities</TableHeaderCell>
                  <TableHeaderCell numeric>CBN provision</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ladder.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.id}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge status={b.cbnClass} tones={cbnClassTones} />
                    </TableCell>
                    <TableCell numeric>{pastDue.filter((r) => r.bucket === b.id).length}</TableCell>
                    <TableCell numeric>{provisionLabel(b.cbnClass)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Text variant="caption" tone="subtle" className="mt-3 block">
              Ladder: {ladder.map((b) => `${b.id} ${b.cbnClass}`).join(" · ")}. Source: CBA facility book, {date(DEMO_NOW)} daily refresh.
            </Text>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Past-due concentration</CardTitle>
                <CardDescription>Value of past-due exposure.</CardDescription>
              </div>
            </CardHeader>
            <Stack gap="medium">
              <SegmentedControl
                label="Group past-due exposure by"
                size="small"
                value={dimension}
                onChange={setDimension}
                options={[
                  { value: "sector", label: "Sector" },
                  { value: "product", label: "Product" },
                  { value: "obligorType", label: "Segment" },
                  { value: "branch", label: "Branch" },
                ]}
              />
              <MiniBarList items={byDimension} limit={7} valueFormatter={(v) => moneyShort(v)} label="Past-due exposure ranking" tone="warning" />
            </Stack>
          </Card>
        </Grid>

        <SegmentedControl
          label="Show"
          size="small"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All facilities" },
            { value: "mine", label: `Assigned to me (${rows.filter((r) => r.assigneeId === actor.id && r.dpd > 0).length} past due)` },
          ]}
        />
        <DataTable
          label="Past-due obligations"
          data={tableRows}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          searchPlaceholder="Search obligor, facility or product"
          defaultSort={{ id: "dpd", direction: "desc" }}
          filters={[
            {
              id: "scope",
              label: "Scope",
              options: [
                { value: "past-due", label: "Past due (DPD > 0)" },
                { value: "npl", label: `Non-performing (${t.substandard}+)` },
                { value: "all", label: "All active facilities" },
              ],
              defaultValue: "past-due",
              filterFn: (r, v) => (v === "npl" ? r.dpd >= t.substandard : v === "all" ? true : r.dpd > 0),
            },
            { id: "bucket", label: "Bucket", options: buckets.map((b) => ({ value: b.id, label: b.id })), filterFn: (r, v) => r.bucket === v },
            { id: "cbn", label: "CBN class", columnId: "cbn" },
            { id: "product", label: "Product", columnId: "product" },
            { id: "branch", label: "Branch", filterFn: (r, v) => r.branch === v, options: [...new Set(rows.map((r) => r.branch))].sort().map((b) => ({ value: b, label: b })) },
          ]}
          onRowClick={(r) => setDetail(r)}
          density="compact"
          exportFilename={canExport ? "past-due-obligations.csv" : undefined}
          emptyState={<EmptyState title="No past-due obligations" description="Every facility in this view is up to date." />}
          mobileCard={(r) => (
            <Stack gap="xsmall">
              <span className="font-medium text-fg">{r.obligorName}</span>
              <Text variant="small" tone="muted">
                {r.id} · {r.product} · {moneyShort(r.exposure, r.currency)}
              </Text>
              <Stack direction="horizontal" gap="small" wrap>
                <Badge tone="neutral">{r.dpd} DPD</Badge>
                <StatusBadge status={r.cbnClass} tones={cbnClassTones} />
                <StatusBadge status={`Stage ${r.stage}`} tones={stageTones} />
              </Stack>
            </Stack>
          )}
        />
      </Stack>

      <RaiseExceptionModal target={raiseTarget} onClose={() => setRaiseTarget(null)} />
      {assignFor && <AssignModal row={assignFor} users={users.filter((u) => u.status === "Active" && assignableRoles.includes(u.roleId))} onClose={() => setAssignFor(null)} />}
      {noteFor && <NoteModal row={noteFor} onClose={() => setNoteFor(null)} />}
      <FacilityDrawer row={detail} onClose={() => setDetail(null)} canEdit={canRaise} onRaise={(r) => (setDetail(null), raiseFor(r))} />
    </ModulePage>
  );
}

function AssignModal({ row, users, onClose }: { row: Row; users: { id: string; name: string; roleId: string }[]; onClose: () => void }) {
  const current = useMonitoring((s) => s.assignments[row.id]);
  const [value, setValue] = useState(current ?? users[0]?.id ?? "");
  const save = () => {
    assignFacility(row.id, value);
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Assign officer"
      description={`${row.obligorName} · ${row.id}`}
      size="small"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Assign</Button>
        </>
      }
    >
      <Field label="Officer" htmlFor="assignee">
        <Select id="assignee" value={value} onChange={(e) => setValue(e.target.value)} options={users.map((u) => ({ value: u.id, label: `${u.name} — ${roleById[u.roleId as RoleId]?.name ?? u.roleId}` }))} />
      </Field>
    </Modal>
  );
}

function NoteModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const [body, setBody] = useState("");
  const minLength = useRule<number>("monitoring.exceptions.minDetailLength");
  const save = () => {
    addFacilityNote(row.id, body.trim());
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add monitoring note"
      description={`${row.obligorName} · ${row.id}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={body.trim().length < minLength}>
            Save note
          </Button>
        </>
      }
    >
      <Field label="Note" htmlFor="note-body" description="Visible to everyone with access to Loan Review. Recorded in the audit log.">
        <Textarea id="note-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </Modal>
  );
}

function FacilityDrawer({ row, onClose, canEdit, onRaise }: { row: Row | null; onClose: () => void; canEdit: boolean; onRaise: (r: Row) => void }) {
  const notes = useMonitoring((s) => (row ? s.notes[row.id] : undefined));
  if (!row) return null;
  const bucket = dpdBucketDef(row.dpd);
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={row.obligorName}
      description={`${row.id} · ${row.product}`}
      size="medium"
      footer={
        canEdit && !row.exceptionId ? (
          <Button iconBefore={<AlertTriangle aria-hidden className="size-4" />} onClick={() => onRaise(row)}>
            Raise exception
          </Button>
        ) : undefined
      }
    >
      <Stack gap="large">
        <DescriptionList
          columns={2}
          items={[
            { label: "Outstanding", value: money(row.exposure, row.currency), mono: true },
            { label: "Approved", value: money(row.approvedAmount, row.currency), mono: true },
            { label: "Days past due", value: String(row.dpd), mono: true, hint: `Since ${date(pastDueSince(row.dpd))}` },
            { label: "Ageing bucket", value: row.bucket, hint: bucket.rule },
            { label: "CBN class", status: row.cbnClass, statusTones: cbnClassTones },
            { label: "IFRS 9 stage", status: `Stage ${row.stage}`, statusTones: stageTones },
            { label: "Maturity", value: date(row.maturityDate) },
            { label: "Assigned officer", value: row.assignee },
            {
              label: "Open exception",
              value: row.exceptionId ? (
                <TextLink as={Link} href={exceptionHref(row.exceptionId)}>
                  {row.exceptionId}
                </TextLink>
              ) : undefined,
            },
            { label: "Branch", value: row.branch },
          ]}
        />
        <Stack gap="small">
          <Text variant="eyebrow">Collateral</Text>
          {row.collateralIds.length ? (
            <Stack direction="horizontal" gap="small" wrap>
              {row.collateralIds.map((id) => (
                <TextLink key={id} as={Link} href={`/collateral/item?id=${id}`}>
                  {id}
                </TextLink>
              ))}
            </Stack>
          ) : (
            <Text variant="small" tone="subtle">
              Clean / unsecured facility
            </Text>
          )}
        </Stack>
        <Stack gap="small">
          <Text variant="eyebrow">Monitoring notes</Text>
          {notes?.length ? (
            notes.map((n) => (
              <Card key={n.id} variant="filled" padding="small">
                <Text variant="small">{n.body}</Text>
                <Text variant="caption" tone="subtle">
                  {n.by} · {dateTime(n.at)}
                </Text>
              </Card>
            ))
          ) : (
            <Text variant="small" tone="subtle">
              No notes yet.
            </Text>
          )}
        </Stack>
      </Stack>
    </Drawer>
  );
}

