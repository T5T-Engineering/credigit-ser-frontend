"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DescriptionList, Grid, RadarChart, Stack, StatusBadge, Text } from "@credigit/web-ui";
import { date } from "@/lib/format";
import { postureTone, rarMidpoint } from "@/lib/rar";
import { copBand } from "../logic";
import type { AppCtx } from "./context";

export function RarTab({ c }: { c: AppCtx }) {
  const { obligor, engine } = c;
  const p = engine.position;
  const band = copBand(c.app.copRatio);
  return (
    <Grid columns={{ base: 1, lg: 2 }} gap="large">
      <Card>
        <CardHeader>
          <div><CardTitle>360° Risk Assessment Radar</CardTitle>
          <CardDescription>Four cardinal points, each scored 1–10 (10 strongest). Last refreshed {date(obligor.rarUpdatedAt)}.</CardDescription></div>
        </CardHeader>
        <CardContent>
          <RadarChart
            max={10}
            showValues
            axes={[
              { key: "internal", label: "Internal Risk (N)" },
              { key: "comparative", label: "Comparative (E)" },
              { key: "industry", label: "Operating Industry (S)" },
              { key: "macro", label: "Macro-Economic (W)" },
            ]}
            series={[{ name: obligor.name, values: { ...obligor.rar }, tone: "accent" }]}
          />
        </CardContent>
      </Card>
      <Stack gap="large">
        <Card>
          <CardHeader>
            <CardTitle>Posture</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              <div>
                <StatusBadge status={p.label} tones={{ [p.label]: p.neutral ? "neutral" : postureTone[p.base] }} />
              </div>
              <DescriptionList
                columns={2}
                items={[
                  { label: "X-Composite", value: p.x.toFixed(2), mono: true, hint: "Mean of Operating Industry and Comparative" },
                  { label: "Y-Composite", value: p.y.toFixed(2), mono: true, hint: "Mean of Internal Risk and Macro-Economic" },
                  { label: "Distance from midpoint", value: p.magnitude.toFixed(2), mono: true, hint: `Midpoint ${rarMidpoint()} on the 1–10 scale` },
                  { label: "Lead", value: p.lead },
                ]}
              />
            </Stack>
          </CardContent>
        </Card>
        {band ? (
          <Alert tone={band.tone === "success" ? "success" : band.tone === "warning" ? "warning" : "danger"} title={`Confidence overlay: ${band.label}`}>
            <Text variant="small">The COP Ratio ({c.app.copRatio?.toFixed(2)}) sets how heavily declared financials weigh in the Internal Risk Assessment. {band.weight}.</Text>
          </Alert>
        ) : null}
        <div>
          <Button as={Link} href={`/credit-analysis/assessment/?id=${obligor.id}`} iconAfter={<ArrowRight aria-hidden />}>
            Open full 360 RAR assessment
          </Button>
        </div>
      </Stack>
    </Grid>
  );
}
