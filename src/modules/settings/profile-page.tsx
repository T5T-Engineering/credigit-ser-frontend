"use client";

import { useRouter } from "next/navigation";
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck, Timer } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionList,
  Grid,
  Stack,
  StatCard,
  Text,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole, useSession } from "@/lib/auth/session";
import { msalEnabled } from "@/lib/auth/msal";
import { useTenant, useUsers } from "@/lib/data/hooks";
import { ago, dateTime, moneyShort } from "@/lib/format";
import { useRoleLimit, useRoleSecurity } from "@/modules/admin/store";
import { roleName } from "@/modules/admin/rule-keys";
import { useRule } from "@/lib/platform/rules";

/** Settings → Profile & security (PRD §4, §4.2, §10.1). */
export function ProfilePage() {
  const user = useSession((s) => s.user)!;
  const signedInAt = useSession((s) => s.signedInAt);
  const signOut = useSession((s) => s.signOut);
  const role = useRole()!;
  const tenant = useTenant();
  const users = useUsers();
  const record = users.find((u) => u.id === user.id);
  const security = useRoleSecurity(role.id);
  const limit = useRoleLimit(role.id);
  const warningSeconds = useRule<number>("session.warningSeconds");
  const shellTimeout = useRule<number>("session.idleTimeoutMinutes");
  const stepUp = useRule<number>("approvals.stepUpThresholdNgn");
  const router = useRouter();
  const sso = user.source === "microsoft";
  const device = typeof navigator !== "undefined" ? summarise(navigator.userAgent) : "This browser";

  return (
    <ModulePage module="settings" description="Your account, sign-in method and session. Access is tied to you as a named individual (no shared logins).">
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Sign-in method" value={sso ? "Microsoft SSO" : "Sign-in by role"} hint={sso ? "Entra ID work account" : "Role picker (development)"} icon={<KeyRound aria-hidden className="size-5" />} tone="accent" />
          <StatCard label="MFA" value={sso ? "Enforced" : record?.mfa ? "Enrolled" : "Not enrolled"} hint={sso ? "By your Microsoft tenant policy" : "Simulated when signed in by role"} icon={<ShieldCheck aria-hidden className="size-5" />} tone="success" />
          <StatCard label="Idle timeout" value={`${security.sessionTimeoutMin} min`} hint={`Rule session.idleTimeoutMinutes.${role.id}`} icon={<Timer aria-hidden className="size-5" />} tone="info" />
          <StatCard label="Device binding" value={security.deviceBinding ? "On" : "Off"} hint={security.ipAllowList ? `IP allow-list: ${security.ipAllowList}` : "Any network"} icon={<MonitorSmartphone aria-hidden className="size-5" />} tone={security.deviceBinding ? "warning" : "neutral"} />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <Avatar name={user.name} size="large" />
                <div className="min-w-0 text-start">
                  <CardTitle>{user.name}</CardTitle>
                  <Text tone="muted" className="truncate">
                    {user.email}
                  </Text>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <DescriptionList
                columns={1}
                items={[
                  { label: "Role", value: roleName(role.id), hint: role.description },
                  { label: "Authority", value: role.authority },
                  { label: "Sign-on limit", value: limit === null ? "None" : Number.isFinite(limit) ? moneyShort(limit) : "Apex", mono: true },
                  { label: "Branch", value: record?.branch },
                  { label: "Institution", value: `${tenant.name} · ${tenant.type}` },
                  { label: "User ID", value: user.id, mono: true, copyValue: user.id },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sign-in & session</CardTitle>
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <DescriptionList
                  columns={1}
                  items={[
                    {
                      label: "Method",
                      value: (
                        <span className="flex flex-wrap items-center gap-2">
                          {sso ? "Microsoft Entra ID single sign-on" : "Sign-in by role (development only)"}
                          <Badge tone={sso ? "success" : "warning"}>{sso ? "SSO" : "By role"}</Badge>
                        </span>
                      ),
                      hint: sso ? undefined : msalEnabled ? "Microsoft SSO is configured — sign out and choose “Sign in with Microsoft”." : "Microsoft SSO isn't configured on this deployment (see README).",
                    },
                    { label: "Signed in", value: signedInAt ? `${dateTime(signedInAt)} (${ago(signedInAt)})` : "—" },
                    { label: "This device", value: device },
                    { label: "Session rules", value: `Signs out after ${security.sessionTimeoutMin} minutes idle, with a ${warningSeconds}-second warning. Closing the tab ends the session.` },
                    { label: "Step-up authentication", value: `Required to approve amounts above ${moneyShort(stepUp)}.` },
                  ]}
                />
                <Text variant="caption" tone="subtle">
                  The prototype&apos;s idle timer currently applies the platform default ({shellTimeout} minutes); per-role values above are the configured policy the backend will enforce.
                </Text>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    iconBefore={<LogOut aria-hidden className="size-4" />}
                    onClick={async () => {
                      await signOut();
                      router.replace("/login/");
                    }}
                  >
                    Sign out
                  </Button>
                </div>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

      </Stack>

    </ModulePage>
  );
}

function summarise(ua: string) {
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : "Other OS";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${browser}`;
}
