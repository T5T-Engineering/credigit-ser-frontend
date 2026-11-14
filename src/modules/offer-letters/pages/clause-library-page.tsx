"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, BookMarked, CircleDashed, Library, Plus } from "lucide-react";
import {
  ActivityFeed,
  Alert,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  Grid,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  StatCard,
  StatusBadge,
  Text,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { OutcomePopup, outcomeCopy } from "@/lib/ui/outcome-popup";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/iam/permissions";
import { date } from "@/lib/format";
import { canDecide, decideOperation, useOperationsStore, usePendingFor } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { demoNowIso, useActor } from "../../credit-admin/common";
import { PendingOperationNotice } from "../../credit-admin/operations-ui";
import { submitClauseChange } from "../actions";
import { libraryMeta, mergeFields, type Clause, type ClauseLibrary, type TagRule } from "../library";
import { fieldsIn } from "../merge";
import { useClauses, useOfferLetters } from "../store";

const clauseStatusTones = { "Legal-approved": "success", "Pending Legal approval": "warning", Retired: "neutral" } as const;

export function describeRule(r: TagRule): string {
  if (r.all) return "Every facility";
  const parts: string[] = [];
  if (r.covenantTag) parts.push(`covenant tagged at origination: "${r.covenantTag}"`);
  if (r.products?.length) parts.push(`products: ${r.products.join(", ")}`);
  if (r.obligorTypes?.length) parts.push(`obligor types: ${r.obligorTypes.join(", ")}`);
  if (r.collateralTypes?.length) parts.push(`collateral: ${r.collateralTypes.join(", ")}`);
  if (r.secured) parts.push("any secured facility");
  if (r.foreignCurrency) parts.push("foreign-currency facilities");
  if (r.sectorIds?.length) parts.push(`sectors: ${r.sectorIds.join(", ")}`);
  return parts.length ? `Auto-tag when ${parts.join("; or ")}` : "Manual selection only";
}

export function ClauseLibraryPage() {
  const clauses = useClauses();
  const letters = useOfferLetters();
  const { actor } = useScope();
  const editorRoles = useRule<RoleId[]>("offer-letters.libraryEditorRoles");
  const canEdit = useCan("offer-letters.clauses.request-change") && editorRoles.includes(actor.roleId);
  const canExport = useCan("offer-letters.clauses.export");
  const instances = useOperationsStore((s) => s.instances);
  const awaitingMe = instances.filter((i) => i.operationType === "offer-letters.clause.change" && canDecide(i, actor).ok).length;
  const [lib, setLib] = useState<ClauseLibrary | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of letters) for (const id of l.clauseIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [letters]);

  const rows = clauses.filter((c) => lib === "all" || c.library === lib);
  const pending = clauses.filter((c) => c.status === "Pending Legal approval");
  const open = clauses.find((c) => c.id === openId);

  const columns: DataTableColumn<Clause>[] = [
    { id: "id", header: "Clause", accessor: "id", sortable: true, cell: (c) => <span className="font-mono text-xs font-medium text-fg">{c.id}</span> },
    {
      id: "title",
      header: "Title",
      accessor: "title",
      sortable: true,
      width: "34%",
      cell: (c) => (
        <Stack gap="none">
          <span className="font-medium text-fg">{c.title}</span>
          <span className="line-clamp-2 text-xs text-fg-muted">{c.proposedText ?? c.text}</span>
        </Stack>
      ),
    },
    { id: "library", header: "Library", accessor: (c) => libraryMeta[c.library].short, sortable: true, hidden: lib !== "all" },
    { id: "category", header: "Category", accessor: "category", sortable: true },
    { id: "loanTypes", header: "Applicable loan types", accessor: "loanTypes", cell: (c) => <span className="text-sm">{c.loanTypes}</span> },
    { id: "version", header: "Version", accessor: "version", numeric: true, align: "end", cell: (c) => <span className="font-mono">v{c.version}</span> },
    { id: "used", header: "In letters", accessor: (c) => usage.get(c.id) ?? 0, numeric: true, align: "end", sortable: true },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (c) => <StatusBadge status={c.status} tones={clauseStatusTones} /> },
    { id: "approvedAt", header: "Approved", accessor: (c) => c.approvedAt ?? "", sortable: true, cell: (c) => (c.approvedAt ? <span className="font-mono text-xs whitespace-nowrap">{date(c.approvedAt)}</span> : "—") },
  ];

  return (
    <ModulePage module="offer-letters" description="Configurable, reusable, parameterised clauses — tagged by applicable loan type and versioned under Legal approval.">
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="Library clauses" value={String(clauses.filter((c) => c.status !== "Retired").length)} icon={<Library aria-hidden />} hint="Across four libraries" />
          <StatCard label="Conditions precedent" value={String(clauses.filter((c) => c.library === "pre" && c.status !== "Retired").length)} icon={<BookMarked aria-hidden />} tone="info" hint="Feed the CP checklist" />
          <StatCard label="Legal-approved" value={String(clauses.filter((c) => c.status === "Legal-approved").length)} icon={<BadgeCheck aria-hidden />} tone="success" hint="Current version used in new letters" />
          <StatCard label="Pending Legal approval" value={String(pending.length)} icon={<CircleDashed aria-hidden />} tone="warning" hint={pending.length ? "Previous approved text stays in use" : "Nothing waiting"} />
        </Grid>

        {pending.length ? (
          <Alert tone="warning" title={`${pending.length} clause change${pending.length > 1 ? "s" : ""} awaiting Legal approval`}>
            {pending.map((c) => `${c.id} ${c.title}`).join(" · ")}. Approvals run through the Operations workflow
            {awaitingMe ? ` — ${awaitingMe} waiting for your decision` : ""}.
          </Alert>
        ) : null}

        <div className="overflow-x-auto">
          <SegmentedControl
            label="Library"
            value={lib}
            onChange={(v) => setLib(v as ClauseLibrary | "all")}
            options={[{ value: "all", label: "All" }, ...(Object.keys(libraryMeta) as ClauseLibrary[]).map((k) => ({ value: k, label: `${libraryMeta[k].short} ${libraryMeta[k].prd}` }))]}
          />
        </div>
        {lib !== "all" ? <Text tone="muted">{libraryMeta[lib].description}</Text> : null}

        <DataTable
          label="Clause library"
          columns={columns}
          data={rows}
          getRowId={(c) => c.id}
          onRowClick={(c) => setOpenId(c.id)}
          searchable
          searchPlaceholder="Search clause text, title or ID"
          filters={[
            { id: "category", label: "Category" },
            { id: "status", label: "Status" },
          ]}
          toolbar={
            canEdit ? (
              <Button size="small" iconBefore={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
                New clause
              </Button>
            ) : undefined
          }
          exportFilename={canExport ? "offer-letter-clause-library.csv" : undefined}
          defaultPageSize={25}
          mobileCard={(c) => (
            <Stack gap="xsmall">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{c.id} · v{c.version}</span>
                <StatusBadge status={c.status} tones={clauseStatusTones} />
              </div>
              <span className="font-medium text-fg">{c.title}</span>
              <span className="text-sm text-fg-muted">{c.loanTypes}</span>
            </Stack>
          )}
        />
        <Text variant="small" tone="muted">
          Build note: each clause is a parameterised template, so Legal composes a letter by selecting clauses rather than drafting free text, and every generated letter uses the version Legal most recently approved.
        </Text>
      </Stack>
      {open ? <ClauseDrawer clause={open} usage={usage.get(open.id) ?? 0} canEdit={canEdit} onClose={() => setOpenId(null)} /> : null}
      {adding ? <NewClauseModal existing={clauses} onClose={() => setAdding(false)} /> : null}
    </ModulePage>
  );
}

