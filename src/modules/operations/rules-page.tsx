"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { History, Pencil, SlidersHorizontal } from "lucide-react";
import {
  ActivityFeed,
  Alert,
  Button,
  Drawer,
  EmptyState,
  Field,
  FilterBar,
  RuleCard,
  RuleRow,
  RuleValueInput,
  SectionHeader,
  Spinner,
  Stack,
  SubmitButton,
  Text,
  Textarea,
  type ActivityItem,
  type RuleValue as UiRuleValue,
} from "@credigit/web-ui";
import { useSaveFeedback } from "@/lib/ui/feedback";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { dateTime } from "@/lib/format";
import { allNavItems } from "@/lib/nav";
import { requestRuleChange } from "@/lib/platform/core";
import { useOperationsStore, type OperationInstance } from "@/lib/platform/operations";
import { ruleDefinition, ruleDefinitions, useRule, useRulesStore, type RuleDefinition, type RuleValue } from "@/lib/platform/rules";
import { formatValue, fromInputValue, inputBounds, isOpen, ruleOptions, ruleSummary, toInputValue } from "./logic";

const moduleLabel = (m: string) => allNavItems.find((n) => n.module === m)?.label ?? (m === "platform" ? "Platform" : m);

/** Operations → Business rules: the registry of every rule, grouped by module and category. `?key=` opens a rule. */
export function RulesPage() {
  return (
    <Suspense fallback={<Spinner label="Loading business rules" />}>
      <RulesInner />
    </Suspense>
  );
}

function usePendingRuleChanges() {
  const instances = useOperationsStore((s) => s.instances);
  return useMemo(() => {
    const map = new Map<string, OperationInstance>();
    for (const i of instances) if (i.operationType === "rule.change" && isOpen(i)) map.set((i.payload as { key: string }).key, map.get((i.payload as { key: string }).key) ?? i);
    return map;
  }, [instances]);
}

function RulesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openKey = params.get("key");
  const values = useRulesStore((s) => s.values);
  const history = useRulesStore((s) => s.history);
  const pending = usePendingRuleChanges();
  const canEdit = useCan("rules.rules.request-change");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const pageSize = useRule<number>("operations.rulesPageSize");
  const [pages, setPages] = useState(1);

  const defs = ruleDefinitions();
  const valueOf = (d: RuleDefinition) => (values[d.key] ?? d.default) as RuleValue;
  const modified = (d: RuleDefinition) => d.key in values && JSON.stringify(values[d.key]) !== JSON.stringify(d.default);
  const matching = defs.filter(
    (d) =>
      (!moduleFilter || d.module === moduleFilter) &&
      (!stateFilter || (stateFilter === "pending" ? pending.has(d.key) : modified(d))) &&
      (!search || `${d.label} ${d.key} ${d.description} ${d.category}`.toLowerCase().includes(search.toLowerCase())),
  );
  const visible = matching.slice(0, pageSize * pages);
  const modules = [...new Set(defs.map((d) => d.module))];
  const lastChange = (key: string) => history.find((h) => h.key === key);
  const setKey = (key: string | null) => router.replace(key ? `${pathname}?key=${encodeURIComponent(key)}` : pathname, { scroll: false });

  return (
    <ModulePage module="operations" description="Every limit, threshold, duration and mapping the platform uses. Changes are routed through the Operations workflow and applied only when approved.">
      <Stack gap="large">
        <FilterBar
          label="Filter business rules"
          search={{ value: search, onChange: (v: string) => { setSearch(v); setPages(1); }, placeholder: "Search label, key or description", label: "Search business rules" }}
          filters={[
            { id: "module", label: "Module", value: moduleFilter, onChange: (v: string) => { setModuleFilter(v); setPages(1); }, options: modules.map((m) => ({ value: m, label: moduleLabel(m), count: defs.filter((d) => d.module === m).length })) },
            {
              id: "state",
              label: "State",
              value: stateFilter,
              onChange: (v: string) => { setStateFilter(v); setPages(1); },
              options: [
                { value: "modified", label: "Modified from default", count: defs.filter(modified).length },
                { value: "pending", label: "Awaiting approval", count: pending.size },
              ],
            },
          ]}
          onClearAll={() => {
            setSearch("");
            setModuleFilter("");
            setStateFilter("");
          }}
        />
        <Text variant="small" tone="muted">
          Showing {visible.length} of {matching.length} matching ({defs.length} rules in total)
        </Text>
        {matching.length === 0 ? (
          <EmptyState icon={<SlidersHorizontal aria-hidden />} title="No rules match" description="Clear the filters or search for a different key." />
        ) : (
          modules
            .filter((m) => visible.some((d) => d.module === m))
            .map((m) => {
              const inModule = visible.filter((d) => d.module === m);
              const categories = [...new Set(inModule.map((d) => d.category))];
              return (
                <Stack key={m} gap="medium">
                  <SectionHeader size="medium" title={moduleLabel(m)} description={`${inModule.length} rule(s)`} />
                  {categories.map((c) => (
                    <Stack key={c} gap="small">
                      <Text variant="eyebrow" tone="muted">
                        {c}
                      </Text>
                      {inModule
                        .filter((d) => d.category === c)
                        .map((d) => (
                          <RuleRow
                            key={d.key}
                            showKey={false}
                            rule={ruleSummary(d, valueOf(d), pending.get(d.key), lastChange(d.key))}
                            linkComponent={Link}
                            actions={
                              <Button size="small" variant="tertiary" iconBefore={canEdit ? <Pencil aria-hidden /> : <History aria-hidden />} onClick={() => setKey(d.key)}>
                                {canEdit ? "Change" : "Details"}
                              </Button>
                            }
                          />
                        ))}
                    </Stack>
                  ))}
                </Stack>
              );
            })
        )}
        {matching.length > visible.length ? (
          <Button variant="tertiary" onClick={() => setPages((n) => n + 1)}>
            Show {Math.min(pageSize, matching.length - visible.length)} more
          </Button>
        ) : null}
      </Stack>
      {openKey ? <RuleDrawer key={openKey} ruleKey={openKey} pending={pending.get(openKey)} canEdit={canEdit} onClose={() => setKey(null)} /> : null}
    </ModulePage>
  );
}

