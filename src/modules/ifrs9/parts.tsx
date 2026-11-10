"use client";

import { Badge, DataTable, type DataTableColumn, DescriptionList, Drawer, Stack, StatusBadge, Text, riskStatusTones } from "@credigit/web-ui";
import { ms } from "./common";
import { money, pct } from "@/lib/format";
import { CCF_GUARANTEE, CCF_REVOLVING, FLI_OVERLAY, RECOVERY_DISCOUNT, stageTone, type EclRow } from "./data";

export const cbnTones = { ...riskStatusTones, Performing: "success", Watchlist: "warning", Substandard: "warning", Doubtful: "danger", Lost: "danger" } as const;

export function StageBadge({ stage }: { stage: 1 | 2 | 3 }) {
  return <Badge tone={stageTone[stage]}>Stage {stage}</Badge>;
}

/** Facility-level ECL table (shared by overview and staging). */
export function EclTable({ rows, onOpen, label = "Facility-level ECL" }: { rows: EclRow[]; onOpen: (r: EclRow) => void; label?: string }) {
  const columns: DataTableColumn<EclRow>[] = [
    { id: "id", header: "Facility", accessor: "id", cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.id}</span>, searchable: true },
    { id: "obligor", header: "Obligor", accessor: (r) => r.obligor?.name ?? "—", searchable: true },
    { id: "sector", header: "Sector", accessor: "sector" },
    { id: "product", header: "Product", accessor: (r) => r.facility.product, hidden: true },
    { id: "stage", header: "Stage", accessor: (r) => `Stage ${r.stage}`, cell: (r) => <StageBadge stage={r.stage} />, sortValue: (r) => r.stage },
    { id: "cbn", header: "CBN class", accessor: "cbnClass", cell: (r) => <StatusBadge status={r.cbnClass} tones={cbnTones} /> },
    { id: "dpd", header: "DPD", accessor: (r) => r.facility.dpd, numeric: true },
    { id: "ead", header: "EAD", accessor: "ead", numeric: true, cell: (r) => ms(r.ead) },
    { id: "pd", header: "PD", accessor: "pd", numeric: true, cell: (r) => pct(r.pd * 100, 2) },
    { id: "lgd", header: "LGD", accessor: "lgd", numeric: true, cell: (r) => pct(r.lgd * 100, 1) },
    { id: "ecl", header: "ECL", accessor: "ecl", numeric: true, cell: (r) => ms(r.ecl) },
    { id: "prud", header: "CBN provision", accessor: "prudential", numeric: true, cell: (r) => ms(r.prudential) },
  ];
  return (
    <DataTable
      label={label}
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      searchable
      searchPlaceholder="Search facility or obligor"
      filters={[
        { id: "stage", label: "Stage", columnId: "stage" },
        { id: "cbn", label: "CBN class", columnId: "cbn" },
        { id: "sector", label: "Sector", columnId: "sector" },
      ]}
      defaultSort={{ id: "ecl", direction: "desc" }}
      onRowClick={(r) => onOpen(r)}
      exportFilename="ifrs9-ecl-facilities"
      mobileCard={(r) => (
        <Stack gap="xsmall">
          <Stack direction="horizontal" justify="between" align="center">
            <Text variant="small" className="font-semibold text-fg">
              {r.obligor?.name}
            </Text>
            <StageBadge stage={r.stage} />
          </Stack>
          <Text variant="caption" tone="muted">
            {r.id} · {r.sector} · {r.cbnClass}
          </Text>
          <Text variant="small" className="font-mono">
            EAD {ms(r.ead)} · ECL {ms(r.ecl)}
          </Text>
        </Stack>
      )}
    />
  );
}

/** Drill-down: every input of one facility's ECL, with the formula applied to its numbers. */
export function EclDetailDrawer({ row, onClose }: { row: EclRow | null; onClose: () => void }) {
  const f = row?.facility;
  return (
    <Drawer open={!!row} onOpenChange={(o) => !o && onClose()} title={row ? `${row.id} · ${row.obligor?.name ?? ""}` : ""} description="ECL = PD × LGD × EAD (PRD §8)" size="large">
      {row && f && (
        <Stack gap="large">
          <DescriptionList
            columns={2}
            items={[
              { label: "IFRS 9 stage", value: <StageBadge stage={row.stage} /> },
              { label: "CBN classification", status: row.cbnClass, statusTones: cbnTones },
              { label: "Product", value: f.product },
              { label: "Days past due", value: String(f.dpd), mono: true },
              { label: "ECL basis", value: row.basis },
              { label: "Remaining tenor", value: `${row.remainingYears.toFixed(2)} years`, mono: true },
            ]}
          />
          <Stack gap="small">
            <Text variant="eyebrow">Exposure at default</Text>
            <DescriptionList
              columns={2}
              items={[
                {
                  label: "Outstanding principal (NGN eq.)",
                  value: money(row.outstanding),
                  mono: true,
                  hint: f.currency === "USD" ? "USD revalued at the configured spot rate" : "CBA facility ledger",
                },
                { label: "Accrued interest", value: money(row.accrued), mono: true, hint: "Outstanding × rate × (min(DPD, 90) + 30) / 365" },
                {
                  label: "Undrawn × CCF",
                  value: money(row.undrawnCcf),
                  mono: true,
                  hint: `Overdraft/revolving CCF ${CCF_REVOLVING * 100}% · guarantees ${CCF_GUARANTEE * 100}% (demo)`,
                },
                { label: "EAD", value: money(row.ead), mono: true },
              ]}
            />
          </Stack>
          <Stack gap="small">
            <Text variant="eyebrow">Probability of default</Text>
            <DescriptionList
              columns={2}
              items={[
                { label: "Internal risk grade", value: String(row.obligor?.riskGrade ?? "—"), mono: true },
                { label: "Forward-looking overlay", value: `× ${FLI_OVERLAY.toFixed(3)}`, mono: true, hint: "Probability-weighted macro scenarios" },
                { label: "12-month PD", value: pct(row.pd12 * 100, 2), mono: true },
                { label: "Lifetime PD", value: pct(row.pdLifetime * 100, 2), mono: true, hint: "1 − (1 − PD₁₂)^remaining years" },
                { label: "PD applied", value: pct(row.pd * 100, 2), mono: true, hint: row.stage === 3 ? "Credit-impaired: PD = 100%" : row.basis },
              ]}
            />
          </Stack>
          <Stack gap="small">
            <Text variant="eyebrow">Loss given default</Text>
            <DescriptionList
              columns={2}
              items={[
                {
                  label: "Collateral recovery",
                  value: money(row.recovery),
                  mono: true,
                  hint: `Perfected FSV (MTM for quoted shares) × (1 − haircut) × ${RECOVERY_DISCOUNT} work-out discount`,
                },
                { label: "LGD", value: pct(row.lgd * 100, 1), mono: true, hint: "1 − recovery / EAD, floor 10%, unsecured cap 75% (demo)" },
              ]}
            />
          </Stack>
          <Stack gap="small">
            <Text variant="eyebrow">Result</Text>
            <DescriptionList
              columns={2}
              items={[
                { label: "ECL", value: money(row.ecl), mono: true, hint: `${pct(row.pd * 100, 2)} × ${pct(row.lgd * 100, 1)} × ${ms(row.ead)}` },
                { label: "CBN prudential provision", value: money(row.prudential), mono: true, hint: row.prudentialBasis },
                { label: "IFRS 9 − prudential", value: money(row.ecl - row.prudential), mono: true },
              ]}
            />
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}
