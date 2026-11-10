/**
 * Natural-language query console — deterministic intent matcher (PRD §6.13).
 * The prototype resolves a question against the platform's data dictionary with keyword rules and computes
 * the answer from the live mock data. No external AI service is called. BACKEND SEAM: replace `answerQuery`
 * with the NL→structured-query service; keep the `Answer` shape.
 */
import type { AuditEvent, Collateral, Facility, Obligor, Sector, User } from "@/lib/data/types";
import { roleById } from "@/lib/rbac/roles";
import { moneyShort, pct } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { MONTHS_48, baselEventTypes, fmtKri, netLoss, type LossEvent } from "../operational-risk/data";
import type { KriReading } from "../operational-risk/logic";
import { bestLag, pearson, round } from "../operational-risk/shared";
import { fmtMetric, type AppetiteMetric } from "../enterprise-risk/data";

export type QueryScope = "full" | "platform";
export type ValueFormat = "money" | "pct" | "num";

export type ChartSpec =
  | { kind: "bar"; data: { label: string; value: number }[]; format: ValueFormat; label: string }
  | { kind: "panels"; panels: { title: string; series: { name: string; points: { x: string; y: number }[]; tone?: "accent" | "info" | "warning" | "danger" | "success" }[]; format: ValueFormat }[] }
  | { kind: "stacked"; mode?: "stacked" | "grouped"; categories: string[]; series: { name: string; values: number[]; tone?: "success" | "warning" | "danger" | "info" | "accent" }[]; format: ValueFormat; label: string }
  | { kind: "donut"; segments: { label: string; value: number; tone?: "success" | "warning" | "danger" | "info" | "accent" | "neutral" }[]; centerLabel: string; centerValue: string };

export type Answer = {
  status: "answered";
  intent: string;
  title: string;
  narrative: string[];
  chart?: ChartSpec;
  table?: { columns: string[]; numeric?: boolean[]; rows: (string | number)[][] };
  sources: { label: string; detail?: string }[];
  structuredQuery: string;
  confidence: number;
  /** What data the answer touched (audit trail). */
  touched: string;
};
export type Refusal = { status: "refused"; intent: string; reason: string };
export type Unknown = { status: "unknown"; reason: string };
export type QueryResult = Answer | Refusal | Unknown;

export type QueryData = {
  obligors: Obligor[];
  facilities: Facility[];
  sectors: Sector[];
  collateral: Collateral[];
  users: User[];
  audit: AuditEvent[];
  lossEvents: LossEvent[];
  kris: KriReading[];
  appetite: (AppetiteMetric & { rag: "green" | "amber" | "red" })[];
};

export const MODEL_VERSION = "SER-NLQ 0.9 (simulated, rules-based)";

export const suggestedQuestions: { q: string; scope: QueryScope }[] = [
  { q: "Show resignation trend over the past 4 years and plot it against customer complaints", scope: "full" },
  { q: "Top 10 obligors by exposure in Manufacturing", scope: "full" },
  { q: "NPL ratio by branch", scope: "full" },
  { q: "Which facilities are past due or on the watchlist?", scope: "full" },
  { q: "Sector concentration against internal limits", scope: "full" },
  { q: "Which KRIs are Red or Amber?", scope: "full" },
  { q: "Operational losses by event type this year", scope: "full" },
  { q: "IFRS 9 stage distribution by exposure", scope: "full" },
  { q: "Which risk appetite metrics are in breach?", scope: "full" },
  { q: "Active users by role and MFA status", scope: "platform" },
  { q: "Audit activity in the last 7 days", scope: "platform" },
  { q: "Connector health status", scope: "platform" },
];

/** Data dictionary entries the console understands (§6.13: Section 8 metrics + every KRI). */
export const dataDictionary = [
  { area: "Risk Data Spine", items: ["Exposure / outstanding by obligor, sector, branch, product", "NPL ratio (Substandard + Doubtful + Lost ÷ total)", "Days past due, CBN classification, watchlist", "IFRS 9 stage", "Collateral perfection status"] },
  { area: "Operational risk (§6.9)", items: ["Every KRI series (48 months)", "Loss events by Basel event type, business line"] },
  { area: "Enterprise risk (§6.10)", items: ["Risk appetite metrics vs Board RAS"] },
  { area: "Platform (admin scope)", items: ["Users, roles, MFA", "Audit-trail activity", "Connector health"] },
];

