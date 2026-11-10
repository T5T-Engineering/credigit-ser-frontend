"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Pencil, RefreshCw, Send, SearchX, Undo2, X } from "lucide-react";
import { Alert, Button, EmptyState, EntityHeader, Field, Skeleton, Stack, Tabs, Textarea } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useApplications, useFacilities, useLookups, useObligor, useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { useCan, useHydrated } from "@/lib/auth/session";
import { usePendingFor } from "@/lib/platform/operations";
import { useRule, useRulesStore } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import { date, dateTime } from "@/lib/format";
import type { Obligor } from "@/lib/data/types";
import { walletFor } from "../data";
import {
  ageDays,
  assess,
  axisHistory,
  baselineScores,
  bookPeers,
  gatingChecks,
  interpretiveCell,
  ratioBenchmarks,
  ratioTrends,
  weightingText,
  type ParamOverride,
} from "../logic";
import { parameters } from "../parameters";
import { useGatingOverrides, useOverrides } from "../store";
import { refreshAssessment, submitEnrichmentChange, SUBJECT_ENRICHMENT } from "../actions";
import { PostureBadge } from "../shared";
import { OverviewTab } from "../assessment/overview-tab";
import { ParametersTab } from "../assessment/parameters-tab";
import { TrendTab } from "../assessment/trend-tab";
import { PeersTab } from "../assessment/peers-tab";
import { AdvisoryTab } from "../assessment/advisory-tab";

export function AssessmentPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-3xl" />}>
      <AssessmentRoute />
    </Suspense>
  );
}

function AssessmentRoute() {
  const params = useSearchParams();
  const id = params.get("id");
  const tab = params.get("tab");
  const hydrated = useHydrated();
  const obligor = useObligor(id);
  if (!hydrated) {
    return (
      <ModulePage module="credit-analysis" hideTabs title="360 RAR assessment">
        <Skeleton className="h-96 w-full rounded-3xl" />
      </ModulePage>
    );
  }
  if (!obligor) {
    return (
      <ModulePage module="credit-analysis" hideTabs title="360 RAR assessment">
        <EmptyState
          icon={<SearchX aria-hidden />}
          title="Assessment not found"
          description={id ? `No obligor with ID ${id} exists in this tenant.` : "Open an assessment from the list to see its 360 RAR reading."}
          action={
            <Button href="/credit-analysis" as={Link}>
              All assessments
            </Button>
          }
        />
      </ModulePage>
    );
  }
  return <AssessmentView key={obligor.id} obligor={obligor} initialTab={tab && TABS.includes(tab) ? tab : "overview"} initialEdit={params.get("edit") === "1"} />;
}

const TABS = ["overview", "parameters", "trend", "peers", "advisory"];

