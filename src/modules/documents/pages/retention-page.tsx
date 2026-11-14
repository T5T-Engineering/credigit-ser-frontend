"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, CardContent, DataTable, Field, Modal, Stack, SubmitButton, Textarea, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { date } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { failed, SaveOutcomeModal, type SaveOutcome } from "@/modules/admin/save-outcome";
import { documentsApi, type StoredDocument } from "../api";
import { useDocumentVocabulary } from "../subject-documents";

/** `/documents/retention` — documents past their retention date (not on hold); a purge is an Operations request (four-eyes). */
export function DocumentRetentionPage() {
  const vocab = useDocumentVocabulary();
  const minReason = useRule<number>("operations.minCommentLength");
  const [rows, setRows] = useState<StoredDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(backendSsoEnabled);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);

  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let live = true;
    documentsApi
      .retentionDue()
      .then((r) => live && (setRows(r), setError(null)))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [version]);

  const columns: DataTableColumn<StoredDocument>[] = [
    { id: "title", header: "Document", accessor: "title", sortable: true, cell: (d) => <span className="font-semibold">{d.title}</span> },
    { id: "type", header: "Type", accessor: (d) => vocab.typeLabel(d.typeCode), sortable: true },
    { id: "subject", header: "Record", accessor: (d) => `${d.subjectType} ${d.subjectId}`, cell: (d) => <span className="font-mono text-xs">{`${d.subjectType} · ${d.subjectId}`}</span> },
    { id: "versions", header: "Versions", numeric: true, accessor: (d) => d.versions.length },
    { id: "retain", header: "Retain until", accessor: "retainUntil", sortable: true, cell: (d) => date(d.retainUntil) },
    { id: "pending", header: "Request", accessor: (d) => (d.pendingOperationId ? "Waiting in Operations" : "") },
  ];

  const submit = async () => {
    if (reason.trim().length < minReason) return setReasonError(`Give a reason of at least ${minReason} characters.`);
    setBusy(true);
    try {
      const ack = await documentsApi.requestPurge(selected, reason.trim());
      setOutcome({
        ok: true,
        applied: ack.applied,
        operationId: ack.operationId ?? "",
        message: ack.applied ? `${selected.length} document(s) purged.` : `Purge of ${selected.length} document(s) goes to a second person in Operations; files are removed once approved.`,
      });
      setConfirm(false);
      setSelected([]);
      setReason("");
    } catch (e) {
      setOutcome(failed(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage module="documents" description="Documents whose retention period has ended and that are not on legal hold. Purging removes the files and keeps the record of what was held, by whom and why.">
      <Stack gap="large">
        {!backendSsoEnabled ? <Alert tone="info">Documents are managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Card>
          <CardContent>
            <DataTable
              columns={columns}
              data={rows}
              getRowId={(d) => d.id}
              label="Documents past retention"
              loading={loading}
              selectable
              selectedIds={selected}
              onSelectionChange={(ids) => setSelected(ids.map(String))}
              isRowSelectable={(d) => !d.pendingOperationId}
              bulkActions={(picked) => (
                <Button
                  size="small"
                  onClick={() => {
                    setReasonError(null);
                    setConfirm(true);
                  }}
                >
                  Request purge ({picked.length})
                </Button>
              )}
              emptyState={<span>No documents are past their retention date.</span>}
            />
          </CardContent>
        </Card>
      </Stack>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Request purge"
        description={`${selected.length} document(s). The files are removed after a second person approves in Operations.`}
        footer={
          <>
            <Button variant="tertiary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <SubmitButton disabled={busy} onClick={() => void submit()}>
              Request purge
            </SubmitButton>
          </>
        }
      >
        <Stack gap="medium">
          <Field label="Reason" htmlFor="purge-reason" required>
            <Textarea id="purge-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {reasonError ? <Alert tone="danger">{reasonError}</Alert> : null}
        </Stack>
      </Modal>
      <SaveOutcomeModal
        outcome={outcome}
        onClose={() => {
          setOutcome(null);
          load();
        }}
      />
    </ModulePage>
  );
}
