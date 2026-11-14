"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Plus } from "lucide-react";
import {
  ActivityFeed,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  Input,
  Modal,
  Select,
  Stack,
  SubmitButton,
  Switch,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { dateTime } from "@/lib/format";
import { useCan } from "@/lib/iam/permissions";
import { useRule } from "@/lib/platform/rules";
import { ConfigNotice } from "@/modules/admin/config-notice";
import { failed, SaveOutcomeModal, type SaveOutcome } from "@/modules/admin/save-outcome";
import { useAppliesOnSave } from "@/modules/admin/workflow-mode";
import { MASTER_DATA_CHANGE, masterDataApi, useMasterDataLists, useMasterDataValues, type AttributeDefinition, type ChangeAction, type MasterDataList, type MasterDataValue, type Snapshot } from "./api";

const changeWorkflow = [MASTER_DATA_CHANGE] as const;

/** Admin → Master data (backend ADR-0021): the tenant's code lists, changed through Operations `master-data.value.change`. */
export function MasterDataPage() {
  return (
    <Suspense>
      <MasterData />
    </Suspense>
  );
}

function MasterData() {
  const params = useSearchParams();
  const router = useRouter();
  const canChange = useCan("master-data.values.request-change");
  const canExport = useCan("master-data.lists.export");
  const { lists, error: listsError, reload: reloadLists } = useMasterDataLists();
  const listCode = params.get("list") ?? lists[0]?.code ?? null;
  const list = lists.find((l) => l.code === listCode);
  const [showRetired, setShowRetired] = useState(false);
  const { values, error, loading, reload } = useMasterDataValues(list?.code ?? null, { includeRetired: showRetired });
  const parentValues = useMasterDataValues(list?.parentList ?? null).values;
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [change, setChange] = useState<{ action: ChangeAction; value?: MasterDataValue } | null>(null);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const saves = useAppliesOnSave(changeWorkflow).has(MASTER_DATA_CHANGE);
  const open = values.find((v) => v.code === openCode);
  const parentLabel = useMemo(() => new Map(parentValues.map((v) => [v.code, v.label])), [parentValues]);

  const columns: DataTableColumn<MasterDataValue>[] = [
    { id: "code", header: "Code", accessor: "code", sortable: true, cell: (v) => <span className="font-mono text-xs">{v.code}</span> },
    { id: "label", header: "Label", accessor: "label", sortable: true, cell: (v) => <span className="font-semibold">{v.label}</span> },
    ...(list?.parentList ? [{ id: "parent", header: "Parent", accessor: (v: MasterDataValue) => (v.parent ? (parentLabel.get(v.parent) ?? v.parent) : "") } as DataTableColumn<MasterDataValue>] : []),
    ...(list?.attributes ?? []).map(
      (a): DataTableColumn<MasterDataValue> => ({ id: `attr-${a.key}`, header: a.label, accessor: (v) => v.attributes[a.key] ?? "", cell: (v) => <span className="text-sm">{v.attributes[a.key] || "—"}</span> }),
    ),
    { id: "sort", header: "Order", accessor: "sortOrder", numeric: true, sortable: true },
    { id: "status", header: "Status", accessor: (v) => (v.active ? "Active" : "Retired"), cell: (v) => <Badge tone={v.active ? "success" : "neutral"}>{v.active ? "Active" : "Retired"}</Badge> },
  ];

  const exportList = async () => {
    if (!list) return;
    setExportError(null);
    try {
      await masterDataApi.export(list.code);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ModulePage module="admin" description="Tenant code lists — document types, reasons, sectors, branches, product and collateral types and KYC lists. Every change is an Operations request and keeps a history.">
      <Stack gap="large">
        {!backendSsoEnabled ? <Alert tone="info">Master data is managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : <ConfigNotice canEdit={canChange} />}
        {listsError ? <Alert tone="danger">{listsError}</Alert> : null}
        {lists.length > 0 ? (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Field label="List" htmlFor="md-list">
                  <Select
                    id="md-list"
                    value={list?.code ?? ""}
                    onChange={(e) => {
                      setOpenCode(null);
                      router.replace(`/admin/master-data?list=${encodeURIComponent(e.target.value)}`, { scroll: false });
                    }}
                    options={lists.map((l) => ({ value: l.code, label: `${l.name} (${l.activeCount})` }))}
                  />
                </Field>
              </div>
              <Stack direction="horizontal" gap="small" align="center" wrap>
                <Switch label="Show retired" checked={showRetired} onCheckedChange={setShowRetired} />
                {canExport && list ? (
                  <Button variant="tertiary" iconBefore={<Download aria-hidden />} onClick={() => void exportList()}>
                    Export CSV
                  </Button>
                ) : null}
                {canChange && list?.tenantMayAdd ? (
                  <Button iconBefore={<Plus aria-hidden />} onClick={() => setChange({ action: "Add" })}>
                    Add value
                  </Button>
                ) : null}
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                {list ? (
                  <Text variant="small" tone="muted">
                    {list.description} Owner: {list.module}. {list.activeCount} active, {list.retiredCount} retired.
                    {list.tenantMayAdd ? "" : " Values are shipped with the platform; you can edit or retire them but not add new ones."}
                  </Text>
                ) : null}
                {exportError ? <Alert tone="danger">{exportError}</Alert> : null}
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <DataTable
                  columns={columns}
                  data={values}
                  getRowId={(v) => v.code}
                  label={list ? `${list.name} values` : "Values"}
                  searchable
                  searchPlaceholder="Search code or label"
                  loading={loading}
                  onRowClick={(v) => setOpenCode(v.code)}
                />
              </Stack>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
      {list && open ? (
        <ValueDrawer
          list={list}
          value={open}
          parentLabel={parentLabel}
          canChange={canChange}
          onClose={() => setOpenCode(null)}
          onChange={(action) => setChange({ action, value: open })}
        />
      ) : null}
      {list && change ? (
        <ChangeDialog
          list={list}
          action={change.action}
          value={change.value}
          parents={parentValues}
          saves={saves}
          onClose={() => setChange(null)}
          onDone={(o) => {
            setChange(null);
            setOutcome(o);
          }}
        />
      ) : null}
      <SaveOutcomeModal
        outcome={outcome}
        onClose={() => {
          setOutcome(null);
          // The values are a read model updated a moment after the change applies.
          reload();
          reloadLists();
        }}
      />
    </ModulePage>
  );
}

function snapshotText(s: Snapshot | null | undefined, field: string): string | undefined {
  if (!s) return undefined;
  if (field === "label") return s.label;
  if (field === "description") return s.description ?? "";
  if (field === "sortOrder") return String(s.sortOrder);
  if (field === "active") return s.active ? "Active" : "Retired";
  if (field === "parent") return s.parent ?? "";
  return s.attributes[field] ?? "";
}

function ValueDrawer({
  list,
  value,
  parentLabel,
  canChange,
  onClose,
  onChange,
}: {
  list: MasterDataList;
  value: MasterDataValue;
  parentLabel: Map<string, string>;
  canChange: boolean;
  onClose: () => void;
  onChange: (action: ChangeAction) => void;
}) {
  const fields = ["label", "description", "sortOrder", "active", "parent", ...list.attributes.map((a) => a.key)];
  const fieldLabel = (f: string) => list.attributes.find((a) => a.key === f)?.label ?? { label: "Label", description: "Description", sortOrder: "Order", active: "Status", parent: "Parent" }[f] ?? f;
  const history = [...value.history].reverse();
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      side="end"
      title={value.label}
      description={`${list.name} · ${value.code}`}
      footer={
        canChange ? (
          <>
            <Button variant="tertiary" onClick={() => onChange(value.active ? "Retire" : "Reactivate")}>
              {value.active ? "Retire" : "Reactivate"}
            </Button>
            {value.active ? <Button onClick={() => onChange("Update")}>Edit</Button> : null}
          </>
        ) : undefined
      }
    >
      <Stack gap="large">
        <DescriptionList
          columns={1}
          items={[
            { label: "Code", value: value.code, mono: true, copyValue: value.code },
            { label: "Label", value: value.label },
            { label: "Description", value: value.description ?? undefined },
            { label: "Order", value: String(value.sortOrder), mono: true },
            { label: "Status", value: value.active ? "Active" : "Retired" },
            ...(list.parentList ? [{ label: "Parent", value: value.parent ? (parentLabel.get(value.parent) ?? value.parent) : undefined }] : []),
            ...list.attributes.map((a) => ({ label: a.label, value: value.attributes[a.key] || undefined, hint: a.description ?? undefined })),
            { label: "Last changed", value: value.version > 0 ? dateTime(value.updatedAt) : "Shipped value, never changed" },
          ]}
        />
        <ActivityFeed
          label="History"
          emptyMessage="No changes yet."
          items={history.map((h, i) => ({
            id: `${h.at}-${i}`,
            actor: h.by.name,
            action: h.action === "Add" ? "added the value" : h.action === "Update" ? "updated the value" : h.action === "Retire" ? "retired the value" : "reactivated the value",
            timestamp: h.at,
            note: h.operationId ? `${h.reason} (request ${h.operationId})` : h.reason,
            changes: fields
              .map((f) => ({ field: fieldLabel(f), before: snapshotText(h.before, f), after: snapshotText(h.after, f) }))
              .filter((c) => c.before !== c.after),
          }))}
        />
      </Stack>
    </Drawer>
  );
}

const actionTitle: Record<ChangeAction, string> = { Add: "Add value", Update: "Edit value", Retire: "Retire value", Reactivate: "Reactivate value" };

function AttributeInput({ def, value, onChange }: { def: AttributeDefinition; value: string; onChange: (v: string) => void }) {
  const id = `md-attr-${def.key}`;
  return (
    <Field label={def.label} htmlFor={id} description={def.description ?? (def.type === "List" ? "Comma-separated" : undefined)} required={def.required}>
      {def.type === "Boolean" ? (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Not set" options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} />
      ) : (
        <Input id={id} inputMode={def.type === "Number" ? "decimal" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

function ChangeDialog({
  list,
  action,
  value,
  parents,
  saves,
  onClose,
  onDone,
}: {
  list: MasterDataList;
  action: ChangeAction;
  value?: MasterDataValue;
  parents: MasterDataValue[];
  saves: boolean;
  onClose: () => void;
  onDone: (o: SaveOutcome) => void;
}) {
  const minReason = useRule<number>("operations.minCommentLength");
  const editing = action === "Add" || action === "Update";
  const [code, setCode] = useState(value?.code ?? "");
  const [label, setLabel] = useState(value?.label ?? "");
  const [description, setDescription] = useState(value?.description ?? "");
  const [sortOrder, setSortOrder] = useState(value ? String(value.sortOrder) : "");
  const [parent, setParent] = useState(value?.parent ?? "");
  const [attributes, setAttributes] = useState<Record<string, string>>(value?.attributes ?? {});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (reason.trim().length < minReason) return setError(`Give a reason of at least ${minReason} characters.`);
    if (editing && sortOrder.trim() !== "" && !Number.isInteger(Number(sortOrder))) return setError("Order must be a whole number.");
    setBusy(true);
    try {
      const ack = await masterDataApi.requestChange(list.code, {
        action,
        code: code.trim(),
        reason: reason.trim(),
        ...(editing
          ? {
              label: label.trim(),
              description: description.trim(),
              sortOrder: sortOrder.trim() === "" ? undefined : Number(sortOrder),
              parent: parent || undefined,
              attributes: Object.fromEntries(Object.entries(attributes).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()])),
            }
          : {}),
      });
      onDone({
        ok: true,
        applied: ack.applied,
        operationId: ack.operationId ?? "",
        message: ack.applied ? `${list.name}: ${code.trim()} saved.` : `${list.name}: ${code.trim()} — the change applies once it's approved in Operations.`,
      });
    } catch (e) {
      onDone(failed(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${actionTitle[action]} — ${list.name}`}
      description={action === "Retire" ? "Retired values stay readable on existing records but are no longer offered. A value still named by a business rule can't be retired." : undefined}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton disabled={busy} onClick={() => void submit()}>
            {saves ? "Save" : "Request change"}
          </SubmitButton>
        </>
      }
    >
      <Stack gap="medium">
        {editing ? (
          <>
            <Field label="Code" htmlFor="md-code" description="Upper-case letters, digits, - or _. Stored on records; can't change later." required>
              <Input id="md-code" value={code} disabled={action !== "Add"} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" />
            </Field>
            <Field label="Label" htmlFor="md-label" required>
              <Input id="md-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="md-description">
              <Textarea id="md-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Order" htmlFor="md-sort" description="Lower numbers come first.">
              <Input id="md-sort" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </Field>
            {list.parentList ? (
              <Field label="Parent" htmlFor="md-parent" required>
                <Select id="md-parent" value={parent} onChange={(e) => setParent(e.target.value)} placeholder="Choose" options={parents.map((p) => ({ value: p.code, label: p.label }))} />
              </Field>
            ) : null}
            {list.attributes.map((a) => (
              <AttributeInput key={a.key} def={a} value={attributes[a.key] ?? ""} onChange={(v) => setAttributes((s) => ({ ...s, [a.key]: v }))} />
            ))}
          </>
        ) : (
          <Text>
            {value?.label} <span className="font-mono text-xs">({value?.code})</span>
          </Text>
        )}
        <Field label="Reason for the change" htmlFor="md-reason" required>
          <Textarea id="md-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </Stack>
    </Modal>
  );
}
