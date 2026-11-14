"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Plug } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeSnippet,
  DataTable,
  EmptyState,
  EventLogList,
  Field,
  Grid,
  Modal,
  Stack,
  SubmitButton,
  SubscriptionList,
  Tabs,
  Text,
  Textarea,
  type DataTableColumn,
  type DomainEventEntry,
  type HookSubscription,
} from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { dateTime } from "@/lib/format";
import { eventCatalogue, subscriptionList, useEventStore, type EventDefinition } from "@/lib/platform/events";
import { hookList, hookPointCatalogue, runHooks, type HookPointDefinition } from "@/lib/platform/hooks";
import { submitOperation, useOperationsStore, type OperationInstance } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { isOpen } from "./logic";

/** Operations → Events & hooks: event log, catalogue, hook points, registered extensions and a developer guide. */
export function EventsPage() {
  return (
    <ModulePage module="operations" description="Domain events published by every module, the hook points extensions can intercept, and the extensions registered in this tenant.">
      <Tabs
        variant="underline"
        defaultValue="log"
        items={[
          { id: "log", label: "Event log", content: <LogTab /> },
          { id: "catalogue", label: "Event catalogue", content: <CatalogueTab /> },
          { id: "hooks", label: "Hook points", content: <HookPointsTab /> },
          { id: "subs", label: "Subscriptions", content: <SubscriptionsTab /> },
          { id: "guide", label: "Developer guide", content: <GuideTab /> },
        ]}
      />
    </ModulePage>
  );
}

function LogTab() {
  const log = useEventStore((s) => s.log);
  const { actor } = useScope();
  const canSeeAll = useCan("operations.oversight.view");
  // User scope: platform owners see every event; others see events they caused.
  const scoped = canSeeAll ? log : log.filter((e) => e.actorId === actor.id);
  const events: DomainEventEntry[] = scoped.map((e) => ({
    id: e.id,
    name: e.name,
    module: e.module,
    subject: e.subject ? { label: e.subject.title ?? e.subject.id, href: e.subject.href } : undefined,
    actor: e.actorName,
    time: dateTime(e.at),
    payload: e.payload,
    deliveredTo: e.deliveredTo,
    status: "delivered",
  }));
  return (
    <Stack gap="medium">
      <Text variant="small" tone="muted">
        {canSeeAll ? "Every event published in this browser (newest first; the demo keeps the latest 500)." : "Events caused by your actions."}
      </Text>
      {events.length ? (
        <EventLogList events={events} linkComponent={Link} label="Event log" />
      ) : (
        <EmptyState icon={<Activity aria-hidden />} title="No events yet" description="Submit or decide an operation, change a rule or send a test notification to see events here." />
      )}
    </Stack>
  );
}

function CatalogueTab() {
  const rows = eventCatalogue();
  const canExport = useCan("operations.catalogue.export");
  const columns: DataTableColumn<EventDefinition>[] = [
    { id: "name", header: "Event", accessor: "name", sortable: true, cell: (e) => <span className="font-mono text-sm font-semibold">{e.name}</span> },
    { id: "module", header: "Module", accessor: "module", sortable: true },
    { id: "description", header: "Description", accessor: "description" },
    { id: "payload", header: "Payload example", accessor: (e) => (e.payloadExample ? JSON.stringify(e.payloadExample) : ""), cell: (e) => (e.payloadExample ? <span className="font-code text-xs break-all">{JSON.stringify(e.payloadExample)}</span> : <Text variant="small" tone="muted">—</Text>) },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(e) => e.name}
      label="Event catalogue"
      searchable
      searchPlaceholder="Search events"
      filters={[{ id: "module", label: "Module", columnId: "module" }]}
      defaultPageSize={20}
      exportFilename={canExport ? "event-catalogue.csv" : undefined}
      exportLabel="Export CSV"
      emptyState={<EmptyState title="No events declared" description="Modules declare events with defineEvents() in platform.ts." />}
      mobileCard={(e) => (
        <Stack gap="xsmall">
          <span className="font-mono text-sm font-semibold">{e.name}</span>
          <span className="text-sm">{e.description}</span>
        </Stack>
      )}
    />
  );
}

