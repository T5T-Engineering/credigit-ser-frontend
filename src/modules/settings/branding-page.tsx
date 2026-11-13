"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, Landmark, Plus, Send, TrendingUp, Undo2 } from "lucide-react";
import {
  Alert,
  Badge,
  BarChart,
  BrandSettingsPanel,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  defaultBrand,
  Field,
  Grid,
  Logo,
  Modal,
  Sparkline,
  Stack,
  StatCard,
  StatusBadge,
  SubmitButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  TextLink,
  riskStatusTones,
  useBrand,
  type BrandConfig,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import { runHooks } from "@/lib/platform/hooks";
import { submitOperation, usePendingFor, type SubmitResult } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { ago } from "@/lib/format";
import { useAuditLog } from "@/modules/workspace/use-audit-log";
import { brandFingerprint, TenantBrandSync, useBrandingStore } from "./brand-store";
import { brandPresets } from "./presets";
import type { BrandChangePayload } from "./platform";

/** Readable summary (no hex values in the UI); hex values go to the audit log only. */
const describe = (b: BrandConfig) => `${b.name} · ${b.font.family}${Object.values(b.logos).some(Boolean) ? " · custom logo" : ""}`;
const auditSummary = (b: BrandConfig) => `${describe(b)} · ${b.colors.primary} / ${b.colors.accent} / ${b.colors.neutral}`;

/**
 * Settings → Branding. Editing applies a PERSONAL preview in this browser instantly; the tenant brand for every user
 * changes only when a "brand.change" request is approved in Operations (System Admin requests, one approver decides).
 */
export function BrandingPage() {
  return (
    <Suspense>
      <Branding />
    </Suspense>
  );
}

function Branding() {
  const { brand, updateBrand, resetBrand } = useBrand();
  const role = useRole();
  const log = useAuditLog();
  const params = useSearchParams();
  const requesterRoles = useRule<string[]>("settings.brand.requesterRoles");
  const personalPreview = useRule<boolean>("settings.brand.personalPreview");
  const approved = useBrandingStore((s) => s.approved);
  const approvedAt = useBrandingStore((s) => s.approvedAt);
  const approvedBy = useBrandingStore((s) => s.approvedBy);
  const pending = usePendingFor("Branding", "tenant");
  const [submitOpen, setSubmitOpen] = useState(false);
  const canRequest = Boolean(role && requesterRoles.includes(role.id));
  const canEdit = canRequest || personalPreview;
  const tenantBrand = approved ?? defaultBrand;
  const previewing = brandFingerprint(brand) !== brandFingerprint(tenantBrand);

  // Audit personal preview changes (debounced so dragging a colour picker writes one entry).
  const last = useRef<string | null>(null);
  const current = auditSummary(brand);
  useEffect(() => {
    if (last.current === null) {
      last.current = current;
      return;
    }
    if (last.current === current) return;
    const before = last.current;
    const t = window.setTimeout(() => {
      log({ action: "Previewed branding (personal, this browser only)", entityType: "Branding", entityId: "preview", before, after: current });
      last.current = current;
    }, 1200);
    return () => window.clearTimeout(t);
  }, [current, log]);

  // Shareable demo links: ?preset=harbourline previews a preset; ?preview=pending previews the brand awaiting approval.
  const presetId = params.get("preset");
  const previewPending = params.get("preview") === "pending";
  const pendingBrand = (pending?.payload as BrandChangePayload | undefined)?.brand;
  useEffect(() => {
    const preset = brandPresets.find((p) => p.id === presetId);
    if (preset && preset.id !== "credigit") updateBrand(preset.brand);
  }, [presetId, updateBrand]);
  useEffect(() => {
    if (previewPending && pendingBrand) updateBrand(pendingBrand);
  }, [previewPending, pendingBrand, updateBrand]);

  const discard = () => (approved ? updateBrand(approved) : resetBrand());

  return (
    <ModulePage module="settings" title="Branding" description="Colours, logo and font for the whole product. Try changes instantly as a personal preview; the tenant brand changes for everyone once the request is approved in Operations.">
      <TenantBrandSync />
      <Stack gap="large">
        <Alert tone="info" title="Tenant brand">
          {approved ? (
            <>
              <span className="font-semibold">{describe(approved)}</span> — approved by {approvedBy} {approvedAt ? ago(approvedAt) : ""}.
            </>
          ) : (
            "Credigit defaults (Baloo 2) — no tenant brand has been approved yet."
          )}{" "}
          Changes for every user need a {requesterRoles.length ? "System Admin request" : "request"} and one approval in{" "}
          <TextLink href="/operations" as={Link}>
            Operations
          </TextLink>
          .
        </Alert>

        {pending ? (
          <Alert tone="warning" title="A brand change is awaiting approval">
            {(pending.payload as BrandChangePayload).summary} — requested by {pending.requestedBy.name} {ago(pending.requestedAt)}.{" "}
            <TextLink href={`/operations/item?id=${pending.id}`} as={Link}>
              Open request
            </TextLink>{" "}
            ·{" "}
            <TextLink href="/settings/branding?preview=pending" as={Link}>
              Preview it live
            </TextLink>
          </Alert>
        ) : null}

        {previewing ? (
          <Alert tone="info" title="Personal preview — only you see this, in this browser">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Previewing <span className="font-semibold">{describe(brand)}</span>. Other users still see the tenant brand.
              </span>
              <span className="flex flex-wrap gap-2">
                <Button size="small" variant="tertiary" iconBefore={<Undo2 aria-hidden className="size-4" />} onClick={discard}>
                  Discard preview
                </Button>
                {canRequest ? (
                  <SubmitButton size="small" iconBefore={<Send aria-hidden className="size-4" />} disabled={Boolean(pending)} onClick={() => setSubmitOpen(true)}>
                    Request as tenant brand
                  </SubmitButton>
                ) : null}
              </span>
            </div>
          </Alert>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {canEdit ? (
            <BrandSettingsPanel
              presets={brandPresets}
              title="Colours, logos and font"
              description="Changes apply immediately as your personal preview. Logos: SVG, PNG or WebP up to 512 KB. Fonts other than Baloo 2 load from Google Fonts."
            />
          ) : (
            <Card>
              <CardContent>
                <Text tone="muted">Your role can view the tenant brand. Personal previews are turned off for this tenant (rule settings.brand.personalPreview).</Text>
              </CardContent>
            </Card>
          )}
          <LivePreview previewing={previewing} />
        </div>
      </Stack>
      {submitOpen ? <SubmitBrandModal brand={brand} onClose={() => setSubmitOpen(false)} /> : null}
    </ModulePage>
  );
}

function SubmitBrandModal({ brand, onClose }: { brand: BrandConfig; onClose: () => void }) {
  const minReason = useRule<number>("operations.minCommentLength");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (reason.trim().length < minReason) return setResult({ ok: false, reason: `Give a reason of at least ${minReason} characters.` });
    setBusy(true);
    const before = await runHooks("settings.brand.change.before", { brand, reason: reason.trim() });
    if (!before.ok) {
      setBusy(false);
      return setResult({ ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` });
    }
    const payload: BrandChangePayload = { brand: before.ctx.brand, summary: auditSummary(before.ctx.brand), reason: before.ctx.reason };
    const r = await submitOperation<BrandChangePayload>("brand.change", {
      title: `Tenant brand: ${describe(payload.brand)}`,
      subject: { type: "Branding", id: "tenant", title: "Tenant brand", href: "/settings/branding?preview=pending" },
      payload,
      summary: [
        { label: "Brand name", value: payload.brand.name },
        { label: "Font", value: payload.brand.font.family },
        { label: "Logo", value: Object.values(payload.brand.logos).some(Boolean) ? "Custom logo uploaded" : "Credigit logo" },
        { label: "Live preview", value: "Settings → Branding → “Preview it live”" },
        { label: "Reason", value: payload.reason },
      ],
    });
    await runHooks("settings.brand.change.after", { payload, result: r });
    setBusy(false);
    setResult(r);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Request tenant brand change"
      description={`${describe(brand)} — applies to every user once approved in Operations.`}
      footer={
        result?.ok ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton loading={busy} onClick={() => void submit()}>
              Submit for approval
            </SubmitButton>
          </>
        )
      }
    >
      <Stack gap="medium">
        <Field label="Reason for the change" htmlFor="brand-reason" required description="Shown to the approver; kept in the audit log.">
          <Textarea id="brand-reason" rows={3} value={reason} disabled={Boolean(result?.ok)} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {result ? (
          result.ok ? (
            <Alert tone="success" title={result.applied ? "Applied" : "Sent for approval"}>
              {result.applied ? "The workflow has no approval steps, so the brand applies now." : "Your preview stays on in this browser until the approver decides."}{" "}
              <TextLink href={`/operations/item?id=${result.instance.id}`} as={Link}>
                Track request {result.instance.id}
              </TextLink>
            </Alert>
          ) : (
            <Alert tone="danger">{result.reason}</Alert>
          )
        ) : null}
      </Stack>
    </Modal>
  );
}

function LivePreview({ previewing }: { previewing: boolean }) {
  const { brand } = useBrand();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Live preview <Badge tone="accent">{brand.font.family}</Badge>
          {previewing ? <Badge tone="warning">Personal preview</Badge> : <Badge tone="success">Tenant brand</Badge>}
        </CardTitle>
        <Text variant="small" tone="muted">
          Real components from the app, rendered with the brand you&apos;re seeing now.
        </Text>
      </CardHeader>
      <CardContent>
        <Stack gap="large">
          <Grid columns={{ base: 1, sm: 2 }} gap="medium">
            <div className="squircle grid min-h-24 place-items-center rounded-3xl bg-surface-sunken p-4">
              <Logo size="medium" />
            </div>
            <div data-cg-theme="xdark" className="squircle grid min-h-24 place-items-center rounded-3xl bg-bg p-4">
              <Logo size="medium" />
            </div>
          </Grid>
          <div>
            <Text variant="title" as="p">
              Good morning — 2 approvals await your decision
            </Text>
            <Text tone="muted">Body text, labels and figures all use the application font: ₦4,250,000,000 · 12.5% · Stage 2.</Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button iconBefore={<Plus aria-hidden className="size-4" />}>New application</Button>
            <Button variant="secondary">Approve</Button>
            <Button variant="tertiary" iconBefore={<Download aria-hidden className="size-4" />}>
              Export
            </Button>
            <Button variant="text">Cancel</Button>
          </div>
          <Grid columns={{ base: 1, sm: 2 }} gap="medium">
            <StatCard label="NPL ratio" value="4.8%" delta="-0.6pp" deltaIntent="positive" hint="vs last quarter" icon={<TrendingUp aria-hidden className="size-5" />} tone="accent">
              <Sparkline values={[6.1, 5.8, 5.6, 5.4, 5.1, 4.8]} tone="accent" />
            </StatCard>
            <StatCard label="Sign-on limit" value="₦2.5bn" hint="Tier 5 · CRO" icon={<Landmark aria-hidden className="size-5" />} tone="brand" />
          </Grid>
          <BarChart
            data={[
              { label: "Q1", value: 42 },
              { label: "Q2", value: 55 },
              { label: "Q3", value: 61 },
              { label: "Q4", value: 48 },
            ]}
            height={160}
            tone="accent"
            label="Sample chart: approvals per quarter"
          />
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Obligor</TableHeaderCell>
                <TableHeaderCell numeric>Outstanding</TableHeaderCell>
                <TableHeaderCell>Class</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>Okunola Telecoms Ltd</TableCell>
                <TableCell numeric>₦1.19bn</TableCell>
                <TableCell>
                  <StatusBadge status="WATCHLIST" tones={riskStatusTones} />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Adesina Oil & Gas Ltd</TableCell>
                <TableCell numeric>₦640m</TableCell>
                <TableCell>
                  <StatusBadge status="PERFORMING" tones={riskStatusTones} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Stack>
      </CardContent>
    </Card>
  );
}