function ClauseDrawer({ clause, usage, canEdit, onClose }: { clause: Clause; usage: number; canEdit: boolean; onClose: () => void }) {
  const { actor } = useScope();
  const pending = usePendingFor("Clause", clause.id);
  const minText = useRule<number>("offer-letters.minClauseTextLength");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(clause.text);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const fields = fieldsIn(clause.text);
  const mayDecide = pending ? canDecide(pending, actor).ok : false;

  const report = (r: { ok: true; message: string } | { ok: false; reason: string }) => setResult(r.ok ? { tone: "success", text: r.message } : { tone: "danger", text: r.reason });
  const submitEdit = async () => {
    const r = await submitClauseChange(clause, "wording", note.trim(), text.trim());
    report(r);
    if (r.ok) setEditing(false);
  };
  const retire = () => void submitClauseChange(clause, clause.status === "Retired" ? "reinstate" : "retire", note.trim()).then(report);
  const approve = async () => {
    if (!pending) return;
    const r = await decideOperation(pending.id, "approve", "");
    setResult(r.ok ? { tone: "success", text: `Approved (${pending.id}).` } : { tone: "danger", text: r.reason });
  };

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      size="large"
      title={`${clause.id} — ${clause.title}`}
      description={`${libraryMeta[clause.library].label} (${libraryMeta[clause.library].prd})`}
      footer={
        canEdit || mayDecide ? (
          <Stack direction="horizontal" gap="small" wrap justify="end">
            {mayDecide ? <Button onClick={() => void approve()}>Approve change</Button> : null}
            {canEdit && !pending ? (
              <>
                {!editing ? (
                  <Button variant="secondary" onClick={() => setEditing(true)} disabled={clause.status !== "Legal-approved"}>
                    Propose change
                  </Button>
                ) : (
                  <Button onClick={() => void submitEdit()} disabled={text.trim() === clause.text || text.trim().length < minText}>
                    Submit for Legal approval
                  </Button>
                )}
                <Button variant="text" onClick={retire}>
                  {clause.status === "Retired" ? "Propose reinstatement" : "Propose retirement"}
                </Button>
              </>
            ) : null}
          </Stack>
        ) : undefined
      }
    >
      <Stack gap="large">
        <OutcomePopup value={result} map={outcomeCopy.toneText({ success: "Submitted", danger: "Not submitted" })} />
        {pending ? <PendingOperationNotice instance={pending} title="Change awaiting approval" /> : null}
        <DescriptionList
          columns={2}
          items={[
            { label: "Status", status: clause.status, statusTones: clauseStatusTones },
            { label: "Version", value: `v${clause.version}`, mono: true },
            { label: "Category", value: clause.category },
            { label: "Applicable loan types", value: clause.loanTypes },
            { label: "Auto-tagging", value: describeRule(clause.rule), span: 2 },
            { label: "Legal approval", value: clause.approvedAt ? `${clause.approvedByName} · ${date(clause.approvedAt)}` : "Awaiting first approval" },
            { label: "Used in letters", value: String(usage), mono: true },
          ]}
        />
        {editing ? (
          <Stack gap="medium">
            <Field label="Proposed wording" htmlFor="clause-text" description="Use {{merge.fields}} for obligor and facility data. The approved version stays in use until Legal approves this change.">
              <Textarea id="clause-text" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Field label="Reason for change" htmlFor="clause-note" optional>
              <Input id="clause-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </Stack>
        ) : canEdit && !pending ? (
          <Stack gap="medium">
            <Field label="Reason (for a retirement / reinstatement or wording change)" htmlFor="clause-note-2" optional>
              <Input id="clause-note-2" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <ClauseText clause={clause} />
          </Stack>
        ) : (
          <ClauseText clause={clause} />
        )}
        <Stack gap="small">
          <Text variant="eyebrow">Merge fields</Text>

          {fields.length ? (
            <div className="flex flex-wrap gap-1.5">
              {fields.map((f) => (
                <Badge key={f} variant="outline">
                  {`{{${f}}}`} · {mergeFields.find((m) => m.token === f)?.label ?? "Unknown field"}
                </Badge>
              ))}
            </div>
          ) : (
            <Text variant="small" tone="muted">
              Static clause — no merge fields.
            </Text>
          )}
        </Stack>
        <ActivityFeed label="Version history" items={[...clause.history].reverse().map((h) => ({ id: `${clause.id}-${h.version}-${h.at}`, actor: h.byName, action: `v${h.version} — ${h.note}`, timestamp: h.at }))} />
      </Stack>
    </Drawer>
  );
}

