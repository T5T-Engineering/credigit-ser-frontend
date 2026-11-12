"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  DescriptionList,
  Field,
  Grid,
  Input,
  Modal,
  SegmentedControl,
  Stack,
  StatCard,
  StatusBadge,
  Text,
  useToast,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { newId } from "@/lib/data/store";
import { useCan } from "@/lib/auth/session";
import { dateTime, money } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { cancelOperation, useOperationsStore } from "@/lib/platform/operations";
import { CalcRegister, sum, useActorName, useAuditLog, type CalcSpec, ms } from "../common";
import { cureData, cureParams, eclFor, eligibility, suspendedInterest, type CureData, type EclRow, type Eligibility } from "../data";
import { ModuleApprovals, operationHref, RulesPanel, useSubmitOperation } from "../governance";
import { StageBadge } from "../parts";
import { IFRS9_RULE_GROUPS } from "../platform";
import { useIfrs9, type Declassification } from "../store";
import { useEcl } from "../use-ecl";

type Candidate = EclRow & { cure: CureData; elig: Eligibility; eclTarget: number; interest: number };

const eligTones = { Eligible: "success", "In probation": "warning", "Not eligible": "neutral" } as const;
const decTones = { "Pending approval": "warning", Approved: "success", Rejected: "danger", Returned: "warning", Withdrawn: "neutral" } as const;

