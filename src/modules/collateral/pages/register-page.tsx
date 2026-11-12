"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, Plus } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DonutChart,
  EmptyState,
  Field,
  Form,
  Grid,
  Input,
  MiniBarList,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  StatCard,
  StatusBadge,
  Text,
  Tooltip,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import { useFacilities, useLookups } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { useDb } from "@/lib/data/store";
import type { CollateralType } from "@/lib/data/types";
import { date, moneyShort, number, pct } from "@/lib/format";
import { useMyApprovalQueue } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { daysBetween } from "@/modules/monitoring/logic";
import { moTones } from "../data";
import { buildCollateralAlerts, collateralAbilities, haircutFor, perfectionTones } from "../logic";
import { registerCollateral, requestVerification, sendReminders } from "../service";
import { useCollateralView, type CollateralView } from "../store";

type Row = CollateralView & { obligorName: string; alert: string };

const collateralTypes: CollateralType[] = [
  "Legal mortgage",
  "Equitable mortgage",
  "Debenture",
  "Quoted shares",
  "Cash / lien on deposit",
  "Vehicle",
  "Equipment",
  "Domiciliation of proceeds",
  "Corporate guarantee",
  "Personal guarantee",
  "Insurance policy",
];

export function CollateralRegisterPage() {
  const view = useCollateralView();
  const { obligor } = useLookups();
  const role = useRole();
  const can = collateralAbilities(role?.id);
  const [adding, setAdding] = useState(false);
  const facilities = useFacilities();
  const { actor } = useScope();
  const queue = useMyApprovalQueue(actor);
  const insWarn = useRule<number>("collateral.insurance.warningDays");
  const minCoverPct = useRule<number>("collateral.margin.minCoverPct");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [message, setMessage] = useState<string | null>(null);

  const rows: Row[] = useMemo(
    () =>
      view.map((c) => {
        const ins = c.insuranceExpiryEffective ? daysBetween(DEMO_NOW, c.insuranceExpiryEffective) : undefined;
        const reval = daysBetween(DEMO_NOW, c.nextRevaluation);
        const alert =
          c.perfection === "Defective"
            ? "Perfection defective"
            : ins !== undefined && ins < 0
              ? "Insurance expired"
              : ins !== undefined && ins <= insWarn
                ? "Insurance expiring"
                : c.type !== "Quoted shares" && c.type !== "Cash / lien on deposit" && reval < 0
                  ? "Revaluation overdue"
                  : c.type === "Quoted shares" && c.exposure > 0 && c.cover * 100 < minCoverPct
                    ? "Margin shortfall"
                    : "None";
        return { ...c, obligorName: obligor.get(c.obligorId)?.name ?? c.obligorId, alert };
      }),
    [view, obligor, insWarn, minCoverPct],
  );

  /** "Needs my action": records whose next step belongs to the signed-in role, or with an operation awaiting me. */
  const awaitingMe = useMemo(() => new Set(queue.filter((i) => i.operationType.startsWith("collateral.")).map((i) => i.subject.id)), [queue]);
  const needsMe = (r: Row) => {
    if (awaitingMe.has(r.id)) return true;
    if (can.manage) return r.verification.status !== "Verified" || r.perfection === "Documentation" || r.perfection === "Registration" || r.alert.startsWith("Insurance") || r.alert === "Revaluation overdue" || r.alert === "Margin shortfall";
    if (can.legal) return r.perfection === "Not started" || r.perfection === "Search in progress" || r.perfection === "Defective" || (!r.legalRecord.signOff && (r.perfection === "Registration" || r.perfection === "Perfected"));
    return false;
  };
  const shown = scope === "mine" ? rows.filter(needsMe) : rows;

  const remind = () => {
    const n = sendReminders(buildCollateralAlerts(view, facilities, (c) => (c as (typeof view)[number]).mtm), view);
    setMessage(n ? `${n} reminder${n === 1 ? "" : "s"} sent to the collateral and credit administration officers.` : "No new insurance or revaluation reminders to send — every open alert has already been notified.");
  };

  const secured = rows.filter((r) => r.exposure > 0);
  const totalMv = rows.reduce((a, r) => a + (r.mtm ?? r.marketValue), 0);
  const totalFsv = rows.reduce((a, r) => a + r.forcedSaleValue, 0);
  const adjEligible = secured.filter((r) => r.eligible).reduce((a, r) => a + r.adjusted, 0);
  const exposure = secured.reduce((a, r) => a + r.exposure, 0);
  const perfCounts = ["Perfected", "Registration", "Documentation", "Search in progress", "Not started", "Defective"].map((s) => ({ label: s, value: rows.filter((r) => r.perfection === s).length }));
  const insuranceDue = rows.filter((r) => r.alert.startsWith("Insurance")).length;
  const revalDue = rows.filter((r) => r.alert === "Revaluation overdue").length;
  const byType = collateralTypes.map((t) => ({ label: t, value: rows.filter((r) => r.type === t).reduce((a, r) => a + (r.mtm ?? r.marketValue), 0), meta: `${rows.filter((r) => r.type === t).length} items` }));

  const columns: DataTableColumn<Row>[] = [
    { id: "id", header: "Collateral", accessor: "id", sortable: true, cell: (r) => <span className="font-mono">{r.id}</span> },
    {
      id: "obligor",
      header: "Obligor / type",
      accessor: "obligorName",
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <span className="font-medium text-fg">{r.obligorName}</span>
          <Text variant="caption" tone="subtle">
            {r.type === "Quoted shares" ? `${r.type} · ${r.ticker} · ${number(r.units ?? 0)} units` : r.description === r.type ? r.type : `${r.type} · ${r.description}`}
          </Text>
        </Stack>
      ),
    },
    { id: "type", header: "Type", accessor: "type", hidden: true },
    { id: "mv", header: "Market value", accessor: (r) => r.mtm ?? r.marketValue, numeric: true, sortable: true, cell: (r) => moneyShort(r.mtm ?? r.marketValue) },
    { id: "fsv", header: "FSV", accessor: "forcedSaleValue", numeric: true, sortable: true, cell: (r) => (r.type === "Quoted shares" ? "MTM" : moneyShort(r.forcedSaleValue)) },
    {
      id: "haircut",
      header: "Haircut",
      accessor: "haircutPct",
      numeric: true,
      sortable: true,
      cell: (r) => (
        <Tooltip content={r.haircutSource}>
          <span className="font-mono">{r.haircutPct}%</span>
        </Tooltip>
      ),
    },
    {
      id: "adjusted",
      header: "Adjusted value",
      accessor: "adjusted",
      numeric: true,
      sortable: true,
      cell: (r) => (
        <Tooltip content={`${r.basis}: ${moneyShort(r.basisValue)} × (1 − ${r.haircutPct}%)${r.eligible ? "" : " — not eligible until perfected (CBN 12.13(a)(1))"}`}>
          <span className={r.eligible ? "font-mono" : "font-mono text-fg-subtle line-through"}>{moneyShort(r.adjusted)}</span>
        </Tooltip>
      ),
    },
    { id: "cover", header: "Cover", accessor: "cover", numeric: true, sortable: true, cell: (r) => (r.exposure > 0 ? pct(r.cover * 100, 0) : "—") },
    { id: "perfection", header: "Perfection", accessor: "perfection", sortable: true, cell: (r) => <StatusBadge status={r.perfection} tones={perfectionTones} /> },
    { id: "mo", header: "MO verification", accessor: (r) => r.verification.status, sortable: true, cell: (r) => <StatusBadge status={r.verification.status} tones={moTones} /> },
    { id: "reval", header: "Next revaluation", accessor: "nextRevaluation", hidden: true, cell: (r) => (r.type === "Quoted shares" ? "Daily (CSCS)" : date(r.nextRevaluation)) },
    { id: "alert", header: "Alert", accessor: "alert", sortable: true, cell: (r) => (r.alert === "None" ? <Text variant="small" tone="subtle">—</Text> : <StatusBadge status={r.alert} tones={{ [r.alert]: r.alert.includes("expiring") ? "warning" : "danger" }} />) },
  ];

  return (
    <ModulePage
      module="collateral"
      description="Collateral register — type, valuation, valuer, perfection status and haircut weighting. Quoted shares are valued from the SEC/CSCS connector."
      actions={
        can.manage ? (
          <Stack direction="horizontal" gap="small">
            <Button variant="secondary" iconBefore={<BellRing aria-hidden className="size-4" />} onClick={remind}>
              Send reminders
            </Button>
            <Button iconBefore={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
              Register collateral
            </Button>
          </Stack>
        ) : undefined
      }
    >
      <Stack gap="large">
        {message && <Alert tone="info">{message}</Alert>}
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Market value" value={moneyShort(totalMv)} hint={`${number(rows.length)} items · shares at MTM`} />
          <StatCard label="Forced-sale value" value={moneyShort(totalFsv)} hint="Independent valuers" />
          <StatCard
            label="Haircut-adjusted cover (perfected)"
            value={pct((adjEligible / exposure) * 100, 0)}
            hint={`${moneyShort(adjEligible)} eligible vs ${moneyShort(exposure)} secured exposure`}
            tone={adjEligible >= exposure ? "success" : "warning"}
          />
          <StatCard label="Action due" value={number(insuranceDue + revalDue)} hint={`${insuranceDue} insurance · ${revalDue} revaluation overdue`} tone="danger" />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Perfection status</CardTitle>
                <CardDescription>Search → documentation → registration → perfected.</CardDescription>
              </div>
            </CardHeader>
            <DonutChart
              label="Collateral by perfection status"
              centerLabel="Perfected"
              centerValue={pct((perfCounts[0]!.value / rows.length) * 100, 0)}
              segments={perfCounts.filter((p) => p.value > 0).map((p) => ({ label: p.label, value: p.value, tone: perfectionTones[p.label] }))}
            />
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Value by collateral type</CardTitle>
                <CardDescription>Market value (quoted shares at current mark-to-market).</CardDescription>
              </div>
            </CardHeader>
            <MiniBarList items={byType.filter((t) => t.value > 0)} limit={6} valueFormatter={(v) => moneyShort(v)} label="Collateral value by type" />
          </Card>
        </Grid>

        <SegmentedControl
          label="Show"
          size="small"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: `All collateral (${rows.length})` },
            { value: "mine", label: `Needs my action (${rows.filter(needsMe).length})` },
          ]}
        />
        <DataTable
          label="Collateral register"
          data={shown}
          columns={columns}
          getRowId={(r) => r.id}
          getRowHref={(r) => `/collateral/item?id=${r.id}`}
          linkComponent={Link}
          searchable
          searchPlaceholder="Search obligor, collateral or ticker"
          density="compact"
          filters={[
            { id: "type", label: "Type", columnId: "type" },
            { id: "perfection", label: "Perfection", columnId: "perfection" },
            { id: "mo", label: "MO verification", columnId: "mo" },
            { id: "alert", label: "Alert", columnId: "alert" },
          ]}
          exportFilename="collateral-register.csv"
          emptyState={<EmptyState title="No collateral matches" description="Clear the filters to see the full register." />}
          mobileCard={(r) => (
            <Stack gap="xsmall">
              <span className="font-medium text-fg">{r.obligorName}</span>
              <Text variant="small" tone="muted">
                {r.id} · {r.type} · {moneyShort(r.mtm ?? r.marketValue)}
              </Text>
              <Stack direction="horizontal" gap="small" wrap>
                <StatusBadge status={r.perfection} tones={perfectionTones} />
                <StatusBadge status={r.verification.status} tones={moTones} />
              </Stack>
            </Stack>
          )}
        />
      </Stack>
      {adding && <RegisterModal onClose={() => setAdding(false)} />}
    </ModulePage>
  );
}

