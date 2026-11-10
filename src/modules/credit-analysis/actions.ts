"use client";

/**
 * Credit Analysis actions called by pages. Approvals go through the Operations workflow (operation types in
 * ./platform.ts); direct actions (refresh) run hook points, audit and publish events themselves.
 */
import { DEMO_NOW } from "@/lib/data/seed";
import { useDb } from "@/lib/data/store";
import type { Obligor } from "@/lib/data/types";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { submitOperation } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import { currentActor } from "@/lib/platform/scope";
import { CORPUS_VERSION } from "./data";
import { assess, type GatingCheck, type ParamOverride } from "./logic";
import { commitScores, MODULE, OP_ADVISORY, OP_ENRICHMENT, OP_GATING, type AdvisoryPayload, type EnrichmentChange, type EnrichmentPayload, type GatingOverridePayload } from "./platform";
import { useCreditAnalysis } from "./store";

export type ActionResult = { ok: true; message: string; operationId?: string } | { ok: false; reason: string };

const assessmentHref = (id: string) => `/credit-analysis/assessment?id=${encodeURIComponent(id)}`;
const subjectOf = (o: Pick<Obligor, "id" | "name">) => ({ type: "Obligor", id: o.id, title: o.name, href: assessmentHref(o.id) });

/** Operation subject types (distinct so `usePendingFor` finds the right open request). */
export const SUBJECT_ENRICHMENT = "360 RAR assessment";
export const SUBJECT_ADVISORY = "360 RAR advisory note";
export const SUBJECT_GATING = "Life-cycle gating exception";

/** Submit analyst enrichment adjustments for second-analyst / CCO approval (rar.enrichment-change). */
export async function submitEnrichmentChange(input: {
  obligor: Obligor;
  overrides: Record<string, ParamOverride>;
  changes: EnrichmentChange[];
  rationale: string;
  beforeLabel: string;
  previewLabel: string;
}): Promise<ActionResult> {
  const min = getRule<number>("credit-analysis.enrichment.minRationale");
  if (input.rationale.trim().length < min) return { ok: false, reason: `Record a rationale of at least ${min} characters — every analyst adjustment is kept in the audit trail with its reason.` };
  if (!input.changes.length) return { ok: false, reason: "No parameter scores changed." };
  const { obligor } = input;
  const actor = currentActor();
  const payload: EnrichmentPayload = {
    obligorId: obligor.id,
    obligorName: obligor.name,
    overrides: input.overrides,
    changes: input.changes,
    rationale: input.rationale.trim(),
    beforeLabel: input.beforeLabel,
    previewLabel: input.previewLabel,
  };
  const hook = await runHooks("credit-analysis.enrichment.submit.before", { obligor, payload, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const p = hook.ctx.payload;
  const res = await submitOperation<EnrichmentPayload>(OP_ENRICHMENT, {
    title: `360 RAR enrichment — ${obligor.name} (${p.changes.length} parameter${p.changes.length === 1 ? "" : "s"})`,
    subject: { ...subjectOf(obligor), type: SUBJECT_ENRICHMENT },
    payload: p,
    summary: [
      { label: "Obligor", value: `${obligor.name} (${obligor.id})` },
      { label: "Changes", value: p.changes.map((c) => `${c.id} ${c.name}: ${c.before.toFixed(1)} → ${c.after.toFixed(1)}`).join("; ") },
      { label: "Posture now", value: p.beforeLabel },
      { label: "Posture if approved", value: p.previewLabel },
      { label: "Rationale", value: p.rationale },
    ],
  });
  if (!res.ok) return res;
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action: "Submitted 360 RAR enrichment adjustments for approval", entityType: "Obligor", entityId: obligor.id, before: p.beforeLabel, after: `${p.previewLabel} (pending ${res.instance.id})` });
  publish("credit-analysis.enrichment.submitted", { module: MODULE, subject: subjectOf(obligor), payload: { obligorId: obligor.id, changes: p.changes.length, operationId: res.instance.id } });
  await runHooks("credit-analysis.enrichment.submit.after", { obligor, payload: p, operationId: res.instance.id });
  return res.applied
    ? { ok: true, message: `Applied ${p.changes.length} adjustment${p.changes.length === 1 ? "" : "s"} (approval workflow disabled).`, operationId: res.instance.id }
    : { ok: true, message: `Submitted ${p.changes.length} adjustment${p.changes.length === 1 ? "" : "s"} for second-analyst / CCO approval. Scores change once approved.`, operationId: res.instance.id };
}

