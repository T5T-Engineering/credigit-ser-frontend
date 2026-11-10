"use client";

import { useEffect, useRef } from "react";
import { Download, Landmark, Plus, TrendingUp } from "lucide-react";
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
  Grid,
  Logo,
  Sparkline,
  Stack,
  StatCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  RolePicker,
  riskStatusTones,
  useBrand,
  type BrandColors,
  type BrandInput,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import { useAuditLog } from "@/modules/workspace/use-audit-log";

type Preset = { id: string; label: string; description: string; brand: { name: string; colors: BrandColors; font: NonNullable<BrandInput["font"]> } };

/**
 * Tenant presets. Hex values here are tenant brand CONFIGURATION (data handed to `updateBrand`), not UI styling.
 * Harbourline, Sahel and Atlantic are fictional demo tenants.
 */
const presets: Preset[] = [
  { id: "credigit", label: "Credigit default", description: "Ink, Ember and Slate · Baloo 2", brand: { name: "Credigit", colors: { primary: "#0F1E2E", accent: "#E8401C", neutral: "#5B6878" }, font: { family: "Baloo 2" } } },
  { id: "harbourline", label: "Harbourline Bank (demo)", description: "Navy and teal · Inter", brand: { name: "Harbourline Bank", colors: { primary: "#0B2545", accent: "#0F766E", neutral: "#52606D" }, font: { family: "Inter" } } },
  { id: "sahel", label: "Sahel Microfinance Bank (demo)", description: "Aubergine and magenta · Nunito Sans", brand: { name: "Sahel Microfinance Bank", colors: { primary: "#2E1A47", accent: "#A21C6B", neutral: "#5E5A6B" }, font: { family: "Nunito Sans" } } },
  { id: "atlantic", label: "Atlantic Merchant Bank (demo)", description: "Forest and green · IBM Plex Sans", brand: { name: "Atlantic Merchant Bank", colors: { primary: "#14241C", accent: "#1D6B3A", neutral: "#56635B" }, font: { family: "IBM Plex Sans" } } },
];

const summary = (b: { colors: { primary: string; accent: string; neutral: string }; font: { family: string }; name: string; logos: object }) =>
  `${b.name} · ${b.colors.primary} / ${b.colors.accent} / ${b.colors.neutral} · ${b.font.family}${Object.values(b.logos).some(Boolean) ? " · custom logo" : ""}`;

/** Settings → Branding: runtime colours, logos and font for the tenant (applies instantly, everywhere). */
export function BrandingPage() {
  const { brand, updateBrand, resetBrand } = useBrand();
  const role = useRole();
  const log = useAuditLog();
  const isAdmin = role?.id === "system-admin";

  // Audit every brand change (debounced so dragging a colour picker writes one entry).
  const last = useRef<string | null>(null);
  const current = summary(brand);
  useEffect(() => {
    if (last.current === null) {
      last.current = current;
      return;
    }
    if (last.current === current) return;
    const before = last.current;
    const t = window.setTimeout(() => {
      log({ action: "Changed branding", entityType: "Branding", entityId: "tenant", before, after: current });
      last.current = current;
    }, 1200);
    return () => window.clearTimeout(t);
  }, [current, log]);

  // Shareable demo links: /settings/branding/?preset=harbourline applies a tenant preset on load.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("preset");
    const preset = presets.find((p) => p.id === id);
    if (preset && preset.id !== "credigit") updateBrand(preset.brand);
  }, [updateBrand]);

  const active = presets.find((p) => p.brand.colors.accent.toLowerCase() === brand.colors.accent.toLowerCase() && p.brand.colors.primary.toLowerCase() === brand.colors.primary.toLowerCase() && p.brand.font.family === brand.font.family);

  return (
    <ModulePage
      module="settings"
      title="Branding"
      description="Change the application's colours, logo and font on the fly. Every screen, chart and document preview restyles instantly."
    >
      <Stack gap="large">
        <Alert tone="info" title="Applies instantly for this tenant">
          Changes take effect across the whole product as you make them — no reload or release. In this prototype they are stored in this browser; in production the tenant brand is saved centrally and{" "}
          {isAdmin ? "editable by you as System Admin." : "restricted to the System Admin (everyone can try it here)."}
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Tenant presets</CardTitle>
            <Text variant="small" tone="muted">
              One click applies a complete brand: name, colours and font. Fine-tune any value below.
            </Text>
          </CardHeader>
          <CardContent>
            <RolePicker
              aria-label="Tenant brand presets"
              layout="grid"
              searchable={false}
              selectedId={active?.id}
              roles={presets.map((p) => ({
                id: p.id,
                title: p.label,
                description: p.description,
                badge: active?.id === p.id ? "Active" : undefined,
                icon: (
                  <span className="flex -space-x-1.5" aria-hidden>
                    {[p.brand.colors.primary, p.brand.colors.accent, p.brand.colors.neutral].map((c) => (
                      <span key={c} className="size-5 rounded-full ring-2 ring-surface" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                ),
              }))}
              onSelect={(r) => {
                const p = presets.find((x) => x.id === r.id)!;
                if (p.id === "credigit") resetBrand();
                else updateBrand(p.brand);
              }}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <BrandSettingsPanel title="Colours, logos and font" description="Valid changes apply immediately. Logos: SVG, PNG or WebP up to 512 KB. Fonts other than Baloo 2 load from Google Fonts." />
          <LivePreview />
        </div>
      </Stack>
    </ModulePage>
  );
}

function LivePreview() {
  const { brand } = useBrand();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Live preview <Badge tone="accent">{brand.font.family}</Badge>
        </CardTitle>
        <Text variant="small" tone="muted">
          Real components from the app, rendered with the current brand.
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