function RegisterModal({ onClose }: { onClose: () => void }) {
  const facilities = useFacilities();
  const { obligor } = useLookups();
  const [error, setError] = useState<string | null>(null);
  const live = facilities.filter((f) => f.status === "Active" || f.status === "Pending disbursement");
  const [facilityId, setFacilityId] = useState(live[0]?.id ?? "");
  const [type, setType] = useState<CollateralType>("Legal mortgage");
  const [description, setDescription] = useState("");
  const [mv, setMv] = useState("");
  const [fsv, setFsv] = useState("");
  const [valuer, setValuer] = useState("");
  const fac = facilities.find((f) => f.id === facilityId);
  const valid = fac && description.trim() && Number(mv) > 0 && Number(fsv) > 0 && valuer.trim();
  const haircut = haircutFor({ type, description });
  const save = async () => {
    if (!fac) return;
    const r = registerCollateral({ facilityId: fac.id, type, description, marketValue: Number(mv), forcedSaleValue: Number(fsv), valuer });
    if (!r.ok) return setError(r.reason);
    // The opening valuation goes to Middle Office for independent verification (Operations workflow).
    const created = useDb.getState().collateral.find((c) => c.id === r.id);
    if (created) {
      const v = await requestVerification(created);
      if (!v.ok) return setError(v.reason);
    }
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Register collateral"
      description="Perfection starts at legal search. The valuation will be sent to Middle Office for independent verification."
      size="large"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            Register
          </Button>
        </>
      }
    >
      <Form onSubmit={(e) => (e.preventDefault(), valid && save())}>
        {error && (
          <Alert tone="danger" title="Not registered">
            {error}
          </Alert>
        )}
        <Grid columns={{ base: 1, md: 2 }} gap="medium">
          <Field label="Secures facility" htmlFor="col-fac" required>
            <Select id="col-fac" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} options={live.slice(0, 200).map((f) => ({ value: f.id, label: `${f.id} — ${obligor.get(f.obligorId)?.name} (${f.product})` }))} />
          </Field>
          <Field label="Collateral type" htmlFor="col-type" required description={`Haircut: ${haircut.pct}% (${haircut.prdCategory ? `${haircut.source} — ${haircut.prdCategory}` : "tenant parameter"})`}>
            <Select id="col-type" value={type} onChange={(e) => setType(e.target.value as CollateralType)} options={collateralTypes.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="Description" htmlFor="col-desc" required>
            <Input id="col-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Warehouse, 14 Creek Road, Apapa" />
          </Field>
          <Field label="Valuer" htmlFor="col-valuer" required description="Independent professional valuer for mortgage security (CBN 3.11).">
            <Input id="col-valuer" value={valuer} onChange={(e) => setValuer(e.target.value)} />
          </Field>
          <Field label="Open market value" htmlFor="col-mv" required>
            <Input id="col-mv" type="number" min={0} prefix="₦" value={mv} onChange={(e) => setMv(e.target.value)} />
          </Field>
          <Field label="Forced-sale value" htmlFor="col-fsv" required>
            <Input id="col-fsv" type="number" min={0} prefix="₦" value={fsv} onChange={(e) => setFsv(e.target.value)} />
          </Field>
        </Grid>
      </Form>
    </Modal>
  );
}
