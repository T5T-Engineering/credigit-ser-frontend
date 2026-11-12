"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck, ShieldCheck } from "lucide-react";
import { Alert, AuthCard, Button, Logo, OtpVerification, Text } from "@credigit/web-ui";
import { demoAccessEnabled } from "@/components/auth-guard";
import { resendChallenge, useChallenge, verifyChallenge } from "@/lib/auth/service";
import { useHydrated } from "@/lib/auth/session";
import { useRule } from "@/lib/platform/rules";
import { AuthShell } from "./auth-shell";

const copy = {
  signin: { title: "Enter your sign-in code", icon: ShieldCheck, description: "Multi-factor sign-in protects every account." },
  signup: { title: "Verify your email", icon: MailCheck, description: "Confirm it's you before we send your request for approval." },
  reset: { title: "Enter your reset code", icon: ShieldCheck, description: "Use the code to set a new password." },
  stepup: { title: "Confirm it's you", icon: ShieldCheck, description: "Enter the code to continue." },
} as const;

/** One-time code step shared by password sign-in (MFA), registration and password reset. */
export function VerifyPage() {
  const router = useRouter();
  const params = useSearchParams();
  const challengeId = params.get("challenge");
  const next = params.get("next") || "/dashboard";
  const hydrated = useHydrated();
  const challenge = useChallenge(challengeId);
  const cooldown = useRule<number>("auth.otpResendCooldownSeconds");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name?: string } | null>(null);
  const [openedAt] = useState(() => Date.now());

  if (!hydrated) return null;

  if (pending) {
    return (
      <AuthShell>
        <AuthCard
          logo={<Logo size="small" />}
          icon={<MailCheck />}
          title="Request sent for approval"
          description={`Thanks${pending.name ? `, ${pending.name}` : ""}. Your email is verified. Your institution's System Admin will approve your access and assign your role — you'll be able to sign in once that's done.`}
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
            Set or reset your password
          </Button>
        </AuthCard>
      </AuthShell>
    );
  }

  const meta = copy[challenge.kind];
  const Icon = meta.icon;
  const ttlMinutes = Math.max(1, Math.round((challenge.expiresAt - openedAt) / 60_000));

  return (
    <AuthShell>
      <AuthCard
        logo={<Logo size="small" />}
        icon={<Icon />}
        title={meta.title}
        description={meta.description}
        back={{ label: challenge.kind === "signup" ? "Back to request access" : "Back to sign in", href: challenge.kind === "signup" ? "/register/" : "/login/" }}
        linkComponent={Link}
      >
        <OtpVerification
          key={challenge.id}
          destination={challenge.maskedEmail}
          length={challenge.codeLength}
          resendCooldown={cooldown}
          errorMessage={error ?? undefined}
          onResend={async () => {
            const r = await resendChallenge(challenge.id);
            setError(r.ok ? null : r.error);
          }}
          hint={
            challenge.demoCode ? (
              <Alert tone="info" title="Prototype — no email is sent">
                Your code is <span className="font-mono text-lg font-semibold tracking-[0.2em]">{challenge.demoCode}</span>
              </Alert>
            ) : undefined
          }
          onVerify={async (code) => {
            const outcome = await verifyChallenge(challenge.id, code);
            if (!outcome.ok) {
              setError(outcome.error);
              return false;
            }
            if (outcome.kind === "reset") router.push(`/reset-password/?token=${encodeURIComponent(outcome.token)}`);
            else if (outcome.kind === "registered") setPending({ name: outcome.name });
            else router.replace(next);
            return true;
          }}
        />
        <Text variant="caption" tone="subtle" align="center">
          This code expires in about {ttlMinutes} minute{ttlMinutes === 1 ? "" : "s"}. After {challenge.maxAttempts} wrong codes you&apos;ll need a new one.
        </Text>
      </AuthCard>
    </AuthShell>
  );
}