const has = (q: string, ...words: (string | RegExp)[]) => words.some((w) => (typeof w === "string" ? q.includes(w) : w.test(q)));
const isNpl = (f: Facility) => f.cbnClass === "Substandard" || f.cbnClass === "Doubtful" || f.cbnClass === "Lost";
const live = (fs: Facility[]) => fs.filter((f) => f.status !== "Closed" && f.status !== "Written off");

const sectorAliases: [RegExp, string][] = [
  [/manufactur/, "SEC-MFG"],
  [/agric|agro|farm/, "SEC-AGR"],
  [/mining|quarr/, "SEC-MIN"],
  [/upstream/, "SEC-OGU"],
  [/downstream/, "SEC-OGD"],
  [/power|energy/, "SEC-PWR"],
  [/construct/, "SEC-CON"],
  [/real estate|property/, "SEC-RES"],
  [/commerce|trading|trade/, "SEC-COM"],
  [/transport|logistic|storage/, "SEC-TRN"],
  [/ict|telecom|information|technology/, "SEC-ICT"],
  [/financ|insurance/, "SEC-FIN"],
  [/educat/, "SEC-EDU"],
  [/health|pharma/, "SEC-HLT"],
  [/government|public sector|state/, "SEC-GOV"],
];

function topN(q: string, def = 10) {
  const m = q.match(/\b(?:top|largest|biggest)\s+(\d{1,2})\b/) ?? q.match(/\b(\d{1,2})\s+(?:largest|biggest|top)\b/);
  return m ? Math.max(1, Math.min(50, Number(m[1]))) : def;
}

const platformIntents = new Set(["users", "audit", "connectors"]);

export function answerQuery(question: string, scope: QueryScope, d: QueryData): QueryResult {
  const q = question.toLowerCase().trim();
  if (q.length < 3) return { status: "unknown", reason: "Type a question about the risk data." };

  const intent = detectIntent(q);
  if (!intent) return { status: "unknown", reason: "I couldn't map that question to the platform's data dictionary. Try one of the suggested questions, or name a metric such as exposure, NPL ratio, KRI, loss events or stage." };
  if (scope === "platform" && !platformIntents.has(intent))
    return { status: "refused", intent, reason: "Your query scope is limited to platform-health and configuration data. Customer-identifiable and financial risk data needs a separate entitlement (PRD §6.13)." };

  const builders: Record<string, () => Answer> = {
    attrition: () => attritionVsComplaints(q, d),
    top: () => topObligors(q, d),
    npl: () => nplBy(q, d),
    pastdue: () => pastDue(d),
    concentration: () => concentration(d),
    kri: () => kriStatus(d),
    losses: () => losses(d),
    stage: () => stages(d),
    appetite: () => appetite(d),
    collateral: () => collateralStatus(d),
    users: () => users(d),
    audit: () => auditActivity(d),
    connectors: () => connectors(),
  };
  return builders[intent]!();
}

function detectIntent(q: string): string | null {
  if (has(q, "resign", "attrition", "staff turnover") || (has(q, "complaint") && has(q, "staff", "trend"))) return "attrition";
  if (has(q, "appetite")) return "appetite";
  if (has(q, /\bkris?\b/, "key risk indicator")) return "kri";
  if (has(q, "loss event", "operational loss", "losses")) return "losses";
  if (has(q, "npl", "non-performing", "non performing")) return "npl";
  if (has(q, "past due", "overdue", "dpd", "watchlist", "covenant", "arrears")) return "pastdue";
  if (has(q, "concentration", "sector limit", "sectoral")) return "concentration";
  if (has(q, "stage", "ifrs", "ecl")) return "stage";
  if (has(q, "collateral", "perfection")) return "collateral";
  if (has(q, "top", "largest", "biggest") && has(q, "obligor", "borrower", "customer", "exposure", "client")) return "top";
  if (has(q, "exposure") && has(q, "obligor", "sector")) return "top";
  if (has(q, "user", "mfa", "login", "account")) return "users";
  if (has(q, "audit", "activity")) return "audit";
  if (has(q, "connector", "health", "integration", "uptime")) return "connectors";
  return null;
}

// ---------------------------------------------------------------- builders

