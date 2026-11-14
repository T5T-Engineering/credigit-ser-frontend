import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  BarChart3,
  Bell,
  BookOpenCheck,
  Bot,
  BriefcaseBusiness,
  Building2,
  Cable,
  FileSignature,
  FolderOpen,
  Gauge,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Palette,
  Radar,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Waves,
  Workflow,
} from "lucide-react";
import type { ModuleKey } from "./rbac/roles";
import { areaPermissions, type PermissionKey } from "./iam/catalogue";

export type Phase = 1 | 2 | 3;

/** `permission` = the page's `<area>.<resource>.view` key (AUTH-FR-17): the tab is shown and the page opens only when it is held. */
export type NavPage = { label: string; href: string; phase?: Phase; permission: PermissionKey };

export type NavItem = {
  module: ModuleKey;
  label: string;
  href: string;
  icon: LucideIcon;
  /** PRD delivery phase of the module (shown as a badge). */
  phase?: Phase;
  /** PRD section reference. */
  prd?: string;
  /** Sub-pages shown as tabs on the module pages. */
  pages?: NavPage[];
  /** View key of a module without sub-pages (e.g. `dashboard.overview.view`). */
  permission?: PermissionKey;
};

export type NavGroup = { label: string; items: NavItem[] };

/** App navigation. Each module's pages live under its `href` (see docs in README). */
export const navigation: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { module: "dashboard", label: "Dashboard", href: "/dashboard", permission: "dashboard.overview.view", icon: LayoutDashboard },
      { module: "inbox", label: "My tasks", href: "/inbox", permission: "inbox.tasks.view", icon: Inbox },
      {
        module: "executive",
        label: "Executive view",
        href: "/executive", permission: "executive.cockpit.view",
        icon: Gauge,
        phase: 1,
        prd: "§6.11, §3 row 19",
      },
      {
        module: "ai-console",
        label: "AI analytics",
        href: "/ai",
        icon: Bot,
        phase: 2,
        prd: "§6.12–6.13",
        pages: [
          { label: "Query console", href: "/ai", permission: "ai.console.view" },
          { label: "AI activity", href: "/ai/activity", permission: "ai.activity.view" },
          { label: "Query log & schedules", href: "/ai/log", permission: "ai.query-log.view" },
        ],
      },
    ],
  },
  {
    label: "Credit lifecycle",
    items: [
      {
        module: "origination",
        label: "Loan origination",
        href: "/origination",
        icon: BriefcaseBusiness,
        phase: 1,
        prd: "§6.1",
        pages: [
          { label: "Applications", href: "/origination", permission: "origination.applications.view" },
          { label: "My queue", href: "/origination?scope=mine", permission: "origination.queue.view" },
          { label: "My applications", href: "/origination?scope=created", permission: "origination.applications.view-mine" },
          { label: "New application", href: "/origination/new", permission: "origination.applications.create" },
          { label: "Approval chart-flows", href: "/origination/chart-flows", permission: "origination.chart-flows.view" },
        ],
      },
      {
        module: "credit-analysis",
        label: "360 RAR analysis",
        href: "/credit-analysis",
        icon: Radar,
        phase: 1,
        prd: "§6.2",
        pages: [
          { label: "Assessments", href: "/credit-analysis", permission: "credit-analysis.assessments.view" },
          { label: "Peer benchmarks", href: "/credit-analysis/benchmarks", phase: 2, permission: "credit-analysis.benchmarks.view" },
          { label: "Share of wallet", href: "/credit-analysis/share-of-wallet", phase: 2, permission: "credit-analysis.share-of-wallet.view" },
          { label: "NGX sector corpus", href: "/credit-analysis/sector-corpus", phase: 2, permission: "credit-analysis.sector-corpus.view" },
          { label: "My requests", href: "/credit-analysis/requests", permission: "credit-analysis.requests.view" },
        ],
      },
      {
        module: "offer-letters",
        label: "Offer letters",
        href: "/offer-letters",
        icon: FileSignature,
        phase: 1,
        prd: "§7",
        pages: [
          { label: "Offer letters", href: "/offer-letters", permission: "offer-letters.letters.view" },
          { label: "House template", href: "/offer-letters/template", permission: "offer-letters.template.view" },
          { label: "Conditions library", href: "/offer-letters/library", permission: "offer-letters.clauses.view" },
        ],
      },
      {
        module: "credit-admin",
        label: "Credit administration",
        href: "/credit-admin",
        icon: BookOpenCheck,
        phase: 1,
        prd: "§6.3",
        pages: [
          { label: "Facility register", href: "/credit-admin", permission: "credit-admin.facilities.view" },
          { label: "Waivers & deferrals", href: "/credit-admin/waivers", permission: "credit-admin.waivers.view" },
          { label: "CRMS desk", href: "/credit-admin/crms", permission: "credit-admin.crms.view" },
          { label: "Credit files", href: "/credit-admin/credit-files", permission: "credit-admin.credit-files.view" },
        ],
      },
      { module: "disbursement", label: "Disbursement", href: "/disbursement", permission: "disbursement.queue.view", icon: Banknote, phase: 1, prd: "§4.1, §4.2" },
      {
        module: "monitoring",
        label: "Loan review & monitoring",
        href: "/monitoring",
        icon: Bell,
        phase: 1,
        prd: "§6.4",
        pages: [
          { label: "Past-due obligations", href: "/monitoring", permission: "monitoring.past-due.view" },
          { label: "Covenants & inflows", href: "/monitoring/covenants", permission: "monitoring.covenants.view" },
          { label: "Guarantees & overdrafts", href: "/monitoring/guarantees", permission: "monitoring.guarantees.view" },
          { label: "Exceptions & escalations", href: "/monitoring/exceptions", permission: "monitoring.exceptions.view" },
          { label: "Escalation protocol", href: "/monitoring/escalation", permission: "monitoring.escalation.view" },
        ],
      },
      {
        module: "collateral",
        label: "Collateral & legal",
        href: "/collateral",
        icon: ShieldCheck,
        phase: 1,
        prd: "§6.5, §5.7",
        pages: [
          { label: "Collateral register", href: "/collateral", permission: "collateral.register.view" },
          { label: "Legal review", href: "/collateral/legal", permission: "collateral.legal.view" },
          { label: "Valuation verification", href: "/collateral/verification", permission: "collateral.verification.view" },
          { label: "Share-backed (SEC/CSCS)", href: "/collateral/shares", phase: 2, permission: "collateral.shares.view" },
        ],
      },
    ],
  },
  {
    label: "Portfolio & risk",
    items: [
      {
        module: "portfolio",
        label: "Portfolio & MIS",
        href: "/portfolio",
        icon: BarChart3,
        phase: 1,
        prd: "§6.6",
        pages: [
          { label: "Dashboards", href: "/portfolio", permission: "portfolio.dashboards.view" },
          { label: "Limits", href: "/portfolio/limits", permission: "portfolio.limits.view" },
          { label: "Concentration", href: "/portfolio/concentration", permission: "portfolio.concentration.view" },
          { label: "WARR", href: "/portfolio/warr", permission: "portfolio.warr.view" },
          { label: "Sector performance", href: "/portfolio/sector-performance", phase: 2, permission: "portfolio.sector-performance.view" },
          { label: "Projections", href: "/portfolio/projections", phase: 2, permission: "portfolio.projections.view" },
          { label: "Annual plan", href: "/portfolio/annual-plan", phase: 2, permission: "portfolio.annual-plan.view" },
          { label: "Regulatory reports", href: "/portfolio/reports", permission: "portfolio.reports.view" },
        ],
      },
      {
        module: "ifrs9",
        label: "IFRS 9 & ICAAP",
        href: "/ifrs9",
        icon: TrendingUp,
        phase: 2,
        prd: "§6.7",
        pages: [
          { label: "ECL overview", href: "/ifrs9", permission: "ifrs9.ecl.view" },
          { label: "Staging", href: "/ifrs9/staging", permission: "ifrs9.staging.view" },
          { label: "PD / LGD / EAD models", href: "/ifrs9/models", permission: "ifrs9.models.view" },
          { label: "ICAAP", href: "/ifrs9/icaap", permission: "ifrs9.icaap.view" },
          { label: "Declassification", href: "/ifrs9/declassification", permission: "ifrs9.declassification.view" },
          { label: "Rules & approvals", href: "/ifrs9/governance", permission: "ifrs9.governance.view" },
        ],
      },
      {
        module: "market-risk",
        label: "Market & liquidity",
        href: "/market-risk",
        icon: Waves,
        phase: 2,
        prd: "§6.8",
        pages: [
          { label: "Market risk", href: "/market-risk", permission: "market-risk.market.view" },
          { label: "Liquidity", href: "/market-risk/liquidity", permission: "market-risk.liquidity.view" },
          { label: "ILAAP", href: "/market-risk/ilaap", phase: 3, permission: "market-risk.ilaap.view" },
          { label: "Stress testing", href: "/market-risk/stress-testing", phase: 3, permission: "market-risk.stress-testing.view" },
          { label: "Limits, rules & approvals", href: "/market-risk/governance", permission: "market-risk.governance.view" },
        ],
      },
      {
        module: "operational-risk",
        label: "Operational risk",
        href: "/operational-risk",
        icon: ShieldAlert,
        phase: 2,
        prd: "§6.9",
        pages: [
          { label: "KRIs", href: "/operational-risk", permission: "operational-risk.kris.view" },
          { label: "Loss events", href: "/operational-risk/loss-events", permission: "operational-risk.loss-events.view" },
          { label: "RCSA", href: "/operational-risk/rcsa", permission: "operational-risk.rcsa.view" },
          { label: "BCM & crisis", href: "/operational-risk/bcm", permission: "operational-risk.bcm.view" },
        ],
      },
      {
        module: "enterprise-risk",
        label: "Enterprise risk",
        href: "/enterprise-risk",
        icon: Building2,
        phase: 2,
        prd: "§6.10",
        pages: [
          { label: "Risk appetite", href: "/enterprise-risk", permission: "enterprise-risk.risk-appetite.view" },
          { label: "Risk register", href: "/enterprise-risk/register", permission: "enterprise-risk.register.view" },
          { label: "Insider & related party", href: "/enterprise-risk/insider", permission: "enterprise-risk.insider.view" },
          { label: "Regulatory & policies", href: "/enterprise-risk/regulatory", permission: "enterprise-risk.regulatory.view" },
          { label: "BRC pack", href: "/enterprise-risk/brc-pack", permission: "enterprise-risk.brc-pack.view" },
          { label: "Lines of defence", href: "/enterprise-risk/lines-of-defence", permission: "enterprise-risk.lines-of-defence.view" },
        ],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        module: "operations",
        label: "Operations",
        href: "/operations",
        icon: Workflow,
        prd: "§10.4",
        pages: [
          { label: "Approvals", href: "/operations", permission: "operations.queue.view" },
          { label: "My requests", href: "/operations/requests", permission: "operations.requests.view" },
          { label: "Workflows", href: "/operations/workflows", permission: "operations.workflows.view" },
          { label: "Business rules", href: "/operations/rules", permission: "rules.rules.view" },
          { label: "Notifications", href: "/operations/notifications", permission: "notifications.templates.view" },
          { label: "Events & hooks", href: "/operations/events", permission: "operations.events.view" },
        ],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        module: "connectors",
        label: "Connectors",
        href: "/connectors",
        icon: Cable,
        phase: 1,
        prd: "§5",
        pages: [
          { label: "Overview", href: "/connectors", permission: "connectors.overview.view" },
          { label: "Recent runs", href: "/connectors/runs", permission: "connectors.runs.view" },
          { label: "Staging & reconciliation", href: "/connectors/staging", permission: "connectors.staging.view" },
        ],
      },
      {
        module: "admin",
        label: "Users & roles",
        href: "/admin",
        icon: Users,
        prd: "§4",
        pages: [
          { label: "Users", href: "/admin", permission: "identity.users.view" },
          { label: "Roles & limits", href: "/admin/roles", permission: "identity.roles.view" },
          { label: "Permissions", href: "/admin/permissions", permission: "identity.permissions.view" },
          { label: "Permission groups", href: "/admin/groups", permission: "identity.groups.view" },
          { label: "Rules & parameters", href: "/admin/parameters", permission: "platform.parameters.view" },
          { label: "Master data", href: "/admin/master-data", permission: "master-data.values.manage-view" },
        ],
      },
      {
        module: "documents",
        label: "Documents",
        href: "/documents",
        icon: FolderOpen,
        prd: "§5.4",
        permission: "documents.documents.view",
        pages: [
          { label: "Library", href: "/documents/library", permission: "documents.library.view" },
          { label: "Retention", href: "/documents/retention", permission: "documents.retention.request-purge" },
          { label: "Store", href: "/documents/store", permission: "documents.store.view" },
        ],
      },
      { module: "audit", label: "Audit log", href: "/audit", permission: "audit.log.view", icon: ScrollText, prd: "§10.3" },
      {
        module: "settings",
        label: "Settings",
        href: "/settings",
        icon: SlidersHorizontal,
        pages: [
          { label: "Profile & security", href: "/settings", permission: "settings.profile.view" },
          { label: "Password", href: "/settings/password", permission: "identity.password.change" },
          { label: "Security", href: "/settings/security", permission: "identity.me.mfa" },
          { label: "Branding", href: "/settings/branding", permission: "settings.branding.view" },
        ],
      },
    ],
  },
];

export const allNavItems = navigation.flatMap((g) => g.items);

/** Icons re-exported for pages that want a module's icon. */
export const moduleIcons = { KeyRound, Palette };

export function navItemFor(pathname: string): NavItem | undefined {
  return [...allNavItems].sort((a, b) => b.href.length - a.href.length).find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}

/** Permissions that show a nav item (API contract §5): any permission whose area is the item's module. */
export function navItemPermissions(item: NavItem): PermissionKey[] {
  // Items whose keys sit in other areas (e.g. Documents) also show for their own page / view keys.
  return [...new Set([...areaPermissions(item.module), ...(item.permission ? [item.permission] : []), ...(item.pages ?? []).map((p) => p.permission)])];
}

/** The view permission a path needs: the most specific matching sub-page, else the item's own key. */
export function pagePermissionFor(pathname: string): PermissionKey | undefined {
  const item = navItemFor(pathname);
  if (!item) return undefined;
  const page = [...(item.pages ?? [])].filter((p) => !p.href.includes("?")).sort((a, b) => b.href.length - a.href.length).find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
  return page?.permission ?? item.permission;
}
