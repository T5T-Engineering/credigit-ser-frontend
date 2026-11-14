"use client";

import { BarChart, Card, CardDescription, CardHeader, CardTitle, DescriptionList, Grid, Stack, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { number } from "@/lib/format";
import { projections, staging24h } from "../data";
import { fmtLag } from "../views";

export function StagingPage() {
  const d = staging24h.discounted;
  const discountedTotal = d.interBranch + d.suspense + d.inAndOut + d.reversals;
  return (
    <ModulePage module="connectors" description="Staging / reconciliation layer and downstream read-model freshness. Simulated.">
      <Stack gap="large">
        <Grid columns={{ base: 1, lg: 2 }} gap="medium">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Discounted before promotion (24 h)</CardTitle>
                <CardDescription>Inter-branch, suspense, in-and-out and reversal entries are detected algorithmically and excluded before data feeds the COP ratio and 360 RAR scoring.</CardDescription>
              </div>
            </CardHeader>
            <BarChart
              orientation="horizontal"
              tone="warning"
              label="Entries discounted by type"
              valueFormatter={(n) => number(n)}
              data={[
                { label: "In-and-out", value: d.inAndOut },
                { label: "Inter-branch", value: d.interBranch },
                { label: "Reversals", value: d.reversals },
                { label: "Suspense", value: d.suspense },
              ]}
            />
            <DescriptionList
              className="mt-4"
              columns={3}
              items={[
                { label: "Received", value: number(staging24h.received), mono: true },
                { label: "Discounted", value: number(discountedTotal), mono: true },
                { label: "Promoted", value: number(staging24h.received - discountedTotal - staging24h.quarantined), mono: true, hint: `${staging24h.quarantined} quarantined for review` },
              ]}
            />
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Unreconciled items by age</CardTitle>
                <CardDescription>Items ageing past their clearance window raise an exception through the escalation protocol.</CardDescription>
              </div>
            </CardHeader>
            <BarChart tone="info" label="Unreconciled items by age" data={staging24h.unreconciledAgeing.map((a) => ({ label: a.label, value: a.value }))} valueFormatter={(n) => number(n)} />
          </Card>
        </Grid>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Read-model projection lag</CardTitle>
              <CardDescription>How far each downstream engine’s read model trails the write side. Shown wherever lag affects a decision.</CardDescription>
            </div>
          </CardHeader>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Projection</TableHeaderCell>
                <TableHeaderCell numeric>Lag</TableHeaderCell>
                <TableHeaderCell numeric>Events (24 h)</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {projections.map((p) => (
                <TableRow key={p.name}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell numeric>{fmtLag(p.lagSec)}</TableCell>
                  <TableCell numeric>{number(p.events)}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} tones={{ [p.status]: p.status === "Current" ? "success" : "danger" }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Stack>
    </ModulePage>
  );
}