function attritionVsComplaints(q: string, d: QueryData): Answer {
  const years = Number(q.match(/(\d)\s*years?/)?.[1] ?? 4);
  const n = Math.max(12, Math.min(48, years * 12));
  const a = d.kris.find((k) => k.id === "KRI-HC-01")!;
  const c = d.kris.find((k) => k.id === "KRI-CC-01")!;
  const xs = MONTHS_48.slice(-n);
  const as = a.history.slice(-n);
  const cs = c.history.slice(-n);
  const r = pearson(as, cs);
  const lag = bestLag(as, cs, 6);
  return {
    status: "answered",
    intent: "attrition",
    title: `Staff attrition vs customer complaints — last ${n / 12} years`,
    narrative: [
      `Staff attrition (rolling 12-month) moved from ${as[0]}% to ${as[as.length - 1]}% over ${n} months; customer complaints moved from ${cs[0]} to ${cs[cs.length - 1]} per 10,000 customers.`,
      `The two series are strongly correlated (r = ${r.toFixed(2)}). Complaints lag attrition by about ${lag.lag} month${lag.lag === 1 ? "" : "s"} (r = ${lag.r.toFixed(2)} at that lag), consistent with a service-quality effect of staff turnover. Complaints also peak each December (seasonality).`,
      "Correlation is not causation — the Operational Risk Analyst should validate before using this in reporting.",
    ],
    chart: {
      kind: "panels",
      panels: [
        { title: "Staff attrition rate (%) — KRI-HC-01", series: [{ name: "Attrition", points: xs.map((x, i) => ({ x, y: as[i]! })), tone: "accent" }], format: "pct" },
        { title: "Customer complaints per 10,000 — KRI-CC-01", series: [{ name: "Complaints", points: xs.map((x, i) => ({ x, y: cs[i]! })), tone: "info" }], format: "num" },
      ],
    },
    table: { columns: ["Month", "Attrition %", "Complaints / 10k"], numeric: [false, true, true], rows: xs.map((x, i) => [x, as[i]!, cs[i]!]).reverse() },
    sources: [
      { label: "KRI-HC-01 Staff attrition rate", detail: "HRIS connector · monthly" },
      { label: "KRI-CC-01 Customer complaints per 10,000", detail: "Complaints/CRM connector · monthly" },
    ],
    structuredQuery: `SELECT month, kri_hc_01.value AS attrition_pct, kri_cc_01.value AS complaints_per_10k\nFROM kri_series kri_hc_01 JOIN kri_series kri_cc_01 USING (month)\nWHERE month BETWEEN '${xs[0]}' AND '${xs[xs.length - 1]}'\n-- then: pearson(attrition, complaints), lag scan 0..6 months`,
    confidence: 0.86,
    touched: `KRI-HC-01, KRI-CC-01 (${n} months)`,
  };
}

function exposureByObligor(fs: Facility[]) {
  const m = new Map<string, number>();
  live(fs).forEach((f) => m.set(f.obligorId, (m.get(f.obligorId) ?? 0) + f.outstanding));
  return m;
}

function topObligors(q: string, d: QueryData): Answer {
  const n = topN(q);
  const sectorId = sectorAliases.find(([re]) => re.test(q))?.[1];
  const sector = d.sectors.find((s) => s.id === sectorId);
  const exp = exposureByObligor(d.facilities);
  const ranked = d.obligors
    .filter((o) => !sector || o.sectorId === sector.id)
    .map((o) => ({ o, e: exp.get(o.id) ?? 0 }))
    .filter((x) => x.e > 0)
    .sort((a, b) => b.e - a.e)
    .slice(0, n);
  const total = [...exp.values()].reduce((s, v) => s + v, 0);
  const subtotal = ranked.reduce((s, x) => s + x.e, 0);
  return {
    status: "answered",
    intent: "top",
    title: `Top ${ranked.length} obligors by exposure${sector ? ` — ${sector.name}` : ""}`,
    narrative: [
      `The top ${ranked.length} obligors${sector ? ` in ${sector.name}` : ""} hold ${moneyShort(subtotal)} of outstanding exposure — ${pct((subtotal / (total || 1)) * 100)} of the total loan book.`,
      ranked[0] ? `The largest is ${ranked[0].o.name} at ${moneyShort(ranked[0].e)} (risk grade ${ranked[0].o.riskGrade}${ranked[0].o.watchlist ? ", on the watchlist" : ""}).` : "No exposures found.",
    ],
    chart: { kind: "bar", data: ranked.map((x) => ({ label: x.o.name, value: x.e })), format: "money", label: "Exposure by obligor" },
    table: { columns: ["#", "Obligor", "Sector", "Branch", "Risk grade", "Exposure"], numeric: [true, false, false, false, true, true], rows: ranked.map((x, i) => [i + 1, x.o.name, d.sectors.find((s) => s.id === x.o.sectorId)?.name ?? "", x.o.branch, x.o.riskGrade, moneyShort(x.e)]) },
    sources: [{ label: "Risk Data Spine · Facility.outstanding", detail: `${live(d.facilities).length} live facilities` }, { label: "Risk Data Spine · Obligor.sectorId", detail: "Tenant sector taxonomy" }],
    structuredQuery: `SELECT o.name, SUM(f.outstanding) AS exposure\nFROM facility f JOIN obligor o ON o.id = f.obligor_id\nWHERE f.status NOT IN ('Closed','Written off')${sector ? `\n  AND o.sector_id = '${sector.id}'` : ""}\nGROUP BY o.name ORDER BY exposure DESC LIMIT ${n}`,
    confidence: sector || !/in\s+\w+/.test(q) ? 0.93 : 0.7,
    touched: `Facility, Obligor${sector ? ` (${sector.name})` : ""} — ${ranked.length} rows`,
  };
}

