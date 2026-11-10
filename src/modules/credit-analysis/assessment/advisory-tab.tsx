"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AiDraftPanel,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  Field,
  Grid,
  List,
  Matrix,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  type MatrixCell,
} from "@credigit/web-ui";
import { usePendingFor } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import type { Obligor, Posture } from "@/lib/data/types";
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
  postureRule,
  type Assessment,
  type GatingCheck,
  type InterpretiveCell,
  type RatioBenchmark,
  type RatioTrend,
} from "../logic";
import { cardinalByKey } from "../parameters";
import { useAdvisorySignOff, useGatingOverrides, type GatingOverride } from "../store";
import { requestGatingOverride, submitAdvisorySignOff, SUBJECT_ADVISORY, SUBJECT_GATING } from "../actions";
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
  /** Approved (committed) posture label — what a sign-off is recorded against. */
  committedLabel: string;
};

const cellTone = (r: number, c: number) => (r + c >= 3 ? "success" : r + c === 2 ? "info" : r + c === 1 ? "warning" : "danger");

export function AdvisoryTab({ a, cell, wallet, benchmarks, trends, gating, canEdit, editing, committedLabel }: Props) {
  const p = a.position;
  const [table, setTable] = useState<Posture>(p.base);
  const signOff = useAdvisorySignOff(a.obligor.id);
  const pendingSignOff = usePendingFor(SUBJECT_ADVISORY, a.obligor.id);
  const gatingOverrides = useGatingOverrides();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const confHigh = useRule<number>("credit-analysis.advisory.confidenceHigh");
  const confMedium = useRule<number>("credit-analysis.advisory.confidenceMedium");
  const confLow = useRule<number>("credit-analysis.advisory.confidenceLow");

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

  async function accept(text: string) {
    const res = await submitAdvisorySignOff(a.obligor, text, committedLabel, draft);
    setMessage(res.ok ? { tone: "success", text: res.message } : { tone: "danger", text: res.reason });
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
                {p.base} · {postureRule(p.base)}
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
                {cardinalByKey[t.rows].short} (rows) × {cardinalByKey[t.columns].short} (columns), banded Low {bandRange("Low")} · Medium {bandRange("Medium")} · High {bandRange("High")} · PRD {t.prd}
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
                  label: `${b} (${bandRange(b)})`,
                }))}
                columns={bands.map((b) => ({
                  id: b,
                  label: `${b} (${bandRange(b)})`,
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
            <List items={gating.map((g) => <GatingRow key={g.applicationId} obligor={a.obligor} g={g} override={gatingOverrides[g.applicationId]} canEdit={canEdit} />)} />
          </CardContent>
        </Card>
      )}

      {message && (
        <Alert tone={message.tone} title={message.tone === "success" ? "Done" : "Couldn’t submit"}>
          {message.text}
        </Alert>
      )}
      {pendingSignOff && (
        <Alert
          tone="info"
          title="Sign-off awaiting approval"
          action={
            <Button size="small" variant="tertiary" href={`/operations/item?id=${pendingSignOff.id}`} as={Link}>
              Open request
            </Button>
          }
        >
          {pendingSignOff.requestedBy.name} submitted this note for second-analyst / CCO sign-off ({pendingSignOff.id}). It becomes the signed-off note once approved.
        </Alert>
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
        confidence={a.copBand.band === "High Confidence" ? confHigh : a.copBand.band === "Medium Confidence" ? confMedium : confLow}
        draft={signOff && !stale ? signOff.text : draft}
        defaultEditing={p.neutral && canEdit && !signOff && !pendingSignOff}
        onAccept={canEdit && !editing && !pendingSignOff ? accept : undefined}
        signedOffBy={signOff && !stale ? `${signOff.signedOffBy}${signOff.approvedBy ? `, approved by ${signOff.approvedBy}` : ""} · ${dateTime(signOff.at)}` : undefined}
        signOffNote={
          canEdit
            ? "AI output is advisory. The Credit Analyst reviews and edits the note, then submits it for sign-off by a second Credit Analyst or the CCO (Operations) before it is used in the credit memo or shared with the front office."
            : "AI-drafted and view-only for your role — a Credit Analyst prepares it and a second analyst or the CCO signs it off before use."
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

/** One open request checked by life-cycle gating, with the CCO/CRO override request (Operations "rar.gating-override"). */
function GatingRow({ obligor, g, override, canEdit }: { obligor: Obligor; g: GatingCheck; override?: GatingOverride; canEdit: boolean }) {
  const pending = usePendingFor(SUBJECT_GATING, g.applicationId);
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await requestGatingOverride(obligor, g, rationale);
    setBusy(false);
    if (!res.ok) return setError(res.reason);
    setOpen(false);
    setRationale("");
    setError(null);
  }

  return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{g.applicationId}</span> {g.purpose} · {g.tenorMonths} months · stage {g.stage ?? "n/a"}
        {!g.flagged ? (
          <Badge tone="success">Passes gating rule</Badge>
        ) : override ? (
          <Badge tone="info">Overridden by {override.approvedBy}</Badge>
        ) : (
          <Badge tone="danger">Hard exception — CCO/CRO override</Badge>
        )}
        {g.analystNote && <Badge tone="warning">Mandatory analyst note — Conservative posture, {g.stage} industry</Badge>}
        {g.flagged && !override && pending && (
          <Button size="small" variant="text" href={`/operations/item?id=${pending.id}`} as={Link}>
            Override awaiting approval ({pending.id})
          </Button>
        )}
        {g.flagged && !override && !pending && canEdit && !open && (
          <Button size="small" variant="tertiary" onClick={() => setOpen(true)}>
            Request CCO/CRO override
          </Button>
        )}
      </span>
      {override && (
        <Text variant="small" tone="muted">
          Rationale: {override.rationale} — requested by {override.requestedBy}, approved {dateTime(override.at)} ({override.operationId}).
        </Text>
      )}
      {open && (
        <Stack gap="small">
          <Field label="Documented rationale for the override" required error={error ?? undefined} description="Sent to the CCO / CRO through Operations and kept in the audit trail.">
            <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} />
          </Field>
          <span className="flex flex-wrap gap-2">
            <Button size="small" onClick={submit} loading={busy}>
              Submit override request
            </Button>
            <Button size="small" variant="tertiary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </span>
        </Stack>
      )}
    </span>
  );
}
