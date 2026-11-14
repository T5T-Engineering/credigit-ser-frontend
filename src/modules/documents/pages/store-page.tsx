"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, DescriptionList, Stack } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import { documentsApi, type StoreStatus } from "../api";

/** `/documents/store` — the environment's active document store (Local directory / share or S3-compatible bucket) and its health. */
export function DocumentStorePage() {
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!backendSsoEnabled) return;
    let live = true;
    documentsApi
      .store()
      .then((s) => live && setStatus(s))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <ModulePage module="documents" description="Where this environment keeps document files. The store is set per environment in the backend settings; files written to an earlier store stay readable there.">
      <Stack gap="large">
        {!backendSsoEnabled ? <Alert tone="info">Documents are managed in the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {status ? (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Document store <Badge tone={status.healthy ? "success" : "danger"}>{status.healthy ? "Healthy" : "Unavailable"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                columns={1}
                items={[
                  { label: "Active store", value: status.active, mono: true },
                  { label: "Configured stores", value: status.configured.join(", "), mono: true },
                  { label: "Detail", value: status.detail ?? undefined },
                ]}
              />
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </ModulePage>
  );
}
