"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  Input,
  Modal,
  Stack,
  SubmitButton,
  Tabs,
  Text,
  Textarea,
  TextLink,
  type ApprovalTier,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { useSectors, useUsers } from "@/lib/data/hooks";
import type { Sector } from "@/lib/data/types";
import { chartFlow } from "@/lib/workflow";
import { submitOperation, usePendingFor, type SubmitResult } from "@/lib/platform/operations";
import { ruleDefinitions, useRule, type RuleDefinition } from "@/lib/platform/rules";
import { money, moneyShort, pct } from "@/lib/format";
import { usePortfolioSnapshot } from "@/modules/workspace/data";
import { ConfigNotice } from "./config-notice";
import { operationHref, PendingBadge, submitWithHooks, SubmitOutcome } from "./operation-ui";
import { RuleEditorList } from "./rule-editor";
import { useConfiguredRoles } from "./store";
import type { SectorLimitPayload } from "./platform";

const isCollateralRule = (d: RuleDefinition) => /\.(haircut|collateral)\./.test(d.key);

/** Rule groups shown on this page — filters over the business-rules registry (owned by each module). */
const groups: Array<{ id: string; label: string; prd: string; description: string; match: (d: RuleDefinition) => boolean; ownerHref?: { href: string; label: string } }> = [
  {
    id: "approvals",
    label: "Approvals & thresholds",
    prd: "§4.2, §6.1",
    description: "Step-up authentication and origination thresholds (Fast-Track, chart-flow) owned by the platform and the origination module.",
    match: (d) => d.category === "Approvals" || (d.module === "origination" && d.category !== "Products" && !isCollateralRule(d)),
    ownerHref: { href: "/origination/chart-flows", label: "Origination chart-flows" },
  },
  { id: "rar", label: "360 RAR", prd: "§6.2.5", description: "Posture midpoint and intensity bands for the 360 Risk Assessment Rating.", match: (d) => d.key.startsWith("rar.") },
  {
    id: "ifrs9",
    label: "IFRS 9 & provisioning",
    prd: "§6.7.1, §10.4",
    description: "Staging triggers and CBN provisioning rates are owned by the IFRS 9 module. Changes route through Operations like every rule.",
    match: (d) => d.module === "ifrs9",
    ownerHref: { href: "/ifrs9", label: "IFRS 9 module" },
  },
  {
    id: "haircuts",
    label: "Collateral haircuts",
    prd: "§6.5, §6.7.3",
    description: "Haircut weightings are owned by the collateral module.",
    match: (d) => d.module === "collateral" || (d.module === "origination" && isCollateralRule(d)),
    ownerHref: { href: "/collateral", label: "Collateral module" },
  },
  { id: "products", label: "Product catalogue", prd: "§4.1, §6.1", description: "Products offered and Fast-Track variants (origination rules) and tenor caps (admin rules).", match: (d) => (d.module === "admin" && d.category === "Product catalogue") || (d.module === "origination" && d.category === "Products") },
  {
    id: "platform",
    label: "Platform & security",
    prd: "§4.2, §10.4",
    description: "Sessions, authentication, capital base, user administration and workflow defaults. Per-role session rules are on Roles & limits.",
    match: (d) => (["platform", "operations"].includes(d.module) && d.category !== "Approvals" && d.category !== "Sign-on limits" && !d.key.startsWith("rar.")) || (d.module === "admin" && d.category === "User administration"),
  },
];

/** Admin → Rules & parameters (PRD §4.0, §6.1.2, §4.2, §6.2.5, §6.6.1, §6.7.1, §10.4): a view/editor over the business-rules registry. */
export function ParametersPage() {
  return (
    <Suspense>
      <Parameters />
    </Suspense>
  );
}

function Parameters() {
  const canEdit = useCan("admin", "edit");
  const params = useSearchParams();
  const router = useRouter();
  const all = ruleDefinitions();
  const tab = params.get("tab") ?? "approvals";
  return (
    <ModulePage
      module="admin"
      description="The Rules & Parameters Engine: limits, tiers, thresholds and catalogues held as business rules — never hard-coded. Each module owns its rules; this page gathers the ones an administrator looks after."
      actions={
        <Button variant="tertiary" href="/operations/rules" as={Link}>
          All business rules
        </Button>
      }
    >
      <Stack gap="large">
        <ConfigNotice canEdit={canEdit} />
        <Tabs
          label="Parameter groups"
          value={tab}
          onValueChange={(v) => router.replace(`/admin/parameters?tab=${v}`, { scroll: false })}
          items={[
            { id: "approvals", label: "Approvals & thresholds", content: <Stack gap="large"><RuleGroup group={groups[0]!} rules={all} canEdit={canEdit} /><ChartFlowSection /></Stack> },
            ...groups.slice(1, 4).map((g) => ({ id: g.id, label: g.label, content: <RuleGroup group={g} rules={all} canEdit={canEdit} /> })),
            { id: "sectors", label: "Sector limits", content: <SectorLimitsSection canEdit={canEdit} /> },
            ...groups.slice(4).map((g) => ({ id: g.id, label: g.label, content: <RuleGroup group={g} rules={all} canEdit={canEdit} /> })),
          ]}
        />
      </Stack>
    </ModulePage>
  );
}

