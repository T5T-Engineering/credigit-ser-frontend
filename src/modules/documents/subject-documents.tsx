"use client";

import { useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChecklistPanel,
  DataTable,
  DocumentList,
  Drawer,
  Field,
  FileUpload,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  SubmitButton,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { documentStatusMeta, formatFileSize } from "@credigit/web-ui";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { dateTime } from "@/lib/format";
import { useCan } from "@/lib/iam/permissions";
import { useRule } from "@/lib/platform/rules";
import { failed, SaveOutcomeModal, type SaveOutcome } from "@/modules/admin/save-outcome";
import { listAttribute, useMasterDataValues, type MasterDataValue } from "@/modules/master-data/api";
import { currentVersion, documentsApi, documentView, downloadable, liveVersions, versionStatus, type Checklist, type DocumentVersion, type StoredDocument } from "./api";

/** Master-data labels for document types and rejection reasons (codes shown when a value is unknown). */
export function useDocumentVocabulary() {
  const types = useMasterDataValues("document-type", { includeRetired: false }).values;
  const reasons = useMasterDataValues("document-rejection-reason").values;
  return useMemo(() => {
    const typeMap = new Map(types.map((t) => [t.code, t.label]));
    const reasonMap = new Map(reasons.map((r) => [r.code, r.label]));
    return { types, reasons, typeLabel: (c: string) => typeMap.get(c) ?? c, reasonLabel: (c: string) => reasonMap.get(c) ?? c };
  }, [types, reasons]);
}

type Dialog =
  | { kind: "upload" }
  | { kind: "version"; doc: StoredDocument }
  | { kind: "review"; doc: StoredDocument; version: DocumentVersion }
  | { kind: "delete"; doc: StoredDocument }
  | { kind: "hold"; doc: StoredDocument }
  | { kind: "history"; doc: StoredDocument };


/**
 * Documents of one subject (backend DMS): list, upload, new version, download, review, delete request, legal hold, version history and
 * the required-type checklist when `required` (document-type codes from the owning module's rule) is given.
 */
export function SubjectDocuments({ subjectType, subjectId, required, title = "Documents" }: { subjectType: string; subjectId: string; required?: string[]; title?: string }) {
  const canUpload = useCan("documents.documents.upload");
  const canVerify = useCan("documents.documents.verify");
  const canDelete = useCan("documents.documents.request-delete");
  const canHold = useCan("documents.documents.legal-hold");
  const vocab = useDocumentVocabulary();
  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const requiredKey = (required ?? []).join(",");

  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let live = true;
    Promise.all([
      documentsApi.forSubject(subjectType, subjectId),
      requiredKey ? documentsApi.checklist(subjectType, subjectId, requiredKey.split(",")) : Promise.resolve(null),
    ])
      .then(([list, check]) => {
        if (!live) return;
        setDocs(list);
        setChecklist(check);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [subjectType, subjectId, requiredKey, version]);

  const byId = new Map(docs.map((d) => [d.id, d]));
  const subjectTypes = vocab.types.filter((t) => listAttribute(t, "modules").includes(subjectType));
  const done = (o: SaveOutcome) => {
    setDialog(null);
    setOutcome(o);
  };
  const download = async (doc: StoredDocument, v: DocumentVersion) => {
    try {
      await documentsApi.download(doc.id, v);
    } catch (e) {
      setOutcome(failed(e));
    }
  };

  if (!backendSsoEnabled) return <Alert tone="info">Documents are managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert>;

  return (
    <Stack gap="large">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription>Every upload of the same document is kept as a new version — nothing is overwritten. Downloads are recorded in the audit log.</CardDescription>
          </div>
          {canUpload ? (
            <Button iconBefore={<Upload aria-hidden />} onClick={() => setDialog({ kind: "upload" })} disabled={subjectTypes.length === 0}>
              Upload
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <Stack gap="medium">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {canUpload && !loading && subjectTypes.length === 0 ? <Alert tone="warning">No document type in master data accepts {subjectType} documents.</Alert> : null}
            <DocumentList
              documents={docs.map((d) => documentView(d, vocab.typeLabel, vocab.reasonLabel))}
              empty={loading ? "Loading documents…" : "No documents yet."}
              onDownload={(item) => {
                const d = byId.get(item.id);
                const v = d && currentVersion(d);
                if (d && v && downloadable(v)) void download(d, v);
              }}
              onReplace={canUpload ? (item) => setDialog({ kind: "version", doc: byId.get(item.id)! }) : undefined}
              onDelete={
                canDelete
                  ? (item) => {
                      const d = byId.get(item.id)!;
                      if (d.pendingOperationId || d.legalHold) setOutcome({ ok: false, message: d.legalHold ? "This document is on legal hold, so it can't be deleted." : "A deletion request for this document is already waiting in Operations." });
                      else setDialog({ kind: "delete", doc: d });
                    }
                  : undefined
              }
              renderActions={(item) => {
                const d = byId.get(item.id);
                const v = d && currentVersion(d);
                if (!d) return null;
                return (
                  <>
                    {canVerify && v && v.verification === "Pending" && v.scan !== "Infected" ? (
                      <Button size="small" onClick={() => setDialog({ kind: "review", doc: d, version: v })}>
                        Review
                      </Button>
                    ) : null}
                    {canHold ? (
                      <Button size="small" variant="tertiary" onClick={() => setDialog({ kind: "hold", doc: d })}>
                        {d.legalHold ? "Lift hold" : "Legal hold"}
                      </Button>
                    ) : null}
                    <Button size="small" variant="tertiary" onClick={() => setDialog({ kind: "history", doc: d })}>
                      Versions
                    </Button>
                  </>
                );
              }}
            />
          </Stack>
        </CardContent>
      </Card>
      {checklist ? (
        <ChecklistPanel
          title="Required documents"
          description={checklist.complete ? "Every required document is present and verified." : "Required document types for this record."}
          items={checklist.items.map((i) => ({
            id: i.typeCode,
            title: i.typeLabel,
            status: i.verified ? "met" : "pending",
            description: i.verified ? "Verified" : i.present ? "Uploaded — awaiting verification" : "Not uploaded",
            locked: true,
          }))}
        />
      ) : null}
      {dialog?.kind === "upload" ? <UploadDialog subjectType={subjectType} subjectId={subjectId} types={subjectTypes} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === "version" ? <NewVersionDialog doc={dialog.doc} type={vocab.types.find((t) => t.code === dialog.doc.typeCode)} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === "review" ? <ReviewDialog doc={dialog.doc} version={dialog.version} reasons={vocab.reasons} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === "delete" ? <DeleteDialog doc={dialog.doc} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === "hold" ? <HoldDialog doc={dialog.doc} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === "history" ? (
        <VersionsDrawer doc={dialog.doc} typeLabel={vocab.typeLabel} reasonLabel={vocab.reasonLabel} onClose={() => setDialog(null)} onDownload={(v) => void download(dialog.doc, v)} />
      ) : null}
      <SaveOutcomeModal
        outcome={outcome}
        onClose={() => {
          setOutcome(null);
          // The list is a read model projected a moment after the change.
          load();
        }}
      />
    </Stack>
  );
}

/** File picker limits from the document type (master data), else rule `documents.maxUploadMb`. */
function useTypeLimits(type: MasterDataValue | undefined) {
  const fallbackMb = useRule<number>("documents.maxUploadMb");
  const maxSizeMb = Number(type?.attributes.maxSizeMb) || fallbackMb;
  const accept = type ? listAttribute(type, "acceptedTypes").join(",") : undefined;
  return { maxSizeMb, accept: accept || undefined };
}

function DialogFooter({ busy, label, onClose, onSubmit }: { busy: boolean; label: string; onClose: () => void; onSubmit: () => void }) {
  return (
    <>
      <Button variant="tertiary" onClick={onClose}>
        Cancel
      </Button>
      <SubmitButton disabled={busy} onClick={onSubmit}>
        {label}
      </SubmitButton>
    </>
  );
}

function useSubmit(onDone: (o: SaveOutcome) => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<SaveOutcome>) => {
    setBusy(true);
    try {
      onDone(await fn());
    } catch (e) {
      onDone(failed(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function UploadDialog({ subjectType, subjectId, types, onClose, onDone }: { subjectType: string; subjectId: string; types: MasterDataValue[]; onClose: () => void; onDone: (o: SaveOutcome) => void }) {
  const [typeCode, setTypeCode] = useState(types[0]?.code ?? "");
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const type = types.find((t) => t.code === typeCode);
  const limits = useTypeLimits(type);
  const { busy, run } = useSubmit(onDone);
  const submit = () => {
    const file = files[0];
    if (!file) return setError("Choose a file.");
    void run(async () => {
      const ack = await documentsApi.upload(subjectType, subjectId, typeCode, title.trim() || file.name, file);
      return { ok: true, applied: true, operationId: "", message: ack.scan === "Infected" ? "The file was stored but quarantined by the malware scan." : `${file.name} uploaded as version ${ack.version}.` };
    });
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Upload document" footer={<DialogFooter busy={busy} label="Upload" onClose={onClose} onSubmit={submit} />}>
      <Stack gap="medium">
        <Field label="Document type" htmlFor="doc-type" required>
          <Select id="doc-type" value={typeCode} onChange={(e) => setTypeCode(e.target.value)} options={types.map((t) => ({ value: t.code, label: t.label }))} />
        </Field>
        <Field label="Title" htmlFor="doc-title" description="Defaults to the file name.">
          <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <FileUpload accept={limits.accept} maxSizeMb={limits.maxSizeMb} files={files} onFilesChange={(f) => setFiles(f.slice(-1))} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </Stack>
    </Modal>
  );
}

function NewVersionDialog({ doc, type, onClose, onDone }: { doc: StoredDocument; type?: MasterDataValue; onClose: () => void; onDone: (o: SaveOutcome) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const limits = useTypeLimits(type);
  const { busy, run } = useSubmit(onDone);
  const submit = () => {
    const file = files[0];
    if (!file) return setError("Choose a file.");
    void run(async () => {
      const ack = await documentsApi.addVersion(doc.id, file);
      return { ok: true, applied: true, operationId: "", message: `${doc.title}: version ${ack.version} uploaded; earlier versions are kept.` };
    });
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Upload a new version" description={doc.title} footer={<DialogFooter busy={busy} label="Upload" onClose={onClose} onSubmit={submit} />}>
      <Stack gap="medium">
        <FileUpload accept={limits.accept} maxSizeMb={limits.maxSizeMb} files={files} onFilesChange={(f) => setFiles(f.slice(-1))} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </Stack>
    </Modal>
  );
}

function ReviewDialog({ doc, version, reasons, onClose, onDone }: { doc: StoredDocument; version: DocumentVersion; reasons: MasterDataValue[]; onClose: () => void; onDone: (o: SaveOutcome) => void }) {
  const [decision, setDecision] = useState<"verify" | "reject">("verify");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSubmit(onDone);
  const submit = () => {
    if (decision === "reject" && !reason) return setError("Choose a rejection reason.");
    void run(async () => {
      if (decision === "verify") await documentsApi.verify(doc.id, version.number, note.trim());
      else await documentsApi.reject(doc.id, version.number, reason, note.trim());
      return { ok: true, applied: true, operationId: "", message: `${doc.title} v${version.number} ${decision === "verify" ? "verified" : "rejected"}.` };
    });
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Review document"
      description={`${doc.title} · v${version.number} · ${version.fileName} (uploaded by ${version.uploadedBy.name})`}
      footer={<DialogFooter busy={busy} label={decision === "verify" ? "Verify" : "Reject"} onClose={onClose} onSubmit={submit} />}
    >
      <Stack gap="medium">
        <SegmentedControl
          label="Decision"
          value={decision}
          onChange={(v) => setDecision(v as "verify" | "reject")}
          options={[
            { value: "verify", label: "Verify" },
            { value: "reject", label: "Reject" },
          ]}
        />
        {decision === "reject" ? (
          <Field label="Rejection reason" htmlFor="doc-reject-reason" required>
            <Select id="doc-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Choose" options={reasons.map((r) => ({ value: r.code, label: r.label }))} />
          </Field>
        ) : null}
        <Field label="Note" htmlFor="doc-review-note">
          <Textarea id="doc-review-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </Stack>
    </Modal>
  );
}

function ReasonField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Reason" htmlFor={id} required>
      <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function DeleteDialog({ doc, onClose, onDone }: { doc: StoredDocument; onClose: () => void; onDone: (o: SaveOutcome) => void }) {
  const minReason = useRule<number>("operations.minCommentLength");
  const versions = liveVersions(doc);
  const [scope, setScope] = useState("all");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSubmit(onDone);
  const submit = () => {
    if (reason.trim().length < minReason) return setError(`Give a reason of at least ${minReason} characters.`);
    void run(async () => {
      const ack = await documentsApi.requestDelete(doc.id, scope === "all" ? null : Number(scope), reason.trim());
      return {
        ok: true,
        applied: ack.applied,
        operationId: ack.operationId ?? "",
        message: ack.applied ? `${doc.title} deleted.` : `Deletion of ${doc.title} goes to a second person in Operations; it applies once approved.`,
      };
    });
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Request deletion" description={`${doc.title}. Deleted files stay in the store until their retention ends.`} footer={<DialogFooter busy={busy} label="Request deletion" onClose={onClose} onSubmit={submit} />}>
      <Stack gap="medium">
        {versions.length > 1 ? (
          <Field label="Delete" htmlFor="doc-delete-scope">
            <Select id="doc-delete-scope" value={scope} onChange={(e) => setScope(e.target.value)} options={[{ value: "all", label: "The whole document" }, ...versions.map((v) => ({ value: String(v.number), label: `Version ${v.number} only (${v.fileName})` }))]} />
          </Field>
        ) : null}
        <ReasonField id="doc-delete-reason" value={reason} onChange={setReason} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </Stack>
    </Modal>
  );
}

function HoldDialog({ doc, onClose, onDone }: { doc: StoredDocument; onClose: () => void; onDone: (o: SaveOutcome) => void }) {
  const minReason = useRule<number>("operations.minCommentLength");
  const hold = !doc.legalHold;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSubmit(onDone);
  const submit = () => {
    if (reason.trim().length < minReason) return setError(`Give a reason of at least ${minReason} characters.`);
    void run(async () => {
      await documentsApi.legalHold(doc.id, hold, reason.trim());
      return { ok: true, applied: true, operationId: "", message: hold ? `${doc.title} is on legal hold: it can't be deleted or purged.` : `Legal hold lifted on ${doc.title}.` };
    });
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={hold ? "Place legal hold" : "Lift legal hold"}
      description={hold ? `${doc.title} can't be deleted or purged while on hold.` : `${doc.title} — held by ${doc.legalHoldBy?.by.name ?? "—"}: ${doc.legalHoldBy?.reason ?? ""}`}
      footer={<DialogFooter busy={busy} label={hold ? "Place hold" : "Lift hold"} onClose={onClose} onSubmit={submit} />}
    >
      <Stack gap="medium">
        <ReasonField id="doc-hold-reason" value={reason} onChange={setReason} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </Stack>
    </Modal>
  );
}

function VersionsDrawer({
  doc,
  typeLabel,
  reasonLabel,
  onClose,
  onDownload,
}: {
  doc: StoredDocument;
  typeLabel: (c: string) => string;
  reasonLabel: (c: string) => string;
  onClose: () => void;
  onDownload: (v: DocumentVersion) => void;
}) {
  const rows = [...doc.versions].reverse();
  const columns: DataTableColumn<DocumentVersion>[] = [
    { id: "n", header: "Version", accessor: "number", cell: (v) => <span className="font-mono">v{v.number}</span> },
    {
      id: "file",
      header: "File",
      accessor: "fileName",
      cell: (v) => (
        <span className="flex flex-col">
          <span className="font-semibold">{v.fileName}</span>
          <span className="font-mono text-xs text-fg-muted">
            {formatFileSize(v.sizeBytes)} · {v.uploadedBy.name}, {dateTime(v.uploadedAt)}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (v) => (
        <span className="flex flex-col gap-1">
          <Badge tone={v.deleted || v.purged ? "neutral" : documentStatusMeta[versionStatus(v)].tone}>
            {v.purged ? "Purged" : v.deleted ? "Deleted" : documentStatusMeta[versionStatus(v)].label}
          </Badge>
          {v.reviewedBy ? (
            <span className="text-xs text-fg-muted">
              {v.reviewedBy.name}
              {v.rejectionReason ? `: ${reasonLabel(v.rejectionReason)}` : ""}
              {v.reviewNote ? ` — ${v.reviewNote}` : ""}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "download",
      header: "",
      align: "end",
      cell: (v) =>
        downloadable(v) ? (
          <Button size="small" variant="tertiary" onClick={() => onDownload(v)} aria-label={`Download version ${v.number}`}>
            Download
          </Button>
        ) : null,
    },
  ];
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} side="end" title={doc.title} description={`${typeLabel(doc.typeCode)} · ${doc.versions.length} version(s) · kept until ${dateTime(doc.retainUntil)}`}>
      <DataTable columns={columns} data={rows} getRowId={(v) => String(v.number)} paginate={false} label="Versions" />
    </Drawer>
  );
}
