"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BriefcaseBusiness, Building2, Gavel, ShieldCheck, Users } from "lucide-react";
import { Alert, Button, Divider, Field, Input, Logo, PasswordInput, RolePicker, SignInCard, Stack, Text, TextLink, type RoleOption } from "@credigit/web-ui";
import { demoAccessEnabled, demoSignIn } from "@/components/auth-guard";
import { DEMO_PASSWORD, signInWithPassword } from "@/lib/auth/accounts";
import { backendSsoEnabled, startMicrosoftSignIn } from "@/lib/auth/backend-sso";
import { msalEnabled, signInWithMicrosoft } from "@/lib/auth/msal";
import { useHydrated, useSession } from "@/lib/auth/session";
import { roleById, roleGroups, roles, type RoleGroup, type RoleId } from "@/lib/rbac/roles";
import { useDb } from "@/lib/data/store";
import { moneyShort } from "@/lib/format";
import { AuthShell } from "./auth-shell";

const groupIcon: Record<RoleGroup, typeof Users> = {
  "Front office": BriefcaseBusiness,
  "Credit approval": Gavel,
  "Risk function": ShieldCheck,
  "Operations & legal": Building2,
  Administration: Users,
};

/** Sign-in: Microsoft SSO (Entra ID), email + password (+ one-time code), and demo access by role. */
export function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const notice = params.get("notice");
  const hydrated = useHydrated();
  const user = useSession((s) => s.user);
  const signIn = useSession((s) => s.signIn);
  const [msLoading, setMsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [pickRoleFor, setPickRoleFor] = useState<{ name: string; email: string; id: string } | null>(null);
  const sampleEmail = useDb((s) => s.users.find((u) => u.roleId === "credit-analyst")?.email);

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
    if (backendSsoEnabled) {
      // Backend code flow (AUTH-FR-14): the browser leaves for Microsoft and comes back to /callback/.
      setMsLoading(true);
      try {
        await startMicrosoftSignIn(next);
      } catch (e) {
        setMsLoading(false);
        setError(`Microsoft sign-in couldn't start: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    if (!msalEnabled) {
      setError("Microsoft sign-in isn't configured for this environment yet. Use email and password or demo access.");
      return;
    }
    setMsLoading(true);
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
      setMsLoading(false);
    }
  };

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (!email.trim() || !password) {
      setPwError("Enter your work email and password.");
      return;
    }
    setPwLoading(true);
    const result = await signInWithPassword(email, password);
    setPwLoading(false);
    if (!result.ok) {
      setPwError(result.error);
      return;
    }
    router.push(`/verify/?challenge=${result.challengeId}&next=${encodeURIComponent(next)}`);
  };

  return (
    <AuthShell>
      <div className="w-full max-w-xl">
        <SignInCard
          logo={<Logo size="medium" />}
          productName="Smart Enterprise Risk 360°"
          tagline="Credit and enterprise risk management for banks and microfinance institutions."
          onMicrosoftSignIn={onMicrosoft}
          microsoftTheme="light"
          loading={msLoading}
          error={error}
          dividerLabel="or sign in with email"
          footer={
            <Stack gap="small">
              <Text variant="small" tone="muted">
                New to the platform?{" "}
                <TextLink href="/register/" as={Link}>
                  Request access
                </TextLink>
              </Text>
              <Text variant="caption" tone="subtle">
                Named, MFA-protected logins only. Every action is written to an immutable audit log.
              </Text>
            </Stack>
          }
        >
          {notice === "password-reset" ? (
            <Alert tone="success" title="Password updated">
              Sign in with your new password.
            </Alert>
          ) : null}
          {pickRoleFor ? (
            <Alert tone="info" title={`Welcome, ${pickRoleFor.name}`}>
              No role is assigned to your account yet. Choose the role to use for this session.
            </Alert>
          ) : (
            <form onSubmit={onPassword} noValidate>
              <Stack gap="medium">
                <Field label="Work email" required>
                  <Input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourbank.com" />
                </Field>
                <Field label="Password" required error={pwError ?? undefined}>
                  <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <div className="flex justify-end">
                  <TextLink href="/forgot-password/" as={Link}>
                    Forgot password?
                  </TextLink>
                </div>
                <Button type="submit" size="large" fullWidth loading={pwLoading}>
                  Continue
                </Button>
                <Text variant="caption" tone="subtle" align="center">
                  We&apos;ll ask for a one-time code next — multi-factor sign-in is required.
                </Text>
              </Stack>
            </form>
          )}
          {demoAccessEnabled && !backendSsoEnabled && !pickRoleFor ? (
            <Alert tone="info" title="Prototype sign-in">
              Any demo user signs in with password <span className="font-mono font-semibold">{DEMO_PASSWORD}</span>
              {sampleEmail ? (
                <>
                  , e.g. <span className="font-mono">{sampleEmail}</span>
                </>
              ) : null}
              . The one-time code is shown on screen because no email is sent in the demo.
            </Alert>
          ) : null}
          {demoAccessEnabled || pickRoleFor ? (
            <Stack gap="small" className="pt-2">
              {pickRoleFor ? null : <Divider label="or explore the prototype by role" />}
              <RolePicker
                roles={options}
                groupOrder={roleGroups}
                collapsible
                searchable
                layout="list"
                searchPlaceholder="Search roles, e.g. Credit Analyst"
                onSelect={(r) => {
                  if (pickRoleFor) signIn({ ...pickRoleFor, source: "microsoft" }, r.id as RoleId);
                  else demoSignIn(r.id as RoleId);
                }}
              />
            </Stack>
          ) : null}
        </SignInCard>
      </div>
    </AuthShell>
  );
}
