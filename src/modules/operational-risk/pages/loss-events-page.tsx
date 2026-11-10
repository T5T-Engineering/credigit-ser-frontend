"use client";

import { useMemo, useState } from "react";
import { Banknote, FilePlus2, HandCoins, Receipt, Scale } from "lucide-react";
import {
  Alert,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  Grid,
  Input,
  MiniBarList,
  Modal,
  ProgressBar,
  Select,
  Stack,
  StatCard,
  StatusBadge,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { branches, DEMO_NOW } from "@/lib/data/seed";
import { date, money, moneyShort, pct } from "@/lib/format";
import { baselEventTypes, businessLines, indicatorCategories, lossLimits, monthlyNetLoss, netLoss, type IndicatorCategory, type LossEvent, type LossEventStatus } from "../data";
import { useOpRisk } from "../store";
import { useActorName, useAuditLog } from "../shared";

const statusTones = { Reported: "info", "Under investigation": "warning", Remediation: "accent", Closed: "success" } as const;
const statusFlow: LossEventStatus[] = ["Reported", "Under investigation", "Remediation", "Closed"];

export function LossEventsPage() {
  const canEdit = useCan("operational-risk", "edit");
  const events = useOpRisk((s) => s.lossEvents);
  const { addLossEvent, updateLossEvent } = useOpRisk.getState();
  const audit = useAuditLog();
  const [openId, setOpenId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const selected = events.find((e) => e.id === openId) ?? null;

  const ytd = useMemo(() => events.filter((e) => new Date(e.discoveredAt).getFullYear() === 2026), [events]);
  const gross = ytd.reduce((s, e) => s + e.grossLoss, 0);
  const rec = ytd.reduce((s, e) => s + e.recovery, 0);
  const net = gross - rec;
  const monthly = monthlyNetLoss(events, 12);
  const byType = baselEventTypes.map((t) => ({ label: t, value: ytd.filter((e) => e.eventType === t).reduce((s, e) => s + netLoss(e), 0), meta: `${ytd.filter((e) => e.eventType === t).length} events` })).filter((x) => x.value > 0);
  const largeOpen = events.filter((e) => netLoss(e) >= lossLimits.singleEventEscalation && e.status !== "Closed");

  const columns: DataTableColumn<LossEvent>[] = [
    { id: "id", header: "Event", accessor: "id", sortable: true, cell: (e) => <span className="font-mono text-xs">{e.id}</span> },
    {
      id: "title",
      header: "Description",
      accessor: "title",
      searchable: true,
      cell: (e) => (
        <div className="min-w-0">
          <div className="font-medium text-fg">{e.title}</div>
          <div className="text-xs text-fg-subtle">{e.businessLine} · {e.branch}</div>
        </div>
      ),
    },
    { id: "eventType", header: "Event type", accessor: "eventType", sortable: true },
    { id: "discoveredAt", header: "Discovered", accessor: (e) => date(e.discoveredAt), sortValue: (e) => e.discoveredAt, sortable: true },
    { id: "gross", header: "Gross loss", numeric: true, sortable: true, accessor: (e) => e.grossLoss, cell: (e) => (e.nearMiss ? <Badge tone="info" variant="outline">Near miss</Badge> : moneyShort(e.grossLoss)) },
    { id: "recovery", header: "Recovered", numeric: true, sortable: true, accessor: (e) => e.recovery, cell: (e) => moneyShort(e.recovery) },
    { id: "net", header: "Net loss", numeric: true, sortable: true, accessor: (e) => netLoss(e), cell: (e) => <span className={netLoss(e) >= lossLimits.singleEventEscalation ? "font-semibold text-danger-strong" : undefined}>{moneyShort(netLoss(e))}</span> },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (e) => <StatusBadge status={e.status} tones={statusTones} /> },
    { id: "source", header: "Source", accessor: "source", hidden: true },
    { id: "category", header: "Indicator category", accessor: "category", hidden: true },
  ];

  const moveStatus = (e: LossEvent, to: LossEventStatus) => {
    updateLossEvent(e.id, { status: to });
    audit("Updated loss event status", "Loss event", e.id, e.status, to);
  };

  return (
    <ModulePage
      module="operational-risk"
      description="Lagging loss-event register — operational losses and near misses with root cause, business line and monetary impact, checked continuously against the Operational Risk Loss Limit Framework."
      actions={canEdit ? <Button iconBefore={<FilePlus2 aria-hidden />} onClick={() => setLogOpen(true)}>Log loss event</Button> : undefined}
    >
      <Stack gap="large">
        {flash && <Alert tone="success" title="Loss event logged">{flash}</Alert>}
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="Gross loss YTD" value={<span className="font-mono">{moneyShort(gross)}</span>} hint={`${ytd.filter((e) => !e.nearMiss).length} loss events · ${ytd.filter((e) => e.nearMiss).length} near misses`} icon={<Receipt aria-hidden />} />
          <StatCard label="Recoveries YTD" value={<span className="font-mono">{moneyShort(rec)}</span>} hint={`${pct(gross ? (rec / gross) * 100 : 0)} recovery rate`} icon={<HandCoins aria-hidden />} tone="success" />
          <StatCard label="Net loss YTD" value={<span className="font-mono">{moneyShort(net)}</span>} hint="Gross loss − recoveries" icon={<Banknote aria-hidden />} tone={net > lossLimits.annualNet ? "danger" : "neutral"} />
          <StatCard label="Annual loss-limit used" value={<span className="font-mono">{pct((net / lossLimits.annualNet) * 100)}</span>} hint={`of ${moneyShort(lossLimits.annualNet)} limit (tenant parameter)`} icon={<Scale aria-hidden />} tone={net / lossLimits.annualNet > 0.75 ? "warning" : "success"}>
            <ProgressBar value={Math.min(1, net / lossLimits.annualNet)} tone={net / lossLimits.annualNet > 0.75 ? "warning" : "success"} size="small" ariaLabel="Annual loss-limit utilisation" />
          </StatCard>
        </Grid>

        {largeOpen.length > 0 && (
          <Alert tone="warning" title={`${largeOpen.length} open event${largeOpen.length === 1 ? "" : "s"} above the single-event escalation threshold (${moneyShort(lossLimits.singleEventEscalation)})`}>
            Auto-escalated through the §6.4.4 protocol; events above {moneyShort(lossLimits.boardMateriality)} are notified to the Board Risk Committee.
          </Alert>
        )}

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card>
            <CardHeader>
              <CardTitle>Net loss by month vs monthly limit</CardTitle>
              <CardDescription>Monthly limit {moneyShort(lossLimits.monthlyNet)} (Loss Limit Framework — demo parameter)</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={monthly.map((m) => ({ label: m.label.replace(" (MTD)", "*").replace(/ \d\d/, ""), value: m.value, caption: m.value > lossLimits.monthlyNet ? "Above limit" : undefined }))}
                valueFormatter={(v) => moneyShort(v)}
                tone="accent"
                height={220}
              />
              <Text variant="caption" tone="subtle">* month to date. Months above the limit raise a KRI-LE-01 Red reading.</Text>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Net loss YTD by event type</CardTitle>
              <CardDescription>Basel II event-type taxonomy (tenant-configurable)</CardDescription>
            </CardHeader>
            <CardContent>
              <MiniBarList label="Net loss by event type" items={byType} valueFormatter={(v) => moneyShort(v)} tone="danger" />
            </CardContent>
          </Card>
        </Grid>

        <DataTable
          label="Loss-event register"
          columns={columns}
          data={events}
          getRowId={(e) => e.id}
          searchable
          searchPlaceholder="Search events"
          filters={[
            { id: "eventType", label: "Event type" },
            { id: "status", label: "Status" },
            { id: "source", label: "Source" },
            { id: "category", label: "Category" },
          ]}
          defaultSort={{ id: "discoveredAt", direction: "desc" }}
          onRowClick={(e) => setOpenId(e.id)}
          exportFilename="loss-event-register.csv"
        />
      </Stack>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={selected?.title ?? ""}
        description={selected ? `${selected.id} · ${selected.eventType}` : undefined}
        footer={
          selected && canEdit && selected.status !== "Closed" ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => moveStatus(selected, statusFlow[statusFlow.indexOf(selected.status) + 1]!)}>Move to {statusFlow[statusFlow.indexOf(selected.status) + 1]}</Button>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <Stack gap="large">
            <StatusBadge status={selected.status} tones={statusTones} />
            <Grid columns={3} gap="small">
              <StatCard label="Gross" value={<span className="font-mono text-lg">{moneyShort(selected.grossLoss)}</span>} />
              <StatCard label="Recovered" value={<span className="font-mono text-lg">{moneyShort(selected.recovery)}</span>} />
              <StatCard label="Net" value={<span className="font-mono text-lg">{moneyShort(netLoss(selected))}</span>} tone={netLoss(selected) >= lossLimits.singleEventEscalation ? "danger" : "neutral"} />
            </Grid>
            <DescriptionList
              columns={1}
              layout="inline"
              items={[
                { label: "Description", value: selected.description },
                { label: "Root cause", value: selected.rootCause },
                { label: "Control failed", value: selected.controlId, mono: true },
                { label: "Indicator category", value: selected.category },
                { label: "Business line", value: selected.businessLine },
                { label: "Branch", value: selected.branch },
                { label: "Occurred", value: date(selected.occurredAt) },
                { label: "Discovered", value: date(selected.discoveredAt) },
                { label: "Source", value: selected.source },
                { label: "Reported by", value: selected.reportedBy },
                { label: "Action plan", value: selected.actionPlan },
              ]}
            />
            {canEdit && selected.status !== "Closed" && !selected.nearMiss && (
              <RecoveryForm
                event={selected}
                onSave={(amount) => {
                  const after = Math.min(selected.grossLoss, selected.recovery + amount);
                  updateLossEvent(selected.id, { recovery: after });
                  audit("Recorded loss recovery", "Loss event", selected.id, money(selected.recovery), money(after));
                }}
              />
            )}
          </Stack>
        )}
      </Drawer>

      <LogEventModal
        open={logOpen}
        onOpenChange={setLogOpen}
        onSubmit={(e) => {
          addLossEvent(e);
          audit("Logged loss event", "Loss event", e.id, undefined, `${e.title} · gross ${money(e.grossLoss)}`);
          setFlash(`${e.id} — ${e.title}. ${netLoss(e) >= lossLimits.singleEventEscalation ? "Above the single-event threshold: escalated to Head of Risk." : "Within single-event threshold."}`);
          setLogOpen(false);
        }}
      />
    </ModulePage>
  );
}

