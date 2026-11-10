"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FilePen, Send, ShieldCheck, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CopyToClipboard,
  DataTable,
  DescriptionList,
  Field,
  Heading,
  IconButton,
  Input,
  Layout,
  Select,
  Stack,
  StatusBadge,
  Switch,
  Tabs,
  Text,
  Textarea,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan, useSession } from "@/lib/auth/session";
import { useApplications, useCollateral, useFacilities, useObligors, useTenant, useUsers } from "@/lib/data/hooks";
import { date } from "@/lib/format";
import { demoNowIso, useActor, useAuditLog } from "../../credit-admin/common";
import { mergeFields } from "../library";
import { LetterDocument } from "../letter-document";
import { buildMergeContext, facilityTerms, securityLines } from "../merge";
import { templateFor, useClauses, useOfferLetterStore, useOfferLetters, useTemplates } from "../store";
import { productLines, type HouseTemplate, type TemplateSection } from "../template";

const templateTones = { Approved: "success", Draft: "neutral", "Pending Legal sign-off": "warning", Retired: "neutral" } as const;
const kindLabel: Record<TemplateSection["kind"], string> = {
  letterhead: "Letterhead",
  text: "Static wording",
  "facility-terms": "Facility terms (merged)",
  security: "Security (merged)",
  clauses: "Clause library (merged)",
  signatures: "Signature block",
  acceptance: "Acceptance & witness",
};

