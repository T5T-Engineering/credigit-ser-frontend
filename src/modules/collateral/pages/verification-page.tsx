"use client";

/** Valuation verification queue — Middle Office independent verification of collateral valuations (PRD §4.1, §6.5). */
import { useMemo } from "react";
import Link from "next/link";
import { Alert, Badge, DataTable, EmptyState, Grid, Stack, StatCard, StatusBadge, Text, TextLink, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useLookups } from "@/lib/data/hooks";
import { date, dateTime, moneyShort, number } from "@/lib/format";
import { canDecide, useOperationsStore, type OperationInstance } from "@/lib/platform/operations";
import { useScope } from "@/lib/platform/scope";
import { moTones } from "../data";
import { collateralAbilities } from "../logic";
import { collateralHref } from "../service";
import { useCollateralView, type CollateralView } from "../store";

type Row = CollateralView & { obligorName: string; op?: OperationInstance; awaitingMe: boolean };

export function VerificationPage() {
  const view = useCollateralView();
  const { obligor } = useLookups();
  const { actor, role } = useScope();
  const can = collateralAbilities(role?.id);
  const instances = useOperationsStore((s) => s.instances);

  const openOps = useMemo(() => {
    const m = new Map<string, OperationInstance>();
    for (const i of instances) if (i.operationType === "collateral.valuation.verify" && ["Pending", "In progress"].includes(i.status) && !m.has(i.subject.id)) m.set(i.subject.id, i);
    return m;
  }, [instances]);

  const rows: Row[] = useMemo(
    () =>
      view
        .filter((c) => c.verification.status !== "Verified" || openOps.has(c.id))
        .map((c) => {
          const op = openOps.get(c.id);
          return { ...c, obligorName: obligor.get(c.obligorId)?.name ?? c.obligorId, op, awaitingMe: !!op && canDecide(op, actor).ok };
        }),
    [view, obligor, openOps, actor],
  );

  const verified = view.filter((c) => c.verification.status === "Verified").length;
  const queried = rows.filter((r) => r.verification.status === "Queried").length;
  const mine = rows.filter((r) => r.awaitingMe).length;

  const columns: DataTableColumn<Row>[] = [
    { id: "id", header: "Collateral", accessor: "id", sortable: true, cell: (r) => <span className="font-mono">{r.id}</span> },
    {
      id: "obligor",
      header: "Obligor / security",
      accessor: "obligorName",
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <span className="font-medium text-fg">{r.obligorName}</span>
          <Text variant="caption" tone="subtle">
            {r.type} · {r.description}
          </Text>
        </Stack>
      ),
    },
    { id: "mv", header: "Market value", accessor: "marketValue", numeric: true, sortable: true, cell: (r) => moneyShort(r.marketValue) },
    { id: "fsv", header: "FSV", accessor: "forcedSaleValue", numeric: true, sortable: true, cell: (r) => moneyShort(r.forcedSaleValue) },
    { id: "valuer", header: "Valuer", accessor: "valuer", sortable: true, cell: (r) => <Stack gap="none"><span>{r.valuer}</span><Text variant="caption" tone="subtle">{date(r.valuedAt)}</Text></Stack> },
    { id: "status", header: "Verification", accessor: (r) => r.verification.status, sortable: true, cell: (r) => <StatusBadge status={r.verification.status} tones={moTones} /> },
    {
      id: "op",
      header: "Operation",
      accessor: (r) => r.op?.id ?? "",
      cell: (r) =>
        r.op ? (
          <Stack gap="xsmall">
            <TextLink as={Link} href={`/operations/item?id=${encodeURIComponent(r.op.id)}`}>
              {r.op.id}
            </TextLink>
            <Text variant="caption" tone="subtle">
              {r.op.requestedBy.name} · {dateTime(r.op.requestedAt)}
            </Text>
            {r.awaitingMe && <Badge tone="accent">Awaiting me</Badge>}
          </Stack>
        ) : (
          <Text variant="small" tone="subtle">
            {r.verification.status === "Queried" ? "Queried — awaiting revised valuation" : "Not yet sent for verification"}
          </Text>
        ),
    },
    { id: "note", header: "Note", accessor: (r) => r.verification.note ?? "", hidden: true },
  ];

  return (
    <ModulePage module="collateral" description="Independent Middle Office verification of collateral valuations before they are relied on for haircut-adjusted cover. Approvals run through the Operations workflow — approve to verify, reject to query.">
      <Stack gap="large">
        {can.verify && mine > 0 && (
          <Alert tone="info" title={`${mine} valuation${mine === 1 ? "" : "s"} awaiting your verification`}>
            Open a record to review the valuation report, or decide in Operations → Approvals.
          </Alert>
        )}
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Awaiting verification" value={number(openOps.size)} hint="Open Operations requests" tone="info" />
          <StatCard label="Awaiting me" value={number(mine)} hint={role?.name} tone="accent" />
          <StatCard label="Queried" value={number(queried)} hint="Returned to Collateral Management" tone="warning" />
          <StatCard label="Verified" value={number(verified)} hint={`of ${number(view.length)} collateral items`} tone="success" />
        </Grid>
        <DataTable
          label="Valuation verification queue"
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          getRowHref={(r) => collateralHref(r.id, "valuation")}
          linkComponent={Link}
          searchable
          density="compact"
          defaultSort={{ id: "status", direction: "asc" }}
          filters={[
            { id: "status", label: "Verification", columnId: "status" },
            { id: "mine", label: "Scope", options: [{ value: "mine", label: "Awaiting me" }], filterFn: (r, v) => v !== "mine" || r.awaitingMe },
          ]}
          exportFilename="valuation-verification.csv"
          emptyState={<EmptyState title="Nothing to verify" description="Every valuation has been independently verified." />}
        />
      </Stack>
    </ModulePage>
  );
}
