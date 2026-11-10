"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import {
  Alert,
  ApprovalTimeline,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Field,
  Grid,
  Input,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextLink,
  type ApprovalTier,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan, useSession } from "@/lib/auth/session";
import { useDbActions, useSectors, useUsers } from "@/lib/data/hooks";
import type { CollateralType, Sector } from "@/lib/data/types";
import { chartFlow } from "@/lib/workflow";
import { RAR_MIDPOINT } from "@/lib/rar";
import { roleById, roles, type RoleId } from "@/lib/rbac/roles";
import { ago, money, moneyShort, pct } from "@/lib/format";
import { useAuditLog } from "@/modules/workspace/use-audit-log";
import { usePortfolioSnapshot } from "@/modules/workspace/data";
import { ConfigNotice } from "./config-notice";
import { configureRoles, defaultParams, useAdminStore, type Ifrs9Params, type ProductConfig } from "./store";

/** Admin → Rules & parameters (PRD §4.0, §6.1.2, §4.2, §6.2.5, §6.6.1, §6.7.1, §10.4). */
export function ParametersPage() {
  const canEdit = useCan("admin", "edit");
  return (
    <ModulePage module="admin" description="The Rules & Parameters Engine: limits, tiers, thresholds and catalogues held as tenant configuration — never hard-coded.">
      <Stack gap="large">
        <ConfigNotice canEdit={canEdit} regulatory />
        <Tabs
          label="Parameter groups"
          items={[
            { id: "flow", label: "Approval chart-flow", content: <ChartFlowSection canEdit={canEdit} /> },
            { id: "thresholds", label: "Thresholds", content: <ThresholdsSection canEdit={canEdit} /> },
            { id: "sectors", label: "Sector limits", content: <SectorLimitsSection canEdit={canEdit} /> },
            { id: "ifrs9", label: "IFRS 9 & provisioning", content: <Ifrs9Section canEdit={canEdit} /> },
            { id: "haircuts", label: "Collateral haircuts", content: <HaircutsSection canEdit={canEdit} /> },
            { id: "products", label: "Product catalogue", content: <ProductsSection canEdit={canEdit} /> },
          ]}
        />
      </Stack>
    </ModulePage>
  );
}

