"use client";

import { useState } from "react";
import Link from "next/link";
import { Cpu, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DescriptionList,
  Field,
  Grid,
  List,
  ProgressBar,
  Select,
  Stack,
  StatusBadge,
  Text,
  Textarea,
  TextLink,
  useToast,
} from "@credigit/web-ui";
import { dateTime, moneyShort, pct } from "@/lib/format";
import { isBreach, limitGate, recommendationLabel, recommendationLabelTones, recommendationTones } from "../logic";
import { inGroup, PARAMS_HREF, TENANT_PARAM_NOTE } from "../params";
import { getRule } from "@/lib/platform/rules";
import { usePendingFor } from "@/lib/platform/operations";
import { adoptRecommendation, recordChange, recordLimitGate, requestLimitException, SUBJECT } from "../actions";
import { PendingOperation } from "./operation-status";
import type { Application } from "@/lib/data/types";
import { useObligors, useSectors } from "@/lib/data/hooks";
import type { AppCtx } from "./context";

type Rec = NonNullable<Application["recommendation"]>;
const recs: Rec[] = ["Approve", "Approve with conditions", "Decline", "Refer"];

export function RecommendationTab({ c }: { c: AppCtx }) {
  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, lg: 2 }} gap="large">
        <EngineCard c={c} />
        <LimitGateCard c={c} />
      </Grid>
      <CovenantCard c={c} />
    </Stack>
  );
}

