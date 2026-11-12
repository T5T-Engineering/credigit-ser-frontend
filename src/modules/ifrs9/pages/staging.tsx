"use client";

import { useMemo, useState } from "react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, type DataTableColumn, Grid, Matrix, Stack, StatCard, Text } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import type { CbnClass, Ifrs9Stage } from "@/lib/data/types";
import { date, pct } from "@/lib/format";
import { useCan } from "@/lib/auth/session";
import { CalcRegister, sum, type CalcSpec, ms } from "../common";
import { cbnDpdBands, cbnSpecificRate, generalProvisionRate, reportingPeriod, sicrTriggers, stageTransfers, type EclRow, type SicrTrigger, type StageTransfer } from "../data";
import { RulesPanel } from "../governance";
import { IFRS9_RULE_GROUPS } from "../platform";
import { EclDetailDrawer, EclTable, StageBadge } from "../parts";
import { useEcl } from "../use-ecl";

/** CBN classes with DPD bands and provisioning rates from the business rules (PRD §6.7.1). */
function cbnClasses(): { id: CbnClass; dpd: string; prov: string }[] {
  const b = cbnDpdBands();
  const rate = (c: CbnClass) => pct(cbnSpecificRate(c) * 100, 0);
  return [
    { id: "Performing", dpd: "Up to date", prov: `0% specific · general provision ${pct(generalProvisionRate() * 100, 2)} applies` },
    { id: "Watchlist", dpd: `${b.watchlist}–${b.substandard - 1} days or qualitative`, prov: "Not specifically provisioned; enhanced monitoring" },
    { id: "Substandard", dpd: `${b.substandard}–${b.doubtful - 1} days`, prov: `${rate("Substandard")} (CBN 12.2(a)(2)(i))` },
    { id: "Doubtful", dpd: `${b.doubtful}–${b.lost - 1} days`, prov: `${rate("Doubtful")} (CBN 12.2(a)(2)(ii))` },
    { id: "Lost", dpd: `${b.lost}+ days`, prov: `${rate("Lost")} (CBN 12.2(a)(2)(iii))` },
  ];
}
/** PRD §6.7.1 expected mapping. */
const EXPECTED: Record<CbnClass, Ifrs9Stage> = { Performing: 1, Watchlist: 2, Substandard: 3, Doubtful: 3, Lost: 3 };

