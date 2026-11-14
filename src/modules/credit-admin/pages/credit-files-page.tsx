"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileCheck2, FileWarning, FolderOpen, FolderX } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  ChecklistPanel,
  DataTable,
  DocumentList,
  Drawer,
  EmptyState,
  Grid,
  KeyValueGrid,
  ProgressBar,
  Stack,
  StatCard,
  Text,
  type ChecklistItem,
  type ChecklistPanelProps,
  type ChecklistStatus,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { useDocuments, useSectors, useUsers } from "@/lib/data/hooks";
import { date, moneyShort, pct } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { setCreditFileItem } from "../actions";
import { annexure1, useCreditFiles, type CreditFileRow } from "../credit-files";
import { useFacilityRows } from "../logic";
import { toDocumentItem } from "../view";

function band(r: CreditFileRow) {
  return r.defective > 0 ? "Defective items" : r.missing > 0 ? "Gaps" : "Complete";
}

export function CreditFilesPage() {
  const canExport = useCan("credit-admin.registers.export");
  const rows = useFacilityRows();
  const files = useCreditFiles(rows);
  const users = useUsers();
  const sectors = useSectors();
  const [selected, setSelected] = useState<string | null>(null);
  const current = files.find((f) => f.obligor.id === selected);

  const kpi = useMemo(() => {
    const items = files.reduce((s, f) => s + f.applicable, 0);
    const complete = files.reduce((s, f) => s + f.complete, 0);
    return {
      avg: items ? (complete / items) * 100 : 100,
      complete: files.filter((f) => band(f) === "Complete").length,
      gaps: files.filter((f) => band(f) !== "Complete").length,
      defective: files.reduce((s, f) => s + f.defective, 0),
    };
  }, [files]);

  const columns: DataTableColumn<CreditFileRow>[] = [
    {
      id: "obligor",
      header: "Obligor",
      accessor: (r) => r.obligor.name,
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <span className="font-semibold text-fg">{r.obligor.name}</span>
          <span className="font-mono text-xs text-fg-muted">{r.obligor.id}</span>
        </Stack>
      ),
    },
    { id: "type", header: "Type", accessor: (r) => r.obligor.type, sortable: true },
    { id: "sector", header: "Sector", accessor: (r) => sectors.find((s) => s.id === r.obligor.sectorId)?.name ?? "", hidden: true },
    { id: "rm", header: "Relationship manager", accessor: (r) => users.find((u) => u.id === r.obligor.relationshipManagerId)?.name ?? "" },
    { id: "facilities", header: "Facilities", accessor: (r) => r.facilities.length, numeric: true, sortable: true },
    { id: "exposure", header: "Approved exposure", accessor: "exposure", numeric: true, sortable: true, cell: (r) => moneyShort(r.exposure) },
    {
      id: "completeness",
      header: "Completeness",
      accessor: (r) => Math.round(r.completeness * 100),
      sortable: true,
      width: 160,
      cell: (r) => <ProgressBar value={r.completeness} size="small" showValue tone={r.defective ? "danger" : r.missing ? "warning" : "success"} ariaLabel={`Credit file completeness for ${r.obligor.name}`} />,
    },
    {
      id: "gaps",
      header: "Open items",
      accessor: (r) => r.missing + r.defective,
      numeric: true,
      sortable: true,
      cell: (r) =>
        r.missing + r.defective === 0 ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="inline-flex gap-1">
            {r.missing ? <Badge tone="warning">{r.missing} missing</Badge> : null}
            {r.defective ? <Badge tone="danger">{r.defective} defective</Badge> : null}
          </span>
        ),
    },
    { id: "band", header: "File status", accessor: band, hidden: true },
  ];

  return (
    <ModulePage module="credit-admin" description="Credit-file completeness per obligor against the CBN Annexure 1 minimum content.">
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Average completeness" value={pct(kpi.avg)} icon={<FolderOpen aria-hidden />} hint="Items on file ÷ applicable Annexure 1 items">
            <ProgressBar value={kpi.avg / 100} size="small" ariaLabel="Average completeness" />
          </StatCard>
          <StatCard label="Complete files" value={String(kpi.complete)} icon={<FileCheck2 aria-hidden />} tone="success" hint={`of ${files.length} obligors with live facilities`} />
          <StatCard label="Files with gaps" value={String(kpi.gaps)} icon={<FileWarning aria-hidden />} tone="warning" hint="Missing or defective items" />
          <StatCard label="Defective / expired items" value={String(kpi.defective)} icon={<FolderX aria-hidden />} tone="danger" hint="e.g. stale RAR, defective perfection, old call report" />
        </Grid>

        <DataTable
          label="Credit files"
          columns={columns}
          data={files}
          getRowId={(r) => r.obligor.id}
          onRowClick={(r) => setSelected(r.obligor.id)}
          searchable
          searchPlaceholder="Search obligor or RM…"
          filters={[
            { id: "band", label: "File status" },
            { id: "type", label: "Obligor type" },
            { id: "sector", label: "Sector" },
          ]}
          defaultSort={{ id: "completeness", direction: "asc" }}
          exportFilename={canExport ? "credit-file-completeness.csv" : undefined}
          emptyState={<EmptyState icon={<FolderOpen aria-hidden />} title="No credit files match" description="Adjust the filters to see credit files." />}
          mobileCard={(r) => (
            <Stack gap="small">
              <Text variant="small" className="font-semibold text-fg">
                {r.obligor.name}
              </Text>
              <ProgressBar value={r.completeness} size="small" showValue ariaLabel="Completeness" />
              <Text variant="caption" tone="muted">
                {r.missing} missing · {r.defective} defective · {r.facilities.length} facilities
              </Text>
            </Stack>
          )}
        />
      </Stack>

      {current ? <CreditFileDrawer file={current} onClose={() => setSelected(null)} /> : null}
    </ModulePage>
  );
}

