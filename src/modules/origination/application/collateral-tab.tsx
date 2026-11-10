"use client";

import { getRule } from "@/lib/platform/rules";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Alert, Button, DataTable, Grid, StatCard, Stack, StatusBadge, Text, type DataTableColumn } from "@credigit/web-ui";
import type { Collateral } from "@/lib/data/types";
import { date, money, moneyShort, pct } from "@/lib/format";
import { collateralDueDiligenceDone, lendingValue } from "../logic";
import type { AppCtx } from "./context";

export const perfectionTones = { Perfected: "success", Registration: "info", Documentation: "info", "Search in progress": "warning", "Not started": "neutral", Defective: "danger" } as const;

export function CollateralTab({ c }: { c: AppCtx }) {
  const mv = c.collateral.reduce((s, x) => s + x.marketValue, 0);
  const fsv = c.collateral.reduce((s, x) => s + x.forcedSaleValue, 0);
  const dd = collateralDueDiligenceDone(c.collateral);
  const columns: DataTableColumn<Collateral>[] = [
    { id: "id", header: "ID", accessor: "id", cell: (x) => <span className="font-mono">{x.id}</span> },
    { id: "type", header: "Type", accessor: "type", sortable: true },
    { id: "description", header: "Description", accessor: "description" },
    { id: "mv", header: "Market value", accessor: "marketValue", numeric: true, sortable: true, cell: (x) => moneyShort(x.marketValue) },
    { id: "haircut", header: "Haircut", accessor: "haircutPct", numeric: true, cell: (x) => pct(x.haircutPct, 0) },
    { id: "lv", header: "Lending value", accessor: (x) => lendingValue(x), numeric: true, sortable: true, cell: (x) => moneyShort(lendingValue(x)) },
    { id: "valued", header: "Valued", accessor: "valuedAt", cell: (x) => `${date(x.valuedAt)} · ${x.valuer}` },
    { id: "perfection", header: "Perfection / search", accessor: "perfection", cell: (x) => <StatusBadge status={x.perfection} tones={perfectionTones} /> },
  ];
  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
        <StatCard label="Market value" value={moneyShort(mv)} hint={`${c.collateral.length} item(s) pledged`} />
        <StatCard label="Forced-sale value" value={moneyShort(fsv)} hint="Valuer's FSV" />
        <StatCard label="Lending value" value={moneyShort(c.lendingTotal)} hint="Market value less tenant haircut" />
        <StatCard label="Security cover" value={pct(c.coverage * 100, 0)} hint={`Lending value ÷ ${money(c.app.amount)}`} tone={c.coverage >= 1 ? "success" : c.coverage * 100 >= getRule<number>("origination.coverage.warnPct") ? "warning" : "danger"} icon={<ShieldCheck aria-hidden />} />
      </Grid>
      {!dd ? (
        <Alert tone="warning" title="Collateral due diligence outstanding">
          Legal has not completed the search on every pledged item. The BDM cannot submit until it is complete (PRD §6.1.1, step 3).
        </Alert>
      ) : null}
      <DataTable label="Pledged collateral" columns={columns} data={c.collateral} getRowId={(x) => x.id} paginate={false} emptyState={<Text tone="muted">No collateral pledged — unsecured request.</Text>} />
      <div>
        <Button as={Link} href="/collateral/" variant="tertiary" iconAfter={<ArrowRight aria-hidden />}>
          Collateral register
        </Button>
      </div>
    </Stack>
  );
}