function Section({ title, description, prd, action, children }: { title: string; description: ReactNode; prd: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {title} <Badge variant="outline">PRD {prd}</Badge>
          </CardTitle>
          <Text variant="small" tone="muted">
            {description}
          </Text>
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const roleOptions = [{ value: "", label: "None — escalate to next tier" }, ...roles.filter((r) => r.group === "Credit approval" || r.id === "credit-analyst").map((r) => ({ value: r.id, label: r.name }))];

// ---------------------------------------------------------------- chart-flow

function ChartFlowSection({ canEdit }: { canEdit: boolean }) {
  const params = useAdminStore((s) => s.params);
  const setParams = useAdminStore((s) => s.setParams);
  const roleOverrides = useAdminStore((s) => s.roleOverrides);
  const roleSecurity = useAdminStore((s) => s.roleSecurity);
  const customRoles = useAdminStore((s) => s.customRoles);
  const users = useUsers();
  const log = useAuditLog();
  const [amount, setAmount] = useState("750000000");
  const configured = useMemo(() => new Map(configureRoles({ roleOverrides, roleSecurity, customRoles }).map((r) => [r.id, r])), [roleOverrides, roleSecurity, customRoles]);

  type Row = { pair: string; index: number; roles: RoleId[]; limit: number; adjudicator: RoleId | "" };
  const rows: Row[] = chartFlow.map((t, index) => {
    const lead = t.roles[t.roles.length - 1]!;
    const limit = configured.get(lead)?.limitNgn ?? t.limit;
    return { pair: t.pair, index, roles: t.roles, limit: limit ?? t.limit, adjudicator: params.chartFlow.find((c) => c.pair === t.pair)?.adjudicator ?? "" };
  });

  const value = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const route: ApprovalTier[] = [];
  for (const r of rows) {
    route.push({
      id: r.pair,
      title: `Tier ${r.index + 1} · ${r.pair}`,
      limit: Number.isFinite(r.limit) ? `≤ ${moneyShort(r.limit)}` : "Apex",
      participants: r.roles.map((id) => ({ name: users.find((u) => u.roleId === id)?.name ?? configured.get(id)?.name ?? id, role: configured.get(id)?.name, decision: "pending" as const })),
      adjudicator: r.adjudicator ? { name: users.find((u) => u.roleId === r.adjudicator)?.name ?? "", role: configured.get(r.adjudicator)?.name, decision: "pending" } : undefined,
    });
    if (r.index >= 1 && value <= r.limit) break;
  }

  const columns: DataTableColumn<Row>[] = [
    { id: "tier", header: "Tier", cell: (r) => <Badge variant="outline">{`Tier ${r.index + 1} · ${r.pair}`}</Badge> },
    {
      id: "signers",
      header: "Signers",
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-semibold">{r.roles.map((id) => configured.get(id)?.name ?? id).join(" + ")}</span>
          <span className="text-sm text-fg-muted">{r.roles.length > 1 ? "Co-signer pair — both sign in parallel" : r.index === 0 ? "Recommends" : "Committee / single signer"}</span>
        </span>
      ),
    },
    { id: "limit", header: "Tier limit", numeric: true, cell: (r) => (Number.isFinite(r.limit) ? moneyShort(r.limit) : "Apex") },
    {
      id: "adjudicator",
      header: "Adjudicator on dissent",
      cell: (r) =>
        r.roles.length < 2 ? (
          <span className="text-fg-subtle">Not a pair</span>
        ) : (
          <Select
            aria-label={`Adjudicator for ${r.pair}`}
            size="small"
            value={r.adjudicator}
            options={roleOptions}
            disabled={!canEdit}
            onChange={(e) => {
              const next = e.target.value as RoleId | "";
              setParams({ chartFlow: params.chartFlow.map((c) => (c.pair === r.pair ? { ...c, adjudicator: next } : c)) });
              log({ action: "Changed adjudicator", entityType: "Chart-flow", entityId: r.pair, before: r.adjudicator ? roleById[r.adjudicator].name : "None", after: next ? roleById[next].name : "None" });
            }}
          />
        ),
    },
  ];

  return (
    <Stack gap="large">
      <Section
        title="Co-signer / adjudicator matrix"
        prd="§6.1.2, §4.2"
        description="Tiers run in order until the amount is within the pair's limit. Dissent between co-signers routes to the named adjudicator — an unresolved approval never sits idle. Tier limits come from Roles & limits."
        action={
          <TextLink href="/admin/roles" as={Link}>
            Edit tier limits
          </TextLink>
        }
      >
        <DataTable columns={columns} data={rows} getRowId={(r) => r.pair} paginate={false} label="Approval tiers" />
      </Section>
      <Section title="Route preview" prd="§6.1.2" description="Enter a facility amount to see which tiers must sign it under the current configuration.">
        <Stack gap="medium">
          <div className="max-w-sm">
            <Field label="Facility amount" htmlFor="route-amount" description={value ? money(value) : undefined}>
              <Input id="route-amount" prefix="₦" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          {value > params.stepUpThresholdNgn ? <Alert tone="info">Above the high-value threshold ({moneyShort(params.stepUpThresholdNgn)}) — every approver re-authenticates with step-up OTP/PIN.</Alert> : null}
          <ApprovalTimeline tiers={route} coSignLabel="Co-signers" adjudicatorLabel="Adjudicator if they dissent" />
        </Stack>
      </Section>
    </Stack>
  );
}

// ---------------------------------------------------------------- thresholds

function NumberField({ id, label, value, onChange, prefix, suffix, description, disabled, step }: { id: string; label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; description?: ReactNode; disabled?: boolean; step?: string }) {
  return (
    <Field label={label} htmlFor={id} description={description}>
      <Input id={id} type="number" inputMode="decimal" step={step} prefix={prefix} suffix={suffix} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function ThresholdsSection({ canEdit }: { canEdit: boolean }) {
  const params = useAdminStore((s) => s.params);
  const setParams = useAdminStore((s) => s.setParams);
  const log = useAuditLog();
  const initial = useMemo(
    () => ({
      stepUp: String(params.stepUpThresholdNgn),
      fastTrack: String(params.fastTrackCeilingNgn),
      neutral: String(params.rar.neutralBelow),
      marginal: String(params.rar.marginalBelow),
      moderate: String(params.rar.moderateBelow),
    }),
    [params],
  );
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof d) => (v: string) => {
    setSaved(false);
    setD((x) => ({ ...x, [k]: v }));
  };

  const save = () => {
    const n = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Number(v)])) as Record<keyof typeof d, number>;
    if (Object.values(n).some((v) => !Number.isFinite(v) || v < 0)) return setError("All values must be positive numbers.");
    if (!(n.neutral > 0 && n.neutral < n.marginal && n.marginal < n.moderate)) return setError("Intensity thresholds must increase: Neutral < Marginal < Moderate.");
    if (n.moderate > 6.37) return setError("The Moderate threshold can't exceed the maximum distance from the 5.5 midpoint on a 1–10 scale (≈ 6.36).");
    const changes: Array<[string, string, string]> = [];
    if (n.stepUp !== params.stepUpThresholdNgn) changes.push(["High-value step-up threshold", money(params.stepUpThresholdNgn), money(n.stepUp)]);
    if (n.fastTrack !== params.fastTrackCeilingNgn) changes.push(["Fast-Track ceiling", money(params.fastTrackCeilingNgn), money(n.fastTrack)]);
    const rarBefore = `${params.rar.neutralBelow} / ${params.rar.marginalBelow} / ${params.rar.moderateBelow}`;
    const rarAfter = `${n.neutral} / ${n.marginal} / ${n.moderate}`;
    if (rarBefore !== rarAfter) changes.push(["360 RAR intensity thresholds", rarBefore, rarAfter]);
    setParams({ stepUpThresholdNgn: n.stepUp, fastTrackCeilingNgn: n.fastTrack, rar: { neutralBelow: n.neutral, marginalBelow: n.marginal, moderateBelow: n.moderate } });
    changes.forEach(([label, before, after]) => log({ action: `Changed parameter: ${label}`, entityType: "Parameter", entityId: label, before, after }));
    setError(null);
    setSaved(true);
  };

  return (
    <Stack gap="large">
      {error ? <Alert tone="danger">{error}</Alert> : saved ? <Alert tone="success">Saved — applies immediately across modules.</Alert> : null}
      <Grid columns={{ base: 1, lg: 2 }} gap="large">
        <Section title="Step-up authentication" prd="§4.2" description="Approvers re-authenticate (OTP / transaction PIN) for amounts above this tenant-configurable high-value threshold.">
          <Stack gap="medium">
            <NumberField id="p-stepup" label="High-value threshold" prefix="₦" value={d.stepUp} onChange={set("stepUp")} disabled={!canEdit} description="Parameter — set by tenant (demo default ₦100m)." />
            <NumberField id="p-fast" label="Fast-Track chart-flow ceiling" prefix="₦" value={d.fastTrack} onChange={set("fastTrack")} disabled={!canEdit} description="Parameter — set by tenant (PRD §6.1.3; demo default ₦50m)." />
          </Stack>
        </Section>
        <Section title="360 RAR posture intensity" prd="§6.2.5" description={`Distance of the composite position from the ${RAR_MIDPOINT} midpoint sets the intensity band (12 intensity-graded postures + Neutral / Transitional).`}>
          <Grid columns={{ base: 1, sm: 3 }} gap="medium">
            <NumberField id="p-neutral" label="Neutral below" step="0.1" value={d.neutral} onChange={set("neutral")} disabled={!canEdit} />
            <NumberField id="p-marginal" label="Marginal below" step="0.1" value={d.marginal} onChange={set("marginal")} disabled={!canEdit} />
            <NumberField id="p-moderate" label="Moderate below" step="0.1" value={d.moderate} onChange={set("moderate")} disabled={!canEdit} />
          </Grid>
          <Text variant="small" tone="muted" className="mt-3 block">
            Magnitude &lt; {d.neutral} → Neutral / Transitional · &lt; {d.marginal} → Marginally · &lt; {d.moderate} → Moderately · otherwise Strongly. Demo defaults — the PRD leaves these to the tenant.
          </Text>
        </Section>
      </Grid>
      {canEdit ? (
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={() => setD(initial)}>
            Discard
          </Button>
          <Button
            variant="text"
            onClick={() =>
              setD({
                stepUp: String(defaultParams.stepUpThresholdNgn),
                fastTrack: String(defaultParams.fastTrackCeilingNgn),
                neutral: String(defaultParams.rar.neutralBelow),
                marginal: String(defaultParams.rar.marginalBelow),
                moderate: String(defaultParams.rar.moderateBelow),
              })
            }
          >
            Restore defaults
          </Button>
          <Button onClick={save}>Save thresholds</Button>
        </div>
      ) : null}
    </Stack>
  );
}