function HookPointsTab() {
  const rows = hookPointCatalogue();
  const handlers = hookList();
  const columns: DataTableColumn<HookPointDefinition>[] = [
    { id: "point", header: "Hook point", accessor: "point", sortable: true, cell: (h) => <span className="font-mono text-sm font-semibold">{h.point}</span> },
    { id: "kind", header: "Kind", accessor: "kind", cell: (h) => <Badge tone={h.kind === "before" ? "warning" : "info"}>{h.kind === "before" ? "Before — can veto / enrich" : "After — observe / enrich"}</Badge> },
    { id: "module", header: "Module", accessor: "module", sortable: true },
    { id: "description", header: "Description", accessor: "description" },
    { id: "handlers", header: "Handlers", accessor: (h) => handlers.filter((x) => x.point === h.point).length, numeric: true },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(h) => h.point}
      label="Hook points"
      searchable
      searchPlaceholder="Search hook points"
      filters={[
        { id: "module", label: "Module", columnId: "module" },
        { id: "kind", label: "Kind", columnId: "kind" },
      ]}
      defaultPageSize={20}
      emptyState={<EmptyState title="No hook points declared" description="Modules declare hook points with defineHookPoints() in platform.ts." />}
      mobileCard={(h) => (
        <Stack gap="xsmall">
          <span className="font-mono text-sm font-semibold">{h.point}</span>
          <span className="text-sm">{h.description}</span>
        </Stack>
      )}
    />
  );
}

type Toggle = { id: string; name: string; kind: "subscription" | "hook"; enabled: boolean };

