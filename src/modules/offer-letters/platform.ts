"use client";

/**
 * Platform registrations for the offer-letters module (PRD §7): business rules, operation types (Operations
 * workflow), notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md → Platform services.
 *
 * Approvals routed through Operations:
 *  - "offer-letters.letter.signoff"  Legal sign-off & issue of a letter (also re-issue after lapse).
 *  - "offer-letters.clause.change"   New clause / wording change / retire / reinstate in the clause library.
 *  - "offer-letters.template.approve" New version of the house template.
 */
import { defineEvents, publish, subscribe } from "@/lib/platform/events";
import { defineHookPoints, runHooks } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, useOperationsStore, type OperationInstance, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules } from "@/lib/platform/rules";
import type { Actor } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { auditAs, demoNowIso } from "../credit-admin/common";
import { useOfferLetterStore, type OfferLetter } from "./store";
import type { Clause } from "./library";
import { seedTemplates, type HouseTemplate } from "./template";

const DEMO = "Tenant parameter";
const MODULE = "offer-letters";

// ---------------------------------------------------------------- business rules
defineRules([
  { key: "offer-letters.validityDaysDefault", label: "Acceptance validity (default)", description: "Days an issued offer stays open for acceptance under seal before it lapses.", module: MODULE, category: "Acceptance", type: "duration", durationUnit: "days", default: 7, min: 1, max: 90, source: "Acceptance Validity (commonly 7 days)" },
  { key: "offer-letters.validityDaysMin", label: "Acceptance validity — minimum", description: "Shortest validity Legal may set on a letter.", module: MODULE, category: "Acceptance", type: "duration", durationUnit: "days", default: 1, min: 1, max: 30, source: DEMO },
  { key: "offer-letters.validityDaysMax", label: "Acceptance validity — maximum", description: "Longest validity Legal may set on a letter.", module: MODULE, category: "Acceptance", type: "duration", durationUnit: "days", default: 90, min: 1, max: 365, source: DEMO },
  { key: "offer-letters.noticeDays", label: "Notice period (merge field)", description: "Value merged into {{notice.days}} in clauses (e.g. share-cover top-up).", module: MODULE, category: "Merge fields", type: "duration", durationUnit: "days", default: 10, min: 1, max: 90, source: "build note (notice-period days as a merge field)" },
  { key: "offer-letters.referencePrefix", label: "Letter reference prefix", description: "Prefix of generated offer-letter references (followed by year and sequence).", module: MODULE, category: "Generation", type: "text", default: "HLB/CAD/OL", source: DEMO },
  { key: "offer-letters.minClauseTextLength", label: "Minimum clause text", description: "Characters required for a new, bespoke or edited clause.", module: MODULE, category: "Clause library", type: "number", unit: "characters", default: 20, min: 1, max: 500, source: DEMO },
  { key: "offer-letters.insuranceWarningDays", label: "Insurance-expiry warning window", description: "Pre-release check flags collateral insurance expiring within this many days.", module: MODULE, category: "Pre-release checks", type: "duration", durationUnit: "days", default: 30, min: 1, max: 365, source: DEMO },
  { key: "offer-letters.recentAcceptanceDays", label: "Recent acceptance window", description: "Window for the “Accepted” KPI on the offer-letter list.", module: MODULE, category: "Reporting", type: "duration", durationUnit: "days", default: 30, min: 1, max: 365, source: DEMO },
  {
    key: "offer-letters.contingentTemplateProducts",
    label: "Products using the contingent-facilities template",
    description: "Products whose letters merge into the “Contingent facilities” house template (per product line).",
    module: MODULE,
    category: "Generation",
    type: "list",
    default: ["Bank guarantee", "Advance payment guarantee"],
    source: "tenant product-line templates",
  },
  {
    key: "offer-letters.unsecuredCollateralTypes",
    label: "Collateral types that don't make a facility “secured”",
    description: "Used when auto-tagging clauses that apply to secured facilities.",
    module: MODULE,
    category: "Auto-tagging",
    type: "list",
    default: ["Personal guarantee", "Corporate guarantee", "Domiciliation of proceeds"],
    source: DEMO,
  },
  { key: "offer-letters.signoffRequesterRoles", label: "Who sends letters to Legal", description: "Roles that submit a letter for Legal sign-off & issue, or request a re-issue.", module: MODULE, category: "Roles", type: "roles", default: ["account-officer", "credit-admin-officer"], source: "steps 13–14 (Account Officer presents; Credit Admin)" },
  { key: "offer-letters.legalEditorRoles", label: "Who edits clauses on a letter", description: "Roles that add, remove or edit clauses while the letter is in Legal review.", module: MODULE, category: "Roles", type: "roles", default: ["legal-officer"], source: "Legal Officer /" },
  { key: "offer-letters.acceptanceRecorderRoles", label: "Who records customer acceptance", description: "Roles that record the signed duplicate and Memorandum of Acceptance.", module: MODULE, category: "Roles", type: "roles", default: ["account-officer", "credit-admin-officer", "legal-officer"], source: "Tenant mapping" },
  { key: "offer-letters.libraryEditorRoles", label: "Who proposes clause-library and template changes", description: "Roles that propose new clauses, wording changes, retirements and house-template versions.", module: MODULE, category: "Roles", type: "roles", default: ["legal-officer"], source: "7.3 (Legal approves the text)" },
]);