function RecoveryForm({ event, onSave }: { event: LossEvent; onSave: (amount: number) => void }) {
  const [value, setValue] = useState("");
  const amount = Number(value.replace(/,/g, ""));
  const invalid = value !== "" && (!Number.isFinite(amount) || amount <= 0 || amount > event.grossLoss - event.recovery);
  return (
    <Card variant="filled" padding="small">
      <Stack gap="small">
        <Field label="Record a recovery" htmlFor="rec-amt" description={`Up to ${money(event.grossLoss - event.recovery)}`} error={invalid ? "Enter an amount within the unrecovered loss" : undefined}>
          <Input id="rec-amt" prefix="₦" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button size="small" variant="secondary" disabled={!value || invalid} onClick={() => { onSave(amount); setValue(""); }}>Save recovery</Button>
        </div>
      </Stack>
    </Card>
  );
}

type Draft = { title: string; eventType: string; category: string; businessLine: string; branch: string; occurredAt: string; discoveredAt: string; gross: string; recovery: string; rootCause: string; description: string; nearMiss: boolean };
const emptyDraft: Draft = { title: "", eventType: "", category: "", businessLine: "", branch: "", occurredAt: "", discoveredAt: "2026-11-10", gross: "", recovery: "0", rootCause: "", description: "", nearMiss: false };

