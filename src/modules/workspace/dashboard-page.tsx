"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  FilePlus2,
  Gauge as GaugeIcon,
  Inbox,
  Landmark,
  Palette,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Timer,
  UserPlus,
  Users,
  Workflow,
} from "lucide-react";
import {
  ActionBlocks,
  ActivityFeed,
  AiInsightCard,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  DonutChart,
  EmptyState,
  Grid,
  KeyValueGrid,
  MiniBarList,
  NotificationList,
  Stack,
  StatCard,
  Text,
  TextLink,
  type ActionBlockItem,
  type ActivityItem,
  type AppNotification,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole, useSession } from "@/lib/auth/session";
import { roleById, type Role } from "@/lib/rbac/roles";
import { usePermissionSet, type PermissionKey } from "@/lib/iam/permissions";
import { useApplications, useAudit, useLookups, useObligors, useTenant, useUsers } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Application, ApprovalStep } from "@/lib/data/types";
import { chartFlow } from "@/lib/workflow";
import { ago, date, moneyShort, pct } from "@/lib/format";
import { flowTierOf, useOpenAdminOperations, useRoleLimit } from "@/modules/admin/store";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { currentStep, stepDueAt, useMyApprovalQueue, useMyRequests, type OperationInstance } from "@/lib/platform/operations";
import { markNotificationsRead, useMyNotifications } from "@/lib/platform/notifications";
import { useRule, useRulesStore } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { classTone, isDueSoon, isOverdue, nowMs, DAY, useApprovalsAwaiting, usePortfolioSnapshot, useRoleTasks, useWorkspaceStore } from "./data";
import { useAuditLog } from "./use-audit-log";

type Kpi = { id: string; label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: "brand" | "accent" | "success" | "warning" | "danger" | "info" | "neutral"; href: string };

const ic = (I: typeof Inbox) => <I aria-hidden className="size-5" />;

const preApproval: Application["stage"][] = ["Draft", "Documents", "Analysis", "Recommendation", "Approval", "Offer", "Conditions", "Disbursement"];

function audience(role: Role): "admin" | "front" | "approver" | "risk" | "ops" {
  if (role.group === "Administration") return "admin";
  if (role.id === "account-officer") return "front";
  if (role.group === "Credit approval" || role.id === "bdm") return "approver";
  if (role.group === "Operations & legal") return "ops";
  return "risk";
}

