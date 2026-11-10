"use client";

import { useState } from "react";
import { UserCheck } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, Select, Stack, Text } from "@credigit/web-ui";
import { decideAccessRequest, usePendingAccessRequests } from "@/lib/auth/accounts";
import { roleById, roles, type RoleId } from "@/lib/rbac/roles";
import { ago } from "@/lib/format";

/** Self-registered users waiting for a System Admin to approve them and confirm their role (PRD §4: admin-controlled users). */
export function AccessRequests({ canEdit }: { canEdit: boolean }) {
  const pending = usePendingAccessRequests();
  const [roleFor, setRoleFor] = useState<Record<string, RoleId>>({});
  if (pending.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <UserCheck aria-hidden className="size-5" /> Access requests <Badge tone="warning">{pending.length}</Badge>
            </span>
          </CardTitle>
          <CardDescription>People who registered and verified their email. Approving creates a named user with the role you confirm.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          label="Access requests"
          data={pending}
          getRowId={(a) => a.email}
          columns={[
            { id: "name", header: "Name", accessor: (a) => a.name, cell: (a) => <Stack gap="none"><Text variant="small" className="font-semibold">{a.name}</Text><Text variant="caption" tone="muted">{a.email}</Text></Stack> },
            { id: "institution", header: "Institution / branch", accessor: (a) => `${a.institution ?? ""} · ${a.branch ?? ""}` },
            { id: "requested", header: "Requested role", accessor: (a) => (a.requestedRoleId ? roleById[a.requestedRoleId].name : "—") },
            {
              id: "role",
              header: "Approve as",
              cell: (a) => (
                <Select
                  size="small"
                  aria-label={`Role for ${a.name}`}
                  disabled={!canEdit}
                  value={roleFor[a.email] ?? a.requestedRoleId ?? "account-officer"}
                  onChange={(e) => setRoleFor((m) => ({ ...m, [a.email]: e.target.value as RoleId }))}
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                />
              ),
            },
            { id: "when", header: "Requested", accessor: (a) => ago(a.createdAt) },
            {
              id: "actions",
              header: "",
              align: "end",
              cell: (a) =>
                canEdit ? (
                  <div className="flex justify-end gap-2">
                    <Button size="small" onClick={() => decideAccessRequest(a.email, "approve", roleFor[a.email] ?? a.requestedRoleId)}>
                      Approve
                    </Button>
                    <Button size="small" variant="tertiary" onClick={() => decideAccessRequest(a.email, "reject")}>
                      Reject
                    </Button>
                  </div>
                ) : (
                  <Text variant="caption" tone="muted">System Admin only</Text>
                ),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}
