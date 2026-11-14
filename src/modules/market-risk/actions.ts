"use client";

/**
 * Market & Liquidity Risk actions (invariant 9): every state change runs its `.before` hook (vetoes honoured),
 * writes the audit log, publishes a domain event, notifies, then runs its `.after` hook. Anything needing
 * approval is submitted to the Operations workflow (types registered in ./platform.ts).
 */
import { useDb, newId } from "@/lib/data/store";
import { roleById, type RoleId } from "@/lib/rbac/roles";
import { publish } from "@/lib/platform/events";
import { runHooks } from "@/lib/platform/hooks";
import { notify } from "@/lib/platform/notifications";
import { submitOperation, type SubmitResult } from "@/lib/platform/operations";
import { getRule } from "@/lib/platform/rules";
import { currentActor } from "@/lib/platform/scope";
import { escalationRoles, type Breach, type EarlyWarning, type StressAssumptions, type StressResult } from "./data";
import { RAS_METRICS, useMarketRisk, type RasValues, type RiskFactor, type SavedRun } from "./store";

const M = "market-risk";
export type ActionResult = { ok: true } | { ok: false; reason: string };

function audit(action: string, entityType: string, entityId: string, before?: string, after?: string) {
  const a = currentActor();
  useDb.getState().log({ actorId: a.id, actorName: a.name, roleId: a.roleId, action, entityType, entityId, before, after });
}
const alertRoles = () => getRule<string[]>("market-risk.alertRoles") as RoleId[];
export const roleName = (id: string) => roleById[id as RoleId]?.name ?? id;

async function guarded<C>(point: string, ctx: C, run: (ctx: C) => void | Promise<void>): Promise<ActionResult> {
  const before = await runHooks(`market-risk.${point}.before`, ctx);
  if (!before.ok) return { ok: false, reason: `Blocked by ${before.vetoedBy}: ${before.reason}` };
  await run(before.ctx);
  await runHooks(`market-risk.${point}.after`, before.ctx);
  return { ok: true };
}

/** Current RAS thresholds from business rules. */
export function rasValues(): RasValues {
  return Object.fromEntries(
    RAS_METRICS.map((m) => [m.id, { earlyWarning: getRule<number>(`market-risk.ras.${m.id}.earlyWarning`), buffer: getRule<number>(`market-risk.ras.${m.id}.buffer`) }]),
  );
}

// ---------------------------------------------------------------- breaches

export type BreachInput = Pick<Breach, "metric" | "desk" | "actual" | "limit" | "utilisation">;

/** Raise a limit breach (auto-detected or by the analyst); it starts at the first escalation level. */
export function raiseBreach(input: BreachInput, source: "limit" | "early-warning" = "limit", ew?: EarlyWarning) {
  const actor = currentActor();
  const levelRole = escalationRoles()[0] ?? "market-risk-analyst";
  const breach: Breach = { id: newId("BR"), at: new Date().toISOString(), ...input, levelRole, status: "Open", raisedBy: actor.name };
  return guarded("breach.raise", { breach, source }, ({ breach: b }) => {
    useMarketRisk.getState().addBreach(b);
    audit("Raised market-risk limit breach", "LimitBreach", b.id, undefined, `${b.metric} · ${b.desk}: ${b.actual} vs ${b.limit}`);
    publish("market-risk.breach.raised", { module: M, subject: { type: "LimitBreach", id: b.id, title: b.metric, href: "/market-risk" }, payload: { ...input, source } });
    if (source === "early-warning" && ew) {
      publish("market-risk.early-warning.triggered", { module: M, subject: { type: "EarlyWarning", id: ew.id, title: ew.trigger, href: "/market-risk/liquidity" }, payload: { current: ew.current, limit: ew.limit } });
      notify({ templateId: "market-risk.early-warning-triggered", toRoles: alertRoles(), href: "/market-risk/liquidity", data: { trigger: ew.trigger, threshold: ew.threshold, current: `${ew.current} ${ew.unit}` } });
    } else {
      notify({ templateId: "market-risk.breach-raised", toRoles: alertRoles(), href: "/market-risk", data: { ...input, actual: b.actual, level: roleName(levelRole) } });
    }
  });
}

export function escalateBreach(b: Breach) {
  const ladder = escalationRoles();
  const idx = ladder.indexOf(b.levelRole);
  const next = ladder[Math.min(ladder.length - 1, idx + 1)];
  if (!next || next === b.levelRole) return Promise.resolve<ActionResult>({ ok: false, reason: "Already at the top of the escalation ladder." });
  const actor = currentActor();
  return guarded("breach.escalate", { breach: b, to: next }, ({ to }) => {
    useMarketRisk.getState().setBreach(b.id, { levelRole: to, status: "Escalated" });
    audit("Escalated market-risk limit breach", "LimitBreach", b.id, `${b.status} · ${roleName(b.levelRole)}`, `Escalated · ${roleName(to)}`);
    publish("market-risk.breach.escalated", { module: M, subject: { type: "LimitBreach", id: b.id, title: b.metric, href: "/market-risk" }, payload: { from: b.levelRole, to } });
    notify({ templateId: "market-risk.breach-escalated", toRoles: [to as RoleId], href: "/market-risk", data: { metric: b.metric, desk: b.desk, actual: b.actual, limit: b.limit, level: roleName(to), by: actor.name } });
  });
}

