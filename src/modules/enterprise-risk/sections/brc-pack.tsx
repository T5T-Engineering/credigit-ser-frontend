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
import { useCan } from "@/lib/auth/session";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, dateTime } from "@/lib/format";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { canDecide, decideOperation, submitOperation, usePendingFor, type SubmitResult } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { aiKeys, submitAiSignOff } from "../../ai/platform";
import { PendingBadge, SubmitOutcome } from "../../operational-risk/operation-ui";
import { useAuditLog } from "../../operational-risk/shared";
import { fmtMetric, packSections, type BrcPack } from "../data";
import { useAppetite } from "../logic";
import { BRC_HREF, ERM, ermKeys, type BrcPackPayload } from "../platform";
import { useErm } from "../store";

/** Estimated page count shown on a compiled pack (TD-902: layout heuristic, not a business rule). */
const estimatePages = (sections: number) => 6 + sections * 4;

const packTones = { Draft: "neutral", "Submitted to CRO": "info", "Approved for BRC": "success" } as const;

export function BrcPackSection() {
  const canEdit = useCan("enterprise-risk", "edit");
  const { actor } = useScope();
  const narrativeModel = useRule<string>(aiKeys.narrativeModel);
  const needsAdoptedSummary = useRule<boolean>(ermKeys.brcRequiresAdoptedSummary);
  const packs = useErm((s) => s.packs);
  const { addPack, updatePack } = useErm.getState();
  const { metrics, readings } = useAppetite();
  const audit = useAuditLog();
  const [outcome, setOutcome] = useState<SubmitResult | null>(null);
  const pendingOp = usePendingFor("BrcPack", packs.find((p) => p.status === "Submitted to CRO")?.id ?? "");
  const [selected, setSelected] = useState<string[]>(packSections.map((s) => s.id));
  const [meeting, setMeeting] = useState("2026-11-26");
  const [progress, setProgress] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = packs.find((p) => p.id === activeId) ?? packs[0];

  const finish = async () => {
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
    const draft: BrcPack = {
      id: `BRC-${meeting.replace(/-/g, "")}-${String(packs.length + 1).padStart(2, "0")}`,
      meeting,
      sections: selected,
      compiledAt: DEMO_NOW.toISOString(),
      compiledBy: actor.name,
      compiledById: actor.id,
      pages: estimatePages(selected.length),
      summary,
      status: "Draft",
    };
    const before = await runHooks("enterprise-risk.brc-pack.compile.before", { pack: draft, actor });
    setProgress(null);
    if (!before.ok) {
      setOutcome({ ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` });
      return;
    }
    const pack = before.ctx.pack;
    addPack(pack);
    setActiveId(pack.id);
    audit("Compiled Board Risk Committee pack", "BRC pack", pack.id, undefined, `${pack.sections.length} sections · meeting ${meeting}`);
    publish("enterprise-risk.brc-pack.compiled", { module: ERM, subject: { type: "BrcPack", id: pack.id, href: "/enterprise-risk/brc-pack" }, payload: { meeting, sections: pack.sections.length } });
    await runHooks("enterprise-risk.brc-pack.compile.after", { pack, actor });
  };

  const compile = () => {
    const step = (i: number) => {
      setProgress(i);
      if (i >= selected.length) void finish();
      else setTimeout(() => step(i + 1), 280);
    };
    step(0);
  };

  /** Head of Risk submits; the CRO approves in Operations (or inline below via the same workflow engine). */
  const submit = async (p: BrcPack) => {
    const before = await runHooks("enterprise-risk.brc-pack.submit.before", { pack: p, actor });
    if (!before.ok) {
      setOutcome({ ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` });
      return;
    }
    const r = await submitOperation<BrcPackPayload>("enterprise-risk.brc-pack.approval", {
      title: `BRC pack ${p.id} — meeting ${p.meeting}`,
      subject: { type: "BrcPack", id: p.id, title: `BRC pack ${p.id}`, href: "/enterprise-risk/brc-pack" },
      payload: { packId: p.id, meeting: p.meeting, sections: p.sections.length },
      summary: [
        { label: "Pack", value: p.id },
        { label: "Meeting", value: date(p.meeting) },
        { label: "Sections", value: String(p.sections.length) },
        { label: "Executive summary", value: p.summaryAdoptedBy ? `Adopted by ${p.summaryAdoptedBy}` : "AI-drafted — not yet adopted" },
      ],
    });
    setOutcome(r);
    if (!r.ok) return;
    if (!r.applied) updatePack(p.id, { status: "Submitted to CRO" });
    audit("Submitted BRC pack to CRO", "BRC pack", p.id, "Draft", `Submitted to CRO · ${r.instance.id}`);
    publish("enterprise-risk.brc-pack.submitted", { module: ERM, subject: { type: "BrcPack", id: p.id, href: BRC_HREF }, payload: { operationId: r.instance.id } });
    await runHooks("enterprise-risk.brc-pack.submit.after", { pack: p, actor, operationId: r.instance.id });
  };
  const decide = async (decision: "approve" | "reject") => {
    if (!pendingOp) return;
    const r = await decideOperation(pendingOp.id, decision, decision === "approve" ? "Approved for circulation to the Board Risk Committee." : "Returned to the Head of Risk for revision.");
    if (!r.ok) setOutcome({ ok: false, reason: r.reason });
  };
  const mayDecide = pendingOp ? canDecide(pendingOp, actor).ok : false;

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Grid columns={{ base: 1, lg: 12 }} gap="large">
      {outcome && <div className="lg:col-span-12"><SubmitOutcome result={outcome} /></div>}
      <Card className="lg:col-span-5">
        <CardHeader>
          <CardTitle>Board Risk Committee pack builder</CardTitle>
          <CardDescription>Head of Risk compiles; the CRO approves before circulation (§6.11, §4.3)</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="medium">
            <Field label="Committee meeting date" htmlFor="brc-date">
              <Input id="brc-date" type="date" value={meeting} min={DEMO_NOW.toISOString().slice(0, 10)} onChange={(e) => setMeeting(e.target.value)} disabled={!canEdit} />
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
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={active.status} tones={packTones} />
                    <PendingBadge subjectType="BrcPack" subjectId={active.id} />
                  </div>
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
                  {active.status === "Draft" && needsAdoptedSummary && !active.summaryAdoptedBy && (
                    <Alert tone="warning" title="Adopt the executive summary first">
                      Review and adopt the AI-drafted executive summary below before submitting the pack (business rule).
                    </Alert>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    {active.status === "Draft" && canEdit && (
                      <Button iconBefore={<Send aria-hidden />} disabled={needsAdoptedSummary && !active.summaryAdoptedBy} onClick={() => void submit(active)}>Submit to CRO</Button>
                    )}
                    {active.status === "Submitted to CRO" && pendingOp?.subject.id === active.id && mayDecide && (
                      <>
                        <Button variant="tertiary" onClick={() => void decide("reject")}>Return to Head of Risk</Button>
                        <Button iconBefore={<ShieldCheck aria-hidden />} onClick={() => void decide("approve")}>Approve for Board Risk Committee</Button>
                      </>
                    )}
                    {active.status === "Submitted to CRO" && !mayDecide && <Badge tone="info">Awaiting approval in Operations</Badge>}
                  </div>
                </Stack>
              </CardContent>
            </Card>
            <AiDraftPanel
              kind="drafted"
              title="Executive summary"
              model={narrativeModel}
              generatedAt={dateTime(active.compiledAt)}
              confidence={0.78}
              draft={active.summary}
              sources={[{ label: "Risk appetite scorecard", detail: `${metrics.length} metrics` }, { label: "Operational Risk KRIs", detail: `${readings.length} KRIs` }]}
              onAccept={
                canEdit && active.status === "Draft" && !active.summaryAdoptedBy
                  ? async (text) => {
                      const r = await submitAiSignOff({ activityId: `AIA-BRC-${active.id}`, item: `BRC executive summary (${active.id})`, module: "Enterprise risk", href: "/enterprise-risk/brc-pack", decision: "Signed off", accountable: "head-of-risk", text });
                      setOutcome(r);
                    }
                  : undefined
              }
              signOffNote="The Head of Risk must review and adopt the summary; the CRO approves the pack."
              signedOffBy={active.summaryAdoptedBy}
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
