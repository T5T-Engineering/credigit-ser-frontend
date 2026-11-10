"use client";

import { useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, Field, Grid, Modal, Select, Stack, StatCard, StatusBadge, type DataTableColumn } from "@credigit/web-ui";
import { useCan } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, money } from "@/lib/format";
import { useAuditLog } from "../../operational-risk/shared";
import { policyStatus, type Circular, type Policy, type RegBreach } from "../data";
import { useErm } from "../store";

const circTones = { New: "accent", "Under assessment": "warning", "Linked to policy": "success", "No action required": "neutral" } as const;
const polTones = { Current: "success", "Due within 6 months": "warning", Overdue: "danger" } as const;
const breachTones = { Open: "danger", Remediating: "warning", Closed: "success" } as const;
const sevTones = { High: "danger", Medium: "warning", Low: "neutral" } as const;

export function RegulatorySection() {
  const canEdit = useCan("enterprise-risk", "edit");
  const circulars = useErm((s) => s.circulars);
  const policies = useErm((s) => s.policies);
  const breaches = useErm((s) => s.breaches);
  const { updateCircular, updatePolicy } = useErm.getState();
  const audit = useAuditLog();
  const [linking, setLinking] = useState<Circular | null>(null);
  const [policyId, setPolicyId] = useState("");

  const required = policies.filter((p) => p.required);
  const overdue = policies.filter((p) => policyStatus(p).label === "Overdue");

  const circCols: DataTableColumn<Circular>[] = [
    { id: "title", header: "Circular", accessor: "title", searchable: true, cell: (c) => <div><div className="font-medium text-fg">{c.title}</div><div className="font-mono text-xs text-fg-subtle">{c.ref} · {date(c.issuedAt)}</div></div> },
    { id: "area", header: "Area", accessor: "area", sortable: true },
    { id: "impact", header: "Impact", accessor: "impact", sortable: true, cell: (c) => <Badge tone={sevTones[c.impact]} variant="outline">{c.impact}</Badge> },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (c) => <div><StatusBadge status={c.status} tones={circTones} />{c.policyId && <div className="mt-1 text-xs text-fg-subtle">{policies.find((p) => p.id === c.policyId)?.name}</div>}</div> },
    {
      id: "act",
      header: "",
      exportable: false,
      cell: (c) =>
        canEdit && (c.status === "New" || c.status === "Under assessment") ? (
          <div className="flex justify-end gap-2">
            {c.status === "New" && <Button size="small" variant="tertiary" onClick={() => { updateCircular(c.id, { status: "Under assessment" }); audit("Started circular impact assessment", "CBN circular", c.ref, "New", "Under assessment"); }}>Assess</Button>}
            <Button size="small" variant="secondary" onClick={() => { setLinking(c); setPolicyId(""); }}>Link to policy</Button>
          </div>
        ) : null,
    },
  ];

  const polCols: DataTableColumn<Policy>[] = [
    { id: "name", header: "Policy", accessor: "name", cell: (p) => <div><div className="font-medium text-fg">{p.name}</div><div className="text-xs text-fg-subtle">{p.owner}{p.required ? " · 3-year review mandated" : ""}</div></div> },
    { id: "last", header: "Last reviewed", accessor: (p) => date(p.lastReviewed), sortValue: (p) => p.lastReviewed, sortable: true },
    { id: "due", header: "Review due", accessor: (p) => date(policyStatus(p).dueAt), sortValue: (p) => policyStatus(p).dueAt, sortable: true },
    { id: "status", header: "Currency", accessor: (p) => policyStatus(p).label, sortable: true, cell: (p) => <StatusBadge status={policyStatus(p).label} tones={polTones} /> },
    {
      id: "act",
      header: "",
      exportable: false,
      cell: (p) =>
        canEdit && policyStatus(p).label !== "Current" ? (
          <Button size="small" variant="tertiary" onClick={() => { updatePolicy(p.id, { lastReviewed: DEMO_NOW.toISOString() }); audit("Recorded policy review", "Policy", p.id, `Reviewed ${date(p.lastReviewed)}`, `Reviewed ${date(DEMO_NOW)}`); }}>Record review</Button>
        ) : null,
    },
  ];

  const brCols: DataTableColumn<RegBreach>[] = [
    { id: "description", header: "Breach", accessor: "description", cell: (b) => <div><div className="font-medium text-fg">{b.description}</div><div className="font-mono text-xs text-fg-subtle">{b.id} · {date(b.identifiedAt)}</div></div> },
    { id: "area", header: "Policy area", accessor: "area", sortable: true },
    { id: "by", header: "Identified by", accessor: "identifiedBy", sortable: true },
    { id: "severity", header: "Severity", accessor: "severity", cell: (b) => <Badge tone={sevTones[b.severity]} variant="outline">{b.severity}</Badge> },
    { id: "penalty", header: "Penalty", numeric: true, accessor: (b) => b.penalty ?? 0, cell: (b) => (b.penalty ? money(b.penalty) : "—") },
    { id: "status", header: "Status", accessor: "status", cell: (b) => <StatusBadge status={b.status} tones={breachTones} /> },
  ];

  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, sm: 3 }} gap="medium">
        <StatCard label="Circulars awaiting action" value={<span className="font-mono">{circulars.filter((c) => c.status === "New" || c.status === "Under assessment").length}</span>} hint="CBN circulars feed (§5.5) — simulated" tone="accent" />
        <StatCard label="Mandated policies current" value={<span className="font-mono">{required.filter((p) => policyStatus(p).label !== "Overdue").length}/{required.length}</span>} hint="Credit, project-finance, real-estate, SME, agriculture, retail — 3-year cycle" tone={overdue.some((p) => p.required) ? "danger" : "success"} />
        <StatCard label="Open regulatory breaches" value={<span className="font-mono">{breaches.filter((b) => b.status !== "Closed").length}</span>} hint="Feeds Operational Risk KRI-REG-01 and the loss-event register" tone="warning" />
      </Grid>
      <Card padding="none">
        <CardHeader className="px-6 pt-6"><CardTitle>Regulatory-update ingestion</CardTitle><CardDescription>New circulars are assessed and linked to the policy they affect</CardDescription></CardHeader>
        <CardContent className="p-2 sm:p-4"><DataTable label="CBN circulars" columns={circCols} data={circulars} getRowId={(c) => c.id} paginate={false} filters={[{ id: "status", label: "Status" }, { id: "impact", label: "Impact" }]} /></CardContent>
      </Card>
      <Grid columns={{ base: 1, xl: 2 }} gap="large">
        <Card padding="none">
          <CardHeader className="px-6 pt-6"><CardTitle>Policy-currency tracker</CardTitle><CardDescription>Evidence that policies are reviewed at least every 3 years (§6.10)</CardDescription></CardHeader>
          <CardContent className="p-2 sm:p-4"><DataTable label="Policy currency" columns={polCols} data={policies} getRowId={(p) => p.id} paginate={false} defaultSort={{ id: "due", direction: "asc" }} /></CardContent>
        </Card>
        <Card padding="none">
          <CardHeader className="px-6 pt-6"><CardTitle>Regulatory-breach register</CardTitle><CardDescription>Breaches by policy area — credit, prudential reporting, market conduct</CardDescription></CardHeader>
          <CardContent className="p-2 sm:p-4"><DataTable label="Regulatory breaches" columns={brCols} data={breaches} getRowId={(b) => b.id} paginate={false} /></CardContent>
        </Card>
      </Grid>

      <Modal
        open={!!linking}
        onOpenChange={(o) => !o && setLinking(null)}
        title="Link circular to policy"
        description={linking ? `${linking.ref} — ${linking.title}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onClick={() => setLinking(null)}>Cancel</Button>
            <Button
              disabled={!policyId}
              onClick={() => {
                updateCircular(linking!.id, { status: policyId === "none" ? "No action required" : "Linked to policy", policyId: policyId === "none" ? undefined : policyId });
                audit(policyId === "none" ? "Closed circular — no action required" : "Linked circular to policy", "CBN circular", linking!.ref, linking!.status, policyId === "none" ? "No action required" : policyId);
                setLinking(null);
              }}
            >
              Save
            </Button>
          </div>
        }
      >
        <Field label="Affected policy" htmlFor="circ-pol" required>
          <Select id="circ-pol" placeholder="Select" value={policyId} onChange={(e) => setPolicyId(e.target.value)} options={[...policies.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: "No policy change required" }]} />
        </Field>
      </Modal>
    </Stack>
  );
}
