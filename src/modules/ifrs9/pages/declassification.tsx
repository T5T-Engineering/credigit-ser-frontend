"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  DecisionPanel,
  DescriptionList,
  Field,
  Grid,
  Input,
  Modal,
  Select,
  Stack,
  StatCard,
  StatusBadge,
  Text,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { newId } from "@/lib/data/store";
import { useCan } from "@/lib/auth/session";
import { useDbActions } from "@/lib/data/hooks";
import type { CbnClass, Ifrs9Stage } from "@/lib/data/types";
import { dateTime, money } from "@/lib/format";
import { APPROVING_ROLES, CalcRegister, sum, useActorName, useAuditLog, type CalcSpec, ms } from "../common";
import { cureData, eclFor, eligibility, suspendedInterest, type CureData, type CureParams, type EclRow, type Eligibility } from "../data";
import { StageBadge } from "../parts";
import { useIfrs9, type Declassification } from "../store";
import { useEcl } from "../use-ecl";

type Candidate = EclRow & { cure: CureData; elig: Eligibility; eclTarget: number; interest: number };

const eligTones = { Eligible: "success", "In probation": "warning", "Not eligible": "neutral" } as const;
const decTones = { "Pending approval": "warning", Approved: "success", Rejected: "danger" } as const;

export function DeclassificationPage() {
  const { input, rows } = useEcl();
  const canEdit = useCan("ifrs9", "edit");
  const actor = useActorName();
  const isApprover = actor.roleId ? APPROVING_ROLES.includes(actor.roleId) : false;
  const audit = useAuditLog();
  const { update } = useDbActions();
  const params = useIfrs9((s) => s.cureParams);
  const setParams = useIfrs9((s) => s.setCureParams);
  const decls = useIfrs9((s) => s.declassifications);
  const addDecl = useIfrs9((s) => s.addDeclassification);
  const decide = useIfrs9((s) => s.decideDeclassification);
  const [proposal, setProposal] = useState<Candidate | null>(null);
  const [portion, setPortion] = useState(100);

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
  const pendingIds = new Set(decls.filter((d) => d.status === "Pending approval").map((d) => d.facilityId));
  const pending = decls.filter((d) => d.status === "Pending approval");
  const decided = decls.filter((d) => d.status !== "Pending approval");
  const eligible = candidates.filter((c) => c.elig.status === "Eligible");
  const writeBackApproved = sum(decided.filter((d) => d.status === "Approved").map((d) => (d.eclBefore - d.eclAfter) * d.performingPortion));

  const changeParam = <K extends keyof CureParams>(key: K, value: CureParams[K]) => {
    if (value === params[key] || (typeof value === "number" && !Number.isFinite(value))) return;
    audit("Changed declassification parameter", "Ifrs9CureParameter", String(key), String(params[key]), String(value));
    setParams({ ...params, [key]: value });
  };

  const openProposal = (c: Candidate) => {
    setPortion(Math.round(c.cure.performingPortion * 100));
    setProposal(c);
  };

  const submit = () => {
    if (!proposal || !proposal.elig.target) return;
    const share = portion / 100;
    const d: Declassification = {
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
      proposedBy: `${actor.name} (${actor.role})`,
      proposedAt: new Date().toISOString(),
      status: "Pending approval",
    };
    addDecl(d);
    audit("Proposed IFRS 9 declassification", "Facility", proposal.id, `Stage ${proposal.stage}`, `Stage ${d.to} (${portion}% performing) — pending approval`);
    setProposal(null);
  };

  const onDecide = (d: Declassification, decision: string, comment: string) => {
    const approved = decision === "approve";
    decide(d.id, { status: approved ? "Approved" : "Rejected", decidedBy: `${actor.name} (${actor.role})`, decidedAt: new Date().toISOString(), comment });
    if (approved && d.performingPortion >= 1) {
      const fac = rows.find((r) => r.id === d.facilityId)?.facility;
      const cure = cures.get(d.facilityId);
      const cbnClass: CbnClass = d.to === 1 ? "Performing" : "Watchlist";
      if (fac) update("facilities", fac.id, { stage: d.to as Ifrs9Stage, cbnClass, dpd: cure?.currentDpd ?? fac.dpd });
    }
    audit(
      approved ? "Approved IFRS 9 declassification" : "Rejected IFRS 9 declassification",
      "Facility",
      d.facilityId,
      `Stage ${d.from}, ECL ${money(d.eclBefore)}`,
      approved
        ? `Stage ${d.to} (${Math.round(d.performingPortion * 100)}%), ECL write-back ${money((d.eclBefore - d.eclAfter) * d.performingPortion)}, interest write-back ${money(d.interestWriteBack)}`
        : `Rejected: ${comment}`,
    );
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
      cell: (c) =>
        pendingIds.has(c.id) ? (
          <Badge tone="warning">Pending approval</Badge>
        ) : canEdit && c.elig.status === "Eligible" ? (
          <Button size="small" variant="secondary" onClick={() => openProposal(c)}>
            Propose
          </Button>
        ) : null,
    },
  ];

  const specs: CalcSpec[] = [
    {
      metric: "ECL write-back",
      formula: "(ECL at origin stage basis − ECL at destination stage basis) × performing portion",
      sources: "Same PD/LGD/EAD inputs (§6.7.2); destination basis 12-month or lifetime (§6.7.1)",
      value: ms(writeBackApproved),
      prd: "§6.7.5",
    },
    {
      metric: "Suspended-interest write-back",
      formula: "Interest suspended while in Stage 3 × performing portion, per policy",
      sources: `Tenant policy: ${params.suspendedInterestPolicy}`,
      prd: "§6.7.5",
    },
    {
      metric: "Stage 3 → 2",
      formula: `DPD < ${params.stage3DpdThreshold} and ≥ ${params.curePeriods} consecutive timely periods`,
      sources: "CBA repayment feed; Rules & Parameters Engine",
      prd: "§6.7.5",
    },
    { metric: "Stage 2 → 1", formula: `SICR reversed, sustained ${params.stage2Probation} months probation`, sources: "SICR triggers (Staging tab) in reverse", prd: "§6.7.5" },
    { metric: "Restructured", formula: `Minimum Stage 2 for ${params.restructuredProbation} months`, sources: "Facility status · forbearance flag", prd: "§6.7.5" },
  ];

  return (
    <ModulePage module="ifrs9" description="Stage reversal as performance recovers: the engine proposes, a human approves, and ECL is written back.">
      <Stack gap="large">
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Eligible for declassification" value={String(eligible.length)} hint={`of ${candidates.length} Stage 2/3 facilities`} tone="success" />
          <StatCard label="In probation" value={String(candidates.filter((c) => c.elig.status === "In probation").length)} tone="warning" hint="Cure / probation period running" />
          <StatCard label="Awaiting approval" value={String(pending.length)} hint="Routed via §6.4.4 escalation protocol" tone="info" />
          <StatCard label="ECL written back" value={ms(writeBackApproved)} hint="Credit to impairment charge (approved)" />
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Trigger parameters</CardTitle>
              <CardDescription>Tenant-configurable in the Rules &amp; Parameters Engine (demo defaults). One engine governs both directions of migration.</CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <Grid columns={{ base: 1, sm: 2, lg: 3, xl: 6 }} gap="medium">
              <Field label="Stage 3 → 2: DPD below">
                <Input
                  type="number"
                  suffix="days"
                  defaultValue={params.stage3DpdThreshold}
                  disabled={!canEdit}
                  onBlur={(e) => changeParam("stage3DpdThreshold", Number(e.target.value))}
                />
              </Field>
              <Field label="Cure period">
                <Input type="number" suffix="periods" defaultValue={params.curePeriods} disabled={!canEdit} onBlur={(e) => changeParam("curePeriods", Number(e.target.value))} />
              </Field>
              <Field label="Stage 2 → 1 probation">
                <Input
                  type="number"
                  suffix="months"
                  defaultValue={params.stage2Probation}
                  disabled={!canEdit}
                  onBlur={(e) => changeParam("stage2Probation", Number(e.target.value))}
                />
              </Field>
              <Field label="Restructured probation">
                <Input
                  type="number"
                  suffix="months"
                  defaultValue={params.restructuredProbation}
                  disabled={!canEdit}
                  onBlur={(e) => changeParam("restructuredProbation", Number(e.target.value))}
                />
              </Field>
              <Field label="Suspended-interest write-back">
                <Select
                  value={params.suspendedInterestPolicy}
                  disabled={!canEdit}
                  onChange={(e) => changeParam("suspendedInterestPolicy", e.target.value as CureParams["suspendedInterestPolicy"])}
                  options={[
                    { value: "On cash receipt", label: "On cash receipt" },
                    { value: "On declassification", label: "On declassification" },
                  ]}
                />
              </Field>
            </Grid>
          </CardContent>
        </Card>

        {pending.length > 0 && (
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Approval queue</CardTitle>
                <CardDescription>Approving officer (demo configuration: CRO or Head of Risk). The proposer cannot approve their own proposal.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                {pending.map((d) => (
                  <Grid key={d.id} columns={{ base: 1, lg: 2 }} gap="large">
                    <Card variant="filled" padding="small">
                      <DescriptionList
                        columns={2}
                        items={[
                          { label: "Facility", value: `${d.facilityId} · ${d.obligorName}`, span: 2 },
                          { label: "Migration", value: `Stage ${d.from} → Stage ${d.to}` },
                          { label: "Performing portion", value: `${Math.round(d.performingPortion * 100)}%`, mono: true },
                          { label: "ECL before → after", value: `${money(d.eclBefore)} → ${money(d.eclAfter)}`, mono: true, span: 2 },
                          { label: "ECL write-back", value: money((d.eclBefore - d.eclAfter) * d.performingPortion), mono: true },
                          { label: "Interest write-back", value: money(d.interestWriteBack), mono: true, hint: params.suspendedInterestPolicy },
                          { label: "Trigger data", value: d.trigger, span: 2 },
                          { label: "Proposed by", value: `${d.proposedBy}, ${dateTime(d.proposedAt)}`, span: 2 },
                        ]}
                      />
                    </Card>
                    {isApprover && !d.proposedBy.startsWith(actor.name) ? (
                      <DecisionPanel
                        title="Your decision"
                        actions={["approve", "decline"]}
                        commentRequired={["decline"]}
                        onDecide={({ decision, comment }) => onDecide(d, decision, comment)}
                        notice="On approval the ECL is recalculated on the destination stage basis, the reversal is credited to the impairment charge and the CBN 12.4 reserve entry is recomputed."
                      />
                    ) : (
                      <Alert tone="info" title="Awaiting the approving officer">
                        {isApprover
                          ? "You proposed this declassification, so another approver must decide (segregation of duties)."
                          : "Sign in as CRO or Head of Risk to approve or reject this proposal."}
                      </Alert>
                    )}
                  </Grid>
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
                  {canEdit && c.elig.status === "Eligible" && !pendingIds.has(c.id) && (
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
          </CardHeader>
          <CardContent>
            <DataTable
              label="Declassification history"
              data={decided}
              getRowId={(d) => d.id}
              exportFilename="ifrs9-declassification-history"
              emptyState={<Text tone="muted">No decisions yet. Approved and rejected proposals appear here.</Text>}
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
              ]}
            />
          </CardContent>
        </Card>

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
            <Button onClick={submit} disabled={portion <= 0 || portion > 100}>
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
          </Stack>
        )}
      </Modal>
    </ModulePage>
  );
}
