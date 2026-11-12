"use client";

import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ChecklistPanel, DocumentList, Field, FileUpload, Grid, Select, Stack, useToast } from "@credigit/web-ui";
import { useDbActions, useLookups } from "@/lib/data/hooks";
import { getRule } from "@/lib/platform/rules";
import type { DocumentRecord } from "@/lib/data/types";
import { toDocumentItem } from "../view-models";
import { uploadDocument, verifyDocuments } from "../actions";
import { inGroup, requiredKinds } from "../params";

export { requiredKinds };
import type { AppCtx } from "./context";

export const documentKinds: DocumentRecord["kind"][] = ["Audited financials", "Management accounts", "Bank statement", "KYC", "Board resolution", "Title document", "Valuation report", "Other"];

/** Simulate OCR on a document: Processing OCR → Extracted after a short delay. */
export function useSimulatedOcr() {
  const db = useDbActions();
  return (id: string, delay = 2200) => window.setTimeout(() => db.update("documents", id, { status: "Extracted" }), delay);
}

/** Simulated OCR service: documents left "Processing OCR" finish extraction a few seconds after the record is opened. */
export function useOcrCompletion(docs: DocumentRecord[]) {
  const db = useDbActions();
  const pending = docs.filter((d) => d.status === "Processing OCR").map((d) => d.id).join(",");
  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => pending.split(",").forEach((id) => db.update("documents", id, { status: "Extracted" })), 4000);
    return () => window.clearTimeout(t);
  }, [pending, db]);
}

export function DocumentsTab({ c }: { c: AppCtx }) {
  const { user } = useLookups();
  const ocr = useSimulatedOcr();
  const { toast } = useToast();
  const [kind, setKind] = useState<DocumentRecord["kind"]>("Management accounts");
  const [files, setFiles] = useState<File[]>([]);
  const canUpload = c.canEdit && inGroup("uploaders", c.roleId);
  const canVerify = c.canEdit && inGroup("analysts", c.roleId);
  const required = requiredKinds(c.obligor.type);

  const add = async (file: { name: string; size: number }, k: DocumentRecord["kind"], replaces?: DocumentRecord) => {
    const res = await uploadDocument(c.app.id, file, k, replaces);
    if (!res.ok) {
      toast({ title: "Upload blocked", description: res.reason, tone: "danger" });
      return false;
    }
    if (res.docId) ocr(res.docId);
    return true;
  };

  const unverified = c.docs.filter((d) => d.status === "Extracted");

  return (
    <Grid columns={{ base: 1, lg: 3 }} gap="large">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <Stack direction="horizontal" justify="between" align="start" wrap gap="medium">
              <div>
                <CardTitle>Application documents</CardTitle>
                <CardDescription>Every re-upload is retained as a new version — never overwritten.</CardDescription>
              </div>
              {canVerify && unverified.length ? (
                <Button
                  variant="tertiary"
                  iconBefore={<BadgeCheck aria-hidden />}
                  onClick={async () => {
                    const res = await verifyDocuments(c.app.id, unverified.map((d) => d.id));
                    toast(res.ok ? { title: "Documents verified", description: `${unverified.length} document(s) marked verified.`, tone: "success" } : { title: "Not verified", description: res.reason, tone: "danger" });
                  }}
                >
                  Verify {unverified.length} extracted
                </Button>
              ) : null}
            </Stack>
          </CardHeader>
          <CardContent>
            <DocumentList
              documents={[...c.docs].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map((d) => toDocumentItem(d, user))}
              onReplace={
                canUpload
                  ? (item) => {
                      const d = c.docs.find((x) => x.id === item.id);
                      if (d) void add({ name: d.name, size: d.sizeKb * 1024 }, d.kind, d).then((ok) => ok && toast({ title: "New version uploaded", description: `${d.name} v${d.version + 1} — the Credit Analyst is notified; earlier versions are kept.`, tone: "info" }));
                    }
                  : undefined
              }
              empty="No documents uploaded yet."
            />
          </CardContent>
        </Card>
      </div>
      <Stack gap="large">
        <ChecklistPanel
          title="Required documents"
          description={`For a ${c.obligor.type.toLowerCase()} obligor (tenant checklist).`}
          items={required.map((k) => {
            const docs = c.docs.filter((d) => d.kind === k);
            const best = docs.find((d) => d.status === "Verified") ?? docs.find((d) => d.status === "Extracted") ?? docs[0];
            return { id: k, title: k, status: best && (best.status === "Verified" || best.status === "Extracted") ? "met" : "pending", description: best ? `${best.status} · v${best.version}` : "Not uploaded", locked: true };
          })}
        />
        {canUpload ? (
          <Card>
            <CardHeader>
              <div><CardTitle>Upload</CardTitle>
              <CardDescription>PDF, Word or scanned image. OCR runs automatically.</CardDescription></div>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <Field label="Document type" htmlFor="doc-kind">
                  <Select id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentRecord["kind"])} options={documentKinds.map((k) => ({ value: k, label: k }))} />
                </Field>
                <FileUpload accept={getRule<string>("origination.docs.acceptedTypes")} multiple maxSizeMb={getRule<number>("origination.docs.maxUploadMb")} files={files} onFilesChange={setFiles} />
                <div>
                  <Button
                    disabled={!files.length}
                    onClick={async () => {
                      for (const f of files) await add(f, kind);
                      toast({ title: "Uploaded", description: `${files.length} file(s) sent for OCR extraction.`, tone: "info" });
                      setFiles([]);
                    }}
                  >
                    Upload {files.length ? `${files.length} file(s)` : ""}
                  </Button>
                </div>
              </Stack>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </Grid>
  );
}
