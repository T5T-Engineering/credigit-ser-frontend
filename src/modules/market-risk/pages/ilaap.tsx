"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  ApprovalTimeline,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChecklistPanel,
  type ChecklistPanelProps,
  type ChecklistStatus,
  DataTable,
  type DataTableColumn,
  Field,
  Grid,
  Input,
  List,
  Select,
  PhaseBadge,
  Stack,
  StatusBadge,
  Text,
} from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { dateTime, pct } from "@/lib/format";
import { getDefinition, stepApproverLabel, useOperation, usePendingFor } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import { roleById } from "@/lib/rbac/roles";
import { PendingNotice } from "../../ifrs9/governance";
import { compileIlaap, rasValues, requestRasChange, roleName, setChapterReviewed, setRiskFactorRelevance, submitIlaap } from "../actions";
import { topDepositors } from "../data";
import { RAS_METRICS, useMarketRisk, type RasMetric, type RasValues, type RiskFactor } from "../store";
import { useMarketBase } from "../use-market";

const CHAPTERS = [
  { id: "exec", title: "Executive summary", source: "Compiled from all chapters" },
  { id: "gov", title: "Governance & oversight", source: "Committee configuration" },
  { id: "ras", title: "Risk appetite statement", source: "Versioned RAS configuration (this page)" },
  { id: "factors", title: "Risk factor inventory", source: "Risk factor relevance scoring (this page)" },
  { id: "metrics", title: "Liquidity position & metrics", source: "Liquidity tab — LCR, NSFR, LDR, ladder, concentration" },
  { id: "stress", title: "Stress testing (incl. reverse stress test)", source: "Approved stress-testing runs with full assumption sets" },
  { id: "cfp", title: "Contingency Funding Plan", source: "Early-warning indicators, funding-source ranking (this page)" },
  { id: "conclusion", title: "Conclusions & Board attestation", source: "Sign-off chain (Operations)" },
];

const CFP_RANKING = [
  "Unencumbered Level 1 HQLA (T-bills, FGN bonds) — repo with the CBN",
  "Interbank money-market borrowing (secured)",
  "CBN Standing Lending Facility",
  "Sale of Level 2 / non-HQLA securities",
  "Wholesale deposit mobilisation (pricing uplift)",
  "Shareholder liquidity support",
];

const decisionMap = { approve: "approved", reject: "declined", return: "returned" } as const;

