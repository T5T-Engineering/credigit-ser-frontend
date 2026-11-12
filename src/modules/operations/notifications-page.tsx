"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  Grid,
  HtmlTemplatePreview,
  Input,
  KeyValueEditor,
  Stack,
  Tabs,
  TemplateVariableList,
  Text,
  Textarea,
  fromKeyValuePairs,
  toKeyValuePairs,
  useToast,
  type DataTableColumn,
  type KeyValuePair,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useSession } from "@/lib/auth/session";
import { useCan } from "@/lib/iam/permissions";
import { useDb } from "@/lib/data/store";
import { useUsers } from "@/lib/data/hooks";
import { dateTime } from "@/lib/format";
import { allNavItems } from "@/lib/nav";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { baseTemplate, fill, notify, renderEmail, templateList, useNotificationStore, type NotificationTemplate, type OutboxItem } from "@/lib/platform/notifications";
import { submitOperation, usePendingFor } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";

const moduleLabel = (m: string) => allNavItems.find((n) => n.module === m)?.label ?? (m === "platform" ? "Platform" : m);

/** Operations → Notifications: templates (preview, test, edit via approval) and the email outbox. */
export function NotificationsPage() {
  return (
    <ModulePage module="operations" description="Notification templates used across the platform, and the email outbox. Template wording changes are approved through Operations.">
      <Tabs
        variant="underline"
        defaultValue="templates"
        items={[
          { id: "templates", label: "Templates", content: <TemplatesTab /> },
          { id: "outbox", label: "Outbox", content: <OutboxTab /> },
        ]}
      />
    </ModulePage>
  );
}

const toneOf = { info: "info", success: "success", warning: "warning", danger: "danger" } as const;

function TemplatesTab() {
  const overrides = useNotificationStore((s) => s.overrides);
  const templates = templateList(); // re-rendered when tenant overrides change (subscription above)
  const [selected, setSelected] = useState<string | null>(null);
  const columns: DataTableColumn<NotificationTemplate>[] = [
    { id: "name", header: "Template", accessor: "name", sortable: true, cell: (t) => <span className="font-semibold">{t.name}</span> },
    { id: "id", header: "Id", accessor: "id", cell: (t) => <span className="font-mono text-sm">{t.id}</span> },
    { id: "module", header: "Module", accessor: (t) => moduleLabel(t.module), sortable: true },
    { id: "trigger", header: "Trigger", accessor: "trigger", cell: (t) => <span className="font-mono text-sm">{t.trigger}</span> },
    { id: "tone", header: "Tone", accessor: "tone", cell: (t) => <Badge tone={toneOf[t.tone]}>{t.tone}</Badge> },
    { id: "modified", header: "Wording", accessor: (t) => (overrides[t.id] ? "Tenant edit" : "Default"), cell: (t) => (overrides[t.id] ? <Badge tone="brand">Tenant edit</Badge> : <Text variant="small" tone="muted">Default</Text>) },
  ];
  return (
    <Stack gap="medium">
      <DataTable
        columns={columns}
        data={templates}
        getRowId={(t) => t.id}
        label="Notification templates"
        searchable
        searchPlaceholder="Search templates"
        filters={[{ id: "module", label: "Module", columnId: "module" }]}
        onRowClick={(t) => setSelected(t.id)}
        defaultPageSize={15}
        emptyState={<EmptyState icon={<Mail aria-hidden />} title="No templates" description="Modules register their templates in platform.ts." />}
        mobileCard={(t) => (
          <Stack gap="xsmall">
            <span className="font-semibold">{t.name}</span>
            <span className="font-mono text-sm text-fg-muted">{t.id}</span>
          </Stack>
        )}
      />
      {selected ? <TemplateDrawer key={selected} id={selected} onClose={() => setSelected(null)} /> : null}
    </Stack>
  );
}

function TemplateDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const override = useNotificationStore((s) => s.overrides[id]);
  const base = baseTemplate(id);
  const template = base ? { ...base, ...override } : undefined;
  const { actor } = useScope();
  const { toast } = useToast();
  const canEdit = useCan("notifications.templates.request-change");
  const canSendTest = useCan("notifications.templates.test");
  const testRoles = useRule<string[]>("operations.testSendRoles");
  const minComment = useRule<number>("operations.minCommentLength");
  const pending = usePendingFor("NotificationTemplate", id);
  const [pairs, setPairs] = useState<KeyValuePair[]>(() => toKeyValuePairs(Object.fromEntries((template?.variables ?? []).map((v) => [v.name, v.example]))));
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [inApp, setInApp] = useState(template?.inApp ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!template) return null;

  const data = fromKeyValuePairs(pairs);
  const draft: NotificationTemplate = { ...template, subject, body, inApp };
  const preview = renderEmail(draft, data);
  const dirty = subject !== template.subject || body !== template.body || inApp !== template.inApp;
  // Permission gate plus the tenant business rule that lists roles allowed to send template tests.
  const canTest = canSendTest && testRoles.includes(actor.roleId);

  async function sendTest() {
    const hook = await runHooks("operations.template.test.before", { templateId: id, data, actor });
    if (!hook.ok) return toast({ title: "Test blocked", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
    notify({ templateId: id, toUserIds: [actor.id], data: hook.ctx.data, href: "/operations/notifications" });
    useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action: "Sent template test to self", entityType: "NotificationTemplate", entityId: id, after: Object.keys(data).join(", ") });
    publish("operations.template.tested", { module: "operations", subject: { type: "NotificationTemplate", id, title: template!.name, href: "/operations/notifications" }, payload: { templateId: id } });
    toast({ title: "Test sent to you", description: "Check the bell and the Outbox tab.", tone: "success" });
  }

  async function submitChange() {
    setBusy(true);
    const res = await submitOperation("template.change", {
      title: `Template wording: ${template!.name}`,
      subject: { type: "NotificationTemplate", id, title: template!.name, href: "/operations/notifications" },
      payload: { id, subject, body, inApp },
      summary: [
        { label: "Template", value: `${template!.name} (${id})` },
        { label: "Subject", value: subject === template!.subject ? "unchanged" : `${template!.subject} → ${subject}` },
        { label: "HTML body", value: body === template!.body ? "unchanged" : "changed" },
        { label: "In-app text", value: inApp === template!.inApp ? "unchanged" : `${template!.inApp} → ${inApp}` },
        { label: "Reason", value: reason.trim() },
      ],
    });
    setBusy(false);
    if (!res.ok) return toast({ title: "Change not submitted", description: res.reason, tone: "danger" });
    toast({ title: res.applied ? "Template updated" : "Change submitted for approval", description: res.applied ? "Applied directly (workflow disabled)." : `Reference ${res.instance.id}`, tone: "success" });
    setReason("");
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} size="large" title={template.name} description={`${template.id} · trigger: ${template.trigger}`}>
      <Stack gap="large">
        {pending ? (
          <Alert
            tone="info"
            title="Change awaiting approval"
            action={
              <Button as={Link} href={`/operations/item?id=${pending.id}`} size="small" variant="tertiary">
                View request
              </Button>
            }
          >
            {pending.requestedBy.name} proposed new wording. Editing is locked until it&apos;s decided.
          </Alert>
        ) : null}
        <HtmlTemplatePreview html={preview.html} subject={preview.subject} to={`${actor.name} (test)`} from="Smart Enterprise Risk 360°" />
        <Card variant="filled" padding="small">
          <CardContent>
            <Text variant="eyebrow" tone="muted">
              In-app text
            </Text>
            <Text>{fill(inApp, data, false)}</Text>
          </CardContent>
        </Card>
        <Grid columns={{ base: 1, md: 2 }} gap="large">
          <Stack gap="small">
            <KeyValueEditor label="Example data" value={pairs} onChange={setPairs} keyLabel="Variable" valueLabel="Example value" addLabel="Add variable" />
            {canTest ? (
              <Button variant="secondary" iconBefore={<Send aria-hidden />} onClick={sendTest}>
                Send test to me
              </Button>
            ) : (
              <Text variant="small" tone="muted">
                Your role can&apos;t send template tests (business rule).
              </Text>
            )}
          </Stack>
          <Stack gap="small">
            <Text variant="eyebrow" tone="muted">
              Variables
            </Text>
            <TemplateVariableList variables={template.variables} onInsert={canEdit && !pending ? (token) => setBody((b) => `${b}${token}`) : undefined} />
          </Stack>
        </Grid>
        {canEdit && !pending ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Edit wording</CardTitle>
                <CardDescription>The preview above updates as you type. Saving submits a template change for approval.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <Field label="Subject" required>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </Field>
                <Field label="HTML body" description="Simple markup only: p, strong, ul / li. Variables as {{name}} (escaped).">
                  <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="font-code text-sm" />
                </Field>
                <Field label="In-app text" required>
                  <Textarea value={inApp} onChange={(e) => setInApp(e.target.value)} rows={2} />
                </Field>
                <Field label="Reason for change" description={`At least ${minComment} characters.`} required>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                </Field>
                <Stack direction="horizontal" gap="small" justify="end">
                  <Button
                    variant="tertiary"
                    disabled={!dirty}
                    onClick={() => {
                      setSubject(template.subject);
                      setBody(template.body);
                      setInApp(template.inApp);
                    }}
                  >
                    Discard edits
                  </Button>
                  <Button loading={busy} disabled={!dirty || !subject.trim() || !inApp.trim() || reason.trim().length < minComment} onClick={submitChange}>
                    Submit for approval
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </Drawer>
  );
}