// ---------------------------------------------------------------- helpers
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });
const letterHref = (id: string) => `/offer-letters/letter/?id=${id}`;

function nextVersion(letter: OfferLetter) {
  return (letter.versions[letter.versions.length - 1]?.version ?? 0) + 1;
}

function saveLetterVersion(letter: OfferLetter, changes: Partial<OfferLetter>, byName: string, summary: string): OfferLetter {
  const at = demoNowIso();
  const updated: OfferLetter = { ...letter, ...changes, updatedAt: at, versions: [...letter.versions, { version: nextVersion(letter), at, byName, summary }] };
  useOfferLetterStore.getState().saveLetter(updated);
  return updated;
}

// ---------------------------------------------------------------- operations
export type LetterSignoffPayload = {
  letterId: string;
  mode: "issue" | "reissue";
  /** Snapshot at submission (used when the stored copy is missing). */
  snapshot: OfferLetter;
  ref: string;
  obligorName: string;
  amount: string;
  /** Relationship manager / account officer to notify on issue. */
  rmUserId?: string;
};

registerOperation<LetterSignoffPayload>({
  type: "offer-letters.letter.signoff",
  name: "Offer letter — Legal sign-off & issue",
  module: MODULE,
  description: "Legal approves the conditions and covenants text and releases the letter to the Account Officer for customer presentation. Also used to re-issue a lapsed offer.",
  defaultSteps: [step("legal", "Legal sign-off", ["legal-officer"], 48)],
  apply: async (p, { instance, actor }) => {
    const letter = useOfferLetterStore.getState().letters[p.letterId] ?? p.snapshot;
    const at = demoNowIso();
    const summary =
      p.mode === "reissue"
        ? `Re-issued after lapse — new ${letter.validityDays}-day validity (${instance.id})`
        : `Legal sign-off on conditions & covenants text; released to the Account Officer (validity ${letter.validityDays} days, ${instance.id})`;
    const updated = saveLetterVersion(letter, { status: "Issued", legalSignedOffByName: actor.name, legalSignedOffAt: at, issuedAt: at, legalReviewerName: letter.legalReviewerName ?? actor.name }, actor.name, summary);
    auditAs(actor, p.mode === "reissue" ? "Re-issued offer letter" : "Legal sign-off — offer letter issued", "Offer letter", letter.id, letter.status, "Issued");
    publish(p.mode === "reissue" ? "offer-letters.letter.reissued" : "offer-letters.letter.issued", {
      module: MODULE,
      subject: { type: "OfferLetter", id: letter.id, title: p.ref, href: letterHref(letter.id) },
      payload: { applicationId: letter.applicationId, validityDays: letter.validityDays, operationId: instance.id },
    });
    notify({
      templateId: "offer-letters.letter-issued",
      toUserIds: p.rmUserId ? [p.rmUserId, instance.requestedBy.id] : [instance.requestedBy.id],
      toRoles: ["credit-admin-officer"],
      href: letterHref(letter.id),
      data: { ref: p.ref, obligor: p.obligorName, amount: p.amount, validityDays: String(letter.validityDays), signedOffBy: actor.name, reissue: p.mode === "reissue" ? "Re-issued" : "Issued" },
    });
    await runHooks("offer-letters.letter.issue.after", { letter: updated, instance });
  },
});

