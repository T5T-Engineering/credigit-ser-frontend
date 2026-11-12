"use client";

/**
 * Rules editor composition for Admin â†’ Rules & parameters and Roles & limits: a filtered list of business rules
 * (RuleRow from the library) whose "Request change" opens a dialog that submits `requestRuleChange()` to the
 * Operations workflow. Nothing is applied here â€” the rule changes when the operation is approved.
 */
import { useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import {
  Button,
  EmptyState,
  Field,
  Modal,
  RuleRow,
  RuleValueInput,
  Stack,
  Text,
  Textarea,
  type RuleSummary,
  type RuleValue as UiRuleValue,
  type RuleValueType,
} from "@credigit/web-ui";
import { requestRuleChange } from "@/lib/platform/core";
import { usePendingFor, type SubmitResult } from "@/lib/platform/operations";
import { useRule, type RuleDefinition, type RuleValue } from "@/lib/platform/rules";
import { ago } from "@/lib/format";
import { operationHref, submitWithHooks, SubmitOutcome } from "./operation-ui";

/** App rule value â†’ library display/input value. */
export function toUiValue(def: RuleDefinition, value: RuleValue): UiRuleValue {
  if (def.type === "duration" && typeof value === "number") return { amount: value, unit: def.durationUnit ?? "minutes" };
  return value;
}

/** Library value â†’ app rule value. */
export function fromUiValue(def: RuleDefinition, value: UiRuleValue): RuleValue | null {
  if (value === null) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value.amount;
  return value;
}

/** A fixed-option list renders as a multi-select (toggle pills); a free list as a chip input. */
const inputType = (def: RuleDefinition): RuleValueType => (def.type === "list" && def.options?.length ? "roles" : def.type);

function RuleItem({ def, canEdit, onEdit }: { def: RuleDefinition; canEdit: boolean; onEdit: (def: RuleDefinition) => void }) {
  const value = useRule<RuleValue>(def.key);
  const pending = usePendingFor("Rule", def.key);
  const proposed = (pending?.payload as { value?: RuleValue } | undefined)?.value;
  const rule: RuleSummary = {
    key: def.key,
    label: def.label,
    description: def.description,
    type: def.type,
    value: toUiValue(def, value),
    defaultValue: toUiValue(def, def.default),
    unit: def.unit,
    options: def.options,
    pending: pending ? { value: proposed === undefined ? undefined : toUiValue(def, proposed), requestedBy: pending.requestedBy.name, requestedAt: ago(pending.requestedAt), href: operationHref(pending.id) } : undefined,
  };
  return (
    <RuleRow
      rule={rule}
      showKey={false}
      linkComponent={Link}
      actions={
        canEdit && def.requiresApproval !== false ? (
          <Button size="small" variant="tertiary" disabled={Boolean(pending)} iconBefore={<Pencil aria-hidden className="size-4" />} onClick={() => onEdit(def)}>
            {pending ? "Pending" : "Request change"}
          </Button>
        ) : undefined
      }
    />
  );
}

/** Filtered rule list with a change-request dialog. */
export function RuleEditorList({ rules, canEdit, emptyTitle = "No rules here yet", emptyDescription }: { rules: RuleDefinition[]; canEdit: boolean; emptyTitle?: string; emptyDescription?: string }) {
  const [editing, setEditing] = useState<RuleDefinition | null>(null);
  if (rules.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return (
    <>
      <ul className="flex flex-col divide-y divide-line">
        {rules.map((def) => (
          <li key={def.key} className="py-2">
            <RuleItem def={def} canEdit={canEdit} onEdit={setEditing} />
          </li>
        ))}
      </ul>
      {editing ? <RuleChangeDialog key={editing.key} def={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** Dialog to request a change of one rule through Operations ("rule.change"). */
export function RuleChangeDialog({ def, onClose, initial }: { def: RuleDefinition; onClose: () => void; initial?: RuleValue }) {
  const current = useRule<RuleValue>(def.key);
  const minReason = useRule<number>("operations.minCommentLength");
  const [draft, setDraft] = useState<UiRuleValue>(toUiValue(def, initial ?? current));
  const [inputError, setInputError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const value = fromUiValue(def, draft);
  const unchanged = JSON.stringify(value) === JSON.stringify(current);

  const submit = async () => {
    if (value === null || inputError) return;
    if (reason.trim().length < minReason) return setResult({ ok: false, reason: `Give a reason of at least ${minReason} characters.` });
    setBusy(true);
    const r = await submitWithHooks("admin.config.change", { kind: "rule", key: def.key, value, reason: reason.trim() }, (ctx) => requestRuleChange(ctx.key, ctx.value, ctx.reason));
    setBusy(false);
    setResult(r);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Change: ${def.label}`}
      description="The new value applies only after approval in Operations (Business rule change workflow)."
      footer={
        result?.ok ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={busy} disabled={unchanged || Boolean(inputError)} onClick={() => void submit()}>
              Submit for approval
            </Button>
          </>
        )
      }
    >
      <Stack gap="medium">
        <Text variant="small" tone="muted">
          {def.description}
        </Text>
        <RuleValueInput
          type={inputType(def)}
          label="Proposed value"
          value={draft}
          onChange={setDraft}
          min={def.min}
          max={def.max}
          step={def.step}
          unit={def.unit}
          options={def.options}
          durationUnits={def.type === "duration" ? [def.durationUnit ?? "minutes"] : undefined}
          onValidityChange={setInputError}
          disabled={Boolean(result?.ok)}
        />
        <Field label="Reason for the change" htmlFor={`reason-${def.key}`} required description="Shown to approvers and kept in the audit log.">
          <Textarea id={`reason-${def.key}`} value={reason} disabled={Boolean(result?.ok)} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
        <SubmitOutcome result={result} />
      </Stack>
    </Modal>
  );
}
