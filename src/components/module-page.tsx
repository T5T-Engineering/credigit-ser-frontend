"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, ModuleHeader, PermissionGate, Stack } from "@credigit/web-ui";
import { allNavItems, navItemPermissions, pagePermissionFor } from "@/lib/nav";
import type { ModuleKey } from "@/lib/rbac/roles";
import { useCan, usePermissionSet } from "@/lib/iam/permissions";
import { cleanPath } from "./app-frame";

export type ModulePageProps = {
  /** Module key from src/lib/nav.ts — supplies icon, title, PRD reference, phase and tabs. */
  module: ModuleKey;
  /** Overrides the module title (e.g. on record pages). */
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Hide the sub-page tabs (e.g. on a record page). */
  hideTabs?: boolean;
  children: ReactNode;
};

/** Standard page frame: module header (icon, title, PRD ref, phase), sub-page tabs, access check. */
export function ModulePage({ module, title, description, actions, hideTabs, children }: ModulePageProps) {
  const pathname = cleanPath(usePathname());
  const item = allNavItems.find((i) => i.module === module);
  // AUTH-FR-17: the page needs its sub-page view key (or, off the nav map, any permission of the module's area).
  const pageKey = item && item.module === module ? pagePermissionFor(pathname) : undefined;
  const allowed = useCan(pageKey ?? (item ? navItemPermissions(item) : []));
  const held = usePermissionSet();
  const Icon = item?.icon;
  const tabs = hideTabs ? undefined : item?.pages?.filter((p) => held.has(p.permission)).map((p) => ({ id: p.href, label: p.label, href: p.href, badge: p.phase && p.phase > (item.phase ?? 1) ? `P${p.phase}` : undefined }));
  const activeTab = tabs ? [...tabs].sort((a, b) => b.id.length - a.id.length).find((t) => pathname === t.id || pathname.startsWith(`${t.id}/`))?.id : undefined;

  return (
    <Stack gap="large">
      <ModuleHeader
        icon={Icon ? <Icon aria-hidden /> : undefined}
        title={title ?? item?.label}
        description={description}
        phase={item?.phase}
        badges={item?.prd ? <Badge variant="outline">PRD {item.prd}</Badge> : undefined}
        actions={actions}
        tabs={tabs}
        activeTab={activeTab}
        linkComponent={Link}
        titleAs="h1"
      />
      <PermissionGate allowed={allowed} description="Your permissions don't include this page. Ask your System Admin, or switch demo role from the user menu.">
        {children}
      </PermissionGate>
    </Stack>
  );
}