function Section({ title, description, action, children }: { title: string; description: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {title}
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

function RuleGroup({ group, rules, canEdit }: { group: (typeof groups)[number]; rules: RuleDefinition[]; canEdit: boolean }) {
  const list = rules.filter(group.match);
  return (
    <Section
      title={group.label}
      description={group.description}
      action={
        group.ownerHref ? (
          <TextLink href={group.ownerHref.href} as={Link}>
            {group.ownerHref.label}
          </TextLink>
        ) : undefined
      }
    >
      <RuleEditorList
        rules={list}
        canEdit={canEdit}
        emptyTitle="No rules registered yet"
        emptyDescription={group.ownerHref ? `The owning module hasn't registered these rules yet. They'll appear here automatically — see ${group.ownerHref.label}.` : undefined}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- chart-flow (read-only view: owned by origination)

function ChartFlowSection() {
  const users = useUsers();
  const configured = useConfiguredRoles();
  const stepUp = useRule<number>("approvals.stepUpThresholdNgn");
  const [amount, setAmount] = useState("750000000");
  const byId = useMemo(() => new Map(configured.map((r) => [r.id, r])), [configured]);

  type Row = { pair: string; index: number; roles: string[]; limit: number; adjudicator?: string };
  const rows: Row[] = chartFlow.map((t, index) => {
    const lead = t.roles[t.roles.length - 1]!;
    const limit = byId.get(lead)?.limitNgn ?? t.limit;
    return { pair: t.pair, index, roles: t.roles, limit: limit ?? t.limit, adjudicator: t.adjudicator };
  });

  const value = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const route: ApprovalTier[] = [];
  for (const r of rows) {
    route.push({
      id: r.pair,
      title: `Tier ${r.index + 1} · ${r.pair}`,
      limit: Number.isFinite(r.limit) ? `≤ ${moneyShort(r.limit)}` : "Apex",
      participants: r.roles.map((id) => ({ name: users.find((u) => u.roleId === id)?.name ?? byId.get(id)?.name ?? id, role: byId.get(id)?.name, decision: "pending" as const })),
      adjudicator: r.adjudicator ? { name: users.find((u) => u.roleId === r.adjudicator)?.name ?? "", role: byId.get(r.adjudicator)?.name, decision: "pending" } : undefined,
    });
    if (r.index >= 1 && value <= r.limit) break;
  }

  const columns: DataTableColumn<Row>[] = [
    { id: "tier", header: "Tier", cell: (r) => <Badge variant="outline">{`Tier ${r.index + 1} · ${r.pair}`}</Badge> },
    { id: "signers", header: "Signers", cell: (r) => <span className="font-semibold">{r.roles.map((id) => byId.get(id)?.name ?? id).join(" + ")}</span> },
    { id: "limit", header: "Tier limit", numeric: true, cell: (r) => (Number.isFinite(r.limit) ? moneyShort(r.limit) : "Apex") },
    { id: "adjudicator", header: "Adjudicator on dissent", cell: (r) => (r.roles.length < 2 ? <span className="text-fg-subtle">Not a pair</span> : r.adjudicator ? (byId.get(r.adjudicator)?.name ?? r.adjudicator) : "Escalate to next tier") },
  ];

  return (
    <Section
      title="Co-signer / adjudicator matrix"
      description="Tiers run in order until the amount is within the pair's limit; dissent routes to the adjudicator. Tier limits are the sign-on limit rules (Roles & limits); the chart-flow itself is owned by origination."
      action={
        <TextLink href="/admin/roles" as={Link}>
          Edit tier limits
        </TextLink>
      }
    >
      <Stack gap="large">
        <DataTable columns={columns} data={rows} getRowId={(r) => r.pair} paginate={false} label="Approval tiers" />
        <div className="max-w-sm">
          <Field label="Route preview — facility amount" htmlFor="route-amount" description={value ? money(value) : undefined}>
            <Input id="route-amount" prefix="₦" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        {value > stepUp ? <Alert tone="info">Above the step-up threshold ({moneyShort(stepUp)}) — every approver re-authenticates with OTP / PIN.</Alert> : null}
        <ApprovalTimeline tiers={route} coSignLabel="Co-signers" adjudicatorLabel="Adjudicator if they dissent" />
      </Stack>
    </Section>
  );
}

// ---------------------------------------------------------------- sector limits (spine data → Operations)

function SectorLimitsSection({ canEdit }: { canEdit: boolean }) {
  const sectors = useSectors();
  const snap = usePortfolioSnapshot();
  const nearPct = useRule<number>("workspace.nearLimitPct");
  const minReason = useRule<number>("operations.minCommentLength");
  const pending = usePendingFor("SectorLimits", "sectors");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const share = new Map(snap.bySector.map((s) => [s.id, s.sharePct]));
  const dirty = Object.entries(drafts).filter(([id, v]) => v.trim() !== "" && Number(v) !== sectors.find((s) => s.id === id)?.limitPct);
  const invalid = dirty.some(([, v]) => !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100);

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
          <Input aria-label={`Limit for ${s.name}`} size="small" type="number" suffix="%" disabled={!canEdit || Boolean(pending)} value={drafts[s.id] ?? String(s.limitPct)} onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))} />
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (s) => {
        const sh = share.get(s.id) ?? 0;
        const lim = Number(drafts[s.id] ?? s.limitPct);
        return sh > lim ? <Badge tone="danger">Breach</Badge> : sh >= lim * (nearPct / 100) ? <Badge tone="warning">Near limit</Badge> : <Badge tone="success">Within</Badge>;
      },
    },
  ];

  const submit = async () => {
    if (reason.trim().length < minReason) return setResult({ ok: false, reason: `Give a reason of at least ${minReason} characters.` });
    const changes = dirty.map(([id, v]) => {
      const s = sectors.find((x) => x.id === id)!;
      return { id, name: s.name, before: s.limitPct, after: Number(v) };
    });
    const payload: SectorLimitPayload = { changes, reason: reason.trim() };
    const r = await submitWithHooks("admin.config.change", { kind: "sector-limits", payload }, (ctx) =>
      submitOperation<SectorLimitPayload>("admin.sector-limits.change", {
        title: `Sector limits: ${changes.length} change(s)`,
        subject: { type: "SectorLimits", id: "sectors", title: "Sector limits", href: "/admin/parameters?tab=sectors" },
        payload: ctx.payload,
        summary: [...changes.map((c) => ({ label: c.name, value: `${c.before}% → ${c.after}%` })), { label: "Reason", value: ctx.payload.reason }],
      }),
    );
    setResult(r);
    if (r.ok) setDrafts({});
  };

  return (
    <Section
      title="Sectoral concentration limits"
      description={`Sector limits as a share of the total loan book; "near limit" from ${nearPct}% of the limit (rule workspace.nearLimitPct). Changes need Risk approval in Operations.`}
      action={
        canEdit ? (
          <span className="flex items-center gap-2">
            <PendingBadge subjectType="SectorLimits" subjectId="sectors" />
            <SubmitButton disabled={dirty.length === 0 || invalid || Boolean(pending)} onClick={() => { setResult(null); setConfirmOpen(true); }}>
              Request change {dirty.length ? `(${dirty.length})` : ""}
            </SubmitButton>
          </span>
        ) : null
      }
    >
      <Stack gap="medium">
        {pending ? (
          <Alert tone="warning">
            A sector-limit change is awaiting approval.{" "}
            <TextLink href={operationHref(pending.id)} as={Link}>
              Open request
            </TextLink>
          </Alert>
        ) : null}
        {invalid ? <Alert tone="danger">Limits must be between 0% and 100%.</Alert> : null}
        <DataTable columns={columns} data={sectors} getRowId={(s) => s.id} paginate={false} label="Sector limits" />
      </Stack>
      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Request sector-limit change"
        description={dirty.map(([id, v]) => `${sectors.find((s) => s.id === id)?.name}: ${sectors.find((s) => s.id === id)?.limitPct}% → ${v}%`).join(" · ")}
        footer={
          result?.ok ? (
            <Button onClick={() => setConfirmOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="tertiary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <SubmitButton onClick={() => void submit()}>Submit for approval</SubmitButton>
            </>
          )
        }
      >
        <Stack gap="medium">
          <Field label="Reason for the change" htmlFor="sector-reason" required>
            <Textarea id="sector-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <SubmitOutcome result={result} />
        </Stack>
      </Modal>
    </Section>
  );
}