/** Breach closure is an approval: routed to Operations ("market-risk.breach.close"). */
export async function requestBreachClose(b: Breach, note: string): Promise<SubmitResult> {
  const hook = await runHooks("market-risk.breach.close.before", { breach: b, note });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const res = await submitOperation("market-risk.breach.close", {
    title: `Close breach ${b.id}: ${b.metric} — ${b.desk}`,
    subject: { type: "LimitBreach", id: b.id, title: b.metric, href: "/market-risk" },
    payload: { breachId: b.id, note: hook.ctx.note },
    summary: [
      { label: "Metric", value: b.metric },
      { label: "Desk", value: b.desk },
      { label: "Actual vs limit", value: `${b.actual} / ${b.limit}` },
      { label: "Resolution", value: hook.ctx.note },
    ],
  });
  if (res.ok) {
    audit("Requested closure of limit breach", "LimitBreach", b.id, b.status, `Close requested: ${note}`);
    publish("market-risk.breach.close-requested", { module: M, subject: { type: "LimitBreach", id: b.id, title: b.metric }, payload: { operationId: res.instance.id } });
    await runHooks("market-risk.breach.close.after", { breach: b, operationId: res.instance.id });
  }
  return res;
}

// ---------------------------------------------------------------- ILAAP

export async function requestRasChange(values: RasValues, note: string): Promise<SubmitResult> {
  const s = useMarketRisk.getState();
  const current = s.rasVersions[0]!;
  const [maj, min] = current.version.split(".").map(Number);
  const version = `${maj}.${(min ?? 0) + 1}`;
  const before = rasValues();
  const changes = RAS_METRICS.flatMap((m) =>
    (["earlyWarning", "buffer"] as const).filter((k) => before[m.id]![k] !== values[m.id]![k]).map((k) => `${m.metric} ${k === "buffer" ? "buffer" : "early warning"}: ${before[m.id]![k]} → ${values[m.id]![k]}`),
  );
  const hook = await runHooks("market-risk.ras.change.before", { version, values, note });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const res = await submitOperation("market-risk.ras.change", {
    title: `Liquidity RAS v${version}`,
    subject: { type: "IlaapRas", id: "RAS", title: "Liquidity Risk Appetite Statement", href: "/market-risk/ilaap" },
    payload: { version, note, values: hook.ctx.values },
    summary: [{ label: "Version", value: `v${current.version} → v${version}` }, { label: "Rationale", value: note }, ...changes.map((c) => ({ label: "Change", value: c }))],
  });
  if (res.ok) {
    audit("Submitted Risk Appetite Statement change", "IlaapRas", `RAS v${version}`, `v${current.version}`, changes.join("; "));
    publish("market-risk.ras.change-requested", { module: M, subject: { type: "IlaapRas", id: version, title: `RAS v${version}` }, payload: { changes, operationId: res.instance.id } });
    await runHooks("market-risk.ras.change.after", { version, operationId: res.instance.id });
  }
  return res;
}

export function setRiskFactorRelevance(f: RiskFactor, relevance: RiskFactor["relevance"]) {
  return guarded("risk-factor.rescore", { factor: f, relevance }, ({ relevance: r }) => {
    useMarketRisk.getState().setRelevance(f.id, r);
    audit("Changed ILAAP risk-factor relevance", "IlaapRiskFactor", f.id, f.relevance, r);
    publish("market-risk.risk-factor.rescored", { module: M, subject: { type: "IlaapRiskFactor", id: f.id, title: f.factor }, payload: { before: f.relevance, after: r } });
  });
}

export function setChapterReviewed(id: string, title: string, done: boolean) {
  const s = useMarketRisk.getState();
  const before = s.chapters[id] ? "met" : "pending";
  useMarketRisk.getState().setChapter(id, done);
  audit("Updated ILAAP chapter status", "IlaapChapter", id, before, done ? "met" : "pending");
  publish("market-risk.ilaap-chapter.updated", { module: M, subject: { type: "IlaapChapter", id, title }, payload: { reviewed: done } });
}

