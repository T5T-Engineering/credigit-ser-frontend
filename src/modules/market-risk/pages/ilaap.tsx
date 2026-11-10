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
  DecisionPanel,
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
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { newId } from "@/lib/data/store";
import { dateTime, pct } from "@/lib/format";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { useActorName, useAuditLog } from "../../ifrs9/common";
import { topDepositors } from "../data";
import { RAS_METRICS, useMarketRisk, type RiskFactor } from "../store";
import { useMarketBase } from "../use-market";

const CHAPTERS = [
  { id: "exec", title: "Executive summary", source: "Compiled from all chapters" },
  { id: "gov", title: "Governance & oversight", source: "Committee configuration (§4)" },
  { id: "ras", title: "Risk appetite statement", source: "Versioned RAS configuration (this page)" },
  { id: "factors", title: "Risk factor inventory", source: "Risk factor relevance scoring (this page)" },
  { id: "metrics", title: "Liquidity position & metrics", source: "Liquidity tab — LCR, NSFR, LDR, ladder, concentration (§6.8.2)" },
  { id: "stress", title: "Stress testing (incl. reverse stress test)", source: "Stress-testing runs with full assumption sets (§6.8.4)" },
  { id: "cfp", title: "Contingency Funding Plan", source: "Early-warning indicators, funding-source ranking (this page)" },
  { id: "conclusion", title: "Conclusions & Board attestation", source: "Sign-off chain" },
];

const CFP_RANKING = [
  "Unencumbered Level 1 HQLA (T-bills, FGN bonds) — repo with the CBN",
  "Interbank money-market borrowing (secured)",
  "CBN Standing Lending Facility",
  "Sale of Level 2 / non-HQLA securities",
  "Wholesale deposit mobilisation (pricing uplift)",
  "Shareholder liquidity support",
];

