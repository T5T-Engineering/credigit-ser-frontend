"use client";

import { useState } from "react";
import { FileStack, Send, ShieldCheck } from "lucide-react";
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
  Checkbox,
  EmptyState,
  Field,
  Grid,
  Input,
  ProgressBar,
  Stack,
  StatusBadge,
  Steps,
  Text,
} from "@credigit/web-ui";
import { useCan, useRole } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, dateTime } from "@/lib/format";
import { useActorName, useAuditLog } from "../../operational-risk/shared";
import { fmtMetric, packSections, type BrcPack } from "../data";
import { useAppetite } from "../logic";
import { useErm } from "../store";

const packTones = { Draft: "neutral", "Submitted to CRO": "info", "Approved for BRC": "success" } as const;

export function BrcPackSection() {
  const canEdit = useCan("enterprise-risk", "edit");
  const role = useRole();
  const packs = useErm((s) => s.packs);
  const { addPack, updatePack } = useErm.getState();
  const { metrics, readings } = useAppetite();
  const audit = useAuditLog();
  const actor = useActorName();
  const [selected, setSelected] = useState<string[]>(packSections.map((s) => s.id));
  const [meeting, setMeeting] = useState("2026-11-26");
  const [progress, setProgress] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = packs.find((p) => p.id === activeId) ?? packs[0];

  const finish = () => {
    const breaches = metrics.filter((m) => m.rag === "red");
    const amber = metrics.filter((m) => m.rag === "amber");
    const reds = readings.filter((k) => k.rag === "red");
    const summary = [
      `Harbourline Bank remains within appetite on ${metrics.filter((m) => m.rag === "green").length} of ${metrics.length} Risk Appetite Statement metrics.`,
      breaches.length ? `Breaches requiring the Committee's attention:\n${breaches.map((m) => `- ${m.name}: ${fmtMetric(m, m.actual)} against appetite of ${m.direction === "max" ? "≤" : "≥"} ${fmtMetric(m, m.limit)} (owner: ${m.owner}).`).join("\n")}` : "No appetite breaches this period.",
      amber.length ? `Early-warning (Amber) metrics: ${amber.map((m) => m.name).join("; ")}.` : "",
      `Operational risk: ${reds.length} KRI(s) in Red (${reds.map((k) => k.name).join(", ") || "none"}); escalations are running under the §6.4.4 protocol.`,
      breaches.length ? "Management recommends the Committee notes the breaches above and the remediation plans presented by the metric owners." : "Management recommends the Committee notes the scorecard.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const pack: BrcPack = {
      id: `BRC-${meeting.replace(/-/g, "")}-${String(packs.length + 1).padStart(2, "0")}`,
      meeting,
      sections: selected,
      compiledAt: DEMO_NOW.toISOString(),
      compiledBy: actor,
      pages: 6 + selected.length * 4,
      summary,
      status: "Draft",
    };
    addPack(pack);
    setActiveId(pack.id);
    audit("Compiled Board Risk Committee pack", "BRC pack", pack.id, undefined, `${selected.length} sections · meeting ${meeting}`);
    setProgress(null);
  };

  const compile = () => {
    const step = (i: number) => {
      setProgress(i);
      if (i >= selected.length) finish();
      else setTimeout(() => step(i + 1), 280);
    };
    step(0);
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Grid columns={{ base: 1, lg: 12 }} gap="large">
      <Card className="lg:col-span-5">
        <CardHeader>
          <CardTitle>Board Risk Committee pack builder</CardTitle>
          <CardDescription>Head of Risk compiles; the CRO approves before circulation (§6.11, §4.3)</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="medium">
            <Field label="Committee meeting date" htmlFor="brc-date">
              <Input id="brc-date" type="date" value={meeting} min="2026-11-10" onChange={(e) => setMeeting(e.target.value)} disabled={!canEdit} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold text-fg">Sections</legend>
              {packSections.map((s) => (
                <Checkbox key={s.id} label={s.title} description={s.source} checked={selected.includes(s.id)} onChange={() => toggle(s.id)} disabled={!canEdit || progress !== null} />
              ))}
            </fieldset>
            {progress !== null ? (
              <ProgressBar value={progress / Math.max(1, selected.length)} label={`Compiling ${packSections.find((s) => s.id === selected[Math.min(progress, selected.length - 1)])?.title ?? ""}…`} tone="accent" showValue />
            ) : (
              <Button iconBefore={<FileStack aria-hidden />} disabled={!canEdit || selected.length === 0} onClick={compile} fullWidth>
                Compile pack ({selected.length} sections)
              </Button>
            )}
            {!canEdit && <Text variant="small" tone="muted">Your role can view packs but not compile them.</Text>}
          </Stack>
        </CardContent>
      </Card>

      <div className="lg:col-span-7">
        {!active ? (
          <Card>
            <EmptyState icon={<FileStack aria-hidden />} title="No pack compiled yet" description="Choose the sections and compile — figures are pulled live from each module with their data-as-of time and source." />
          </Card>
        ) : (
          <Stack gap="large">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{active.id}</CardTitle>
                    <CardDescription>Meeting {date(active.meeting)} · {active.pages} pages · compiled by {active.compiledBy}, {dateTime(active.compiledAt)}</CardDescription>
                  </div>
                  <StatusBadge status={active.status} tones={packTones} />
                </div>
              </CardHeader>
              <CardContent>
                <Stack gap="medium">
                  <Steps
                    orientation="horizontal"
                    items={[
                      { title: "Compiled", description: active.compiledBy, status: "complete" },
                      { title: "Submitted to CRO", description: "Head of Risk", status: active.status === "Draft" ? "current" : "complete" },
                      { title: "Approved for BRC", description: active.approvedBy ?? "Chief Risk Officer", status: active.status === "Approved for BRC" ? "complete" : active.status === "Submitted to CRO" ? "current" : "upcoming" },
                    ]}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {active.sections.map((id, i) => {
                      const s = packSections.find((x) => x.id === id)!;
                      return (
                        <div key={id} className="rounded-3xl bg-surface-sunken p-3">
                          <div className="text-sm font-medium text-fg">{i + 1}. {s.title}</div>
                          <Text variant="caption" tone="subtle">{s.source} · data as of {dateTime(active.compiledAt)}</Text>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {active.status === "Draft" && canEdit && (
                      <Button iconBefore={<Send aria-hidden />} onClick={() => { updatePack(active.id, { status: "Submitted to CRO" }); audit("Submitted BRC pack to CRO", "BRC pack", active.id, "Draft", "Submitted to CRO"); }}>Submit to CRO</Button>
                    )}
                    {active.status === "Submitted to CRO" && role?.id === "cro" && (
                      <Button iconBefore={<ShieldCheck aria-hidden />} onClick={() => { updatePack(active.id, { status: "Approved for BRC", approvedBy: actor }); audit("Approved BRC pack for circulation", "BRC pack", active.id, "Submitted to CRO", "Approved for BRC"); }}>Approve for Board Risk Committee</Button>
                    )}
                    {active.status === "Submitted to CRO" && role?.id !== "cro" && <Badge tone="info">Awaiting CRO approval</Badge>}
                  </div>
                </Stack>
              </CardContent>
            </Card>
            <AiDraftPanel
              kind="drafted"
              title="Executive summary"
              model="SER Narrative v1.4 (simulated)"
              generatedAt={dateTime(active.compiledAt)}
              confidence={0.78}
              draft={active.summary}
              sources={[{ label: "Risk appetite scorecard", detail: `${metrics.length} metrics` }, { label: "Operational Risk KRIs", detail: `${readings.length} KRIs` }]}
              onAccept={
                canEdit && active.status === "Draft"
                  ? (text) => {
                      updatePack(active.id, { summary: text });
                      audit("Adopted AI-drafted BRC executive summary", "BRC pack", active.id, "AI-drafted", "Adopted by Head of Risk");
                    }
                  : undefined
              }
              signOffNote="The Head of Risk must review and adopt the summary; the CRO approves the pack."
            />
            {packs.length > 1 && (
              <Alert tone="info" title="Earlier packs">
                <div className="flex flex-wrap gap-2">
                  {packs.map((p) => (
                    <Button key={p.id} size="small" variant={p.id === active.id ? "secondary" : "tertiary"} onClick={() => setActiveId(p.id)}>
                      {p.id} · {p.status}
                    </Button>
                  ))}
                </div>
              </Alert>
            )}
            <Text variant="caption" tone="subtle">Distribution to Committee members is simulated in this prototype.</Text>
          </Stack>
        )}
      </div>
    </Grid>
  );
}
