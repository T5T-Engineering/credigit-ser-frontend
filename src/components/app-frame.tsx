"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FilePlus2, Palette, RotateCcw } from "lucide-react";
import {
  AppHeader,
  AppShell,
  CommandPalette,
  Logo,
  NotificationCenter,
  SessionTimeoutDialog,
  SideNav,
  UserMenu,
  type AppNotification,
  type CommandItem,
  type SideNavGroup,
} from "@credigit/web-ui";
import { allNavItems, navigation, navItemFor } from "@/lib/nav";
import { roles, canAccess } from "@/lib/rbac/roles";
import { useRole, useSession } from "@/lib/auth/session";
import { useApplications, useDbActions, useNotifications, useObligors, useTenant } from "@/lib/data/hooks";
import { ago } from "@/lib/format";
import { demoAccessEnabled } from "./auth-guard";

/** Normalise "/origination/" → "/origination". */
export function cleanPath(path: string) {
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const WARNING_SECONDS = 60;

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = cleanPath(usePathname());
  const router = useRouter();
  const role = useRole();
  const user = useSession((s) => s.user)!;
  const switchRole = useSession((s) => s.switchRole);
  const signOut = useSession((s) => s.signOut);
  const tenant = useTenant();
  const notifications = useNotifications();
  const obligors = useObligors();
  const applications = useApplications();
  const { update, resetDemo } = useDbActions();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const groups: SideNavGroup[] = useMemo(
    () =>
      navigation
        .map((g) => ({
          label: g.label,
          items: g.items
            .filter((i) => canAccess(role, i.module))
            .map((i) => ({ href: i.href, label: i.label, icon: <i.icon aria-hidden className="size-4" />, badge: i.phase && i.phase > 1 ? `P${i.phase}` : undefined })),
        }))
        .filter((g) => g.items.length > 0),
    [role],
  );

  const current = navItemFor(pathname);

  const myNotifications: AppNotification[] = useMemo(
    () =>
      notifications
        .filter((n) => n.roleIds.length === 0 || (role && n.roleIds.includes(role.id)))
        .map((n) => ({ id: n.id, title: n.title, body: n.body, tone: n.tone, read: n.read, href: n.href, time: ago(n.createdAt) })),
    [notifications, role],
  );

  const commands: CommandItem[] = useMemo(() => {
    const pages: CommandItem[] = allNavItems
      .filter((i) => canAccess(role, i.module))
      .flatMap((i) => [
        { id: `page:${i.href}`, label: i.label, group: "pages", href: i.href, icon: <i.icon aria-hidden className="size-4" />, keywords: [i.prd ?? ""] },
        ...(i.pages ?? []).filter((p) => p.href !== i.href).map((p) => ({ id: `page:${p.href}`, label: `${i.label} › ${p.label}`, group: "pages", href: p.href })),
      ]);
    const records: CommandItem[] = [
      ...obligors.map((o) => ({ id: `obl:${o.id}`, label: o.name, description: `${o.id} · obligor`, group: "records", href: `/credit-analysis/assessment?id=${o.id}`, keywords: [o.id, o.rcNumber ?? ""] })),
      ...applications.map((a) => ({ id: `app:${a.id}`, label: a.id, description: `Application · ${obligors.find((o) => o.id === a.obligorId)?.name ?? ""}`, group: "records", href: `/origination/application?id=${a.id}` })),
    ];
    const actions: CommandItem[] = [
      ...(canAccess(role, "origination", "edit") ? [{ id: "act:new-app", label: "New credit application", group: "actions", href: "/origination/new", icon: <FilePlus2 aria-hidden className="size-4" /> }] : []),
      { id: "act:branding", label: "Change colours, logo or font", group: "actions", href: "/settings/branding", icon: <Palette aria-hidden className="size-4" /> },
      ...(demoAccessEnabled ? [{ id: "act:reset", label: "Reset demo data", group: "actions", icon: <RotateCcw aria-hidden className="size-4" /> }] : []),
    ];
    return [...actions, ...pages, ...records];
  }, [role, obligors, applications]);

  const onCommand = (item: CommandItem) => {
    if (item.id === "act:reset") {
      if (window.confirm("Reset all demo data to its original state?")) resetDemo();
      return;
    }
    if (item.href) router.push(item.href);
  };

  // ---------- Idle session timeout (PRD §4.2: configurable per role) ----------
  const lastActivity = useRef(Date.now());
  const [warnAt, setWarnAt] = useState<number | null>(null);
  useEffect(() => {
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
  }, [warnAt]);

  const doSignOut = useCallback(async () => {
    setWarnAt(null);
    await signOut();
    router.replace("/login/");
  }, [signOut, router]);

  return (
    <>
      <AppShell
        sidebarLabel="Main navigation"
        sidebar={
          <SideNav
            groups={groups}
            activeHref={current?.href ?? pathname}
            header={
              <Link href="/dashboard" aria-label={`${tenant.shortName} — Smart Enterprise Risk 360° home`}>
                <Logo tone="reverse" size="small" />
              </Link>
            }
            environment={`${tenant.shortName} · ${tenant.environment}`}
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
            environment={{ label: tenant.environment === "Demo" ? "Demo data" : tenant.environment, tone: tenant.environment === "Production" ? "success" : "warning" }}
            notifications={
              <NotificationCenter
                notifications={myNotifications}
                onMarkRead={(id) => update("notifications", id, { read: true })}
                onMarkAllRead={() => myNotifications.forEach((n) => update("notifications", n.id, { read: true }))}
                onNotificationClick={(n) => {
                  update("notifications", n.id, { read: true });
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
                onSignOut={doSignOut}
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
      <SessionTimeoutDialog
        open={warnAt !== null}
        expiresAt={(warnAt ?? Date.now()) + WARNING_SECONDS * 1000}
        onStaySignedIn={() => {
          lastActivity.current = Date.now();
          setWarnAt(null);
        }}
        onSignOut={doSignOut}
        onTimeout={doSignOut}
      />
    </>
  );
}
