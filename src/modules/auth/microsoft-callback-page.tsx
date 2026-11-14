"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Alert, AuthCard, Logo, Spinner, Stack, Text } from "@credigit/web-ui";
import { completeMicrosoftSignIn } from "@/lib/auth/backend-sso";
import { useSession } from "@/lib/auth/session";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { AuthShell } from "./auth-shell";

/** `/callback/`: Microsoft returns here; the backend redeems the code and the directory decides the role (AUTH-FR-21). */
export function MicrosoftCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const signIn = useSession((s) => s.signIn);
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const started = useRef(false);
  const code = params.get("code");
  const state = params.get("state");
  const failure = params.get("error_description") || params.get("error");
  const answerError = failure
    ? `Microsoft sign-in was not completed: ${failure}`
    : !code || !state
      ? "This page needs the answer from Microsoft. Start the sign-in again."
      : null;
  const error = answerError ?? exchangeError;

  useEffect(() => {
    // The code is single-use: never redeem twice (React strict mode runs effects twice in development).
    if (answerError || !code || !state || started.current) return;
    started.current = true;
    completeMicrosoftSignIn(code, state)
      .then(({ me, next }) => {
        const roleId = me.roles.find((r): r is RoleId => r in roleById);
        if (!roleId) {
          setExchangeError("Your account has no role this application knows yet. Ask your System Admin to assign one.");
          return;
        }
        signIn({ id: me.id, name: me.name, email: me.email ?? "", source: "microsoft" }, roleId);
        router.replace(next);
      })
      .catch((e: unknown) => setExchangeError(e instanceof Error ? e.message : String(e)));
  }, [answerError, code, state, router, signIn]);

  return (
    <AuthShell>
      <AuthCard
        logo={<Logo size="small" />}
        icon={<ShieldCheck />}
        title={error ? "Microsoft sign-in didn't finish" : "Signing you in…"}
        description={error ? undefined : "Checking your Microsoft account with your institution."}
        footer={
          error ? (
            <Link href="/login/" className="font-semibold text-link">
              Back to sign in
            </Link>
          ) : undefined
        }
      >
        {error ? (
          <Alert tone="danger" title="Sign-in failed">
            {error}
          </Alert>
        ) : (
          <Stack gap="small" className="items-center py-4">
            <Spinner />
            <Text variant="small" tone="muted">
              This takes a moment.
            </Text>
          </Stack>
        )}
      </AuthCard>
    </AuthShell>
  );
}