export type ClauseChangePayload = {
  clauseId: string;
  change: "new" | "wording" | "retire" | "reinstate";
  title: string;
  text?: string;
  note: string;
  snapshot: Clause;
};

registerOperation<ClauseChangePayload>({
  type: "offer-letters.clause.change",
  name: "Clause library change",
  module: MODULE,
  description: "Add, re-word, retire or reinstate an offer-letter library clause. The approved version stays in use until this is approved.",
  // Second-person approval: another Legal Officer, or Head of Risk where the tenant has a single Legal Officer (see docs/OPEN-QUESTIONS.md OL-OPS-1).
  defaultSteps: [step("legal", "Legal approval", ["legal-officer", "head-of-risk"], 72)],
  apply: (p, { instance, actor }) => {
    const clause = useOfferLetterStore.getState().clauses[p.clauseId] ?? p.snapshot;
    const at = demoNowIso();
    let updated: Clause;
    if (p.change === "retire" || p.change === "reinstate") {
      updated = { ...clause, status: p.change === "retire" ? "Retired" : "Legal-approved", history: [...clause.history, { version: clause.version, text: clause.text, at, byName: actor.name, note: `${p.change === "retire" ? "Retired" : "Reinstated"} (${instance.id})` }] };
    } else {
      const isNew = p.change === "new";
      const version = isNew ? clause.version : clause.version + 1;
      const text = clause.proposedText ?? p.text ?? clause.text;
      updated = { ...clause, text, proposedText: undefined, version, status: "Legal-approved", approvedByName: actor.name, approvedAt: at, history: [...clause.history, { version, text, at, byName: actor.name, note: `Legal-approved (${instance.id})` }] };
    }
    useOfferLetterStore.getState().saveClause(updated);
    auditAs(actor, `Approved clause change (${p.change})`, "Offer-letter clause", clause.id, `${clause.status} v${clause.version}`, `${updated.status} v${updated.version}`);
    const event = p.change === "retire" ? "offer-letters.clause.retired" : p.change === "reinstate" ? "offer-letters.clause.reinstated" : "offer-letters.clause.approved";
    publish(event, { module: MODULE, subject: { type: "Clause", id: clause.id, title: clause.title, href: "/offer-letters/library/" }, payload: { change: p.change, version: updated.version, operationId: instance.id } });
    notify({
      templateId: "offer-letters.clause-approved",
      toRoles: ["legal-officer", "credit-admin-officer"],
      href: "/offer-letters/library/",
      data: { clauseId: clause.id, title: clause.title, change: p.change, version: `v${updated.version}`, approvedBy: actor.name },
    });
  },
});

export type TemplateApprovalPayload = { templateId: string; name: string; version: number; productLine: HouseTemplate["productLine"]; changeNote: string; snapshot: HouseTemplate };

registerOperation<TemplateApprovalPayload>({
  type: "offer-letters.template.approve",
  name: "House template version",
  module: MODULE,
  description: "Approve a new version of the tenant's offer-letter house template. New letters use it from approval; issued letters keep their version.",
  defaultSteps: [step("legal", "Legal sign-off", ["legal-officer", "head-of-risk"], 72)],
  apply: (p, { instance, actor }) => {
    const s = useOfferLetterStore.getState();
    const draft = s.templates[p.templateId] ?? p.snapshot;
    const at = demoNowIso();
    // Retire the version currently approved for the product line.
    for (const t of Object.values(s.templates)) if (t.productLine === draft.productLine && t.status === "Approved" && t.id !== draft.id) s.saveTemplate({ ...t, status: "Retired" });
    retireSeedApproved(draft);
    s.saveTemplate({ ...draft, status: "Approved", approvedByName: actor.name, approvedAt: at });
    auditAs(actor, "Legal-approved house template", "Offer-letter template", draft.id, "Pending Legal sign-off", `Approved v${draft.version}`);
    publish("offer-letters.template.approved", { module: MODULE, subject: { type: "HouseTemplate", id: draft.id, title: `${draft.name} v${draft.version}`, href: "/offer-letters/template/" }, payload: { productLine: draft.productLine, version: draft.version, operationId: instance.id } });
    notify({ templateId: "offer-letters.template-approved", toRoles: ["legal-officer", "credit-admin-officer"], href: "/offer-letters/template/", data: { name: draft.name, version: `v${draft.version}`, productLine: draft.productLine, changeNote: draft.changeNote, approvedBy: actor.name } });
  },
});