function EngineCard({ c }: { c: AppCtx }) {
  const { app, engine } = c;
  const { toast } = useToast();
  const pendingOverride = usePendingFor(SUBJECT.override, app.id);
  const minReason = getRule<number>("origination.override.minReasonLength");
  const canAdopt = c.canEdit && inGroup("recommenders", c.roleId) && ["Analysis", "Recommendation", "Approval"].includes(app.stage) && !pendingOverride;
  const [choice, setChoice] = useState<Rec>(c.extra.override ? (c.extra.override.to as Rec) : engine.recommendation);
  const [reason, setReason] = useState("");
  const override = choice !== engine.recommendation;
  const adopt = async () => {
    const res = await adoptRecommendation(app.id, engine.recommendation, choice, reason);
    if (!res.ok) { toast({ title: "Not recorded", description: res.reason, tone: "danger" }); return; }
    setReason("");
    toast({ title: override ? "Override requested" : "Recommendation recorded", description: res.message ?? recommendationLabel[choice], tone: "success" });
  };
  return (
    <Card>
      <CardHeader>
        <div><Stack direction="horizontal" gap="small" align="center" wrap>
          <Cpu aria-hidden className="size-5 text-fg-muted" />
          <CardTitle>Recommendation engine</CardTitle>
        </Stack>
        <CardDescription>System-generated from the 360 RAR position, COP confidence, bureau findings, security cover and the limit gate. Rule set: {TENANT_PARAM_NOTE.toLowerCase()}.</CardDescription></div>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          <Stack direction="horizontal" gap="small" align="center" wrap>
            <Text variant="eyebrow">System recommendation</Text>
            <StatusBadge status={engine.recommendation} label={recommendationLabel[engine.recommendation]} tones={recommendationTones} />
          </Stack>
          <List variant="unordered" items={engine.rationale} spacing="small" />
          <DescriptionList
            columns={2}
            items={[
              { label: "Adopted recommendation", value: app.recommendation ? recommendationLabel[app.recommendation] : undefined, status: app.recommendation ? recommendationLabel[app.recommendation] : undefined, statusTones: recommendationLabelTones },
              { label: "Override", value: c.extra.override ? `${recommendationLabel[c.extra.override.from as Rec]} → ${recommendationLabel[c.extra.override.to as Rec]} by ${c.extra.override.by}` : "None", hint: c.extra.override ? `Reason: ${c.extra.override.reason} · ${dateTime(c.extra.override.at)}` : undefined },
            ]}
          />
          {pendingOverride ? <PendingOperation instance={pendingOverride} title="Override awaiting review" actionLabels={{ approve: "Approve override", decline: "Reject override" }} /> : null}
          {canAdopt ? (
            <Stack gap="small">
              <Field label="Recommendation to adopt" htmlFor="rec-choice">
                <Select id="rec-choice" value={choice} onChange={(e) => setChoice(e.target.value as Rec)} options={recs.map((r) => ({ value: r, label: `${recommendationLabel[r]}${r === engine.recommendation ? " (system)" : ""}` }))} />
              </Field>
              {override ? (
                <Field label="Override reason" htmlFor="rec-reason" required description="Mandatory — captured in the audit trail. The override is reviewed in Operations before it takes effect.">
                  <Textarea id="rec-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              ) : null}
              <div>
                <Button disabled={override && reason.trim().length < minReason} onClick={adopt}>
                  {override ? "Request override" : "Adopt recommendation"}
                </Button>
              </div>
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function LimitGateCard({ c }: { c: AppCtx }) {
  const { app, gate } = c;
  const obligors = useObligors();
  const sectors = useSectors();
  const { toast } = useToast();
  const pendingException = usePendingFor(SUBJECT.exception, app.id);
  const [justification, setJustification] = useState("");
  const canRun = c.canEdit && inGroup("analysts", c.roleId) && ["Draft", "Documents", "Analysis", "Recommendation"].includes(app.stage);
  const canRequestException = c.canEdit && (inGroup("analysts", c.roleId) || inGroup("initiators", c.roleId)) && isBreach(app.limitGate) && !c.extra.exception && !pendingException && ["Recommendation", "Approval", "Analysis"].includes(app.stage);
  const warn = getRule<number>("origination.limitGate.warnUtilisationPct") / 100;
  const tone = (u: number) => (u > 1 ? "danger" : u > warn ? "warning" : "success");
  const minComment = getRule<number>("operations.minCommentLength");
  return (
    <Card>
      <CardHeader>
        <Stack direction="horizontal" justify="between" align="start" wrap gap="medium">
          <div>
            <CardTitle>Portfolio-limit gate</CardTitle>
            <CardDescription>Checked before submission to the next tier against the single-obligor and sectoral limits.</CardDescription>
          </div>
          {canRun ? (
            <Button
              variant="tertiary"
              iconBefore={<RefreshCw aria-hidden />}
              onClick={async () => {
                const g = limitGate({ id: app.id, product: app.product, amount: app.amount, obligorId: app.obligorId }, c.obligor, c.facilities, obligors, sectors);
                const res = await recordLimitGate(app.id, g.result);
                if (!res.ok) toast({ title: "Check not recorded", description: res.reason, tone: "danger" });
              }}
            >
              Run check
            </Button>
          ) : null}
        </Stack>
      </CardHeader>
      <CardContent>
        <Stack gap="medium">
          <div>
            <StatusBadge status={app.limitGate} tones={{ "Within limit": "success", "Not checked": "neutral", "Breach — sector": "danger", "Breach — single obligor": "danger" }} />
          </div>
          <ProgressBar value={Math.min(1, gate.solUtilisation)} tone={tone(gate.solUtilisation)} label={`Single obligor: ${moneyShort(gate.obligorTotal)} of ${moneyShort(gate.solLimit)}`} showValue />
          <ProgressBar value={Math.min(1, gate.sectorUtilisation)} tone={tone(gate.sectorUtilisation)} label={`${gate.sector?.name ?? "Sector"}: ${moneyShort(gate.sectorExposure)} of ${moneyShort(gate.sectorLimit)}`} showValue />
          <DescriptionList
            columns={2}
            items={[
              { label: "Existing obligor exposure", value: moneyShort(gate.obligorExposure), mono: true, hint: `Off-balance-sheet lines weighted ${getRule<number>("origination.offBalanceWeightPct")}% (CBN 3.2(b))` },
              { label: "This request (weighted)", value: moneyShort(gate.weightedRequest), mono: true },
              { label: "Single-obligor limit", value: moneyShort(gate.solLimit), mono: true, hint: `${getRule<number>("origination.singleObligorPct")}% of shareholders' funds ${moneyShort(getRule<number>("platform.shareholdersFundsNgn"))} (${TENANT_PARAM_NOTE.toLowerCase()})` },
              { label: "Large exposure", value: gate.largeExposure ? `Yes — ≥ ${getRule<number>("origination.largeExposurePct")}% of shareholders' funds` : "No", hint: "CBN 3.2(d)" },
              { label: "Sector limit", value: `${gate.sector?.limitPct ?? "—"}% of loan book`, hint: `Book ${moneyShort(gate.bookSize)} · tenant sectoral policy (CBN 3.3)` },
              { label: "Sector utilisation", value: pct(gate.sectorUtilisation * 100), mono: true },
            ]}
          />
          {app.limitGate !== "Not checked" && gate.result !== app.limitGate ? (
            <Alert tone="info" title="Live position has moved since the last check">
              Recorded result: {app.limitGate}. On today&apos;s book the request would be: {gate.result}. Re-run the check before submitting to the next tier.
            </Alert>
          ) : null}
          {isBreach(app.limitGate) ? (
            c.extra.exception ? (
              <Alert tone={c.extra.exception.decision === "granted" ? "success" : "danger"} title={`Exception ${c.extra.exception.decision} by ${c.extra.exception.by}`}>
                {c.extra.exception.comment} · {dateTime(c.extra.exception.at)}
              </Alert>
            ) : (
              <Alert tone="danger" title="Breach — progression blocked">
                Needs an informed exception decision from the CRO / Board (Operations → Approvals) rather than silently failing.
              </Alert>
            )
          ) : null}
          {pendingException ? <PendingOperation instance={pendingException} title="Limit exception awaiting decision" actionLabels={{ approve: "Grant exception", decline: "Refuse — decline request" }} /> : null}
          {canRequestException ? (
            <Stack gap="small">
              <Field label="Exception justification" htmlFor="exc-justification" required description={`Sent to the exception approvers through Operations. At least ${minComment} characters.`}>
                <Textarea id="exc-justification" rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} />
              </Field>
              <div>
                <Button
                  variant="secondary"
                  disabled={justification.trim().length < minComment}
                  onClick={async () => {
                    const res = await requestLimitException(app.id, justification.trim());
                    if (res.ok) setJustification("");
                    toast(res.ok ? { title: "Exception requested", description: "Routed to the CRO / Board in Operations.", tone: "success" } : { title: "Not requested", description: res.reason, tone: "danger" });
                  }}
                >
                  Request limit exception
                </Button>
              </div>
            </Stack>
          ) : null}
          <Text variant="caption" tone="muted">
            Limits are maintained in{" "}
            <TextLink as={Link} href={PARAMS_HREF}>
              Operations → Business rules
            </TextLink>
            .
          </Text>
        </Stack>
      </CardContent>
    </Card>
  );
}

function CovenantCard({ c }: { c: AppCtx }) {
  const { app, clauses } = c;
  const canTag = c.canEdit && inGroup("recommenders", c.roleId) && ["Analysis", "Recommendation", "Approval"].includes(app.stage);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const saved = clauses.filter((k) => app.covenants.includes(k.text));
    // Nothing from the library saved yet → start from the auto-tagged suggestion.
    return new Set((saved.length ? saved : clauses).map((k) => k.id));
  });
  const { toast } = useToast();
  const custom = app.covenants.filter((t) => !clauses.some((k) => k.text === t));
  const groups = ["Conditions precedent", "General covenants"] as const;
  return (
    <Card>
      <CardHeader>
        <Stack direction="horizontal" justify="between" align="start" wrap gap="medium">
          <div>
            <CardTitle>Covenant & condition tagging</CardTitle>
            <CardDescription>Auto-tagged from the master conditions / covenants library based on product, sector, tenor, collateral type and 360 RAR posture. Tagged clauses carry into the offer letter.</CardDescription>
          </div>
          {canTag ? (
            <Stack direction="horizontal" gap="small" wrap>
              <Button variant="tertiary" onClick={() => setSelected(new Set(clauses.map((k) => k.id)))}>
                Select all suggested
              </Button>
              <Button
                onClick={async () => {
                  const texts = [...custom, ...clauses.filter((k) => selected.has(k.id)).map((k) => k.text)];
                  const res = await recordChange(app.id, { point: "covenants.tag", event: "origination.covenants.tagged", action: "Tagged covenants and conditions for offer letter", changes: { covenants: texts }, before: `${app.covenants.length} clauses`, after: `${texts.length} clauses`, payload: { count: texts.length } });
                  toast(res.ok ? { title: "Covenants saved", description: `${texts.length} clauses will flow to the offer letter.`, tone: "success" } : { title: "Not saved", description: res.reason, tone: "danger" });
                }}
              >
                Save to application
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </CardHeader>
      <CardContent>
        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          {groups.map((g) => (
            <Stack key={g} gap="small">
              <Text variant="eyebrow">{g}</Text>
              {clauses
                .filter((k) => k.library === g)
                .map((k) => (
                  <Stack key={k.id} direction="horizontal" gap="small" align="start">
                    <Checkbox
                      aria-label={k.text}
                      checked={selected.has(k.id)}
                      disabled={!canTag}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(k.id);
                        else next.delete(k.id);
                        setSelected(next);
                      }}
                    />
                    <Stack gap="none">
                      <Text variant="small">
                        <strong>{k.category}.</strong> {k.text}
                      </Text>
                      <Text variant="caption" tone="muted">
                        Tagged because: {k.reason}
                      </Text>
                    </Stack>
                  </Stack>
                ))}
            </Stack>
          ))}
        </Grid>
        {custom.length ? (
          <Stack gap="small" className="mt-6">
            <Text variant="eyebrow">Other conditions on file</Text>
            <Stack direction="horizontal" gap="small" wrap>
              {custom.map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
            </Stack>
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  );
}
