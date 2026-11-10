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
} from "lucide-react";
import type { ModuleKey } from "./rbac/roles";

export type Phase = 1 | 2 | 3;

export type NavPage = { label: string; href: string; phase?: Phase };

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
};

export type NavGroup = { label: string; items: NavItem[] };

/** App navigation. Each module's pages live under its `href` (see docs in README). */
export const navigation: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { module: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { module: "inbox", label: "My tasks", href: "/inbox", icon: Inbox },
      { module: "executive", label: "Executive view", href: "/executive", icon: Gauge, phase: 1, prd: "§6.11, §3 row 19" },
      { module: "ai-console", label: "AI analytics", href: "/ai", icon: Bot, phase: 2, prd: "§6.12–6.13" },
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
          { label: "Applications", href: "/origination" },
          { label: "New application", href: "/origination/new" },
          { label: "Approval chart-flows", href: "/origination/chart-flows" },
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
          { label: "Assessments", href: "/credit-analysis" },
          { label: "Peer benchmarks", href: "/credit-analysis/benchmarks", phase: 2 },
          { label: "Share of wallet", href: "/credit-analysis/share-of-wallet", phase: 2 },
          { label: "NGX sector corpus", href: "/credit-analysis/sector-corpus", phase: 2 },
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
          { label: "Offer letters", href: "/offer-letters" },
          { label: "House template", href: "/offer-letters/template" },
          { label: "Conditions library", href: "/offer-letters/library" },
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
          { label: "Facility register", href: "/credit-admin" },
          { label: "Waivers & deferrals", href: "/credit-admin/waivers" },
          { label: "CRMS desk", href: "/credit-admin/crms" },
          { label: "Credit files", href: "/credit-admin/credit-files" },
        ],
      },
      { module: "disbursement", label: "Disbursement", href: "/disbursement", icon: Banknote, phase: 1, prd: "§4.1, §4.2" },
      {
        module: "monitoring",
        label: "Loan review & monitoring",
        href: "/monitoring",
        icon: Bell,
        phase: 1,
        prd: "§6.4",
        pages: [
          { label: "Past-due obligations", href: "/monitoring" },
          { label: "Covenants & inflows", href: "/monitoring/covenants" },
          { label: "Guarantees & overdrafts", href: "/monitoring/guarantees" },
          { label: "Exceptions & escalations", href: "/monitoring/exceptions" },
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
          { label: "Collateral register", href: "/collateral" },
          { label: "Legal review", href: "/collateral/legal" },
          { label: "Share-backed (SEC/CSCS)", href: "/collateral/shares", phase: 2 },
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
          { label: "Dashboards", href: "/portfolio" },
          { label: "Limits", href: "/portfolio/limits" },
          { label: "Concentration", href: "/portfolio/concentration" },
          { label: "WARR", href: "/portfolio/warr" },
          { label: "Sector performance", href: "/portfolio/sector-performance", phase: 2 },
          { label: "Projections", href: "/portfolio/projections", phase: 2 },
          { label: "Annual plan", href: "/portfolio/annual-plan", phase: 2 },
          { label: "Regulatory reports", href: "/portfolio/reports" },
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
          { label: "ECL overview", href: "/ifrs9" },
          { label: "Staging", href: "/ifrs9/staging" },
          { label: "PD / LGD / EAD models", href: "/ifrs9/models" },
          { label: "ICAAP", href: "/ifrs9/icaap" },
          { label: "Declassification", href: "/ifrs9/declassification" },
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
          { label: "Market risk", href: "/market-risk" },
          { label: "Liquidity", href: "/market-risk/liquidity" },
          { label: "ILAAP", href: "/market-risk/ilaap", phase: 3 },
          { label: "Stress testing", href: "/market-risk/stress-testing", phase: 3 },
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
          { label: "KRIs", href: "/operational-risk" },
          { label: "Loss events", href: "/operational-risk/loss-events" },
          { label: "RCSA", href: "/operational-risk/rcsa" },
          { label: "BCM & crisis", href: "/operational-risk/bcm" },
        ],
      },
      { module: "enterprise-risk", label: "Enterprise risk", href: "/enterprise-risk", icon: Building2, phase: 2, prd: "§6.10" },
    ],
  },
  {
    label: "Administration",
    items: [
      { module: "connectors", label: "Connectors", href: "/connectors", icon: Cable, phase: 1, prd: "§5" },
      {
        module: "admin",
        label: "Users & roles",
        href: "/admin",
        icon: Users,
        prd: "§4",
        pages: [
          { label: "Users", href: "/admin" },
          { label: "Roles & limits", href: "/admin/roles" },
          { label: "Rules & parameters", href: "/admin/parameters" },
        ],
      },
      { module: "audit", label: "Audit log", href: "/audit", icon: ScrollText, prd: "§10.3" },
      {
        module: "settings",
        label: "Settings",
        href: "/settings",
        icon: SlidersHorizontal,
        pages: [
          { label: "Profile & security", href: "/settings" },
          { label: "Password", href: "/settings/password" },
          { label: "Branding", href: "/settings/branding" },
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
