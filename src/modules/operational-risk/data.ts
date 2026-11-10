/**
 * Operational Risk module data (PRD §6.9): KRI framework (§6.9.1), indicator inventory (§6.9.2),
 * loss-event register, RCSA and BCM. Deterministic demo data. The `amber`/`red`, RTO/RPO values here are only the
 * DEFAULTS of the business rules registered in ../platform.ts — read live values through logic.ts, never these fields.
 */
import { format } from "date-fns";
import { branches, DEMO_NOW } from "@/lib/data/seed";
import { isoDaysAgo, isoDaysAhead, monthLabels, rng, round, type Rag } from "./shared";

// ---------------------------------------------------------------- Indicator categories (§6.9.2)

export type IndicatorCategory =
  | "Staff / Human Capital"
  | "Security Incidents"
  | "Transaction Processing Quality"
  | "Systems & Technology"
  | "Regulatory Breaches"
  | "Cyber Intrusions & Attacks"
  | "Customer Complaints"
  | "Loss Events";

export const indicatorCategories: { name: IndicatorCategory; source: string; metrics: string }[] = [
  { name: "Staff / Human Capital", source: "HR Information System (HRIS) connector", metrics: "Headcount, attrition/resignation rate, vacancy ageing, span of control" },
  { name: "Security Incidents", source: "Security/incident-management connector or manual logging", metrics: "Physical-security incidents, access-control violations, severity, resolution time" },
  { name: "Transaction Processing Quality", source: "CBA transaction-processing logs", metrics: "Error rate by channel/product, reversal/exception rate, time-to-correct" },
  { name: "Systems & Technology", source: "Core banking and channel-system monitoring logs (IT connector)", metrics: "Downtime/availability, failed transactions by channel, batch-job failures" },
  { name: "Regulatory Breaches", source: "ERM regulatory-breach register (§6.10)", metrics: "Count and severity of breaches by policy area" },
  { name: "Cyber Intrusions & Attacks", source: "SIEM / cybersecurity-tooling connector", metrics: "Attempted/successful intrusions, attack vector, MTTD/MTTC" },
  { name: "Customer Complaints", source: "Complaints/CRM connector or CBA complaints module", metrics: "Volume and category, resolution time, repeat-complaint rate" },
  { name: "Loss Events", source: "Loss-event register (sanctions-for-breach §6.3.2, ERM breach register, direct logging)", metrics: "Losses/near-misses vs Loss Limit Framework thresholds" },
];

// ---------------------------------------------------------------- KRIs (§6.9.1)

export type KriFrequency = "Daily" | "Weekly" | "Monthly" | "Quarterly";

export type Kri = {
  id: string;
  name: string;
  category: IndicatorCategory;
  owner: string;
  ownerTitle: string;
  formula: string;
  sourceSystem: string;
  frequency: KriFrequency;
  businessLine: string;
  /** RCSA control this KRI traces back to. */
  controlId: string;
  unit: string;
  /** Board-reported KRI (vs tracked operationally only). */
  boardReported: boolean;
  /** Amber from (early warning). */
  amber: number;
  /** Red from (breach of Board-approved tolerance). */
  red: number;
  /** true = higher readings are worse. */
  higherIsWorse: boolean;
  /** 48 monthly readings (Nov 2022 – Oct 2026). */
  history: number[];
  decimals: number;
};

type KriSpec = Omit<Kri, "history"> & { start: number; end: number; season: number; noise: number; seed: number };

