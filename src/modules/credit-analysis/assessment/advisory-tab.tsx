"use client";

import { useMemo, useState } from "react";
import {
  AiDraftPanel,
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  Grid,
  List,
  Matrix,
  SegmentedControl,
  Stack,
  Text,
  type MatrixCell,
} from "@credigit/web-ui";
import { useDbActions } from "@/lib/data/hooks";
import { useRole, useSession } from "@/lib/auth/session";
import type { Posture } from "@/lib/data/types";
import { dateTime } from "@/lib/format";
import { CORPUS_VERSION, type WalletData } from "../data";
import {
  bandRange,
  bands,
  cellNarrative,
  draftAdvisory,
  flipCandidates,
  interpretiveTables,
  overlayGuidance,
  postureGuidance,
  type Assessment,
  type GatingCheck,
  type InterpretiveCell,
  type RatioBenchmark,
  type RatioTrend,
} from "../logic";
import { cardinalByKey } from "../parameters";
import { useAdvisorySignOff, useCreditAnalysis } from "../store";
import { postureOrder } from "../shared";
import { postureTone } from "@/lib/rar";

type Props = {
  a: Assessment;
  cell: InterpretiveCell | null;
  wallet: WalletData;
  benchmarks: RatioBenchmark[];
  trends: RatioTrend[];
  gating: GatingCheck[];
  canEdit: boolean;
  editing: boolean;
};

const cellTone = (r: number, c: number) => (r + c >= 3 ? "success" : r + c === 2 ? "info" : r + c === 1 ? "warning" : "danger");

