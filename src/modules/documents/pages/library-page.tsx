"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Alert, Badge, Button, Card, CardContent, DataTable, FilterBar, Stack, documentStatusMeta, type DataTableColumn, type FilterBarFilter } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { dateTime } from "@/lib/format";
import { useCan } from "@/lib/iam/permissions";
import { listAttribute } from "@/modules/master-data/api";
import { currentVersion, documentsApi, subjectHref, versionStatus, type LibraryFilter, type StoredDocument } from "../api";
import { useDocumentVocabulary } from "../subject-documents";

const statusTone = { Active: "success", Deleted: "neutral", Purged: "neutral" } as const;

/** `/documents/library` — search every document the user may see (the backend filters by subject policy), with a CSV export. */
export function DocumentLibraryPage() {
  const router = useRouter();
  const canExport = useCan("documents.library.export");
  const vocab = useDocumentVocabulary();
  const [filter, setFilter] = useState<LibraryFilter>({});
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<StoredDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const effective = useMemo(() => ({ ...filter, q: search.trim() || undefined }), [filter, search]);
  // Loading while the rows on screen were fetched for other filters.
  const [loadedFor, setLoadedFor] = useState<LibraryFilter | null>(null);
  const loading = backendSsoEnabled && loadedFor !== effective;

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let live = true;
    // Text search runs on the server; wait for typing to settle.
    const t = window.setTimeout(() => {
      documentsApi
        .library(effective)
        .then((r) => live && (setRows(r), setError(null)))
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => live && setLoadedFor(effective));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [effective]);

  const subjectTypes = useMemo(() => [...new Set(vocab.types.flatMap((t) => listAttribute(t, "modules")))].sort(), [vocab.types]);
  const set = (patch: Partial<LibraryFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const filters: FilterBarFilter[] = [
    { id: "type", label: "Type", value: filter.type ?? "", onChange: (v) => set({ type: v || undefined }), options: vocab.types.map((t) => ({ value: t.code, label: t.label })) },
    { id: "subjectType", label: "Record type", value: filter.subjectType ?? "", onChange: (v) => set({ subjectType: v || undefined }), options: subjectTypes.map((t) => ({ value: t, label: t })) },
    {
      id: "status",
      label: "Status",
      value: filter.status ?? "",
      onChange: (v) => set({ status: (v || undefined) as LibraryFilter["status"] }),
      options: (["Active", "Deleted", "Purged"] as const).map((s) => ({ value: s, label: s })),
    },
    { type: "dateRange", id: "uploaded", label: "Uploaded", from: filter.from, to: filter.to, onChange: ({ from, to }) => set({ from, to }) },
  ];

  const columns: DataTableColumn<StoredDocument>[] = [
    { id: "title", header: "Document", accessor: "title", sortable: true, cell: (d) => <span className="font-semibold">{d.title}</span> },
    { id: "type", header: "Type", accessor: (d) => vocab.typeLabel(d.typeCode), sortable: true },
    { id: "subject", header: "Record", accessor: (d) => `${d.subjectType} ${d.subjectId}`, cell: (d) => <span className="font-mono text-xs">{`${d.subjectType} · ${d.subjectId}`}</span> },
    { id: "versions", header: "Versions", numeric: true, accessor: (d) => d.versions.length },
    {
      id: "review",
      header: "Review",
      accessor: (d) => {
        const v = currentVersion(d);
        return v ? documentStatusMeta[versionStatus(v)].label : "";
      },
    },
    {
      id: "status",
      header: "Status",
      accessor: "status",
      cell: (d) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={statusTone[d.status]}>{d.status}</Badge>
          {d.legalHold ? <Badge tone="warning">Legal hold</Badge> : null}
        </span>
      ),
    },
    { id: "updated", header: "Last change", accessor: "updatedAt", sortable: true, cell: (d) => dateTime(d.updatedAt) },
  ];

  const exportCsv = async () => {
    try {
      await documentsApi.exportLibrary(effective);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ModulePage module="documents" description="Every document on the platform you're allowed to see, with its record, type, review state and holds. Exports are recorded in the audit log.">
      <Stack gap="large">
        {!backendSsoEnabled ? <Alert tone="info">Documents are managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Card>
          <CardContent>
            <Stack gap="medium">
              <FilterBar
                search={{ value: search, onChange: setSearch, placeholder: "Search title or file name", label: "Search documents" }}
                filters={filters}
                onClearAll={() => {
                  setFilter({});
                  setSearch("");
                }}
                actions={
                  canExport ? (
                    <Button variant="tertiary" iconBefore={<Download aria-hidden />} onClick={() => void exportCsv()}>
                      Export CSV
                    </Button>
                  ) : undefined
                }
              />
              <DataTable
                columns={columns}
                data={rows}
                getRowId={(d) => d.id}
                label="Document library"
                loading={loading}
                onRowClick={(d) => router.push(subjectHref(d.subjectType, d.subjectId))}
                getRowHref={(d) => subjectHref(d.subjectType, d.subjectId)}
                linkComponent={Link}
              />
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </ModulePage>
  );
}