function nplBy(q: string, d: QueryData): Answer {
  const dim: "branch" | "sector" | "product" = has(q, "sector", "industry") ? "sector" : has(q, "product") ? "product" : "branch";
  const keyOf = (f: Facility) => (dim === "branch" ? f.branch : dim === "product" ? f.product : d.sectors.find((s) => s.id === d.obligors.find((o) => o.id === f.obligorId)?.sectorId)?.name ?? "Unknown");
  const groups = new Map<string, { total: number; npl: number }>();
  live(d.facilities).forEach((f) => {
    const g = groups.get(keyOf(f)) ?? { total: 0, npl: 0 };
    g.total += f.outstanding;
    if (isNpl(f)) g.npl += f.outstanding;
    groups.set(keyOf(f), g);
  });
  const rows = [...groups.entries()].map(([k, g]) => ({ k, ...g, ratio: (g.npl / (g.total || 1)) * 100 })).sort((a, b) => b.ratio - a.ratio);
  const tot = rows.reduce((s, r) => s + r.total, 0);
  const npl = rows.reduce((s, r) => s + r.npl, 0);
  const worst = rows[0];
  return {
    status: "answered",
    intent: "npl",
    title: `NPL ratio by ${dim}`,
    narrative: [
      `Portfolio NPL ratio is ${pct((npl / (tot || 1)) * 100, 2)} (${moneyShort(npl)} of ${moneyShort(tot)}).`,
      worst && worst.npl > 0 ? `${worst.k} has the highest NPL ratio at ${pct(worst.ratio, 2)}; ${rows.filter((r) => r.npl === 0).length} of ${rows.length} ${dim === "branch" ? "branches" : `${dim}s`} have no non-performing exposure.` : "No non-performing exposure in the book.",
    ],
    chart: { kind: "bar", data: rows.map((r) => ({ label: r.k, value: round(r.ratio, 2) })), format: "pct", label: `NPL ratio by ${dim}` },
    table: { columns: [dim[0]!.toUpperCase() + dim.slice(1), "Total exposure", "NPL exposure", "NPL ratio"], numeric: [false, true, true, true], rows: rows.map((r) => [r.k, moneyShort(r.total), moneyShort(r.npl), pct(r.ratio, 2)]) },
    sources: [{ label: "Risk Data Spine · Facility.cbnClass", detail: "NPL = Substandard + Doubtful + Lost" }, { label: "Risk Data Spine · Facility.outstanding" }],
    structuredQuery: `SELECT ${dim}, SUM(outstanding) AS total,\n  SUM(CASE WHEN cbn_class IN ('Substandard','Doubtful','Lost') THEN outstanding END) AS npl,\n  npl / total AS npl_ratio\nFROM facility WHERE status NOT IN ('Closed','Written off')\nGROUP BY ${dim} ORDER BY npl_ratio DESC`,
    confidence: 0.94,
    touched: `Facility (${live(d.facilities).length} rows) grouped by ${dim}`,
  };
}