/** Seeded approved templates aren't in the store until changed; retire them explicitly. */
function retireSeedApproved(draft: HouseTemplate) {
  const s = useOfferLetterStore.getState();
  for (const t of seedTemplates) if (t.productLine === draft.productLine && t.status === "Approved" && t.id !== draft.id && !s.templates[t.id]) s.saveTemplate({ ...t, status: "Retired" });
}

// Returned / rejected / withdrawn requests put the record back where the requester can act on it.
subscribe({
  id: "offer-letters.on-operation-closed",
  name: "Offer letters — revert records when a request is returned, rejected or withdrawn",
  pattern: "operations.request.*",
  handler: (event) => {
    const outcome = event.name.split(".").pop();
    if (!outcome || !["returned", "rejected", "cancelled"].includes(outcome)) return;
    const payload = event.payload as { operationType?: string };
    const instance = useOperationsStore.getState().instances.find((i) => i.id === event.subject?.id);
    if (!instance || !payload.operationType?.startsWith(`${MODULE}.`)) return;
    revert(instance, outcome as "returned" | "rejected" | "cancelled");
  },
});

function revert(instance: OperationInstance, outcome: "returned" | "rejected" | "cancelled") {
  const by = closingActor(instance);
  const actor: Actor = { ...by, tenantId: "-" };
  const label = outcome === "cancelled" ? "withdrawn" : outcome;
  const reason = instance.reason ? `: ${instance.reason}` : "";
  const s = useOfferLetterStore.getState();
  if (instance.operationType === "offer-letters.letter.signoff") {
    const p = instance.payload as LetterSignoffPayload;
    const letter = s.letters[p.letterId] ?? p.snapshot;
    if (p.mode === "issue") saveLetterVersion(letter, { status: "Draft" }, actor.name, `Sign-off request ${instance.id} ${label}${reason}`);
    else saveLetterVersion(letter, {}, actor.name, `Re-issue request ${instance.id} ${label}${reason}`);
    auditAs(actor, `Offer-letter sign-off ${label}`, "Offer letter", letter.id, "Legal review", p.mode === "issue" ? "Draft" : letter.status);
    publish("offer-letters.letter.returned", { module: MODULE, subject: { type: "OfferLetter", id: letter.id, title: p.ref, href: letterHref(letter.id) }, payload: { outcome, operationId: instance.id } });
  } else if (instance.operationType === "offer-letters.clause.change") {
    const p = instance.payload as ClauseChangePayload;
    const clause = s.clauses[p.clauseId] ?? p.snapshot;
    const at = demoNowIso();
    const status = p.change === "new" ? "Retired" : clause.status === "Pending Legal approval" ? "Legal-approved" : clause.status;
    s.saveClause({ ...clause, proposedText: undefined, status, history: [...clause.history, { version: clause.version, text: clause.text, at, byName: actor.name, note: `Change ${label}${reason}` }] });
    auditAs(actor, `Clause change ${label}`, "Offer-letter clause", clause.id, clause.status, status);
    publish("offer-letters.clause.rejected", { module: MODULE, subject: { type: "Clause", id: clause.id, title: clause.title }, payload: { outcome, operationId: instance.id } });
  } else if (instance.operationType === "offer-letters.template.approve") {
    const p = instance.payload as TemplateApprovalPayload;
    const t = s.templates[p.templateId] ?? p.snapshot;
    s.saveTemplate({ ...t, status: "Draft" });
    auditAs(actor, `House template ${label}`, "Offer-letter template", t.id, "Pending Legal sign-off", "Draft");
    publish("offer-letters.template.returned", { module: MODULE, subject: { type: "HouseTemplate", id: t.id, title: `${t.name} v${t.version}` }, payload: { outcome, operationId: instance.id } });
  }
}