export function Ifrs9StagingPage() {
  const { input, rows } = useEcl();
  const canEdit = useCan("ifrs9", "edit");
  const CLASSES = cbnClasses();
  const [open, setOpen] = useState<EclRow | null>(null);
  const [cell, setCell] = useState<{ row: string; column: string } | null>(null);
  const transfers = useMemo(() => stageTransfers(rows, input), [rows, input]);
  const triggers = useMemo(() => sicrTriggers(rows), [rows]);

  const cells = CLASSES.flatMap((c) =>
    ([1, 2, 3] as Ifrs9Stage[]).map((s) => {
      const r = rows.filter((x) => x.cbnClass === c.id && x.stage === s);
      const ead = sum(r.map((x) => x.ead));
      const expected = EXPECTED[c.id] === s;
      return {
        row: c.id,
        column: String(s),
        value: r.length,
        label: r.length ? (
          <span className="flex flex-col items-center leading-tight">
            <span className="font-mono font-bold">{r.length}</span>
            <span className="font-mono text-xs">{ms(ead)}</span>
          </span>
        ) : (
          "—"
        ),
        tone: (r.length === 0 ? "neutral" : expected ? (s === 1 ? "success" : s === 2 ? "warning" : "danger") : "info") as "neutral" | "success" | "warning" | "danger" | "info",
        description: `${r.length} facilities, EAD ${ms(ead)}${expected ? " — default mapping" : " — override / qualitative trigger"}`,
      };
    }),
  );
  const selected = cell ? rows.filter((r) => r.cbnClass === cell.row && String(r.stage) === cell.column) : rows;
  const mismatches = rows.filter((r) => EXPECTED[r.cbnClass] !== r.stage).length;

  const transferCols: DataTableColumn<StageTransfer>[] = [
    { id: "date", header: "Date", accessor: "date", cell: (t) => date(t.date) },
    { id: "facility", header: "Facility", accessor: "facilityId", cell: (t) => <span className="font-mono text-sm whitespace-nowrap">{t.facilityId}</span>, searchable: true },
    { id: "obligor", header: "Obligor", accessor: "obligorName", searchable: true },
    {
      id: "move",
      header: "Migration",
      accessor: (t) => `Stage ${t.from} → Stage ${t.to}`,
      cell: (t) => (
        <Stack direction="horizontal" gap="xsmall" align="center">
          <StageBadge stage={t.from} />
          <span aria-hidden>→</span>
          <StageBadge stage={t.to} />
        </Stack>
      ),
    },
    { id: "trigger", header: "Trigger", accessor: "trigger" },
    { id: "before", header: "ECL before", accessor: "eclBefore", numeric: true, cell: (t) => ms(t.eclBefore) },
    { id: "after", header: "ECL after", accessor: "eclAfter", numeric: true, cell: (t) => ms(t.eclAfter) },
    { id: "impact", header: "Impact", accessor: (t) => t.eclAfter - t.eclBefore, numeric: true, cell: (t) => ms(t.eclAfter - t.eclBefore) },
  ];
  const triggerCols: DataTableColumn<SicrTrigger>[] = [
    { id: "name", header: "Trigger", accessor: "name", cell: (t) => <span className="font-semibold text-fg">{t.name}</span> },
    { id: "kind", header: "Type", accessor: "kind", cell: (t) => <Badge tone={t.kind === "Default" ? "danger" : t.kind === "Backstop" ? "warning" : "info"}>{t.kind}</Badge> },
    { id: "rule", header: "Rule", accessor: "rule" },
    { id: "param", header: "Parameter", accessor: "parameter", cell: (t) => <span className="font-mono text-sm">{t.parameter}</span> },
    { id: "source", header: "Source", accessor: "source" },
    { id: "count", header: "Facilities hit", accessor: "count", numeric: true },
  ];

  const specs: CalcSpec[] = [
    {
      metric: "Stage assignment",
      formula: "Stage 3 if default definition met; else Stage 2 if any SICR trigger; else Stage 1",
      sources: "SICR triggers below (Rules & Parameters Engine)",
      prd: "§6.7.1",
    },
    {
      metric: "Transfer ECL impact",
      formula: "ECL(destination stage basis) − ECL(origin stage basis)",
      sources: "Same PD/LGD/EAD inputs re-priced on 12-month vs lifetime basis",
      value: ms(sum(transfers.map((t) => t.eclAfter - t.eclBefore))),
      prd: "§6.7.1",
    },
    {
      metric: "CBN specific provision",
      formula: `Sub-Standard ${pct(cbnSpecificRate("Substandard") * 100, 0)} · Doubtful ${pct(cbnSpecificRate("Doubtful") * 100, 0)} · Lost ${pct(cbnSpecificRate("Lost") * 100, 0)} of outstanding`,
      sources: "CBN classification by DPD (Loan Review)",
      prd: "§6.7.1",
    },
  ];

  return (
    <ModulePage module="ifrs9" description="IFRS 9 stages mapped against the CBN prudential classification, with the triggers that moved each exposure.">
      <Stack gap="large">
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Facilities staged" value={String(rows.length)} hint={`Month-end staging run · ${reportingPeriod()}`} />
          <StatCard label="Transfers this quarter" value={String(transfers.length)} hint={`${transfers.filter((t) => t.to > t.from).length} deteriorations`} tone="warning" />
          <StatCard label="ECL impact of transfers" value={ms(sum(transfers.map((t) => t.eclAfter - t.eclBefore)))} hint="12-month → lifetime re-pricing" />
          <StatCard label="Off-diagonal exposures" value={String(mismatches)} hint="Stage differs from the default CBN mapping" tone="info" />
        </Grid>

        <Grid columns={{ base: 1, lg: 12 }} gap="large">
          <Card variant="outlined" className="lg:col-span-7">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Staging matrix — CBN classification × IFRS 9 stage</CardTitle>
                <CardDescription>Count and EAD per cell. Select a cell to filter the facility list.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Matrix
                label="Staging matrix"
                rows={CLASSES.map((c) => ({ id: c.id, label: c.id, description: c.dpd }))}
                columns={[
                  { id: "1", label: "Stage 1", description: "12-month ECL" },
                  { id: "2", label: "Stage 2", description: "Lifetime ECL" },
                  { id: "3", label: "Stage 3", description: "Lifetime, credit-impaired" },
                ]}
                cells={cells}
                rowAxisLabel="CBN classification"
                columnAxisLabel="IFRS 9 stage"
                onCellClick={(c) => setCell((cur) => (cur?.row === c.row && cur.column === c.column ? null : { row: c.row, column: c.column }))}
                selected={cell}
                legend={[
                  { label: "Stage 1 (default mapping)", tone: "success" },
                  { label: "Stage 2", tone: "warning" },
                  { label: "Stage 3", tone: "danger" },
                  { label: "Override / qualitative", tone: "info" },
                ]}
              />
            </CardContent>
          </Card>
          <Card variant="filled" className="lg:col-span-5">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>mapping</CardTitle>
                <CardDescription>IFRS 9 stage, ECL basis and the CBN provisioning comparison.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap="small">
                {CLASSES.map((c) => (
                  <Stack key={c.id} direction="horizontal" justify="between" align="start" gap="medium">
                    <Stack gap="none">
                      <Text variant="small" className="font-semibold text-fg">
                        {c.id}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {c.dpd} · {c.prov}
                      </Text>
                    </Stack>
                    <StageBadge stage={EXPECTED[c.id]} />
                  </Stack>
                ))}
                <Text variant="caption" tone="muted">
                  Specialised-loan overlays (CBN Annexures 2–6) apply product-specific day thresholds from the Rules &amp; Parameters Engine.
                </Text>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Significant-increase-in-credit-risk (SICR) triggers</CardTitle>
              <CardDescription>Tenant-configurable in the Rules &amp; Parameters Engine; the same triggers run in reverse for declassification.</CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <DataTable label="SICR triggers" columns={triggerCols} data={triggers} getRowId={(t) => t.id} paginate={false} />
          </CardContent>
        </Card>

        <RulesPanel title="Staging triggers (business rules)" keys={IFRS9_RULE_GROUPS.staging} canRequest={canEdit} />

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Stage transfers — this quarter</CardTitle>
              <CardDescription>Every migration with its trigger and ECL re-pricing; reportable on the CRO Dashboard.</CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Stage transfers"
              columns={transferCols}
              data={transfers}
              getRowId={(t) => t.id}
              searchable
              defaultSort={{ id: "date", direction: "desc" }}
              exportFilename="ifrs9-stage-transfers"
              filters={[{ id: "move", label: "Migration", columnId: "move" }]}
              emptyState={<Text tone="muted">No stage transfers this quarter.</Text>}
              mobileCard={(t) => (
                <Stack gap="xsmall">
                  <Text variant="small" className="font-semibold text-fg">
                    {t.obligorName} · Stage {t.from} → {t.to}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {date(t.date)} · {t.trigger}
                  </Text>
                  <Text variant="small" className="font-mono">
                    ECL {ms(t.eclBefore)} → {ms(t.eclAfter)}
                  </Text>
                </Stack>
              )}
            />
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>{cell ? `${cell.row} · Stage ${cell.column}` : "All staged facilities"}</CardTitle>
              <CardDescription>
                {selected.length} facilities · EAD {ms(sum(selected.map((r) => r.ead)))} · coverage{" "}
                {pct((sum(selected.map((r) => r.ecl)) / Math.max(1, sum(selected.map((r) => r.ead)))) * 100, 2)}
              </CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <EclTable rows={selected} onOpen={setOpen} label="Staged facilities" />
          </CardContent>
        </Card>

        <CalcRegister specs={specs} />
      </Stack>
      <EclDetailDrawer row={open} onClose={() => setOpen(null)} />
    </ModulePage>
  );
}
