"use client";

import { useEffect, useState } from "react";
import { Mail, Smartphone } from "lucide-react";
import { Alert, Badge, Button, Card, CardContent, OtpVerification, QrCode, Stack, Text } from "@credigit/web-ui";
import { OutcomePopup, outcomeCopy } from "@/lib/ui/outcome-popup";
import { ModulePage } from "@/components/module-page";
import { backendSsoEnabled } from "@/lib/auth/backend-sso";
import {
  confirmAuthenticator,
  groupedKey,
  loadMyMfa,
  mfaMethodLabel,
  startAuthenticatorSetup,
  switchToEmailCodes,
  type AuthenticatorSetup,
  type MfaStatus,
} from "@/lib/auth/backend-mfa";
import { useSession } from "@/lib/auth/session";
import { dateTime } from "@/lib/format";

const managePermission = "identity.me.mfa";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Settings → Security (backend ADR-0017): the person chooses the second step of their e-mail + password sign-in — an authenticator app
 * (set up with a QR code and confirmed with a first code) or a code sent by e-mail. Switching back to e-mail needs a code from the app.
 */
export function SecurityPage() {
  const user = useSession((s) => s.user);
  const canManage = useSession((s) => s.access?.permissions.includes(managePermission) ?? false);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const microsoft = user?.source === "microsoft";

  useEffect(() => {
    if (!backendSsoEnabled || !canManage || microsoft) return;
    let cancelled = false;
    loadMyMfa()
      .then((s) => !cancelled && setStatus(s))
      .catch((e: unknown) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, [canManage, microsoft, version]);

  const begin = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setSetup(await startAuthenticatorSetup());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = (text: string) => {
    setSetup(null);
    setSwitching(false);
    setNotice(text);
    setVersion((v) => v + 1);
  };

  const verifyWith = (action: (code: string) => Promise<unknown>, done: string) => async (code: string) => {
    try {
      await action(code);
      finish(done);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  };

  return (
    <ModulePage module="settings" title="Security" description="Choose how you confirm it's you after your password: an authenticator app on your phone, or a code sent by e-mail.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,640px)_1fr]">
        <Stack gap="large">
          {!backendSsoEnabled ? <Alert tone="info">Sign-in steps are managed by the backend — configure NEXT_PUBLIC_API_BASE_URL.</Alert> : null}
          {microsoft ? (
            <Alert tone="info" title="Microsoft handles your sign-in steps">
              You sign in with Microsoft, so your organisation&apos;s Microsoft (Entra ID) multi-factor settings apply. Change them in your Microsoft account.
            </Alert>
          ) : null}
          {backendSsoEnabled && !microsoft && !canManage ? <Alert tone="warning">You don&apos;t have permission to change your sign-in steps.</Alert> : null}
          {error && !setup && !switching ? <Alert tone="danger">{error}</Alert> : null}
          <OutcomePopup value={notice} map={outcomeCopy.text("Saved")} />

          {status && !microsoft ? (
            <Card padding="large" radius="large">
              <CardContent>
                <Stack gap="medium">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                      {status.method === "authenticator" ? <Smartphone aria-hidden className="size-6" /> : <Mail aria-hidden className="size-6" />}
                      <span className="flex flex-col">
                        <Text variant="small" tone="muted">
                          Your second step now
                        </Text>
                        <span className="font-semibold">{mfaMethodLabel(status.method)}</span>
                      </span>
                    </span>
                    <Badge tone="success">On</Badge>
                  </div>
                  {status.method === "authenticator" && status.authenticatorEnrolledAt ? (
                    <Text variant="small" tone="muted">
                      Set up {dateTime(status.authenticatorEnrolledAt)}. Lost your phone? Ask your System Admin to reset your sign-in steps.
                    </Text>
                  ) : null}
                  {status.method === "email" && !setup ? (
                    <Stack gap="small">
                      <Text variant="small">An authenticator app (for example Microsoft Authenticator) works without e-mail and is harder to intercept.</Text>
                      <div>
                        <Button iconBefore={<Smartphone aria-hidden className="size-4" />} loading={busy} disabled={busy} onClick={() => void begin()}>
                          Set up authenticator app
                        </Button>
                      </div>
                    </Stack>
                  ) : null}
                  {status.method === "authenticator" && !switching ? (
                    <div>
                      <Button variant="tertiary" onClick={() => setSwitching(true)}>
                        Use e-mailed codes instead
                      </Button>
                    </div>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          {setup ? (
            <Card padding="large" radius="large">
              <CardContent>
                <Stack gap="medium">
                  <Text variant="small" className="font-semibold">
                    1. Install an authenticator app on your phone, such as Microsoft Authenticator.
                  </Text>
                  <Text variant="small" className="font-semibold">
                    2. In the app, add an account and scan this code.
                  </Text>
                  <QrCode value={setup.otpAuthUri} label={`QR code to add ${setup.accountName} to your authenticator app`} />
                  <Text variant="small" tone="muted">
                    Can&apos;t scan? Choose &quot;enter a setup key&quot; in the app and type <span className="font-mono font-semibold">{groupedKey(setup.secret)}</span> (time-based,{" "}
                    {setup.digits} digits, account {setup.accountName}).
                  </Text>
                  <Text variant="small" className="font-semibold">
                    3. Enter the {setup.digits}-digit code the app shows to finish. Until then you keep getting codes by e-mail.
                  </Text>
                  <OtpVerification
                    length={setup.digits}
                    submitLabel="Turn on authenticator app"
                    errorMessage={error ?? undefined}
                    onVerify={verifyWith(confirmAuthenticator, "Your authenticator app is on. From your next sign-in, enter the code from the app.")}
                  />
                  <Text variant="caption" tone="subtle">
                    This set-up expires at {new Date(setup.expiresAt).toLocaleTimeString()}.
                  </Text>
                  <div>
                    <Button variant="tertiary" onClick={() => setSetup(null)}>
                      Cancel
                    </Button>
                  </div>
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          {switching ? (
            <Card padding="large" radius="large">
              <CardContent>
                <Stack gap="medium">
                  <Text variant="small">To switch back to e-mailed codes, enter the current code from your authenticator app.</Text>
                  <OtpVerification
                    submitLabel="Use e-mailed codes"
                    errorMessage={error ?? undefined}
                    onVerify={verifyWith(switchToEmailCodes, "You'll now get a code by e-mail at every sign-in. You can remove this account from your authenticator app.")}
                  />
                  <div>
                    <Button variant="tertiary" onClick={() => setSwitching(false)}>
                      Cancel
                    </Button>
                  </div>
                </Stack>
              </CardContent>
            </Card>
          ) : null}
        </Stack>
      </div>
    </ModulePage>
  );
}