/** The person who closed the request (last decision), else the requester (withdrawal). */
function closingActor(instance: OperationInstance) {
  const last = instance.decisions[instance.decisions.length - 1];
  return last && instance.status !== "Cancelled" ? { id: last.actorId, name: last.actorName, roleId: last.roleId } : instance.requestedBy;
}

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "offer-letters.letter-issued",
    name: "Offer letter issued",
    module: MODULE,
    trigger: "offer-letters.letter.issued / offer-letters.letter.reissued",
    subject: "{{reissue}}: offer letter {{ref}} for {{obligor}}",
    inApp: "Offer letter {{ref}} ({{obligor}}, {{amount}}) was signed off by {{signedOffBy}} — present it to the customer within {{validityDays}} days.",
    body: "<p>Legal has signed off offer letter <strong>{{ref}}</strong>.</p><ul><li>Obligor: {{obligor}}</li><li>Facility amount: {{amount}}</li><li>Acceptance validity: {{validityDays}} days from issue</li><li>Signed off by: {{signedOffBy}}</li></ul><p>Present the letter to the customer and record acceptance once the signed duplicate and Memorandum of Acceptance are received.</p>",
    tone: "success",
    variables: [
      { name: "reissue", description: "“Issued” or “Re-issued”", example: "Issued" },
      { name: "ref", description: "Letter reference", example: "HLB/CAD/OL/2026/014" },
      { name: "obligor", description: "Obligor name", example: "Adeyemi Foods Ltd" },
      { name: "amount", description: "Facility amount", example: "₦250,000,000" },
      { name: "validityDays", description: "Acceptance validity (days)", example: "7" },
      { name: "signedOffBy", description: "Legal Officer who signed off", example: "Ngozi Eze" },
    ],
  }),
  tpl({
    id: "offer-letters.acceptance-recorded",
    name: "Customer acceptance recorded",
    module: MODULE,
    trigger: "offer-letters.letter.accepted",
    subject: "Offer accepted: {{ref}} ({{obligor}})",
    inApp: "{{obligor}} accepted offer {{ref}} on {{acceptedOn}} — conditions precedent can now be cleared.",
    body: "<p><strong>{{obligor}}</strong> has accepted offer letter <strong>{{ref}}</strong>.</p><ul><li>Acceptance date: {{acceptedOn}}</li><li>Recorded by: {{recordedBy}}</li></ul><p>The “Signed acceptance” condition precedent is cleared and the application has moved to the Conditions stage.</p>",
    tone: "success",
    variables: [
      { name: "ref", description: "Letter reference", example: "HLB/CAD/OL/2026/014" },
      { name: "obligor", description: "Obligor name", example: "Adeyemi Foods Ltd" },
      { name: "acceptedOn", description: "Date on the signed duplicate", example: "10 Nov 2026" },
      { name: "recordedBy", description: "Who recorded it", example: "Tunde Bakare" },
    ],
  }),
  tpl({
    id: "offer-letters.clause-approved",
    name: "Clause library change approved",
    module: MODULE,
    trigger: "offer-letters.clause.approved / retired / reinstated",
    subject: "Clause {{clauseId}} updated ({{change}})",
    inApp: "Clause {{clauseId}} “{{title}}” — {{change}} approved by {{approvedBy}} ({{version}}).",
    body: "<p>The clause library change for <strong>{{clauseId}} — {{title}}</strong> was approved.</p><ul><li>Change: {{change}}</li><li>Version in use: {{version}}</li><li>Approved by: {{approvedBy}}</li></ul><p>New letters use the approved version from now on; issued letters are unchanged.</p>",
    tone: "info",
    variables: [
      { name: "clauseId", description: "Clause ID", example: "CP-04" },
      { name: "title", description: "Clause title", example: "Satisfactory CRMS search" },
      { name: "change", description: "new / wording / retire / reinstate", example: "wording" },
      { name: "version", description: "Version now in use", example: "v3" },
      { name: "approvedBy", description: "Approver", example: "Ngozi Eze" },
    ],
  }),
  tpl({
    id: "offer-letters.template-approved",
    name: "House template approved",
    module: MODULE,
    trigger: "offer-letters.template.approved",
    subject: "House template approved: {{name}} {{version}}",
    inApp: "{{name}} {{version}} ({{productLine}}) is now used for new offer letters.",
    body: "<p><strong>{{name}} {{version}}</strong> for {{productLine}} was approved by {{approvedBy}}.</p><p>Change: {{changeNote}}</p><p>Every new letter for this product line uses this version; issued letters keep the version they were issued on.</p>",
    tone: "info",
    variables: [
      { name: "name", description: "Template name", example: "Standard credit offer letter" },
      { name: "version", description: "Version", example: "v4" },
      { name: "productLine", description: "Product line", example: "All products" },
      { name: "changeNote", description: "Change note", example: "Witness block moved under the Memorandum of Acceptance" },
      { name: "approvedBy", description: "Approver", example: "Ngozi Eze" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "offer-letters.letter.edited", module: MODULE, description: "A letter's clauses, wording or validity changed (version history entry)." },
  { name: "offer-letters.letter.submitted", module: MODULE, description: "A letter was sent to Legal for sign-off & issue (Operations request created)." },
  { name: "offer-letters.letter.issued", module: MODULE, description: "Legal signed off and the letter was issued." },
  { name: "offer-letters.letter.reissued", module: MODULE, description: "A lapsed letter was re-issued with a new validity period." },
  { name: "offer-letters.letter.returned", module: MODULE, description: "A sign-off / re-issue request was returned, rejected or withdrawn." },
  { name: "offer-letters.letter.accepted", module: MODULE, description: "Customer acceptance was recorded (signed duplicate + Memorandum of Acceptance)." },
  { name: "offer-letters.letter.commented", module: MODULE, description: "An internal review comment was added to a letter." },
  { name: "offer-letters.clause.proposed", module: MODULE, description: "A clause-library change was proposed (Operations request created)." },
  { name: "offer-letters.clause.approved", module: MODULE, description: "A new clause or wording change was approved." },
  { name: "offer-letters.clause.retired", module: MODULE, description: "A clause was retired from the library." },
  { name: "offer-letters.clause.reinstated", module: MODULE, description: "A retired clause was reinstated." },
  { name: "offer-letters.clause.rejected", module: MODULE, description: "A clause-library change was returned, rejected or withdrawn." },
  { name: "offer-letters.template.drafted", module: MODULE, description: "A new house-template draft version was created, edited or discarded." },
  { name: "offer-letters.template.submitted", module: MODULE, description: "A house-template version was submitted for Legal sign-off." },
  { name: "offer-letters.template.approved", module: MODULE, description: "A house-template version was approved and is now in use." },
  { name: "offer-letters.template.returned", module: MODULE, description: "A house-template version was returned, rejected or withdrawn." },
]);

defineHookPoints([
  { point: "offer-letters.signoff.submit.before", module: MODULE, kind: "before", description: "Before a letter is sent to Legal for sign-off / re-issue. Veto to block (e.g. extra pre-release checks)." },
  { point: "offer-letters.signoff.submit.after", module: MODULE, kind: "after", description: "After the sign-off request is created." },
  { point: "offer-letters.letter.issue.after", module: MODULE, kind: "after", description: "After a letter is issued (e.g. push to a DMS or e-signature service)." },
  { point: "offer-letters.letter.edit.before", module: MODULE, kind: "before", description: "Before a clause/wording/validity change is saved on a letter. Veto or enrich." },
  { point: "offer-letters.letter.edit.after", module: MODULE, kind: "after", description: "After a letter change is saved." },
  { point: "offer-letters.acceptance.record.before", module: MODULE, kind: "before", description: "Before customer acceptance is recorded. Veto to block (e.g. signature verification)." },
  { point: "offer-letters.acceptance.record.after", module: MODULE, kind: "after", description: "After acceptance is recorded and the CP cleared." },
  { point: "offer-letters.clause.submit.before", module: MODULE, kind: "before", description: "Before a clause-library change is submitted for approval." },
  { point: "offer-letters.clause.submit.after", module: MODULE, kind: "after", description: "After a clause-library change is submitted." },
  { point: "offer-letters.template.submit.before", module: MODULE, kind: "before", description: "Before a house-template version is submitted for Legal sign-off." },
  { point: "offer-letters.template.submit.after", module: MODULE, kind: "after", description: "After a house-template version is submitted." },
]);