function ClauseText({ clause }: { clause: Clause }) {
  return (
    <Stack gap="medium">
      <Stack gap="small">
        <Text variant="eyebrow">{clause.approvedAt ? `Approved text in use (v${clause.version})` : "Clause text"}</Text>
        <p className="squircle rounded-2xl bg-surface-sunken p-4 text-sm leading-6 text-fg">{clause.text}</p>
      </Stack>
      {clause.proposedText ? (
        <Stack gap="small">
          <Text variant="eyebrow" tone="accent">Proposed change — awaiting Legal approval</Text>
          <p className="squircle rounded-2xl bg-warning-soft p-4 text-sm leading-6 text-fg">{clause.proposedText}</p>
        </Stack>
      ) : null}
    </Stack>
  );
}

function NewClauseModal({ existing, onClose }: { existing: Clause[]; onClose: () => void }) {
  const actor = useActor();
  const minText = useRule<number>("offer-letters.minClauseTextLength");
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<ClauseLibrary>("pre");
  const [category, setCategory] = useState("Documentation");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loanTypes, setLoanTypes] = useState("All");
  const prefix = { pre: "CP", post: "PC", general: "GC", special: "SC" }[library];
  const id = `${prefix}-${String(existing.filter((c) => c.library === library).length + 1).padStart(2, "0")}`;
  const nextId = existing.some((c) => c.id === id) ? `${prefix}-${String(existing.length + 1).padStart(2, "0")}` : id;
  const save = async () => {
    const at = demoNowIso();
    const clause: Clause = { id: nextId, library, category, title, text: text.trim(), loanTypes, rule: loanTypes.trim() === "All" ? { all: true } : {}, version: 1, status: "Pending Legal approval", history: [{ version: 1, text: text.trim(), at, byName: actor.actorName, note: "New clause" }] };
    const r = await submitClauseChange(clause, "new", "New clause", text.trim());
    if (r.ok) onClose();
    else setError(r.reason);
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="New library clause"
      description={`Will be added as ${nextId} v1, pending Legal approval.`}
      size="large"
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || text.trim().length < minText} onClick={() => void save()}>
            Submit for approval
          </Button>
        </>
      }
    >
      <Stack gap="medium">
        <Grid columns={{ base: 1, sm: 2 }} gap="medium">
          <Field label="Library" htmlFor="nc-lib">
            <Select id="nc-lib" value={library} onChange={(e) => setLibrary(e.target.value as ClauseLibrary)} options={(Object.keys(libraryMeta) as ClauseLibrary[]).map((k) => ({ value: k, label: `${libraryMeta[k].label} (${libraryMeta[k].prd})` }))} />
          </Field>
          <Field label="Category" htmlFor="nc-cat">
            <Input id="nc-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
        </Grid>
        <Field label="Title" htmlFor="nc-title">
          <Input id="nc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Applicable loan types" htmlFor="nc-types" description='"All" auto-tags the clause onto every new letter; anything else is selected by Legal per letter.'>
          <Input id="nc-types" value={loanTypes} onChange={(e) => setLoanTypes(e.target.value)} />
        </Field>
        <Field label="Clause text" htmlFor="nc-text" description="Parameterise with merge fields, e.g. {{obligor.name}}, {{facility.amount}}, {{validity.days}}.">
          <Textarea id="nc-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {error ? (
          <Alert tone="danger" title="Not submitted">
            {error}
          </Alert>
        ) : null}

      </Stack>
    </Modal>
  );
}
