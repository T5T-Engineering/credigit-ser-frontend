/**
 * Executive dashboards (PRD §6.11) — KRIs and cross-functional exceptions.
 *
 * Credit figures are derived live from the Risk Data Spine via the portfolio selectors. Capital, market,
 * liquidity and operational figures belong to modules that publish them (§6.7–6.9); until those feeds are
 * wired, they are clearly-labelled demo values. BACKEND SEAM: replace `demoFeeds` with the owning modules' APIs.
 */
import type { Collateral, Facility } from "@/lib/data/types";
import { getRule } from "@/lib/platform/rules";
import { hash01, sum } from "@/modules/portfolio/selectors";
import { EXEC_RULES } from "./platform";

export type Rag = "green" | "amber" | "red";
export type Kri = {
  id: string;
  domain: "Credit" | "Capital" | "Market" | "Liquidity" | "Operational";
  name: string;
  value: string;
  threshold: string;
  rag: Rag;
  source: "Derived" | "Tenant parameter";
  href: string;
  prd: string;
};

/** Demo feed values (actuals) from modules not yet wired to this dashboard (TD-507). Thresholds are business rules (EXEC_RULES). */
export const demoFeeds = {
  carPct: 17.8,
  carHistory: [16.9, 17.1, 17.0, 17.4, 17.6, 17.3, 17.5, 17.9, 18.1, 17.7, 17.6, 17.8],
  liquidityRatioPct: 38.4,
  ldrPct: 67.1,
  nopToCapitalPct: 11.2,
  varNgn: 412e6,
  opLossRatePct: 0.42,
  opLossTrend: [31, 44, 28, 52, 39, 61, 35, 48, 42, 57, 38, 46].map((m) => m * 1e6),
  kriRag: { green: 15, amber: 5, red: 2 },
  walletMix: [
    { label: "Primary banker", value: 34 },
    { label: "Significant share", value: 27 },
    { label: "Secondary", value: 24 },
    { label: "Marginal", value: 15 },
  ],
  peerOutliers: 6,
  momentumFlags: 9,
};

/** Share-backed collateral margin status (§5.7): MTM after the quoted-equity haircut rule (§6.7.3) vs secured exposure. */
export function shareMarginStatus(collateral: Collateral[], facilities: Facility[]) {
  const byId = new Map(facilities.map((f) => [f.id, f]));
  const keep = 1 - getRule<number>(EXEC_RULES.quotedEquityHaircutPct) / 100;
  const shares = collateral.filter((c) => c.type === "Quoted shares");
  const rows = shares.map((c) => {
    const mtm = c.marketValue * (0.72 + 0.5 * hash01(`${c.id}:mtm`)); // TD-507: simulated CSCS mark-to-market
    const secured = sum(c.facilityIds.map((id) => byId.get(id)).filter(Boolean) as Facility[], (f) => f.outstanding) / Math.max(1, c.facilityIds.length);
    const cover = mtm * keep;
    return { id: c.id, ticker: c.ticker ?? "—", mtm, cover, secured, shortfall: Math.max(0, secured - cover) };
  });
  return { count: rows.length, shortfalls: rows.filter((r) => r.shortfall > 0), rows };
}

export type ExceptionItem = { id: string; domain: "Credit" | "Market" | "Liquidity" | "Operational" | "Collateral"; title: string; severity: "High" | "Medium" | "Low"; owner: string; raisedAt: string; href: string; aiFlagged?: boolean };

/** Demo non-credit exceptions for the Head of Risk feed (credit exceptions are derived on the page). */
export const demoExceptions: ExceptionItem[] = [
  { id: "EXC-M-101", domain: "Market", title: "NGN/USD net open position at 56% of limit after month-end inflows", severity: "Medium", owner: "Market Risk Analyst", raisedAt: "2026-11-09T16:20:00+01:00", href: "/market-risk" },
  { id: "EXC-L-087", domain: "Liquidity", title: "Top-20 depositor concentration above early-warning band", severity: "Medium", owner: "Market Risk Analyst", raisedAt: "2026-11-08T10:05:00+01:00", href: "/market-risk/liquidity" },
  { id: "EXC-O-233", domain: "Operational", title: "KRI Red: failed transfers (NIP) above threshold for 3 consecutive days", severity: "High", owner: "Operational Risk Analyst", raisedAt: "2026-11-10T07:45:00+01:00", href: "/operational-risk", aiFlagged: true },
  { id: "EXC-O-229", domain: "Operational", title: "Suspense account item ageing beyond the clearance window (Ikeja)", severity: "Medium", owner: "Operational Risk Analyst", raisedAt: "2026-11-07T12:30:00+01:00", href: "/operational-risk", aiFlagged: true },
  { id: "EXC-O-221", domain: "Operational", title: "Loss event logged: ATM cash shortage, Port Harcourt", severity: "Low", owner: "Operational Risk Analyst", raisedAt: "2026-11-05T09:10:00+01:00", href: "/operational-risk" },
];
