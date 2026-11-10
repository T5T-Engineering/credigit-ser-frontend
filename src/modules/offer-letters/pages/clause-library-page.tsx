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
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { date } from "@/lib/format";
import { demoNowIso, useActor, useAuditLog } from "../../credit-admin/common";
import { libraryMeta, mergeFields, type Clause, type ClauseLibrary, type TagRule } from "../library";
import { fieldsIn } from "../merge";
import { useClauses, useOfferLetterStore, useOfferLetters } from "../store";

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
  const canEdit = useCan("offer-letters", "edit");
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
    <ModulePage module="offer-letters" description="Configurable, reusable, parameterised clauses — tagged by applicable loan type and versioned under Legal approval (PRD §7.1–7.3).">
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="Library clauses" value={String(clauses.filter((c) => c.status !== "Retired").length)} icon={<Library aria-hidden />} hint="Across four libraries" />
          <StatCard label="Conditions precedent" value={String(clauses.filter((c) => c.library === "pre" && c.status !== "Retired").length)} icon={<BookMarked aria-hidden />} tone="info" hint="§7.1 — feed the CP checklist" />
          <StatCard label="Legal-approved" value={String(clauses.filter((c) => c.status === "Legal-approved").length)} icon={<BadgeCheck aria-hidden />} tone="success" hint="Current version used in new letters" />
          <StatCard label="Pending Legal approval" value={String(pending.length)} icon={<CircleDashed aria-hidden />} tone="warning" hint={pending.length ? "Previous approved text stays in use" : "Nothing waiting"} />
        </Grid>

        {pending.length && canEdit ? (
          <Alert tone="warning" title={`${pending.length} clause change${pending.length > 1 ? "s" : ""} awaiting Legal approval`}>
            {pending.map((c) => `${c.id} ${c.title}`).join(" · ")}
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
          exportFilename="offer-letter-clause-library.csv"
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
          Build note (PRD §7.3): each clause is a parameterised template, so Legal composes a letter by selecting clauses rather than drafting free text, and every generated letter uses the version Legal most recently approved.
        </Text>
      </Stack>
      {open ? <ClauseDrawer clause={open} usage={usage.get(open.id) ?? 0} canEdit={canEdit} onClose={() => setOpenId(null)} /> : null}
      {adding ? <NewClauseModal existing={clauses} onClose={() => setAdding(false)} /> : null}
    </ModulePage>
  );
}

function ClauseDrawer({ clause, usage, canEdit, onClose }: { clause: Clause; usage: number; canEdit: boolean; onClose: () => void }) {
  const saveClause = useOfferLetterStore((s) => s.saveClause);
  const audit = useAuditLog();
  const actor = useActor();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(clause.text);
  const [note, setNote] = useState("");
  const fields = fieldsIn(clause.text);

  const submitEdit = () => {
    const at = demoNowIso();
    saveClause({ ...clause, proposedText: text.trim(), status: "Pending Legal approval", history: [...clause.history, { version: clause.version + 1, text: text.trim(), at, byName: actor.actorName, note: `Proposed: ${note || "wording change"}` }] });
    audit("Proposed clause change", "Offer-letter clause", clause.id, clause.text, text.trim());
    setEditing(false);
  };
  const approve = () => {
    const at = demoNowIso();
    const isNew = clause.history.length === 1 && !clause.approvedAt;
    const version = isNew ? clause.version : clause.version + 1;
    saveClause({
      ...clause,
      text: clause.proposedText ?? clause.text,
      proposedText: undefined,
      version,
      status: "Legal-approved",
      approvedByName: actor.actorName,
      approvedAt: at,
      history: [...clause.history, { version, text: clause.proposedText ?? clause.text, at, byName: actor.actorName, note: "Legal-approved" }],
    });
    audit("Legal-approved clause", "Offer-letter clause", clause.id, `v${clause.version}`, `Legal-approved v${version}`);
  };
  const retire = () => {
    saveClause({ ...clause, status: clause.status === "Retired" ? "Legal-approved" : "Retired" });
    audit(clause.status === "Retired" ? "Reinstated clause" : "Retired clause", "Offer-letter clause", clause.id, clause.status, clause.status === "Retired" ? "Legal-approved" : "Retired");
  };

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      size="large"
      title={`${clause.id} — ${clause.title}`}
      description={`${libraryMeta[clause.library].label} (${libraryMeta[clause.library].prd})`}
      footer={
        canEdit ? (
          <Stack direction="horizontal" gap="small" wrap justify="end">
            {clause.status === "Pending Legal approval" ? <Button onClick={approve}>Approve change</Button> : null}
            {!editing ? (
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={clause.status !== "Legal-approved"}>
                Propose change
              </Button>
            ) : (
              <Button onClick={submitEdit} disabled={text.trim() === clause.text || text.trim().length < 20}>
                Submit for Legal approval
              </Button>
            )}
            <Button variant="text" onClick={retire}>
              {clause.status === "Retired" ? "Reinstate" : "Retire"}
            </Button>
          </Stack>
        ) : undefined
      }
    >
      <Stack gap="large">
        <DescriptionList
          columns={2}
          items={[
            { label: "Status", status: clause.status, statusTones: clauseStatusTones },
            { label: "Version", value: `v${clause.version}`, mono: true },
            { label: "Category", value: clause.category },
            { label: "Applicable loan types", value: clause.loanTypes },
            { label: "Auto-tagging (§6.1.5)", value: describeRule(clause.rule), span: 2 },
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
        ) : (
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

function NewClauseModal({ existing, onClose }: { existing: Clause[]; onClose: () => void }) {
  const saveClause = useOfferLetterStore((s) => s.saveClause);
  const audit = useAuditLog();
  const actor = useActor();
  const [library, setLibrary] = useState<ClauseLibrary>("pre");
  const [category, setCategory] = useState("Documentation");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loanTypes, setLoanTypes] = useState("All");
  const prefix = { pre: "CP", post: "PC", general: "GC", special: "SC" }[library];
  const id = `${prefix}-${String(existing.filter((c) => c.library === library).length + 1).padStart(2, "0")}`;
  const nextId = existing.some((c) => c.id === id) ? `${prefix}-${String(existing.length + 1).padStart(2, "0")}` : id;
  const save = () => {
    const at = demoNowIso();
    saveClause({ id: nextId, library, category, title, text: text.trim(), loanTypes, rule: loanTypes.trim() === "All" ? { all: true } : {}, version: 1, status: "Pending Legal approval", history: [{ version: 1, text, at, byName: actor.actorName, note: "New clause" }] });
    audit("Created clause", "Offer-letter clause", nextId, undefined, title);
    onClose();
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
          <Button disabled={!title.trim() || text.trim().length < 20} onClick={save}>
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
      </Stack>
    </Modal>
  );
}