/** Refresh an assessment: re-read feeds, recompute the posture with current rules and approved overrides. */
export async function refreshAssessment(obligor: Obligor): Promise<ActionResult> {
  const actor = currentActor();
  const hook = await runHooks("credit-analysis.assessment.refresh.before", { obligor, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const at = DEMO_NOW.toISOString();
  const overrides = useCreditAnalysis.getState().overrides[obligor.id] ?? {};
  const a = assess(obligor, overrides, at);
  const { before, after } = await commitScores(obligor, a.scores, `Assessment refreshed by ${actor.name}`, at);
  useDb.getState().log({
    actorId: actor.id,
    actorName: actor.name,
    roleId: actor.roleId,
    action: "Refreshed 360 RAR assessment",
    entityType: "Obligor",
    entityId: obligor.id,
    before: `${obligor.rarUpdatedAt.slice(0, 10)} · ${before.label}`,
    after: `${at.slice(0, 10)} · ${after.label} (CBA, bureau/CRMS, NGX corpus ${CORPUS_VERSION}, macro feed re-read)`,
  });
  publish("credit-analysis.assessment.refreshed", { module: MODULE, subject: subjectOf(obligor), payload: { obligorId: obligor.id, posture: after.label, previous: before.label, previousRefresh: obligor.rarUpdatedAt } });
  await runHooks("credit-analysis.assessment.refresh.after", { obligorId: obligor.id, scores: a.scores, posture: after.label });
  return { ok: true, message: `Assessment refreshed — all feeds re-read and the posture recomputed: ${after.label}.` };
}

/** Submit the advisory note for sign-off (rar.advisory-signoff). */
export async function submitAdvisorySignOff(obligor: Obligor, text: string, postureLabel: string, draft: string): Promise<ActionResult> {
  if (!text.trim()) return { ok: false, reason: "The advisory note is empty." };
  const actor = currentActor();
  const payload: AdvisoryPayload = { obligorId: obligor.id, obligorName: obligor.name, text, postureLabel, editedByAnalyst: text !== draft };
  const hook = await runHooks("credit-analysis.advisory.submit.before", { obligor, payload, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const p = hook.ctx.payload;
  const res = await submitOperation<AdvisoryPayload>(OP_ADVISORY, {
    title: `Advisory note sign-off — ${obligor.name}`,
    subject: { ...subjectOf(obligor), type: SUBJECT_ADVISORY, href: `${assessmentHref(obligor.id)}&tab=advisory` },
    payload: p,
    summary: [
      { label: "Obligor", value: `${obligor.name} (${obligor.id})` },
      { label: "Posture", value: p.postureLabel },
      { label: "Edited by analyst", value: p.editedByAnalyst ? "Yes" : "No — AI draft as generated" },
      { label: "Note", value: p.text },
    ],
  });
  if (!res.ok) return res;
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action: "Submitted 360 RAR advisory note for sign-off", entityType: "Obligor", entityId: obligor.id, after: `${p.postureLabel} · ${p.text.length} chars (pending ${res.instance.id})` });
  publish("credit-analysis.advisory.submitted", { module: MODULE, subject: subjectOf(obligor), payload: { obligorId: obligor.id, posture: p.postureLabel, operationId: res.instance.id } });
  await runHooks("credit-analysis.advisory.submit.after", { obligor, payload: p, operationId: res.instance.id });
  return { ok: true, message: res.applied ? "Advisory note signed off (approval workflow disabled)." : "Advisory note submitted for sign-off by a second analyst / the CCO.", operationId: res.instance.id };
}

/** Request a CCO/CRO override of a life-cycle gating hard exception (rar.gating-override). */
export async function requestGatingOverride(obligor: Obligor, g: GatingCheck, rationale: string): Promise<ActionResult> {
  const min = getRule<number>("credit-analysis.enrichment.minRationale");
  if (rationale.trim().length < min) return { ok: false, reason: `Document the rationale (at least ${min} characters).` };
  const actor = currentActor();
  const payload: GatingOverridePayload = { obligorId: obligor.id, obligorName: obligor.name, applicationId: g.applicationId, tenorMonths: g.tenorMonths, purpose: g.purpose, stage: g.stage ?? "n/a", rationale: rationale.trim() };
  const hook = await runHooks("credit-analysis.gating-override.submit.before", { obligor, payload, actor });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const p = hook.ctx.payload;
  const res = await submitOperation<GatingOverridePayload>(OP_GATING, {
    title: `Life-cycle gating override — ${p.applicationId} (${obligor.name})`,
    subject: { type: SUBJECT_GATING, id: p.applicationId, title: `${obligor.name} · ${p.applicationId}`, href: `${assessmentHref(obligor.id)}&tab=advisory` },
    payload: p,
    summary: [
      { label: "Application", value: p.applicationId },
      { label: "Request", value: `${p.tenorMonths}-month ${p.purpose}` },
      { label: "Industry stage", value: p.stage },
      { label: "Rationale", value: p.rationale },
    ],
  });
  if (!res.ok) return res;
  useDb.getState().log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action: `Requested Industry Life-Cycle gating override for ${p.applicationId}`, entityType: "Obligor", entityId: obligor.id, after: `${p.rationale} (pending ${res.instance.id})` });
  publish("credit-analysis.gating-override.requested", { module: MODULE, subject: subjectOf(obligor), payload: { obligorId: obligor.id, applicationId: p.applicationId, operationId: res.instance.id } });
  await runHooks("credit-analysis.gating-override.submit.after", { obligor, payload: p, operationId: res.instance.id });
  return { ok: true, message: res.applied ? "Gating override applied (approval workflow disabled)." : "Override requested from the CCO / CRO.", operationId: res.instance.id };
}
