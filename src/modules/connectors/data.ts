/**
 * Connectors — simulated health telemetry for the Risk Data Spine connectors (PRD §5).
 * Prototype: every figure is simulated. Endpoints and credentials are configured by each tenant and are never shown.
 * BACKEND SEAM: replace with the connector/job health API (PRD §4.6: connector freshness, queue/outbox lag, projection lag).
 */

export type ConnectorStatus = "Healthy" | "Degraded" | "Failed" | "Manual (Phase 1)" | "Paused";

export type Connector = {
  id: string;
  name: string;
  prd: string;
  category: "Core banking" | "Credit bureau & CRMS" | "Statements & documents" | "External feeds" | "Limit engine" | "Securities" | "Other bank systems";
  method: string;
  phaseNote?: string;
  schedule: string;
  status: ConnectorStatus;
  statusNote?: string;
  /** Minutes since the last successful sync (relative to page load). */
  lastSyncMin: number;
  /** Freshness SLA in minutes (tenant parameter — demo values). */
  freshnessSlaMin: number;
  records24h: number;
  recordsLabel: string;
  latencyMs: number;
  errorRatePct: number;
  /** Error rate, last 12 hours (oldest → newest). */
  errorSeries: number[];
  consumers: string[];
  dataFormat: string;
};

export const connectors: Connector[] = [
  {
    id: "CON-CBA",
    name: "Core Banking Application (CBA)",
    prd: "§5.1",
    category: "Core banking",
    method: "Near-real-time API / interface; overnight batch file as fallback",
    schedule: "Every 15 minutes + 01:00 batch",
    status: "Healthy",
    lastSyncMin: 6,
    freshnessSlaMin: 30,
    records24h: 184_220,
    recordsLabel: "statement lines & balances",
    latencyMs: 420,
    errorRatePct: 0.2,
    errorSeries: [0.3, 0.2, 0.2, 0.4, 0.1, 0.2, 0.2, 0.3, 0.2, 0.1, 0.2, 0.2],
    consumers: ["Credit Administration registers", "Loan Review inflow tracking", "Portfolio / MIS", "360 RAR Internal Risk Assessment"],
    dataFormat: "JSON (API) / fixed-width batch file",
  },
  {
    id: "CON-BUR-A",
    name: "Credit bureau A",
    prd: "§5.2",
    category: "Credit bureau & CRMS",
    method: "API enquiry per obligor — mandatory pre-approval pull (CBN 3.7(c))",
    schedule: "On demand (origination & renewal)",
    status: "Healthy",
    lastSyncMin: 12,
    freshnessSlaMin: 240,
    records24h: 146,
    recordsLabel: "enquiries",
    latencyMs: 1_850,
    errorRatePct: 0.7,
    errorSeries: [0.5, 0.8, 0.6, 0.7, 0.9, 0.6, 0.5, 0.7, 0.8, 0.6, 0.7, 0.7],
    consumers: ["Origination pre-approval gate", "360 RAR Internal axis", "Credit file (CBN 3.8)", "Share of wallet"],
    dataFormat: "JSON — per-institution facility breakdown",
  },
  {
    id: "CON-BUR-B",
    name: "Credit bureau B",
    prd: "§5.2",
    category: "Credit bureau & CRMS",
    method: "API enquiry per obligor — second licensed bureau (CBN 3.7(c))",
    schedule: "On demand (origination & renewal)",
    status: "Degraded",
    statusNote: "Responses slower than usual — retrying automatically (3 of 5 retries used).",
    lastSyncMin: 47,
    freshnessSlaMin: 240,
    records24h: 131,
    recordsLabel: "enquiries",
    latencyMs: 9_400,
    errorRatePct: 6.8,
    errorSeries: [0.6, 0.8, 0.7, 1.1, 1.9, 2.8, 4.1, 5.2, 6.0, 7.4, 6.9, 6.8],
    consumers: ["Origination pre-approval gate", "360 RAR Internal axis", "Credit file (CBN 3.8)"],
    dataFormat: "XML — per-institution facility breakdown",
  },
  {
    id: "CON-CRMS",
    name: "CBN Credit Risk Management System (CRMS)",
    prd: "§5.2",
    category: "Credit bureau & CRMS",
    method: "Search against the CRMS database (CBN 3.7(d)); CRMS returns filed by Credit Admin",
    schedule: "On demand",
    status: "Healthy",
    lastSyncMin: 26,
    freshnessSlaMin: 480,
    records24h: 58,
    recordsLabel: "searches",
    latencyMs: 2_300,
    errorRatePct: 0.4,
    errorSeries: [0.2, 0.4, 0.3, 0.5, 0.4, 0.3, 0.4, 0.6, 0.4, 0.3, 0.4, 0.4],
    consumers: ["Origination pre-approval gate", "CRMS desk"],
    dataFormat: "CBN CRMS format",
  },
  {
    id: "CON-OBS",
    name: "Other-bank statements",
    prd: "§5.3",
    category: "Statements & documents",
    method: "Customer-consented PDF statement upload with OCR parsing",
    phaseNote: "Phase 1: consented upload + OCR · Phase 2: automated open-banking aggregator",
    schedule: "On upload",
    status: "Manual (Phase 1)",
    lastSyncMin: 128,
    freshnessSlaMin: 1_440,
    records24h: 38,
    recordsLabel: "statements parsed",
    latencyMs: 14_500,
    errorRatePct: 2.6,
    errorSeries: [2.0, 3.1, 2.4, 2.8, 2.5, 2.2, 3.0, 2.7, 2.4, 2.9, 2.6, 2.6],
    consumers: ["COP ratio (§6.1.4)", "360 RAR confidence layer", "Share of wallet (§6.2.9)"],
    dataFormat: "PDF → structured transactions",
  },
  {
    id: "CON-OCR",
    name: "Document upload, OCR & financial-statement ingestion",
    prd: "§5.4",
    category: "Statements & documents",
    method: "Upload (PDF, Word, scanned image) → OCR → structured fields; every version retained",
    schedule: "Event-driven (queue)",
    status: "Healthy",
    statusNote: "Queue depth 4 documents.",
    lastSyncMin: 2,
    freshnessSlaMin: 30,
    records24h: 212,
    recordsLabel: "documents processed",
    latencyMs: 38_000,
    errorRatePct: 1.4,
    errorSeries: [1.1, 1.6, 1.2, 1.5, 1.3, 1.4, 1.2, 1.8, 1.5, 1.3, 1.4, 1.4],
    consumers: ["360 RAR parameter table (§6.2.1)", "Credit files", "Collateral documents"],
    dataFormat: "PDF / DOCX / image → JSON fields",
  },
  {
    id: "CON-SECTOR",
    name: "Sector & industry performance feed",
    prd: "§5.5",
    category: "External feeds",
    method: "Scheduled feed mapped to tenant taxonomy and CBN classification",
    schedule: "Daily 06:00",
    status: "Healthy",
    lastSyncMin: 205,
    freshnessSlaMin: 1_560,
    records24h: 1_240,
    recordsLabel: "sector observations",
    latencyMs: 3_100,
    errorRatePct: 0,
    errorSeries: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    consumers: ["360 RAR Industry axis", "Sector limits", "Sector performance"],
    dataFormat: "CSV / JSON",
  },
  {
    id: "CON-MACRO",
    name: "Macro-economic indicators",
    prd: "§5.5",
    category: "External feeds",
    method: "Official publishing sources: inflation, FX, GDP-by-sector, MPR, CRR, crude price & output, PMI, T-bill/bond yields",
    schedule: "Daily 07:00 (series on publisher cadence)",
    status: "Healthy",
    statusNote: "PMI for October not yet published by source — previous value retained.",
    lastSyncMin: 145,
    freshnessSlaMin: 1_560,
    records24h: 64,
    recordsLabel: "series updated",
    latencyMs: 2_600,
    errorRatePct: 0,
    errorSeries: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    consumers: ["360 RAR Macro axis", "Projections (§6.6.7)", "Liquidity projection (§6.8.4)"],
    dataFormat: "CSV / JSON",
  },
  {
    id: "CON-CBN",
    name: "CBN circulars & regulatory updates",
    prd: "§5.5",
    category: "External feeds",
    method: "Regulatory-update feed to keep the Rules & Parameters Engine current",
    schedule: "Daily 08:00",
    status: "Healthy",
    lastSyncMin: 85,
    freshnessSlaMin: 1_560,
    records24h: 2,
    recordsLabel: "circulars",
    latencyMs: 1_200,
    errorRatePct: 0,
    errorSeries: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    consumers: ["Rules & Parameters Engine (review queue)"],
    dataFormat: "PDF + metadata",
  },
  {
    id: "CON-LIMIT",
    name: "Portfolio extraction & limit engine",
    prd: "§5.6",
    category: "Limit engine",
    method: "Full facility book from the CBA; single-obligor (CBN 3.2) and sectoral limit checks",
    schedule: "Every 30 minutes + on demand before approval",
    status: "Healthy",
    lastSyncMin: 14,
    freshnessSlaMin: 60,
    records24h: 9_680,
    recordsLabel: "facilities evaluated",
    latencyMs: 2_900,
    errorRatePct: 0.1,
    errorSeries: [0.1, 0, 0.1, 0.2, 0.1, 0.1, 0, 0.1, 0.1, 0.2, 0.1, 0.1],
    consumers: ["Origination limit gate", "Limits dashboard", "Concentration"],
    dataFormat: "Internal",
  },
  {
    id: "CON-CSCS",
    name: "SEC / CSCS securities registry",
    prd: "§5.7",
    category: "Securities",
    method: "Mark-to-market price, shareholding / lien confirmation and corporate actions",
    phaseNote: "Phase 1: manual / periodic CSCS statement upload · Phase 2: automated SEC/CSCS API",
    schedule: "Daily close (Phase 2) · on upload (Phase 1)",
    status: "Manual (Phase 1)",
    lastSyncMin: 1_110,
    freshnessSlaMin: 1_560,
    records24h: 29,
    recordsLabel: "positions valued",
    latencyMs: 0,
    errorRatePct: 0,
    errorSeries: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    consumers: ["Collateral register (§6.5)", "LGD model (§6.7.2)", "Haircut provisioning (§6.7.3)", "Margin calls (§6.4.4)"],
    dataFormat: "CSCS statement (PDF / CSV)",
  },
  {
    id: "CON-TRY",
    name: "Treasury, FX & money-market systems",
    prd: "§5",
    category: "Other bank systems",
    method: "Interface to the tenant's treasury platform",
    schedule: "Every 5 minutes (market hours)",
    status: "Healthy",
    lastSyncMin: 4,
    freshnessSlaMin: 15,
    records24h: 6_420,
    recordsLabel: "positions & deals",
    latencyMs: 640,
    errorRatePct: 0.3,
    errorSeries: [0.2, 0.3, 0.3, 0.4, 0.2, 0.3, 0.3, 0.2, 0.3, 0.4, 0.3, 0.3],
    consumers: ["Market & liquidity risk", "ILAAP"],
    dataFormat: "FIX / CSV",
  },
  {
    id: "CON-HRIT",
    name: "HR, security & IT systems",
    prd: "§5",
    category: "Other bank systems",
    method: "Scheduled extracts for operational-risk KRIs (attrition, incidents, downtime)",
    schedule: "Daily 02:00",
    status: "Failed",
    statusNote: "Authentication rejected by the source system — the tenant needs to renew the service credential.",
    lastSyncMin: 1_975,
    freshnessSlaMin: 1_560,
    records24h: 0,
    recordsLabel: "KRI observations",
    latencyMs: 0,
    errorRatePct: 100,
    errorSeries: [0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 100, 100],
    consumers: ["Operational risk KRIs (§6.9.1)", "AI co-pilot correlations"],
    dataFormat: "CSV",
  },
];