export function DeclassificationPage() {
  const { input, rows, rules } = useEcl();
  const canEdit = useCan("ifrs9", "edit");
  const actor = useActorName();
  const audit = useAuditLog();
  const { toast } = useToast();
  const submitOperation = useSubmitOperation();
  const params = useMemo(() => cureParams(), [rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const decls = useIfrs9((s) => s.declassifications);
  const addDecl = useIfrs9((s) => s.addDeclassification);
  const instances = useOperationsStore((s) => s.instances);
  const [proposal, setProposal] = useState<Candidate | null>(null);
  const [portion, setPortion] = useState(100);
  const [scope, setScope] = useState<"all" | "mine">("all");

  const cures = useMemo(() => cureData(rows), [rows]);
  const candidates: Candidate[] = useMemo(
    () =>
      rows
        .filter((r) => r.stage > 1)
        .map((r) => {
          const cure = cures.get(r.id)!;
          const elig = eligibility(r, cure, params);
          const eclTarget = elig.target ? eclFor(r.facility, input, elig.target).ecl : r.ecl;
          return { ...r, cure, elig, eclTarget, interest: suspendedInterest(r) };
        }),
    [rows, cures, params, input],
  );
  const pending = decls.filter((d) => d.status === "Pending approval");
  const pendingByFacility = new Map(pending.map((d) => [d.facilityId, d]));
  const decided = decls.filter((d) => d.status !== "Pending approval");
  const history = scope === "mine" ? decls.filter((d) => d.proposedById === actor.id) : decided;
  const eligible = candidates.filter((c) => c.elig.status === "Eligible");
  const writeBackApproved = sum(decided.filter((d) => d.status === "Approved").map((d) => (d.eclBefore - d.eclAfter) * d.performingPortion));

  const openProposal = (c: Candidate) => {
    setPortion(Math.round(c.cure.performingPortion * 100));
    setProposal(c);
  };

  /** The engine proposes; approval is routed to Operations (§6.4.4 approving officer). */
  const submit = async () => {
    if (!proposal || !proposal.elig.target) return;
    const share = portion / 100;
    const draft: Declassification = {
      id: newId("DCL"),
      facilityId: proposal.id,
      obligorName: proposal.obligor?.name ?? proposal.id,
      from: proposal.stage,
      to: proposal.elig.target,
      performingPortion: share,
      eclBefore: proposal.ecl,
      eclAfter: proposal.eclTarget,
      interestWriteBack: params.suspendedInterestPolicy === "On declassification" ? proposal.interest * share : 0,
      trigger: proposal.elig.reason,
      currentDpd: proposal.cure.currentDpd,
      proposedBy: `${actor.name} (${actor.role})`,
      proposedById: actor.id,
      proposedAt: new Date().toISOString(),
      status: "Pending approval",
    };
    const hook = await runHooks("ifrs9.declassification.propose.before", { declassification: draft });
    if (!hook.ok) {
      toast({ title: "Proposal blocked", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const d = hook.ctx.declassification;
    const writeBack = (d.eclBefore - d.eclAfter) * d.performingPortion;
    const res = await submitOperation<Declassification>("ifrs9.declassification", {
      title: `Declassify ${d.facilityId} (${d.obligorName}): Stage ${d.from} → ${d.to}`,
      subject: { type: "Declassification", id: d.id, title: `${d.facilityId} · ${d.obligorName}`, href: "/ifrs9/declassification" },
      payload: d,
      summary: [
        { label: "Facility", value: `${d.facilityId} · ${d.obligorName}` },
        { label: "Migration", value: `Stage ${d.from} → Stage ${d.to} (${portion}% performing)` },
        { label: "Trigger data", value: d.trigger },
        { label: "ECL before → after", value: `${money(d.eclBefore)} → ${money(d.eclAfter)}` },
        { label: "ECL write-back", value: money(writeBack) },
        { label: "Interest write-back", value: `${money(d.interestWriteBack)} (${params.suspendedInterestPolicy})` },
      ],
    });
    if (!res.ok) return;
    addDecl({ ...d, operationId: res.instance.id });
    audit("Proposed IFRS 9 declassification", "Facility", d.facilityId, `Stage ${d.from}`, `Stage ${d.to} (${portion}% performing) — Operations ${res.instance.id}`);
    publish("ifrs9.declassification.proposed", { module: "ifrs9", subject: { type: "Facility", id: d.facilityId, title: d.obligorName, href: "/ifrs9/declassification" }, payload: { declassificationId: d.id, from: d.from, to: d.to, operationId: res.instance.id } });
    await runHooks("ifrs9.declassification.propose.after", { declassification: d, operationId: res.instance.id });
    setProposal(null);
  };

  const withdraw = async (d: Declassification) => {
    if (!d.operationId) return;
    const res = await cancelOperation(d.operationId, "Withdrawn by the proposer");
    if (!res.ok) toast({ title: "Not withdrawn", description: res.reason, tone: "danger" });
  };

  const cols: DataTableColumn<Candidate>[] = [
    { id: "id", header: "Facility", accessor: "id", searchable: true, cell: (c) => <span className="font-mono text-sm whitespace-nowrap">{c.id}</span> },
    { id: "obligor", header: "Obligor", accessor: (c) => c.obligor?.name ?? "—", searchable: true },
    {
      id: "path",
      header: "Path",
      accessor: (c) => (c.elig.target ? `Stage ${c.stage} → ${c.elig.target}` : `Stage ${c.stage}`),
      cell: (c) => (
        <Stack direction="horizontal" gap="xsmall" align="center">
          <StageBadge stage={c.stage} />
          {c.elig.target && (
            <>
              <span aria-hidden>→</span>
              <StageBadge stage={c.elig.target} />
            </>
          )}
        </Stack>
      ),
    },
    { id: "dpd", header: "DPD then → now", accessor: (c) => c.cure.currentDpd, numeric: true, cell: (c) => <span className="whitespace-nowrap">{`${c.facility.dpd} → ${c.cure.currentDpd}`}</span> },
    { id: "timely", header: "Timely periods", accessor: (c) => c.cure.consecutiveTimely, numeric: true, hidden: true },
    { id: "restructured", header: "Restructured", accessor: (c) => (c.facility.status === "Restructured" ? "Yes" : "No"), hidden: true },
    {
      id: "status",
      header: "Eligibility · trigger data",
      accessor: (c) => c.elig.status,
      cell: (c) => (
        <Stack gap="xsmall" align="start">
          <StatusBadge status={c.elig.status} tones={eligTones} />
          <Text variant="caption" tone="muted">
            {c.elig.reason}
          </Text>
        </Stack>
      ),
    },
    { id: "reason", header: "Trigger data", accessor: (c) => c.elig.reason, hidden: true },
    {
      id: "release",
      header: "ECL release",
      accessor: (c) => c.ecl - c.eclTarget,
      numeric: true,
      cell: (c) => (c.elig.target ? ms((c.ecl - c.eclTarget) * c.cure.performingPortion) : "—"),
    },
    {
      id: "action",
      header: "",
      exportable: false,
      cell: (c) => {
        const p = pendingByFacility.get(c.id);
        if (p)
          return (
            <Button as={Link} href={p.operationId ? operationHref(p.operationId) : "/ifrs9/declassification"} size="small" variant="text">
              <Badge tone="warning">Awaiting approval</Badge>
            </Button>
          );
        return canEdit && c.elig.status === "Eligible" ? (
          <Button size="small" variant="secondary" onClick={() => openProposal(c)}>
            Propose
          </Button>
        ) : null;
      },
    },
  ];

  const specs: CalcSpec[] = [
    {
      metric: "ECL write-back",
      formula: "(ECL at origin stage basis − ECL at destination stage basis) × performing portion",
      sources: "Same PD/LGD/EAD inputs; destination basis 12-month or lifetime",
      value: ms(writeBackApproved),
      prd: "§6.7.5",
    },
    {
      metric: "Suspended-interest write-back",
      formula: "Interest suspended while in Stage 3 × performing portion, per policy",
      sources: `Business rule ifrs9.cure.suspendedInterestPolicy: ${params.suspendedInterestPolicy}`,
      prd: "§6.7.5",
    },
    {
      metric: "Stage 3 → 2",
      formula: `DPD < ${params.stage3DpdThreshold} and ≥ ${params.curePeriods} consecutive timely periods`,
      sources: "CBA repayment feed; business rules ifrs9.cure.*",
      prd: "§6.7.5",
    },
    { metric: "Stage 2 → 1", formula: `SICR reversed, sustained ${params.stage2Probation} months probation`, sources: "SICR triggers (Staging tab) in reverse", prd: "§6.7.5" },
    { metric: "Restructured", formula: `Minimum Stage 2 for ${params.restructuredProbation} months`, sources: "Facility status · forbearance flag", prd: "§6.7.5" },
  ];

  const opStep = (d: Declassification) => {
    const i = instances.find((x) => x.id === d.operationId);
    return i ? `${i.status} · ${i.id}` : "—";
  };

  return (
    <ModulePage module="ifrs9" description="Stage reversal as performance recovers: the engine proposes, the approving officer decides in Operations, and ECL is written back.">
      <Stack gap="large">
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Eligible for declassification" value={String(eligible.length)} hint={`of ${candidates.length} Stage 2/3 facilities`} tone="success" />
          <StatCard label="In probation" value={String(candidates.filter((c) => c.elig.status === "In probation").length)} tone="warning" hint="Cure / probation period running" />
          <StatCard label="Awaiting approval" value={String(pending.length)} hint="Routed through Operations" tone="info" />
          <StatCard label="ECL written back" value={ms(writeBackApproved)} hint="Credit to impairment charge (approved)" />
        </Grid>

        <RulesPanel
          title="Trigger parameters"
          description="Business rules (Rules & Parameters Engine). One engine governs both directions of migration; changes are approved in Operations before they apply."
          keys={IFRS9_RULE_GROUPS.cure}
          canRequest={canEdit}
        />

        {pending.length > 0 && (
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Awaiting approval</CardTitle>
                <CardDescription>Decided by the approving officer in Operations → Approvals. The proposer cannot approve their own proposal.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                {pending.map((d) => (
                  <Card key={d.id} variant="filled" padding="small">
                    <Stack gap="small">
                      <DescriptionList
                        columns={3}
                        items={[
                          { label: "Facility", value: `${d.facilityId} · ${d.obligorName}` },
                          { label: "Migration", value: `Stage ${d.from} → Stage ${d.to} (${Math.round(d.performingPortion * 100)}%)` },
                          { label: "ECL write-back", value: money((d.eclBefore - d.eclAfter) * d.performingPortion), mono: true },
                          { label: "Trigger data", value: d.trigger },
                          { label: "Proposed by", value: `${d.proposedBy}, ${dateTime(d.proposedAt)}` },
                          { label: "Workflow", value: opStep(d), mono: true },
                        ]}
                      />
                      <Stack direction="horizontal" gap="small" wrap>
                        {d.operationId && (
                          <Button as={Link} href={operationHref(d.operationId)} size="small">
                            Open approval
                          </Button>
                        )}
                        {d.proposedById === actor.id && (
                          <Button size="small" variant="tertiary" onClick={() => void withdraw(d)}>
                            Withdraw
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Cure monitoring — Stage 2 and 3 facilities</CardTitle>
              <CardDescription>Month-end staging DPD versus today&apos;s CBA repayment feed (simulated). Partial cures are supported.</CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Declassification candidates"
              columns={cols}
              data={candidates}
              getRowId={(c) => c.id}
              searchable
              filters={[
                { id: "status", label: "Eligibility", columnId: "status" },
                { id: "restructured", label: "Restructured", columnId: "restructured" },
              ]}
              defaultSort={{ id: "status", direction: "asc" }}
              exportFilename="ifrs9-declassification-candidates"
              mobileCard={(c) => (
                <Stack gap="xsmall">
                  <Stack direction="horizontal" justify="between" align="center">
                    <Text variant="small" className="font-semibold text-fg">
                      {c.obligor?.name}
                    </Text>
                    <StatusBadge status={c.elig.status} tones={eligTones} />
                  </Stack>
                  <Text variant="caption" tone="muted">
                    {c.id} · Stage {c.stage}
                    {c.elig.target ? ` → ${c.elig.target}` : ""} · {c.elig.reason}
                  </Text>
                  {canEdit && c.elig.status === "Eligible" && !pendingByFacility.has(c.id) && (
                    <div>
                      <Button size="small" variant="secondary" onClick={() => openProposal(c)}>
                        Propose
                      </Button>
                    </div>
                  )}
                </Stack>
              )}
            />
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Declassification history</CardTitle>
              <CardDescription>Original stage, trigger data, approver and resulting ECL and interest adjustment — reportable at facility and portfolio level.</CardDescription>
            </Stack>
            <SegmentedControl
              label="Show"
              size="small"
              value={scope}
              onChange={(v) => setScope(v as "all" | "mine")}
              options={[
                { value: "all", label: "All decisions" },
                { value: "mine", label: "My proposals" },
              ]}
            />
          </CardHeader>
          <CardContent>
            <DataTable
              label="Declassification history"
              data={history}
              getRowId={(d) => d.id}
              exportFilename="ifrs9-declassification-history"
              emptyState={<Text tone="muted">{scope === "mine" ? "You haven't proposed any declassifications yet." : "No decisions yet. Approved and rejected proposals appear here."}</Text>}
              columns={[
                { id: "at", header: "Decided", accessor: (d) => d.decidedAt ?? "", cell: (d) => (d.decidedAt ? dateTime(d.decidedAt) : "—") },
                { id: "fac", header: "Facility", accessor: "facilityId", cell: (d) => <span className="font-mono text-sm whitespace-nowrap">{d.facilityId}</span> },
                { id: "obl", header: "Obligor", accessor: "obligorName" },
                { id: "mig", header: "Migration", accessor: (d) => `Stage ${d.from} → ${d.to} (${Math.round(d.performingPortion * 100)}%)` },
                {
                  id: "wb",
                  header: "ECL write-back",
                  accessor: (d) => (d.eclBefore - d.eclAfter) * d.performingPortion,
                  numeric: true,
                  cell: (d) => (d.status === "Approved" ? ms((d.eclBefore - d.eclAfter) * d.performingPortion) : "—"),
                },
                { id: "by", header: "Approver", accessor: (d) => d.decidedBy ?? "" },
                { id: "status", header: "Outcome", accessor: "status", cell: (d) => <StatusBadge status={d.status} tones={decTones} /> },
                {
                  id: "op",
                  header: "Workflow",
                  exportable: false,
                  cell: (d) =>
                    d.operationId ? (
                      <Button as={Link} href={operationHref(d.operationId)} size="small" variant="text">
                        {d.operationId}
                      </Button>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </CardContent>
        </Card>

        <ModuleApprovals modules={["ifrs9"]} title="IFRS 9 approvals in Operations" limit={5} />

        <CalcRegister specs={specs} />
      </Stack>

      <Modal
        open={!!proposal}
        onOpenChange={(o) => !o && setProposal(null)}
        title="Propose declassification"
        description={proposal ? `${proposal.id} · ${proposal.obligor?.name ?? ""}` : undefined}
        footer={
          <Stack direction="horizontal" gap="small" justify="end">
            <Button variant="tertiary" onClick={() => setProposal(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={portion <= 0 || portion > 100}>
              Submit for approval
            </Button>
          </Stack>
        }
      >
        {proposal && proposal.elig.target && (
          <Stack gap="medium">
            <DescriptionList
              columns={2}
              items={[
                { label: "Migration", value: `Stage ${proposal.stage} → Stage ${proposal.elig.target}` },
                { label: "Trigger data", value: proposal.elig.reason },
                { label: "ECL now", value: money(proposal.ecl), mono: true, hint: proposal.basis },
                { label: "ECL at destination basis", value: money(proposal.eclTarget), mono: true, hint: proposal.elig.target === 1 ? "12-month" : "Lifetime" },
                { label: "ECL write-back", value: money((proposal.ecl - proposal.eclTarget) * (portion / 100)), mono: true },
                {
                  label: "Suspended interest",
                  value: money(proposal.interest * (portion / 100)),
                  mono: true,
                  hint: params.suspendedInterestPolicy === "On declassification" ? "Written back on approval" : "Written back as cash is received",
                },
              ]}
            />
            <Field label="Performing portion" description="Partial cure: only this share of the exposure migrates (proportionate write-back).">
              <Input type="number" min={1} max={100} suffix="%" value={portion} onChange={(e) => setPortion(Number(e.target.value))} />
            </Field>
            <Text variant="small" tone="muted">
              The proposal is routed to the approving officer through Operations. The stage, ECL and interest are written back only after approval.
            </Text>
          </Stack>
        )}
      </Modal>
    </ModulePage>
  );
}
