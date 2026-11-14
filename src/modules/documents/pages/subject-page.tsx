"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Stack, SubmitButton, TextLink } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { listAttribute, useMasterDataValues } from "@/modules/master-data/api";
import { subjectHref } from "../api";
import { SubjectDocuments } from "../subject-documents";

/** `/documents?subjectType&subjectId` — the documents of one record (backend link template `Documents:Links:SubjectPathTemplate`). */
export function DocumentsSubjectPage() {
  return (
    <Suspense>
      <Subject />
    </Suspense>
  );
}

function Subject() {
  const params = useSearchParams();
  const subjectType = params.get("subjectType") ?? "";
  const subjectId = params.get("subjectId") ?? "";
  const canLibrary = useCan("documents.library.view");
  const open = subjectType && subjectId;
  return (
    <ModulePage
      module="documents"
      title={open ? `${subjectType} ${subjectId}` : undefined}
      description={open ? "Documents of this record." : "Documents are stored once for the whole platform and always belong to a record — an application, a collateral item and so on."}
      actions={
        canLibrary ? (
          <Button variant="tertiary" href="/documents/library" as={Link}>
            Search the library
          </Button>
        ) : undefined
      }
    >
      {open ? <SubjectDocuments subjectType={subjectType} subjectId={subjectId} /> : <OpenSubject />}
    </ModulePage>
  );
}

/** Opens a record's documents by subject type (from the document types' `modules` attribute) and record id. */
function OpenSubject() {
  const router = useRouter();
  const types = useMasterDataValues("document-type").values;
  const subjectTypes = useMemo(() => [...new Set(types.flatMap((t) => listAttribute(t, "modules")))].sort(), [types]);
  const [picked, setSubjectType] = useState("");
  const subjectType = picked || subjectTypes[0] || "";
  const [subjectId, setSubjectId] = useState("");
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <div>
          <CardTitle>Open a record&apos;s documents</CardTitle>
          <CardDescription>
            Most people reach documents from the record itself. You can also open them here by record type and reference; you see them only when your role may see the record.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          <Field label="Record type" htmlFor="subject-type" required>
            <Select id="subject-type" value={subjectType} onChange={(e) => setSubjectType(e.target.value)} options={subjectTypes.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="Record reference" htmlFor="subject-id" required>
            <Input id="subject-id" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="font-mono" />
          </Field>
          <div>
            <SubmitButton onClick={() => subjectType && subjectId.trim() && router.push(subjectHref(subjectType, subjectId.trim()))}>Open documents</SubmitButton>
          </div>
          <TextLink href="/operations/requests" as={Link}>
            Track my deletion requests in Operations
          </TextLink>
        </Stack>
      </CardContent>
    </Card>
  );
}
