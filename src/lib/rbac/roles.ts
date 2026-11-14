/**
 * Default role set from PRD §4.1 ("illustrative default configuration shipped out-of-the-box").
 * Roles, tiers, titles and limits are tenant configuration (PRD §4.0) — editable in Admin → Roles & limits.
 * Lending limits are illustrative NGN values for the demo tenant, not product rules.
 */

export type ModuleKey =
  | "dashboard"
  | "inbox"
  | "origination"
  | "credit-analysis"
  | "offer-letters"
  | "credit-admin"
  | "disbursement"
  | "monitoring"
  | "collateral"
  | "portfolio"
  | "executive"
  | "ifrs9"
  | "market-risk"
  | "operational-risk"
  | "enterprise-risk"
  | "ai-console"
  | "connectors"
  | "admin"
  | "audit"
  | "settings"
  | "documents"
  | "operations";

export type Access = "view" | "edit";

export type RoleGroup = "Front office" | "Credit approval" | "Risk function" | "Operations & legal" | "Administration";

export type RoleId =
  | "system-admin"
  | "account-officer"
  | "bdm"
  | "credit-analyst"
  | "credit-admin-officer"
  | "loan-review-officer"
  | "middle-office-officer"
  | "collateral-officer"
  | "predictive-analytics-officer"
  | "operational-risk-analyst"
  | "market-risk-analyst"
  | "portfolio-mis-officer"
  | "group-head"
  | "cco"
  | "directorate-head"
  | "cro"
  | "head-of-risk"
  | "md"
  | "mcc"
  | "bcc"
  | "board"
  | "legal-officer"
  | "disbursement-maker"
  | "disbursement-checker"
  | "it-support";

export type Role = {
  id: RoleId;
  name: string;
  short: string;
  group: RoleGroup;
  description: string;
  /** Approval tier in the credit chart-flow (PRD §6.1.2); null = no credit approval authority. */
  tier: number | null;
  /** Illustrative sign-on / lending limit in NGN for the demo tenant. null = none; Infinity = apex. */
  limitNgn: number | null;
  /** Authority statement as written in the PRD. */
  authority: string;
  modules: Partial<Record<ModuleKey, Access>>;
};

/** Everyone can use Operations (their approval queue and requests are user-scoped). */
const common: Partial<Record<ModuleKey, Access>> = { dashboard: "view", inbox: "edit", settings: "edit", operations: "view" };
/** AI analytics & NL query console is restricted (PRD §6.13): CRO, Head of Risk; platform-data scope for System Admin / IT Support. */
const aiConsole: Partial<Record<ModuleKey, Access>> = { "ai-console": "view" };
const riskViewAll: Partial<Record<ModuleKey, Access>> = {
  origination: "view",
  "credit-analysis": "view",
  "offer-letters": "view",
  "credit-admin": "view",
  monitoring: "view",
  collateral: "view",
  portfolio: "view",
  ifrs9: "view",
  "market-risk": "view",
  "operational-risk": "view",
  "enterprise-risk": "view",
};