function pastDue(d: QueryData): Answer {
  const obl = new Map(d.obligors.map((o) => [o.id, o]));
  const list = live(d.facilities)
    .filter((f) => f.dpd > 0 || obl.get(f.obligorId)?.watchlist)
    .sort((a, b) => b.dpd - a.dpd);
  const buckets = [
    { label: "1–29 days", test: (f: Facility) => f.dpd > 0 && f.dpd < 30 },
    { label: "30–89 days", test: (f: Facility) => f.dpd >= 30 && f.dpd < 90 },
    { label: "90–179 days", test: (f: Facility) => f.dpd >= 90 && f.dpd < 180 },
    { label: "180+ days", test: (f: Facility) => f.dpd >= 180 },
    { label: "Watchlist, current", test: (f: Facility) => f.dpd === 0 },
  ];
  return {
    status: "answered",
    intent: "pastdue",
    title: "Facilities past due or on the watchlist",
    narrative: [
      `${list.length} facilities totalling ${moneyShort(list.reduce((s, f) => s + f.outstanding, 0))} are past due or belong to watchlisted obligors; ${list.filter((f) => f.dpd >= 90).length} are 90+ days past due.`,
      "Covenant test results are owned by Loan Review & Monitoring (§6.4) — open the Covenants page for covenant-level breaches.",
    ],
    chart: { kind: "bar", data: buckets.map((b) => ({ label: b.label, value: list.filter(b.test).reduce((s, f) => s + f.outstanding, 0) })), format: "money", label: "Exposure by days-past-due bucket" },
    table: { columns: ["Facility", "Obligor", "Product", "DPD", "CBN class", "Outstanding"], numeric: [false, false, false, true, false, true], rows: list.map((f) => [f.id, obl.get(f.obligorId)?.name ?? f.obligorId, f.product, f.dpd, f.cbnClass, moneyShort(f.outstanding)]) },
    sources: [{ label: "Risk Data Spine · Facility.dpd, cbnClass" }, { label: "Risk Data Spine · Obligor.watchlist" }],
    structuredQuery: "SELECT f.id, o.name, f.product, f.dpd, f.cbn_class, f.outstanding\nFROM facility f JOIN obligor o ON o.id = f.obligor_id\nWHERE f.status NOT IN ('Closed','Written off') AND (f.dpd > 0 OR o.watchlist)\nORDER BY f.dpd DESC",
    confidence: 0.9,
    touched: `Facility, Obligor — ${list.length} rows`,
  };
}

function concentration(d: QueryData): Answer {
  const obl = new Map(d.obligors.map((o) => [o.id, o]));
  const lf = live(d.facilities);
  const total = lf.reduce((s, f) => s + f.outstanding, 0) || 1;
  const rows = d.sectors
    .map((s) => {
      const e = lf.filter((f) => obl.get(f.obligorId)?.sectorId === s.id).reduce((a, f) => a + f.outstanding, 0);
      return { s, e, share: (e / total) * 100 };
    })
    .sort((a, b) => b.share / b.s.limitPct - a.share / a.s.limitPct);
  const breaches = rows.filter((r) => r.share > r.s.limitPct);
  return {
    status: "answered",
    intent: "concentration",
    title: "Sector concentration against internal limits",
    narrative: [
      breaches.length ? `${breaches.length} sector${breaches.length > 1 ? "s are" : " is"} above the internal concentration limit: ${breaches.map((b) => `${b.s.name} ${pct(b.share)} vs ${b.s.limitPct}%`).join("; ")}.` : "All sectors are within internal limits.",
      `Near-breaches (≥ 90% of limit): ${rows.filter((r) => r.share <= r.s.limitPct && r.share >= 0.9 * r.s.limitPct).map((r) => r.s.name).join(", ") || "none"}. Government exposure is also tested against the 10% CBN ceiling (CBN 3.2(c)).`,
    ],
    chart: { kind: "stacked", mode: "grouped", categories: rows.map((r) => r.s.name), series: [{ name: "Share of book %", values: rows.map((r) => round(r.share, 1)), tone: "accent" }, { name: "Internal limit %", values: rows.map((r) => r.s.limitPct), tone: "info" }], format: "pct", label: "Sector share vs limit" },
    table: { columns: ["Sector", "Exposure", "Share of book", "Limit", "Utilisation"], numeric: [false, true, true, true, true], rows: rows.map((r) => [r.s.name, moneyShort(r.e), pct(r.share), `${r.s.limitPct}%`, pct((r.share / r.s.limitPct) * 100, 0)]) },
    sources: [{ label: "Risk Data Spine · Facility.outstanding by Obligor.sectorId" }, { label: "Rules & Parameters · sector limits", detail: "Tenant taxonomy (§6.6.1)" }],
    structuredQuery: "SELECT s.name, SUM(f.outstanding) / total_book AS share, s.limit_pct\nFROM facility f JOIN obligor o ON o.id = f.obligor_id JOIN sector s ON s.id = o.sector_id\nGROUP BY s.name, s.limit_pct ORDER BY share / s.limit_pct DESC",
    confidence: 0.92,
    touched: `Facility, Obligor, Sector — ${rows.length} sectors`,
  };
}