function CreditFileDrawer({ file, onClose }: { file: CreditFileRow; onClose: () => void }) {
  const { actor } = useScope();
  const deskRoles = useRule<RoleId[]>("credit-admin.cpConfirmerRoles");
  const canEdit = useCan("credit-admin.credit-files.update") && deskRoles.includes(actor.roleId);
  const documents = useDocuments();
  const users = useUsers();
  const [error, setError] = useState<string | null>(null);
  const appIds = new Set(file.facilities.map((f) => f.app?.id).filter(Boolean));
  const docs = documents.filter((d) => d.ownerId === file.obligor.id || appIds.has(d.ownerId)).map((d) => toDocumentItem(d, users));

  const onToggle = (id: string, status: ChecklistStatus) => {
    const before = file.items.find((i) => i.id === id)?.status;
    void setCreditFileItem(file.obligor.id, id, before, status).then((r) => setError(r.ok ? null : r.reason));
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} size="large" title={`Credit file — ${file.obligor.name}`} description={`${file.obligor.type} · ${file.obligor.id} · CBN Annexure 1 minimum content`}>
      <Stack gap="large">
        {error ? (
          <Alert tone="danger" title="Not saved">
            {error}
          </Alert>
        ) : null}
        <KeyValueGrid
          columns={3}
          items={[
            { label: "Completeness", value: pct(file.completeness * 100), mono: true },
            { label: "Missing", value: String(file.missing), mono: true },
            { label: "Defective / expired", value: String(file.defective), mono: true },
          ]}
        />
        {!canEdit ? <Alert tone="info" title="View only">Only Credit Administration can update credit-file items.</Alert> : null}
        {annexure1.map((s) => {
          const items: ChecklistItem[] = file.items
            .filter((i) => i.section === s.id)
            .map((i) => ({
              id: i.id,
              title: i.title,
              description: i.note ? `${i.description} — ${i.note}` : i.description,
              status: i.status,
              dueDate: i.at ? `${i.byName} · ${date(i.at)}` : undefined,
              locked: !canEdit,
            }));
          return (
            <ChecklistPanel
              key={s.id}
              title={`${s.id}. ${s.title}`}
              items={items}
              labels={{ due: "Updated" }}
              // Library typing intersects the native <section> onToggle; cast to the checklist handler (library request).
              onToggle={(canEdit ? onToggle : undefined) as ChecklistPanelProps["onToggle"]}
            />
          );
        })}
        <Stack gap="small">
          <Text variant="eyebrow">Documents on file</Text>
          <DocumentList documents={docs} empty={<Text variant="small" tone="muted">No documents uploaded for this obligor yet.</Text>} />
        </Stack>
        <Stack gap="small">
          <Text variant="eyebrow">Facilities</Text>
          <Stack direction="horizontal" gap="small" wrap>
            {file.facilities.map((f) => (
              <Button key={f.facility.id} as={Link} href={`/credit-admin/facility/?id=${f.facility.id}`} size="small" variant="tertiary">
                {f.facility.id} · {f.facility.product}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Stack>
    </Drawer>
  );
}
