"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BriefcaseBusiness, Building2, Gavel, ShieldCheck, Users } from "lucide-react";
import { Alert, Logo, RolePicker, SignInCard, Text, type RoleOption } from "@credigit/web-ui";
import { demoAccessEnabled, demoSignIn } from "@/components/auth-guard";
import { msalEnabled, signInWithMicrosoft } from "@/lib/auth/msal";
import { useHydrated, useSession } from "@/lib/auth/session";
import { roleById, roleGroups, roles, type RoleGroup, type RoleId } from "@/lib/rbac/roles";
import { useDb } from "@/lib/data/store";
import { moneyShort } from "@/lib/format";

const groupIcon: Record<RoleGroup, typeof Users> = {
  "Front office": BriefcaseBusiness,
  "Credit approval": Gavel,
  "Risk function": ShieldCheck,
  "Operations & legal": Building2,
  Administration: Users,
};

/** Sign-in: Microsoft SSO (Entra ID) and, for prototypes, demo access by role. */
export function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const hydrated = useHydrated();
  const user = useSession((s) => s.user);
  const signIn = useSession((s) => s.signIn);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickRoleFor, setPickRoleFor] = useState<{ name: string; email: string; id: string } | null>(null);

  useEffect(() => {
    if (hydrated && user) router.replace(next);
  }, [hydrated, user, next, router]);

  const options: RoleOption[] = useMemo(
    () =>
      roles.map((r) => {
        const Icon = groupIcon[r.group];
        return {
          id: r.id,
          title: r.name,
          description: r.description,
          group: r.group,
          icon: <Icon aria-hidden className="size-5" />,
          badge: r.limitNgn ? (Number.isFinite(r.limitNgn) ? `Limit ${moneyShort(r.limitNgn)}` : "Apex limit") : undefined,
        };
      }),
    [],
  );

  const onMicrosoft = async () => {
    setError(null);
    if (!msalEnabled) {
      setError("Microsoft sign-in isn't configured for this environment yet. Use demo access below.");
      return;
    }
    setLoading(true);
    try {
      const identity = await signInWithMicrosoft();
      const mapped = identity.appRoles.find((r): r is RoleId => r in roleById);
      const existing = useDb.getState().users.find((u) => u.email.toLowerCase() === identity.email.toLowerCase());
      const sessionUser = { id: existing?.id ?? identity.oid, name: identity.name, email: identity.email, source: "microsoft" as const };
      if (mapped ?? existing?.roleId) signIn(sessionUser, (mapped ?? existing!.roleId) as RoleId);
      else setPickRoleFor(sessionUser);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/user_cancelled|popup_window_error/i.test(message)) setError(`Microsoft sign-in failed: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-surface-sunken px-4 py-10">
      <div className="w-full max-w-3xl">
        <SignInCard
          logo={<Logo size="medium" />}
          productName="Smart Enterprise Risk 360°"
          tagline="Credit and enterprise risk management for banks and microfinance institutions."
          onMicrosoftSignIn={onMicrosoft}
          loading={loading}
          error={error}
          dividerLabel={demoAccessEnabled ? "or explore the prototype" : undefined}
          footer={
            <Text variant="small" tone="muted">
              Named, MFA-protected logins only. Every action is written to an immutable audit log.
            </Text>
          }
        >
          {pickRoleFor ? (
            <Alert tone="info" title={`Welcome, ${pickRoleFor.name}`}>
              No role is assigned to your account yet. Choose the role to use for this session.
            </Alert>
          ) : null}
          {demoAccessEnabled || pickRoleFor ? (
            <RolePicker
              roles={options}
              groupOrder={roleGroups}
              searchable
              searchPlaceholder="Search roles, e.g. Credit Analyst"
              onSelect={(r) => {
                if (pickRoleFor) signIn({ ...pickRoleFor, source: "microsoft" }, r.id as RoleId);
                else demoSignIn(r.id as RoleId);
              }}
            />
          ) : null}
        </SignInCard>
      </div>
    </main>
  );
}