function kriStatus(d: QueryData): Answer {
  const list = d.kris.filter((k) => k.rag !== "green").sort((a, b) => (a.rag === b.rag ? 0 : a.rag === "red" ? -1 : 1));
  return {
    status: "answered",
    intent: "kri",
    title: "KRIs outside appetite",
    narrative: [
      `${d.kris.filter((k) => k.rag === "red").length} KRIs are Red and ${d.kris.filter((k) => k.rag === "amber").length} Amber out of ${d.kris.length} monitored.`,
      list[0] ? `Most severe: ${list[0].name} at ${fmtKri(list[0], list[0].current)} (Red from ${fmtKri(list[0], list[0].red)}), escalated to Level ${list[0].level}.` : "All KRIs are Green.",
    ],
    chart: { kind: "donut", segments: [{ label: "Green", value: d.kris.filter((k) => k.rag === "green").length, tone: "success" }, { label: "Amber", value: d.kris.filter((k) => k.rag === "amber").length, tone: "warning" }, { label: "Red", value: d.kris.filter((k) => k.rag === "red").length, tone: "danger" }], centerLabel: "KRIs", centerValue: String(d.kris.length) },
    table: { columns: ["KRI", "Category", "Current", "Amber / Red", "Status", "Escalation"], rows: list.map((k) => [k.name, k.category, fmtKri(k, k.current), `${fmtKri(k, k.amber)} / ${fmtKri(k, k.red)}`, k.rag === "red" ? "Red" : "Amber", `Level ${k.level}`]) },
    sources: [{ label: "Operational Risk KRI framework (§6.9.1)", detail: `${d.kris.length} KRIs, thresholds in force` }],
    structuredQuery: "SELECT kri_id, name, category, current_value, amber_from, red_from, rag, escalation_level\nFROM kri_reading WHERE period = '2026-10' AND rag <> 'Green'\nORDER BY rag DESC",
    confidence: 0.95,
    touched: `KRI readings — ${d.kris.length} rows`,
  };
}

function losses(d: QueryData): Answer {
  const ytd = d.lossEvents.filter((e) => new Date(e.discoveredAt).getFullYear() === 2026);
  const rows = baselEventTypes.map((t) => {
    const ev = ytd.filter((e) => e.eventType === t);
    return { t, n: ev.length, gross: ev.reduce((s, e) => s + e.grossLoss, 0), net: ev.reduce((s, e) => s + netLoss(e), 0) };
  }).sort((a, b) => b.net - a.net);
  const net = rows.reduce((s, r) => s + r.net, 0);
  return {
    status: "answered",
    intent: "losses",
    title: "Operational losses by event type — 2026 year to date",
    narrative: [`${ytd.length} events (${ytd.filter((e) => e.nearMiss).length} near misses) with net loss of ${moneyShort(net)} year to date.`, rows[0] ? `${rows[0].t} accounts for ${pct((rows[0].net / (net || 1)) * 100)} of net loss.` : ""],
    chart: { kind: "bar", data: rows.filter((r) => r.net > 0).map((r) => ({ label: r.t, value: r.net })), format: "money", label: "Net loss by event type" },
    table: { columns: ["Event type", "Events", "Gross loss", "Net loss"], numeric: [false, true, true, true], rows: rows.map((r) => [r.t, r.n, moneyShort(r.gross), moneyShort(r.net)]) },
    sources: [{ label: "Loss-event register (§6.9.2)", detail: `${d.lossEvents.length} events` }],
    structuredQuery: "SELECT event_type, COUNT(*), SUM(gross_loss), SUM(gross_loss - recovery) AS net_loss\nFROM loss_event WHERE discovered_at >= '2026-01-01'\nGROUP BY event_type ORDER BY net_loss DESC",
    confidence: 0.93,
    touched: `Loss events — ${ytd.length} rows`,
  };
}

function stages(d: QueryData): Answer {
  const lf = live(d.facilities);
  const by = [1, 2, 3].map((s) => ({ s, n: lf.filter((f) => f.stage === s).length, e: lf.filter((f) => f.stage === s).reduce((a, f) => a + f.outstanding, 0) }));
  const tot = by.reduce((a, b) => a + b.e, 0) || 1;
  return {
    status: "answered",
    intent: "stage",
    title: "IFRS 9 stage distribution by exposure",
    narrative: [`Stage 1 holds ${pct((by[0]!.e / tot) * 100)} of exposure; Stage 2 ${pct((by[1]!.e / tot) * 100)} (${by[1]!.n} facilities) and Stage 3 ${pct((by[2]!.e / tot) * 100)} (${by[2]!.n} facilities).`, "Stage is assigned from DPD and watchlist status in the prototype; the IFRS 9 module (§6.7) owns the staging rules."],
    chart: { kind: "donut", segments: by.map((b) => ({ label: `Stage ${b.s}`, value: b.e, tone: b.s === 1 ? "success" : b.s === 2 ? "warning" : "danger" })), centerLabel: "Exposure", centerValue: moneyShort(tot) },
    table: { columns: ["Stage", "Facilities", "Exposure", "Share"], numeric: [false, true, true, true], rows: by.map((b) => [`Stage ${b.s}`, b.n, moneyShort(b.e), pct((b.e / tot) * 100)]) },
    sources: [{ label: "Risk Data Spine · Facility.stage" }],
    structuredQuery: "SELECT stage, COUNT(*), SUM(outstanding) FROM facility\nWHERE status NOT IN ('Closed','Written off') GROUP BY stage",
    confidence: 0.9,
    touched: `Facility — ${lf.length} rows`,
  };
}

