"use client";

/**
 * Which sign-in screen to show (backend contract §2, ADR-0013): exactly one mode per deployment.
 *
 * - API mode: anonymous `GET /api/v1/auth/config` (cached for the page).
 * - Demo mode: the same shape built from business rules (`auth.*`) and `NEXT_PUBLIC_AUTH_MODE` (`Local` default,
 *   or `MicrosoftEntra`); Entra settings come from environment config.
 * MSAL is (re)configured from whichever answer is active.
 */
import { useEffect, useMemo, useState } from "react";
import type { PasswordRule } from "@credigit/web-ui";
import { apiEnabled } from "../api/config";
import { problemText } from "../api/client";
import { authApi, type AuthConfig } from "../iam/api";
import { getRule, useRulesStore } from "../platform/rules";
import { passwordRules } from "./accounts";
import { configureMsal, entraSettingsFromEnv, type EntraSettings } from "./msal";

export type { AuthConfig } from "../iam/api";

/** Demo answer to `/auth/config`, from rules and environment config. */
export function demoAuthConfig(): AuthConfig {
  const mode = process.env.NEXT_PUBLIC_AUTH_MODE === "MicrosoftEntra" ? "MicrosoftEntra" : "Local";
  if (mode === "MicrosoftEntra") {
    const env = entraSettingsFromEnv();
    return {
      mode,
      local: null,
      microsoftEntra: env ? { ...env, tenantId: (process.env.NEXT_PUBLIC_TENANT_ID ?? "").trim() } : null,
    };
  }
  return {
    mode,
    local: {
      tenantId: (process.env.NEXT_PUBLIC_TENANT_ID ?? "").trim(),
      tenantSelection: false,
      registrationEnabled: getRule<boolean>("auth.registrationEnabled"),
      otpLength: getRule<number>("auth.otpLength"),
      otpTtlMinutes: getRule<number>("auth.otpTtlMinutes"),
      passwordPolicy: { minLength: getRule<number>("auth.passwordMinLength"), requireMixed: getRule<boolean>("auth.passwordRequireMixed") },
    },
    microsoftEntra: null,
  };
}

function applyMsal(config: AuthConfig) {
  const entra: EntraSettings | null = config.mode === "MicrosoftEntra" ? (config.microsoftEntra ?? entraSettingsFromEnv()) : null;
  configureMsal(entra);
}

let cached: Promise<AuthConfig> | null = null;

/** Load the active auth configuration (API: once per page load; demo: current rule values). */
export function loadAuthConfig(): Promise<AuthConfig> {
  if (!apiEnabled) {
    const config = demoAuthConfig();
    applyMsal(config);
    return Promise.resolve(config);
  }
  cached ??= authApi.config().then((config) => {
    applyMsal(config);
    return config;
  });
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

export type AuthConfigState = { config: AuthConfig | null; error: string | null; loading: boolean };

/** React hook over `loadAuthConfig` (re-evaluated when rules change in demo mode). */
export function useAuthConfig(): AuthConfigState {
  const rules = useRulesStore((s) => s.values);
  const [state, setState] = useState<AuthConfigState>({ config: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    void rules;
    loadAuthConfig().then(
      (config) => live && setState({ config, error: null, loading: false }),
      (e) => live && setState({ config: null, error: problemText(e), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [rules]);
  return state;
}

/** Password checklist rules from the active config (API: `local.passwordPolicy`; demo: rules). Library TD-012 override. */
export function usePasswordRules(): PasswordRule[] {
  const { config } = useAuthConfig();
  return useMemo(() => {
    const policy = config?.local?.passwordPolicy ?? { minLength: getRule<number>("auth.passwordMinLength"), requireMixed: getRule<boolean>("auth.passwordRequireMixed") };
    return passwordRules(policy);
  }, [config]);
}