const specs: KriSpec[] = [
  { id: "KRI-HC-01", name: "Staff attrition rate (rolling 12-month)", category: "Staff / Human Capital", owner: "Adaeze Okonkwo", ownerTitle: "Head, Human Resources", formula: "Resignations + exits in last 12 months ÷ average headcount × 100", sourceSystem: "HRIS connector", frequency: "Monthly", businessLine: "Group-wide", controlId: "CTL-HC-01", unit: "%", boardReported: true, amber: 12, red: 16, higherIsWorse: true, start: 8.4, end: 16.4, season: 0.5, noise: 0.35, seed: 11, decimals: 1 },
  { id: "KRI-HC-02", name: "Critical-role vacancies open > 60 days", category: "Staff / Human Capital", owner: "Adaeze Okonkwo", ownerTitle: "Head, Human Resources", formula: "Count of approved critical-role vacancies with ageing > 60 days (threshold configurable)", sourceSystem: "HRIS connector", frequency: "Monthly", businessLine: "Group-wide", controlId: "CTL-HC-02", unit: "roles", boardReported: false, amber: 4, red: 7, higherIsWorse: true, start: 2, end: 5, season: 0.4, noise: 0.6, seed: 12, decimals: 0 },
  { id: "KRI-SEC-01", name: "Physical-security incidents", category: "Security Incidents", owner: "Ibrahim Danjuma", ownerTitle: "Chief Security Officer", formula: "Branch/vault breaches + robbery attempts recorded in the month", sourceSystem: "Incident-management connector", frequency: "Monthly", businessLine: "Branch network", controlId: "CTL-SEC-01", unit: "incidents", boardReported: true, amber: 3, red: 5, higherIsWorse: true, start: 2, end: 1, season: 0.6, noise: 0.7, seed: 13, decimals: 0 },
  { id: "KRI-SEC-02", name: "Access-control violations", category: "Security Incidents", owner: "Ibrahim Danjuma", ownerTitle: "Chief Security Officer", formula: "Unauthorised access attempts to restricted zones (badge/biometric logs)", sourceSystem: "Manual logging", frequency: "Monthly", businessLine: "Branch network", controlId: "CTL-SEC-02", unit: "violations", boardReported: false, amber: 6, red: 10, higherIsWorse: true, start: 5, end: 4, season: 0.8, noise: 1, seed: 14, decimals: 0 },
  { id: "KRI-TPQ-01", name: "Transaction error rate (all channels)", category: "Transaction Processing Quality", owner: "Chinedu Eze", ownerTitle: "Head, Operations", formula: "Errors ÷ transactions processed × 10,000", sourceSystem: "CBA transaction-processing logs", frequency: "Daily", businessLine: "Operations", controlId: "CTL-TPQ-01", unit: "per 10k", boardReported: true, amber: 4, red: 6, higherIsWorse: true, start: 2.6, end: 4.4, season: 0.4, noise: 0.25, seed: 15, decimals: 1 },
  { id: "KRI-TPQ-02", name: "Reversal / exception rate", category: "Transaction Processing Quality", owner: "Chinedu Eze", ownerTitle: "Head, Operations", formula: "Reversed or exception entries ÷ total entries × 100 (cross-referenced with COP reversal exclusion, §5.1)", sourceSystem: "CBA transaction-processing logs", frequency: "Weekly", businessLine: "Operations", controlId: "CTL-TPQ-02", unit: "%", boardReported: false, amber: 0.8, red: 1.2, higherIsWorse: true, start: 0.55, end: 0.62, season: 0.05, noise: 0.05, seed: 16, decimals: 2 },
  { id: "KRI-SYS-01", name: "Core banking downtime (% of scheduled uptime)", category: "Systems & Technology", owner: "Olumide Bakare", ownerTitle: "Chief Information Officer", formula: "Unplanned downtime minutes ÷ scheduled uptime minutes × 100", sourceSystem: "IT monitoring connector", frequency: "Daily", businessLine: "Technology", controlId: "CTL-SYS-01", unit: "%", boardReported: true, amber: 0.5, red: 1, higherIsWorse: true, start: 0.42, end: 1.18, season: 0.06, noise: 0.06, seed: 17, decimals: 2 },
  { id: "KRI-SYS-02", name: "Failed transactions — mobile banking", category: "Systems & Technology", owner: "Olumide Bakare", ownerTitle: "Chief Information Officer", formula: "Failed mobile transactions ÷ attempted × 100", sourceSystem: "Channel monitoring logs", frequency: "Daily", businessLine: "Retail banking", controlId: "CTL-SYS-02", unit: "%", boardReported: false, amber: 2.5, red: 4, higherIsWorse: true, start: 2.9, end: 2.1, season: 0.3, noise: 0.2, seed: 18, decimals: 1 },
  { id: "KRI-SYS-03", name: "Batch-job failure rate", category: "Systems & Technology", owner: "Olumide Bakare", ownerTitle: "Chief Information Officer", formula: "Failed end-of-day batch jobs ÷ scheduled jobs × 100", sourceSystem: "IT monitoring connector", frequency: "Daily", businessLine: "Technology", controlId: "CTL-SYS-03", unit: "%", boardReported: false, amber: 1.5, red: 3, higherIsWorse: true, start: 1.1, end: 0.9, season: 0.15, noise: 0.15, seed: 19, decimals: 1 },
  { id: "KRI-REG-01", name: "Regulatory breaches identified (quarter to date)", category: "Regulatory Breaches", owner: "Funmilayo Adeyemi", ownerTitle: "Chief Compliance Officer", formula: "Breaches/infractions identified internally or by examiners, by policy area", sourceSystem: "ERM regulatory-breach register", frequency: "Quarterly", businessLine: "Group-wide", controlId: "CTL-REG-01", unit: "breaches", boardReported: true, amber: 2, red: 4, higherIsWorse: true, start: 2, end: 3, season: 0.3, noise: 0.6, seed: 20, decimals: 0 },
  { id: "KRI-CYB-01", name: "Cyber mean time to detect (MTTD)", category: "Cyber Intrusions & Attacks", owner: "Tunde Afolabi", ownerTitle: "Chief Information Security Officer", formula: "Average hours from intrusion start to detection (confirmed incidents)", sourceSystem: "SIEM connector", frequency: "Monthly", businessLine: "Technology", controlId: "CTL-CYB-01", unit: "hours", boardReported: true, amber: 24, red: 48, higherIsWorse: true, start: 38, end: 18, season: 2, noise: 3, seed: 21, decimals: 0 },
  { id: "KRI-CYB-02", name: "Cyber mean time to contain (MTTC)", category: "Cyber Intrusions & Attacks", owner: "Tunde Afolabi", ownerTitle: "Chief Information Security Officer", formula: "Average hours from detection to containment (confirmed incidents)", sourceSystem: "SIEM connector", frequency: "Monthly", businessLine: "Technology", controlId: "CTL-CYB-02", unit: "hours", boardReported: false, amber: 8, red: 16, higherIsWorse: true, start: 11, end: 6.5, season: 0.6, noise: 0.8, seed: 22, decimals: 1 },
  { id: "KRI-CYB-03", name: "Phishing click-through rate (simulations)", category: "Cyber Intrusions & Attacks", owner: "Tunde Afolabi", ownerTitle: "Chief Information Security Officer", formula: "Staff who clicked ÷ staff targeted in phishing simulation × 100", sourceSystem: "SIEM connector", frequency: "Monthly", businessLine: "Group-wide", controlId: "CTL-CYB-03", unit: "%", boardReported: false, amber: 6, red: 10, higherIsWorse: true, start: 9.5, end: 5.4, season: 0.5, noise: 0.5, seed: 23, decimals: 1 },
  { id: "KRI-CC-01", name: "Customer complaints per 10,000 customers", category: "Customer Complaints", owner: "Ngozi Ibe", ownerTitle: "Head, Customer Experience", formula: "Complaints logged in the month ÷ active customers × 10,000", sourceSystem: "Complaints/CRM connector", frequency: "Monthly", businessLine: "Retail banking", controlId: "CTL-CC-01", unit: "per 10k", boardReported: true, amber: 30, red: 40, higherIsWorse: true, start: 0, end: 0, season: 0, noise: 0, seed: 24, decimals: 1 },
  { id: "KRI-CC-02", name: "Repeat-complaint rate", category: "Customer Complaints", owner: "Ngozi Ibe", ownerTitle: "Head, Customer Experience", formula: "Customers with ≥ 2 complaints in 90 days ÷ complaining customers × 100", sourceSystem: "Complaints/CRM connector", frequency: "Monthly", businessLine: "Retail banking", controlId: "CTL-CC-02", unit: "%", boardReported: false, amber: 12, red: 18, higherIsWorse: true, start: 9, end: 11.2, season: 0.6, noise: 0.5, seed: 25, decimals: 1 },
  { id: "KRI-LE-01", name: "Operational loss vs monthly loss limit", category: "Loss Events", owner: "Operational Risk Analyst", ownerTitle: "Operational Risk", formula: "Net operational loss in the month ÷ monthly loss limit (Loss Limit Framework) × 100", sourceSystem: "Loss-event register", frequency: "Monthly", businessLine: "Group-wide", controlId: "CTL-LE-01", unit: "% of limit", boardReported: true, amber: 75, red: 100, higherIsWorse: true, start: 0, end: 0, season: 0, noise: 0, seed: 26, decimals: 0 },
];