function OutboxTab() {
  const outbox = useNotificationStore((s) => s.outbox);
  const canSeeAll = useCan("notifications.outbox.view");
  const canExport = useCan("notifications.outbox.export");
  const user = useSession((s) => s.user);
  const users = useUsers();
  const [open, setOpen] = useState<OutboxItem | null>(null);
  const email = users.find((u) => u.id === user?.id)?.email ?? user?.email ?? "";
  // User scope: approvers/admins see the whole outbox; everyone else only mail addressed to them.
  const rows = canSeeAll ? outbox : outbox.filter((o) => email && o.to.includes(`<${email}>`));
  const columns: DataTableColumn<OutboxItem>[] = [
    { id: "createdAt", header: "Queued", accessor: "createdAt", sortable: true, cell: (o) => <span className="font-mono text-sm">{dateTime(o.createdAt)}</span> },
    { id: "to", header: "To", accessor: "to", sortable: true },
    { id: "subject", header: "Subject", accessor: "subject", cell: (o) => <span className="font-semibold">{o.subject}</span> },
    { id: "templateId", header: "Template", accessor: "templateId", cell: (o) => <span className="font-mono text-sm">{o.templateId}</span> },
    { id: "status", header: "Status", accessor: "status", cell: (o) => <Badge tone={o.status === "Failed" ? "danger" : o.status === "Sent" ? "success" : "neutral"}>{o.status}</Badge> },
  ];
  return (
    <Stack gap="medium">
      <Text variant="small" tone="muted">
        {canSeeAll ? "All outgoing email for this tenant." : "Email addressed to you."} The prototype doesn&apos;t send email — items stay queued.
      </Text>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(o) => o.id}
        label="Email outbox"
        searchable
        searchPlaceholder="Search recipient or subject"
        filters={[
          { id: "template", label: "Template", columnId: "templateId" },
          { id: "status", label: "Status", columnId: "status" },
        ]}
        defaultSort={{ id: "createdAt", direction: "desc" }}
        onRowClick={(o) => setOpen(o)}
        exportFilename={canExport ? "outbox.csv" : undefined}
        exportLabel="Export CSV"
        emptyState={<EmptyState icon={<Mail aria-hidden />} title="Outbox is empty" description="Notifications sent by approvals, rule changes and tests appear here." />}
        mobileCard={(o) => (
          <Stack gap="xsmall">
            <span className="font-mono text-sm text-fg-muted">{dateTime(o.createdAt)}</span>
            <span className="font-semibold">{o.subject}</span>
            <span className="text-sm">{o.to}</span>
          </Stack>
        )}
      />
      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} size="large" title={open?.subject ?? "Email"} description={open ? `${open.status} · ${dateTime(open.createdAt)}` : undefined}>
        {open ? <HtmlTemplatePreview html={open.html} subject={open.subject} to={open.to} /> : null}
      </Drawer>
    </Stack>
  );
}

