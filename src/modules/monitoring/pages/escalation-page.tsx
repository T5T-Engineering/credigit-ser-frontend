"use client";

/** Escalation protocol & monitoring parameters (PRD §6.4.4) — the business rules that drive this module, read-only here; changes go through Operations → Business rules. */
import Link from "next/link";
import { Button, Card, CardDescription, CardHeader, CardTitle, Grid, Stack, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { moneyShort } from "@/lib/format";
import { ruleDefinitions, useRulesStore } from "@/lib/platform/rules";
import { useDpdLadder, useLadder } from "../hooks";
import { cbnClassTones, levelTones, provisionLabel } from "../logic";

export function EscalationPage() {
  const ladder = useLadder();
  const { buckets } = useDpdLadder();
  const values = useRulesStore((s) => s.values);
  const canRequest = useCan("rules.rules.request-change");
  const rules = ruleDefinitions().filter((d) => d.module === "monitoring");
  const show = (key: string) => {
    const d = rules.find((r) => r.key === key)!;
    const v = values[key] ?? d.default;
    return d.type === "money" ? moneyShort(v as number) : Array.isArray(v) ? v.join(", ") : `${String(v)}${d.unit ? ` ${d.unit}` : ""}`;
  };
  return (
    <ModulePage
      module="monitoring"
      description="The escalation ladder, cure SLAs, days-past-due ladder and monitoring thresholds in force for this tenant. Every value is a business rule; changes are requested and approved in Operations."
      actions={
        canRequest ? (
          <Button as={Link} href="/operations/rules" variant="secondary">
            Request a change
          </Button>
        ) : undefined
      }
    >
      <Stack gap="large">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Escalation ladder (PRD §6.4.4)</CardTitle>
              <CardDescription>Notified roles and cure SLAs per level. Level 4 adds the Board above the materiality threshold ({show("monitoring.escalation.boardMaterialityNgn")}).</CardDescription>
            </div>
          </CardHeader>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Level</TableHeaderCell>
                <TableHeaderCell>Trigger</TableHeaderCell>
                <TableHeaderCell>Notified</TableHeaderCell>
                <TableHeaderCell>SLA</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ladder.map((l) => (
                <TableRow key={l.level}>
                  <TableCell>
                    <StatusBadge status={`Level ${l.level}`} tones={{ [`Level ${l.level}`]: levelTones[l.level] }} />
                  </TableCell>
                  <TableCell>{l.trigger}</TableCell>
                  <TableCell>{l.notified}</TableCell>
                  <TableCell>{l.sla}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Days-past-due ladder</CardTitle>
                <CardDescription>PRD §6.4.1, §6.7.1 (CBN prudential guidelines).</CardDescription>
              </div>
            </CardHeader>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Bucket</TableHeaderCell>
                  <TableHeaderCell>CBN class</TableHeaderCell>
                  <TableHeaderCell numeric>Provision</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {buckets.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.id}</TableCell>
                    <TableCell>
                      <StatusBadge status={b.cbnClass} tones={cbnClassTones} />
                    </TableCell>
                    <TableCell numeric>{provisionLabel(b.cbnClass)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Monitoring parameters</CardTitle>
                <CardDescription>Values read by the module at the moment they are used.</CardDescription>
              </div>
            </CardHeader>
            <Table>
              <TableBody>
                {rules
                  .filter((r) => !r.key.startsWith("monitoring.escalation.l") && !r.key.startsWith("monitoring.dpd.") && !r.key.startsWith("monitoring.cbn.") && !r.key.startsWith("monitoring.nature."))
                  .map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>
                        <Stack gap="none">
                          <span className="text-fg">{r.label}</span>
                          <Text variant="caption" tone="subtle">
                            {r.source}
                          </Text>
                        </Stack>
                      </TableCell>
                      <TableCell numeric>{show(r.key)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Card>
        </Grid>
      </Stack>
    </ModulePage>
  );
}