export const statusTones = { Healthy: "success", Degraded: "warning", Failed: "danger", "Manual (Phase 1)": "info", Paused: "neutral" } as const;

export type Run = {
  id: string;
  connectorId: string;
  startedAt: string;
  durationMs: number;
  records: number;
  status: "Success" | "Partial" | "Failed";
  trigger: "Schedule" | "Manual" | "Event";
  by?: string;
  message?: string;
};

/** Simulated recent runs (relative to `now`). */
export function seedRuns(now: number): Run[] {
  const out: Run[] = [];
  let k = 0;
  for (const c of connectors) {
    const n = c.status === "Manual (Phase 1)" ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const minutesAgo = c.lastSyncMin + i * (c.freshnessSlaMin > 600 ? 1440 : Math.max(15, c.freshnessSlaMin / 2));
      const failed = c.status === "Failed" && i === 0;
      const partial = c.status === "Degraded" && i === 0;
      out.push({
        id: `RUN-${String(88000 + k++)}`,
        connectorId: c.id,
        startedAt: new Date(now - minutesAgo * 60_000).toISOString(),
        durationMs: Math.max(800, c.latencyMs * 6 + i * 900),
        records: failed ? 0 : Math.round(c.records24h / (c.freshnessSlaMin > 600 ? 1 : 24 * (60 / Math.max(15, c.freshnessSlaMin / 2)))) || 1,
        status: failed ? "Failed" : partial ? "Partial" : "Success",
        trigger: c.status === "Manual (Phase 1)" ? "Manual" : c.id === "CON-OCR" ? "Event" : "Schedule",
        message: failed ? "401 — authentication rejected" : partial ? "12 enquiries timed out — queued for retry" : undefined,
      });
    }
  }
  return out;
}