function series(spec: KriSpec): number[] {
  const r = rng(spec.seed * 7919);
  const n = 48;
  return Array.from({ length: n }, (_, i) => {
    if (i === n - 1) return spec.end;
    const base = spec.start + ((spec.end - spec.start) * i) / (n - 1);
    const v = base + spec.season * Math.sin((2 * Math.PI * (i + 1)) / 12) + spec.noise * (r.next() * 2 - 1);
    return Math.max(0, round(v, spec.decimals));
  });
}

const attrition = series(specs[0]!);
/** Complaints track attrition with a ~2-month lag plus a December peak (seasonality the AI layer detects, §6.9.2). */
function complaintsSeries(): number[] {
  const r = rng(424242);
  return attrition.map((_, i) => {
    const lagged = attrition[Math.max(0, i - 2)]!;
    const month = (10 + i) % 12; // index 0 = Nov
    const peak = month === 11 ? 4.5 : month === 0 ? 2 : 0;
    return round(6 + 1.95 * lagged + peak + (r.next() * 2 - 1) * 1.4, 1);
  });
}

export const MONTHS_48 = monthLabels(48);

// Loss events need to exist before KRI-LE-01 history can be computed — defined below and patched in.
function toKri(spec: KriSpec): Omit<Kri, "history"> {
  const k: Partial<KriSpec> = { ...spec };
  delete k.start;
  delete k.end;
  delete k.season;
  delete k.noise;
  delete k.seed;
  return k as Omit<Kri, "history">;
}

export const kris: Kri[] = specs.map((spec) => toKri(spec)).map((k) => ({
  ...k,
  history: k.id === "KRI-CC-01" ? complaintsSeries() : k.id === "KRI-HC-01" ? attrition : series(specs.find((s) => s.id === k.id)!),
}));