export const roles: Role[] = [
  {
    id: "account-officer",
    name: "Account Officer",
    short: "AO",
    group: "Front office",
    description: "Initiates credit applications, uploads customer documents and presents offer letters.",
    tier: null,
    limitNgn: null,
    authority: "Initiates only — no approval limit",
    modules: { ...common, origination: "edit", "credit-analysis": "view", "offer-letters": "view", collateral: "view" },
  },
  {
    id: "bdm",
    name: "Business Development Manager",
    short: "BDM",
    group: "Front office",
    description: "Reviews and recommends or declines applications; can't submit until collateral due diligence is complete.",
    tier: 1,
    limitNgn: 50_000_000,
    authority: "First-line recommendation limit (tier 1)",
    modules: { ...common, origination: "edit", "credit-analysis": "view", "offer-letters": "view", collateral: "view", portfolio: "view" },
  },
  {
    id: "credit-analyst",
    name: "Credit Analyst",
    short: "CA",
    group: "Risk function",
    description: "Scores and rates, validates financials, runs 360 RAR analysis and co-signs or rejects.",
    tier: 2,
    limitNgn: 150_000_000,
    authority: "Co-signer limit alongside Group Head",
    modules: { ...common, origination: "edit", "credit-analysis": "edit", "offer-letters": "view", collateral: "view", monitoring: "view", portfolio: "view", connectors: "view" },
  },
  {
    id: "credit-admin-officer",
    name: "Credit Administration Officer",
    short: "CAD",
    group: "Risk function",
    description: "Confirms conditions are met before disbursement, manages waivers and deferrals, maintains credit files.",
    tier: null,
    limitNgn: null,
    authority: "Condition-compliance authority only",
    modules: { ...common, "credit-admin": "edit", "offer-letters": "view", disbursement: "view", collateral: "view", origination: "view", monitoring: "view" },
  },
  {
    id: "loan-review-officer",
    name: "Loan Review Officer",
    short: "LRO",
    group: "Risk function",
    description: "Tracks past-due obligations, covenant compliance and account inflows; raises exceptions.",
    tier: null,
    limitNgn: null,
    authority: "Monitoring and escalation authority",
    modules: { ...common, monitoring: "edit", "credit-admin": "view", collateral: "view", portfolio: "view", "credit-analysis": "view" },
  },
  {
    id: "middle-office-officer",
    name: "Middle Office Officer",
    short: "MO",
    group: "Risk function",
    description: "Independently verifies collateral valuations, exposures and limit utilisation.",
    tier: null,
    limitNgn: null,
    authority: "Independent price and valuation verification",
    modules: { ...common, collateral: "edit", portfolio: "view", "market-risk": "view", connectors: "view" },
  },
  {
    id: "collateral-officer",
    name: "Collateral Management Officer",
    short: "CMO",
    group: "Risk function",
    description: "Registers and values collateral, tracks perfection and haircuts, including share-backed collateral.",
    tier: null,
    limitNgn: null,
    authority: "Perfection and registration authority",
    modules: { ...common, collateral: "edit", "credit-admin": "view", origination: "view" },
  },
  {
    id: "predictive-analytics-officer",
    name: "Predictive Analytics Officer",
    short: "PAO",
    group: "Risk function",
    description: "Maintains PD/LGD/EAD models, IFRS 9 staging rules and ICAAP stress scenarios; validates AI output.",
    tier: null,
    limitNgn: null,
    authority: "Model governance authority",
    modules: { ...common, ifrs9: "edit", portfolio: "view", "enterprise-risk": "view" },
  },
  {
    id: "operational-risk-analyst",
    name: "Operational Risk Analyst",
    short: "ORA",
    group: "Risk function",
    description: "Owns the KRI framework, logs loss events, runs RCSA and tracks BCM readiness.",
    tier: null,
    limitNgn: null,
    authority: "Loss-event, RCSA and KRI authority",
    modules: { ...common, "operational-risk": "edit", "enterprise-risk": "view" },
  },
  {
    id: "market-risk-analyst",
    name: "Market Risk Analyst",
    short: "MRA",
    group: "Risk function",
    description: "Monitors net open position, liquidity ratios and ALM gaps; escalates limit breaches.",
    tier: null,
    limitNgn: null,
    authority: "NOP and liquidity monitoring authority",
    modules: { ...common, "market-risk": "edit", "enterprise-risk": "view", portfolio: "view" },
  },
  {
    id: "portfolio-mis-officer",
    name: "Portfolio & MIS Reporting Officer",
    short: "MIS",
    group: "Risk function",
    description: "Builds and validates dashboards and regulatory returns; reconciles portfolio figures to the CBA.",
    tier: null,
    limitNgn: null,
    authority: "Reporting authority",
    modules: { ...common, portfolio: "edit", monitoring: "view", ifrs9: "view", connectors: "view" },
  },
  {
    id: "group-head",
    name: "Group Head",
    short: "GH",
    group: "Credit approval",
    description: "Approves, rejects or recommends; approved requests flow to the Credit Analyst.",
    tier: 2,
    limitNgn: 150_000_000,
    authority: "Tier 2 lending limit (co-signer with Credit Analyst)",
    modules: { ...common, origination: "edit", "credit-analysis": "view", "offer-letters": "view", portfolio: "view", monitoring: "view" },
  },
  {
    id: "cco",
    name: "Chief Credit Officer",
    short: "CCO",
    group: "Credit approval",
    description: "Reviews facilities above the Group Head limit; adjudicates GH / Credit Analyst dissent.",
    tier: 3,
    limitNgn: 500_000_000,
    authority: "Tier 3 lending limit; adjudicator for GH/CA dissent",
    modules: { ...common, ...riskViewAll, origination: "edit", "credit-admin": "edit" },
  },
  {
    id: "directorate-head",
    name: "Directorate Head",
    short: "HD",
    group: "Credit approval",
    description: "Approves within the co-signed limit; routes excess to the CRO.",
    tier: 4,
    limitNgn: 1_000_000_000,
    authority: "Tier 4 lending limit (co-signer with CCO)",
    modules: { ...common, origination: "edit", "credit-analysis": "view", portfolio: "view", monitoring: "view" },
  },
  {
    id: "cro",
    name: "Chief Risk Officer",
    short: "CRO",
    group: "Credit approval",
    description: "Senior enterprise risk role. Owns the risk appetite and all risk-module escalations.",
    tier: 5,
    limitNgn: 2_500_000_000,
    authority: "Tier 5 lending limit; adjudicator for CCO/HD dissent",
    modules: { ...common, ...riskViewAll, ...aiConsole, executive: "edit", origination: "edit", "enterprise-risk": "edit", connectors: "view", audit: "view", operations: "edit" },
  },
  {
    id: "head-of-risk",
    name: "Head of Risk",
    short: "HoR",
    group: "Risk function",
    description: "Owns cross-functional risk policy, reviews exception reports and prepares Board Risk Committee packs.",
    tier: null,
    limitNgn: null,
    authority: "Escalation and policy sign-off (below CRO/Board)",
    modules: { ...common, ...riskViewAll, ...aiConsole, executive: "edit", "enterprise-risk": "edit", audit: "view", operations: "edit" },
  },
  {
    id: "md",
    name: "Managing Director / GMD",
    short: "MD",
    group: "Credit approval",
    description: "Approves within limit co-signed by the CRO; escalates to MCC.",
    tier: 6,
    limitNgn: 5_000_000_000,
    authority: "Tier 6 lending limit",
    modules: { ...common, ...riskViewAll, executive: "view", origination: "edit" },
  },
  {
    id: "mcc",
    name: "Management Credit Committee",
    short: "MCC",
    group: "Credit approval",
    description: "Joint committee approval; adjudicates CRO/GMD dissent.",
    tier: 7,
    limitNgn: 10_000_000_000,
    authority: "Tier 7 committee limit",
    modules: { ...common, origination: "edit", "credit-analysis": "view", portfolio: "view", executive: "view" },
  },
  {
    id: "bcc",
    name: "Board Credit Committee",
    short: "BCC",
    group: "Credit approval",
    description: "Joint committee approval for facilities beyond the MCC limit.",
    tier: 8,
    limitNgn: 25_000_000_000,
    authority: "Tier 8 committee limit",
    modules: { ...common, origination: "edit", "credit-analysis": "view", portfolio: "view", executive: "view" },
  },
  {
    id: "board",
    name: "Full Board",
    short: "Board",
    group: "Credit approval",
    description: "Final approval at or near the statutory single-obligor ceiling.",
    tier: 9,
    limitNgn: Number.POSITIVE_INFINITY,
    authority: "Apex limit (statutory single-obligor ceiling and above)",
    modules: { ...common, origination: "edit", portfolio: "view", executive: "view" },
  },
  {
    id: "legal-officer",
    name: "Legal Officer",
    short: "LEG",
    group: "Operations & legal",
    description: "Collateral due diligence and search, perfection of security documents, offer-letter conditions and template.",
    tier: null,
    limitNgn: null,
    authority: "Legal sufficiency sign-off",
    modules: { ...common, collateral: "edit", "offer-letters": "edit", "credit-admin": "view" },
  },
  {
    id: "disbursement-maker",
    name: "Disbursement Maker",
    short: "DOM",
    group: "Operations & legal",
    description: "Disburses to the customer's account within the approved amount. Can't be the initiator or checker.",
    tier: null,
    limitNgn: null,
    authority: "Execution only, within approved facility amount",
    modules: { ...common, disbursement: "edit", "credit-admin": "view" },
  },
  {
    id: "disbursement-checker",
    name: "Disbursement Checker",
    short: "DOC",
    group: "Operations & legal",
    description: "Authorises disbursements prepared by a different Maker — strict segregation of duties.",
    tier: null,
    limitNgn: null,
    authority: "Authorises disbursements; no self-approval",
    modules: { ...common, disbursement: "edit", "credit-admin": "view" },
  },
  {
    id: "system-admin",
    name: "System Admin",
    short: "ADM",
    group: "Administration",
    description: "Configures users, roles, limits, workflow rules, IFRS 9 parameters and the product catalogue. Can't approve credit.",
    tier: null,
    limitNgn: null,
    authority: "Configuration, not credit, authority",
    modules: { ...common, ...aiConsole, admin: "edit", audit: "view", connectors: "edit", settings: "edit", operations: "edit" },
  },
  {
    id: "it-support",
    name: "IT Support / Platform Administrator",
    short: "IT",
    group: "Administration",
    description: "User provisioning support, connector monitoring and incident response. Business data is read-only and logged.",
    tier: null,
    limitNgn: null,
    authority: "Technical only — no business data entry or approval",
    modules: { ...common, ...aiConsole, connectors: "edit", admin: "view", audit: "view" },
  },
];

export const roleById = Object.fromEntries(roles.map((r) => [r.id, r])) as Record<RoleId, Role>;

export const roleGroups: RoleGroup[] = ["Front office", "Credit approval", "Risk function", "Operations & legal", "Administration"];

export function canAccess(role: Role | undefined, module: ModuleKey, level: Access = "view"): boolean {
  if (!role) return false;
  const access = role.modules[module];
  if (!access) return false;
  return level === "view" || access === "edit";
}
