"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  DonutChart,
  Grid,
  MiniBarList,
  Stack,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  WaterfallChart,
  useToast,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { date, dateTime, money, pct } from "@/lib/format";
import { DEMO_NOW } from "@/lib/data/seed";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { usePendingFor } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import { CalcPopover, CalcRegister, DemoNote, sum, useAuditLog, type CalcSpec, ms } from "../common";
import { cbnSpecificRate, eclMovement, fliOverlay, generalProvisionRate, reportingPeriod, stageTransfers, summariseByStage, type EclRow } from "../data";
import { PendingNotice, useSubmitOperation } from "../governance";
import { EclDetailDrawer, EclTable, StageBadge } from "../parts";
import { useIfrs9 } from "../store";
import { useEcl } from "../use-ecl";

export function Ifrs9OverviewPage() {
  const { input, rows } = useEcl();
  const canEdit = useCan("ifrs9", "edit");
  const audit = useAuditLog();
  const { toast } = useToast();
  const submitOperation = useSubmitOperation();
  const postings = useIfrs9((s) => s.postings);
  const [open, setOpen] = useState<EclRow | null>(null);
  const period = reportingPeriod();
  const pendingPost = usePendingFor("Ifrs9ReserveTransfer", period);
  const gpRate = generalProvisionRate() * 100;
  const specificRates = (["Substandard", "Doubtful", "Lost"] as const).map((c) => pct(cbnSpecificRate(c) * 100, 0)).join(" / ");
  const quarterStart = new Date(DEMO_NOW.getTime() - 90 * 864e5);

  const stages = useMemo(() => summariseByStage(rows), [rows]);
  const transfers = useMemo(() => stageTransfers(rows, input), [rows, input]);
  const movement = useMemo(() => eclMovement(rows, transfers), [rows, transfers]);
  const totalEad = sum(stages.map((s) => s.ead));
  const totalEcl = sum(stages.map((s) => s.ecl));
  const prudential = sum(rows.map((r) => r.prudential));
  const generalProv = sum(rows.filter((r) => r.cbnClass === "Performing" || r.cbnClass === "Watchlist").map((r) => r.prudential));
  const specificProv = prudential - generalProv;
  const diff = prudential - totalEcl;
  const s2 = stages[1]!;
  const s3 = stages[2]!;
  const bySector = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.sector, (m.get(r.sector) ?? 0) + r.ecl);
    return [...m.entries()].map(([label, value]) => ({ label, value }));
  }, [rows]);

  const specs: CalcSpec[] = [
    { metric: "Stage 1 ECL", formula: "12-month PD × LGD × EAD", sources: "PD/LGD/EAD per source mapping (model register)", value: ms(stages[0]!.ecl), prd: "§8, §6.7.1" },
    {
      metric: "Stage 2/3 ECL",
      formula: "Lifetime PD × LGD × EAD (Stage 3: PD = 100%, credit-adjusted)",
      sources: "Lifetime PD term structure from the Predictive Analytics model registry",
      value: ms(s2.ecl + s3.ecl),
      prd: "§8, §6.7.1",
    },
    {
      metric: "EAD",
      formula: "Outstanding principal + accrued interest + CCF × undrawn limit",
      sources: "CBA facility book (outstanding, limit, rate); CCF from the EAD model",
      value: ms(totalEad),
      prd: "§6.7.2",
    },
    {
      metric: "PD",
      formula: "Grade master-scale PD × sector × 360 RAR posture × forward-looking overlay",
      sources: `CBA default/cure history + Loan Review past-due register; FLI overlay × ${fliOverlay().toFixed(3)} (business rules)`,
      prd: "§6.7.2",
    },
    {
      metric: "LGD",
      formula: "1 − (perfected FSV or MTM × (1 − haircut) × work-out discount) / EAD",
      sources: "Collateral register; SEC/CSCS MTM for quoted shares",
      prd: "§6.7.2",
    },
    { metric: "Coverage ratio", formula: "ECL / EAD × 100", sources: "Computed", value: pct((totalEcl / totalEad) * 100, 2) },
    {
      metric: "CBN prudential provision",
      formula: `General ${pct(gpRate, 2)} on performing + specific ${specificRates} (Sub-Standard / Doubtful / Lost); Lost haircut-adjusted per`,
      sources: "CBN classification from Loan Review; collateral register",
      value: ms(prudential),
      prd: "§6.7.1, §6.7.3",
    },
    {
      metric: "Regulatory risk reserve transfer",
      formula: "Prudential provision − IFRS 9 impairment (CBN 12.4)",
      sources: "Both bases computed in parallel; posted to the Finance module",
      value: ms(diff),
      prd: "§6.7.1",
    },
  ];

  const lastPosting = postings[0];
  /** Post to Finance is an approval (Operations: Head of Risk review → CRO approval); the entry posts on final approval. */
  const postReserve = async () => {
    const direction = diff > 0 ? "Transfer from general reserve to regulatory risk reserve" : "Release from regulatory risk reserve to general reserve";
    const posting = { period, amount: Math.abs(diff), direction, ifrs: totalEcl, prudential };
    const hook = await runHooks("ifrs9.reserve.post.before", { posting, request: true });
    if (!hook.ok) {
      toast({ title: "Posting blocked", description: `${hook.vetoedBy}: ${hook.reason}`, tone: "danger" });
      return;
    }
    const res = await submitOperation("ifrs9.ecl.post", {
      title: `Reserve-transfer entry ${period}: ${money(posting.amount)}`,
      subject: { type: "Ifrs9ReserveTransfer", id: period, title: `CBN 12.4 reserve transfer ${period}`, href: "/ifrs9" },
      payload: hook.ctx.posting,
      summary: [
        { label: "Period", value: period },
        { label: "Entry", value: direction },
        { label: "Amount", value: money(posting.amount) },
        { label: "IFRS 9 ECL", value: money(totalEcl) },
        { label: "CBN prudential provision", value: money(prudential) },
      ],
    });
    if (res.ok) {
      audit("Requested CBN 12.4 reserve-transfer posting", "Ifrs9ReserveTransfer", period, lastPosting ? money(lastPosting.amount) : undefined, `${direction}: ${money(posting.amount)} — Operations ${res.instance.id}`);
      publish("ifrs9.reserve.post-requested", { module: "ifrs9", subject: { type: "Ifrs9ReserveTransfer", id: period, href: "/ifrs9" }, payload: { operationId: res.instance.id, amount: posting.amount } });
    }
  };

  return (
    <ModulePage module="ifrs9" description="IFRS 9 expected-credit-loss staging and computation, reconciled to the CBN prudential classification.">
      <Stack gap="large">
        <DemoNote>
          ECL is computed live from the shared facility book, collateral register and obligor ratings. PD, LGD, CCF and scenario weights are illustrative demo calibrations — in
          production they come from the approved model register and the Rules &amp; Parameters Engine.
        </DemoNote>

        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard
            label="Total ECL"
            value={ms(totalEcl)}
            hint="Σ PD × LGD × EAD, all stages"
            delta={ms(movement.closing - movement.opening)}
            deltaDirection={movement.closing >= movement.opening ? "up" : "down"}
            deltaIntent={movement.closing >= movement.opening ? "negative" : "positive"}
          />
          <StatCard label="Coverage (ECL / EAD)" value={pct((totalEcl / totalEad) * 100, 2)} hint={`EAD ${ms(totalEad)} · ${rows.length} facilities`} />
          <StatCard label="Stage 2 share of EAD" value={pct((s2.ead / totalEad) * 100, 1)} hint={`${s2.count} facilities on lifetime ECL`} tone="warning" />
          <StatCard label="Stage 3 coverage" value={pct(s3.coverage * 100, 1)} hint={`${s3.count} credit-impaired facilities`} tone="danger" />
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>ECL by stage</CardTitle>
                <CardDescription>12-month ECL for Stage 1; lifetime ECL for Stages 2 and 3.</CardDescription>
              </Stack>
              <CalcPopover spec={specs[0]!} />
            </CardHeader>
            <CardContent>
              <Stack gap="large">
                <DonutChart
                  label="ECL by IFRS 9 stage"
                  segments={stages.map((s) => ({ label: `Stage ${s.stage}`, value: Math.round(s.ecl), tone: s.stage === 1 ? "success" : s.stage === 2 ? "warning" : "danger" }))}
                  centerLabel="Total ECL"
                  centerValue={ms(totalEcl)}
                  valueFormatter={(v) => ms(v)}
                />
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Stage</TableHeaderCell>
                        <TableHeaderCell>Basis</TableHeaderCell>
                        <TableHeaderCell numeric>EAD</TableHeaderCell>
                        <TableHeaderCell numeric>ECL</TableHeaderCell>
                        <TableHeaderCell numeric>Coverage</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stages.map((s) => (
                        <TableRow key={s.stage}>
                          <TableCell>
                            <StageBadge stage={s.stage} />
                          </TableCell>
                          <TableCell>{s.stage === 1 ? "12-month" : s.stage === 2 ? "Lifetime" : "Lifetime, credit-adjusted"}</TableCell>
                          <TableCell numeric>{ms(s.ead)}</TableCell>
                          <TableCell numeric>{ms(s.ecl)}</TableCell>
                          <TableCell numeric>{pct(s.coverage * 100, 2)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell className="font-semibold text-fg">Total</TableCell>
                        <TableCell>{rows.length} facilities</TableCell>
                        <TableCell numeric>{ms(totalEad)}</TableCell>
                        <TableCell numeric>{ms(totalEcl)}</TableCell>
                        <TableCell numeric>{pct((totalEcl / totalEad) * 100, 2)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>ECL movement — quarter to date</CardTitle>
                <CardDescription>
                  Opening allowance ({date(quarterStart)}) to closing allowance ({date(DEMO_NOW)}). Demo attribution.
                </CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <WaterfallChart
                label="ECL movement waterfall"
                increaseIntent="negative"
                height={280}
                valueFormatter={(v) => ms(v)}
                legendLabels={{ increase: "Increase in ECL", decrease: "Release", total: "Allowance" }}
                steps={[
                  { label: "Opening", value: movement.opening, type: "start" },
                  ...movement.steps.map((s) => ({ label: s.label, value: s.value, caption: s.caption })),
                  { label: "Closing", type: "total" as const },
                ]}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>Prudential vs IFRS 9 reconciliation</CardTitle>
                <CardDescription>
                  CBN Prudential Guidelines — both bases computed in parallel; the difference is posted to the non-distributable regulatory risk reserve.
                </CardDescription>
              </Stack>
              <CalcPopover spec={specs[7]!} />
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <DescriptionList
                  columns={2}
                  items={[
                    { label: "IFRS 9 impairment (ECL)", value: money(totalEcl), mono: true },
                    { label: "CBN prudential provision", value: money(prudential), mono: true },
                    {
                      label: "of which general (performing)",
                      value: money(generalProv),
                      mono: true,
                      hint: `${pct(gpRate, 2)} business rule; capped at ${pct(getRule<number>("ifrs9.cbn.generalProvisionCapRwa"), 2)} of RWA (CBN 3.16(d))`,
                    },
                    { label: "of which specific", value: money(specificProv), mono: true, hint: `${specificRates}; Lost haircut-adjusted` },
                    { label: "Difference (prudential − IFRS 9)", value: money(diff), mono: true },
                    { label: "Entry required", value: diff > 0 ? "Transfer to regulatory risk reserve" : "Release from regulatory risk reserve" },
                  ]}
                />
                {lastPosting ? (
                  <Alert tone="success" title="Posted to Finance module">
                    {lastPosting.period ? `${lastPosting.period} · ` : ""}
                    {lastPosting.direction}: {money(lastPosting.amount)} — approved by {lastPosting.by}, {dateTime(lastPosting.at)}.
                  </Alert>
                ) : (
                  <Text variant="small" tone="muted">
                    Not yet posted for the {period} reporting period.
                  </Text>
                )}
                <PendingNotice subjectType="Ifrs9ReserveTransfer" subjectId={period}>
                  The entry posts to Finance when the workflow completes.
                </PendingNotice>
                {canEdit && !pendingPost && (
                  <div>
                    <Button onClick={() => void postReserve()}>{lastPosting ? "Request re-post" : "Submit entry for approval"}</Button>
                  </div>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardHeader>
              <Stack gap="xsmall">
                <CardTitle>ECL by sector</CardTitle>
                <CardDescription>Sector concentration of the allowance.</CardDescription>
              </Stack>
            </CardHeader>
            <CardContent>
              <MiniBarList label="ECL by sector" items={bySector} limit={8} valueFormatter={(v) => ms(v)} tone="accent" />
            </CardContent>
          </Card>
        </Grid>

        <Card variant="outlined">
          <CardHeader>
            <Stack gap="xsmall">
              <CardTitle>Facility-level ECL</CardTitle>
              <CardDescription>Select a facility to see each PD, LGD and EAD input and the formula applied to its numbers.</CardDescription>
            </Stack>
          </CardHeader>
          <CardContent>
            <EclTable rows={rows} onOpen={setOpen} />
          </CardContent>
        </Card>

        <CalcRegister specs={specs} />
      </Stack>
      <EclDetailDrawer row={open} onClose={() => setOpen(null)} />
    </ModulePage>
  );
}
