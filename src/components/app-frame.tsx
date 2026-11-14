"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FilePlus2, Palette, RotateCcw } from "lucide-react";
import {
  AppHeader,
  AppShell,
  CommandPalette,
  environmentTone,
  Logo,
  NotificationCenter,
  PermissionProvider,
  ResultDialogHost,
  SessionTimeoutDialog,
  SideNav,
  Toaster,
  UserMenu,
  type AppNotification,
  type CommandItem,
  type SideNavGroup,
} from "@credigit/web-ui";
import { allNavItems, navigation, navItemFor, navItemPermissions } from "@/lib/nav";
import { roles } from "@/lib/rbac/roles";
import { signOut as endSession } from "@/lib/auth/service";
import { usePermissionSet } from "@/lib/iam/permissions";
import { useRole, useSession } from "@/lib/auth/session";
import { useApplications, useDbActions, useObligors, useTenant } from "@/lib/data/hooks";
import { markNotificationsRead, useMyNotifications } from "@/lib/platform/notifications";
import { ago } from "@/lib/format";
import { appEnvironment } from "@/lib/platform/environment";
import { useRule, useRulesStore } from "@/lib/platform/rules";
import { roleIdleTimeoutMinutes } from "@/modules/admin/rule-keys";
import { TenantBrandSync } from "@/modules/settings/brand-store";
import { demoAccessEnabled } from "./auth-guard";