export function HouseTemplatePage() {
  const templates = useTemplates();
  const saveTemplate = useOfferLetterStore((s) => s.saveTemplate);
  const canEdit = useCan("offer-letters", "edit");
  const roleId = useSession((s) => s.roleId);
  const isLegal = roleId === "legal-officer";
  const actor = useActor();
  const audit = useAuditLog();
  const [line, setLine] = useState<HouseTemplate["productLine"]>("All products");
  const [focus, setFocus] = useState<string | undefined>();
  const [highlight, setHighlight] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const versions = templates.filter((t) => t.productLine === line).sort((a, b) => b.version - a.version);
  const current = versions.find((t) => t.status === "Approved")!;
  const working = versions.find((t) => t.status === "Draft" || t.status === "Pending Legal sign-off");
  const shown = working ?? current;
  const editable = canEdit && working?.status === "Draft";

  const save = (t: HouseTemplate, msg?: string) => {
    saveTemplate(t);
    if (msg) setNotice(msg);
  };

  const createDraft = () => {
    const version = Math.max(...versions.map((v) => v.version)) + 1;
    const id = `${current.id.replace(/-\d+$/, "")}-${version}`;
    save({ ...current, id, version, status: "Draft", changeNote: "", createdByName: actor.actorName, createdAt: demoNowIso(), approvedByName: undefined, approvedAt: undefined }, `Draft v${version} created from approved v${current.version}`);
    audit("Created house-template draft", "Offer-letter template", id, `v${current.version}`, `v${version} (draft)`);
  };

  const updateSection = (id: string, changes: Partial<TemplateSection>) => {
    if (!working) return;
    save({ ...working, sections: working.sections.map((s) => (s.id === id ? { ...s, ...changes } : s)) });
  };
  const move = (id: string, dir: -1 | 1) => {
    if (!working) return;
    const list = [...working.sections];
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    save({ ...working, sections: list });
    setFocus(id);
  };

  return (
    <ModulePage module="offer-letters" description="The tenant's own house style — letterhead, section order, standing wording and signature/witness block — versioned and approved by Legal (PRD §7.0).">
      <Stack gap="large">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Field label="Product line" htmlFor="tpl-line" description="Tenants may keep separate templates per product line.">
            <Select id="tpl-line" value={line} onChange={(e) => setLine(e.target.value as HouseTemplate["productLine"])} options={productLines.map((p) => ({ value: p, label: p }))} />
          </Field>
          <Stack direction="horizontal" gap="small" wrap>
            {canEdit && !working ? (
              <Button iconBefore={<FilePen aria-hidden className="size-4" />} onClick={createDraft}>
                Edit as new version
              </Button>
            ) : null}
            {editable ? (
              <>
                <Button
                  variant="text"
                  iconBefore={<Trash2 aria-hidden className="size-4" />}
                  onClick={() => {
                    save({ ...working!, status: "Retired", changeNote: working!.changeNote || "Discarded draft" }, `Draft v${working!.version} discarded`);
                    audit("Discarded house-template draft", "Offer-letter template", working!.id);
                  }}
                >
                  Discard draft
                </Button>
                <Button
                  iconBefore={<Send aria-hidden className="size-4" />}
                  disabled={!working!.changeNote.trim()}
                  onClick={() => {
                    save({ ...working!, status: "Pending Legal sign-off" }, `v${working!.version} submitted for Legal sign-off`);
                    audit("Submitted house template for Legal sign-off", "Offer-letter template", working!.id, "Draft", "Pending Legal sign-off");
                  }}
                >
                  Submit for Legal sign-off
                </Button>
              </>
            ) : null}
            {isLegal && working?.status === "Pending Legal sign-off" ? (
              <>
                <Button
                  variant="text"
                  onClick={() => {
                    save({ ...working, status: "Draft" }, `v${working.version} returned to draft`);
                    audit("Returned house template to draft", "Offer-letter template", working.id, "Pending Legal sign-off", "Draft");
                  }}
                >
                  Return to draft
                </Button>
                <Button
                  iconBefore={<ShieldCheck aria-hidden className="size-4" />}
                  onClick={() => {
                    const at = demoNowIso();
                    save({ ...current, status: "Retired" });
                    save({ ...working, status: "Approved", approvedByName: actor.actorName, approvedAt: at }, `v${working.version} approved — used for every new letter from now on`);
                    audit("Legal-approved house template", "Offer-letter template", working.id, `v${current.version}`, `v${working.version}`);
                  }}
                >
                  Approve v{working.version}
                </Button>
              </>
            ) : null}
          </Stack>
        </div>

        {notice ? (
          <Alert tone="success" title="Template updated" action={<Button size="small" variant="text" onClick={() => setNotice(null)}>Dismiss</Button>}>
            {notice}. Recorded in the audit trail.
          </Alert>
        ) : null}
        {working ? (
          <Alert tone={working.status === "Draft" ? "info" : "warning"} title={working.status === "Draft" ? `Editing draft v${working.version}` : `v${working.version} is awaiting Legal sign-off`}>
            New letters keep using approved v{current.version} until Legal approves this version. Letters already issued always retain the version they were issued on.
          </Alert>
        ) : null}

        <Layout
          asideWidth="wide"
          aside={
            <Stack gap="medium">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text variant="eyebrow">Live preview · sample application</Text>
                <Switch label="Highlight merge fields" checked={highlight} onCheckedChange={setHighlight} size="small" />
              </div>
              <Preview template={shown} highlight={highlight} focus={focus} />
            </Stack>
          }
        >
          <Tabs
            label="Template settings"
            items={[
              {
                id: "sections",
                label: "Sections",
                content: <SectionsEditor template={shown} editable={editable} onFocus={setFocus} onUpdate={updateSection} onMove={move} onNote={(changeNote) => working && save({ ...working, changeNote })} />,
              },
              { id: "letterhead", label: "Letterhead", content: <LetterheadEditor template={shown} editable={editable} onChange={(letterhead) => working && save({ ...working, letterhead })} /> },
              { id: "fields", label: "Merge fields", badge: String(mergeFields.length), content: <MergeFieldList /> },
              { id: "versions", label: "Versions", badge: String(versions.length), content: <VersionList versions={versions} /> },
            ]}
          />
        </Layout>
      </Stack>
    </ModulePage>
  );
}

