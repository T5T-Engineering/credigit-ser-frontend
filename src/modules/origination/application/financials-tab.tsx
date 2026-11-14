"use client";

import { useState } from "react";
import { RefreshCw, ScanSearch } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  EmptyState,
  Field,
  Gauge,
  Grid,
  KeyValueGrid,
  Stack,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  Tooltip,
  WaterfallChart,
} from "@credigit/web-ui";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, money, moneyShort, pct } from "@/lib/format";
import { extractedFinancials, ratiosFrom, type BureauReport } from "../data";
import { copBand } from "../logic";
import { inGroup, TENANT_PARAM_NOTE } from "../params";
import { getRule } from "@/lib/platform/rules";
import { recordChange } from "../actions";
import type { AppCtx } from "./context";

export function FinancialsTab({ c }: { c: AppCtx }) {
  const { app, obligor, rec } = c;
  const fields = extractedFinancials(obligor);
  const band = copBand(app.copRatio);
  const isAnalyst = c.canEdit && inGroup("analysts", c.roleId);
  const high = getRule<number>("origination.cop.highBand");
  const medium = getRule<number>("origination.cop.mediumBand");
  const gaugeMax = getRule<number>("origination.cop.gaugeMax");
  const [explanation, setExplanation] = useState(c.extra.copExplanation ?? "");

  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, lg: 2 }} gap="large">
        <Card>
          <CardHeader>
            <div><CardTitle>COP Ratio — confidence overlay</CardTitle>
            <CardDescription>Verified bank-account credit turnover ÷ declared turnover per audited financial statements.</CardDescription></div>
          </CardHeader>
          <CardContent>
            {app.copRatio === undefined ? (
              <EmptyState icon={<ScanSearch aria-hidden />} title="Not yet computed" description="The COP Ratio is computed once the audited financials and statements are extracted." />
            ) : (
              <Stack gap="medium">
                <Gauge
                  value={app.copRatio}
                  min={0}
                  max={gaugeMax}
                  label="COP Ratio"
                  valueFormatter={(v) => v.toFixed(2)}
                  bands={[
                    { to: medium, tone: "danger" },
                    { to: high, tone: "warning" },
                    { to: gaugeMax, tone: "success" },
                  ]}
                />
                <Stack direction="horizontal" gap="small" align="center" wrap justify="center">
                  {band ? <StatusBadge status={band.label} tones={{ [band.label]: band.tone }} /> : null}
                  <Tooltip content={`Bands: ≥ ${high} High · ${medium}–${(high - 0.01).toFixed(2)} Medium · < ${medium} Low (example; business rules)`}>
                    <Badge variant="outline">How bands work</Badge>
                  </Tooltip>
                </Stack>
                <DescriptionList
                  columns={2}
                  items={[
                    { label: "Verified turnover", value: money(rec.verified), mono: true, hint: `${rec.months} months, CBA + ${rec.otherBanks.length} other bank(s)` },
                    { label: "Declared turnover", value: money(rec.declared), mono: true, hint: "Audited financial statements" },
                    { label: "Formula", value: `${moneyShort(rec.verified)} ÷ ${moneyShort(rec.declared)} = ${app.copRatio.toFixed(2)}`, mono: true, span: 2 },
                    { label: "Effect on Internal Risk score", value: band?.weight, span: 2 },
                  ]}
                />
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div><CardTitle>Statement reconciliation</CardTitle>
            <CardDescription>Gross credits less entries that are not genuine, sustained trade turnover.</CardDescription></div>
          </CardHeader>
          <CardContent>
            <WaterfallChart
              label="Reconciliation from gross statement credits to verified turnover"
              increaseIntent="positive"
              valueFormatter={(v) => moneyShort(v)}
              legendLabels={{ increase: "Credits", decrease: "Excluded", total: "Verified" }}
              steps={[
                { label: "CBA credits", value: rec.cbaGross, type: "start", caption: "Harbourline core banking" },
                { label: "Other banks", value: rec.otherBankGross, caption: rec.otherBanks.map((b) => b.name).join(", ") },
                { label: "Inter-branch / suspense", value: -rec.interBranchSuspense },
                { label: "In-and-out", value: -rec.inAndOut },
                { label: "Reversals", value: -rec.reversals },
                { label: "Verified", type: "total" },
              ]}
            />
          </CardContent>
        </Card>
      </Grid>

      {band?.requiresExplanation ? (
        <Card>
          <CardHeader>
            <div><CardTitle>Customer explanation (required)</CardTitle>
            <CardDescription>COP Ratio is in the Low band — the Credit Analyst must obtain and document a customer explanation before proceeding.</CardDescription></div>
          </CardHeader>
          <CardContent>
            {isAnalyst ? (
              <Stack gap="small">
                <Field label="Explanation obtained from the customer" htmlFor="cop-explanation" description="Saved to the credit file and audit trail.">
                  <Textarea id="cop-explanation" value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={3} />
                </Field>
                <div>
                  <Button
                    disabled={explanation.trim().length < getRule<number>("origination.cop.explanationMinLength") || explanation === c.extra.copExplanation}
                    onClick={() => {
                      const before = c.extra.copExplanation;
                      void recordChange(c.app.id, { point: "cop.explain", event: "origination.cop.explained", action: "Documented COP customer explanation", before, after: explanation.trim(), payload: { copRatio: c.app.copRatio } }).then((r) => {
                        if (r.ok) c.patchExtra({ copExplanation: explanation.trim() });
                      });
                    }}
                  >
                    Save explanation
                  </Button>
                </div>
              </Stack>
            ) : c.extra.copExplanation ? (
              <Text>{c.extra.copExplanation}</Text>
            ) : (
              <Alert tone="warning" title="Awaiting the Credit Analyst">No explanation has been documented yet.</Alert>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div><CardTitle>Extracted financial-statement fields</CardTitle>
          <CardDescription>Parsed by OCR from the audited financial statements and mapped into the 360 RAR Internal Risk parameter table. Fields below {getRule<number>("origination.ocr.reviewBelowPct")}% confidence are flagged for review.</CardDescription></div>
        </CardHeader>
        <CardContent>
          <Stack gap="large">
            <KeyValueGrid columns={4} items={ratiosFrom(fields).slice(0, 4).map((r) => ({ label: r.label, value: r.value, mono: true, hint: r.hint }))} />
            <div className="overflow-x-auto">
              <Table striped>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Field</TableHeaderCell>
                    <TableHeaderCell numeric>Value</TableHeaderCell>
                    <TableHeaderCell numeric>OCR confidence</TableHeaderCell>
                    <TableHeaderCell>Source</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fields.map((f) => (
                    <TableRow key={f.key}>
                      <TableCell>{f.label}</TableCell>
                      <TableCell numeric>{money(f.value)}</TableCell>
                      <TableCell numeric>
                        <Stack direction="horizontal" gap="small" justify="end" align="center">
                          {f.confidence * 100 < getRule<number>("origination.ocr.reviewBelowPct") ? <Badge tone="warning">Review</Badge> : null}
                          <span>{pct(f.confidence * 100)}</span>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-fg-muted">{f.source}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Stack>
        </CardContent>
      </Card>

      <BureauSection c={c} isAnalyst={isAnalyst} />
    </Stack>
  );
}

function BureauSection({ c, isAnalyst }: { c: AppCtx; isAnalyst: boolean }) {
  const { app } = c;
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    window.setTimeout(() => {
      const at = new Date().toISOString();
      void recordChange(app.id, { point: "bureau.pull", event: "origination.bureau.pulled", action: "Pulled credit bureau reports and CRMS search (simulated connector)", changes: { bureauChecked: true, crmsChecked: true }, after: "CRC, FirstCentral, CRMS", payload: { at } }).then((r) => {
        if (r.ok) c.patchExtra({ bureauRunAt: at });
        setRunning(false);
      });
    }, 1400);
  };
  const done = app.bureauChecked && app.crmsChecked;
  return (
    <Card>
      <CardHeader>
        <Stack direction="horizontal" justify="between" align="start" wrap gap="medium">
          <div>
            <CardTitle>Credit bureau & CRMS</CardTitle>
            <CardDescription>Mandatory pull from at least two licensed bureaux plus a CBN CRMS search before any approval. Simulated connector responses.</CardDescription>
          </div>
          {isAnalyst ? (
            <Button variant={done ? "tertiary" : "primary"} loading={running} iconBefore={<RefreshCw aria-hidden />} onClick={run}>
              {done ? "Re-pull reports" : "Run bureau & CRMS checks"}
            </Button>
          ) : null}
        </Stack>
      </CardHeader>
      <CardContent>
        {!done ? (
          <EmptyState icon={<ScanSearch aria-hidden />} title="Checks not yet run" description="Approval is blocked until both bureau reports and the CRMS search are on file." />
        ) : (
          <Stack gap="large">
            {c.adverse ? <Alert tone="danger" title="Adverse finding">A non-performing facility is reported at another institution. Obtain an explanation before recommending.</Alert> : null}
            <Grid columns={{ base: 1, md: 3 }} gap="medium">
              {c.bureau.map((b) => (
                <KeyValueGrid
                  key={b.source}
                  columns={2}
                  items={[
                    { label: b.source, value: b.score ? String(b.score) : `${b.lines.length} lines`, mono: true, hint: b.kind === "CRMS" ? "CRMS search result" : "Bureau score (simulated)" },
                    { label: "Reference", value: b.reference, mono: true, hint: `Enquired ${date(b.enquiredAt)}` },
                  ]}
                />
              ))}
            </Grid>
            <BureauLines report={c.bureau[2] ?? c.bureau[0]!} />
            <Text variant="caption" tone="muted">
              Per-institution breakdown feeds the Share of Business Wallet analysis. Demo date {date(DEMO_NOW)}. {TENANT_PARAM_NOTE}: bureau providers.
            </Text>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function BureauLines({ report }: { report: BureauReport }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">Facilities reported by institution</caption>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Reporting institution</TableHeaderCell>
            <TableHeaderCell>Facility type</TableHeaderCell>
            <TableHeaderCell numeric>Approved</TableHeaderCell>
            <TableHeaderCell numeric>Outstanding</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {report.lines.map((l, i) => (
            <TableRow key={`${l.institution}-${i}`}>
              <TableCell>{l.institution}</TableCell>
              <TableCell>{l.facilityType}</TableCell>
              <TableCell numeric>{moneyShort(l.approved)}</TableCell>
              <TableCell numeric>{moneyShort(l.outstanding)}</TableCell>
              <TableCell>
                <StatusBadge status={l.status} tones={{ Performing: "success", "Non-performing": "danger" }} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
