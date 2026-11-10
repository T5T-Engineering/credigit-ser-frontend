"use client";

import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ChecklistPanel, DocumentList, Field, FileUpload, Grid, Select, Stack, useToast } from "@credigit/web-ui";
import { useDbActions, useLookups } from "@/lib/data/hooks";
import { newId } from "@/lib/data/store";
import type { DocumentRecord } from "@/lib/data/types";
import { toDocumentItem } from "../view-models";
import type { AppCtx } from "./context";

export const documentKinds: DocumentRecord["kind"][] = ["Audited financials", "Management accounts", "Bank statement", "KYC", "Board resolution", "Title document", "Valuation report", "Other"];

export function requiredKinds(obligorType: string): DocumentRecord["kind"][] {
  const base: DocumentRecord["kind"][] = ["Audited financials", "Bank statement", "KYC"];
  return obligorType === "Retail" ? base : [...base, "Board resolution"];
}

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
  const db = useDbActions();
  const { user } = useLookups();
  const ocr = useSimulatedOcr();
  const { toast } = useToast();
  const [kind, setKind] = useState<DocumentRecord["kind"]>("Management accounts");
  const [files, setFiles] = useState<File[]>([]);
  const canUpload = c.canEdit && (c.roleId === "account-officer" || c.roleId === "bdm" || c.roleId === "credit-analyst");
  const canVerify = c.canEdit && c.roleId === "credit-analyst";
  const required = requiredKinds(c.obligor.type);

  const add = (file: { name: string; size: number }, k: DocumentRecord["kind"], replaces?: DocumentRecord) => {
    const prior = c.docs.filter((d) => d.kind === k);
    const doc: DocumentRecord = {
      id: newId("DOC"),
      ownerType: "application",
      ownerId: c.app.id,
      name: replaces ? replaces.name : file.name,
      kind: k,
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
      version: replaces ? replaces.version + 1 : prior.length ? Math.max(...prior.map((d) => d.version)) + 1 : 1,
      uploadedById: c.me.id,
      uploadedAt: new Date().toISOString(),
      status: "Processing OCR",
    };
    db.upsert("documents", doc);
    c.change({ documentIds: [...c.app.documentIds, doc.id] }, replaces ? `Uploaded new version v${doc.version} of ${k}` : `Uploaded document (${k})`, replaces ? `v${replaces.version}` : undefined, `${doc.name} v${doc.version}`);
    ocr(doc.id);
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
                <CardDescription>Every re-upload is retained as a new version — never overwritten (PRD §5.4).</CardDescription>
              </div>
              {canVerify && unverified.length ? (
                <Button
                  variant="tertiary"
                  iconBefore={<BadgeCheck aria-hidden />}
                  onClick={() => {
                    unverified.forEach((d) => db.update("documents", d.id, { status: "Verified" }));
                    c.log(`Verified ${unverified.length} extracted document(s)`, "Extracted", "Verified");
                    toast({ title: "Documents verified", description: `${unverified.length} document(s) marked verified.`, tone: "success" });
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
                      if (d) add({ name: d.name, size: d.sizeKb * 1024 }, d.kind, d);
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
                <FileUpload accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tif" multiple maxSizeMb={25} files={files} onFilesChange={setFiles} />
                <div>
                  <Button
                    disabled={!files.length}
                    onClick={() => {
                      files.forEach((f) => add(f, kind));
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