export function IlaapPage() {
  const { bs, liq, rules } = useMarketBase();
  const canRequestRasChange = useCan("market-risk.ras.request-change");
  const canUpdateIlaap = useCan("market-risk.ilaap.update");
  const canSubmitIlaap = useCan("market-risk.ilaap.submit");
  const { toast } = useSaveFeedback();
  const s = useMarketRisk();
  const current = s.rasVersions[0]!;
  const ruleValues = useMemo(() => {
    void rules; // RAS thresholds are business rules
    return rasValues();
  }, [rules]);
  const floors = useMemo(() => {
    void rules;
    return Object.fromEntries(RAS_METRICS.map((m) => [m.id, m.floorRule ? getRule<number>(m.floorRule) : null])) as Record<string, number | null>;
  }, [rules]);
  const [edits, setEdits] = useState<RasValues | null>(null);
  const values = edits ?? ruleValues;
  const [changeNote, setChangeNote] = useState("");
  const dirty = JSON.stringify(values) !== JSON.stringify(ruleValues);
  const rasPending = usePendingFor("IlaapRas", "RAS");
  const ilaapOp = useOperation(s.ilaap.operationId);
  const ilaapPending = usePendingFor("IlaapDocument", s.ilaap.period);

  const top20 = useMemo(() => {
    const d = topDepositors(bs);
    return (d.slice(0, 20).reduce((a, x) => a + x.balance, 0) / bs.deposits) * 100;
  }, [bs]);
  const lastRun = s.runs.find((r) => r.approval?.status === "Approved") ?? s.runs[0];
  const actual: Record<string, number | null> = {
    lcr: liq.lcr,
    nsfr: liq.nsfr,
    ldr: liq.ldrWeighted,
    lr: liq.liquidityRatio,
    top20,
    survival: lastRun ? (lastRun.survivalDays ?? getRule<number>("market-risk.stress.horizonDays")) : null,
  };

  const submitRas = async () => {
    const res = await requestRasChange(values, changeNote || "Threshold update");
    if (res.ok) {
      toast({ title: res.applied ? "RAS updated" : "RAS change submitted for approval", description: res.applied ? undefined : `Head of Risk → CRO → Board (${res.instance.id}).`, tone: "success" });
      setEdits(null);
      setChangeNote("");
    } else toast({ title: "Not submitted", description: res.reason, tone: "danger" });
  };

  const floorText = (m: RasMetric) => (m.floorRule ? `${m.direction === "min" ? "≥" : "≤"} ${floors[m.id]}% (${m.floorText})` : m.floorText);

  const status = (m: RasMetric) => {
    const a = actual[m.id];
    const v = values[m.id]!;
    if (a === null || a === undefined) return { tone: "neutral" as const, label: "Run stress test" };
    const floor = floors[m.id];
    const floorBreach = m.direction === "min" ? (m.id === "survival" ? a < v.buffer : floor !== null && floor !== undefined && a < floor) : a > v.buffer;
    if (floorBreach) return { tone: "danger" as const, label: "Breach" };
    const ew = m.direction === "min" ? a < v.earlyWarning : a > v.earlyWarning;
    return ew ? { tone: "warning" as const, label: "Early warning" } : { tone: "success" as const, label: "Within appetite" };
  };

  const rasCols: DataTableColumn<(typeof RAS_METRICS)[number]>[] = [
    { id: "metric", header: "Metric", accessor: "metric", cell: (m) => <span className="font-semibold text-fg">{m.metric}</span> },
    { id: "floor", header: "Regulatory floor", accessor: (m) => floorText(m) },
    ...(["earlyWarning", "buffer"] as const).map((k): DataTableColumn<(typeof RAS_METRICS)[number]> => ({
      id: k,
      header: k === "earlyWarning" ? "Early-warning trigger" : "Management buffer / limit",
      accessor: (m) => values[m.id]![k],
      numeric: true,
      cell: (m) =>
        canRequestRasChange && !rasPending ? (
          <div className="ml-auto w-32">
            <Input
              aria-label={`${m.metric} ${k}`}
              type="number"
              size="small"
              suffix={m.unit}
              value={values[m.id]![k]}
              onChange={(e) => setEdits({ ...values, [m.id]: { ...values[m.id]!, [k]: Number(e.target.value) } })}
            />
          </div>
        ) : (
          <span className="font-mono">
            {values[m.id]![k]} {m.unit}
          </span>
        ),
    })),
    {
      id: "actual",
      header: "Current",
      accessor: (m) => actual[m.id] ?? -1,
      numeric: true,
      cell: (m) => (actual[m.id] === null ? "—" : m.unit === "%" ? pct(actual[m.id]!, 1) : `${actual[m.id]} days`),
    },
    {
      id: "status",
      header: "Status",
      accessor: (m) => status(m).label,
      cell: (m) => {
        const st = status(m);
        return (
          <Badge tone={st.tone} className="whitespace-nowrap">
            {st.label}
          </Badge>
        );
      },
    },
  ];

  const factorCols: DataTableColumn<RiskFactor>[] = [
    { id: "category", header: "Category", accessor: "category" },
    {
      id: "factor",
      header: "Risk factor",
      accessor: "factor",
      cell: (f) => (
        <Stack direction="horizontal" gap="xsmall" align="center" wrap>
          <span className="font-semibold text-fg">{f.factor}</span>
          {f.tenantSpecific && <Badge variant="outline">Tenant-specific</Badge>}
        </Stack>
      ),
    },
    {
      id: "relevance",
      header: "Relevance",
      accessor: "relevance",
      cell: (f) =>
        canUpdateIlaap ? (
          <Select
            aria-label={`${f.factor} relevance`}
            size="small"
            value={f.relevance}
            onChange={async (e) => {
              const res = await setRiskFactorRelevance(f, e.target.value as RiskFactor["relevance"]);
              if (!res.ok) toast({ title: "Not changed", description: res.reason, tone: "danger" });
            }}
            options={["Low", "Medium", "High"].map((v) => ({ value: v, label: v }))}
          />
        ) : (
          <StatusBadge status={f.relevance} tones={{ Low: "success", Medium: "warning", High: "danger" }} />
        ),
    },
  ];

  // Governance sign-off — routed through the Operations workflow ("market-risk.ilaap.signoff").
  const def = getDefinition("market-risk.ilaap.signoff");
  const tiers = def.steps.map((st, idx) => {
    const ds = ilaapOp?.decisions.filter((d) => d.stepId === st.id) ?? [];
    return {
      id: st.id,
      title: st.name,
      role: stepApproverLabel(st),
      participants: ds.length
        ? ds.map((d) => ({ name: d.actorName, role: roleById[d.roleId]?.short, decision: decisionMap[d.decision], decidedAt: dateTime(d.at), comment: d.comment || undefined }))
        : st.approverRoles.map((r) => ({
            name: roleName(r),
            role: roleById[r]?.short,
            decision: (ilaapOp?.status === "Approved" || (ilaapOp && idx < ilaapOp.stepIndex) ? "approved" : "pending") as "approved" | "pending",
          })),
    };
  });
  const submitForSignOff = async () => {
    const res = await submitIlaap();
    if (res.ok) toast({ title: res.applied ? "ILAAP approved" : "ILAAP submitted for sign-off", description: res.applied ? undefined : `Follow it in Operations (${res.instance.id}).`, tone: "success" });
    else toast({ title: "Not submitted", description: res.reason, tone: "danger" });
  };

  const done = CHAPTERS.filter((c) => s.chapters[c.id]).length;
  const compile = async () => {
    const res = await compileIlaap(done, CHAPTERS.length);
    toast(res.ok ? { title: "ILAAP report compiled", tone: "success" } : { title: "Not compiled", description: res.reason, tone: "danger" });
  };

  return (
    <ModulePage
      module="market-risk"
      actions={<PhaseBadge phase={3} label="Ships in Phase 3" />}
      title="ILAAP"
      description="Configurable risk appetite, governance sign-off and ILAAP report compilation (CBN Guidelines on Liquidity Risk Management and ILAAP, 2021)."
    >
      <Stack gap="large">
        <Alert tone="info" title="Regulatory floor vs tenant appetite">
          The CBN Guidelines set the mandatory ILAAP content and the regulatory floor. Every threshold above that floor comes from the bank&apos;s Board-approved Risk Appetite
          Statement, held as versioned configuration — never hard-coded. Values shown are demo settings.
        </Alert>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Risk Appetite Statement — liquidity</CardTitle>
              <CardDescription>
                Version in force: <span className="font-mono font-semibold">v{current.version}</span> · {current.by} · {dateTime(current.at)}. Changes are approved by Head of Risk
                → CRO → Board in Operations.
              </CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              <PendingNotice subjectType="IlaapRas" subjectId="RAS">
                Thresholds are locked until the request is decided.
              </PendingNotice>
              <DataTable label="Risk appetite thresholds" columns={rasCols} data={RAS_METRICS} getRowId={(m) => m.id} paginate={false} />
              {canRequestRasChange && !rasPending && (
                <Grid columns={{ base: 1, md: 3 }} gap="medium">
                  <div className="md:col-span-2">
                    <Field label="Change rationale" description="Saved with the new version; the compiled ILAAP states which version was in force.">
                      <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="e.g. Board RMC raised LCR buffer after Q3 review" />
                    </Field>
                  </div>
                  <Stack direction="horizontal" gap="small" align="end">
                    <Button onClick={submitRas} disabled={!dirty}>
                      Submit v{current.version.split(".")[0]}.{Number(current.version.split(".")[1] ?? 0) + 1} for approval
                    </Button>
                    <Button variant="tertiary" onClick={() => setEdits(null)} disabled={!dirty}>
                      Discard
                    </Button>
                  </Stack>
                </Grid>
              )}
              <Text variant="caption" tone="muted">
                Version history: {s.rasVersions.map((v) => `v${v.version} (${dateTime(v.at)}, ${v.note})`).join(" · ")}
              </Text>
            </Stack>
          </CardContent>
        </Card>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Risk factor inventory</CardTitle>
                <CardDescription>
                  Required categories: funding, market-liquidity, credit, operational, intraday and other. Relevance scoring is tenant-configurable.
                </CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <DataTable label="Risk factor inventory" columns={factorCols} data={s.riskFactors} getRowId={(f) => f.id} paginate={false} />
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Contingency Funding Plan</CardTitle>
                <CardDescription>
                  Early-warning indicators and escalation are required; triggers, funding-source ranking and communication protocol are tenant-specific.
                </CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <Text variant="eyebrow">Funding-source ranking</Text>
                <List variant="ordered" items={CFP_RANKING} />
                <Text variant="eyebrow">Communication protocol</Text>
                <Text variant="small">
                  {(getRule<string[]>("market-risk.escalationRoles") ?? []).map(roleName).join(" → ")} (escalation ladder business rule); ALCO emergency session; CBN notified per
                  the Guidelines.
                </Text>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Governance sign-off — ILAAP 2026</CardTitle>
                <CardDescription>Board and Board-committee oversight is required; the chain is the Operations workflow &ldquo;{def.name}&rdquo; (steps, approvers and SLAs configurable).</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <ApprovalTimeline tiers={tiers} />
                {ilaapPending ? (
                  <PendingNotice subjectType="IlaapDocument" subjectId={s.ilaap.period}>
                    Approvers decide in Operations → Approvals.
                  </PendingNotice>
                ) : s.ilaap.status === "Approved" ? (
                  <Alert tone="success" title="ILAAP approved by the Board">
                    All sign-offs complete{s.ilaap.approvedAt ? ` — ${dateTime(s.ilaap.approvedAt)}` : ""}.
                  </Alert>
                ) : (
                  <Stack gap="small">
                    {s.ilaap.status === "Returned" && (
                      <Alert tone="warning" title="Returned / rejected">
                        {ilaapOp?.reason ?? "The last sign-off request was not approved."} Address the comments and resubmit.
                      </Alert>
                    )}
                    {canSubmitIlaap ? (
                      <div>
                        <Button onClick={submitForSignOff}>{s.ilaap.status === "Returned" ? "Resubmit for sign-off" : "Submit for sign-off"}</Button>
                      </div>
                    ) : (
                      <Text variant="small" tone="muted">
                        Not yet submitted. The Market Risk Analyst submits the ILAAP into the sign-off chain.
                      </Text>
                    )}
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Stack gap="large">
            <ChecklistPanel
              title="ILAAP report compilation"
              description="Chapters auto-populate from the platform; mark each reviewed."
              items={CHAPTERS.map((c) => ({ id: c.id, title: c.title, description: c.source, status: s.chapters[c.id] ? "met" : "pending", locked: !canUpdateIlaap }))}
              // Library typing: ChecklistPanel's onToggle collides with the native <section> onToggle (reported as a library request).
              onToggle={
                ((id: string, st: ChecklistStatus) => setChapterReviewed(id, CHAPTERS.find((c) => c.id === id)?.title ?? id, st === "met")) as unknown as ChecklistPanelProps["onToggle"]
              }
            />
            <Card variant="filled" padding="small">
              <Stack gap="small">
                <Text variant="small">
                  {done}/{CHAPTERS.length} chapters reviewed. The compiled report states RAS <span className="font-mono">v{current.version}</span> as the version in force for the
                  period.
                </Text>
                {canUpdateIlaap && (
                  <div>
                    <Button onClick={compile} variant={done === CHAPTERS.length ? "primary" : "secondary"}>
                      {done === CHAPTERS.length ? "Compile ILAAP report" : "Compile draft"}
                    </Button>
                  </div>
                )}
                {s.compiled[0] && (
                  <Text variant="caption" tone="muted">
                    Last compiled {dateTime(s.compiled[0].at)} by {s.compiled[0].by} (RAS v{s.compiled[0].rasVersion}). Export to PDF is simulated in the prototype.
                  </Text>
                )}
              </Stack>
            </Card>
          </Stack>
        </Grid>
      </Stack>
    </ModulePage>
  );
}
