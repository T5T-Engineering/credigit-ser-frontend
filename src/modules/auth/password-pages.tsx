"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, LockKeyhole, MailQuestion } from "lucide-react";
import { Alert, AuthCard, Button, Card, CardContent, Field, Input, Logo, PasswordInput, PasswordStrength, Stack, Text, evaluatePassword, type PasswordRule } from "@credigit/web-ui";
import { useCan } from "@/lib/iam/permissions";
import { usePasswordRules } from "@/lib/auth/auth-config";
import { changeMyPassword, forgotPassword, resetPassword } from "@/lib/auth/service";
import { useSession } from "@/lib/auth/session";
import { getRule } from "@/lib/platform/rules";
import { ModulePage } from "@/components/module-page";
import { date } from "@/lib/format";
import { useAccounts } from "@/lib/auth/accounts";
import { AuthShell } from "./auth-shell";

/** Forgot password: request a one-time code by email. */
export function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter the work email you sign in with.");
      return;
    }
    setLoading(true);
    const { challengeId, error: failure } = await forgotPassword(email);
    setLoading(false);
    if (failure) setError(failure);
    else if (challengeId) router.push(`/verify/?challenge=${encodeURIComponent(challengeId)}`);
    else setSent(true); // Same message either way, so we don't reveal which emails have accounts.
  };

  return (
    <AuthShell>
      <AuthCard
        logo={<Logo size="small" />}
        icon={<MailQuestion />}
        title="Set or reset your password"
        description="First time here, or forgot your password? Enter your work email and we'll send you a one-time code."
        back={{ label: "Back to sign in", href: "/login/" }}
        linkComponent={Link}
      >
        {sent ? (
          <Alert tone="info" title="Check your email">
            If an account exists for that address, we&apos;ve sent a code to reset your password.
          </Alert>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <Stack gap="medium">
              <Field label="Work email" required error={error ?? undefined}>
                <Input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="name@yourbank.com" />
              </Field>
              <Button type="submit" size="large" fullWidth loading={loading}>
                Send code
              </Button>
              <Text variant="caption" tone="subtle" align="center">
                Signed in with Microsoft? Reset your password with your organisation instead.
              </Text>
            </Stack>
          </form>
        )}
      </AuthCard>
    </AuthShell>
  );
}

function NewPasswordFields({ value, confirm, onValue, onConfirm, errors }: { value: string; confirm: string; onValue: (v: string) => void; onConfirm: (v: string) => void; errors: { password?: string; confirm?: string } }) {
  return (
    <>
      <Field label="New password" required error={errors.password}>
        <PasswordInput autoComplete="new-password" value={value} onChange={(e) => onValue(e.target.value)} />
      </Field>
      <PasswordStrength value={value} rules={usePasswordRules()} />
      <Field label="Confirm new password" required error={errors.confirm}>
        <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </Field>
    </>
  );
}

function validateNew(password: string, confirm: string, policy: PasswordRule[]) {
  const errors: { password?: string; confirm?: string } = {};
  if (!evaluatePassword(password, policy).valid) errors.password = "Your password doesn't meet all the requirements.";
  if (confirm !== password) errors.confirm = "Passwords don't match.";
  return errors;
}

/** Reset password after the one-time code has been verified (token = verified challenge). */
export function ResetPasswordPage() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const policy = usePasswordRules();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next = validateNew(password, confirm, policy);
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    const result = await resetPassword(token, password);
    setLoading(false);
    if (!result.ok) setErrors({ form: result.error });
    else router.replace("/login/?notice=password-reset");
  };

  return (
    <AuthShell>
      <AuthCard logo={<Logo size="small" />} icon={<KeyRound />} title="Set a new password" description="Choose a strong password you don't use anywhere else." back={{ label: "Back to sign in", href: "/login/" }} linkComponent={Link}>
        <form onSubmit={onSubmit} noValidate>
          <Stack gap="medium">
            {errors.form ? (
              <Alert tone="danger" title="Couldn't reset password" action={<Button href="/forgot-password/" size="small" variant="tertiary">Get a new code</Button>}>
                {errors.form}
              </Alert>
            ) : null}
            <NewPasswordFields value={password} confirm={confirm} onValue={setPassword} onConfirm={setConfirm} errors={errors} />
            <Button type="submit" size="large" fullWidth loading={loading}>
              Reset password
            </Button>
          </Stack>
        </form>
      </AuthCard>
    </AuthShell>
  );
}

/** Settings → Password: change password while signed in. Microsoft and demo sessions are explained instead. */
export function ChangePasswordPage() {
  const user = useSession((s) => s.user)!;
  const account = useAccounts((s) => s.accounts[user.email.toLowerCase()]);
  const policy = usePasswordRules();
  const canChange = useCan("identity.password.change");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ current?: string; password?: string; confirm?: string }>({});
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = validateNew(password, confirm, policy);
    if (!current) next.current = "Enter your current password.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    const result = await changeMyPassword(user.email, current, password);
    setLoading(false);
    if (!result.ok) {
      setErrors({ current: result.error });
      return;
    }
    setDone(true);
    setCurrent("");
    setPassword("");
    setConfirm("");
  };

  return (
    <ModulePage module="settings" description="Change the password you use with your work email. A one-time code is still required at every sign-in.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,560px)_1fr]">
        <Card padding="large" radius="large">
          <CardContent>
            {!canChange ? (
              <Alert tone="info" title="Not available">
                Your role doesn&apos;t include changing the password here (permission identity.password.change).
              </Alert>
            ) : user.source === "microsoft" ? (
              <Alert tone="info" title="Your password is managed by Microsoft">
                You sign in with Microsoft. Change your password in your organisation&apos;s Microsoft account settings.
              </Alert>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <Stack gap="medium">
                  {done ? (
                    <Alert tone="success" title="Password changed">
                      Use your new password next time you sign in. This change was written to the audit log.
                    </Alert>
                  ) : null}
                  {user.source === "demo" ? (
                    <Alert tone="info" title="Demo session">
                      Demo users without a password set one with &ldquo;Set or reset your password&rdquo; on the sign-in page.
                    </Alert>
                  ) : null}
                  <Field label="Current password" required error={errors.current}>
                    <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                  </Field>
                  <NewPasswordFields value={password} confirm={confirm} onValue={setPassword} onConfirm={setConfirm} errors={errors} />
                  <div>
                    <Button type="submit" loading={loading}>
                      Change password
                    </Button>
                  </div>
                </Stack>
              </form>
            )}
          </CardContent>
        </Card>
        <Card variant="filled" padding="large" radius="large">
          <CardContent>
            <Stack gap="small">
              <LockKeyhole aria-hidden className="size-6 text-accent-text" />
              <Text variant="subtitle">Password security</Text>
              <Text tone="muted">
                Passwords must meet your institution&apos;s policy. After {getRule<number>("auth.passwordMaxAttempts")} wrong attempts the account locks until the password is reset. Every sign-in also needs a one-time code.
              </Text>
              {account?.passwordChangedAt ? (
                <Text variant="small" tone="muted">
                  Last changed {date(account.passwordChangedAt)}
                </Text>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      </div>
    </ModulePage>
  );
}
