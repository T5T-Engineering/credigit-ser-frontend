"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ActivityFeed,
  AiInsightCard,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  SubmitButton,
  type DataTableColumn,
  DescriptionList,
  Drawer,
  Field,
  Grid,
  Modal,
  Stack,
  StatCard,
  StatusBadge,
  Text,
  Textarea,
  Input,
} from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { date, dateTime } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useActorName, useAuditLog } from "../common";
import { sourceMapping, type RiskModel } from "../data";
import { ModuleApprovals, operationHref, PendingNotice, useSubmitOperation } from "../governance";
import type { ModelApprovalPayload } from "../platform";
import { useIfrs9 } from "../store";

const statusTones = { Approved: "success", "Pending validation": "info", "Validation findings": "danger", "Pending approval": "warning", Retired: "neutral" } as const;

/** Next review date: last calibration + the model refresh interval (business rule, CBN 12.15). */
const nextReviewOf = (m: RiskModel, months: number) => {
  const d = new Date(m.lastCalibrated);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
};

export function Ifrs9ModelsPage() {
  const models = useIfrs9((s) => s.models);
  const changes = useIfrs9((s) => s.modelChanges);
  const setModelStatus = useIfrs9((s) => s.setModelStatus);
  const aiSignOff = useIfrs9((s) => s.aiSignOff);
  const signOffAi = useIfrs9((s) => s.signOffAi);
  const canSubmitModel = useCan("ifrs9.models.submit");
  const canReviewFinding = useCan("ifrs9.model-findings.review");
  const canExport = useCan("ifrs9.data.export");
  const actor = useActorName();
  const audit = useAuditLog();
  const { toast } = useSaveFeedback();
  const submitOperation = useSubmitOperation();
  const interval = useRule<number>("ifrs9.model.reviewIntervalMonths");
  const instances = useOperationsStore((s) => s.instances);
  const [open, setOpen] = useState<RiskModel | null>(null);
  const [submitFor, setSubmitFor] = useState<RiskModel | null>(null);
  const [change, setChange] = useState("");
  const [version, setVersion] = useState("");
  const [note, setNote] = useState("");

  const pendingOp = (m: RiskModel) => instances.find((i) => i.subject.type === "RiskModel" && i.subject.id === m.id && (i.status === "Pending" || i.status === "In progress"));
  const overdue = models.filter((m) => new Date(nextReviewOf(m, interval)) < DEMO_NOW && m.status !== "Retired");
  const mine = instances.filter((i) => i.operationType === "ifrs9.model.approval" && i.requestedBy.id === actor.id);
  const canSubmit = (m: RiskModel) => canSubmitModel && (m.status === "Approved" || m.status === "Validation findings") && !pendingOp(m);

  const startSubmit = (m: RiskModel) => {
    setSubmitFor(m);
    setVersion(m.version);
    setChange("");
    setNote("");
  };

  /** Model governance through Operations: independent validation (2nd line) → approval for production. */
  const confirm = async () => {
    const m = submitFor;
    if (!m) return;
    const payload: ModelApprovalPayload = { modelId: m.id, modelName: m.name, currentVersion: m.version, version: version.trim() || m.version, change: change.trim(), note: note.trim() || undefined };
    const hook = await runHooks("ifrs9.model.submit.before", { model: m, payload });
    if (!hook.ok) {
      toast({ title: "Submission blocked", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const p = hook.ctx.payload;
    const res = await submitOperation<ModelApprovalPayload>("ifrs9.model.approval", {
      title: `${m.name} v${p.version}: ${p.change}`,
      subject: { type: "RiskModel", id: m.id, title: m.name, href: "/ifrs9/models" },
      payload: p,
      summary: [
        { label: "Model", value: `${m.name} (${m.id})` },
        { label: "Version", value: p.version === m.version ? `v${m.version} (revalidation)` : `v${m.version} → v${p.version}` },
        { label: "Change", value: p.change },
        { label: "Performance", value: m.performance },
        ...(p.note ? [{ label: "Note", value: p.note }] : []),
      ],
    });
    if (!res.ok) return;
    setModelStatus(m.id, "Pending validation", { by: `${actor.name} (${actor.role})`, action: `Submitted v${p.version} for validation`, note: p.change });
    audit("Model governance: submitted for validation", "RiskModel", `${m.id} v${p.version}`, m.status, `Pending validation — Operations ${res.instance.id}`);
    publish("ifrs9.model.submitted", { module: "ifrs9", subject: { type: "RiskModel", id: m.id, title: m.name, href: "/ifrs9/models" }, payload: { version: p.version, operationId: res.instance.id } });
    await runHooks("ifrs9.model.submit.after", { model: m, payload: p, operationId: res.instance.id });
    setSubmitFor(null);
    setOpen(null);
  };

  const columns: DataTableColumn<RiskModel>[] = [
    { id: "name", header: "Model", accessor: "name", searchable: true, cell: (m) => <span className="font-semibold text-fg">{m.name}</span> },
    { id: "param", header: "Parameter", accessor: "parameter", cell: (m) => <Badge variant="outline">{m.parameter}</Badge> },
    { id: "segment", header: "Segment", accessor: "segment" },
    { id: "version", header: "Version", accessor: "version", cell: (m) => <span className="font-mono">v{m.version}</span> },
    { id: "calibrated", header: "Last calibrated", accessor: "lastCalibrated", cell: (m) => date(m.lastCalibrated) },
    {
      id: "review",
      header: "Next review",
      accessor: (m) => nextReviewOf(m, interval),
      cell: (m) => <span className={new Date(nextReviewOf(m, interval)) < DEMO_NOW ? "font-semibold text-danger-strong" : undefined}>{date(nextReviewOf(m, interval))}</span>,
    },
    { id: "perf", header: "Performance", accessor: "performance", cell: (m) => <span className="font-mono text-sm">{m.performance}</span> },
    { id: "status", header: "Status", accessor: "status", cell: (m) => <StatusBadge status={m.status} tones={statusTones} /> },
  ];

  return (
    <ModulePage module="ifrs9" description="PD / LGD / EAD model register, input source mapping and model-change governance.">
      <Stack gap="large">
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Models in register" value={String(models.length)} hint="PD, LGD, EAD, overlays, behavioural" />
          <StatCard label="Approved for production" value={String(models.filter((m) => m.status === "Approved").length)} tone="success" />
          <StatCard
            label="Awaiting validation / approval"
            value={String(models.filter((m) => m.status === "Pending validation" || m.status === "Pending approval").length)}
            tone="warning"
          />
          <StatCard label="Past review date" value={String(overdue.length)} hint={`Refresh every ${interval} months (CBN 12.15)`} tone={overdue.length ? "danger" : "success"} />
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Model register</CardTitle>
              <CardDescription>Select a model for its inputs, governance actions and change history.</CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Model register"
              columns={columns}
              data={models}
              getRowId={(m) => m.id}
              searchable
              paginate={false}
              onRowClick={(m) => setOpen(m)}
              filters={[
                { id: "param", label: "Parameter", columnId: "param" },
                { id: "status", label: "Status", columnId: "status" },
              ]}
              exportFilename={canExport ? "model-register" : undefined}
              mobileCard={(m) => (
                <Stack gap="xsmall">
                  <Stack direction="horizontal" justify="between" align="center">
                    <Text variant="small" className="font-semibold text-fg">
                      {m.name}
                    </Text>
                    <StatusBadge status={m.status} tones={statusTones} />
                  </Stack>
                  <Text variant="caption" tone="muted">
                    {m.parameter} · v{m.version} · next review {date(nextReviewOf(m, interval))}
                  </Text>
                </Stack>
              )}
            />
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Model inputs — source mapping</CardTitle>
              <CardDescription>Where each ECL input comes from in the Risk Data Spine.</CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Model input source mapping"
              columns={[
                { id: "input", header: "Model input", accessor: "input", cell: (r) => <span className="font-semibold text-fg">{r.input}</span>, width: "11rem" },
                { id: "source", header: "Source", accessor: "source" },
                { id: "connector", header: "Connector", accessor: "connector" },
                { id: "refresh", header: "Refresh", accessor: "refresh" },
              ]}
              data={sourceMapping}
              getRowId={(r) => r.input}
              paginate={false}
            />
          </CardContent>
        </Card>

        {mine.length > 0 && (
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>My model submissions</CardTitle>
                <CardDescription>Your submissions and where they are in the validation / approval workflow.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <DataTable
                label="My model submissions"
                data={mine}
                getRowId={(i) => i.id}
                paginate={false}
                columns={[
                  { id: "title", header: "Submission", accessor: "title" },
                  { id: "at", header: "Submitted", accessor: "requestedAt", cell: (i) => dateTime(i.requestedAt) },
                  { id: "status", header: "Status", accessor: "status" },
                  {
                    id: "open",
                    header: "",
                    exportable: false,
                    cell: (i) => (
                      <Button as={Link} href={operationHref(i.id)} size="small" variant="secondary">
                        Open
                      </Button>
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        )}

        <ModuleApprovals modules={["ifrs9"]} title="IFRS 9 approvals in Operations" limit={5} />

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-7">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Model change log</CardTitle>
                <CardDescription>Every version, validation and approval decision, retained for audit.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <ActivityFeed
                label="Model change log"
                items={changes.map((c) => ({
                  id: c.id,
                  actor: c.by,
                  action: c.action,
                  target: models.find((m) => m.id === c.modelId)?.name ?? c.modelId,
                  timestamp: c.at,
                  changes: c.from || c.to ? [{ field: "Status / version", before: c.from, after: c.to }] : undefined,
                  note: c.note,
                }))}
                formatTimestamp={(t) => dateTime(t)}
              />
            </CardContent>
          </Card>
          <div className="lg:col-span-5">
            <AiInsightCard
              kind="flagged"
              title="Unsecured LGD model under-predicting recent losses"
              model="Model monitoring co-pilot"
              generatedAt="10 Nov 2026, 06:00"
              confidence={0.78}
              paragraphs={[
                "Back-testing the Unsecured LGD model (v1.6) against the last 18 months of Loan Review work-out data shows realised LGD averaging 11.2 percentage points above prediction.",
              ]}
              bullets={[
                "Gap is concentrated in General commerce and Oil & gas — downstream SME facilities.",
                "Recovery sample is dominated by cases older than 3 years (pre-2023 FX regime).",
                "Suggested action: recalibrate on post-2023 work-outs and add a sector overlay pending recalibration.",
              ]}
              sources={[{ label: "Loan Review work-out register" }, { label: "Collateral register — realised recoveries" }, { label: "MDL-LGD-UNS validation report" }]}
              signedOffBy={aiSignOff["lgd-drift"]}
              onAccept={
                canReviewFinding
                  ? () => {
                      const by = `${actor.name}, ${dateTime(new Date())}`;
                      signOffAi("lgd-drift", `Accepted by ${by}`);
                      audit("Signed off AI-flagged model finding", "RiskModel", "MDL-LGD-UNS", "AI-flagged", "Accepted — recalibration scheduled");
                      publish("ifrs9.ai-finding.reviewed", { module: "ifrs9", subject: { type: "RiskModel", id: "MDL-LGD-UNS", href: "/ifrs9/models" }, payload: { finding: "lgd-drift", outcome: "accepted" } });
                    }
                  : undefined
              }
              onDismiss={
                canReviewFinding
                  ? () => {
                      signOffAi("lgd-drift", `Dismissed by ${actor.name}, ${dateTime(new Date())}`);
                      audit("Dismissed AI-flagged model finding", "RiskModel", "MDL-LGD-UNS", "AI-flagged", "Dismissed");
                      publish("ifrs9.ai-finding.reviewed", { module: "ifrs9", subject: { type: "RiskModel", id: "MDL-LGD-UNS", href: "/ifrs9/models" }, payload: { finding: "lgd-drift", outcome: "dismissed" } });
                    }
                  : undefined
              }
            />
          </div>
        </Grid>
      </Stack>

      <Drawer
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.name ?? ""}
        description={open ? `${open.id} · v${open.version}` : undefined}
        size="large"
        footer={
          open && canSubmit(open) ? (
            <Stack direction="horizontal" gap="small" wrap>
              <SubmitButton onClick={() => startSubmit(open)}>Submit for validation &amp; approval</SubmitButton>
            </Stack>
          ) : undefined
        }
      >
        {open && (
          <Stack gap="large">
            <DescriptionList
              columns={2}
              items={[
                { label: "Status", status: open.status, statusTones: statusTones },
                { label: "Parameter", value: open.parameter },
                { label: "Segment", value: open.segment, span: 2 },
                { label: "Method", value: open.method, span: 2 },
                { label: "Inputs", value: open.inputs, span: 2 },
                { label: "Performance", value: open.performance, mono: true },
                { label: "Owner", value: open.owner },
                { label: "Last calibrated", value: date(open.lastCalibrated) },
                { label: "Next review", value: date(nextReviewOf(open, interval)), hint: `Last calibrated + ${interval} months` },
              ]}
            />
            <PendingNotice subjectType="RiskModel" subjectId={open.id} />
            <Text variant="small" tone="muted">
              Governance: the model owner submits a version; independent validation (2nd line) and approval for production are decided in Operations by the configured approvers. The
              submitter can never decide their own submission.
            </Text>
            <ActivityFeed
              label="History"
              groupByDay={false}
              items={changes
                .filter((c) => c.modelId === open.id)
                .map((c) => ({
                  id: c.id,
                  actor: c.by,
                  action: c.action,
                  timestamp: c.at,
                  note: c.note,
                  changes: c.from || c.to ? [{ field: "Status / version", before: c.from, after: c.to }] : undefined,
                }))}
              formatTimestamp={(t) => dateTime(t)}
              emptyMessage="No changes recorded yet."
            />
          </Stack>
        )}
      </Drawer>

      <Modal
        open={!!submitFor}
        onOpenChange={(o) => !o && setSubmitFor(null)}
        title="Submit for validation & approval"
        description={submitFor ? `${submitFor.name} · current v${submitFor.version} (${submitFor.status})` : undefined}
        footer={
          <Stack direction="horizontal" gap="small" justify="end">
            <Button variant="tertiary" onClick={() => setSubmitFor(null)}>
              Cancel
            </Button>
            <SubmitButton onClick={() => void confirm()} disabled={change.trim().length < 5}>
              Submit to Operations
            </SubmitButton>
          </Stack>
        }
      >
        <Stack gap="medium">
          <Field label="Change" required description="What changed (recalibration, new segment, remediation of findings).">
            <Input value={change} onChange={(e) => setChange(e.target.value)} />
          </Field>
          <Field label="Version" description="Leave unchanged for a revalidation of the current version.">
            <Input value={version} onChange={(e) => setVersion(e.target.value)} />
          </Field>
          <Field label="Note" optional description="Recorded in the model change log and the audit trail.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </Field>
        </Stack>
      </Modal>
    </ModulePage>
  );
}
