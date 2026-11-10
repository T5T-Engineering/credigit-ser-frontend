"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Badge, Button, DescriptionList, IconButton, Popover, StatCard, Stack, Text, type StatCardProps } from "@credigit/web-ui";

export type CalcNoteProps = {
  /** Metric name, e.g. "NPL ratio". */
  metric: string;
  /** Formula as written in the PRD. */
  formula: ReactNode;
  /** Source system / field for each variable (PRD §8). */
  source?: ReactNode;
  /** Inputs used for this figure. */
  inputs?: Array<{ label: string; value: ReactNode }>;
  /** PRD reference. */
  prd?: string;
  /** Mark when the figure uses demo/tenant-parameter values. */
  demo?: boolean;
  /** Icon-only trigger (default) or a small text link. */
  display?: "icon" | "text";
};

/** "How this is calculated" popover — formula, sources and inputs for a computed figure (PRD §2.1, §8). */
export function CalcNote({ metric, formula, source, inputs, prd, demo, display = "icon" }: CalcNoteProps) {
  return (
    <Popover
      label={`How ${metric} is calculated`}
      align="end"
      panelClassName="w-[min(22rem,calc(100vw-2rem))]"
      trigger={
        display === "text" ? (
          <Button variant="text" size="small" iconBefore={<Info size={14} aria-hidden />} aria-label={`How ${metric} is calculated`}>
            How it&apos;s calculated
          </Button>
        ) : (
          <IconButton label={`How ${metric} is calculated`} icon={<Info size={14} />} size="small" variant="text" />
        )
      }
      content={
        <Stack gap="small">
          <Stack direction="horizontal" gap="small" align="center" wrap>
            <Text variant="eyebrow">How this is calculated</Text>
            {prd ? <Badge variant="outline">PRD {prd}</Badge> : null}
            {demo ? <Badge tone="warning">Demo inputs</Badge> : null}
          </Stack>
          <Text variant="small" className="font-mono text-fg">
            {formula}
          </Text>
          {source ? <Text variant="caption">{source}</Text> : null}
          {inputs?.length ? <DescriptionList columns={1} layout="inline" items={inputs.map((i) => ({ label: i.label, value: i.value, mono: true }))} /> : null}
        </Stack>
      }
    />
  );
}

/** StatCard with a "How it's calculated" note (PRD §2.1 traceability). */
export function KpiCard({ calc, ...props }: StatCardProps & { calc: CalcNoteProps }) {
  return (
    <StatCard {...props}>
      <div className="-mb-2 -ml-3 mt-auto">
        <CalcNote display="text" {...calc} />
      </div>
    </StatCard>
  );
}