export function kriRag(k: Pick<Kri, "amber" | "red" | "higherIsWorse">, value: number): Rag {
  if (k.higherIsWorse) return value >= k.red ? "red" : value >= k.amber ? "amber" : "green";
  return value <= k.red ? "red" : value <= k.amber ? "amber" : "green";
}

/** Consecutive months (ending now) the KRI has been outside green. */
export function monthsOutsideGreen(k: Kri): number {
  let n = 0;
  for (let i = k.history.length - 1; i >= 0; i--) {
    if (kriRag(k, k.history[i]!) === "green") break;
    n++;
  }
  return n;
}

export function fmtKri(k: Pick<Kri, "unit" | "decimals">, v: number): string {
  const n = v.toFixed(k.decimals);
  return k.unit === "%" || k.unit === "% of limit" ? `${n}%` : `${n} ${k.unit}`;
}

// ---------------------------------------------------------------- Loss Limit Framework (parameters)

// Loss Limit Framework thresholds are business rules (operational-risk.loss.*) — see ../platform.ts.

// ---------------------------------------------------------------- Loss events

export const baselEventTypes = [
  "Internal fraud",
  "External fraud",
  "Employment practices & workplace safety",
  "Clients, products & business practices",
  "Damage to physical assets",
  "Business disruption & system failures",
  "Execution, delivery & process management",
] as const;
export type BaselEventType = (typeof baselEventTypes)[number];

export const businessLines = ["Retail banking", "Commercial banking", "Corporate banking", "Treasury", "Payment & settlement", "Operations", "Technology"] as const;

export type LossEventStatus = "Reported" | "Under investigation" | "Remediation" | "Closed";
export type LossEventSource = "Direct officer logging" | "Credit Admin sanctions-for-breach (§6.3.2)" | "ERM regulatory-breach register" | "Escalated exception (§6.4.4)";

export type LossEvent = {
  id: string;
  title: string;
  description: string;
  eventType: BaselEventType;
  category: IndicatorCategory;
  businessLine: string;
  branch: string;
  occurredAt: string;
  discoveredAt: string;
  grossLoss: number;
  recovery: number;
  nearMiss: boolean;
  rootCause: string;
  controlId?: string;
  status: LossEventStatus;
  source: LossEventSource;
  reportedBy: string;
  /** Signed-in user who logged it (user-scoped "Reported by me" view). */
  reportedById?: string;
  actionPlan?: string;
  /** Unrecovered amount written off on approved closure. */
  writeOff?: number;
  closedBy?: string;
};

const lossTemplates: { title: string; type: BaselEventType; cat: IndicatorCategory; line: string; root: string; ctl: string; min: number; max: number }[] = [
  { title: "ATM cash-out via card skimming", type: "External fraud", cat: "Security Incidents", line: "Retail banking", root: "Skimming device not detected on offsite ATM; inspection cycle missed", ctl: "CTL-SEC-01", min: 2e6, max: 18e6 },
  { title: "Fraudulent transfer via compromised mobile credentials", type: "External fraud", cat: "Cyber Intrusions & Attacks", line: "Retail banking", root: "SIM-swap not flagged; device-binding rule disabled during release", ctl: "CTL-CYB-01", min: 3e6, max: 42e6 },
  { title: "Duplicate NIP transfer posted", type: "Execution, delivery & process management", cat: "Transaction Processing Quality", line: "Payment & settlement", root: "Retry logic re-posted a timed-out transfer; reconciliation caught it at T+1", ctl: "CTL-TPQ-01", min: 0.5e6, max: 9e6 },
  { title: "Teller cash shortage", type: "Execution, delivery & process management", cat: "Transaction Processing Quality", line: "Retail banking", root: "Dual-control on vault replenishment not observed", ctl: "CTL-TPQ-02", min: 0.2e6, max: 3.5e6 },
  { title: "Core banking outage — end-of-day batch overrun", type: "Business disruption & system failures", cat: "Systems & Technology", line: "Technology", root: "Database storage threshold breached; capacity alert unattended", ctl: "CTL-SYS-01", min: 1e6, max: 28e6 },
  { title: "CBN penalty — late prudential return", type: "Clients, products & business practices", cat: "Regulatory Breaches", line: "Operations", root: "Return compiled manually; reviewer unavailable on deadline", ctl: "CTL-REG-01", min: 2e6, max: 20e6 },
  { title: "Unauthorised fee charged to customers", type: "Clients, products & business practices", cat: "Customer Complaints", line: "Retail banking", root: "Tariff parameter set incorrectly after product change", ctl: "CTL-CC-01", min: 1e6, max: 15e6 },
  { title: "Staff collusion — fictitious loan disbursement", type: "Internal fraud", cat: "Staff / Human Capital", line: "Commercial banking", root: "Maker-checker bypassed with shared credentials", ctl: "CTL-HC-01", min: 8e6, max: 65e6 },
  { title: "Branch flood damage", type: "Damage to physical assets", cat: "Security Incidents", line: "Retail banking", root: "Drainage inspection not done before rainy season", ctl: "CTL-SEC-02", min: 3e6, max: 22e6 },
  { title: "Wrongful dismissal claim settled", type: "Employment practices & workplace safety", cat: "Staff / Human Capital", line: "Operations", root: "Disciplinary procedure not followed", ctl: "CTL-HC-02", min: 2e6, max: 12e6 },
  { title: "Collateral release before full repayment", type: "Execution, delivery & process management", cat: "Loss Events", line: "Corporate banking", root: "Release request processed without Credit Admin sign-off (sanction for breach raised)", ctl: "CTL-LE-01", min: 5e6, max: 40e6 },
  { title: "FX deal booked at wrong rate", type: "Execution, delivery & process management", cat: "Transaction Processing Quality", line: "Treasury", root: "Manual rate entry; no tolerance check against market feed", ctl: "CTL-TPQ-01", min: 1.5e6, max: 16e6 },
];

