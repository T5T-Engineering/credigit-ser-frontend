"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Workflow } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FilterBar,
  Modal,
  SectionHeader,
  Stack,
  SubmitButton,
  Switch,
  Textarea,
  WorkflowDiagram,
  WorkflowStepEditor,
  type WorkflowStep as UiWorkflowStep,
} from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { ModulePage } from "@/components/module-page";
import { allNavItems } from "@/lib/nav";
import { useCan } from "@/lib/iam/permissions";
import { definitionList, finalApproverEligible, submitOperation, usePendingFor, type WorkflowDefinition } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { fromUiSteps, roleOptions, stepApproverSummary, toUiSteps, useDefinitions } from "./logic";

const moduleLabel = (m: string) => allNavItems.find((n) => n.module === m)?.label ?? (m === "platform" ? "Platform" : m);

/** Operations → Workflows: every operation type's approval workflow; edits route through "workflow.change". */
export function WorkflowsPage() {
  useDefinitions();
  const defs = definitionList();
  const canEdit = useCan("operations.workflows.request-change");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null);

  const visible = defs.filter(
    (d) => (!moduleFilter || d.module === moduleFilter) && (!search || `${d.name} ${d.operationType} ${d.description}`.toLowerCase().includes(search.toLowerCase())),
  );
  const modules = [...new Set(defs.map((d) => d.module))];
  const groups = modules.filter((m) => visible.some((d) => d.module === m));

  return (
    <ModulePage module="operations" description="Approval workflows for every operation type: steps, approver roles, co-sign and adjudication, SLAs. Changes are themselves approved.">
      <Stack gap="large">
        <FilterBar
          label="Filter workflows"
          search={{ value: search, onChange: setSearch, placeholder: "Search operation types", label: "Search workflows" }}
          filters={[{ id: "module", label: "Module", value: moduleFilter, onChange: setModuleFilter, options: modules.map((m) => ({ value: m, label: moduleLabel(m), count: defs.filter((d) => d.module === m).length })) }]}
          onClearAll={() => {
            setSearch("");
            setModuleFilter("");
          }}
        />
        {groups.length === 0 ? (
          <EmptyState icon={<Workflow aria-hidden />} title="No workflows match" description="Clear the filters to see every operation type." />
        ) : (
          groups.map((m) => (
            <Stack key={m} gap="medium">
              <SectionHeader size="medium" title={moduleLabel(m)} description={`${visible.filter((d) => d.module === m).length} operation type(s)`} />
              {visible
                .filter((d) => d.module === m)
                .map((d) => (
                  <WorkflowCard key={d.operationType} def={d} canEdit={canEdit} onEdit={() => setEditing(d)} />
                ))}
            </Stack>
          ))
        )}
      </Stack>
      {editing ? <WorkflowEditor def={editing} onClose={() => setEditing(null)} /> : null}
    </ModulePage>
  );
}

