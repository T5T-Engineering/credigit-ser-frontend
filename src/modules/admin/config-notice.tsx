"use client";

import Link from "next/link";
import { Alert, TextLink } from "@credigit/web-ui";

/** Shared notice on configuration pages (PRD §4.0, §10.4; IT Support view-only per §4.1 / §10.1). */
export function ConfigNotice({ canEdit }: { canEdit: boolean; regulatory?: boolean }) {
  return canEdit ? (
    <Alert tone="info" title="Changes go through Operations">
      Tenant configuration applies without a code release, but every change is an approval request: a second person approves it in{" "}
      <TextLink href="/operations" as={Link}>
        Operations → Approvals
      </TextLink>{" "}
      before it takes effect. Requests, decisions and before/after values are written to the audit log.
    </Alert>
  ) : (
    <Alert tone="warning" title="View only">
      Your role can see this configuration but can&apos;t request changes. Only the System Admin edits tenant configuration; your access is logged.
    </Alert>
  );
}
