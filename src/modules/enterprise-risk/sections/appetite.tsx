"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DescriptionList,
  Drawer,
  Grid,
  KeyValueGrid,
  LineChart,
  ProgressBar,
  RagIndicator,
  Sparkline,
  Stack,
  Text,
  type DataTableColumn,
} from "@credigit/web-ui";
import { useCan } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, dateTime } from "@/lib/format";
import { ragLabel, useActorName, useAuditLog } from "../../operational-risk/shared";
import { APPETITE_MONTHS, RAS_VERSION, fmtMetric, type AppetiteMetric, type Rag } from "../data";
import { useAppetite } from "../logic";
import { useErm } from "../store";

type Row = AppetiteMetric & { rag: Rag };
const ragOrder = { red: 0, amber: 1, green: 2 } as const;

function utilisation(m: Row) {
  return m.direction === "max" ? m.actual / m.limit : m.limit / Math.max(0.0001, m.actual);
}

export function AppetiteSection() {
  const { metrics } = useAppetite();
  const canEdit = useCan("enterprise-risk", "edit");
  const escalations = useErm((s) => s.appetiteEscalations);
  const escalate = useErm((s) => s.escalateAppetite);
  const audit = useAuditLog();
  const actor = useActorName();
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = metrics.find((m) => m.id === openId) ?? null;
  const breaches = metrics.filter((m) => m.rag === "red");

  const columns: DataTableColumn<Row>[] = [
    { id: "name", header: "Appetite metric", accessor: "name", searchable: true, cell: (m) => <div><div className="font-medium text-fg">{m.name}</div><div className="font-mono text-xs text-fg-subtle">{m.id} · {m.owner}</div></div> },
    { id: "type", header: "Risk type", accessor: "type", sortable: true },
    { id: "limit", header: "Appetite", numeric: true, accessor: (m) => `${m.direction === "max" ? "≤" : "≥"} ${fmtMetric(m, m.limit)}` },
    { id: "tolerance", header: "Early warning", numeric: true, accessor: (m) => fmtMetric(m, m.tolerance) },
    { id: "actual", header: "Actual", numeric: true, sortable: true, sortValue: (m) => utilisation(m), accessor: (m) => fmtMetric(m, m.actual), cell: (m) => <span className="font-mono font-semibold">{fmtMetric(m, m.actual)}</span> },
    { id: "util", header: "Use of appetite", exportable: false, cell: (m) => <div className="w-32"><ProgressBar value={Math.min(1, utilisation(m))} tone={m.rag === "red" ? "danger" : m.rag === "amber" ? "warning" : "success"} size="small" ariaLabel={`${m.name} utilisation`} showValue /></div> },
    { id: "rag", header: "Status", accessor: (m) => ragLabel[m.rag], sortable: true, sortValue: (m) => ragOrder[m.rag], cell: (m) => <RagIndicator status={m.rag} label={ragLabel[m.rag]} size="small" /> },
    { id: "trend", header: "12 months", exportable: false, cell: (m) => <div className="w-24"><Sparkline values={m.history} tone={m.rag === "red" ? "danger" : m.rag === "amber" ? "warning" : "success"} height={26} /></div> },
  ];

  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, lg: 3 }} gap="large">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Risk Appetite Statement in force</CardTitle>
            <CardDescription>Owned by the CRO (§4.3); captured at onboarding as versioned configuration in the Rules & Parameters Engine</CardDescription>
          </CardHeader>
          <CardContent>
            <KeyValueGrid
              columns={4}
              items={[
                { label: "Version", value: RAS_VERSION.version, mono: true },
                { label: "Approved by", value: RAS_VERSION.approvedBy },
                { label: "Approved", value: date(RAS_VERSION.approvedAt) },
                { label: "Next review", value: date(RAS_VERSION.nextReview) },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Scorecard</CardTitle>
            <CardDescription>{metrics.length} metrics across credit, concentration, capital, liquidity, market and operational risk</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {(["green", "amber", "red"] as const).map((r) => (
                <RagIndicator key={r} status={r} label={`${metrics.filter((m) => m.rag === r).length} ${ragLabel[r]}`} />
              ))}
            </div>
          </CardContent>
        </Card>
      </Grid>

      {breaches.length > 0 && (
        <Alert tone="danger" title={`${breaches.length} appetite breach${breaches.length > 1 ? "es" : ""} — automated escalation to the CRO`}>
          {breaches.map((m) => `${m.name}: ${fmtMetric(m, m.actual)} vs ${m.direction === "max" ? "≤" : "≥"} ${fmtMetric(m, m.limit)}${escalations[m.id] ? ` (escalated to ${escalations[m.id]!.to} by ${escalations[m.id]!.by})` : ""}`).join("; ")}.
        </Alert>
      )}

      <DataTable
        label="Risk appetite scorecard"
        columns={columns}
        data={metrics}
        getRowId={(m) => m.id}
        filters={[{ id: "type", label: "Risk type" }, { id: "rag", label: "Status" }]}
        defaultSort={{ id: "rag", direction: "asc" }}
        onRowClick={(m) => setOpenId(m.id)}
        exportFilename="risk-appetite-scorecard.csv"
        paginate={false}
      />
      <Text variant="caption" tone="subtle">Regulatory floors are cited from the PRD (CBN 3.2, §6.8.3, §9.1); all other limits and early-warning bands are illustrative Board RAS values for the demo tenant. CAR, liquidity and NOP actuals are simulated feeds until the Phase 2 engines publish to the spine.</Text>

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={selected?.name ?? ""}
        description={selected ? `${selected.id} · ${selected.type} risk` : undefined}
        footer={
          selected && canEdit && selected.rag !== "green" && !escalations[selected.id] ? (
            <div className="flex justify-end">
              <Button
                iconBefore={<ArrowUpRight aria-hidden />}
                onClick={() => {
                  const to = selected.rag === "red" ? "Board Risk Committee" : "Chief Risk Officer";
                  escalate(selected.id, { by: actor, at: DEMO_NOW.toISOString(), to });
                  audit("Escalated risk appetite breach", "Risk appetite metric", selected.id, `${ragLabel[selected.rag]} ${fmtMetric(selected, selected.actual)}`, `Escalated to ${to}`);
                }}
              >
                Escalate to {selected.rag === "red" ? "Board Risk Committee" : "CRO"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <Stack gap="large">
            <div className="flex flex-wrap items-center gap-3">
              <RagIndicator status={selected.rag} label={`${ragLabel[selected.rag]} — ${fmtMetric(selected, selected.actual)}`} />
              {escalations[selected.id] && <Badge tone="info">Escalated to {escalations[selected.id]!.to} · {dateTime(escalations[selected.id]!.at)}</Badge>}
            </div>
            <LineChart
              label={`${selected.name} trend`}
              height={220}
              showLegend
              series={[
                { name: "Actual", points: selected.history.map((y, i) => ({ x: APPETITE_MONTHS[i]!, y })), tone: "accent" },
                { name: "Appetite limit", points: APPETITE_MONTHS.map((x) => ({ x, y: selected.limit })), tone: "danger" },
                { name: "Early warning", points: APPETITE_MONTHS.map((x) => ({ x, y: selected.tolerance })), tone: "warning" },
              ]}
            />
            <DescriptionList
              columns={1}
              layout="inline"
              items={[
                { label: "Formula", value: selected.formula },
                { label: "Source", value: selected.source },
                { label: "Basis of limit", value: selected.basis },
                { label: "Metric owner", value: selected.owner },
                { label: "Appetite", value: `${selected.direction === "max" ? "≤" : "≥"} ${fmtMetric(selected, selected.limit)}` },
                { label: "Early warning", value: fmtMetric(selected, selected.tolerance) },
              ]}
            />
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}
