"use client";

import { Alert, Badge } from "@credigit/web-ui";

/** Shared notice on configuration pages (PRD §4.0, §10.4; IT Support view-only per §4.1 / §10.1). */
export function ConfigNotice({ canEdit, regulatory = false }: { canEdit: boolean; regulatory?: boolean }) {
  return canEdit ? (
    <Alert tone="info" title="Changes apply without a code release">
      Tenant configuration (PRD §4.0, §10.4). Only the System Admin can edit; every change is written to the audit log with its before and after value
      {regulatory ? ", and regulatory parameters need a second person to confirm before they take effect" : ""}. <Badge variant="outline">Prototype: stored in this browser</Badge>
    </Alert>
  ) : (
    <Alert tone="warning" title="View only">
      Your role can see this configuration but can&apos;t change it. Only the System Admin edits tenant configuration (PRD §10.4); your access is logged.
    </Alert>
  );
}