function SectionsEditor({
  template,
  editable,
  onFocus,
  onUpdate,
  onMove,
  onNote,
}: {
  template: HouseTemplate;
  editable: boolean;
  onFocus: (id: string) => void;
  onUpdate: (id: string, c: Partial<TemplateSection>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onNote: (note: string) => void;
}) {
  return (
    <Stack gap="medium">
      <DescriptionList
        columns={2}
        items={[
          { label: "Template", value: `${template.name} v${template.version}` },
          { label: "Status", status: template.status, statusTones: templateTones },
          { label: "Approved by", value: template.approvedAt ? `${template.approvedByName} · ${date(template.approvedAt)}` : "Not yet approved" },
          { label: "Sections", value: `${template.sections.filter((s) => s.enabled).length} of ${template.sections.length} enabled` },
        ]}
      />
      {editable ? (
        <Field label="Change note" htmlFor="tpl-note" description="Required before submitting for Legal sign-off.">
          <Input id="tpl-note" value={template.changeNote} onChange={(e) => onNote(e.target.value)} placeholder="e.g. Witness block moved under the Memorandum of Acceptance" />
        </Field>
      ) : null}
      <ol className="flex flex-col gap-3">
        {template.sections.map((s, i) => (
          <li key={s.id}>
            <Card padding="small" variant={s.enabled ? "outlined" : "filled"} onFocus={() => onFocus(s.id)} onMouseEnter={() => onFocus(s.id)}>
              <Stack gap="small">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-fg-subtle">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-medium text-fg">{s.title}</span>
                    <Badge tone={s.kind === "clauses" ? "accent" : "neutral"}>{kindLabel[s.kind]}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {editable ? (
                      <>
                        <IconButton size="small" variant="text" label={`Move ${s.title} up`} icon={<ArrowUp aria-hidden className="size-4" />} onClick={() => onMove(s.id, -1)} disabled={i === 0} />
                        <IconButton size="small" variant="text" label={`Move ${s.title} down`} icon={<ArrowDown aria-hidden className="size-4" />} onClick={() => onMove(s.id, 1)} disabled={i === template.sections.length - 1} />
                      </>
                    ) : null}
                    <Switch label="Included" hideLabel size="small" checked={s.enabled} disabled={!editable || s.kind === "letterhead"} onCheckedChange={(v) => onUpdate(s.id, { enabled: v })} />
                  </div>
                </div>
                {s.body !== undefined ? (
                  editable ? (
                    <Textarea aria-label={`${s.title} wording`} rows={3} autoResize value={s.body} onChange={(e) => onUpdate(s.id, { body: e.target.value })} />
                  ) : (
                    <p className="text-sm whitespace-pre-line text-fg-muted">{s.body}</p>
                  )
                ) : s.kind === "clauses" ? (
                  <Text variant="small" tone="muted">
                    Clauses selected for the letter from this library are merged here at generation.
                  </Text>
                ) : null}
              </Stack>
            </Card>
          </li>
        ))}
      </ol>
    </Stack>
  );
}

function LetterheadEditor({ template, editable, onChange }: { template: HouseTemplate; editable: boolean; onChange: (l: HouseTemplate["letterhead"]) => void }) {
  const l = template.letterhead;
  return (
    <Stack gap="medium">
      <Alert tone="info" title="Logo and colours follow the tenant brand">
        The letterhead logo is the tenant&apos;s brand logo (Settings → Branding), so the letter always matches the bank&apos;s current identity.
      </Alert>
      <Field label="Address line" htmlFor="lh-a">
        <Input id="lh-a" value={l.addressLine} disabled={!editable} onChange={(e) => onChange({ ...l, addressLine: e.target.value })} />
      </Field>
      <Field label="Contact line" htmlFor="lh-c">
        <Input id="lh-c" value={l.contactLine} disabled={!editable} onChange={(e) => onChange({ ...l, contactLine: e.target.value })} />
      </Field>
      <Field label="Footer (registration / licensing statement)" htmlFor="lh-f">
        <Input id="lh-f" value={l.footer} disabled={!editable} onChange={(e) => onChange({ ...l, footer: e.target.value })} />
      </Field>
    </Stack>
  );
}

function MergeFieldList() {
  return (
    <DataTable
      label="Merge fields"
      data={mergeFields}
      getRowId={(m) => m.token}
      paginate={false}
      columns={[
        {
          id: "token",
          header: "Field",
          accessor: "token",
          cell: (m) => (
            <span className="inline-flex items-center gap-1 font-mono text-xs text-fg">
              {`{{${m.token}}}`}
              <CopyToClipboard value={`{{${m.token}}}`} label={`Copy ${m.token}`} />
            </span>
          ),
        },
        { id: "label", header: "Meaning", accessor: "label" },
        { id: "source", header: "Source", accessor: "source", cell: (m) => <span className="text-sm text-fg-muted">{m.source}</span> },
      ]}
      mobileCard={(m) => (
        <Stack gap="xsmall">
          <span className="font-mono text-xs text-fg">{`{{${m.token}}}`}</span>
          <span className="text-sm text-fg-muted">
            {m.label} · {m.source}
          </span>
        </Stack>
      )}
    />
  );
}

function VersionList({ versions }: { versions: HouseTemplate[] }) {
  const letters = useOfferLetters();
  return (
    <DataTable
      label="Template versions"
      data={versions}
      getRowId={(t) => t.id}
      paginate={false}
      columns={[
        { id: "version", header: "Version", accessor: "version", cell: (t) => <span className="font-mono">v{t.version}</span> },
        { id: "status", header: "Status", accessor: "status", cell: (t) => <StatusBadge status={t.status} tones={templateTones} /> },
        { id: "note", header: "Change", accessor: "changeNote", cell: (t) => <span className="text-sm">{t.changeNote || "—"}</span> },
        { id: "approved", header: "Approved", accessor: (t) => t.approvedAt ?? "", cell: (t) => (t.approvedAt ? <span className="text-sm">{date(t.approvedAt)} · {t.approvedByName}</span> : "—") },
        { id: "letters", header: "Letters", accessor: (t) => letters.filter((l) => l.templateId === t.id).length, numeric: true, align: "end" },
      ]}
      mobileCard={(t) => (
        <Stack gap="xsmall">
          <div className="flex items-center justify-between">
            <span className="font-mono">v{t.version}</span>
            <StatusBadge status={t.status} tones={templateTones} />
          </div>
          <span className="text-sm text-fg-muted">{t.changeNote}</span>
        </Stack>
      )}
    />
  );
}

function Preview({ template, highlight, focus }: { template: HouseTemplate; highlight: boolean; focus?: string }) {
  const letters = useOfferLetters();
  const apps = useApplications();
  const obligors = useObligors();
  const facilities = useFacilities();
  const collateral = useCollateral();
  const users = useUsers();
  const tenant = useTenant();
  const clauses = useClauses();
  const templates = useTemplates();
  const sample = useMemo(() => {
    const letter = letters.find((l) => {
      const a = apps.find((x) => x.id === l.applicationId);
      return a && templateFor(templates, a.product).productLine === template.productLine;
    }) ?? letters[0];
    const app = letter && apps.find((a) => a.id === letter.applicationId);
    if (!letter || !app) return undefined;
    const ctx = buildMergeContext({ app, obligor: obligors.find((o) => o.id === app.obligorId), facility: facilities.find((f) => f.applicationId === app.id), collateral, tenant, users, letter });
    return { letter, app, ctx };
  }, [letters, apps, obligors, facilities, collateral, users, tenant, templates, template.productLine]);
  if (!sample) return <Text tone="muted">No sample application available.</Text>;
  return (
    <Stack gap="small">
      <Heading level={2} size="xsmall" className="sr-only">
        Preview
      </Heading>
      <Text variant="small" tone="muted">
        Sample: {sample.letter.ref} ({sample.app.id})
      </Text>
      <LetterDocument template={template} letter={sample.letter} clauses={clauses} ctx={sample.ctx} terms={facilityTerms()} security={securityLines(sample.app, collateral)} highlight={highlight} focusSectionId={focus} />
    </Stack>
  );
}
