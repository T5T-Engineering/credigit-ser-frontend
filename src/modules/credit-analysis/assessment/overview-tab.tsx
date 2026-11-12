"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  Gauge,
  Grid,
  KeyValueGrid,
  Matrix,
  ProgressBar,
  RadarChart,
  ScatterChart,
  Stack,
  Text,
  type MatrixCell,
  type ScatterSeries,
} from "@credigit/web-ui";
import { intensityThresholds, postureTone, rarPosition, rarMidpoint } from "@/lib/rar";
import type { Obligor } from "@/lib/data/types";
import { moneyShort } from "@/lib/format";
import { walletPositionMeta, type WalletData } from "../data";
import { copBands, postureRule, type Assessment, type axisHistory } from "../logic";
import { cardinalPoints } from "../parameters";
import { postureOrder } from "../shared";

type Props = {
  a: Assessment;
  history: ReturnType<typeof axisHistory>;
  peers: { scope: string; peers: Obligor[] };
  wallet: WalletData;
  onOpenTab: (tab: string) => void;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
// Thresholds are read at render time from business rules (see `t` inside the component).

export function OverviewTab({ a, history, peers, wallet, onOpenTab }: Props) {
  const t = intensityThresholds();
  const p = a.position;
  const peerAvg = useMemo(
    () => Object.fromEntries(cardinalPoints.map((c) => [c.key, Math.round(mean(peers.peers.map((o) => o.rar[c.key])) * 10) / 10])) as Record<string, number>,
    [peers],
  );
  const prior = history[history.length - 2];

  const radarAxes = cardinalPoints.map((c) => ({
    key: c.key,
    label: `${c.direction[0]} · ${c.short.split(" ")[0]!.replace("Operating", "Industry").replace("Macro-Economic", "Macro")}`,
  }));

  const scatter = useMemo<ScatterSeries[]>(() => {
    const steps = 8;
    const thrust = Array.from({ length: steps - 1 }, (_, i) => {
      const f = (i + 1) / steps;
      return {
        x: rarMidpoint() + (p.x - rarMidpoint()) * f,
        y: rarMidpoint() + (p.y - rarMidpoint()) * f,
        size: 0.02,
      };
    });
    return [
      {
        name: `Book peers (${peers.peers.length})`,
        tone: "neutral",
        points: peers.peers.map((o) => ({ ...pos(o), size: 0.12 })),
      },
      {
        name: "Prior refreshes",
        tone: "info",
        points: history.slice(0, -1).map((h) => ({ x: h.position.x, y: h.position.y, size: 0.3 })),
      },
      { name: "Strategic thrust", tone: "accent", points: thrust },
      {
        name: "Current position",
        tone: p.neutral ? "neutral" : postureTone[p.base],
        points: [{ x: p.x, y: p.y, size: 1, label: "Current" }],
      },
    ];
  }, [p, peers, history]);

  const stateCells: MatrixCell[] = useMemo(
    () =>
      (["Strongly", "Moderately", "Marginally", "Neutral"] as const).flatMap((intensity) =>
        postureOrder.map((base) => ({
          row: intensity,
          column: base,
          label: intensity === "Neutral" ? "Neutral" : `${intensity} ${base}`,
          tone: intensity === "Neutral" ? ("neutral" as const) : postureTone[base],
          description: intensity === "Neutral" ? "Neutral / Transitional — 13th state, no posture assigned" : `${intensity} ${base}`,
        })),
      ),
    [],
  );
  const activeState = {
    row: p.neutral ? "Neutral" : p.intensity!,
    column: p.base,
  };

  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, lg: 3 }} gap="large">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>360° Risk Assessment Radar</CardTitle>
              <CardDescription>Cardinal-point averages, 1–10 (10 strongest)</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RadarChart
              axes={radarAxes}
              max={10}
              levels={5}
              size={240}
              showLegend
              series={[
                { name: "This obligor", values: a.scores, tone: "accent" },
                { name: "Book peer average", values: peerAvg, tone: "neutral" },
              ]}
              valueFormatter={(v) => v.toFixed(1)}
              label={`360 RAR radar for ${a.obligor.name}`}
            />
            <KeyValueGrid
              className="mt-4"
              columns={2}
              items={cardinalPoints.map((c) => ({
                label: `${c.direction} · ${c.short}`,
                value: a.scores[c.key].toFixed(1),
                hint: prior ? `Prior ${prior.scores[c.key].toFixed(1)} · peers ${peerAvg[c.key]!.toFixed(1)}` : undefined,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Composite position chart</CardTitle>
              <CardDescription>Strategic-thrust vector from the ({rarMidpoint()}, {rarMidpoint()}) midpoint · quadrant = base posture</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ScatterChart
              series={scatter}
              xDomain={[1, 10]}
              yDomain={[1, 10]}
              bubbleRange={[3, 11]}
              xLabel="X-Composite"
              yLabel="Y-Composite"
              referenceLines={[
                { axis: "x", value: rarMidpoint() },
                { axis: "y", value: rarMidpoint() },
              ]}
              xFormatter={(v) => v.toFixed(1)}
              yFormatter={(v) => v.toFixed(1)}
              height={280}
              showLabels
              label={`Composite position of ${a.obligor.name}: X ${p.x}, Y ${p.y}`}
            />
            <Grid columns={2} gap="small" className="mt-4">
              {(
                [
                  ["Conservative", `↖ ${postureRule("Conservative")}`],
                  ["Aggressive", `↗ ${postureRule("Aggressive")}`],
                  ["Defensive", `↙ ${postureRule("Defensive")}`],
                  ["Competitive", `↘ ${postureRule("Competitive")}`],
                ] as const
              ).map(([q, where]) => (
                <span key={q} className="flex flex-col gap-1">
                  <Badge tone={postureTone[q as keyof typeof postureTone]} variant={!p.neutral && p.base === q ? "solid" : "soft"}>
                    {q}
                  </Badge>
                  <span className="font-mono text-xs text-fg-muted">{where}</span>
                </span>
              ))}
            </Grid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Posture</CardTitle>
              <CardDescription>Base posture, intensity band and axis-dominance</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              <div>
                <Text variant="title" as="p">
                  {p.neutral ? "Neutral / Transitional" : `${p.intensity} ${p.base}`}
                </Text>
                {!p.neutral && <Text tone="muted">{p.lead}</Text>}
              </div>
              <Gauge
                value={p.magnitude}
                min={0}
                max={6.4}
                bands={[
                  { to: t.neutralBelow, tone: "neutral" },
                  { to: t.marginalBelow, tone: "warning" },
                  { to: t.moderateBelow, tone: "info" },
                  { to: 6.4, tone: "success" },
                ]}
                label="Magnitude"
                valueFormatter={(v) => v.toFixed(2)}
              />
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: "X-Composite",
                    value: p.x.toFixed(2),
                    mono: true,
                    hint: `(${a.scores.industry.toFixed(1)} + ${a.scores.comparative.toFixed(1)}) ÷ 2`,
                  },
                  {
                    label: "Y-Composite",
                    value: p.y.toFixed(2),
                    mono: true,
                    hint: `(${a.scores.internal.toFixed(1)} + ${a.scores.macro.toFixed(1)}) ÷ 2`,
                  },
                  {
                    label: "Magnitude",
                    value: p.magnitude.toFixed(2),
                    mono: true,
                    hint: `√((X−${rarMidpoint()})² + (Y−${rarMidpoint()})²)`,
                  },
                  {
                    label: "Lead",
                    value: p.neutral ? "n/a" : p.lead,
                    hint: `|Y−${rarMidpoint()}| ${Math.abs(p.y - rarMidpoint()).toFixed(2)} vs |X−${rarMidpoint()}| ${Math.abs(p.x - rarMidpoint()).toFixed(2)}`,
                  },
                ]}
              />
              <Text variant="small" tone="muted">
                Bands (demo defaults): Neutral &lt; {t.neutralBelow} · Marginal &lt; {t.marginalBelow} · Moderate &lt; {t.moderateBelow} · Strong ≥ {t.moderateBelow}.
                {p.intensity === "Marginally" && " Marginal readings are provisional — see the parameters closest to flipping in Advisory."}
              </Text>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid columns={{ base: 1, lg: 2 }} gap="large">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Posture state</CardTitle>
              <CardDescription>12 intensity-qualified postures + Neutral / Transitional</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Matrix
              label="Thirteen posture states — active state highlighted"
              rows={["Strongly", "Moderately", "Marginally", "Neutral"].map((r) => ({ id: r, label: r }))}
              columns={postureOrder.map((c) => ({ id: c, label: c }))}
              cells={stateCells}
              selected={activeState}
              cellSize="small"
              legend={false}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Confidence Overlay</CardTitle>
              <CardDescription>COP Ratio dampens the Internal Risk score</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              <span>
                <Badge tone={a.copBand.tone}>{a.copBand.band}</Badge>
              </span>
              <ProgressBar value={Math.min(1, a.cop)} tone={a.copBand.tone} label={`COP Ratio ${a.cop.toFixed(2)}`} showValue />
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: "Verified credit turnover",
                    value: moneyShort(a.obligor.verifiedTurnover),
                    mono: true,
                    hint: "CBA + other banks, reconciled",
                  },
                  {
                    label: "Declared turnover",
                    value: moneyShort(a.obligor.declaredTurnover),
                    mono: true,
                    hint: "Audited financial statements (OCR)",
                  },
                  {
                    label: "Internal Risk — pre-overlay",
                    value: a.internalRaw.toFixed(1),
                    mono: true,
                    hint: "Mean of 14 parameters",
                  },
                  {
                    label: "Internal Risk — after overlay",
                    value: a.scores.internal.toFixed(1),
                    mono: true,
                    hint: a.overlayPenalty ? `−${a.overlayPenalty.toFixed(1)} dampening` : "No dampening",
                  },
                ]}
              />
              <Text variant="small" tone="muted">
                Bands (tenant-configurable; example):{" "}
                {copBands()
                  .map((b, i, all) => `${b.band.replace(" Confidence", "")} ${b.from ? `≥ ${b.from.toFixed(2)}` : `< ${all[i - 1]!.from.toFixed(2)}`} → −${b.penalty.toFixed(1)}`)
                  .join(" · ")}
                . Bands and dampening amounts are tenant business rules.
                {a.copBand.band === "Low Confidence" && " A documented customer explanation is required before proceeding."}
              </Text>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid columns={{ base: 1, lg: 2 }} gap="large">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Share of Business Wallet</CardTitle>
              <CardDescription>Relationship depth across banks</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {wallet.available ? (
              <Stack gap="medium">
                <span>
                  <Badge tone={walletPositionMeta[wallet.position].tone}>{wallet.position}</Badge>
                </span>
                <ProgressBar value={wallet.turnoverShare} tone="accent" label="Turnover wallet share" showValue />
                <ProgressBar value={wallet.loanShare} tone="brand" label="Loan wallet share" showValue />
                <Text variant="small" tone="muted">
                  Gap {wallet.gap >= 0 ? "+" : ""}
                  {Math.round(wallet.gap * 100)} pp. {walletPositionMeta[wallet.position].read}
                </Text>
                <Button as={Link} href={`/credit-analysis/share-of-wallet?id=${a.obligor.id}`} variant="text" size="small" iconAfter={<ArrowRight aria-hidden />}>
                  Wallet analysis
                </Button>
              </Stack>
            ) : (
              <Text tone="muted">
                No other-bank statements or bureau per-bank breakdown on file. Request statements through the other-bank connector to compute wallet share.
              </Text>
            )}
          </CardContent>
        </Card>
        <Card variant="filled">
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Text tone="muted">Drill down to every parameter’s score, scoring direction and data source, or open the AI-drafted advisory note for this posture.</Text>
              <span className="flex flex-wrap gap-2">
                <Button variant="tertiary" size="small" onClick={() => onOpenTab("parameters")}>
                  Parameters & sources
                </Button>
                <Button size="small" onClick={() => onOpenTab("advisory")} iconAfter={<ArrowRight aria-hidden />}>
                  Advisory note
                </Button>
              </span>
            </div>
          </CardContent>
        </Card>
      </Grid>
    </Stack>
  );
}

function pos(o: Obligor) {
  const r = rarPosition(o.rar);
  return { x: r.x, y: r.y };
}