/* ---------------- Staging & reconciliation layer (PRD §5, §5.1) ---------------- */

export const staging24h = {
  received: 216_480,
  discounted: { interBranch: 3_912, suspense: 1_204, inAndOut: 6_877, reversals: 2_315 },
  quarantined: 148,
  unreconciledAgeing: [
    { label: "0–30 days", value: 61 },
    { label: "31–60 days", value: 22 },
    { label: "61–90 days", value: 9 },
    { label: "Over 90 days (CBN: clear within 3 months)", value: 4 },
  ],
};

/** CQRS read-model projections and their lag behind the write side (PRD §4.3, §4.6). Simulated. */
export const projections = [
  { name: "360 RAR engine", lagSec: 4, events: 1_842, status: "Current" },
  { name: "IFRS 9 / ICAAP engine", lagSec: 38, events: 612, status: "Current" },
  { name: "Market & liquidity risk engine", lagSec: 2, events: 6_420, status: "Current" },
  { name: "Operational risk engine", lagSec: 118_500, events: 0, status: "Stale — source connector failed" },
  { name: "Portfolio / MIS / executive dashboards", lagSec: 11, events: 9_680, status: "Current" },
  { name: "AI trend & query co-pilot", lagSec: 95, events: 2_104, status: "Current" },
];