function WorkflowCard({ def, canEdit, onEdit }: { def: WorkflowDefinition; canEdit: boolean; onEdit: () => void }) {
  const pending = usePendingFor("WorkflowDefinition", def.operationType);
  return (
    <Card id={def.operationType}>
      <CardHeader
        actions={
          canEdit ? (
            <Button size="small" variant="tertiary" iconBefore={<Pencil aria-hidden />} onClick={onEdit} disabled={!!pending}>
              Edit
            </Button>
          ) : undefined
        }
      >
        <div>
          <CardTitle>{def.name}</CardTitle>
          <CardDescription>{def.description}</CardDescription>
          <Stack direction="horizontal" gap="small" wrap className="mt-2">
            <Badge variant="outline">
              <span className="font-mono">{def.operationType}</span>
            </Badge>
            <Badge tone="neutral">v{def.version}</Badge>
            <Badge tone={def.enabled ? "success" : "warning"}>{def.enabled ? "Enabled" : "Disabled — applies without approval"}</Badge>
            <Badge tone="neutral">{def.steps.length} step(s)</Badge>
            {finalApproverEligible(def.operationType) && def.finalApproverAppliesDirectly !== false ? <Badge tone="info">Final approvers apply directly</Badge> : null}
          </Stack>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
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
              {pending.requestedBy.name} proposed a new version. Editing is locked until it&apos;s decided.
            </Alert>
          ) : null}
          {def.steps.length ? (
            <WorkflowDiagram steps={toUiSteps(def.steps)} roleOptions={roleOptions} label={`${def.name} workflow`} />
          ) : (
            <Alert tone="warning" title="No steps">
              Requests of this type apply immediately without approval.
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function WorkflowEditor({ def, onClose }: { def: WorkflowDefinition; onClose: () => void }) {
  const { toast } = useSaveFeedback();
  const defaultSla = useRule<number>("operations.defaultSlaHours");
  const minComment = useRule<number>("operations.minCommentLength");
  const [steps, setSteps] = useState<UiWorkflowStep[]>(() => toUiSteps(def.steps));
  const [enabled, setEnabled] = useState(def.enabled);
  const eligible = finalApproverEligible(def.operationType);
  const [direct, setDirect] = useState(def.finalApproverAppliesDirectly !== false);
  const [reason, setReason] = useState("");
  const [valid, setValid] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const next: WorkflowDefinition = { ...def, enabled, steps: fromUiSteps(steps), version: def.version + 1, ...(eligible ? { finalApproverAppliesDirectly: direct } : {}) };
    const res = await submitOperation<WorkflowDefinition>("workflow.change", {
      title: `${def.name} workflow: v${def.version} → v${next.version}`,
      subject: { type: "WorkflowDefinition", id: def.operationType, title: def.name, href: `/operations/workflows#${def.operationType}` },
      payload: next,
      summary: [
        { label: "Operation type", value: def.name },
        { label: "Current", value: `v${def.version} · ${def.enabled ? "enabled" : "disabled"} · ${stepApproverSummary(def.steps)}` },
        { label: "Proposed", value: `v${next.version} · ${enabled ? "enabled" : "disabled"} · ${stepApproverSummary(next.steps)}` },
        ...(eligible ? [{ label: "Final approvers apply directly", value: `${def.finalApproverAppliesDirectly !== false ? "Yes" : "No"} → ${direct ? "Yes" : "No"}` }] : []),
        { label: "Reason", value: reason.trim() },
      ],
    });
    setBusy(false);
    if (!res.ok) return toast({ title: "Change not submitted", description: res.reason, tone: "danger" });
    toast({ title: res.applied ? "Workflow updated" : "Change submitted for approval", description: res.applied ? (res.instance.reason ?? "Applied directly.") : `Reference ${res.instance.id}`, tone: "success" });
    onClose();
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      size="large"
      title={`Edit workflow — ${def.name}`}
      description={`Saving submits a workflow change (v${def.version} → v${def.version + 1}) for approval. Nothing changes until it's approved.`}
      footer={
        <Stack direction="horizontal" gap="small" justify="end">
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton loading={busy} disabled={!valid || reason.trim().length < minComment} onClick={submit}>
            Submit for approval
          </SubmitButton>
        </Stack>
      }
    >
      <Stack gap="large">
        <Switch checked={enabled} onCheckedChange={setEnabled} label="Workflow enabled (when off, requests apply without approval)" />
        {eligible ? (
          <Switch
            checked={direct}
            onCheckedChange={setDirect}
            label="Final approvers apply their own changes directly (holders of operations.requests.apply-directly skip the second approval; still recorded and audited)"
          />
        ) : null}
        <WorkflowStepEditor
          steps={steps}
          onChange={setSteps}
          roleOptions={roleOptions}
          showCondition={false}
          notifyOptions={[]}
          defaultSlaHours={defaultSla}
          onValidityChange={(v) => setValid(v)}
        />
        <Field label="Reason for change" description={`At least ${minComment} characters. Approvers see this.`} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      </Stack>
    </Modal>
  );
}
