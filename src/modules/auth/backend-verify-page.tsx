"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck, ShieldCheck } from "lucide-react";
import { Alert, AuthCard, Button, Logo, OtpVerification, Text } from "@credigit/web-ui";
import { backendChallenge, backendResend, backendVerify, type BackendChallenge } from "@/lib/auth/backend-auth";
import { useSession } from "@/lib/auth/session";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { AuthShell } from "./auth-shell";

const copy: Record<BackendChallenge["purpose"], { title: string; icon: typeof ShieldCheck; description: string; back: { label: string; href: string } }> = {
  SignIn: { title: "Enter your sign-in code", icon: ShieldCheck, description: "Multi-factor sign-in protects every account.", back: { label: "Back to sign in", href: "/login/" } },
  Registration: { title: "Verify your email", icon: MailCheck, description: "Confirm it's you before we send your request for approval.", back: { label: "Back to request access", href: "/register/" } },
  PasswordReset: { title: "Enter your reset code", icon: ShieldCheck, description: "Use the code to set a new password.", back: { label: "Back to sign in", href: "/login/" } },
  StepUp: { title: "Confirm it's you", icon: ShieldCheck, description: "Enter the code to continue.", back: { label: "Back", href: "/dashboard/" } },
};

/** One-time code step against the backend (password sign-in MFA, registration, password reset). */
export function BackendVerifyPage() {
  const router = useRouter();
  const params = useSearchParams();
  const challengeId = params.get("challenge");
  const next = params.get("next") || "/dashboard";
  const signIn = useSession((s) => s.signIn);
  const [challenge, setChallenge] = useState(() => backendChallenge(challengeId));
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  if (requested) {
    return (
      <AuthShell>
        <AuthCard
          logo={<Logo size="small" />}
          icon={<MailCheck />}
          title="Request sent for approval"
          description="Your email is verified. Your institution's System Admin will approve your access and assign your role — you'll be able to sign in once that's done."
          footer={
            <Link href="/login/" className="font-semibold text-link">
              Back to sign in
            </Link>
          }
        />
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
      <AuthCard logo={<Logo size="small" />} icon={<Icon />} title={meta.title} description={meta.description} back={meta.back} linkComponent={Link}>
        <OtpVerification
          destination={challenge.maskedEmail}
          errorMessage={error ?? undefined}
          onResend={async () => {
            const fresh = await backendResend(challenge.challengeId);
            if (fresh) setChallenge(fresh);
            setError(fresh ? null : "A new code couldn't be sent. Start again.");
          }}
          hint={
            challenge.developmentCode ? (
              <Alert tone="info" title="Development — e-mail is off">
                Your code is <span className="font-mono text-lg font-semibold tracking-[0.2em]">{challenge.developmentCode}</span>
              </Alert>
            ) : undefined
          }
          onVerify={async (code) => {
            const outcome = await backendVerify(challenge.challengeId, code);
            if (!outcome.ok) {
              setError(outcome.error);
              if (outcome.expired) setChallenge(undefined);
              return false;
            }
            if (outcome.purpose === "reset") router.push(`/reset-password/?token=${encodeURIComponent(outcome.token)}`);
            else if (outcome.purpose === "signup") setRequested(true);
            else {
              const roleId = outcome.me.roles.find((r): r is RoleId => r in roleById);
              if (!roleId) {
                setError("Your account has no role this application knows yet. Ask your System Admin to assign one.");
                return false;
              }
              signIn({ id: outcome.me.id, name: outcome.me.name, email: outcome.me.email ?? "", source: "password" }, roleId);
              router.replace(next);
            }
            return true;
          }}
        />
        <Text variant="caption" tone="subtle" align="center">
          The code expires at {new Date(challenge.expiresAt).toLocaleTimeString()}. After {challenge.maxAttempts} wrong codes you&apos;ll need a new one.
        </Text>
      </AuthCard>
    </AuthShell>
  );
}
