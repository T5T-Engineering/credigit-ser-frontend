"use client";

import Link from "next/link";
import { Alert, TextLink } from "@credigit/web-ui";
import { useIsFinalApprover } from "./workflow-mode";

/** Shared notice on configuration pages (PRD §4.0, §10.4; IT Support view-only per §4.1 / §10.1; final approvers per ADR-0018). */
export function ConfigNotice({ canEdit }: { canEdit: boolean; regulatory?: boolean }) {
  const finalApprover = useIsFinalApprover();
  if (canEdit && finalApprover) {
    return (
      <Alert tone="info" title="Your changes apply when you save">
        You are a final approver, so your own configuration changes apply at once without a second approval (unless a workflow is set to keep
        it). Each change is still recorded as an Operations request, and before/after values are written to the audit log.
      </Alert>
    );
  }
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