export function compileIlaap(chaptersDone: number, chaptersTotal: number) {
  const actor = currentActor();
  const s = useMarketRisk.getState();
  const rasVersion = s.rasVersions[0]!.version;
  const entry = { id: newId("ILAAP"), at: new Date().toISOString(), by: actor.name, rasVersion };
  return guarded("ilaap.compile", entry, (e) => {
    useMarketRisk.getState().addCompiled(e);
    audit("Compiled ILAAP report", "IlaapDocument", `ILAAP-${s.ilaap.period}`, undefined, `Compiled with RAS v${rasVersion}; ${chaptersDone}/${chaptersTotal} chapters complete`);
    publish("market-risk.ilaap.compiled", { module: M, subject: { type: "IlaapDocument", id: s.ilaap.period, title: `ILAAP ${s.ilaap.period}` }, payload: { rasVersion, chaptersDone, chaptersTotal } });
  });
}

/** Submit the ILAAP into its sign-off chain (Operations: "market-risk.ilaap.signoff"). */
export async function submitIlaap(): Promise<SubmitResult> {
  const s = useMarketRisk.getState();
  const rasVersion = s.rasVersions[0]!.version;
  const hook = await runHooks("market-risk.ilaap.submit.before", { period: s.ilaap.period, rasVersion, chapters: s.chapters });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const res = await submitOperation("market-risk.ilaap.signoff", {
    title: `ILAAP ${s.ilaap.period} sign-off`,
    subject: { type: "IlaapDocument", id: s.ilaap.period, title: `ILAAP ${s.ilaap.period}`, href: "/market-risk/ilaap" },
    payload: { period: s.ilaap.period, rasVersion },
    summary: [
      { label: "Period", value: s.ilaap.period },
      { label: "RAS in force", value: `v${rasVersion}` },
      { label: "Last compiled", value: s.compiled[0] ? new Date(s.compiled[0].at).toUTCString() : "Not compiled" },
    ],
  });
  if (res.ok) {
    if (!res.applied) useMarketRisk.getState().setIlaap({ status: "In review", operationId: res.instance.id });
    audit("Submitted ILAAP for sign-off", "IlaapDocument", `ILAAP-${s.ilaap.period}`, s.ilaap.status, "In review");
    publish("market-risk.ilaap.submitted", { module: M, subject: { type: "IlaapDocument", id: s.ilaap.period, title: `ILAAP ${s.ilaap.period}` }, payload: { operationId: res.instance.id } });
    await runHooks("market-risk.ilaap.submit.after", { period: s.ilaap.period, operationId: res.instance.id });
  }
  return res;
}

// ---------------------------------------------------------------- stress testing

export function saveStressRun(name: string, assumptions: StressAssumptions, result: StressResult) {
  const actor = currentActor();
  const run: SavedRun = { id: newId("LST"), at: new Date().toISOString(), by: actor.name, byId: actor.id, name, assumptions, lcr: result.lcr, survivalDays: result.survivalDays, minBuffer: result.minBuffer };
  return guarded("stress.run", run, (r) => {
    useMarketRisk.getState().addRun(r);
    audit("Ran liquidity stress test", "LiquidityStressRun", r.id, undefined, `${r.name}: LCR ${r.lcr.toFixed(0)}%, survival ${r.survivalDays ?? "> horizon"} days; assumptions ${JSON.stringify(r.assumptions)}`);
    publish("market-risk.stress-run.saved", { module: M, subject: { type: "LiquidityStressRun", id: r.id, title: r.name, href: "/market-risk/stress-testing" }, payload: { lcr: r.lcr, survivalDays: r.survivalDays } });
  });
}

export async function requestStressApproval(r: SavedRun): Promise<SubmitResult> {
  const hook = await runHooks("market-risk.stress.approve.before", { run: r });
  if (!hook.ok) return { ok: false, reason: `Blocked by ${hook.vetoedBy}: ${hook.reason}` };
  const res = await submitOperation("market-risk.stress.approve", {
    title: `Stress scenario: ${r.name}`,
    subject: { type: "LiquidityStressRun", id: r.id, title: r.name, href: "/market-risk/stress-testing" },
    payload: { runId: r.id, name: r.name, assumptions: r.assumptions, lcr: r.lcr, survivalDays: r.survivalDays },
    summary: [
      { label: "Band", value: `${r.assumptions.band}${r.assumptions.dynamic ? " (dynamic)" : ""}` },
      { label: "Stressed LCR", value: `${r.lcr.toFixed(0)}%` },
      { label: "Survival", value: r.survivalDays === null ? "Beyond horizon" : `${r.survivalDays} days` },
      { label: "Run-off R / C / W", value: `${r.assumptions.retailRunOff} / ${r.assumptions.corporateRunOff} / ${r.assumptions.wholesaleWithdrawal}%` },
    ],
  });
  if (res.ok) {
    audit("Submitted stress scenario for approval", "LiquidityStressRun", r.id, undefined, "Pending approval");
    publish("market-risk.stress-run.submitted", { module: M, subject: { type: "LiquidityStressRun", id: r.id, title: r.name }, payload: { operationId: res.instance.id } });
    await runHooks("market-risk.stress.approve.after", { run: r, operationId: res.instance.id });
  }
  return res;
}
