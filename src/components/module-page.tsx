"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModuleHeader, PermissionGate, Stack, ValidationScope, useValidation } from "@credigit/web-ui";
import { allNavItems } from "@/lib/nav";
import type { ModuleKey } from "@/lib/rbac/roles";
import { useCan } from "@/lib/auth/session";
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
  const allowed = useCan(module);
  const Icon = item?.icon;
  const validation = useValidation();
  const tabs = hideTabs ? undefined : item?.pages?.map((p) => ({ id: p.href, label: p.label, href: p.href, badge: p.phase && p.phase > (item.phase ?? 1) ? `P${p.phase}` : undefined }));
  const activeTab = tabs ? [...tabs].sort((a, b) => b.id.length - a.id.length).find((t) => pathname === t.id || pathname.startsWith(`${t.id}/`))?.id : undefined;

  return (
    <Stack gap="large">
      <ModuleHeader
        icon={Icon ? <Icon aria-hidden /> : undefined}
        title={title ?? item?.label}
        description={description}
        phase={item?.phase}
        badges={undefined}
        actions={actions}
        tabs={tabs}
        activeTab={activeTab}
        linkComponent={Link}
        titleAs="h1"
      />
      <PermissionGate allowed={allowed} description="Your role doesn't include this module. Switch role from the user menu to see it.">
        {/* Page-level scope: a SubmitButton on the page checks its required fields; dialogs and Forms carry their own. */}
        <ValidationScope value={validation}>{children}</ValidationScope>
      </PermissionGate>
    </Stack>
  );
}
