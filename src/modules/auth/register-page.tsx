"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { AuthCard, Button, Checkbox, Field, Input, Logo, PasswordInput, PasswordStrength, Select, Stack, Text, evaluatePassword } from "@credigit/web-ui";
import { register } from "@/lib/auth/accounts";
import { branches } from "@/lib/data/seed";
import { roles, type RoleId } from "@/lib/rbac/roles";
import { AuthShell } from "./auth-shell";

type Errors = Partial<Record<"name" | "email" | "institution" | "branch" | "role" | "password" | "confirm" | "terms" | "form", string>>;

/** Request access (self-registration). Verified by one-time code, then approved by a System Admin (PRD §4). */
export function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", institution: "", branch: "", role: "", password: "", confirm: "", terms: false });
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const roleOptions = useMemo(() => roles.filter((r) => r.id !== "system-admin").map((r) => ({ value: r.id, label: `${r.name} — ${r.group}` })), []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (form.name.trim().split(/\s+/).length < 2) next.name = "Enter your first and last name — logins are tied to named individuals.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid work email.";
    if (!form.institution.trim()) next.institution = "Enter your institution.";
    if (!form.branch) next.branch = "Choose your branch or office.";
    if (!form.role) next.role = "Choose the role you need. Your admin confirms it.";
    if (!evaluatePassword(form.password).valid) next.password = "Your password doesn't meet all the requirements.";
    if (form.confirm !== form.password) next.confirm = "Passwords don't match.";
    if (!form.terms) next.terms = "You need to accept the acceptable-use policy.";
    setErrors(next);
    if (Object.keys(next).length) {
      document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    setLoading(true);
    const result = await register({ name: form.name, email: form.email, password: form.password, institution: form.institution, branch: form.branch, requestedRoleId: form.role as RoleId });
    setLoading(false);
    if (!result.ok) {
      setErrors({ email: result.error });
      return;
    }
    router.push(`/verify/?challenge=${result.challengeId}`);
  };

  return (
    <AuthShell>
      <AuthCard
        size="medium"
        logo={<Logo size="small" />}
        icon={<UserPlus />}
        title="Request access"
        description="Your institution's System Admin approves every account and assigns its role."
        back={{ label: "Back to sign in", href: "/login/" }}
        linkComponent={Link}
        footer={
          <>
            Already have an account?{" "}
            <Link href="/login/" className="font-semibold text-link">
              Sign in
            </Link>
          </>
        }
      >
        <form onSubmit={onSubmit} noValidate>
          <Stack gap="medium">
            <Field label="Full name" required error={errors.name}>
              <Input autoComplete="name" value={form.name} onChange={(e) => set("name")(e.target.value)} />
            </Field>
            <Field label="Work email" required error={errors.email} description="Use your institution email — personal addresses aren't approved.">
              <Input type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => set("email")(e.target.value)} placeholder="name@yourbank.com" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Institution" required error={errors.institution}>
                <Input autoComplete="organization" value={form.institution} onChange={(e) => set("institution")(e.target.value)} placeholder="e.g. Harbourline Bank" />
              </Field>
              <Field label="Branch or office" required error={errors.branch}>
                <Select value={form.branch} onChange={(e) => set("branch")(e.target.value)} placeholder="Choose…" options={[...branches, "Head office"].map((b) => ({ value: b, label: b }))} />
              </Field>
            </div>
            <Field label="Role you need" required error={errors.role} description="Requested role — your System Admin confirms or changes it.">
              <Select value={form.role} onChange={(e) => set("role")(e.target.value)} placeholder="Choose a role…" options={roleOptions} />
            </Field>
            <Field label="Password" required error={errors.password}>
              <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => set("password")(e.target.value)} />
            </Field>
            <PasswordStrength value={form.password} />
            <Field label="Confirm password" required error={errors.confirm}>
              <PasswordInput autoComplete="new-password" value={form.confirm} onChange={(e) => set("confirm")(e.target.value)} />
            </Field>
            <Field label="" error={errors.terms} hideLabel>
              <Checkbox checked={form.terms} onChange={(e) => set("terms")(e.target.checked)} label="I accept the acceptable-use policy and understand my activity is audited." />
            </Field>
            <Button type="submit" size="large" fullWidth loading={loading}>
              Continue
            </Button>
            <Text variant="caption" tone="subtle" align="center">
              Next, we&apos;ll send a code to verify your email.
            </Text>
          </Stack>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