const statusPool: LossEventStatus[] = ["Closed", "Closed", "Closed", "Remediation", "Under investigation", "Reported"];
const reporters = ["Bisi Ogunleye", "Musa Abdullahi", "Kemi Ajayi", "Emeka Nwosu", "Halima Bello"];

function buildLossEvents(): LossEvent[] {
  const r = rng(6901);
  const list: LossEvent[] = [];
  for (let i = 0; i < 46; i++) {
    const t = r.pick(lossTemplates);
    const daysAgo = Math.floor((i / 46) * 420) + r.int(0, 8);
    const nearMiss = i % 8 === 5;
    const gross = nearMiss ? 0 : Math.round(r.float(t.min, t.max) / 10_000) * 10_000;
    const recoveredShare = t.type === "External fraud" || t.type === "Damage to physical assets" ? r.float(0.1, 0.7) : r.float(0, 0.35);
    const status = daysAgo < 20 ? r.pick<LossEventStatus>(["Reported", "Under investigation"]) : daysAgo < 70 ? r.pick<LossEventStatus>(["Under investigation", "Remediation", "Closed"]) : r.pick(statusPool.slice(0, 4));
    const source: LossEventSource =
      t.cat === "Regulatory Breaches" ? "ERM regulatory-breach register" : t.ctl === "CTL-LE-01" ? "Credit Admin sanctions-for-breach (§6.3.2)" : r.next() < 0.2 ? "Escalated exception (§6.4.4)" : "Direct officer logging";
    list.push({
      id: `OLE-${String(2026_460 - i)}`,
      title: nearMiss ? `Near miss — ${t.title.toLowerCase()}` : t.title,
      description: `${t.title} at ${r.pick(branches)} — identified by ${r.pick(["reconciliation", "customer complaint", "internal audit", "branch control officer", "SIEM alert"])}.`,
      eventType: t.type,
      category: t.cat,
      businessLine: t.line,
      branch: r.pick(branches),
      occurredAt: isoDaysAgo(daysAgo + r.int(1, 12)),
      discoveredAt: isoDaysAgo(daysAgo),
      grossLoss: gross,
      recovery: Math.round((gross * recoveredShare) / 10_000) * 10_000,
      nearMiss,
      rootCause: t.root,
      controlId: t.ctl,
      status,
      source,
      reportedBy: r.pick(reporters),
      actionPlan: status === "Reported" ? undefined : "Control owner to remediate and evidence closure; Operational Risk to re-test control.",
    });
  }
  return list;
}

export const seedLossEvents: LossEvent[] = buildLossEvents();

export const netLoss = (e: Pick<LossEvent, "grossLoss" | "recovery">) => Math.max(0, e.grossLoss - e.recovery);

/** Monthly net loss for the last `n` months, from an event list. */
export function monthlyNetLoss(events: LossEvent[], n = 12): { label: string; value: number }[] {
  const now = new Date(2026, 10, 1); // include the current partial month
  return Array.from({ length: n + 1 }, (_, i) => {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - (n - i), 1);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    const value = events.filter((e) => new Date(e.discoveredAt) >= monthStart && new Date(e.discoveredAt) < monthEnd).reduce((s, e) => s + netLoss(e), 0);
    const label = format(monthStart, "MMM yy");
    return { label: i === n ? `${label} (MTD)` : label, value };
  });
}

/**
 * KRI-LE-01 (net loss ÷ monthly loss limit) is computed at read time from the live loss register and the
 * current `operational-risk.loss.monthlyNetLimitNgn` rule (see logic.ts `readKris`). These are the 36 monthly
 * readings before the register window (demo back-fill).
 */
export const lossKriBackfill: number[] = (() => {
  const r = rng(77);
  return Array.from({ length: 36 }, () => r.int(20, 70));
})();
{
  const k = kris.find((x) => x.id === "KRI-LE-01")!;
  k.history = [...lossKriBackfill, ...Array.from({ length: 12 }, () => 0)];
}