/** Normalise "/origination/" → "/origination". */
export function cleanPath(path: string) {
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

/**
 * Reset the shared spine and every module store (keys "credigit.ser.*"), keeping the session,
 * accounts and branding, then reload so module stores re-seed.
 */
export function resetAllDemoData(resetSpine: () => void) {
  resetSpine();
  const keep = new Set(["credigit.ser.session", "credigit.ser.accounts", "credigit.ser.demo-data"]);
  for (const key of Object.keys(localStorage)) if (key.startsWith("credigit.ser.") && !keep.has(key)) localStorage.removeItem(key);
  window.location.reload();
}


export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = cleanPath(usePathname());
  const router = useRouter();
  const role = useRole();
  const user = useSession((s) => s.user)!;
  const switchRole = useSession((s) => s.switchRole);
  const held = usePermissionSet();
  const can = useCallback((permission: string) => held.has(permission as never), [held]);
  const tenant = useTenant();
  const notifications = useMyNotifications();
  const obligors = useObligors();
  const applications = useApplications();
  const { resetDemo } = useDbActions();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Per-role idle timeout (PRD §4.2), falling back to the tenant default; re-read when rules change.
  const rulesVersion = useRulesStore((s) => s.values);
  const tenantIdle = useRule<number>("session.idleTimeoutMinutes");
  const IDLE_LIMIT_MS = (role ? roleIdleTimeoutMinutes(role.id) : tenantIdle) * 60_000;
  void rulesVersion;
  const WARNING_SECONDS = useRule<number>("session.warningSeconds");

  const groups: SideNavGroup[] = useMemo(
    () =>
      navigation
        .map((g) => ({
          label: g.label,
          // Invariant 12 / AUTH-FR-17: an item shows when any permission of its area is held (SideNav filters with `can`).
          items: g.items.map((i) => ({ href: i.href, label: i.label, permission: navItemPermissions(i), icon: <i.icon aria-hidden className="size-4" />, badge: i.phase && i.phase > 1 ? `P${i.phase}` : undefined })),
        }))
        .filter((g) => g.items.length > 0),
    [],
  );

  const current = navItemFor(pathname);

  const myNotifications: AppNotification[] = useMemo(
    () =>
      notifications
        .map((n) => ({ id: n.id, title: n.title, body: n.body, tone: n.tone, read: n.read, href: n.href, time: ago(n.createdAt) })),
    [notifications],
  );

  const commands: CommandItem[] = useMemo(() => {
    const pages: CommandItem[] = allNavItems
      .filter((i) => navItemPermissions(i).some((k) => held.has(k)))
      .flatMap((i) => [
        { id: `page:${i.href}`, label: i.label, group: "pages", href: i.href, icon: <i.icon aria-hidden className="size-4" />, keywords: [i.prd ?? ""] },
        ...(i.pages ?? []).filter((p) => p.href !== i.href && held.has(p.permission)).map((p) => ({ id: `page:${p.href}`, label: `${i.label} › ${p.label}`, group: "pages", href: p.href })),
      ]);
    const records: CommandItem[] = [
      ...obligors.map((o) => ({ id: `obl:${o.id}`, label: o.name, description: `${o.id} · obligor`, group: "records", href: `/credit-analysis/assessment?id=${o.id}`, keywords: [o.id, o.rcNumber ?? ""] })),
      ...applications.map((a) => ({ id: `app:${a.id}`, label: a.id, description: `Application · ${obligors.find((o) => o.id === a.obligorId)?.name ?? ""}`, group: "records", href: `/origination/application?id=${a.id}` })),
    ];
    const actions: CommandItem[] = [
      ...(held.has("origination.applications.create") ? [{ id: "act:new-app", label: "New credit application", group: "actions", href: "/origination/new", icon: <FilePlus2 aria-hidden className="size-4" /> }] : []),
      ...(held.has("settings.branding.view") ? [{ id: "act:branding", label: "Change colours, logo or font", group: "actions", href: "/settings/branding", icon: <Palette aria-hidden className="size-4" /> }] : []),
      ...(demoAccessEnabled && held.has("settings.demo-data.reset") ? [{ id: "act:reset", label: "Reset to initial data", group: "actions", icon: <RotateCcw aria-hidden className="size-4" /> }] : []),
    ];
    return [...actions, ...pages, ...records];
  }, [held, obligors, applications]);

  const onCommand = (item: CommandItem) => {
    if (item.id === "act:reset" && held.has("settings.demo-data.reset")) {
      if (window.confirm("Reset all data to its initial state?")) resetAllDemoData(resetDemo);
      return;
    }
    if (item.href) router.push(item.href);
  };

  // ---------- Idle session timeout (PRD §4.2: configurable per role) ----------
  const lastActivity = useRef(0);
  const [warnAt, setWarnAt] = useState<number | null>(null);
  useEffect(() => {
    if (lastActivity.current === 0) lastActivity.current = Date.now();
    const bump = () => {
      if (warnAt === null) lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = window.setInterval(() => {
      if (warnAt === null && Date.now() - lastActivity.current > IDLE_LIMIT_MS - WARNING_SECONDS * 1000) setWarnAt(Date.now());
    }, 5000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(timer);
    };
  }, [warnAt, IDLE_LIMIT_MS, WARNING_SECONDS]);

  const doSignOut = useCallback(
    async (reason: "user" | "idle-timeout" = "user") => {
      setWarnAt(null);
      await endSession(reason);
      router.replace("/login/");
    },
    [router],
  );

  return (
    <PermissionProvider has={can}>
      <AppShell
        sidebarLabel="Main navigation"
        sidebar={
          <SideNav
            groups={groups}
            activeHref={current?.href ?? pathname}
            can={can}
            header={
              <Link href="/dashboard" aria-label={`${tenant.shortName} — Smart Enterprise Risk 360° home`}>
                <Logo tone="reverse" size="small" />
              </Link>
            }
            environment={appEnvironment ? `${tenant.shortName} · ${appEnvironment}` : tenant.shortName}
            user={{ name: user.name, role: role?.name ?? "" }}
            linkComponent={Link}
          />
        }
        topbar={
          <AppHeader
            title={current?.label ?? "Smart Enterprise Risk 360°"}
            onSearchClick={() => setPaletteOpen(true)}
            searchLabel="Search obligors, applications, pages…"
            showShortcut
            environment={appEnvironment ? { label: appEnvironment, tone: environmentTone(appEnvironment) } : undefined}
            notifications={
              <NotificationCenter
                notifications={myNotifications}
                onMarkRead={(id) => markNotificationsRead([id])}
                onMarkAllRead={() => markNotificationsRead(myNotifications.map((n) => n.id))}
                onNotificationClick={(n) => {
                  markNotificationsRead([n.id]);
                  if (n.href) router.push(n.href);
                }}
                linkComponent={Link}
              />
            }
            userMenu={
              <UserMenu
                user={{ name: user.name, email: user.email, role: role?.name }}
                profileHref="/settings"
                settingsHref="/settings/branding"
                linkComponent={Link}
                roles={demoAccessEnabled ? roles.map((r) => ({ id: r.id, label: r.name })) : undefined}
                activeRoleId={role?.id}
                onSwitchRole={(r) => {
                  switchRole(r.id as typeof roles[number]["id"]);
                  router.push("/dashboard");
                }}
                labels={{ switchRole: "Switch demo role" }}
                onSignOut={() => void doSignOut()}
              />
            }
          />
        }
      >
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={commands}
        groups={[
          { id: "actions", label: "Actions" },
          { id: "pages", label: "Pages" },
          { id: "records", label: "Records" },
        ]}
        onSelect={onCommand}
        enableShortcut
        placeholder="Search obligors, applications, pages…"
        limit={12}
      />
      <Toaster />
      <ResultDialogHost />
      <TenantBrandSync />
      <SessionTimeoutDialog
        open={warnAt !== null}
        expiresAt={(warnAt ?? 0) + WARNING_SECONDS * 1000}
        onStaySignedIn={() => {
          lastActivity.current = Date.now();
          setWarnAt(null);
        }}
        onSignOut={() => void doSignOut()}
        onTimeout={() => void doSignOut("idle-timeout")}
      />
    </PermissionProvider>
  );
}
