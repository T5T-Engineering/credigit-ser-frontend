"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, FileStack, Gauge as GaugeIcon, Landmark, ShieldAlert, TrendingUp, Waves } from "lucide-react";
import {
  ActionBlocks,
  AiInsightCard,
  Badge,
  BarChart,
  Button,
  Card,
  ChecklistPanel,
  DataTable,
  DonutChart,
  Gauge,
  Grid,
  LineChart,
  Matrix,
  MiniBarList,
  PhaseBadge,
  RagIndicator,
  SegmentedControl,
  Sparkline,
  StackedBarChart,
  Stack,
  StatusBadge,
  Text,
  type DataTableColumn,
  type MatrixCell,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { getDefinition, useMyApprovalQueue } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { useApplications, useCollateral, useLookups, useNotifications, useTasks } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { roleById } from "@/lib/rbac/roles";
import { rarPosition } from "@/lib/rar";
import { ago, dateTime, money, moneyShort, pct } from "@/lib/format";
import { CalcNote } from "@/modules/portfolio/components/calc-note";
import { operationHref, PendingApproval } from "@/modules/portfolio/components/governance";
import { Panel } from "@/modules/portfolio/components/panel";
import { isNewBusiness } from "@/modules/portfolio/data";
import { useActor, useLimitMonitor, usePortfolioModel } from "@/modules/portfolio/hooks";
import { computeWarr, limitStatus, usePortfolioParams } from "@/modules/portfolio/selectors";
import { demoExceptions, demoFeeds, shareMarginStatus, type ExceptionItem, type Kri, type Rag } from "../data";
import { useExecutiveGovernance } from "../hooks";
import { EXEC_RULES, PACK_HREF } from "../platform";

type View = "cro" | "hor";
const POSTURE_STATES = [
  ...["Aggressive", "Competitive", "Conservative", "Defensive"].flatMap((b) => ["Strongly", "Moderately", "Marginally"].map((i) => `${i} ${b}`)),
  "Neutral / Transitional",
];
const ragTone = { green: "success", amber: "warning", red: "danger" } as const;

export function ExecutivePage() {
  const m = usePortfolioModel();
  const { totals, exposures, sectorRows, large, warr, history, rows, facilities } = m;
  const actor = useActor();
  const tasks = useTasks();
  const applications = useApplications();
  const collateral = useCollateral();
  const notifications = useNotifications();
  const { obligor } = useLookups();
  const [view, setView] = useState<View>(actor.roleId === "head-of-risk" ? "hor" : "cro");
  const { actor: me } = useScope();
  const canEdit = useCan("executive", "edit");
  const gov = useExecutiveGovernance();
  const queue = useMyApprovalQueue(me);
  useLimitMonitor(m);
  const p = usePortfolioParams();
  const R = EXEC_RULES;
  const stage2Red = useRule<number>(R.stage2RedPct);
  const stage2Amber = useRule<number>(R.stage2AmberPct);
  const amberShare = useRule<number>(R.appetiteAmberPct) / 100;
  const carBuffer = useRule<number>(R.carAmberBufferPp);
  const ldrMin = useRule<number>(R.ldrMinPct);
  const ldrBuffer = useRule<number>(R.ldrAmberBufferPp);
  const liqMin = useRule<number>(R.liquidityRatioMinPct);
  const nopLimit = useRule<number>(R.nopLimitPct);
  const varLimit = useRule<number>(R.varLimitNgn);
  const opLossAppetite = useRule<number>(R.opLossAppetitePct);
  const haircut = useRule<number>(R.quotedEquityHaircutPct);
  const early = p.earlyWarningPct.value;

  const top = exposures[0];
  const worstSector = sectorRows[0];
  const breaches = sectorRows.filter((s) => s.status === "Breach");
  const nearBreaches = sectorRows.filter((s) => s.status === "Near breach");
  const wNew = computeWarr(rows.filter((r) => isNewBusiness(r.facility)));
  const wOld = computeWarr(rows.filter((r) => !isNewBusiness(r.facility)));
  const margin = useMemo(() => shareMarginStatus(collateral, facilities), [collateral, facilities, haircut]); // eslint-disable-line react-hooks/exhaustive-deps -- haircut rule
  const warrStatus: Rag = warr.warr >= p.warrCeiling.value ? "red" : warr.warr >= p.warrEarlyWarning.value ? "amber" : "green";
  const solRag: Rag = !top ? "green" : top.solUtilisationPct >= 100 ? "red" : top.solUtilisationPct >= early ? "amber" : "green";

  const kris: Kri[] = [
    { id: "npl", domain: "Credit", name: "NPL ratio", value: pct(totals.nplRatio, 2), threshold: `≤ ${p.nplAppetitePct.value}%`, rag: totals.nplRatio >= p.nplAppetitePct.value ? "red" : totals.nplRatio >= p.nplAppetitePct.value * amberShare ? "amber" : "green", source: "Derived", href: "/portfolio", prd: "§6.6.5" },
    { id: "s2", domain: "Credit", name: "Stage 2 share of book", value: pct(totals.stageShare[2]), threshold: `≤ ${stage2Red}%`, rag: totals.stageShare[2] >= stage2Red ? "red" : totals.stageShare[2] >= stage2Amber ? "amber" : "green", source: "Derived", href: "/ifrs9/staging", prd: "§6.7.1" },
    { id: "sol", domain: "Credit", name: "Largest single-obligor utilisation", value: top ? pct(top.solUtilisationPct, 0) : "—", threshold: `< 100% of ${p.singleObligorLimitPct.value}% SHF (CBN 3.2(a))`, rag: solRag, source: "Derived", href: "/portfolio/limits", prd: "§6.6.2" },
    { id: "sec", domain: "Credit", name: "Sectors in breach / near breach", value: `${breaches.length} / ${nearBreaches.length}`, threshold: "0 breaches", rag: breaches.length ? "red" : nearBreaches.length ? "amber" : "green", source: "Derived", href: "/portfolio/limits", prd: "§6.6.2" },
    { id: "warr", domain: "Credit", name: "WARR (whole book)", value: warr.warr.toFixed(2), threshold: `< ${p.warrCeiling.value}`, rag: warrStatus, source: "Derived", href: "/portfolio/warr", prd: "§6.6.9" },
    { id: "lex", domain: "Credit", name: "Large exposures to capital", value: pct(large.toCapitalPct, 0), threshold: `Aggregate ≤ ${p.aggregateLargeExposureMultiple.value}× SHF (CBN 3.2(e))`, rag: large.utilisationPct >= 100 ? "red" : large.utilisationPct >= early ? "amber" : "green", source: "Derived", href: "/portfolio/limits", prd: "§6.6.5" },
    { id: "car", domain: "Capital", name: "Capital adequacy ratio", value: pct(demoFeeds.carPct), threshold: `≥ ${p.minCarPct.value}% (CBN)`, rag: demoFeeds.carPct < p.minCarPct.value ? "red" : demoFeeds.carPct < p.minCarPct.value + carBuffer ? "amber" : "green", source: "Tenant parameter", href: "/ifrs9/icaap", prd: "§6.7.4" },
    { id: "ldr", domain: "Liquidity", name: "Loan-to-deposit ratio", value: pct(demoFeeds.ldrPct), threshold: `≥ ${ldrMin}% (CBN minimum)`, rag: demoFeeds.ldrPct < ldrMin ? "red" : demoFeeds.ldrPct < ldrMin + ldrBuffer ? "amber" : "green", source: "Tenant parameter", href: "/market-risk/liquidity", prd: "§6.8.2" },
    { id: "liq", domain: "Liquidity", name: "Liquidity ratio", value: pct(demoFeeds.liquidityRatioPct), threshold: `≥ ${liqMin}% (tenant parameter)`, rag: demoFeeds.liquidityRatioPct < liqMin ? "red" : "green", source: "Tenant parameter", href: "/market-risk/liquidity", prd: "§6.8" },
    { id: "nop", domain: "Market", name: "Net open position to capital", value: pct(demoFeeds.nopToCapitalPct), threshold: `≤ ${nopLimit}% (tenant parameter)`, rag: demoFeeds.nopToCapitalPct >= nopLimit ? "red" : (demoFeeds.nopToCapitalPct / nopLimit) * 100 >= early ? "amber" : "green", source: "Tenant parameter", href: "/market-risk", prd: "§6.8" },
    { id: "var", domain: "Market", name: "Trading VaR (1-day, 99%)", value: moneyShort(demoFeeds.varNgn), threshold: `≤ ${moneyShort(varLimit)} (tenant parameter)`, rag: demoFeeds.varNgn >= varLimit ? "red" : (demoFeeds.varNgn / varLimit) * 100 >= early ? "amber" : "green", source: "Tenant parameter", href: "/market-risk", prd: "§6.8.1" },
    { id: "op", domain: "Operational", name: "KRI RAG mix", value: `${demoFeeds.kriRag.green}G · ${demoFeeds.kriRag.amber}A · ${demoFeeds.kriRag.red}R`, threshold: "0 Red", rag: demoFeeds.kriRag.red ? "red" : demoFeeds.kriRag.amber ? "amber" : "green", source: "Tenant parameter", href: "/operational-risk", prd: "§6.9.1" },
    { id: "loss", domain: "Operational", name: "Operational loss rate", value: pct(demoFeeds.opLossRatePct, 2), threshold: `≤ ${opLossAppetite}% of gross income`, rag: demoFeeds.opLossRatePct >= opLossAppetite ? "red" : demoFeeds.opLossRatePct >= opLossAppetite * amberShare ? "amber" : "green", source: "Tenant parameter", href: "/operational-risk", prd: "§6.9" },
  ];

  // 13-state posture distribution (§6.2.5)
  const posture = useMemo(() => {
    const map = new Map<string, number>(POSTURE_STATES.map((s) => [s, 0]));
    for (const e of exposures) {
      const pos = rarPosition(e.obligor.rar);
      const key = pos.neutral ? "Neutral / Transitional" : `${pos.intensity} ${pos.base}`;
      map.set(key, (map.get(key) ?? 0) + e.exposure);
    }
    return POSTURE_STATES.map((s) => ({ label: s, value: map.get(s) ?? 0 }));
  }, [exposures]);

  // Limit heat-map (sector × metric)
  const largestBySector = useMemo(() => {
    const out = new Map<string, number>();
    for (const e of exposures) if (e.sector) out.set(e.sector.id, Math.max(out.get(e.sector.id) ?? 0, e.solUtilisationPct));
    return out;
  }, [exposures]);
  const sectorWarr = useMemo(() => {
    const out = new Map<string, number>();
    const groups = new Map<string, typeof rows>();
    for (const r of rows) groups.set(r.obligor.sectorId, [...(groups.get(r.obligor.sectorId) ?? []), r]);
    for (const [k, list] of groups) out.set(k, computeWarr(list).warr);
    return out;
  }, [rows]);
  const heatColumns = [
    { id: "util", label: "Sector limit", description: "Utilisation of the sectoral limit" },
    { id: "obl", label: "Largest obligor", description: "Largest obligor in the sector, % of the single-obligor limit" },
    { id: "npl", label: "NPL ratio" },
    { id: "warr", label: "WARR" },
  ];
  const tone3 = (v: number, amber: number, red: number) => (v >= red ? "danger" : v >= amber ? "warning" : "success");
  const heatCells: MatrixCell[] = sectorRows.flatMap((s) => {
    const obl = largestBySector.get(s.sector.id) ?? 0;
    const w = sectorWarr.get(s.sector.id) ?? 0;
    return [
      { row: s.sector.id, column: "util", value: s.utilisationPct, label: pct(s.utilisationPct, 0), tone: tone3(s.utilisationPct, p.earlyWarningPct.value, 100), description: `${s.status}` },
      { row: s.sector.id, column: "obl", value: obl, label: obl ? pct(obl, 0) : "—", tone: obl ? tone3(obl, p.earlyWarningPct.value, 100) : "neutral", description: limitStatus(obl) },
      { row: s.sector.id, column: "npl", value: s.nplRatio, label: pct(s.nplRatio, 1), tone: tone3(s.nplRatio, p.nplAppetitePct.value * amberShare, p.nplAppetitePct.value) },
      { row: s.sector.id, column: "warr", value: w, label: w ? w.toFixed(2) : "—", tone: w ? tone3(w, p.warrEarlyWarning.value, p.warrCeiling.value) : "neutral" },
    ] satisfies MatrixCell[];
  });

  // Escalations awaiting this role's decision
  const myTasks = tasks.filter((t) => t.status === "Open" && t.assigneeRoleId === actor.roleId);
  const awaiting = applications.filter((a) => a.stage === "Approval" && a.approvals.some((s) => s.decision === "pending" && s.roleId === actor.roleId));
  const approvals = queue.map((i) => ({ id: i.id, title: i.title, detail: `${getDefinition(i.operationType).name} · requested by ${i.requestedBy.name}`, due: i.stepStartedAt, href: operationHref(i.id), kind: "Approval" }));
  const escalations = [
    ...approvals,
    // Applications already routed through Operations appear once, as an approval above.
    ...awaiting.filter((a) => !queue.some((i) => i.subject.id === a.id)).map((a) => ({ id: a.id, title: `${a.id} — ${obligor.get(a.obligorId)?.name ?? a.obligorId}`, detail: `${a.product} · ${moneyShort(a.amount)} · ${a.flow}`, due: a.slaDueAt, href: `/origination/application?id=${a.id}`, kind: "Credit approval" })),
    ...breaches.map((s) => ({ id: `LIM-${s.sector.id}`, title: `Sector limit breach — ${s.sector.name}`, detail: `${pct(s.sharePct)} of book vs ${pct(s.limitPct, 0)} limit`, due: DEMO_NOW.toISOString(), href: "/portfolio/limits", kind: "Limit breach" })),
    ...myTasks.filter((t) => !awaiting.some((a) => t.href.includes(a.id))).map((t) => ({ id: t.id, title: t.title, detail: t.module, due: t.dueAt, href: t.href, kind: "Task" })),
  ];

  // Head of Risk cross-functional exception feed
  const creditExceptions: ExceptionItem[] = [
    ...breaches.map((s) => ({ id: `EXC-C-${s.sector.id}`, domain: "Credit" as const, title: `${s.statutory ? "Statutory" : "Sectoral"} limit breach: ${s.sector.name} at ${pct(s.sharePct)} vs ${pct(s.limitPct, 0)}`, severity: "High" as const, owner: "Portfolio & MIS Officer", raisedAt: DEMO_NOW.toISOString(), href: "/portfolio/limits" })),
    ...nearBreaches.map((s) => ({ id: `EXC-C-NB-${s.sector.id}`, domain: "Credit" as const, title: `Near-breach: ${s.sector.name} at ${pct(s.utilisationPct, 0)} of limit`, severity: "Medium" as const, owner: "Portfolio & MIS Officer", raisedAt: DEMO_NOW.toISOString(), href: "/portfolio/limits", aiFlagged: true })),
    ...(top && top.solUtilisationPct >= p.earlyWarningPct.value ? [{ id: "EXC-C-SOL", domain: "Credit" as const, title: `Single-obligor near-breach: ${top.obligor.name} at ${pct(top.solUtilisationPct, 0)} of limit`, severity: "High" as const, owner: "Credit Analyst", raisedAt: DEMO_NOW.toISOString(), href: "/portfolio/limits" }] : []),
    ...notifications.filter((n) => n.tone === "danger").map((n) => ({ id: `EXC-${n.id}`, domain: "Credit" as const, title: `${n.title} — ${n.body}`, severity: "High" as const, owner: "Loan Review Officer", raisedAt: n.createdAt, href: n.href ?? "/monitoring", aiFlagged: true })),
    ...margin.shortfalls.slice(0, 3).map((r) => ({ id: `EXC-S-${r.id}`, domain: "Collateral" as const, title: `Share-collateral margin shortfall: ${r.ticker} cover ${moneyShort(r.cover)} vs ${moneyShort(r.secured)}`, severity: "Medium" as const, owner: "Collateral Officer", raisedAt: DEMO_NOW.toISOString(), href: "/collateral", aiFlagged: true })),
  ];
  const exceptions = [...creditExceptions, ...demoExceptions];

  const { brcRun, packItems, signOff, summaryPending } = gov;
  const headline = `The loan book stands at ${moneyShort(totals.grossLoans)} with an NPL ratio of ${pct(totals.nplRatio, 2)} (appetite ${p.nplAppetitePct.value}%) and ${pct(totals.stageShare[2])} in Stage 2. WARR is ${warr.warr.toFixed(2)} against a ${p.warrCeiling.value} ceiling; new business is rated ${wNew.warr.toFixed(2)} versus ${wOld.warr.toFixed(2)} for the existing book.`;

  const kriColumns: DataTableColumn<Kri>[] = [
    { id: "domain", header: "Domain", accessor: "domain", sortable: true },
    { id: "name", header: "Indicator", accessor: "name", cell: (r) => <Link href={r.href} className="font-semibold text-link">{r.name}</Link> },
    { id: "value", header: "Actual", accessor: "value", numeric: true },
    { id: "threshold", header: "Appetite / limit", accessor: "threshold" },
    { id: "rag", header: "RAG", accessor: "rag", sortable: true, cell: (r) => <RagIndicator status={r.rag} label={r.rag === "green" ? "Within" : r.rag === "amber" ? "Early warning" : "Breach"} /> },
    { id: "source", header: "Source", accessor: "source", cell: (r) => <Badge tone={r.source === "Derived" ? "success" : "warning"} variant="soft">{r.source === "Derived" ? "Live (spine)" : "Tenant parameter"}</Badge> },
  ];

  const summary = (
    <AiInsightCard
      kind="drafted"
      title="Executive risk summary"
      model="Credigit narrative engine (simulated)"
      generatedAt={dateTime(DEMO_NOW)}
      confidence={0.81}
      paragraphs={[
        headline,
        `${breaches.length} sector${breaches.length === 1 ? " is" : "s are"} above limit${worstSector ? ` — most acutely ${worstSector.sector.name} at ${pct(worstSector.utilisationPct, 0)} of its limit` : ""}. The largest obligor${top ? `, ${top.obligor.name}, uses ${pct(top.solUtilisationPct, 0)} of the single-obligor limit` : ""}.`,
      ]}
      bullets={[
        breaches.length ? "Recommend gating new approvals in breached sectors pending a Board-approved remediation plan." : "No sector remediation required this period.",
        "Capital, liquidity and operational indicators are within appetite; one operational KRI is Red.",
      ]}
      sources={[{ label: "Portfolio & MIS", detail: "Limits, concentration, WARR" }, { label: "Risk appetite thresholds", detail: "Board-approved values" }]}
      signedOffBy={signOff ? `${signOff.by} (${roleById[signOff.role as keyof typeof roleById]?.name ?? signOff.role}), ${dateTime(signOff.at)} — ${gov.period}, through Operations` : undefined}
      signOffNote={
        summaryPending ? (
          <span>
            Awaiting sign-off in Operations — <Link href={operationHref(summaryPending.id)} className="font-semibold text-link">{summaryPending.id}</Link>
          </span>
        ) : (
          `Sign-off (${gov.signers || "no approval step"}) is required before this summary is used in a Board pack.`
        )
      }
      labels={{ accept: "Submit for sign-off" }}
      onAccept={canEdit && !summaryPending ? () => void gov.submitSummary(headline) : undefined}
    />
  );

  return (
    <ModulePage
      module="executive"
      description="Role-aware risk cockpit for the CRO, Head of Risk and executive management: risk appetite against actual, cross-functional KRIs and exceptions — every tile drills down to the owning module."
      actions={
        <SegmentedControl
          label="Dashboard view"
          value={view}
          onChange={setView}
          options={[
            { value: "cro", label: "CRO dashboard" },
            { value: "hor", label: "Head of Risk dashboard" },
          ]}
        />
      }
    >
      <Stack gap="large">
        <Text variant="small">
          Viewing as <strong className="text-fg">{actor.roleId ? roleById[actor.roleId].name : "—"}</strong> · data as at {dateTime(DEMO_NOW)} · advanced executive views ship in Phase 2 <PhaseBadge phase={2} />
        </Text>

        <Panel
          title="Risk appetite scorecard"
          description="Actual vs Board-approved Risk Appetite Statement thresholds. Credit gauges are live from the spine; capital and liquidity are demo feeds."
        >
          <Grid columns={{ base: 1, sm: 2, lg: 3 }} gap="medium">
            <GaugeTile
              label="Single-obligor utilisation"
              sub={top ? top.obligor.name : "—"}
              value={top?.solUtilisationPct ?? 0}
              max={Math.max(120, Math.ceil((top?.solUtilisationPct ?? 0) / 10) * 10)}
              bands={[{ to: early, tone: "success" }, { to: 100, tone: "warning" }, { to: Math.max(120, Math.ceil((top?.solUtilisationPct ?? 0) / 10) * 10), tone: "danger" }]}
              fmt={(v) => pct(v, 0)}
              calc={{ metric: "single-obligor utilisation", formula: `(On-balance + ${pct(p.offBalanceSolWeight.value, 2)} × off-balance) / (${p.singleObligorLimitPct.value}% × SHF)`, source: "CBN 3.2(a)–(b); SHF (business rules).", prd: "§8", demo: true }}
            />
            <GaugeTile
              label="Sectoral concentration"
              sub={worstSector ? `${worstSector.sector.name} (highest)` : "—"}
              value={worstSector?.utilisationPct ?? 0}
              max={Math.max(150, Math.ceil((worstSector?.utilisationPct ?? 0) / 10) * 10)}
              bands={[{ to: early, tone: "success" }, { to: 100, tone: "warning" }, { to: Math.max(150, Math.ceil((worstSector?.utilisationPct ?? 0) / 10) * 10), tone: "danger" }]}
              fmt={(v) => pct(v, 0)}
              calc={{ metric: "sectoral concentration", formula: "Sector outstanding / Total outstanding ÷ sector limit %", source: `CBA facility ledger; sector limits are tenant parameters (government ${p.governmentCeilingPct.value}% statutory).`, prd: "§8, §6.6.2" }}
            />
            <GaugeTile
              label="NPL ratio"
              sub={`Appetite ${p.nplAppetitePct.value}%`}
              value={totals.nplRatio}
              max={10}
              bands={[{ to: p.nplAppetitePct.value * amberShare, tone: "success" }, { to: p.nplAppetitePct.value, tone: "warning" }, { to: 10, tone: "danger" }]}
              fmt={(v) => pct(v, 2)}
              calc={{ metric: "NPL ratio", formula: "NPL / Gross loans × 100", source: "CBA facility book, CBN classification (CBN 12.1(b)).", prd: "§6.6.5" }}
            />
            <GaugeTile
              label="WARR vs ceiling"
              sub={`Ceiling ${p.warrCeiling.value}`}
              value={warr.warr}
              min={1}
              max={10}
              bands={[{ to: p.warrEarlyWarning.value, tone: "success" }, { to: p.warrCeiling.value, tone: "warning" }, { to: 10, tone: "danger" }]}
              fmt={(v) => v.toFixed(2)}
              calc={{ metric: "WARR", formula: "Σ (exposure × grade score) / Σ rated exposure", source: "Internal grades, exposure = outstanding + undrawn × CCF.", prd: "§6.6.9" }}
            />
            <GaugeTile
              label="Capital adequacy ratio"
              sub={`Minimum ${p.minCarPct.value}% (CBN)`}
              value={demoFeeds.carPct}
              max={30}
              bands={[{ to: p.minCarPct.value, tone: "danger" }, { to: p.minCarPct.value + carBuffer, tone: "warning" }, { to: 30, tone: "success" }]}
              fmt={(v) => pct(v, 1)}
              calc={{ metric: "CAR", formula: "Total qualifying capital / Risk-weighted assets × 100", source: "GL Tier 1 + Tier 2 capital net of deductions; RWA from the CBA facility ledger × risk weights. Demo value from the ICAAP module.", prd: "§8, §9.1", demo: true }}
            />
            <GaugeTile
              label="Loan-to-deposit ratio"
              sub={`Minimum ${ldrMin}% (CBN)`}
              value={demoFeeds.ldrPct}
              max={100}
              bands={[{ to: ldrMin, tone: "danger" }, { to: ldrMin + ldrBuffer, tone: "warning" }, { to: 100, tone: "success" }]}
              fmt={(v) => pct(v, 1)}
              calc={{ metric: "LDR", formula: "Total loans / Total deposits (150% weighting on qualifying SME, retail, mortgage and consumer lending)", source: "CBA facility and deposit ledgers. Value from Market & Liquidity.", prd: "§8, §9.1", demo: true }}
            />
          </Grid>
        </Panel>

        <Grid columns={{ base: 1, lg: 3 }} gap="medium">
          <div className="lg:col-span-2">
            <Panel title="Escalations awaiting your decision" description="Operations approvals waiting for you, credit approvals at your tier, limit breaches and assigned tasks.">
              {escalations.length ? (
                <DataTable
                  label="Escalations"
                  data={escalations}
                  getRowId={(r) => r.id}
                  defaultPageSize={8}
                  pageSizeOptions={[]}
                  getRowHref={(r) => r.href}
                  linkComponent={Link}
                  columns={[
                    { id: "title", header: "Item", accessor: "title", cell: (r) => <span className="flex flex-col"><span className="font-semibold text-fg">{r.title}</span><span className="text-xs text-fg-subtle">{r.detail}</span></span> },
                    { id: "kind", header: "Type", accessor: "kind", cell: (r) => <StatusBadge status={r.kind} tones={{ Approval: "brand", "Credit approval": "info", "Limit breach": "danger", Task: "neutral" }} /> },
                    { id: "due", header: "Due", accessor: "due", cell: (r) => (new Date(r.due) < DEMO_NOW ? <span className="text-danger-strong">Overdue · {dateTime(r.due)}</span> : dateTime(r.due)) },
                  ]}
                />
              ) : (
                <Text variant="small">Nothing awaiting your decision.</Text>
              )}
            </Panel>
          </div>
          <Stack gap="medium">
            {summary}
            <PendingApproval subjectType="ExecutiveSummary" subjectId={gov.summaryKey} />
          </Stack>
        </Grid>

        {view === "hor" ? (
          <Grid columns={{ base: 1, lg: 3 }} gap="medium">
            <div className="lg:col-span-2">
              <Panel title="Cross-functional exception feed" description="Consolidated from Credit, Market, Liquidity, Operational and Collateral modules, ranked by severity.">
                <DataTable
                  label="Exception feed"
                  data={exceptions}
                  getRowId={(r) => r.id}
                  defaultPageSize={8}
                  getRowHref={(r) => r.href}
                  linkComponent={Link}
                  filters={[{ id: "domain", label: "Domain" }, { id: "severity", label: "Severity" }]}
                  defaultSort={{ id: "severity", direction: "asc" }}
                  columns={[
                    { id: "title", header: "Exception", accessor: "title", cell: (r) => <span className="flex flex-col gap-1"><span className="font-semibold text-fg">{r.title}</span>{r.aiFlagged ? <span><Badge tone="warning" variant="soft">AI-flagged</Badge></span> : null}</span> },
                    { id: "domain", header: "Domain", accessor: "domain", sortable: true },
                    { id: "severity", header: "Severity", accessor: "severity", sortable: true, sortValue: (r) => ({ High: 0, Medium: 1, Low: 2 })[r.severity], cell: (r) => <StatusBadge status={r.severity} tones={{ High: "danger", Medium: "warning", Low: "info" }} /> },
                    { id: "owner", header: "Owner", accessor: "owner" },
                    { id: "raised", header: "Raised", accessor: "raisedAt", cell: (r) => ago(r.raisedAt) },
                  ]}
                />
              </Panel>
            </div>
            <ChecklistPanel
              title="Board Risk Committee pack"
              description="Pack builder — sections pulled from each module."
              items={packItems}
              action={
                brcRun ? (
                  <Button as={Link} href={PACK_HREF} size="small" variant="secondary">
                    Open pack ({brcRun.status === "Released" ? "approved" : brcRun.status === "Submitted for release" ? "awaiting approval" : "draft"})
                  </Button>
                ) : canEdit ? (
                  <Button size="small" variant="primary" iconBefore={<FileStack size={14} aria-hidden />} onClick={() => void gov.buildPack()}>Build {gov.period} pack</Button>
                ) : undefined
              }
            />
          </Grid>
        ) : null}

        <Panel title="Key risk indicators" description="Credit, capital, market, liquidity and operational KRIs against appetite. Select an indicator to open the owning module.">
          <DataTable label="Key risk indicators" data={kris} columns={kriColumns} getRowId={(r) => r.id} paginate={false} filters={[{ id: "domain", label: "Domain" }]} exportFilename="executive-kris.csv" />
        </Panel>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Panel title="Single-obligor & sectoral limit heat-map" description="Tenant sector taxonomy; CBN classification view in Portfolio → Limits.">
            <div className="overflow-x-auto">
              <Matrix
                label="Sector limit heat-map"
                rows={sectorRows.map((s) => ({ id: s.sector.id, label: s.sector.name }))}
                columns={heatColumns}
                cells={heatCells}
                cellSize="small"
                legend={[{ label: "Within", tone: "success" }, { label: "Early warning", tone: "warning" }, { label: "Breach", tone: "danger" }]}
              />
            </div>
          </Panel>
          <Panel title="Portfolio by 360 RAR posture" description="Exposure across the thirteen posture states.">
            <BarChart label="Exposure by 360 RAR posture" orientation="horizontal" data={posture.map((x) => ({ label: x.label, value: x.value }))} valueFormatter={moneyShort} tone="accent" />
          </Panel>
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Panel title="Top exposures" description={`Top 10 obligors · ${pct((exposures.slice(0, 10).reduce((a, e) => a + e.exposure, 0) / Math.max(1, exposures.reduce((a, e) => a + e.exposure, 0))) * 100)} of book`}>
            <MiniBarList label="Top 10 exposures" items={exposures.slice(0, 10).map((e) => ({ label: e.obligor.name, value: e.exposure, meta: `${pct(e.pctOfShf, 0)} SHF · Stage ${e.worstStage}`, tone: e.worstStage > 1 ? "warning" : "accent", href: "/portfolio/concentration" }))} valueFormatter={moneyShort} linkComponent={Link} />
          </Panel>
          <Panel title="IFRS 9 stage migration trend" description="Stage mix of the funded book, last 12 months (synthetic history).">
            <StackedBarChart
              label="IFRS 9 stage mix trend"
              categories={history.map((h) => h.month)}
              series={[
                { name: "Stage 1", values: history.map((h) => h.stage1), tone: "success" },
                { name: "Stage 2", values: history.map((h) => h.stage2), tone: "warning" },
                { name: "Stage 3", values: history.map((h) => h.stage3), tone: "danger" },
              ]}
              valueFormatter={(v) => pct(v, 0)}
              height={240}
            />
          </Panel>
        </Grid>

        <Grid columns={{ base: 1, md: 2, xl: 4 }} gap="medium">
          <Panel title="WARR vs appetite" description={`New ${wNew.warr.toFixed(2)} · existing ${wOld.warr.toFixed(2)}`}>
            <Stack gap="small">
              <Sparkline values={history.map((h) => h.warr)} tone={warrStatus === "green" ? "success" : warrStatus === "amber" ? "warning" : "danger"} height={56} />
              <RagIndicator status={warrStatus} label={`${warr.warr.toFixed(2)} vs ceiling ${p.warrCeiling.value}`} />
              <Button as={Link} href="/portfolio/warr" variant="text" size="small">Migration matrix</Button>
            </Stack>
          </Panel>
          <Panel title="Capital adequacy trend" description="CAR, last 12 months.">
            <Stack gap="small">
              <Sparkline values={demoFeeds.carHistory} tone="info" height={56} />
              <RagIndicator status={demoFeeds.carPct < p.minCarPct.value ? "red" : demoFeeds.carPct < p.minCarPct.value + carBuffer ? "amber" : "green"} label={`${pct(demoFeeds.carPct)} vs ${p.minCarPct.value}% minimum`} />
              <Button as={Link} href="/ifrs9/icaap" variant="text" size="small">ICAAP</Button>
            </Stack>
          </Panel>
          <Panel title="Liquidity & NOP" description="Feeds from Market & Liquidity.">
            <Stack gap="small">
              <RagIndicator status={demoFeeds.liquidityRatioPct < liqMin ? "red" : "green"} label={`Liquidity ratio ${pct(demoFeeds.liquidityRatioPct)} (min ${liqMin}%)`} />
              <RagIndicator status={demoFeeds.ldrPct < ldrMin ? "red" : demoFeeds.ldrPct < ldrMin + ldrBuffer ? "amber" : "green"} label={`LDR ${pct(demoFeeds.ldrPct)} (min ${ldrMin}%)`} />
              <RagIndicator status={demoFeeds.nopToCapitalPct >= nopLimit ? "red" : "green"} label={`NOP ${pct(demoFeeds.nopToCapitalPct)} of capital (limit ${nopLimit}%)`} />
              <Button as={Link} href="/market-risk" variant="text" size="small">Market & liquidity</Button>
            </Stack>
          </Panel>
          <Panel title="Share-collateral margin" description={`CSCS mark-to-market after ${haircut}% haircut.`}>
            <Stack gap="small">
              <Text variant="figure" className="text-2xl">{margin.shortfalls.length} / {margin.count}</Text>
              <RagIndicator status={margin.shortfalls.length ? "amber" : "green"} label={margin.shortfalls.length ? `${margin.shortfalls.length} pledges in margin shortfall (${moneyShort(margin.shortfalls.reduce((a, r) => a + r.shortfall, 0))})` : "No shortfalls"} />
              <Button as={Link} href="/collateral" variant="text" size="small">Collateral register</Button>
            </Stack>
          </Panel>
        </Grid>

        <Grid columns={{ base: 1, lg: 3 }} gap="medium">
          <Panel title="Operational risk" description="KRI RAG scorecard and monthly loss trend.">
            <Stack gap="medium">
              <DonutChart label="Operational KRI RAG mix" showLegend centerLabel="KRIs" centerValue={String(demoFeeds.kriRag.green + demoFeeds.kriRag.amber + demoFeeds.kriRag.red)} segments={[{ label: "Green", value: demoFeeds.kriRag.green, tone: "success" }, { label: "Amber", value: demoFeeds.kriRag.amber, tone: "warning" }, { label: "Red", value: demoFeeds.kriRag.red, tone: "danger" }]} />
              <LineChart label="Operational loss trend" series={[{ name: "Losses", points: history.map((h, i) => ({ x: h.month, y: demoFeeds.opLossTrend[i] ?? 0 })), tone: "danger" }]} yFormatter={moneyShort} height={150} />
            </Stack>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2">Share of Business Wallet <PhaseBadge phase={2} /></span>} description="Portfolio mix across the four wallet positions.">
            <DonutChart label="Wallet position mix" showLegend segments={demoFeeds.walletMix.map((w, i) => ({ label: w.label, value: w.value, tone: (["success", "info", "warning", "neutral"] as const)[i] }))} valueFormatter={(v) => `${v}%`} />
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2">Peer benchmarking <PhaseBadge phase={2} /></span>} description="Outliers and trend/momentum flags.">
            <Stack gap="small">
              <Text variant="figure" className="text-2xl">{demoFeeds.peerOutliers}</Text>
              <Text variant="small">obligors outside the NGX sector inter-quartile range on two or more ratios</Text>
              <Text variant="figure" className="text-2xl">{demoFeeds.momentumFlags}</Text>
              <Text variant="small">negative momentum flags this quarter</Text>
              <Button as={Link} href="/credit-analysis/benchmarks" variant="text" size="small">Peer benchmarks</Button>
            </Stack>
          </Panel>
        </Grid>

        <Panel title="Drill down" description="Each tile opens the owning module.">
          <ActionBlocks
            columns={3}
            linkComponent={Link}
            items={[
              { title: "Portfolio & MIS", description: "Dashboards, limits, concentration", href: "/portfolio", icon: <BarChart3 aria-hidden /> },
              { title: "WARR & migration", description: `WARR ${warr.warr.toFixed(2)}`, href: "/portfolio/warr", icon: <GaugeIcon aria-hidden /> },
              { title: "Limits & breaches", description: `${breaches.length} breaches · ${nearBreaches.length} near`, href: "/portfolio/limits", icon: <ShieldAlert aria-hidden /> },
              { title: "IFRS 9 & ICAAP", description: `Stage 2 ${pct(totals.stageShare[2])}`, href: "/ifrs9", icon: <TrendingUp aria-hidden /> },
              { title: "Market & liquidity", description: `LDR ${pct(demoFeeds.ldrPct)}`, href: "/market-risk", icon: <Waves aria-hidden /> },
              { title: "Regulatory reports", description: "CBN returns & board packs", href: "/portfolio/reports", icon: <Landmark aria-hidden /> },
            ]}
          />
        </Panel>
        <Text variant="caption">Largest obligor exposure {top ? money(top.exposure) : "—"}. Capital, liquidity, market and operational values are demo feeds until the owning modules publish them.</Text>
      </Stack>
    </ModulePage>
  );
}

function GaugeTile({ label, sub, value, min = 0, max, bands, fmt, calc }: { label: string; sub: string; value: number; min?: number; max: number; bands: Array<{ to: number; tone: "success" | "warning" | "danger" }>; fmt: (v: number) => string; calc: Parameters<typeof CalcNote>[0] }) {
  const tone = bands.find((b) => value <= b.to)?.tone ?? "danger";
  return (
    <Card variant="filled" padding="small" className="flex flex-col items-center gap-2 text-center">
      <div className="-mb-4 flex w-full justify-end">
        <CalcNote {...calc} />
      </div>
      <Gauge value={Math.min(value, max)} min={min} max={max} bands={bands} label={label} valueFormatter={fmt} />
      <span className="inline-flex items-center gap-2">
        <Badge tone={ragTone[tone === "success" ? "green" : tone === "warning" ? "amber" : "red"]} variant="soft">{tone === "success" ? "Within appetite" : tone === "warning" ? "Early warning" : "Breach"}</Badge>
      </span>
      <Text variant="caption">{sub}</Text>
    </Card>
  );
}