// ---------------------------------------------------------------- RCSA

export type ControlEffectiveness = "Effective" | "Partially effective" | "Ineffective" | "Not tested";
export type AssessmentStatus = "Not started" | "In progress" | "Submitted" | "Reviewed";
export type ActionStatus = "Open" | "In progress" | "Completed" | "Overdue";

export type RcsaControl = { id: string; name: string; type: "Preventive" | "Detective" | "Corrective"; design: ControlEffectiveness; operating: ControlEffectiveness; lastTested: string };
export type RcsaAction = { id: string; title: string; owner: string; dueAt: string; status: ActionStatus };

export type RcsaRisk = {
  id: string;
  title: string;
  category: IndicatorCategory;
  businessUnit: string;
  controlOwner: string;
  inherent: { likelihood: number; impact: number };
  residual: { likelihood: number; impact: number };
  controls: RcsaControl[];
  kriIds: string[];
  status: AssessmentStatus;
  actions: RcsaAction[];
  assessedAt?: string;
  submittedById?: string;
  submittedBy?: string;
  reviewedBy?: string;
};

const rcsaSpecs: [string, IndicatorCategory, string, string, [number, number], [number, number], ControlEffectiveness][] = [
  ["Loss of key staff in critical roles", "Staff / Human Capital", "Human Resources", "Adaeze Okonkwo", [4, 4], [3, 4], "Partially effective"],
  ["Inadequate segregation of duties in loan booking", "Staff / Human Capital", "Credit Administration", "Kelechi Obi", [3, 5], [2, 4], "Effective"],
  ["Branch robbery / vault breach", "Security Incidents", "Branch network", "Ibrahim Danjuma", [2, 5], [2, 3], "Effective"],
  ["Unauthorised physical access to data centre", "Security Incidents", "Technology", "Ibrahim Danjuma", [2, 4], [1, 4], "Effective"],
  ["Manual processing errors on payments", "Transaction Processing Quality", "Operations", "Chinedu Eze", [4, 3], [4, 3], "Ineffective"],
  ["Reversal entries not reviewed", "Transaction Processing Quality", "Operations", "Chinedu Eze", [3, 3], [2, 3], "Partially effective"],
  ["Core banking unavailability", "Systems & Technology", "Technology", "Olumide Bakare", [3, 5], [3, 4], "Partially effective"],
  ["Channel failure (mobile/USSD)", "Systems & Technology", "Digital banking", "Olumide Bakare", [4, 3], [3, 3], "Partially effective"],
  ["Late or inaccurate regulatory returns", "Regulatory Breaches", "Financial Control", "Funmilayo Adeyemi", [3, 4], [2, 4], "Effective"],
  ["AML/KYC screening failure", "Regulatory Breaches", "Compliance", "Funmilayo Adeyemi", [3, 5], [2, 5], "Partially effective"],
  ["Ransomware / malware intrusion", "Cyber Intrusions & Attacks", "Information Security", "Tunde Afolabi", [4, 5], [3, 4], "Partially effective"],
  ["Phishing-led credential compromise", "Cyber Intrusions & Attacks", "Information Security", "Tunde Afolabi", [5, 4], [3, 3], "Effective"],
  ["Complaint mishandling and mis-selling", "Customer Complaints", "Customer Experience", "Ngozi Ibe", [3, 3], [3, 3], "Ineffective"],
  ["Incorrect fee/tariff application", "Customer Complaints", "Product Management", "Ngozi Ibe", [3, 3], [2, 2], "Effective"],
  ["Collateral released without authority", "Loss Events", "Credit Administration", "Kelechi Obi", [2, 5], [2, 3], "Effective"],
  ["Third-party (vendor) service failure", "Systems & Technology", "Procurement", "Olumide Bakare", [3, 4], [3, 3], "Not tested"],
];

const statuses: AssessmentStatus[] = ["Reviewed", "Reviewed", "Submitted", "In progress", "Reviewed", "Submitted", "In progress", "Reviewed", "Reviewed", "Submitted", "In progress", "Reviewed", "Not started", "Reviewed", "Reviewed", "Not started"];