function AssessmentView({ obligor, initialTab, initialEdit }: { obligor: Obligor; initialTab: string; initialEdit: boolean }) {
  const canEdit = useCan("credit-analysis", "edit");
  const { actor } = useScope();
  const { sector, user: userById } = useLookups();
  const allObligors = useObligors();
  const facilities = useFacilities();
  const applications = useApplications();
  const saved = useOverrides(obligor.id);
  const gatingOverrides = useGatingOverrides();
  const pendingEnrichment = usePendingFor(SUBJECT_ENRICHMENT, obligor.id);
  // Re-derive when tenant business rules change (all thresholds are read at call time).
  const ruleValues = useRulesStore((s) => s.values);
  const staleAfter = useRule<number>("credit-analysis.staleAfterDays");
  const minRationale = useRule<number>("credit-analysis.enrichment.minRationale");

  const startInEdit = initialEdit && canEdit && !pendingEnrichment;
  const [tab, setTab] = useState(startInEdit ? "parameters" : initialTab);
  const [editing, setEditing] = useState(startInEdit);
  const [draft, setDraft] = useState<Record<string, string>>(() => (startInEdit ? Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, String(v.score)])) : {}));
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const baseline = useMemo(() => baselineScores(obligor), [obligor]);

  /** Saved overrides merged with the in-progress edit (live preview). */
  const effectiveOverrides = useMemo(() => {
    if (!editing) return saved;
    const out: Record<string, ParamOverride> = { ...saved };
    for (const [pid, raw] of Object.entries(draft)) {
      const v = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(v)) {
        delete out[pid];
        continue;
      }
      const score = Math.round(Math.min(10, Math.max(1, v)) * 10) / 10;
      if (Math.abs(score - baseline[pid]!) < 1e-9) delete out[pid];
      else if (saved[pid] && Math.abs(saved[pid].score - score) < 1e-9) out[pid] = saved[pid];
      else
        out[pid] = {
          score,
          rationale: rationale || saved[pid]?.rationale || "",
          by: actor.name,
          at: DEMO_NOW.toISOString(),
        };
    }
    return out;
  }, [editing, saved, draft, baseline, rationale, actor.name]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- ruleValues: recompute when business rules change
  const a = useMemo(() => assess(obligor, effectiveOverrides), [obligor, effectiveOverrides, ruleValues]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ruleValues: recompute when business rules change
  const committed = useMemo(() => assess(obligor, saved), [obligor, saved, ruleValues]);
  const cell = useMemo(() => (a.position.neutral ? null : interpretiveCell(a.position.base, a.scores)), [a]);
  const trends = useMemo(() => ratioTrends(a), [a]);
  const history = useMemo(() => axisHistory(a), [a]);
  const benchmarks = useMemo(() => ratioBenchmarks(a), [a]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ruleValues: recompute when business rules change
  const peers = useMemo(() => bookPeers(obligor, allObligors), [obligor, allObligors, ruleValues]);
  const tenantOutstanding = useMemo(
    () => facilities.filter((f) => f.obligorId === obligor.id && f.status !== "Closed" && f.status !== "Written off").reduce((s, f) => s + f.outstanding, 0),
    [facilities, obligor.id],
  );
  const wallet = useMemo(() => walletFor(obligor.id, obligor.verifiedTurnover, tenantOutstanding), [obligor.id, obligor.verifiedTurnover, tenantOutstanding]);
  const gating = useMemo(() => gatingChecks(a, applications), [a, applications]);
  const openExceptions = gating.filter((g) => g.flagged && !gatingOverrides[g.applicationId]);

  const age = ageDays(obligor.rarUpdatedAt, DEMO_NOW);
  const stale = age > staleAfter;
  const sectorName = sector.get(obligor.sectorId)?.name ?? obligor.sectorId;
  const rm = userById.get(obligor.relationshipManagerId);
  const dirty = editing && JSON.stringify(effectiveOverrides) !== JSON.stringify(saved);

  function startEdit() {
    setDraft(Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, String(v.score)])));
    setRationale("");
    setError(null);
    setEditing(true);
    setTab("parameters");
  }

  function cancelEdit() {
    setEditing(false);
    setDraft({});
    setError(null);
  }

  async function submitEdit() {
    setSubmitting(true);
    const changed = parameters.filter((p) => (saved[p.id]?.score ?? baseline[p.id]) !== (effectiveOverrides[p.id]?.score ?? baseline[p.id]));
    const finalOverrides = Object.fromEntries(Object.entries(effectiveOverrides).map(([k, v]) => [k, changed.some((c) => c.id === k) ? { ...v, rationale: rationale.trim() } : v]));
    const res = await submitEnrichmentChange({
      obligor,
      overrides: finalOverrides,
      changes: changed.map((p) => ({ id: p.id, name: p.name, before: saved[p.id]?.score ?? baseline[p.id]!, after: effectiveOverrides[p.id]?.score ?? baseline[p.id]! })),
      rationale,
      beforeLabel: committed.position.label,
      previewLabel: a.position.label,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setEditing(false);
    setDraft({});
    setNotice(res.message);
  }

  async function refresh() {
    setRefreshing(true);
    setNotice(null);
    const res = await refreshAssessment(obligor);
    setRefreshing(false);
    if (res.ok) setNotice(res.message);
    else setError(res.reason);
  }

  return (
    <ModulePage
      module="credit-analysis"
      hideTabs
      title="360 RAR assessment"
      description="Four cardinal points, composite position, posture and advisory — every figure traceable to its source."
    >
      <Stack gap="large">
        <EntityHeader
          titleAs="h2"
          eyebrow={`${obligor.type} obligor`}
          title={obligor.name}
          identifier={obligor.id}
          identifierLabel="Obligor ID"
          status={<PostureBadge position={a.position} />}
          back={{ href: "/credit-analysis", label: "All assessments" }}
          linkComponent={Link}
          facts={[
            { label: "Sector", value: sectorName },
            { label: "NGX benchmark", value: a.ngx?.name ?? "No listed proxy" },
            { label: "Relationship manager", value: rm?.name ?? "—" },
            {
              label: "Internal grade (§6.2.7)",
              value: `${obligor.riskGrade} / 10`,
              mono: true,
            },
            { label: "COP ratio", value: a.cop.toFixed(2), mono: true },
            {
              label: "Last refreshed",
              value: `${date(obligor.rarUpdatedAt)} (${age}d)`,
              mono: true,
            },
          ]}
          actions={
            canEdit && !editing ? (
              <>
                <Button variant="tertiary" iconBefore={<Pencil aria-hidden />} onClick={startEdit} disabled={!!pendingEnrichment}>
                  Adjust enrichment inputs
                </Button>
                <Button iconBefore={<RefreshCw aria-hidden />} loading={refreshing} onClick={refresh}>
                  Refresh assessment
                </Button>
              </>
            ) : undefined
          }
        />

        {notice && (
          <Alert
            tone="success"
            title="Done"
            action={
              <Button variant="text" size="small" iconBefore={<X aria-hidden />} onClick={() => setNotice(null)}>
                Dismiss
              </Button>
            }
          >
            {notice}
          </Alert>
        )}
        {error && !editing && (
          <Alert tone="danger" title="Couldn’t complete that">
            {error}
          </Alert>
        )}
        {pendingEnrichment && (
          <Alert
            tone="info"
            title="Enrichment adjustments awaiting approval"
            action={
              <Button size="small" variant="tertiary" href={`/operations/item?id=${pendingEnrichment.id}`} as={Link}>
                Open request
              </Button>
            }
          >
            {pendingEnrichment.requestedBy.name} submitted {pendingEnrichment.title.replace(/^360 RAR enrichment — /, "")} for second-analyst / CCO approval ({pendingEnrichment.id}). Scores and
            posture change only once it is approved; further adjustments wait until it is decided.
          </Alert>
        )}
        {stale && !editing && (
          <Alert tone="warning" title={`Assessment is ${age} days old`}>
            Older than the {staleAfter}-day refresh cycle (tenant parameter).{" "}
            {canEdit ? "Refresh to re-read the CBA, bureau/CRMS, NGX corpus and macro feeds." : "A Credit Analyst can refresh it."}
          </Alert>
        )}
        {a.position.neutral && (
          <Alert tone="warning" title="Neutral / Transitional — mandatory analyst narrative">
            Magnitude {a.position.magnitude.toFixed(2)} is below the neutral threshold, so no posture-driven stance is generated (§6.2.5). The advisory note needs a Credit Analyst
            narrative.
          </Alert>
        )}
        {openExceptions.length > 0 && (
          <Alert
            tone="danger"
            title="Industry Life-Cycle gating — hard exception"
            action={
              <Button size="small" variant="tertiary" onClick={() => setTab("advisory")}>
                Review gating
              </Button>
            }
          >
            {openExceptions.map((g) => g.applicationId).join(", ")}: long-tenor expansion request in a {openExceptions[0]!.stage}-stage industry. CCO/CRO override with documented
            rationale is required before it passes the Credit Analyst tier (§6.2.6).
          </Alert>
        )}
        {editing && (
          <Alert
            tone="info"
            title="Edit mode — analyst enrichment inputs"
            action={
              <span className="flex flex-wrap gap-2">
                <Button
                  size="small"
                  variant="text"
                  iconBefore={<Undo2 aria-hidden />}
                  onClick={() => setDraft(Object.fromEntries(parameters.map((p) => [p.id, baseline[p.id]!.toFixed(1)])))}
                >
                  Restore system scores
                </Button>
                <Button size="small" variant="tertiary" onClick={cancelEdit}>
                  Discard
                </Button>
                <Button size="small" iconBefore={<Send aria-hidden />} onClick={submitEdit} disabled={!dirty} loading={submitting}>
                  Submit for approval
                </Button>
              </span>
            }
          >
            <Stack gap="small">
              <span>
                Adjust parameters that carry an analyst enrichment / survey source. The preview recalculates live: <strong>{a.position.label}</strong>
                {a.position.label !== committed.position.label ? ` (now ${committed.position.label})` : ""}. Adjustments are applied only after a second Credit Analyst or the CCO
                approves them in Operations.
              </span>
              <Field
                label="Rationale for the adjustment"
                required
                error={error ?? undefined}
                description={`At least ${minRationale} characters. Shown to the approver and kept in the audit trail with the before/after scores.`}
              >
                <Textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  rows={2}
                  placeholder="e.g. Management interview 4 Nov 2026 — new off-take agreement with two FMCG distributors"
                />
              </Field>
            </Stack>
          </Alert>
        )}

        <Tabs
          label="Assessment sections"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              id: "overview",
              label: "Radar & posture",
              content: <OverviewTab a={a} history={history} peers={peers} wallet={wallet} onOpenTab={setTab} />,
            },
            {
              id: "parameters",
              label: "Parameters & sources",
              badge: Object.keys(effectiveOverrides).length ? String(Object.keys(effectiveOverrides).length) : undefined,
              content: <ParametersTab a={a} editing={editing} draft={draft} setDraft={setDraft} />,
            },
            {
              id: "trend",
              label: "Trend & momentum",
              content: <TrendTab a={a} trends={trends} history={history} />,
            },
            {
              id: "peers",
              label: "Peer benchmarking",
              content: <PeersTab a={a} benchmarks={benchmarks} peers={peers} />,
            },
            {
              id: "advisory",
              label: "Advisory",
              content: <AdvisoryTab a={a} cell={cell} wallet={wallet} benchmarks={benchmarks} trends={trends} gating={gating} canEdit={canEdit} editing={editing} committedLabel={committed.position.label} />,
            },
          ]}
        />
        <p className="text-xs text-fg-subtle">
          Scores refreshed {dateTime(obligor.rarUpdatedAt)} · Weighting: {weightingText()} · Intensity thresholds, COP bands and scoring bands are tenant business rules (Operations →
          Business rules).
        </p>
      </Stack>
    </ModulePage>
  );
}