function SubscriptionsTab() {
  const enabled = useEventStore((s) => s.enabled);
  const lastRun = useEventStore((s) => s.lastRun);
  const instances = useOperationsStore((s) => s.instances);
  const canEdit = useCan("operations.extensions.toggle");
  const minComment = useRule<number>("operations.minCommentLength");
  const { actor } = useScope();
  const { toast } = useSaveFeedback();
  const [toggle, setToggle] = useState<Toggle | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const pendingById = useMemo(() => {
    const m = new Map<string, OperationInstance>();
    for (const i of instances) if (i.operationType === "extension.toggle" && isOpen(i)) m.set(i.subject.id, i);
    return m;
  }, [instances]);

  const subs = subscriptionList();
  const hooks = hookList();
  const meta = new Map<string, { name: string; kind: Toggle["kind"] }>();
  const run = (id: string): HookSubscription["lastRun"] => {
    const r = lastRun[id];
    return r ? { status: r.ok ? "success" : "failed", time: dateTime(r.at), message: r.message } : { status: "never" };
  };
  const list: HookSubscription[] = [
    ...hooks.map((h) => {
      meta.set(h.id, { name: h.name, kind: "hook" });
      return { id: h.id, pattern: h.point, kind: h.point.endsWith(".before") ? ("before" as const) : ("after" as const), handler: h.name, description: <span className="font-mono text-xs">{h.id}</span>, priority: h.priority, enabled: enabled[h.id] !== false, lastRun: run(h.id) };
    }),
    ...subs.map((s) => {
      meta.set(s.id, { name: s.name, kind: "subscription" });
      return { id: s.id, pattern: s.pattern, kind: "event" as const, handler: s.name, description: <span className="font-mono text-xs">{s.id}</span>, priority: s.priority, enabled: enabled[s.id] !== false, lastRun: run(s.id) };
    }),
  ];

  async function submit() {
    if (!toggle) return;
    setBusy(true);
    const hook = await runHooks("operations.extension.toggle.before", { ...toggle, actor });
    if (!hook.ok) {
      setBusy(false);
      return toast({ title: "Toggle blocked", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
    }
    const state = toggle.enabled ? "Enable" : "Disable";
    const res = await submitOperation("extension.toggle", {
      title: `${state} extension: ${toggle.name}`,
      subject: { type: "Extension", id: toggle.id, title: toggle.name, href: "/operations/events" },
      payload: { ...toggle, reason: reason.trim() },
      summary: [
        { label: "Extension", value: `${toggle.name} (${toggle.id})` },
        { label: "Kind", value: toggle.kind === "hook" ? "Hook handler" : "Event subscriber" },
        { label: "Change", value: toggle.enabled ? "disabled → enabled" : "enabled → disabled" },
        { label: "Reason", value: reason.trim() },
      ],
    });
    setBusy(false);
    if (!res.ok) return toast({ title: "Change not submitted", description: res.reason, tone: "danger" });
    toast({ title: res.applied ? `Extension ${toggle.enabled ? "enabled" : "disabled"}` : "Change submitted for approval", description: res.applied ? "Applied directly (workflow disabled)." : `Reference ${res.instance.id}`, tone: "success" });
    setToggle(null);
    setReason("");
  }

  return (
    <Stack gap="medium">
      <Alert tone="info" title="Toggling is a configuration change">
        Enabling or disabling an extension submits an “Extension enable / disable” operation; it takes effect only after approval. Entries labelled EXAMPLE are demo extensions registered by the Operations module.
      </Alert>
      {list.length ? (
        <SubscriptionList
          subscriptions={list}
          readOnly={!canEdit}
          onToggle={(id, on) => {
            if (pendingById.has(id)) return toast({ title: "Change already awaiting approval", tone: "warning" });
            const m = meta.get(id);
            if (m) setToggle({ id, name: m.name, kind: m.kind, enabled: on });
          }}
          actions={(s) => {
            const p = pendingById.get(s.id);
            return p ? (
              <Button as={Link} href={`/operations/item?id=${p.id}`} size="small" variant="tertiary">
                Awaiting approval
              </Button>
            ) : null;
          }}
        />
      ) : (
        <EmptyState icon={<Plug aria-hidden />} title="No extensions registered" description="Use subscribe() or registerHook() — see the developer guide." />
      )}
      <Modal
        open={!!toggle}
        onOpenChange={(o) => !o && setToggle(null)}
        title={toggle ? `${toggle.enabled ? "Enable" : "Disable"} ${toggle.name}?` : "Toggle extension"}
        description="This submits a change for approval."
        footer={
          <Stack direction="horizontal" gap="small" justify="end">
            <Button variant="tertiary" onClick={() => setToggle(null)}>
              Cancel
            </Button>
            <SubmitButton loading={busy} disabled={reason.trim().length < minComment} onClick={submit}>
              Submit for approval
            </SubmitButton>
          </Stack>
        }
      >
        <Field label="Reason" description={`At least ${minComment} characters.`} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      </Modal>
    </Stack>
  );
}

const subscribeSnippet = `// src/modules/<your-module>/platform.ts
import { subscribe } from "@/lib/platform/events";

subscribe({
  id: "my-extension.facility-approved",
  name: "Sync approved facilities to the core banking system",
  pattern: "credit-admin.facility.*",   // exact name or * wildcards
  priority: 100,                         // lower runs first
  handler: async (event) => {
    // event: { id, name, module, subject, payload, actorId, actorName, at }
    await fetch(getRule<string>("my-extension.webhookUrl"), { method: "POST", body: JSON.stringify(event) });
  },
});`;

const hookSnippet = `// Intercept an action. "before" hooks may veto or enrich; "after" hooks observe.
import { registerHook } from "@/lib/platform/hooks";

registerHook<{ type: string; payload: { amountNgn?: number } }>({
  id: "my-extension.exposure-check",
  name: "Exposure check",
  point: "operations.submit.before",
  run: (ctx) => {
    if ((ctx.payload.amountNgn ?? 0) > getRule<number>("my-extension.maxNgn")) return { veto: "Above the extension's limit" };
    return { ctx: { ...ctx, payload: { ...ctx.payload, checkedAt: new Date().toISOString() } } }; // enrich
  },
});`;

const publishSnippet = `// Publish your own events and expose hook points (declare them so they appear in the catalogue).
import { defineEvents, publish } from "@/lib/platform/events";
import { defineHookPoints, runHooks } from "@/lib/platform/hooks";

defineEvents([{ name: "my-module.thing.created", module: "my-module", description: "A thing was created." }]);
defineHookPoints([{ point: "my-module.create.before", module: "my-module", kind: "before", description: "Veto or enrich a new thing." }]);

const hook = await runHooks("my-module.create.before", input);
if (!hook.ok) return { ok: false, reason: hook.reason };
// …save, audit…
publish("my-module.thing.created", { module: "my-module", subject: { type: "Thing", id }, payload: { id } });`;

function GuideTab() {
  return (
    <Grid columns={{ base: 1, lg: 2 }} gap="large">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Subscribe to events</CardTitle>
            <CardDescription>Subscribers run after the event is logged; errors never break the publisher. Read thresholds and URLs from business rules.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CodeSnippet code={subscribeSnippet} language="ts" copyable label="Subscribe example" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Register a hook</CardTitle>
            <CardDescription>Handlers run in priority order. A veto from a “before” hook stops the action and is shown to the user.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CodeSnippet code={hookSnippet} language="ts" copyable label="Hook example" />
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Expose your own extension points</CardTitle>
            <CardDescription>Name events “&lt;module&gt;.&lt;entity&gt;.&lt;past-verb&gt;”. Register in your module&apos;s platform.ts and import it from src/lib/platform/registry.ts.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CodeSnippet code={publishSnippet} language="ts" copyable label="Publish example" />
        </CardContent>
      </Card>
    </Grid>
  );
}