function buildRcsa(): RcsaRisk[] {
  const r = rng(3131);
  return rcsaSpecs.map(([title, category, unit, owner, inh, res, eff], i) => {
    const catKris = kris.filter((k) => k.category === category).map((k) => k.id);
    const nControls = r.int(2, 3);
    const controls: RcsaControl[] = Array.from({ length: nControls }, (_, c) => ({
      id: c === 0 && catKris[0] ? kris.find((k) => k.id === catKris[0])!.controlId : `CTL-${String(400 + i * 3 + c)}`,
      name: [
        "Maker-checker approval",
        "Daily reconciliation and exception review",
        "Automated limit/parameter validation",
        "Quarterly access recertification",
        "Monitoring alert with escalation",
        "Policy attestation and training",
      ][(i + c) % 6]!,
      type: (["Preventive", "Detective", "Corrective"] as const)[c % 3]!,
      design: eff === "Ineffective" && c === 0 ? "Partially effective" : eff === "Not tested" ? "Not tested" : "Effective",
      operating: c === 0 ? eff : eff === "Not tested" ? "Not tested" : r.next() < 0.75 ? "Effective" : "Partially effective",
      lastTested: isoDaysAgo(r.int(20, 200)),
    }));
    const needsAction = eff !== "Effective";
    const actions: RcsaAction[] = needsAction
      ? [
          {
            id: `ACT-${String(700 + i)}`,
            title: eff === "Ineffective" ? "Redesign control and re-test operating effectiveness" : eff === "Not tested" ? "Schedule and perform control test" : "Close design gap and evidence remediation",
            owner,
            dueAt: i % 4 === 0 ? isoDaysAgo(r.int(5, 30)) : isoDaysAhead(r.int(10, 90)),
            status: i % 4 === 0 ? "Overdue" : r.pick<ActionStatus>(["Open", "In progress"]),
          },
        ]
      : [];
    return {
      id: `RCSA-${String(101 + i)}`,
      title,
      category,
      businessUnit: unit,
      controlOwner: owner,
      inherent: { likelihood: inh[0], impact: inh[1] },
      residual: { likelihood: res[0], impact: res[1] },
      controls,
      kriIds: catKris.slice(0, 2),
      status: statuses[i]!,
      actions,
      assessedAt: statuses[i] === "Not started" ? undefined : isoDaysAgo(r.int(3, 60)),
    };
  });
}

export const seedRcsa: RcsaRisk[] = buildRcsa();

/** Current RCSA cycle instance (data). The cadence is the `operational-risk.rcsa.cycleMonths` rule. */
export const rcsaCycle = { name: "RCSA cycle 2026 H2", opensAt: "2026-09-01", closesAt: "2026-12-15" };

/** Overall control effectiveness = weakest operating rating of the risk's controls. */
export function overallEffectiveness(r: RcsaRisk): ControlEffectiveness {
  const order: ControlEffectiveness[] = ["Ineffective", "Partially effective", "Not tested", "Effective"];
  for (const o of order) if (r.controls.some((c) => c.operating === o)) return o;
  return "Effective";
}

// ---------------------------------------------------------------- BCM

export type PlanCurrency = "Current" | "Due for review" | "Overdue";
export type TestResult = "Passed" | "Passed with issues" | "Failed" | "Not tested";

export type BcmPlan = {
  id: string;
  process: string;
  tier: 1 | 2 | 3;
  owner: string;
  rtoTargetHrs: number;
  rtoAchievedHrs?: number;
  rpoTargetMins: number;
  rpoAchievedMins?: number;
  lastReviewed: string;
  nextReview: string;
  lastTest?: string;
  lastResult: TestResult;
  alternateSite: string;
  /** Last approved plan review (Operations workflow). */
  approvedBy?: string;
};

const bcmSpecs: [string, 1 | 2 | 3, string, number, number, string][] = [
  ["Core banking (CBA) services", 1, "Olumide Bakare", 4, 15, "DR site — Abuja"],
  ["Payments & NIP/RTGS settlement", 1, "Chinedu Eze", 2, 5, "DR site — Abuja"],
  ["Digital channels (mobile, internet, USSD)", 1, "Olumide Bakare", 4, 15, "Cloud region failover"],
  ["Treasury dealing room", 1, "Yetunde Lawal", 2, 15, "Alternate dealing desk — Ikeja"],
  ["Branch cash operations", 2, "Chinedu Eze", 8, 60, "Nearest hub branch"],
  ["Credit administration & disbursement", 2, "Kelechi Obi", 24, 240, "Work-from-home + Ikeja"],
  ["Customer contact centre", 2, "Ngozi Ibe", 8, 60, "Contact-centre overflow — Lekki"],
  ["Regulatory reporting", 2, "Funmilayo Adeyemi", 24, 240, "Work-from-home"],
  ["Human resources & payroll", 3, "Adaeze Okonkwo", 72, 1440, "Work-from-home"],
  ["Procurement & vendor management", 3, "Sola Adebanjo", 72, 1440, "Work-from-home"],
  ["Marketing & corporate communications", 3, "Zainab Usman", 48, 1440, "Work-from-home"],
];

/** Seed-time review cycle used only to generate demo next-review dates (TD-901). */
const DEMO_REVIEW_CYCLE_DAYS = 365;