function RuleDrawer({ ruleKey, pending, canEdit, onClose }: { ruleKey: string; pending?: OperationInstance; canEdit: boolean; onClose: () => void }) {
  const def = ruleDefinition(ruleKey);
  const history = useRulesStore((s) => s.history);
  if (!def)
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Unknown rule">
        <Alert tone="warning" title="Rule not found">
          No business rule has the key <span className="font-mono">{ruleKey}</span>.
        </Alert>
      </Drawer>
    );
  return <RuleEditor def={def} pending={pending} canEdit={canEdit} onClose={onClose} history={history.filter((h) => h.key === def.key)} />;
}

function RuleEditor({ def, pending, canEdit, onClose, history }: { def: RuleDefinition; pending?: OperationInstance; canEdit: boolean; onClose: () => void; history: ReturnType<typeof useRulesStore.getState>["history"] }) {
  const { toast } = useSaveFeedback();
  const current = useRule<RuleValue>(def.key);
  const minComment = useRule<number>("operations.minCommentLength");
  const [draft, setDraft] = useState<UiRuleValue>(() => toInputValue(def, current));
  const [inputError, setInputError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const next = fromInputValue(def, draft);
  const unchanged = next !== null && JSON.stringify(next) === JSON.stringify(current);
  const bounds = inputBounds(def);

  async function submit() {
    if (next === null) return;
    setBusy(true);
    const res = await requestRuleChange(def.key, next, reason.trim());
    setBusy(false);
    if (!res.ok) return toast({ title: "Change not submitted", description: res.reason, tone: "danger" });
    toast({ title: res.applied ? "Rule updated" : "Change submitted for approval", description: res.applied ? "The rule-change workflow is disabled, so it applied directly." : `Reference ${res.instance.id}`, tone: "success" });
    setReason("");
  }

  const items: ActivityItem[] = history.map((h, n) => ({
    id: `${h.at}-${n}`,
    actor: h.byName,
    action: "changed the value",
    timestamp: h.at,
    changes: [{ field: def.label, before: formatValue(def, h.before), after: formatValue(def, h.after) }],
    note: [h.reason, h.operationId ? `via ${h.operationId}` : ""].filter(Boolean).join(" · ") || undefined,
  }));

  const editable = canEdit && !pending;
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      size="large"
      title={def.label}
      description={editable ? "Propose a new value. It's applied only after the rule-change workflow approves it." : undefined}
      footer={
        editable ? (
          <Stack direction="horizontal" gap="small" justify="end">
            <Button variant="tertiary" onClick={onClose}>
              Close
            </Button>
            <SubmitButton loading={busy} disabled={!!inputError || next === null || unchanged || reason.trim().length < minComment} onClick={submit}>
              Submit for approval
            </SubmitButton>
          </Stack>
        ) : undefined
      }
    >
      <Stack gap="large">
        <RuleCard rule={ruleSummary(def, current, pending, history[0])} linkComponent={Link}>
          {editable ? (
            <Stack gap="medium">
              <Field label="Proposed value" description={def.unit ? `Unit: ${def.unit}` : undefined}>
                <RuleValueInput
                  type={def.type}
                  value={draft}
                  onChange={setDraft}
                  min={bounds.min}
                  max={bounds.max}
                  step={def.step}
                  unit={def.unit}
                  options={ruleOptions(def)}
                  durationUnits={def.type === "duration" ? [def.durationUnit ?? "minutes"] : undefined}
                  onValidityChange={setInputError}
                />
              </Field>
              <Field label="Reason" description={`At least ${minComment} characters. Approvers and the audit log see this.`} required>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </Field>
            </Stack>
          ) : null}
        </RuleCard>
        {pending ? (
          <Alert
            tone="info"
            title="Change awaiting approval"
            action={
              <Button as={Link} href={`/operations/item?id=${pending.id}`} size="small" variant="tertiary">
                View request
              </Button>
            }
          >
            New proposals are blocked until {pending.requestedBy.name}&apos;s request is decided.
          </Alert>
        ) : !canEdit ? (
          <Alert tone="info" title="View only">
            Your role can view business rules but not propose changes.
          </Alert>
        ) : null}
        <Stack gap="small">
          <SectionHeader size="medium" title="History" as="h3" />
          <ActivityFeed items={items} groupByDay={false} formatTimestamp={(t) => dateTime(t)} label={`History of ${def.label}`} emptyMessage="Never changed — the default applies." />
        </Stack>
      </Stack>
    </Drawer>
  );
}
