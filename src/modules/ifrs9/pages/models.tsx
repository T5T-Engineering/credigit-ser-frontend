"use client";

import { useState } from "react";
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
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { date, dateTime } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { APPROVING_ROLES, useActorName, useAuditLog } from "../common";
import { sourceMapping, type ModelStatus, type RiskModel } from "../data";
import { useIfrs9 } from "../store";

const statusTones = { Approved: "success", "Pending validation": "info", "Validation findings": "danger", "Pending approval": "warning", Retired: "neutral" } as const;

type Action = { model: RiskModel; to: ModelStatus; label: string };

export function Ifrs9ModelsPage() {
  const models = useIfrs9((s) => s.models);
  const changes = useIfrs9((s) => s.modelChanges);
  const setModelStatus = useIfrs9((s) => s.setModelStatus);
  const aiSignOff = useIfrs9((s) => s.aiSignOff);
  const signOffAi = useIfrs9((s) => s.signOffAi);
  const canEdit = useCan("ifrs9", "edit");
  const actor = useActorName();
  const isApprover = actor.roleId ? APPROVING_ROLES.includes(actor.roleId) : false;
  const audit = useAuditLog();
  const [open, setOpen] = useState<RiskModel | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");

  const overdue = models.filter((m) => new Date(m.nextReview) < DEMO_NOW && m.status !== "Retired");

  const actionsFor = (m: RiskModel): Action[] => {
    const out: Action[] = [];
    if (canEdit && (m.status === "Approved" || m.status === "Validation findings")) out.push({ model: m, to: "Pending validation", label: "Submit for validation" });
    if (canEdit && m.status === "Pending validation") out.push({ model: m, to: "Pending approval", label: "Record validation passed" });
    if (canEdit && m.status === "Pending validation") out.push({ model: m, to: "Validation findings", label: "Record findings" });
    if (isApprover && m.status === "Pending approval") out.push({ model: m, to: "Approved", label: "Approve for production" });
    return out;
  };

  const confirm = () => {
    if (!action) return;
    setModelStatus(action.model.id, action.to, { by: `${actor.name} (${actor.role})`, action: action.label, note: note || undefined });
    audit(`Model governance: ${action.label}`, "RiskModel", `${action.model.id} v${action.model.version}`, action.model.status, action.to);
    setAction(null);
    setNote("");
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
      accessor: "nextReview",
      cell: (m) => <span className={new Date(m.nextReview) < DEMO_NOW ? "font-semibold text-danger-strong" : undefined}>{date(m.nextReview)}</span>,
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
          <StatCard label="Past annual review" value={String(overdue.length)} hint="CBN 12.15: refresh at least annually" tone={overdue.length ? "danger" : "success"} />
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
              exportFilename="model-register"
              mobileCard={(m) => (
                <Stack gap="xsmall">
                  <Stack direction="horizontal" justify="between" align="center">
                    <Text variant="small" className="font-semibold text-fg">
                      {m.name}
                    </Text>
                    <StatusBadge status={m.status} tones={statusTones} />
                  </Stack>
                  <Text variant="caption" tone="muted">
                    {m.parameter} · v{m.version} · next review {date(m.nextReview)}
                  </Text>
                </Stack>
              )}
            />
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Model inputs — source mapping (§6.7.2)</CardTitle>
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

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-7">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Model change log</CardTitle>
                <CardDescription>Every version, validation and approval decision, retained for audit (§10.3).</CardDescription>
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
                canEdit
                  ? () => {
                      const by = `${actor.name}, ${dateTime(new Date())}`;
                      signOffAi("lgd-drift", `Accepted by ${by}`);
                      audit("Signed off AI-flagged model finding", "RiskModel", "MDL-LGD-UNS", "AI-flagged", "Accepted — recalibration scheduled");
                    }
                  : undefined
              }
              onDismiss={
                canEdit
                  ? () => {
                      signOffAi("lgd-drift", `Dismissed by ${actor.name}, ${dateTime(new Date())}`);
                      audit("Dismissed AI-flagged model finding", "RiskModel", "MDL-LGD-UNS", "AI-flagged", "Dismissed");
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
          open && actionsFor(open).length ? (
            <Stack direction="horizontal" gap="small" wrap>
              {actionsFor(open).map((a) => (
                <Button key={a.label} variant={a.to === "Validation findings" ? "tertiary" : "primary"} onClick={() => setAction(a)}>
                  {a.label}
                </Button>
              ))}
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
                { label: "Next review", value: date(open.nextReview) },
              ]}
            />
            <Text variant="small" tone="muted">
              Governance: the Predictive Analytics Officer submits and records validation; a tenant-configured approving officer (demo: CRO or Head of Risk) approves a version for
              production. Maker and approver must differ.
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
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.label ?? ""}
        description={action ? `${action.model.name} v${action.model.version}: ${action.model.status} → ${action.to}` : undefined}
        footer={
          <Stack direction="horizontal" gap="small" justify="end">
            <Button variant="tertiary" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={action?.to === "Validation findings" && note.trim().length < 5}>
              Confirm
            </Button>
          </Stack>
        }
      >
        <Field
          label="Note"
          description="Recorded in the model change log and the audit trail."
          optional={action?.to !== "Validation findings"}
          required={action?.to === "Validation findings"}
        >
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
      </Modal>
    </ModulePage>
  );
}
