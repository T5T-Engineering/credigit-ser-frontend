"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck, ShieldCheck } from "lucide-react";
import { Alert, AuthCard, Button, Logo, OtpVerification, Text } from "@credigit/web-ui";
import { demoAccessEnabled } from "@/components/auth-guard";
import { maskEmail, platformUserFor, resendCode, useAccounts, verifyCode } from "@/lib/auth/accounts";
import { useHydrated, useSession } from "@/lib/auth/session";
import { getRule } from "@/lib/platform/rules";
import { AuthShell } from "./auth-shell";

const copy = {
  signin: { title: "Enter your sign-in code", icon: ShieldCheck, description: "Multi-factor sign-in protects every account." },
  signup: { title: "Verify your email", icon: MailCheck, description: "Confirm it's you before we send your request for approval." },
  reset: { title: "Enter your reset code", icon: ShieldCheck, description: "Use the code to set a new password." },
} as const;

/** One-time code step shared by password sign-in (MFA), registration and password reset. */
export function VerifyPage() {
  const router = useRouter();
  const params = useSearchParams();
  const challengeId = params.get("challenge");
  const next = params.get("next") || "/dashboard";
  const signIn = useSession((s) => s.signIn);
  const hydrated = useHydrated();
  // Re-read on change so the demo hint shows the latest (resent) code.
  const challenge = useAccounts((s) => (challengeId ? s.challenges[challengeId] : undefined));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name: string } | null>(null);

  if (!hydrated) return null;

  if (pending) {
    return (
      <AuthShell>
        <AuthCard
          logo={<Logo size="small" />}
          icon={<MailCheck />}
          title="Request sent for approval"
          description={`Thanks, ${pending.name}. Your email is verified. Your institution's System Admin will approve your access and assign your role — you'll be able to sign in once that's done.`}
          footer={
            <Link href="/login/" className="font-semibold text-link">
              Back to sign in
            </Link>
          }
        >
          {demoAccessEnabled ? (
            <Alert tone="info" title="Prototype">
              Sign in as System Admin (demo access) and approve this request in Operations → Approvals (it is also listed under Admin → Users).
            </Alert>
          ) : null}
        </AuthCard>
      </AuthShell>
    );
  }

  if (!challenge) {
    return (
      <AuthShell>
        <AuthCard logo={<Logo size="small" />} title="This code has expired" description="Start again to get a new code." footer={<Link href="/login/" className="font-semibold text-link">Back to sign in</Link>}>
          <Button href="/forgot-password/" variant="tertiary" fullWidth>
            Reset password
          </Button>
        </AuthCard>
      </AuthShell>
    );
  }

  const meta = copy[challenge.purpose];
  const Icon = meta.icon;

  return (
    <AuthShell>
      <AuthCard
        logo={<Logo size="small" />}
        icon={<Icon />}
        title={meta.title}
        description={meta.description}
        back={{ label: challenge.purpose === "signup" ? "Back to request access" : "Back to sign in", href: challenge.purpose === "signup" ? "/register/" : "/login/" }}
        linkComponent={Link}
      >
        <OtpVerification
          destination={maskEmail(challenge.email)}
          errorMessage={error ?? undefined}
          onResend={() => {
            resendCode(challenge.id);
            setError(null);
          }}
          hint={
            demoAccessEnabled ? (
              <Alert tone="info" title="Prototype — no email is sent">
                Your code is <span className="font-mono text-lg font-semibold tracking-[0.2em]">{challenge.code}</span>
              </Alert>
            ) : undefined
          }
          onVerify={async (code) => {
            const outcome = await verifyCode(challenge.id, code);
            if (!outcome.ok) {
              setError(outcome.error);
              return false;
            }
            if (outcome.purpose === "reset") router.push(`/reset-password/?token=${outcome.token}`);
            else if (outcome.purpose === "signup") setPending({ name: outcome.account.name });
            else {
              const user = platformUserFor(outcome.account);
              if (!user) {
                setError("Your account isn't linked to a platform user yet. Contact your System Admin.");
                return false;
              }
              signIn({ id: user.id, name: user.name, email: user.email, source: "password" }, user.roleId);
              router.replace(next);
            }
            return true;
          }}
        />
        <Text variant="caption" tone="subtle" align="center">
          Codes expire after {getRule<number>("auth.otpTtlMinutes")} minutes. After {getRule<number>("auth.otpMaxAttempts")} wrong codes you&apos;ll need a new one.
        </Text>
      </AuthCard>
    </AuthShell>
  );
}