function LogEventModal({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (e: LossEvent) => void }) {
  const actor = useActorName();
  const [d, setD] = useState<Draft>(emptyDraft);
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const gross = Number(d.gross.replace(/,/g, "") || 0);
  const recovery = Number(d.recovery.replace(/,/g, "") || 0);
  const errors: Partial<Record<keyof Draft, string>> = {
    title: d.title.trim().length < 5 ? "Describe the event" : undefined,
    eventType: !d.eventType ? "Choose an event type" : undefined,
    category: !d.category ? "Choose a category" : undefined,
    businessLine: !d.businessLine ? "Choose a business line" : undefined,
    branch: !d.branch ? "Choose a branch" : undefined,
    occurredAt: !d.occurredAt ? "Enter the date" : d.occurredAt > d.discoveredAt ? "Can't be after discovery" : undefined,
    gross: d.nearMiss ? undefined : !(gross > 0) ? "Enter the gross loss" : undefined,
    recovery: recovery < 0 || recovery > gross ? "Can't exceed the gross loss" : undefined,
    rootCause: d.rootCause.trim().length < 5 ? "State the root cause" : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof Draft) => (touched ? errors[k] : undefined);
  const close = () => { setD(emptyDraft); setTouched(false); onOpenChange(false); };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      size="large"
      title="Log loss event"
      description="Record an operational loss or near miss. Every entry is time-stamped and written to the audit trail."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={close}>Cancel</Button>
          <Button
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSubmit({
                id: `OLE-${Date.now().toString(36).toUpperCase()}`,
                title: d.nearMiss ? `Near miss — ${d.title.trim()}` : d.title.trim(),
                description: d.description.trim() || d.title.trim(),
                eventType: d.eventType as LossEvent["eventType"],
                category: d.category as IndicatorCategory,
                businessLine: d.businessLine,
                branch: d.branch,
                occurredAt: new Date(d.occurredAt).toISOString(),
                discoveredAt: d.discoveredAt === "2026-11-10" ? DEMO_NOW.toISOString() : new Date(d.discoveredAt).toISOString(),
                grossLoss: d.nearMiss ? 0 : gross,
                recovery: d.nearMiss ? 0 : recovery,
                nearMiss: d.nearMiss,
                rootCause: d.rootCause.trim(),
                status: "Reported",
                source: "Direct officer logging",
                reportedBy: actor,
              });
              setD(emptyDraft);
              setTouched(false);
            }}
          >
            Log event
          </Button>
        </div>
      }
    >
      <Stack gap="medium">
        <Field label="Event title" htmlFor="le-title" required error={err("title")}>
          <Input id="le-title" value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Duplicate NIP transfer posted" />
        </Field>
        <Grid columns={{ base: 1, md: 2 }} gap="medium">
          <Field label="Event type" htmlFor="le-type" required error={err("eventType")}>
            <Select id="le-type" placeholder="Select" value={d.eventType} onChange={(e) => set("eventType", e.target.value)} options={baselEventTypes.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="Indicator category" htmlFor="le-cat" required error={err("category")}>
            <Select id="le-cat" placeholder="Select" value={d.category} onChange={(e) => set("category", e.target.value)} options={indicatorCategories.map((c) => ({ value: c.name, label: c.name }))} />
          </Field>
          <Field label="Business line" htmlFor="le-line" required error={err("businessLine")}>
            <Select id="le-line" placeholder="Select" value={d.businessLine} onChange={(e) => set("businessLine", e.target.value)} options={businessLines.map((b) => ({ value: b, label: b }))} />
          </Field>
          <Field label="Branch / location" htmlFor="le-branch" required error={err("branch")}>
            <Select id="le-branch" placeholder="Select" value={d.branch} onChange={(e) => set("branch", e.target.value)} options={["Head office", ...branches].map((b) => ({ value: b, label: b }))} />
          </Field>
          <Field label="Date occurred" htmlFor="le-occ" required error={err("occurredAt")}>
            <Input id="le-occ" type="date" max="2026-11-10" value={d.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} />
          </Field>
          <Field label="Date discovered" htmlFor="le-disc" required>
            <Input id="le-disc" type="date" max="2026-11-10" value={d.discoveredAt} onChange={(e) => set("discoveredAt", e.target.value)} />
          </Field>
        </Grid>
        <Checkbox label="Near miss (no monetary loss)" checked={d.nearMiss} onChange={(e) => set("nearMiss", e.target.checked)} />
        {!d.nearMiss && (
          <Grid columns={{ base: 1, md: 2 }} gap="medium">
            <Field label="Gross loss" htmlFor="le-gross" required error={err("gross")}>
              <Input id="le-gross" prefix="₦" inputMode="numeric" value={d.gross} onChange={(e) => set("gross", e.target.value)} />
            </Field>
            <Field label="Recovered to date" htmlFor="le-rec" error={err("recovery")} description={gross > 0 ? `Net loss ${money(Math.max(0, gross - recovery))}` : undefined}>
              <Input id="le-rec" prefix="₦" inputMode="numeric" value={d.recovery} onChange={(e) => set("recovery", e.target.value)} />
            </Field>
          </Grid>
        )}
        <Field label="Root cause" htmlFor="le-root" required error={err("rootCause")}>
          <Textarea id="le-root" rows={2} value={d.rootCause} onChange={(e) => set("rootCause", e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="le-desc" optional>
          <Textarea id="le-desc" rows={2} value={d.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        {!d.nearMiss && gross - recovery >= lossLimits.singleEventEscalation && (
          <Alert tone="warning" title="Above the single-event escalation threshold">
            Net loss of {money(gross - recovery)} exceeds {money(lossLimits.singleEventEscalation)}; the event will be escalated to the Head of Risk on save.
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