function appetite(d: QueryData): Answer {
  const list = [...d.appetite].sort((a, b) => (a.rag === b.rag ? 0 : a.rag === "red" ? -1 : b.rag === "red" ? 1 : a.rag === "amber" ? -1 : 1));
  const reds = list.filter((m) => m.rag === "red");
  return {
    status: "answered",
    intent: "appetite",
    title: "Risk appetite metrics vs Board RAS",
    narrative: [reds.length ? `${reds.length} metric${reds.length > 1 ? "s are" : " is"} in breach: ${reds.map((m) => `${m.name} (${fmtMetric(m, m.actual)} vs ${m.direction === "max" ? "≤" : "≥"} ${fmtMetric(m, m.limit)})`).join("; ")}.` : "No appetite breaches.", `${list.filter((m) => m.rag === "amber").length} metrics are in early warning.`],
    chart: { kind: "donut", segments: [{ label: "Green", value: list.filter((m) => m.rag === "green").length, tone: "success" }, { label: "Amber", value: list.filter((m) => m.rag === "amber").length, tone: "warning" }, { label: "Red", value: reds.length, tone: "danger" }], centerLabel: "Metrics", centerValue: String(list.length) },
    table: { columns: ["Metric", "Type", "Appetite", "Actual", "Status"], rows: list.map((m) => [m.name, m.type, `${m.direction === "max" ? "≤" : "≥"} ${fmtMetric(m, m.limit)}`, fmtMetric(m, m.actual), m.rag[0]!.toUpperCase() + m.rag.slice(1)]) },
    sources: [{ label: "ERM risk appetite scorecard (§6.10)", detail: "RAS 2026.1" }],
    structuredQuery: "SELECT metric, type, appetite_limit, actual, rag FROM risk_appetite_scorecard\nWHERE ras_version = 'RAS 2026.1' ORDER BY rag DESC",
    confidence: 0.91,
    touched: `Risk appetite scorecard — ${list.length} rows`,
  };
}

function collateralStatus(d: QueryData): Answer {
  const statuses = ["Not started", "Search in progress", "Documentation", "Registration", "Perfected", "Defective"] as const;
  const rows = statuses.map((s) => ({ s, n: d.collateral.filter((c) => c.perfection === s).length, v: d.collateral.filter((c) => c.perfection === s).reduce((a, c) => a + c.marketValue, 0) }));
  const pending = rows.filter((r) => r.s !== "Perfected");
  return {
    status: "answered",
    intent: "collateral",
    title: "Collateral perfection status",
    narrative: [`${pending.reduce((a, r) => a + r.n, 0)} of ${d.collateral.length} collateral items are not yet perfected (${moneyShort(pending.reduce((a, r) => a + r.v, 0))} market value); ${rows.find((r) => r.s === "Defective")!.n} are defective.`],
    chart: { kind: "bar", data: rows.map((r) => ({ label: r.s, value: r.n })), format: "num", label: "Collateral items by perfection status" },
    table: { columns: ["Perfection status", "Items", "Market value"], numeric: [false, true, true], rows: rows.map((r) => [r.s, r.n, moneyShort(r.v)]) },
    sources: [{ label: "Risk Data Spine · Collateral.perfection, marketValue" }],
    structuredQuery: "SELECT perfection, COUNT(*), SUM(market_value) FROM collateral GROUP BY perfection",
    confidence: 0.92,
    touched: `Collateral — ${d.collateral.length} rows`,
  };
}

