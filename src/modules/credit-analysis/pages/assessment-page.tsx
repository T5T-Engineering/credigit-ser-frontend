"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Pencil, RefreshCw, Save, SearchX, Undo2, X } from "lucide-react";
import { Alert, Button, EmptyState, EntityHeader, Field, Skeleton, Stack, Tabs, Textarea } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useApplications, useDbActions, useFacilities, useLookups, useObligor, useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import { useCan, useHydrated, useRole, useSession } from "@/lib/auth/session";
import { date, dateTime } from "@/lib/format";
import type { Obligor } from "@/lib/data/types";
import { walletFor } from "../data";
import {
  ageDays,
  assess,
  axisHistory,
  baselineScores,
  bookPeers,
  interpretiveCell,
  ratioBenchmarks,
  ratioTrends,
  STALE_AFTER_DAYS,
  type GatingCheck,
  type ParamOverride,
} from "../logic";
import { parameters } from "../parameters";
import { useCreditAnalysis, useOverrides } from "../store";
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
const EXPANSION = /expansion|purchase of new|construction|production line/i;

function AssessmentView({ obligor, initialTab, initialEdit }: { obligor: Obligor; initialTab: string; initialEdit: boolean }) {
  const canEdit = useCan("credit-analysis", "edit");
  const user = useSession((s) => s.user);
  const role = useRole();
  const { update, log } = useDbActions();
  const { sector, user: userById } = useLookups();
  const allObligors = useObligors();
  const facilities = useFacilities();
  const applications = useApplications();
  const saved = useOverrides(obligor.id);
  const setOverrides = useCreditAnalysis((s) => s.setOverrides);

  const startInEdit = initialEdit && canEdit;
  const [tab, setTab] = useState(startInEdit ? "parameters" : initialTab);
  const [editing, setEditing] = useState(startInEdit);
  const [draft, setDraft] = useState<Record<string, string>>(() => (startInEdit ? Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, String(v.score)])) : {}));
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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
          by: user?.name ?? "Analyst",
          at: DEMO_NOW.toISOString(),
        };
    }
    return out;
  }, [editing, saved, draft, baseline, rationale, user]);

  const a = useMemo(() => assess(obligor, effectiveOverrides), [obligor, effectiveOverrides]);
  const committed = useMemo(() => assess(obligor, saved), [obligor, saved]);
  const cell = useMemo(() => (a.position.neutral ? null : interpretiveCell(a.position.base, a.scores)), [a]);
  const trends = useMemo(() => ratioTrends(a), [a]);
  const history = useMemo(() => axisHistory(a), [a]);
  const benchmarks = useMemo(() => ratioBenchmarks(a), [a]);
  const peers = useMemo(() => bookPeers(obligor, allObligors), [obligor, allObligors]);
  const tenantOutstanding = useMemo(
    () => facilities.filter((f) => f.obligorId === obligor.id && f.status !== "Closed" && f.status !== "Written off").reduce((s, f) => s + f.outstanding, 0),
    [facilities, obligor.id],
  );
  const wallet = useMemo(() => walletFor(obligor.id, obligor.verifiedTurnover, tenantOutstanding), [obligor.id, obligor.verifiedTurnover, tenantOutstanding]);
  const gating = useMemo<GatingCheck[]>(
    () =>
      applications
        .filter((x) => x.obligorId === obligor.id && !["Booked", "Declined", "Withdrawn"].includes(x.stage))
        .map((x) => ({
          applicationId: x.id,
          tenorMonths: x.tenorMonths,
          purpose: x.purpose,
          stage: a.ngx?.lifeCycle,
          flagged: x.tenorMonths > 36 && EXPANSION.test(x.purpose) && a.ngx?.lifeCycle === "Decline",
          analystNote:
            !a.position.neutral && a.position.base === "Conservative" && EXPANSION.test(x.purpose) && (a.ngx?.lifeCycle === "Maturity" || a.ngx?.lifeCycle === "Decline"),
        })),
    [applications, obligor.id, a.ngx, a.position],
  );

  const age = ageDays(obligor.rarUpdatedAt, DEMO_NOW);
  const stale = age > STALE_AFTER_DAYS;
  const sectorName = sector.get(obligor.sectorId)?.name ?? obligor.sectorId;
  const rm = userById.get(obligor.relationshipManagerId);
  const dirty = editing && JSON.stringify(effectiveOverrides) !== JSON.stringify(saved);

  const actor = () => ({
    actorId: user?.id ?? "demo",
    actorName: user?.name ?? "Demo user",
    roleId: role?.id ?? "credit-analyst",
  });

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

  function saveEdit() {
    if (rationale.trim().length < 15) {
      setError("Record a rationale of at least 15 characters — every analyst adjustment is kept in the audit trail with its reason.");
      return;
    }
    const changed = parameters.filter((p) => (saved[p.id]?.score ?? baseline[p.id]) !== (effectiveOverrides[p.id]?.score ?? baseline[p.id]));
    const finalOverrides = Object.fromEntries(Object.entries(effectiveOverrides).map(([k, v]) => [k, changed.some((c) => c.id === k) ? { ...v, rationale: rationale.trim() } : v]));
    setOverrides(obligor.id, finalOverrides);
    const at = DEMO_NOW.toISOString();
    update("obligors", obligor.id, { rar: a.scores, rarUpdatedAt: at });
    log({
      ...actor(),
      action: "Adjusted 360 RAR analyst enrichment inputs",
      entityType: "Obligor",
      entityId: obligor.id,
      before: `${committed.position.label}; ${changed.map((p) => `${p.id} ${(saved[p.id]?.score ?? baseline[p.id]!).toFixed(1)}`).join(", ")}`,
      after: `${a.position.label}; ${changed.map((p) => `${p.id} ${(effectiveOverrides[p.id]?.score ?? baseline[p.id]!).toFixed(1)}`).join(", ")} — ${rationale.trim()}`,
    });
    setEditing(false);
    setDraft({});
    setNotice(`Saved ${changed.length} adjustment${changed.length === 1 ? "" : "s"}. Posture is now ${a.position.label}.`);
  }

  function refresh() {
    setRefreshing(true);
    setNotice(null);
    window.setTimeout(() => {
      const at = DEMO_NOW.toISOString();
      update("obligors", obligor.id, {
        rar: committed.scores,
        rarUpdatedAt: at,
      });
      log({
        ...actor(),
        action: "Refreshed 360 RAR assessment",
        entityType: "Obligor",
        entityId: obligor.id,
        before: `${obligor.rarUpdatedAt.slice(0, 10)} · ${committed.position.label}`,
        after: `${at.slice(0, 10)} · ${committed.position.label} (CBA, bureau/CRMS, NGX corpus ${"v2026.2"}, macro feed re-read)`,
      });
      setRefreshing(false);
      setNotice(`Assessment refreshed — all feeds re-read and the posture recomputed: ${committed.position.label}.`);
    }, 1200);
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
                <Button variant="tertiary" iconBefore={<Pencil aria-hidden />} onClick={startEdit}>
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
        {stale && !editing && (
          <Alert tone="warning" title={`Assessment is ${age} days old`}>
            Older than the {STALE_AFTER_DAYS}-day refresh cycle (tenant parameter).{" "}
            {canEdit ? "Refresh to re-read the CBA, bureau/CRMS, NGX corpus and macro feeds." : "A Credit Analyst can refresh it."}
          </Alert>
        )}
        {a.position.neutral && (
          <Alert tone="warning" title="Neutral / Transitional — mandatory analyst narrative">
            Magnitude {a.position.magnitude.toFixed(2)} is below the neutral threshold, so no posture-driven stance is generated (§6.2.5). The advisory note needs a Credit Analyst
            narrative.
          </Alert>
        )}
        {gating.some((g) => g.flagged) && (
          <Alert tone="danger" title="Industry Life-Cycle gating — hard exception">
            {gating
              .filter((g) => g.flagged)
              .map((g) => g.applicationId)
              .join(", ")}
            : long-tenor expansion request in a Decline-stage industry. CCO/CRO override with documented rationale is required before it passes the Credit Analyst tier (§6.2.6).
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
                <Button size="small" iconBefore={<Save aria-hidden />} onClick={saveEdit} disabled={!dirty}>
                  Save adjustments
                </Button>
              </span>
            }
          >
            <Stack gap="small">
              <span>
                Adjust parameters that carry an analyst enrichment / survey source. The posture recalculates live: now <strong>{a.position.label}</strong>
                {a.position.label !== committed.position.label ? ` (was ${committed.position.label})` : ""}.
              </span>
              <Field label="Rationale for the adjustment" required error={error ?? undefined} description="Kept in the audit trail with the before/after scores.">
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
              content: <AdvisoryTab a={a} cell={cell} wallet={wallet} benchmarks={benchmarks} trends={trends} gating={gating} canEdit={canEdit} editing={editing} />,
            },
          ]}
        />
        <p className="text-xs text-fg-subtle">
          Scores refreshed {dateTime(obligor.rarUpdatedAt)} · Weighting: tenant-configurable (demo: equal) · Intensity thresholds and COP bands are demo defaults from the Rules &
          Parameters Engine.
        </p>
      </Stack>
    </ModulePage>
  );
}
