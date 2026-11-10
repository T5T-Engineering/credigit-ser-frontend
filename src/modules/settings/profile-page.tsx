"use client";

import { resetAllDemoData } from "@/components/app-frame";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, MonitorSmartphone, RotateCcw, ShieldCheck, Timer } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionList,
  Grid,
  Modal,
  Stack,
  StatCard,
  Text,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { demoAccessEnabled } from "@/components/auth-guard";
import { useRole, useSession } from "@/lib/auth/session";
import { msalEnabled } from "@/lib/auth/msal";
import { useDbActions, useTenant, useUsers } from "@/lib/data/hooks";
import { ago, dateTime, moneyShort } from "@/lib/format";
import { useRoleLimit, useRoleSecurity } from "@/modules/admin/store";
import { roleName } from "@/modules/admin/rule-keys";
import { publish } from "@/lib/platform/events";
import { useRule } from "@/lib/platform/rules";
import { useAuditLog } from "@/modules/workspace/use-audit-log";

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
  const { resetDemo } = useDbActions();
  const warningSeconds = useRule<number>("session.warningSeconds");
  const shellTimeout = useRule<number>("session.idleTimeoutMinutes");
  const stepUp = useRule<number>("approvals.stepUpThresholdNgn");
  const log = useAuditLog();
  const router = useRouter();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const sso = user.source === "microsoft";
  const device = typeof navigator !== "undefined" ? summarise(navigator.userAgent) : "This browser";

  return (
    <ModulePage module="settings" description="Your account, sign-in method and session. Access is tied to you as a named individual (no shared logins).">
      <Stack gap="large">
        {resetDone ? <Alert tone="success">Demo data and configuration were reset to their original state.</Alert> : null}
        <Grid columns={{ base: 1, sm: 2, xl: 4 }} gap="medium">
          <StatCard label="Sign-in method" value={sso ? "Microsoft SSO" : "Demo access"} hint={sso ? "Entra ID work account" : "Prototype role picker"} icon={<KeyRound aria-hidden className="size-5" />} tone="accent" />
          <StatCard label="MFA" value={sso ? "Enforced" : record?.mfa ? "Enrolled" : "Not enrolled"} hint={sso ? "By your Microsoft tenant policy" : "Simulated in demo access"} icon={<ShieldCheck aria-hidden className="size-5" />} tone="success" />
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
                          {sso ? "Microsoft Entra ID single sign-on" : "Demo access (prototype only)"}
                          <Badge tone={sso ? "success" : "warning"}>{sso ? "SSO" : "Demo"}</Badge>
                        </span>
                      ),
                      hint: sso ? undefined : msalEnabled ? "Microsoft SSO is configured — sign out and choose “Sign in with Microsoft”." : "Microsoft SSO isn't configured on this deployment (see README).",
                    },
                    { label: "Signed in", value: signedInAt ? `${dateTime(signedInAt)} (${ago(signedInAt)})` : "—" },
                    { label: "This device", value: device },
                    { label: "Session rules", value: `Signs out after ${security.sessionTimeoutMin} minutes idle, with a ${warningSeconds}-second warning. Closing the tab ends the session.` },
                    { label: "Step-up authentication", value: `Required to approve amounts above ${moneyShort(stepUp)} (PRD §4.2).` },
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

        {demoAccessEnabled ? (
          <Card variant="filled">
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <Text variant="subtitle" as="h2">
                    Demo data
                  </Text>
                  <Text tone="muted">
                    Restore the demo tenant&apos;s applications, facilities, tasks, users, audit log and configuration to their original state. Branding is kept — reset it in Branding.
                  </Text>
                </div>
                <Button variant="danger" iconBefore={<RotateCcw aria-hidden className="size-4" />} onClick={() => setConfirmReset(true)}>
                  Reset demo data
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </Stack>

      <Modal
        open={confirmReset}
        onOpenChange={setConfirmReset}
        size="small"
        title="Reset demo data?"
        description="All changes made in this browser — applications, decisions, tasks, users, business-rule values, Operations requests, notifications and events — will be discarded."
        footer={
          <>
            <Button variant="tertiary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                // Clears the spine and every credigit.ser.* store (Operations, rules, events, notifications, admin, workspace) and reloads.
                resetAllDemoData(resetDemo);
                log({ action: "Reset demo data", entityType: "Tenant", entityId: tenant.id });
                publish("settings.demo-data.reset", { module: "settings", subject: { type: "Tenant", id: tenant.id, title: tenant.name } });
                setConfirmReset(false);
                setResetDone(true);
              }}
            >
              Reset
            </Button>
          </>
        }
      >
        <Text tone="muted">You stay signed in. This can&apos;t be undone.</Text>
      </Modal>
    </ModulePage>
  );
}

function summarise(ua: string) {
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : "Other OS";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${browser}`;
}
