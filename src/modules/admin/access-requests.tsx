"use client";

import Link from "next/link";
import { UserCheck } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, Stack, Text, TextLink } from "@credigit/web-ui";
import { useOperationsStore, type OperationInstance } from "@/lib/platform/operations";
import { ago } from "@/lib/format";
import { useMemo } from "react";
import type { ApiUser } from "@/lib/iam/api";
import { operationHref } from "./operation-ui";
import { roleName } from "./rule-keys";

type AccessPayload = { email: string; name: string; roleId: string };

/**
 * Self-registered people waiting for access (PRD §4: admin-controlled named users). Access requests are
 * "access.request" operations: they're approved or rejected — and the role confirmed — in Operations, not here.
 */
export function AccessRequests({ canEdit, apiRequests }: { canEdit: boolean; /** API mode: `GET /identity/access-requests`. */ apiRequests?: ApiUser[] }) {
  const instances = useOperationsStore((s) => s.instances);
  const pending = useMemo(() => instances.filter((i) => i.operationType === "access.request" && (i.status === "Pending" || i.status === "In progress")), [instances]);
  if (apiRequests) return <ApiAccessRequests requests={apiRequests} />;
  if (pending.length === 0) return null;

  const payload = (i: OperationInstance) => i.payload as AccessPayload;
  const fact = (i: OperationInstance, label: string) => i.summary.find((s) => s.label === label)?.value ?? "—";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <UserCheck aria-hidden className="size-5" /> Access requests <Badge tone="warning">{pending.length}</Badge>
            </span>
          </CardTitle>
          <CardDescription>People who registered and verified their email. A System Admin approves each request — and confirms the role — in Operations.</CardDescription>
        </div>
        <TextLink href="/operations" as={Link}>
          Operations → Approvals
        </TextLink>
      </CardHeader>
      <CardContent>
        <DataTable
          label="Access requests"
          data={pending}
          getRowId={(i) => i.id}
          paginate={false}
          columns={[
            {
              id: "name",
              header: "Name",
              accessor: (i) => payload(i).name,
              cell: (i) => (
                <Stack gap="none">
                  <Text variant="small" className="font-semibold">
                    {payload(i).name}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {payload(i).email}
                  </Text>
                </Stack>
              ),
            },
            { id: "institution", header: "Institution / branch", accessor: (i) => fact(i, "Institution / branch") },
            { id: "requested", header: "Requested role", accessor: (i) => roleName(payload(i).roleId) },
            { id: "when", header: "Requested", accessor: (i) => i.requestedAt, cell: (i) => ago(i.requestedAt) },
            {
              id: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "end",
              cell: (i) => (
                <Button size="small" variant={canEdit ? "primary" : "tertiary"} as={Link} href={operationHref(i.id)}>
                  {canEdit ? "Review in Operations" : "View request"}
                </Button>
              ),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

/** API mode list (newest first, as served). Decisions happen in Operations (`access.request`). */
function ApiAccessRequests({ requests }: { requests: ApiUser[] }) {
  if (requests.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <UserCheck aria-hidden className="size-5" /> Access requests <Badge tone="warning">{requests.length}</Badge>
          </span>
        </CardTitle>
        <CardDescription>Pending self-registrations. Approve or reject each one — and confirm the role — in Operations.</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          label="Access requests"
          data={requests}
          getRowId={(u) => u.id}
          paginate={false}
          columns={[
            { id: "name", header: "Name", accessor: (u) => u.name },
            { id: "email", header: "Email", accessor: (u) => u.email ?? "" },
            { id: "requested", header: "Requested role", accessor: (u) => (u.requestedRoleIds ?? u.roles).map(roleName).join(", ") },
            { id: "when", header: "Requested", accessor: (u) => u.createdAt ?? "", cell: (u) => (u.createdAt ? ago(u.createdAt) : "—") },
          ]}
        />
      </CardContent>
    </Card>
  );
}