export function DashboardPage() {
  const role = useRole()!;
  const user = useSession((s) => s.user)!;
  const tenant = useTenant();
  const users = useUsers();
  const apps = useApplications();
  const obligors = useObligors();
  const audit = useAudit();
  const notifications = useMyNotifications();
  const lookups = useLookups();
  const awaiting = useApprovalsAwaiting(role.id);
  const tasks = useRoleTasks(role.id);
  const snap = usePortfolioSnapshot();
  const myLimit = useRoleLimit(role.id);
  const { actor } = useScope();
  // Credit approvals already listed from the chart-flow aren't repeated as Operations items.
  const opsQueue = useMyApprovalQueue(actor).filter((i) => !awaiting.some((a) => a.app.id === i.subject.id));
  const myRequests = useMyRequests(actor.id);
  const myOpenRequests = myRequests.filter((i) => i.status === "Pending" || i.status === "In progress");
  const adminOpen = useOpenAdminOperations();
  const nplAlertPct = useRule<number>("workspace.nplAlertPct");
  const nearLimitPct = useRule<number>("workspace.nearLimitPct");
  const decisionsWindowDays = useRule<number>("workspace.decisionsWindowDays");
  const activityWindowHours = useRule<number>("workspace.activityWindowHours");
  const kind = audience(role);
  const held = usePermissionSet();
  const can = (...keys: PermissionKey[]) => keys.some((k) => held.has(k));
  const firstName = user.name.split(" ")[0];
  const greeting = DEMO_NOW.getHours() < 12 ? "Good morning" : DEMO_NOW.getHours() < 17 ? "Good afternoon" : "Good evening";

  const me = users.find((u) => u.id === user.id);
  const myApps = useMemo(
    () => apps.filter((a) => a.createdById === user.id || obligors.find((o) => o.id === a.obligorId)?.relationshipManagerId === user.id),
    [apps, obligors, user.id],
  );
  const pipeline = (kind === "front" ? myApps : apps).filter((a) => preApproval.includes(a.stage));
  const openTasks = tasks.filter((t) => t.status === "Open");
  const awaitingValue = awaiting.reduce((s, x) => s + x.app.amount, 0);
  const awaitingOverdue = awaiting.filter((x) => isOverdue(x.app.slaDueAt)).length;
  const canPortfolio = can("portfolio.dashboards.view", "executive.cockpit.view");

  // ---------------------------------------------------------------- KPIs (role-aware)
  const kpis: Kpi[] = (() => {
    const tasksKpi: Kpi = {
      id: "tasks",
      label: "My open tasks",
      value: openTasks.length + awaiting.length + opsQueue.length,
      hint: `${openTasks.filter((t) => isOverdue(t.dueAt)).length + awaitingOverdue} overdue · ${opsQueue.length} in Operations`,
      icon: ic(Inbox),
      tone: "accent",
      href: "/inbox",
    };
    const awaitingKpi: Kpi = {
      id: "awaiting",
      label: role.id === "bdm" ? "Awaiting my recommendation" : "Awaiting my decision",
      value: awaiting.length,
      hint: awaiting.length ? `${moneyShort(awaitingValue)} · ${awaitingOverdue} past SLA` : "Nothing waiting",
      icon: ic(Inbox),
      tone: awaitingOverdue ? "warning" : "accent",
      href: "/inbox",
    };
    const limitKpi: Kpi = {
      id: "limit",
      label: "My sign-on limit",
      value: myLimit === null ? "—" : moneyShort(myLimit),
      hint: `Chart-flow tier ${flowTierOf(role.id) ?? "—"} · ${role.authority}`,
      icon: ic(Landmark),
      tone: "brand",
      href: "/admin/roles",
    };
    const decided = apps.flatMap((a) => a.approvals.filter((s) => s.roleId === role.id && s.decidedAt && nowMs - new Date(s.decidedAt).getTime() <= decisionsWindowDays * DAY));
    const decidedKpi: Kpi = {
      id: "decided",
      label: `My decisions (${decisionsWindowDays} days)`,
      value: decided.length,
      hint: `${decided.filter((s) => s.decision === "approved" || s.decision === "recommended").length} approved / recommended · ${decided.filter((s) => s.decision === "declined").length} declined`,
      icon: ic(BadgeCheck),
      tone: "success",
      href: "/origination",
    };
    const npl: Kpi = { id: "npl", label: "NPL ratio", value: pct(snap.nplRatio), hint: `${moneyShort(snap.npl)} of ${moneyShort(snap.outstanding)} classified`, icon: ic(AlertTriangle), tone: snap.nplRatio > nplAlertPct ? "danger" : "success", href: "/portfolio" };
    const stages: Kpi = { id: "stages", label: "Stage 2 / Stage 3", value: `${moneyShort(snap.stage2)} / ${moneyShort(snap.stage3)}`, hint: "IFRS 9 exposure (outstanding)", icon: ic(BarChart3), tone: "warning", href: "/ifrs9/staging" };
    const breaches: Kpi = {
      id: "breaches",
      label: "Sector limit breaches",
      value: snap.breaches.length,
      hint: `${snap.nearBreach.length} within ${100 - nearLimitPct}% of limit`,
      icon: ic(ShieldAlert),
      tone: snap.breaches.length ? "danger" : "success",
      href: "/portfolio/limits",
    };
    const watch: Kpi = { id: "watch", label: "Watchlist obligors", value: snap.watchlistObligors, hint: `of ${obligors.length} obligors`, icon: ic(GaugeIcon), tone: "warning", href: "/monitoring" };
    switch (kind) {
      case "front": {
        const dueSoon = pipeline.filter((a) => isDueSoon(a.slaDueAt) || isOverdue(a.slaDueAt)).length;
        return [
          { id: "pipe", label: "My pipeline", value: pipeline.length, hint: `${moneyShort(pipeline.reduce((s, a) => s + a.amount, 0))} requested`, icon: ic(BriefcaseBusiness), tone: "accent", href: "/origination" },
          { id: "docs", label: "Awaiting documents", value: pipeline.filter((a) => a.stage === "Draft" || a.stage === "Documents").length, hint: "Draft or document collection", icon: ic(ClipboardList), tone: "info", href: "/origination" },
          { id: "sla", label: "SLA due ≤ 48h", value: dueSoon, hint: "Includes past-SLA", icon: ic(Timer), tone: dueSoon ? "warning" : "success", href: "/origination" },
          { id: "offers", label: "Offers to present", value: myApps.filter((a) => a.stage === "Offer").length, hint: "Approved — present offer letter", icon: ic(BadgeCheck), tone: "success", href: "/offer-letters" },
        ];
      }
      case "approver":
        return role.id === "cro" || role.id === "md" ? [awaitingKpi, limitKpi, npl, breaches] : [awaitingKpi, limitKpi, decidedKpi, npl];
      case "risk":
        // Analysts (who record credit analysis) track their review queue; other risk roles see their task list.
        return can("origination.analysis.record") ? [awaitingKpi, npl, watch, stages] : [tasksKpi, npl, stages, breaches];
      case "ops":
        return [
          tasksKpi,
          { id: "disb", label: "In disbursement", value: apps.filter((a) => a.stage === "Disbursement").length, hint: "Conditions met — awaiting maker/checker", icon: ic(Banknote), tone: "accent", href: "/disbursement" },
          { id: "cond", label: "Conditions outstanding", value: apps.filter((a) => a.stage === "Conditions").length, hint: "Applications at CP stage", icon: ic(ClipboardList), tone: "info", href: "/credit-admin" },
          watch,
        ];
      case "admin": {
        const active = users.filter((u) => u.status === "Active").length;
        const since = nowMs - activityWindowHours * 3_600_000;
        return [
          { id: "users", label: "Active users", value: active, hint: `${users.filter((u) => u.status === "Pending").length} invitations pending`, icon: ic(Users), tone: "accent", href: "/admin" },
          { id: "mfa", label: "MFA not enrolled", value: users.filter((u) => !u.mfa && u.status !== "Suspended").length, hint: "MFA is mandatory on every login", icon: ic(ShieldAlert), tone: users.some((u) => !u.mfa) ? "warning" : "success", href: "/admin" },
          { id: "audit", label: `Audit events (${activityWindowHours}h)`, value: audit.filter((e) => new Date(e.at).getTime() >= since).length, hint: "Append-only audit trail", icon: ic(ScrollText), tone: "info", href: "/audit" },
          { id: "ops", label: "Admin changes in Operations", value: adminOpen.length, hint: `${opsQueue.length} awaiting your decision`, icon: ic(Workflow), tone: adminOpen.length ? "warning" : "success", href: "/operations" },
        ];
      }
    }
  })();

  // ---------------------------------------------------------------- quick actions
  const actions: ActionBlockItem[] = (
    [
      can("origination.applications.create") && kind !== "admin" ? { title: "New credit application", description: "Start an origination file", icon: <FilePlus2 aria-hidden />, href: "/origination/new" } : null,
      awaiting.length || kind === "approver" ? { title: "Review approvals", description: `${awaiting.length} awaiting you`, icon: <Inbox aria-hidden />, href: "/inbox" } : null,
      opsQueue.length ? { title: "Operations approvals", description: `${opsQueue.length} awaiting your decision`, icon: <Workflow aria-hidden />, href: "/operations" } : null,
      can("portfolio.limits.view") ? { title: "Portfolio limits", description: "Sector and obligor limits", icon: <BarChart3 aria-hidden />, href: "/portfolio/limits" } : null,
      can("monitoring.exceptions.view") ? { title: "Exceptions", description: "Escalations and past-due", icon: <ShieldAlert aria-hidden />, href: "/monitoring/exceptions" } : null,
      can("disbursement.queue.view") ? { title: "Disbursement queue", description: "Maker / checker", icon: <Banknote aria-hidden />, href: "/disbursement" } : null,
      can("identity.users.invite") ? { title: "Invite a user", description: "Named user, MFA enforced", icon: <UserPlus aria-hidden />, href: "/admin" } : null,
      can("platform.parameters.view") ? { title: "Rules & parameters", description: "Limits, tiers, thresholds", icon: <SlidersHorizontal aria-hidden />, href: "/admin/parameters" } : null,
      can("audit.log.view") ? { title: "Audit log", description: "Append-only trail", icon: <ScrollText aria-hidden />, href: "/audit" } : null,
      can("settings.branding.view") ? { title: "Branding", description: "Colours, logo and font", icon: <Palette aria-hidden />, href: "/settings/branding" } : null,
    ] as Array<ActionBlockItem | null>
  )
    .filter((x): x is ActionBlockItem => x !== null)
    .slice(0, 4);

  // ---------------------------------------------------------------- notifications & activity
  const myNotifications: AppNotification[] = notifications
    .slice(0, 5)
    .map((n) => ({ id: n.id, title: n.title, body: n.body, tone: n.tone, read: n.read, href: n.href, time: ago(n.createdAt) }));

  const seesAll = can("audit.log.view");
  const activity: ActivityItem[] = audit
    .filter((e) => seesAll || e.actorId === user.id || e.roleId === role.id)
    .slice(0, 6)
    .map((e) => ({
      id: e.id,
      actor: { name: e.actorName, role: roleById[e.roleId]?.name },
      action: e.action.toLowerCase(),
      target: e.entityId !== "-" ? `${e.entityType} ${e.entityId}` : undefined,
      timestamp: e.at,
      changes: e.before || e.after ? [{ field: "Value", before: e.before, after: e.after }] : undefined,
    }));

  return (
    <ModulePage
      module="dashboard"
      title={`${greeting}, ${firstName}`}
      description={
        <>
          {role.name} · {me?.branch ? `${me.branch} · ` : ""}
          {tenant.name} · {date(DEMO_NOW)}
        </>
      }
      actions={
        <>
          <Button variant="tertiary" href="/inbox" as={Link} iconBefore={<Inbox aria-hidden className="size-4" />}>
            My tasks
          </Button>
          {can("origination.applications.create") && kind !== "admin" ? (
            <Button href="/origination/new" as={Link} iconBefore={<FilePlus2 aria-hidden className="size-4" />}>
              New application
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          {kpis.map((k) => (
            <Link key={k.id} href={k.href} className="squircle block rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <StatCard label={k.label} value={k.value} hint={k.hint} icon={k.icon} tone={k.tone} className="h-full transition hover:shadow-md" />
            </Link>
          ))}
        </Grid>

        {opsQueue.length || myOpenRequests.length ? <OperationsCard queue={opsQueue} requests={myOpenRequests} /> : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Stack gap="large" className="min-w-0">
            {role.tier !== null || awaiting.length ? <ApprovalsCard awaiting={awaiting} limit={myLimit} /> : null}
            {kind === "admin" && openTasks.length === 0 ? <ConfigGlance /> : <TasksPreview tasks={openTasks} approvals={awaiting.length + opsQueue.length} />}
            {canPortfolio ? <PortfolioSnapshotCard /> : kind === "front" ? <PipelineCard apps={myApps} /> : null}
            <Card>
              <CardHeader>
                <CardTitle>Quick actions</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionBlocks items={actions} columns={2} linkComponent={Link} />
              </CardContent>
            </Card>
          </Stack>
          <Stack gap="large" className="min-w-0">
            {kind !== "admin" ? <AiFlags kind={kind} myObligorIds={kind === "front" ? new Set(myApps.map((a) => a.obligorId)) : undefined} /> : null}
            <Card padding="small">
              <CardContent>
                <NotificationList
                  notifications={myNotifications}
                  onMarkRead={(id) => markNotificationsRead([id])}
                  onMarkAllRead={() => markNotificationsRead(notifications.map((n) => n.id))}
                  linkComponent={Link}
                  emptyMessage="You're all caught up."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>Recent activity</CardTitle>
                {seesAll ? (
                  <TextLink href="/audit" as={Link}>
                    Audit log
                  </TextLink>
                ) : null}
              </CardHeader>
              <CardContent>
                <ActivityFeed items={activity} label="Recent activity" emptyMessage="No recent activity." formatTimestamp={(t) => ago(t)} />
              </CardContent>
            </Card>
          </Stack>
        </div>
        <Text variant="caption" tone="subtle">
          Demo tenant data (fictional) as at {date(DEMO_NOW)}. Figures are computed from the shared Risk Data Spine — open any tile for the source records. {lookups.obligor.size} obligors loaded.
        </Text>
      </Stack>
    </ModulePage>
  );
}

// ---------------------------------------------------------------- approvals awaiting me

type AwaitRow = { app: Application; step: ApprovalStep };

function ApprovalsCard({ awaiting, limit }: { awaiting: AwaitRow[]; limit: number | null }) {
  const { obligor } = useLookups();
  const columns: DataTableColumn<AwaitRow>[] = [
    {
      id: "id",
      header: "Application",
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-mono font-semibold text-fg">{r.app.id}</span>
          <span className="text-sm text-fg-muted">{obligor.get(r.app.obligorId)?.name}</span>
        </span>
      ),
    },
    { id: "product", header: "Product", accessor: (r) => r.app.product },
    { id: "amount", header: "Amount", numeric: true, accessor: (r) => r.app.amount, cell: (r) => moneyShort(r.app.amount) },
    {
      id: "step",
      header: "My step",
      cell: (r) => (
        <Badge tone={r.step.adjudicates ? "warning" : r.step.pair ? "info" : "neutral"}>{r.step.adjudicates ? "Adjudicate dissent" : r.step.pair ? `Co-sign · ${r.step.pair}` : r.step.tier === 1 ? "Recommend" : `Tier ${r.step.tier}`}</Badge>
      ),
    },
    {
      id: "sla",
      header: "SLA",
      accessor: (r) => r.app.slaDueAt,
      cell: (r) => (isOverdue(r.app.slaDueAt) ? <Badge tone="danger">Overdue · {date(r.app.slaDueAt)}</Badge> : <span className="font-mono">{date(r.app.slaDueAt)}</span>),
    },
  ];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Approvals awaiting me</CardTitle>
          <Text variant="small" tone="muted">
            Routed by the approval chart-flow · my limit {limit === null ? "—" : moneyShort(limit)}. Amounts above the high-value threshold need step-up authentication.
          </Text>
        </div>
        <TextLink href="/inbox" as={Link}>
          Open My tasks
        </TextLink>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={awaiting.slice(0, 5)}
          getRowId={(r) => r.app.id}
          getRowHref={(r) => `/origination/application?id=${r.app.id}`}
          linkComponent={Link}
          paginate={false}
          label="Approvals awaiting me"
          emptyState={<EmptyState icon={<BadgeCheck aria-hidden />} title="Nothing awaiting your decision" description="New approvals appear here as soon as the chart-flow routes them to you." />}
          mobileCard={(r) => (
            <div className="flex flex-col gap-1">
              <span className="font-mono font-semibold">
                {r.app.id} · {moneyShort(r.app.amount)}
              </span>
              <span className="text-sm text-fg-muted">{obligor.get(r.app.obligorId)?.name}</span>
              <span className="text-sm">SLA {date(r.app.slaDueAt)}</span>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- configuration at a glance (admin roles)

function ConfigGlance() {
  const stepUp = useRule<number>("approvals.stepUpThresholdNgn");
  const neutral = useRule<number>("rar.neutralBelow");
  const marginal = useRule<number>("rar.marginalBelow");
  const moderate = useRule<number>("rar.moderateBelow");
  const offered = useRule<string[]>("origination.products");
  const overrides = useRulesStore((s) => Object.keys(s.values).length);
  const open = useOpenAdminOperations();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Configuration at a glance</CardTitle>
          <Text variant="small" tone="muted">
            Business rules — every change is approved in Operations, then applies without a code release.
          </Text>
        </div>
        <TextLink href="/admin/parameters" as={Link}>
          Rules & parameters
        </TextLink>
      </CardHeader>
      <CardContent>
        <KeyValueGrid
          columns={3}
          items={[
            { label: "Step-up threshold", value: moneyShort(stepUp), hint: "PRD §4.2" },
            { label: "RAR intensity bands", value: `${neutral} · ${marginal} · ${moderate}`, hint: "Neutral · Marginal · Moderate" },
            { label: "Products offered", value: offered.length, hint: "Product catalogue" },
            { label: "Chart-flow tiers", value: chartFlow.length, hint: "Approval chart-flow" },
            { label: "Rules changed from default", value: overrides, hint: "Tenant overrides" },
            { label: "Awaiting approval", value: open.length, hint: "Admin changes in Operations" },
          ]}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- tasks preview

function TasksPreview({ tasks, approvals }: { tasks: ReturnType<typeof useRoleTasks>; approvals: number }) {
  const top = [...tasks].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 5);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>My tasks</CardTitle>
        <TextLink href="/inbox" as={Link}>
          View all ({tasks.length + approvals})
        </TextLink>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <EmptyState icon={<ClipboardList aria-hidden />} title="No open tasks" description={approvals ? `You have ${approvals} approval(s) waiting — see above.` : "Tasks assigned to your role appear here."} />
        ) : (
          <ul className="divide-y divide-line">
            {top.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 flex-col">
                  <Link href={t.href} className="font-semibold text-fg hover:text-link focus-visible:outline-2 focus-visible:outline-focus">
                    {t.title}
                  </Link>
                  <span className="text-sm text-fg-muted">{t.module}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={t.priority === "High" ? "danger" : t.priority === "Medium" ? "warning" : "neutral"}>{t.priority}</Badge>
                  {isOverdue(t.dueAt) ? <Badge tone="danger" variant="solid">Overdue</Badge> : <Badge variant="outline">Due {date(t.dueAt)}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- portfolio snapshot

function PortfolioSnapshotCard() {
  const snap = usePortfolioSnapshot();
  const nearLimitPct = useRule<number>("workspace.nearLimitPct");
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Portfolio snapshot</CardTitle>
          <Text variant="small" tone="muted">
            Outstanding {moneyShort(snap.outstanding)} · NPL = Substandard + Doubtful + Lost ÷ total outstanding
          </Text>
        </div>
        <TextLink href="/portfolio" as={Link}>
          Portfolio & MIS
        </TextLink>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8">
          <div>
            <Text variant="eyebrow" tone="muted" className="mb-3 block">
              By CBN classification
            </Text>
            <DonutChart
              segments={snap.byClass.map((c) => ({ label: c.label, value: c.value, tone: classTone[c.label] }))}
              centerLabel="NPL ratio"
              centerValue={pct(snap.nplRatio)}
              valueFormatter={(v) => moneyShort(v)}
              label="Outstanding by CBN prudential classification"
            />
          </div>
          <div>
            <Text variant="eyebrow" tone="muted" className="mb-3 block">
              Top sectors · share vs limit
            </Text>
            <MiniBarList
              items={snap.bySector.slice(0, 6).map((s) => ({
                label: s.label,
                value: s.value,
                href: "/portfolio/concentration",
                meta: `${pct(s.sharePct)} of book · limit ${pct(s.limitPct, 0)}`,
                tone: s.sharePct > s.limitPct ? "danger" : s.sharePct >= s.limitPct * (nearLimitPct / 100) ? "warning" : "accent",
              }))}
              valueFormatter={(v) => moneyShort(v)}
              linkComponent={Link}
              label="Top sectors by outstanding"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineCard({ apps }: { apps: Application[] }) {
  const stages: Application["stage"][] = ["Draft", "Documents", "Analysis", "Recommendation", "Approval", "Offer", "Conditions", "Disbursement"];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>My pipeline by stage</CardTitle>
        <TextLink href="/origination" as={Link}>
          Applications
        </TextLink>
      </CardHeader>
      <CardContent>
        {apps.length === 0 ? (
          <EmptyState icon={<BriefcaseBusiness aria-hidden />} title="No applications yet" description="Start a credit application to build your pipeline." />
        ) : (
          <BarChart data={stages.map((s) => ({ label: s, value: apps.filter((a) => a.stage === s).length }))} label="My applications by stage" height={220} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- AI-flagged items (PRD §6.12 exception flagging)

function AiFlags({ kind, myObligorIds }: { kind: string; myObligorIds?: Set<string> }) {
  const obligors = useObligors();
  const apps = useApplications();
  const snap = usePortfolioSnapshot();
  const user = useSession((s) => s.user)!;
  const signedOff = useWorkspaceStore((s) => s.signedOff);
  const dismissed = useWorkspaceStore((s) => s.dismissed);
  const signOff = useWorkspaceStore((s) => s.signOff);
  const dismiss = useWorkspaceStore((s) => s.dismiss);
  const log = useAuditLog();
  const shortfallRatio = useRule<number>("workspace.inflowShortfallRatio");
  const stalledDays = useRule<number>("workspace.stalledStageDays");

  const review = async (id: string, kind: "signed-off" | "dismissed") => {
    const hook = await runHooks("workspace.ai-flag.review.before", { flagId: id, kind });
    if (!hook.ok) return;
    if (kind === "signed-off") signOff(id, user.name);
    else dismiss(id);
    log({ action: kind === "signed-off" ? "Signed off AI-flagged exception" : "Dismissed AI-flagged exception", entityType: "AI flag", entityId: id, after: kind === "signed-off" ? "Reviewed — accepted" : "Dismissed" });
    publish(`workspace.ai-flag.${kind}`, { module: "workspace", subject: { type: "AI flag", id, href: "/dashboard" }, payload: { by: user.name } });
    await runHooks("workspace.ai-flag.review.after", { flagId: id, kind });
  };

  const flags = useMemo(() => {
    const shortfall = obligors
      .filter((o) => (!myObligorIds || myObligorIds.has(o.id)) && o.verifiedTurnover / o.declaredTurnover < shortfallRatio)
      .sort((a, b) => a.verifiedTurnover / a.declaredTurnover - b.verifiedTurnover / b.declaredTurnover)
      .slice(0, 3);
    const stalled = apps
      .filter((a) => ["Documents", "Analysis", "Recommendation", "Approval"].includes(a.stage) && nowMs - new Date(a.updatedAt).getTime() > stalledDays * DAY)
      .slice(0, 3);
    const sectors = [...snap.breaches, ...snap.nearBreach].slice(0, 3);
    const out: Array<{ id: string; title: string; bullets: ReactNode[]; sources: Array<{ label: string; href?: string; detail?: string }>; confidence: number }> = [];
    if (shortfall.length)
      out.push({
        id: "flag-inflow",
        title: "Account inflows below declared turnover",
        confidence: 0.82,
        bullets: shortfall.map((o) => (
          <span key={o.id}>
            <Link className="font-semibold text-link" href={`/credit-analysis/assessment?id=${o.id}`}>
              {o.name}
            </Link>{" "}
            — COP ratio {(o.verifiedTurnover / o.declaredTurnover).toFixed(2)} (verified ÷ declared turnover)
          </span>
        )),
        sources: [{ label: "CBA statements (simulated connector)", detail: "Verified turnover, last 12 months" }, { label: "Customer financials", detail: "Declared turnover" }],
      });
    if (sectors.length && kind !== "front")
      out.push({
        id: "flag-sector",
        title: "Sector concentration at or near limit",
        confidence: 0.9,
        bullets: sectors.map((s) => (
          <span key={s.id}>
            <Link className="font-semibold text-link" href="/portfolio/limits">
              {s.label}
            </Link>{" "}
            — {pct(s.sharePct)} of book vs limit {pct(s.limitPct, 0)}
          </span>
        )),
        sources: [{ label: "Facility register", href: "/credit-admin", detail: "Outstanding by obligor sector" }, { label: "Rules & parameters", href: "/admin/parameters", detail: "Sector limits" }],
      });
    if (stalled.length)
      out.push({
        id: "flag-stalled",
        title: `Workflow stages stalled for more than ${stalledDays} days`,
        confidence: 0.74,
        bullets: stalled.map((a) => (
          <span key={a.id}>
            <Link className="font-semibold text-link" href={`/origination/application?id=${a.id}`}>
              {a.id}
            </Link>{" "}
            — {a.stage}, last updated {date(a.updatedAt)}
          </span>
        )),
        sources: [{ label: "Origination workflow", href: "/origination", detail: "Stage timestamps" }],
      });
    return out.filter((f) => !dismissed.includes(f.id));
  }, [obligors, apps, snap, myObligorIds, kind, dismissed, shortfallRatio, stalledDays]);

  return (
    <Stack gap="medium">
      {flags.length === 0 ? (
        <Card variant="filled">
          <CardContent>
            <Text tone="muted">No AI-flagged exceptions for your role right now.</Text>
          </CardContent>
        </Card>
      ) : (
        flags.slice(0, 2).map((f) => (
          <AiInsightCard
            key={f.id}
            kind="flagged"
            title={f.title}
            model="Credigit Risk Copilot (simulated) · rules v1.0"
            generatedAt={`Generated ${date(DEMO_NOW)}, 06:00`}
            confidence={f.confidence}
            bullets={f.bullets}
            sources={f.sources}
            signedOffBy={signedOff[f.id] ? `${signedOff[f.id]!.by} · ${ago(signedOff[f.id]!.at)}` : undefined}
            onAccept={() => void review(f.id, "signed-off")}
            onDismiss={() => void review(f.id, "dismissed")}
            labels={{ accept: "Sign off", dismiss: "Dismiss" }}
          />
        ))
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- Operations: approvals awaiting me + my requests

function OperationsCard({ queue, requests }: { queue: OperationInstance[]; requests: OperationInstance[] }) {
  const row = (i: OperationInstance, mine: boolean) => {
    const step = currentStep(i);
    const due = stepDueAt(i);
    return (
      <li key={`${mine ? "r" : "q"}:${i.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <span className="flex min-w-0 flex-col">
          <Link href={`/operations/item?id=${i.id}`} className="font-semibold text-fg hover:text-link focus-visible:outline-2 focus-visible:outline-focus">
            {i.title}
          </Link>
          <span className="text-sm text-fg-muted">{mine ? `Waiting on: ${step?.name ?? "—"}` : `Requested by ${i.requestedBy.name} · ${ago(i.requestedAt)}`}</span>
        </span>
        <span className="flex items-center gap-2">
          {mine ? <Badge variant="outline">My request</Badge> : <Badge tone="info">{step?.name ?? "Decision"}</Badge>}
          {due ? isOverdue(due) ? <Badge tone="danger">Overdue</Badge> : <Badge variant="outline">Due {date(due)}</Badge> : null}
        </span>
      </li>
    );
  };
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Operations</CardTitle>
          <Text variant="small" tone="muted">
            {queue.length} awaiting your decision · {requests.length} of your requests in progress. Configuration, access and other approvals route through the Operations workflow.
          </Text>
        </div>
        <TextLink href="/operations" as={Link}>
          Open Operations
        </TextLink>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-line">
          {queue.slice(0, 5).map((i) => row(i, false))}
          {requests.slice(0, 3).map((i) => row(i, true))}
        </ul>
      </CardContent>
    </Card>
  );
}