function users(d: QueryData): Answer {
  const by = new Map<string, { n: number; mfa: number; pending: number }>();
  d.users.forEach((u) => {
    const k = roleById[u.roleId]?.name ?? u.roleId;
    const g = by.get(k) ?? { n: 0, mfa: 0, pending: 0 };
    g.n++;
    if (u.mfa) g.mfa++;
    if (u.status === "Pending") g.pending++;
    by.set(k, g);
  });
  const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n);
  const noMfa = d.users.filter((u) => !u.mfa).length;
  return {
    status: "answered",
    intent: "users",
    title: "Users by role and MFA status",
    narrative: [`${d.users.length} user accounts across ${rows.length} roles; ${d.users.filter((u) => u.status === "Active").length} active.`, noMfa ? `${noMfa} account${noMfa > 1 ? "s have" : " has"} no MFA enrolled — MFA is mandatory on all logins (§10.1).` : "All accounts have MFA enrolled."],
    chart: { kind: "bar", data: rows.slice(0, 12).map(([k, g]) => ({ label: k, value: g.n })), format: "num", label: "Users by role" },
    table: { columns: ["Role", "Users", "MFA enrolled", "Pending"], numeric: [false, true, true, true], rows: rows.map(([k, g]) => [k, g.n, g.mfa, g.pending]) },
    sources: [{ label: "Identity & access · User, Role", detail: "Configuration data — no customer data" }],
    structuredQuery: "SELECT role, COUNT(*), SUM(mfa::int), SUM((status = 'Pending')::int)\nFROM app_user GROUP BY role ORDER BY 2 DESC",
    confidence: 0.96,
    touched: `Users — ${d.users.length} rows`,
  };
}

function auditActivity(d: QueryData): Answer {
  const since = DEMO_NOW.getTime() - 7 * 86_400_000;
  const recent = d.audit.filter((a) => Date.parse(a.at) >= since || Date.parse(a.at) > DEMO_NOW.getTime());
  const by = new Map<string, number>();
  recent.forEach((a) => by.set(a.action, (by.get(a.action) ?? 0) + 1));
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
  return {
    status: "answered",
    intent: "audit",
    title: "Audit-trail activity — last 7 days",
    narrative: [`${recent.length} audit events recorded in the last 7 days across ${rows.length} action types.`, rows[0] ? `Most frequent: “${rows[0][0]}” (${rows[0][1]}).` : ""],
    chart: { kind: "bar", data: rows.slice(0, 10).map(([k, v]) => ({ label: k, value: v })), format: "num", label: "Audit events by action" },
    table: { columns: ["Action", "Events"], numeric: [false, true], rows: rows.map(([k, v]) => [k, v]) },
    sources: [{ label: "Immutable audit log (§10.1)", detail: "Actions only — entity payloads not returned" }],
    structuredQuery: "SELECT action, COUNT(*) FROM audit_event\nWHERE at >= now() - interval '7 days' GROUP BY action ORDER BY 2 DESC",
    confidence: 0.95,
    touched: `Audit events — ${recent.length} rows (metadata only)`,
  };
}

function connectors(): Answer {
  const list: [string, string, number, string][] = [
    ["Core Banking (CBA)", "Healthy", 99.94, "2 min ago"],
    ["Credit Bureau + CRMS", "Healthy", 99.6, "14 min ago"],
    ["Other-bank statements", "Degraded", 97.8, "1 h ago"],
    ["SEC / CSCS registry", "Healthy", 99.5, "6 min ago"],
    ["HRIS", "Healthy", 99.9, "3 h ago"],
    ["SIEM / security tooling", "Healthy", 99.97, "1 min ago"],
    ["Treasury / FX", "Healthy", 99.8, "5 min ago"],
    ["CBN circulars feed", "Healthy", 100, "4 h ago"],
  ];
  return {
    status: "answered",
    intent: "connectors",
    title: "Connector health (simulated)",
    narrative: [`${list.filter((c) => c[1] === "Healthy").length} of ${list.length} connectors are healthy; ${list.filter((c) => c[1] !== "Healthy").map((c) => c[0]).join(", ")} is degraded.`, "Connector telemetry is simulated in this prototype."],
    chart: { kind: "bar", data: list.map((c) => ({ label: c[0], value: c[2] })), format: "pct", label: "30-day availability by connector" },
    table: { columns: ["Connector", "Status", "30-day availability", "Last sync"], numeric: [false, false, true, false], rows: list.map((c) => [c[0], c[1], `${c[2]}%`, c[3]]) },
    sources: [{ label: "Staging / reconciliation layer telemetry (§5)", detail: "Platform-health data" }],
    structuredQuery: "SELECT connector, status, availability_30d, last_sync_at FROM connector_health",
    confidence: 0.97,
    touched: "Connector health — 8 rows",
  };
}