export function AdvisoryTab({ a, cell, wallet, benchmarks, trends, gating, canEdit, editing }: Props) {
  const p = a.position;
  const [table, setTable] = useState<Posture>(p.base);
  const signOff = useAdvisorySignOff(a.obligor.id);
  const signAdvisory = useCreditAnalysis((s) => s.signAdvisory);
  const user = useSession((s) => s.user);
  const role = useRole();
  const { log } = useDbActions();

  const draft = useMemo(
    () =>
      draftAdvisory({
        a,
        cell: cell ?? {
          posture: p.base,
          rowKey: "internal",
          colKey: "comparative",
          rowBand: "Medium",
          colBand: "Medium",
          name: "",
          narrative: "",
          prd: "",
        },
        wallet,
        benchmarks,
        trends,
        gating,
      }),
    [a, cell, p.base, wallet, benchmarks, trends, gating],
  );
  const flips = useMemo(() => (p.intensity === "Marginally" ? flipCandidates(a) : []), [a, p.intensity]);

  const t = interpretiveTables[table];
  const cells: MatrixCell[] = bands.flatMap((rb, ri) =>
    bands.map((cb, ci) => ({
      row: rb,
      column: cb,
      label: t.cells[ri]![ci]!,
      tone: cellTone(ri, ci),
      description: cellNarrative(t.rows, rb, t.columns, cb),
    })),
  );
  const activeHere = cell && cell.posture === table ? { row: cell.rowBand, column: cell.colBand } : null;
  const stale = signOff && signOff.postureLabel !== p.label;

  function accept(text: string) {
    const at = new Date().toISOString();
    signAdvisory(a.obligor.id, {
      text,
      signedOffBy: user?.name ?? "Credit Analyst",
      at,
      postureLabel: p.label,
    });
    log({
      actorId: user?.id ?? "demo",
      actorName: user?.name ?? "Demo user",
      roleId: role?.id ?? "credit-analyst",
      action: "Signed off 360 RAR advisory note",
      entityType: "Obligor",
      entityId: a.obligor.id,
      before: signOff ? `Previous sign-off ${signOff.at.slice(0, 10)}` : "AI-drafted (unsigned)",
      after: `${p.label} · ${text.length} chars${text !== draft ? " · edited by analyst" : ""}`,
    });
  }

  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, lg: 2 }} gap="large">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recommended outcome</CardTitle>
              <CardDescription>Base posture stance with intensity and axis-dominance overlays (§6.2.6)</CardDescription>
            </div>
            {p.neutral ? (
              <Badge>Neutral / Transitional</Badge>
            ) : (
              <Badge tone={postureTone[p.base]}>
                {p.base} · {postureGuidance[p.base].rule}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {p.neutral ? (
              <Stack gap="medium">
                <Alert tone="warning" title="No posture-driven stance">
                  {overlayGuidance.Neutral}
                </Alert>
              </Stack>
            ) : (
              <DescriptionList
                columns={1}
                items={[
                  {
                    label: "System-generated credit recommendation",
                    value: postureGuidance[p.base].recommendation,
                  },
                  {
                    label: "Front-office advisory talking points",
                    value: postureGuidance[p.base].talkingPoints,
                  },
                  {
                    label: `${p.intensity!.replace("ly", "")} intensity overlay`,
                    value: overlayGuidance[p.intensity!],
                  },
                  {
                    label: `${p.lead} overlay`,
                    value: overlayGuidance[p.lead],
                  },
                ]}
              />
            )}
            {flips.length > 0 && (
              <div className="mt-4">
                <Text variant="eyebrow" as="p">
                  Closest to flipping the posture
                </Text>
                <List
                  className="mt-2"
                  items={flips.map((f) => (
                    <span key={f.reading.param.id}>
                      <strong>{f.reading.param.name}</strong> ({cardinalByKey[f.reading.param.point].short}, {f.reading.score.toFixed(1)}) — a move of{" "}
                      <span className="font-mono">
                        {f.move > 0 ? "+" : ""}
                        {f.move.toFixed(1)}
                      </span>{" "}
                      crosses the {f.axis}-midpoint
                    </span>
                  ))}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>36-cell interpretive layer</CardTitle>
              <CardDescription>
                {cardinalByKey[t.rows].short} (rows) × {cardinalByKey[t.columns].short} (columns), banded Low 1–3 · Medium 4–7 · High 8–10 · PRD {t.prd}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              <SegmentedControl
                label="Posture table"
                size="small"
                options={postureOrder.map((x) => ({ value: x, label: x }))}
                value={table}
                onChange={(v) => setTable(v as Posture)}
              />
              <Matrix
                label={`${table} interpretive table`}
                rows={bands.map((b) => ({
                  id: b,
                  label: `${b} (${bandRange[b]})`,
                }))}
                columns={bands.map((b) => ({
                  id: b,
                  label: `${b} (${bandRange[b]})`,
                }))}
                rowAxisLabel={cardinalByKey[t.rows].short}
                columnAxisLabel={cardinalByKey[t.columns].short}
                cells={cells}
                selected={activeHere}
                cellSize="small"
                legend={false}
              />
              {cell ? (
                <Text variant="small" tone="muted">
                  Active cell: <strong>{cell.name}</strong> ({cardinalByKey[cell.rowKey].short} {a.scores[cell.rowKey].toFixed(1)} = {cell.rowBand},{" "}
                  {cardinalByKey[cell.colKey].short} {a.scores[cell.colKey].toFixed(1)} = {cell.colBand}). {cell.narrative}. Drafting assistance only; it does not change the
                  posture classification.
                </Text>
              ) : (
                <Text variant="small" tone="muted">
                  Neutral / Transitional obligors have no posture, so no interpretive cell applies. Tables are shown for reference.
                </Text>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      {gating.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Industry Life-Cycle credit gating</CardTitle>
              <CardDescription>Open requests cross-checked against the sector’s life-cycle stage (mandatory system control, §6.2.6)</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <List
              items={gating.map((g) => (
                <span key={g.applicationId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{g.applicationId}</span> {g.purpose} · {g.tenorMonths} months · stage {g.stage ?? "n/a"}
                  {g.flagged ? <Badge tone="danger">Hard exception — CCO/CRO override</Badge> : <Badge tone="success">Passes gating rule</Badge>}
                  {g.analystNote && <Badge tone="warning">Mandatory analyst note — Conservative posture, {g.stage} industry</Badge>}
                </span>
              ))}
            />
          </CardContent>
        </Card>
      )}

      {stale && (
        <Alert tone="warning" title="Signed-off note predates the current posture">
          Signed off as “{signOff.postureLabel}”; the assessment now reads “{p.label}”. Review the refreshed draft and sign off again.
        </Alert>
      )}
      <AiDraftPanel
        key={`${p.label}-${signOff?.at ?? "draft"}`}
        kind="drafted"
        title="Advisory note — credit analyst to relationship manager"
        model="Credigit Risk Copilot (simulated)"
        generatedAt={dateTime(a.refreshedAt)}
        confidence={a.copBand.band === "High Confidence" ? 0.86 : a.copBand.band === "Medium Confidence" ? 0.74 : 0.61}
        draft={signOff && !stale ? signOff.text : draft}
        defaultEditing={p.neutral && canEdit && !signOff}
        onAccept={canEdit && !editing ? accept : undefined}
        signedOffBy={signOff && !stale ? `${signOff.signedOffBy} · ${dateTime(signOff.at)}` : undefined}
        signOffNote={
          canEdit
            ? "AI output is advisory. The Credit Analyst reviews, edits and signs off before the note is used in the credit memo or shared with the front office."
            : "AI-drafted and view-only for your role — a Credit Analyst must sign it off before use."
        }
        sources={[
          {
            label: "360 RAR parameter scores",
            detail: `Risk Data Spine · refreshed ${dateTime(a.refreshedAt)}`,
          },
          {
            label: "NGX Historical Sector Financials Corpus",
            detail: a.ngx ? `${CORPUS_VERSION} · ${a.ngx.name}` : "No listed proxy for this sector",
          },
          {
            label: "COP Ratio & Share of Business Wallet",
            detail: "CBA + other-bank statements (§5.1, §5.3), bureau/CRMS (§5.2)",
          },
          {
            label: "Posture & interpretive tables",
            detail: "PRD §6.2.5, §6.2.6, §6.2.12",
          },
        ]}
      />
    </Stack>
  );
}