function buildBcm(): BcmPlan[] {
  const r = rng(2201);
  return bcmSpecs.map(([process, tier, owner, rto, rpo, site], i) => {
    const reviewedAgo = [40, 120, 300, 200, 410, 90, 380, 150, 520, 60, 250][i]!;
    const tested = i !== 9;
    const ratio = i === 2 ? 1.6 : i === 6 ? 1.2 : r.float(0.5, 0.95);
    const result: TestResult = !tested ? "Not tested" : ratio > 1.4 ? "Failed" : ratio > 1 ? "Passed with issues" : "Passed";
    return {
      id: `BCP-${String(301 + i)}`,
      process,
      tier,
      owner,
      rtoTargetHrs: rto,
      rtoAchievedHrs: tested ? round(rto * ratio, 1) : undefined,
      rpoTargetMins: rpo,
      rpoAchievedMins: tested ? Math.round(rpo * (ratio > 1 ? ratio : r.float(0.4, 0.9))) : undefined,
      lastReviewed: isoDaysAgo(reviewedAgo),
      nextReview: isoDaysAhead(DEMO_REVIEW_CYCLE_DAYS - reviewedAgo), // TD-901: seed only — live cycle is a rule
      lastTest: tested ? isoDaysAgo(r.int(15, 300)) : undefined,
      lastResult: result,
      alternateSite: site,
    };
  });
}

export const seedBcmPlans: BcmPlan[] = buildBcm();

/** Plan currency from next-review date; "due" window is the `operational-risk.bcm.reviewDueWindowDays` rule. */
export function planCurrency(p: Pick<BcmPlan, "nextReview">, dueWindowDays: number): PlanCurrency {
  const days = (new Date(p.nextReview).getTime() - DEMO_NOW.getTime()) / 86_400_000;
  return days < 0 ? "Overdue" : days <= dueWindowDays ? "Due for review" : "Current";
}

export type BcmExercise = { id: string; type: "DR failover" | "Tabletop crisis simulation" | "Call-tree test" | "Fire drill & evacuation" | "Alternate-site walkthrough"; scope: string; date: string; result: TestResult; findings: number };

export const seedExercises: BcmExercise[] = [
  { id: "EX-2611", type: "Fire drill & evacuation", scope: "Head office — Victoria Island", date: isoDaysAgo(6), result: "Passed", findings: 1 },
  { id: "EX-2610", type: "DR failover", scope: "Digital channels — cloud region failover", date: isoDaysAgo(24), result: "Failed", findings: 4 },
  { id: "EX-2609", type: "Tabletop crisis simulation", scope: "Crisis Management Team — ransomware scenario", date: isoDaysAgo(41), result: "Passed with issues", findings: 3 },
  { id: "EX-2608", type: "Call-tree test", scope: "All Tier 1 process owners", date: isoDaysAgo(63), result: "Passed", findings: 0 },
  { id: "EX-2607", type: "DR failover", scope: "Core banking — Abuja DR site", date: isoDaysAgo(88), result: "Passed", findings: 1 },
  { id: "EX-2606", type: "Alternate-site walkthrough", scope: "Treasury alternate dealing desk", date: isoDaysAgo(120), result: "Passed", findings: 0 },
  { id: "EX-2605", type: "Fire drill & evacuation", scope: "Port Harcourt, Kano, Enugu branches", date: isoDaysAgo(150), result: "Passed with issues", findings: 2 },
  { id: "EX-2604", type: "Tabletop crisis simulation", scope: "Branch flood / civil unrest scenario", date: isoDaysAgo(210), result: "Passed", findings: 2 },
];

/** Fire drill & evacuation record by branch (Fire Drill & Evacuation Framework). Required count = `operational-risk.bcm.fireDrillsPerYear` rule. */
export const fireDrills = branches.map((b, i) => {
  const done = [2, 2, 1, 2, 2, 0, 1, 2, 1, 2][i]!;
  return { branch: b, completed: done, lastDrill: done ? isoDaysAgo([30, 6, 190, 75, 44, 0, 150, 98, 150, 60][i]!) : undefined, wardensTrained: [100, 100, 80, 100, 90, 60, 85, 100, 75, 95][i]! };
});

export const crisisReadiness = [
  { id: "CR-1", title: "Crisis Management Team roster current and approved", status: "met" as const, owner: "Head of Risk" },
  { id: "CR-2", title: "Call tree tested within the last 6 months", status: "met" as const, owner: "Operational Risk Analyst" },
  { id: "CR-3", title: "Crisis communication templates approved (customers, regulator, media)", status: "met" as const, owner: "Corporate communications" },
  { id: "CR-4", title: "Alternate-site contracts valid for all Tier 1 processes", status: "pending" as const, owner: "Procurement" },
  { id: "CR-5", title: "DR failover passed for all Tier 1 systems this year", status: "breached" as const, owner: "Chief Information Officer" },
  { id: "CR-6", title: "Business impact analysis refreshed within 12 months", status: "met" as const, owner: "Operational Risk Analyst" },
  { id: "CR-7", title: "Fire drill completed at every branch this half-year", status: "pending" as const, owner: "Chief Security Officer" },
];
