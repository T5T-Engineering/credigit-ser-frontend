"use client";

import type { Dispatch, SetStateAction } from "react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, Input, ProgressBar, Stack, Text, Tooltip, type DataTableColumn } from "@credigit/web-ui";
import { date } from "@/lib/format";
import { bandOf, type Assessment, type ParameterReading } from "../logic";
import { cardinalPoints, isEnrichable } from "../parameters";

type Props = {
  a: Assessment;
  editing: boolean;
  draft: Record<string, string>;
  setDraft: Dispatch<SetStateAction<Record<string, string>>>;
};

/** Tone by interpretive band (business rules `credit-analysis.band.*`). */
const scoreTone = (s: number) => ({ High: "success", Medium: "info", Low: "danger" } as const)[bandOf(s)];

export function ParametersTab({ a, editing, draft, setDraft }: Props) {
  const columns: DataTableColumn<ParameterReading>[] = [
    {
      id: "name",
      header: "Parameter",
      accessor: (r) => r.param.name,
      width: "22%",
      cell: (r) => (
        <span className="flex flex-col gap-1">
          <span className="font-semibold text-fg">{r.param.name}</span>
          <span className="font-mono text-xs text-fg-muted">
            {r.param.id} · {r.param.direction}
          </span>
        </span>
      ),
    },
    {
      id: "observed",
      header: "Reading",
      accessor: (r) => r.observed ?? "",
      width: "16%",
      cell: (r) => (
        <span className="flex flex-col gap-1">
          <span className="font-mono text-sm text-fg">{r.observed ?? "—"}</span>
          <span className="text-xs text-fg-muted">
            {r.param.observed?.measure ?? (r.param.sectorPinned === "lifecycle" ? "NGX sector stage (AI trend engine)" : "Analyst-scored (survey / questionnaire)")}
          </span>
        </span>
      ),
    },
    {
      id: "score",
      header: "Score",
      accessor: (r) => r.score,
      width: editing ? "15%" : "13%",
      cell: (r) => {
        const enrichable = isEnrichable(r.param);
        if (editing && enrichable) {
          return (
            <span className="flex flex-col gap-1">
              <Input
                type="number"
                min={1}
                max={10}
                step={0.1}
                size="small"
                aria-label={`${r.param.name} score`}
                value={draft[r.param.id] ?? r.score.toFixed(1)}
                onChange={(e) => setDraft((d) => ({ ...d, [r.param.id]: e.target.value }))}
                suffix="/10"
              />
              <span className="font-mono text-xs text-fg-muted">System {r.base.toFixed(1)}</span>
            </span>
          );
        }
        return (
          <span className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="font-mono text-base font-semibold text-fg">{r.score.toFixed(1)}</span>
              {r.override && (
                <Tooltip content={`${r.override.by}: ${r.override.rationale || "No rationale recorded"} (system ${r.base.toFixed(1)})`}>
                  <span>
                    <Badge tone="accent" size="small">
                      Analyst-adjusted
                    </Badge>
                  </span>
                </Tooltip>
              )}
            </span>
            <ProgressBar value={r.score / 10} tone={scoreTone(r.score)} size="small" ariaLabel={`${r.param.name} score ${r.score.toFixed(1)} of 10`} />
            {editing && !enrichable && <span className="text-xs text-fg-muted">System-fed only</span>}
          </span>
        );
      },
    },
    {
      id: "lineage",
      header: "Data lineage",
      accessor: (r) => `${r.param.systemSource ?? ""} ${r.param.enrichmentSource ?? ""}`,
      csv: (r) => `System: ${r.param.systemSource ?? "—"} | Analyst: ${r.param.enrichmentSource ?? "—"}`,
      cell: (r) => (
        <span className="flex flex-col gap-1.5 text-sm">
          <span>
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-fg-subtle">System · </span>
            <span className="text-fg-muted">{r.param.systemSource ?? "— no reliable systems feed"}</span>
          </span>
          <span>
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-fg-subtle">Analyst · </span>
            <span className="text-fg-muted">{r.param.enrichmentSource ?? "—"}</span>
          </span>
        </span>
      ),
    },
    {
      id: "updated",
      header: "Last updated",
      accessor: (r) => r.updatedAt,
      width: "10%",
      cell: (r) => <span className="font-mono text-sm">{date(r.updatedAt)}</span>,
    },
  ];
  const scoreColumn = columns.find((c) => c.id === "score")!;

  return (
    <Stack gap="large">
      <Text tone="muted">
        Every parameter states its scoring direction, the live system feed behind the number, and the analyst enrichment / survey source. Parameters are scored 1–10
        against tenant-configurable bands (demo: linear bands shown in “Reading”) and averaged with tenant-configurable weighting (default: equal).
      </Text>
      {cardinalPoints.map((cp) => {
        const res = a.points[cp.key];
        const adjusted = res.readings.filter((r) => r.override).length;
        return (
          <Card key={cp.key}>
            <CardHeader>
              <div>
                <CardTitle>
                  {cp.direction} — {cp.label}
                </CardTitle>
                <CardDescription>
                  {cp.nature} cardinal point · feeds the {cp.composite}-Composite · {res.readings.length} parameters
                  {adjusted ? ` · ${adjusted} analyst-adjusted` : ""}
                </CardDescription>
              </div>
              <span className="flex flex-col items-end gap-1">
                <span className="font-mono text-2xl font-bold text-fg">{(cp.key === "internal" ? a.scores.internal : res.average).toFixed(1)}</span>
                <span className="font-mono text-xs text-fg-muted">
                  {cp.key === "internal" ? `avg ${a.internalRaw.toFixed(1)} − overlay ${a.overlayPenalty.toFixed(1)}` : "equal-weighted average"}
                </span>
              </span>
            </CardHeader>
            <CardContent>
              <DataTable
                label={`${cp.label} parameters`}
                columns={columns}
                data={res.readings}
                getRowId={(r) => r.param.id}
                paginate={false}
                density="compact"
                exportFilename={`${a.obligor.id}-${cp.key}-parameters.csv`}
                mobileCard={(r) => (
                  <span className="flex flex-col gap-1">
                    <span className="font-semibold text-fg">{r.param.name}</span>
                    {/* Edit mode must work on phones too: show the same score input as the desktop "Score" column. */}
                    {editing && isEnrichable(r.param) ? (
                      scoreColumn.cell!(r)
                    ) : (
                      <span className="font-mono text-sm">
                        {r.score.toFixed(1)} / 10 · {r.observed ?? "Analyst-scored"}
                      </span>
                    )}
                    <span className="text-xs text-fg-muted">{r.param.systemSource ?? r.param.enrichmentSource}</span>
                  </span>
                )}
              />
              {cp.key === "internal" && (
                <Text variant="small" tone="muted" className="mt-3">
                  Confidence Overlay (COP Ratio band) — scoring direction “Low confidence dampens the whole axis score”. System source: CBA statement of account + other-bank
                  statements, reconciled excluding inter-branch/suspense, in-and-out and reversal entries. Analyst source: documented customer explanation where the COP
                  Ratio falls below the High-Confidence band. Current: COP {a.cop.toFixed(2)} · {a.copBand.band} · −{a.overlayPenalty.toFixed(1)}.
                </Text>
              )}
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