// ---------------------------------------------------------------- sector limits

function SectorLimitsSection({ canEdit }: { canEdit: boolean }) {
  const sectors = useSectors();
  const snap = usePortfolioSnapshot();
  const { update } = useDbActions();
  const log = useAuditLog();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const share = new Map(snap.bySector.map((s) => [s.id, s.sharePct]));
  const dirty = Object.entries(drafts).filter(([id, v]) => Number(v) !== sectors.find((s) => s.id === id)?.limitPct);

  const columns: DataTableColumn<Sector>[] = [
    { id: "name", header: "Sector", accessor: "name", sortable: true },
    { id: "share", header: "Current share", numeric: true, accessor: (s) => share.get(s.id) ?? 0, sortable: true, cell: (s) => pct(share.get(s.id) ?? 0) },
    {
      id: "limit",
      header: "Limit (% of loan book)",
      accessor: "limitPct",
      sortable: true,
      cell: (s) => (
        <div className="w-32">
          <Input
            aria-label={`Limit for ${s.name}`}
            size="small"
            type="number"
            suffix="%"
            disabled={!canEdit}
            value={drafts[s.id] ?? String(s.limitPct)}
            onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
          />
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (s) => {
        const sh = share.get(s.id) ?? 0;
        const lim = Number(drafts[s.id] ?? s.limitPct);
        return sh > lim ? <Badge tone="danger">Breach</Badge> : sh >= lim * 0.9 ? <Badge tone="warning">Near limit</Badge> : <Badge tone="success">Within</Badge>;
      },
    },
  ];

  return (
    <Section
      title="Sectoral concentration limits"
      prd="§6.6.1, §10.4"
      description="Internal sector taxonomy and limits as a share of the total loan book. Portfolio limit monitoring picks up new values immediately."
      action={
        canEdit ? (
          <Button
            disabled={dirty.length === 0}
            onClick={() => {
              for (const [id, v] of dirty) {
                const s = sectors.find((x) => x.id === id)!;
                const value = Math.max(0, Math.min(100, Number(v)));
                update("sectors", id, { limitPct: value });
                log({ action: "Changed sector limit", entityType: "Sector", entityId: id, before: pct(s.limitPct, 1), after: pct(value, 1) });
              }
              setDrafts({});
            }}
          >
            Save {dirty.length ? `(${dirty.length})` : ""}
          </Button>
        ) : null
      }
    >
      <DataTable columns={columns} data={sectors} getRowId={(s) => s.id} paginate={false} label="Sector limits" />
    </Section>
  );
}

// ---------------------------------------------------------------- IFRS 9 (regulatory → second-person confirmation)

const ifrsFields: Array<{ key: keyof Ifrs9Params; label: string; suffix: string; hint: string }> = [
  { key: "stage2Dpd", label: "Stage 2 trigger (SICR backstop)", suffix: "DPD", hint: "PRD §6.7.1: Watchlist / early arrears, typically 30–89 days" },
  { key: "stage3Dpd", label: "Stage 3 trigger (credit-impaired)", suffix: "DPD", hint: "PRD §6.7.1: Sub-Standard from 90 days" },
  { key: "provisionSubstandardPct", label: "CBN provision — Sub-Standard", suffix: "%", hint: "CBN 12.2(a)(2)(i)" },
  { key: "provisionDoubtfulPct", label: "CBN provision — Doubtful", suffix: "%", hint: "CBN 12.2(a)(2)(ii)" },
  { key: "provisionLostPct", label: "CBN provision — Lost", suffix: "%", hint: "CBN 12.2(a)(2)(iii)" },
  { key: "generalProvisionCapPct", label: "General provision cap", suffix: "% of RWA", hint: "CBN 3.16(d)" },
  { key: "lgdFloorPct", label: "LGD floor", suffix: "%", hint: "Parameter — set by tenant (model owner)" },
];

function Ifrs9Section({ canEdit }: { canEdit: boolean }) {
  const params = useAdminStore((s) => s.params);
  const pending = useAdminStore((s) => s.pending);
  const requestChange = useAdminStore((s) => s.requestChange);
  const resolveChange = useAdminStore((s) => s.resolveChange);
  const user = useSession((s) => s.user)!;
  const log = useAuditLog();
  const [drafts, setDrafts] = useState<Partial<Record<keyof Ifrs9Params, string>>>({});
  const fmt = (v: unknown, suffix: string) => (v === null || v === undefined || v === "" ? "Not set" : `${v} ${suffix}`);

  const submit = () => {
    for (const f of ifrsFields) {
      const raw = drafts[f.key];
      if (raw === undefined) continue;
      const value = raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isFinite(value) || value < 0)) continue;
      if (value === params.ifrs9[f.key]) continue;
      requestChange({
        id: `CHG-${Date.now().toString(36)}-${f.key}`,
        section: "ifrs9",
        field: f.key,
        label: f.label,
        before: fmt(params.ifrs9[f.key], f.suffix),
        after: fmt(value, f.suffix),
        value,
        requestedById: user.id,
        requestedByName: user.name,
        requestedAt: new Date().toISOString(),
      });
      log({ action: "Requested regulatory parameter change", entityType: "Parameter", entityId: f.key, before: fmt(params.ifrs9[f.key], f.suffix), after: fmt(value, f.suffix) });
    }
    setDrafts({});
  };

  return (
    <Stack gap="large">
      {pending.length ? (
        <Alert tone="warning" title="Awaiting second-person confirmation">
          <ul className="mt-2 flex flex-col gap-2">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-3">
                <span>
                  <span className="font-semibold">{p.label}</span>: <span className="font-mono">{p.before}</span> → <span className="font-mono">{p.after}</span>
                  <span className="block text-sm text-fg-muted">
                    Requested by {p.requestedByName} · {ago(p.requestedAt)}
                    {p.requestedById === user.id ? " · a different System Admin, the CRO or the Head of Risk must confirm" : ""}
                  </span>
                </span>
                {canEdit ? (
                  <span className="flex gap-2">
                    <Button
                      size="small"
                      variant="tertiary"
                      iconBefore={<X aria-hidden className="size-4" />}
                      onClick={() => {
                        resolveChange(p.id, false);
                        log({ action: p.requestedById === user.id ? "Withdrew parameter change" : "Rejected parameter change", entityType: "Parameter", entityId: String(p.field), before: p.before, after: p.after });
                      }}
                    >
                      {p.requestedById === user.id ? "Withdraw" : "Reject"}
                    </Button>
                    <Button
                      size="small"
                      iconBefore={<Check aria-hidden className="size-4" />}
                      disabled={p.requestedById === user.id}
                      onClick={() => {
                        resolveChange(p.id, true);
                        log({ action: "Confirmed parameter change (second person)", entityType: "Parameter", entityId: String(p.field), before: p.before, after: p.after });
                      }}
                    >
                      Confirm
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Section
        title="IFRS 9 staging & CBN provisioning"
        prd="§6.7.1, §10.4"
        description="Regulatory parameters: a change is held as pending until a second person confirms it, then applies to staging and the parallel CBN / IFRS provisioning run."
        action={
          canEdit ? (
            <Button disabled={Object.keys(drafts).length === 0} onClick={submit}>
              Submit for confirmation
            </Button>
          ) : null
        }
      >
        <Grid columns={{ base: 1, sm: 2, xl: 3 }} gap="medium">
          {ifrsFields.map((f) => (
            <NumberField
              key={f.key}
              id={`ifrs-${f.key}`}
              label={f.label}
              suffix={f.suffix}
              step="0.01"
              value={drafts[f.key] ?? (params.ifrs9[f.key] === null ? "" : String(params.ifrs9[f.key]))}
              onChange={(v) => setDrafts((d) => ({ ...d, [f.key]: v }))}
              disabled={!canEdit || pending.some((p) => p.field === f.key)}
              description={pending.some((p) => p.field === f.key) ? "Change pending confirmation" : f.hint}
            />
          ))}
          <Field label="Forward-looking scenarios" htmlFor="ifrs-scen" description="Placeholder — weights calibrated by the Predictive Analytics Officer (PRD §6.7.2).">
            <Input id="ifrs-scen" value={params.ifrs9.forwardLookingScenarios} disabled />
          </Field>
        </Grid>
      </Section>
    </Stack>
  );
}

// ---------------------------------------------------------------- haircuts

function HaircutsSection({ canEdit }: { canEdit: boolean }) {
  const params = useAdminStore((s) => s.params);
  const setParams = useAdminStore((s) => s.setParams);
  const log = useAuditLog();
  const [drafts, setDrafts] = useState<Partial<Record<CollateralType, string>>>({});
  type Row = { type: CollateralType; pct: number };
  const rows: Row[] = (Object.entries(params.haircuts) as Array<[CollateralType, number]>).map(([type, pct]) => ({ type, pct }));
  const dirty = (Object.entries(drafts) as Array<[CollateralType, string]>).filter(([t, v]) => Number(v) !== params.haircuts[t]);
  const columns: DataTableColumn<Row>[] = [
    { id: "type", header: "Collateral type", accessor: "type", sortable: true },
    {
      id: "pct",
      header: "Haircut",
      accessor: "pct",
      sortable: true,
      cell: (r) => (
        <div className="w-28">
          <Input aria-label={`Haircut for ${r.type}`} size="small" type="number" suffix="%" disabled={!canEdit} value={drafts[r.type] ?? String(r.pct)} onChange={(e) => setDrafts((d) => ({ ...d, [r.type]: e.target.value }))} />
        </div>
      ),
    },
    { id: "recovery", header: "Recovery value per ₦100", numeric: true, cell: (r) => `₦${Math.max(0, 100 - Number(drafts[r.type] ?? r.pct))}` },
  ];
  return (
    <Section
      title="Collateral haircut weightings"
      prd="§6.5, §6.7.3, §10.4"
      description="Applied to market / forced-sale values for cover and haircut-adjusted provisioning. Demo values — set by tenant."
      action={
        canEdit ? (
          <Button
            disabled={dirty.length === 0}
            onClick={() => {
              const haircuts = { ...params.haircuts };
              for (const [t, v] of dirty) {
                const value = Math.max(0, Math.min(100, Number(v)));
                log({ action: "Changed haircut weighting", entityType: "Parameter", entityId: t, before: pct(params.haircuts[t], 0), after: pct(value, 0) });
                haircuts[t] = value;
              }
              setParams({ haircuts });
              setDrafts({});
            }}
          >
            Save {dirty.length ? `(${dirty.length})` : ""}
          </Button>
        ) : null
      }
    >
      <DataTable columns={columns} data={rows} getRowId={(r) => r.type} paginate={false} label="Collateral haircuts" />
    </Section>
  );
}

// ---------------------------------------------------------------- product catalogue

function ProductsSection({ canEdit }: { canEdit: boolean }) {
  const params = useAdminStore((s) => s.params);
  const setParams = useAdminStore((s) => s.setParams);
  const log = useAuditLog();
  const change = (p: ProductConfig, next: Partial<ProductConfig>, label: string, before: string, after: string) => {
    setParams({ products: params.products.map((x) => (x.product === p.product ? { ...x, ...next } : x)) });
    log({ action: `Changed product: ${label}`, entityType: "Product", entityId: p.product, before, after });
  };
  const columns: DataTableColumn<ProductConfig>[] = [
    { id: "product", header: "Product", accessor: "product", sortable: true, cell: (p) => <span className="font-semibold">{p.product}</span> },
    {
      id: "enabled",
      header: "Offered",
      cell: (p) => <Switch label={`Offer ${p.product}`} hideLabel checked={p.enabled} disabled={!canEdit} onCheckedChange={(c) => change(p, { enabled: c }, "offered", p.enabled ? "Yes" : "No", c ? "Yes" : "No")} />,
    },
    {
      id: "tenor",
      header: "Max tenor",
      cell: (p) => (
        <div className="w-32">
          <Select
            aria-label={`Maximum tenor for ${p.product}`}
            size="small"
            value={p.maxTenorMonths}
            disabled={!canEdit}
            options={[6, 12, 18, 24, 36, 48, 60, 84, 120, 180, 240].map((m) => ({ value: m, label: `${m} months` }))}
            onChange={(e) => change(p, { maxTenorMonths: Number(e.target.value) }, "max tenor", `${p.maxTenorMonths} months`, `${e.target.value} months`)}
          />
        </div>
      ),
    },
    {
      id: "fast",
      header: "Fast-Track eligible",
      cell: (p) => (
        <Switch label={`Fast-Track for ${p.product}`} hideLabel checked={p.fastTrackEligible} disabled={!canEdit || !p.enabled} onCheckedChange={(c) => change(p, { fastTrackEligible: c }, "Fast-Track", p.fastTrackEligible ? "Yes" : "No", c ? "Yes" : "No")} />
      ),
    },
  ];
  return (
    <Section title="Product catalogue" prd="§4.1, §6.1" description="Credit products offered in origination, with tenor caps and Fast-Track eligibility. Changes apply to new applications.">
      <DataTable columns={columns} data={params.products} getRowId={(p) => p.product} paginate={false} label="Product catalogue" mobileCard={(p) => <span className="font-semibold">{p.product} · {p.enabled ? "Offered" : "Not offered"} · {p.maxTenorMonths} months</span>} />
    </Section>
  );
}
