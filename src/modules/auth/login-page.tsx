"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BriefcaseBusiness, Building2, Gavel, ShieldCheck, Users } from "lucide-react";
import { Alert, Button, Divider, Field, Input, Logo, PasswordInput, RolePicker, SignInCard, Spinner, Stack, Text, TextLink, type RoleOption } from "@credigit/web-ui";
import { demoAccessEnabled } from "@/components/auth-guard";
import { demoPassword } from "@/lib/auth/accounts";
import { useAuthConfig } from "@/lib/auth/auth-config";
import { msalConfigured } from "@/lib/auth/msal";
import { completeEntraSignIn, signInDemo, signInMicrosoftWithRole, startSignIn } from "@/lib/auth/service";
import { useHydrated, useSession } from "@/lib/auth/session";
import { apiEnabled } from "@/lib/api/config";
import { roleGroups, roles, type RoleGroup, type RoleId } from "@/lib/rbac/roles";
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

/**
 * Sign-in (AUTH-FR-03): the active mode from `/auth/config` decides the screen — Local (e-mail + password, then a
 * one-time code) **or** MicrosoftEntra (one Microsoft button). Demo access by role is a prototype extra.
 */
export function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const notice = params.get("notice");
  const hydrated = useHydrated();
  const user = useSession((s) => s.user);
  const { config, error: configError, loading: configLoading } = useAuthConfig();
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
    if (!msalConfigured()) {
      setError("Microsoft sign-in isn't configured for this environment yet. Ask your administrator.");
      return;
    }
    setMsLoading(true);
    const result = await completeEntraSignIn();
    setMsLoading(false);
    if (!result.ok) setError(result.error || null);
    else if (result.pickRole) setPickRoleFor(result.pickRole);
  };

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (!email.trim() || !password) {
      setPwError("Enter your work email and password.");
      return;
    }
    setPwLoading(true);
    const result = await startSignIn(email, password);
    setPwLoading(false);
    if (!result.ok) {
      setPwError(result.error);
      return;
    }
    router.push(`/verify/?challenge=${encodeURIComponent(result.challengeId)}&next=${encodeURIComponent(next)}`);
  };

  const local = config?.mode === "Local" ? config.local : null;
  const entra = config?.mode === "MicrosoftEntra";
  const showDemo = demoAccessEnabled && !apiEnabled;

  return (
    <AuthShell>
      <div className="w-full max-w-xl">
        <SignInCard
          logo={<Logo size="medium" />}
          productName="Smart Enterprise Risk 360°"
          tagline="Credit and enterprise risk management for banks and microfinance institutions."
          microsoft={entra}
          onMicrosoftSignIn={entra ? onMicrosoft : undefined}
          microsoftTheme="light"
          loading={msLoading}
          error={error ?? configError}
          dividerLabel={entra && showDemo ? "or" : null}
          footer={
            <Stack gap="small">
              {local?.registrationEnabled ? (
                <Text variant="small" tone="muted">
                  New to the platform?{" "}
                  <TextLink href="/register/" as={Link}>
                    Request access
                  </TextLink>
                </Text>
              ) : null}
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
          {notice === "session-ended" ? (
            <Alert tone="warning" title="Signed out">
              Your session ended. Sign in again.
            </Alert>
          ) : null}
          {configLoading ? <Spinner label="Loading sign-in options" /> : null}
          {pickRoleFor ? (
            <Alert tone="info" title={`Welcome, ${pickRoleFor.name}`}>
              No role is assigned to your account yet. Choose the role to use for this session.
            </Alert>
          ) : local ? (
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
                    Set or reset your password
                  </TextLink>
                </div>
                <Button type="submit" size="large" fullWidth loading={pwLoading}>
                  Continue
                </Button>
                <Text variant="caption" tone="subtle" align="center">
                  We&apos;ll e-mail you a one-time code next — multi-factor sign-in is required.
                </Text>
              </Stack>
            </form>
          ) : null}
          {showDemo && local && !pickRoleFor ? (
            <Alert tone="info" title="Prototype sign-in">
              {demoPassword ? (
                <>
                  Any demo user signs in with the demo password configured for this deployment
                  {sampleEmail ? (
                    <>
                      , e.g. <span className="font-mono">{sampleEmail}</span>
                    </>
                  ) : null}
                  .
                </>
              ) : (
                <>
                  Demo users have no password until they choose one: use &ldquo;Set or reset your password&rdquo;
                  {sampleEmail ? (
                    <>
                      {" "}
                      with a demo e-mail such as <span className="font-mono">{sampleEmail}</span>
                    </>
                  ) : null}
                  .
                </>
              )}{" "}
              One-time codes are shown on screen because no e-mail is sent in the demo.
            </Alert>
          ) : null}
          {showDemo || pickRoleFor ? (
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
                  if (pickRoleFor) signInMicrosoftWithRole(pickRoleFor, r.id as RoleId);
                  else signInDemo(r.id as RoleId);
                }}
              />
            </Stack>
          ) : null}
        </SignInCard>
      </div>
    </AuthShell>
  );
}
