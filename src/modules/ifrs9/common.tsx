"use client";

/**
 * Helpers shared by the Predictive Analytics (IFRS 9 / ICAAP) and Market & Liquidity Risk modules.
 * Compositions of @credigit/web-ui only — no new UI primitives.
 */
import { useCallback, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Accordion, AccordionItem, Alert, Button, DataTable, type DataTableColumn, DescriptionList, Popover, Stack, Text } from "@credigit/web-ui";
import { useDbActions } from "@/lib/data/hooks";
import { currentActor, useScope } from "@/lib/platform/scope";
import { moneyShort } from "@/lib/format";
import type { RoleId } from "@/lib/rbac/roles";

/** Deterministic 0–1 value from a string (stable demo variation per record). */
export function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Compact naira with a true minus sign (U+2212) so negative figures never wrap after the sign. */
export const ms = (v: number) => moneyShort(v).replace(/^-/, "−⁠");

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Audit-log writer bound to the signed-in actor (PRD §10.3: who, what, entity, before/after). */
export function useAuditLog() {
  const { log } = useDbActions();
  return useCallback(
    (action: string, entityType: string, entityId: string, before?: string, after?: string) => {
      const actor = currentActor();
      log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action, entityType, entityId, before, after });
    },
    [log],
  );
}

/** Signed-in actor with display name + role, for sign-off stamps and "my" views. */
export function useActorName(): { id: string; name: string; role: string; roleId: RoleId | null } {
  const { actor, role } = useScope();
  return { id: actor.id, name: actor.name, role: role?.name ?? "—", roleId: role?.id ?? null };
}

/** A metric's traceability record (PRD §8: formula + source of each variable). */
export type CalcSpec = {
  metric: string;
  formula: string;
  sources: string;
  value?: string;
  prd?: string;
};

/** "How this is calculated" popover for a single figure. */
export function CalcPopover({ spec, label = "How this is calculated" }: { spec: CalcSpec; label?: string }) {
  return (
    <Popover
      label={`${label}: ${spec.metric}`}
      align="end"
      trigger={
        <Button variant="text" size="small" iconBefore={<Info aria-hidden className="size-4" />}>
          {label}
        </Button>
      }
      content={
        <div className="w-[min(22rem,80vw)]">
          <DescriptionList
            columns={1}
            items={[
              { label: "Metric", value: spec.metric },
              { label: "Formula", value: spec.formula, mono: true },
              { label: "Source of each variable", value: spec.sources },
              ...(spec.value ? [{ label: "Current value", value: spec.value, mono: true }] : []),

            ]}
          />
        </div>
      }
    />
  );
}

const calcColumns: DataTableColumn<CalcSpec>[] = [
  { id: "metric", header: "Metric", accessor: "metric", cell: (r) => <span className="font-semibold text-fg">{r.metric}</span> },
  { id: "formula", header: "Formula", accessor: "formula", cell: (r) => <span className="font-mono text-sm">{r.formula}</span> },
  { id: "sources", header: "Source of each variable", accessor: "sources" },
  { id: "value", header: "Value", accessor: "value", numeric: true },

];

/** Collapsible metric register for a page: every computed figure with its formula and sources. */
export function CalcRegister({ specs, title = "How these figures are calculated" }: { specs: CalcSpec[]; title?: string }) {
  return (
    <Accordion type="multiple">
      <AccordionItem value="calc" title={title}>
        <DataTable
          label={title}
          columns={calcColumns}
          data={specs}
          getRowId={(r) => r.metric}
          paginate={false}
          mobileCard={(r) => (
            <Stack gap="xsmall">
              <Text variant="small" className="font-semibold text-fg">
                {r.metric} {r.value ? `· ${r.value}` : ""}
              </Text>
              <Text variant="small" className="font-mono">
                {r.formula}
              </Text>
              <Text variant="caption" tone="muted">
                {r.sources}
              </Text>
            </Stack>
          )}
        />
      </AccordionItem>
    </Accordion>
  );
}

/** Banner reminding viewers that parameters are demo values (prototype honesty, conventions rule 4). */
export function DemoNote({ children, title = "Model parameters" }: { children: ReactNode; title?: string }) {
  return (
    <Alert tone="info" title={title}>
      {children}
    </Alert>
  );
}