export function IlaapPage() {
  const { bs, liq } = useMarketBase();
  const canEdit = useCan("market-risk", "edit");
  const actor = useActorName();
  const audit = useAuditLog();
  const s = useMarketRisk();
  const current = s.rasVersions[0]!;
  const [values, setValues] = useState(current.values);
  const [changeNote, setChangeNote] = useState("");
  const dirty = JSON.stringify(values) !== JSON.stringify(current.values);

  const top20 = useMemo(() => {
    const d = topDepositors(bs);
    return (d.slice(0, 20).reduce((a, x) => a + x.balance, 0) / bs.deposits) * 100;
  }, [bs]);
  const lastRun = s.runs[0];
  const actual: Record<string, number | null> = {
    lcr: liq.lcr,
    nsfr: liq.nsfr,
    ldr: liq.ldrWeighted,
    lr: liq.liquidityRatio,
    top20,
    survival: lastRun ? (lastRun.survivalDays ?? 90) : null,
  };

  const saveVersion = () => {
    const [maj, min] = current.version.split(".").map(Number);
    const version = `${maj}.${(min ?? 0) + 1}`;
    s.addRasVersion({ version, at: new Date().toISOString(), by: `${actor.name} (${actor.role})`, note: changeNote || "Threshold update", values });
    audit("Saved Risk Appetite Statement version", "IlaapRas", `RAS v${version}`, `v${current.version}`, `v${version}: ${changeNote}`);
    setChangeNote("");
  };

  const status = (id: string, dir: "min" | "max") => {
    const a = actual[id];
    const v = values[id]!;
    if (a === null || a === undefined) return { tone: "neutral" as const, label: "Run stress test" };
    const floorBreach = dir === "min" ? (id === "survival" ? a < v.buffer : a < (id === "ldr" ? 65 : id === "lr" ? 30 : 100)) : a > v.buffer;
    if (floorBreach) return { tone: "danger" as const, label: "Breach" };
    const ew = dir === "min" ? a < v.earlyWarning : a > v.earlyWarning;
    return ew ? { tone: "warning" as const, label: "Early warning" } : { tone: "success" as const, label: "Within appetite" };
  };

  const rasCols: DataTableColumn<(typeof RAS_METRICS)[number]>[] = [
    { id: "metric", header: "Metric", accessor: "metric", cell: (m) => <span className="font-semibold text-fg">{m.metric}</span> },
    { id: "floor", header: "Regulatory floor (fixed)", accessor: "floor" },
    ...(["earlyWarning", "buffer"] as const).map((k): DataTableColumn<(typeof RAS_METRICS)[number]> => ({
      id: k,
      header: k === "earlyWarning" ? "Early-warning trigger" : "Management buffer / limit",
      accessor: (m) => values[m.id]![k],
      numeric: true,
      cell: (m) =>
        canEdit ? (
          <div className="ml-auto w-32">
            <Input
              aria-label={`${m.metric} ${k}`}
              type="number"
              size="small"
              suffix={m.unit}
              value={values[m.id]![k]}
              onChange={(e) => setValues({ ...values, [m.id]: { ...values[m.id]!, [k]: Number(e.target.value) } })}
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
      accessor: (m) => status(m.id, m.direction).label,
      cell: (m) => {
        const st = status(m.id, m.direction);
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
        canEdit ? (
          <Select
            aria-label={`${f.factor} relevance`}
            size="small"
            value={f.relevance}
            onChange={(e) => {
              audit("Changed ILAAP risk-factor relevance", "IlaapRiskFactor", f.id, f.relevance, e.target.value);
              s.setRelevance(f.id, e.target.value as RiskFactor["relevance"]);
            }}
            options={["Low", "Medium", "High"].map((v) => ({ value: v, label: v }))}
          />
        ) : (
          <StatusBadge status={f.relevance} tones={{ Low: "success", Medium: "warning", High: "danger" }} />
        ),
    },
  ];

  // Governance sign-off
  const currentTier = s.signOffs.find((x) => x.decision !== "approved");
  const canSign = !!currentTier && actor.roleId === currentTier.roleId;
  const decide = (decision: string, comment: string) => {
    if (!currentTier) return;
    const approved = decision === "approve";
    s.signOff(currentTier.tier, { decision: approved ? "approved" : "returned", by: actor.name, at: new Date().toISOString(), comment });
    if (!approved) {
      // Returned: reset to the preparer.
      s.signOff("prepare", { decision: "pending" });
    }
    audit(approved ? "Signed off ILAAP document" : "Returned ILAAP document", "IlaapDocument", "ILAAP-2026", currentTier.title, approved ? "Approved" : `Returned: ${comment}`);
  };
  const resubmit = () => {
    s.signOff("prepare", { decision: "approved", by: actor.name, at: new Date().toISOString() });
    for (const t of s.signOffs.filter((x) => x.decision === "returned")) s.signOff(t.tier, { decision: "pending", comment: undefined });
    audit("Resubmitted ILAAP document for review", "IlaapDocument", "ILAAP-2026", "Returned", "Submitted");
  };

  const done = CHAPTERS.filter((c) => s.chapters[c.id]).length;
  const compile = () => {
    s.addCompiled({ id: newId("ILAAP"), at: new Date().toISOString(), by: actor.name, rasVersion: current.version });
    audit("Compiled ILAAP report", "IlaapDocument", "ILAAP-2026", undefined, `Compiled with RAS v${current.version}; ${done}/${CHAPTERS.length} chapters complete`);
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
                Version in force: <span className="font-mono font-semibold">v{current.version}</span> · {current.by} · {dateTime(current.at)}
              </CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              <DataTable label="Risk appetite thresholds" columns={rasCols} data={RAS_METRICS} getRowId={(m) => m.id} paginate={false} />
              {canEdit && (
                <Grid columns={{ base: 1, md: 3 }} gap="medium">
                  <div className="md:col-span-2">
                    <Field label="Change rationale" description="Saved with the new version; the compiled ILAAP states which version was in force.">
                      <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="e.g. Board RMC raised LCR buffer after Q3 review" />
                    </Field>
                  </div>
                  <Stack direction="horizontal" gap="small" align="end">
                    <Button onClick={saveVersion} disabled={!dirty}>
                      Save as v{current.version.split(".")[0]}.{Number(current.version.split(".")[1] ?? 0) + 1}
                    </Button>
                    <Button variant="tertiary" onClick={() => setValues(current.values)} disabled={!dirty}>
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
                <Text variant="small">Market Risk Analyst → Head of Risk → CRO → ALCO (emergency session within 24h) → Board Risk Committee; CBN notified per the Guidelines.</Text>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Governance sign-off — ILAAP 2026</CardTitle>
                <CardDescription>Board and Board-committee oversight is required; committee names and membership are tenant-configured (demo chain).</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <ApprovalTimeline
                  tiers={s.signOffs.map((t) => ({
                    id: t.tier,
                    title: t.title,
                    role: roleById[t.roleId as RoleId]?.name,
                    participants: [
                      {
                        name: t.by ?? roleById[t.roleId as RoleId]?.name ?? t.roleId,
                        role: roleById[t.roleId as RoleId]?.short,
                        decision: t.decision,
                        decidedAt: t.at ? dateTime(t.at) : undefined,
                        comment: t.comment,
                      },
                    ],
                  }))}
                />
                {canSign && currentTier?.tier !== "prepare" && (
                  <DecisionPanel
                    title={`Your decision — ${currentTier?.title}`}
                    actions={["approve", "return"]}
                    commentRequired={["return"]}
                    onDecide={({ decision, comment }) => decide(decision, comment)}
                  />
                )}
                {currentTier?.tier === "prepare" && canEdit && <Button onClick={resubmit}>Resubmit for review</Button>}
                {!currentTier && (
                  <Alert tone="success" title="ILAAP approved by the Board">
                    All sign-offs complete.
                  </Alert>
                )}
                {currentTier && !canSign && currentTier.tier !== "prepare" && (
                  <Text variant="small" tone="muted">
                    Awaiting {roleById[currentTier.roleId as RoleId]?.name}. Switch role from the user menu to sign as that approver.
                  </Text>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Stack gap="large">
            <ChecklistPanel
              title="ILAAP report compilation"
              description="Chapters auto-populate from the platform; mark each reviewed."
              items={CHAPTERS.map((c) => ({ id: c.id, title: c.title, description: c.source, status: s.chapters[c.id] ? "met" : "pending", locked: !canEdit }))}
              // Library typing: ChecklistPanel's onToggle collides with the native <section> onToggle (reported as a library request).
              onToggle={
                ((id: string, st: ChecklistStatus) => {
                  s.setChapter(id, st === "met");
                  audit("Updated ILAAP chapter status", "IlaapChapter", id, st === "met" ? "pending" : "met", st);
                }) as unknown as ChecklistPanelProps["onToggle"]
              }
            />
            <Card variant="filled" padding="small">
              <Stack gap="small">
                <Text variant="small">
                  {done}/{CHAPTERS.length} chapters reviewed. The compiled report states RAS <span className="font-mono">v{current.version}</span> as the version in force for the
                  period.
                </Text>
                {canEdit && (
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
