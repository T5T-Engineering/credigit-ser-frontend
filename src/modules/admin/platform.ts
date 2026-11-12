"use client";

/**
 * Platform registrations for the admin module: business rules, operation types (Operations workflow),
 * notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md → Platform services.
 *
 * Admin → Rules & parameters is a filtered view over `ruleDefinitions()`; edits call `requestRuleChange()`.
 * Rules owned elsewhere are NOT duplicated here: step-up threshold (`approvals.stepUpThresholdNgn`), sign-on
 * limits (`rbac.limit.*`), sessions/auth and 360 RAR (`rar.*`) are core; IFRS 9 / provisioning belong to the
 * ifrs9 module, collateral haircuts to collateral, Fast-Track and chart-flow to origination.
 */
import { roles, type RoleId } from "@/lib/rbac/roles";
import { useDb } from "@/lib/data/store";
import type { ProductType, User } from "@/lib/data/types";
import { defineEvents, publish } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineTemplates, notify, type NotificationTemplate } from "@/lib/platform/notifications";
import { registerOperation, type WorkflowStep } from "@/lib/platform/operations";
import { defineRules, type RuleDefinition } from "@/lib/platform/rules";
import { currentActor } from "@/lib/platform/scope";
import { allProducts, productSlug, roleName } from "./rule-keys";
import { addCustomRole, removeCustomRole, updateCustomRole, useAdminStore, type CustomRole } from "./store";
import { applyRolePermissionChange } from "@/lib/iam/grants-store";
import { permissionFor, type PermissionKey } from "@/lib/iam/catalogue";
import { roleById as staticRoleById } from "@/lib/rbac/roles";

const DEMO = "Tenant parameter (demo value)";

/** PRD §4.2: tighter session defaults for Disbursement Maker/Checker and Legal. */
const tighterByPrd: RoleId[] = ["disbursement-maker", "disbursement-checker", "legal-officer"];

// Demo default tenors (months) — tenant configuration.
const demoTenor = (p: ProductType) => (p === "Overdraft" || p === "Revolving credit" ? 12 : p === "Mortgage" ? 240 : p.includes("guarantee") ? 24 : 60);


// ---------------------------------------------------------------- business rules
defineRules([
  // Role names (PRD §4.0: rename to match the organogram) — labels of configurable things.
  ...roles.map(
    (r): RuleDefinition => ({
      key: `admin.roleName.${r.id}`,
      label: `Role name — ${r.name}`,
      description: "Display name of this role in Admin and approval screens.",
      module: "admin",
      category: "Role names",
      type: "text",
      default: r.name,
      source: "PRD §4.0 — default role set is illustrative; tenant renames",
    }),
  ),
  // Per-role session security (PRD §4.2).
  ...roles.flatMap((r): RuleDefinition[] => {
    const tight = tighterByPrd.includes(r.id);
    return [
      {
        key: `session.idleTimeoutMinutes.${r.id}`,
        label: `Idle timeout — ${r.name}`,
        description: "Sign users with this role out after this much inactivity.",
        module: "admin",
        category: "Session security",
        type: "duration",
        durationUnit: "minutes",
        default: tight ? 10 : 15,
        min: 1,
        max: 240,
        source: "PRD §4.2 (configurable per role; tighter for disbursement and legal) — demo value",
      },
      {
        key: `session.deviceBinding.${r.id}`,
        label: `Device binding — ${r.name}`,
        description: "Only devices registered to the user can sign in with this role.",
        module: "admin",
        category: "Session security",
        type: "boolean",
        default: tight,
        source: "PRD §4.2 — demo value",
      },
      {
        key: `session.ipAllowList.${r.id}`,
        label: `IP allow-list — ${r.name}`,
        description: "IPv4 addresses or CIDR ranges this role may sign in from. Empty = any network.",
        module: "admin",
        category: "Session security",
        type: "list",
        default: tight ? ["10.20.0.0/16"] : [],
        source: "PRD §4.2 — demo value",
      },
    ];
  }),
  // Product catalogue (PRD §4.1, §6.1). Products offered / Fast-Track variants are origination rules
  // (origination.products, origination.fastTrack.variants) — only tenor caps are admin-owned.
  ...allProducts.map(
    (p): RuleDefinition => ({
      key: `admin.product.maxTenorMonths.${productSlug(p)}`,
      label: `Maximum tenor — ${p}`,
      description: "Longest tenor a new application for this product may request.",
      module: "admin",
      category: "Product catalogue",
      type: "number",
      unit: "months",
      default: demoTenor(p),
      min: 1,
      max: 360,
      source: `PRD §6.1 — ${DEMO}`,
    }),
  ),
  // User administration.
  {
    key: "admin.user.minNameParts",
    label: "Words required in a user's full name",
    description: "Named individuals only — rejects shared or generic logins (PRD §4).",
    module: "admin",
    category: "User administration",
    type: "number",
    default: 2,
    min: 1,
    max: 5,
    source: DEMO,
  },
  {
    key: "admin.user.defaultInviteRole",
    label: "Default role for new invitations",
    description: "Role pre-selected in the Invite user dialog.",
    module: "admin",
    category: "User administration",
    type: "enum",
    options: roles.map((r) => ({ value: r.id, label: r.name })),
    default: "account-officer",
    source: DEMO,
  },
]);

// ---------------------------------------------------------------- operations
const step = (id: string, name: string, approverRoles: RoleId[], slaHours: number): WorkflowStep => ({ id, name, approverRoles, mode: "any", slaHours });
/** Second-person confirmation for admin changes (assumption ADM-OPS1 in docs/OPEN-QUESTIONS.md). */
const confirm = (slaHours = 24) => [step("confirm", "Second-person confirmation", ["system-admin", "cro", "head-of-risk"], slaHours)];

const userHref = (id: string) => `/admin?user=${encodeURIComponent(id)}`;
const actorName = () => currentActor().name;
const db = () => useDb.getState();
const log = (action: string, entityType: string, entityId: string, before?: string, after?: string) => {
  const a = currentActor();
  db().log({ actorId: a.id, actorName: a.name, roleId: a.roleId, action, entityType, entityId, before, after });
};

export type UserInvitePayload = { user: User; reason: string };
registerOperation<UserInvitePayload>({
  type: "user.invite",
  name: "User invitation",
  module: "admin",
  description: "Invite a named user with a role (PRD §4: System Admin creates users; MFA on first sign-in).",
  defaultSteps: confirm(),
  apply: ({ user }) => {
    db().upsert("users", user);
    log("Invited user (approved)", "User", user.id, undefined, `${user.name} · ${roleName(user.roleId)} · ${user.branch}`);
    publish("admin.user.invited", { module: "admin", subject: { type: "User", id: user.id, title: user.name, href: userHref(user.id) }, payload: { roleId: user.roleId, branch: user.branch } });
    notify({ templateId: "admin.user-invited", toRoles: ["system-admin"], href: userHref(user.id), data: { name: user.name, email: user.email, role: roleName(user.roleId), branch: user.branch, by: actorName() } });
  },
});

export type UserRoleChangePayload = { userId: string; from: RoleId; to: RoleId; reason: string };
registerOperation<UserRoleChangePayload>({
  type: "user.role-change",
  name: "User role change",
  module: "admin",
  description: "Change a user's role (and so their module access and sign-on limit).",
  defaultSteps: confirm(),
  apply: ({ userId, from, to, reason }) => {
    const u = db().users.find((x) => x.id === userId);
    if (!u) return;
    db().update("users", userId, { roleId: to });
    log("Changed user role (approved)", "User", userId, roleName(from), roleName(to));
    publish("admin.user.role-changed", { module: "admin", subject: { type: "User", id: userId, title: u.name, href: userHref(userId) }, payload: { from, to } });
    notify({ templateId: "admin.user-role-changed", toUserIds: [userId], toRoles: ["system-admin"], href: "/settings", data: { name: u.name, before: roleName(from), after: roleName(to), reason } });
  },
});

export type UserStatusPayload = { userId: string; reason: string };
registerOperation<UserStatusPayload>({
  type: "user.deactivate",
  name: "User deactivation",
  module: "admin",
  description: "Revoke a user's access. Their history and audit trail are kept.",
  defaultSteps: confirm(),
  apply: ({ userId, reason }) => {
    const u = db().users.find((x) => x.id === userId);
    if (!u) return;
    // Notify first: notifications reach active users only.
    notify({ templateId: "admin.user-deactivated", toUserIds: [userId], toRoles: ["system-admin"], href: userHref(userId), data: { name: u.name, email: u.email, reason } });
    db().update("users", userId, { status: "Suspended" });
    log("Deactivated user (approved)", "User", userId, u.status, "Suspended");
    publish("admin.user.deactivated", { module: "admin", subject: { type: "User", id: userId, title: u.name, href: userHref(userId) }, payload: { reason } });
  },
});

registerOperation<UserStatusPayload>({
  type: "user.reactivate",
  name: "User reactivation",
  module: "admin",
  description: "Restore a deactivated user's access (MFA still required).",
  defaultSteps: confirm(),
  apply: ({ userId, reason }) => {
    const u = db().users.find((x) => x.id === userId);
    if (!u) return;
    db().update("users", userId, { status: "Active" });
    log("Reactivated user (approved)", "User", userId, u.status, "Active");
    publish("admin.user.reactivated", { module: "admin", subject: { type: "User", id: userId, title: u.name, href: userHref(userId) }, payload: { reason } });
    notify({ templateId: "admin.user-reactivated", toUserIds: [userId], toRoles: ["system-admin"], href: "/settings", data: { name: u.name, email: u.email, reason } });
  },
});

export type CustomRolePayload = { action: "create" | "update" | "delete"; role: CustomRole; reason: string };
registerOperation<CustomRolePayload>({
  type: "role.custom-change",
  name: "Custom role change",
  module: "admin",
  description: "Create (clone), change or delete a tenant-defined role (PRD §4: clone and adjust).",
  defaultSteps: confirm(48),
  apply: ({ action, role, reason }) => {
    if (action === "create") addCustomRole(role);
    else if (action === "update") updateCustomRole(role);
    else removeCustomRole(role.id);
    log(`Custom role ${action}d (approved)`, "Role", role.id, undefined, `${role.name} · cloned from ${roleName(role.clonedFrom)}`);
    publish(`admin.role.${action === "create" ? "cloned" : action === "update" ? "updated" : "deleted"}`, { module: "admin", subject: { type: "Role", id: role.id, title: role.name, href: "/admin/roles" }, payload: { clonedFrom: role.clonedFrom } });
    notify({ templateId: "admin.role-catalogue-changed", toRoles: ["system-admin", "head-of-risk"], href: "/admin/roles", data: { role: role.name, change: action === "create" ? "created" : action === "update" ? "updated" : "deleted", reason } });
  },
});

/** Body of `POST /identity/roles/{id}/permission-changes` (+ role name for display). */
export type RolePermissionChangePayload = { roleId: string; roleName: string; grant: PermissionKey[]; revoke: PermissionKey[]; reason: string };
registerOperation<RolePermissionChangePayload>({
  type: "role.permissions-change",
  name: "Role permission change",
  module: "admin",
  description: "Grant or revoke catalogue permissions of a role (invariant 12). Same approvers as custom role changes; the requester can't approve.",
  defaultSteps: confirm(48),
  apply: ({ roleId, roleName: name, grant, revoke, reason }) => {
    const custom = useAdminStore.getState().customRoles.find((c) => c.id === roleId);
    // A cloned role defaults to its source role's areas (TD-805).
    const modules = staticRoleById[(custom?.clonedFrom ?? roleId) as RoleId]?.modules;
    applyRolePermissionChange(roleId, grant, revoke, modules);
    const label = (k: PermissionKey) => permissionFor(k)?.label ?? k;
    log("Changed role permissions (approved)", "Role", roleId, revoke.length ? `Revoked: ${revoke.join(", ")}` : undefined, grant.length ? `Granted: ${grant.join(", ")}` : undefined);
    publish("identity.role.permissions-changed", { module: "admin", subject: { type: "Role", id: roleId, title: name, href: `/admin/permissions?role=${encodeURIComponent(roleId)}` }, payload: { grant, revoke } });
    const holders = db().users.filter((u) => u.roleId === roleId && u.status === "Active").map((u) => u.id);
    notify({
      templateId: "admin.role-permissions-changed",
      toRoles: ["system-admin", "head-of-risk"],
      toUserIds: holders,
      href: "/admin/permissions",
      data: { role: name, granted: grant.map(label).join("; ") || "none", revoked: revoke.map(label).join("; ") || "none", count: grant.length + revoke.length, reason },
    });
  },
});

export type UserMfaResetPayload = { userId: string; reason: string };
registerOperation<UserMfaResetPayload>({
  type: "user.mfa-reset",
  name: "MFA reset",
  module: "admin",
  description: "Reset a user's MFA enrolment so they enrol again at the next sign-in (demo mode; the backend endpoint is BE-31 / TD-036).",
  defaultSteps: confirm(),
  apply: ({ userId, reason }, { actor }) => {
    const u = db().users.find((x) => x.id === userId);
    if (!u) return;
    db().update("users", userId, { mfa: false });
    log("Reset MFA enrolment (approved)", "User", userId, "Enrolled", "Re-enrolment required");
    publish("admin.user.mfa-reset", { module: "admin", subject: { type: "User", id: userId, title: u.name, href: userHref(userId) }, payload: { reason } });
    notify({ templateId: "admin.user-mfa-reset", toUserIds: [userId], href: "/settings", data: { name: u.name, by: actor.name } });
  },
});

export type SectorLimitPayload = { changes: { id: string; name: string; before: number; after: number }[]; reason: string };
registerOperation<SectorLimitPayload>({
  type: "admin.sector-limits.change",
  name: "Sector limit change",
  module: "admin",
  description: "Change sectoral concentration limits (% of loan book, PRD §6.6.1).",
  defaultSteps: [step("review", "Risk review", ["head-of-risk", "cro"], 48)],
  apply: ({ changes, reason }) => {
    for (const c of changes) {
      db().update("sectors", c.id, { limitPct: c.after });
      log("Changed sector limit (approved)", "Sector", c.id, `${c.before}%`, `${c.after}%`);
    }
    publish("admin.sector-limits.changed", { module: "admin", subject: { type: "SectorLimits", id: "sectors", title: "Sector limits", href: "/admin/parameters?tab=sectors" }, payload: { changes } });
    notify({
      templateId: "admin.sector-limits-changed",
      toRoles: ["cro", "head-of-risk", "portfolio-mis-officer"],
      href: "/portfolio/limits",
      data: { count: changes.length, changes: changes.map((c) => `${c.name}: ${c.before}% → ${c.after}%`).join("; "), reason },
    });
  },
});

// ---------------------------------------------------------------- notification templates
const tpl = (t: NotificationTemplate) => t;
defineTemplates([
  tpl({
    id: "admin.user-invited",
    name: "User invited",
    module: "admin",
    trigger: "admin.user.invited",
    subject: "New user: {{name}} ({{role}})",
    inApp: "{{name}} was invited as {{role}} at {{branch}}.",
    body: "<p><strong>{{name}}</strong> ({{email}}) was invited as <strong>{{role}}</strong> at {{branch}}.</p><ul><li>Invitation requested by: {{by}}</li><li>Sign-in: Microsoft work account with MFA on first sign-in</li></ul>",
    tone: "info",
    variables: [
      { name: "name", description: "Invited user", example: "Ada Obi" },
      { name: "email", description: "Work email", example: "ada.obi@harbourline.example" },
      { name: "role", description: "Role", example: "Credit Analyst" },
      { name: "branch", description: "Branch", example: "Ikeja" },
      { name: "by", description: "Who approved the invitation", example: "Chinedu Okafor" },
    ],
  }),
  tpl({
    id: "admin.user-role-changed",
    name: "User role changed",
    module: "admin",
    trigger: "admin.user.role-changed",
    subject: "Role changed for {{name}}",
    inApp: "{{name}}'s role changed from {{before}} to {{after}}. It applies at the next sign-in.",
    body: "<p>The role for <strong>{{name}}</strong> changed from {{before}} to <strong>{{after}}</strong>.</p><p>Reason: {{reason}}</p><p>The new access applies at the next sign-in.</p>",
    tone: "info",
    variables: [
      { name: "name", description: "User", example: "Ada Obi" },
      { name: "before", description: "Previous role", example: "Account Officer" },
      { name: "after", description: "New role", example: "Credit Analyst" },
      { name: "reason", description: "Reason given", example: "Transfer to Credit Risk" },
    ],
  }),
  tpl({
    id: "admin.user-deactivated",
    name: "User deactivated",
    module: "admin",
    trigger: "admin.user.deactivated",
    subject: "Access removed: {{name}}",
    inApp: "Access for {{name}} was removed.",
    body: "<p>Access for <strong>{{name}}</strong> ({{email}}) was removed. History and the audit trail are kept.</p><p>Reason: {{reason}}</p><p>If you think this is wrong, contact your System Admin.</p>",
    tone: "warning",
    variables: [
      { name: "name", description: "User", example: "Ada Obi" },
      { name: "email", description: "Work email", example: "ada.obi@harbourline.example" },
      { name: "reason", description: "Reason given", example: "Left the bank" },
    ],
  }),
  tpl({
    id: "admin.user-reactivated",
    name: "User reactivated",
    module: "admin",
    trigger: "admin.user.reactivated",
    subject: "Access restored: {{name}}",
    inApp: "Access for {{name}} was restored.",
    body: "<p>Access for <strong>{{name}}</strong> ({{email}}) was restored. Sign in with your Microsoft work account and MFA.</p><p>Reason: {{reason}}</p>",
    tone: "success",
    variables: [
      { name: "name", description: "User", example: "Ada Obi" },
      { name: "email", description: "Work email", example: "ada.obi@harbourline.example" },
      { name: "reason", description: "Reason given", example: "Returned from leave" },
    ],
  }),
  tpl({
    id: "admin.user-mfa-reset",
    name: "MFA reset",
    module: "admin",
    trigger: "admin.user.mfa-reset",
    subject: "Your MFA was reset",
    inApp: "MFA for {{name}} was reset by {{by}}. Re-enrol at the next sign-in.",
    body: "<p>The multi-factor authentication for <strong>{{name}}</strong> was reset by {{by}}.</p><p>You'll be asked to enrol again at your next sign-in. If you didn't ask for this, contact your System Admin now.</p>",
    tone: "warning",
    variables: [
      { name: "name", description: "User", example: "Ada Obi" },
      { name: "by", description: "Who reset it", example: "Chinedu Okafor" },
    ],
  }),
  tpl({
    id: "admin.role-catalogue-changed",
    name: "Custom role changed",
    module: "admin",
    trigger: "admin.role.cloned / updated / deleted",
    subject: "Role {{change}}: {{role}}",
    inApp: "Custom role {{role}} was {{change}}.",
    body: "<p>The custom role <strong>{{role}}</strong> was {{change}}.</p><p>Reason: {{reason}}</p>",
    tone: "info",
    variables: [
      { name: "role", description: "Role name", example: "Credit Analyst (SME)" },
      { name: "change", description: "created / updated / deleted", example: "created" },
      { name: "reason", description: "Reason given", example: "Separate SME desk" },
    ],
  }),
  tpl({
    id: "admin.role-permissions-changed",
    name: "Role permissions changed",
    module: "admin",
    trigger: "identity.role.permissions-changed",
    subject: "Permissions changed for {{role}}",
    inApp: "{{count}} permission change(s) for {{role}} were approved.",
    body: "<p>The permissions of the role <strong>{{role}}</strong> changed after second-person approval.</p><ul><li>Granted: {{granted}}</li><li>Revoked: {{revoked}}</li></ul><p>Reason: {{reason}}</p><p>The new permissions apply at the next sign-in (or page refresh).</p>",
    tone: "info",
    variables: [
      { name: "role", description: "Role name", example: "Credit Analyst" },
      { name: "granted", description: "Permissions granted", example: "Export portfolio data" },
      { name: "revoked", description: "Permissions revoked", example: "none" },
      { name: "count", description: "Number of changes", example: "1" },
      { name: "reason", description: "Reason given", example: "Analysts prepare the monthly MIS pack" },
    ],
  }),
  tpl({
    id: "admin.sector-limits-changed",
    name: "Sector limits changed",
    module: "admin",
    trigger: "admin.sector-limits.changed",
    subject: "{{count}} sector limit(s) changed",
    inApp: "Sector limits changed: {{changes}}.",
    body: "<p>The following sectoral concentration limits changed:</p><p><strong>{{changes}}</strong></p><p>Reason: {{reason}}</p><p>Portfolio limit monitoring uses the new values immediately.</p>",
    tone: "info",
    variables: [
      { name: "count", description: "Number of sectors changed", example: "2" },
      { name: "changes", description: "Sector: before → after", example: "Oil & gas: 15% → 12%; Agriculture: 8% → 10%" },
      { name: "reason", description: "Reason given", example: "Board risk appetite review" },
    ],
  }),
]);

// ---------------------------------------------------------------- events & hooks
defineEvents([
  { name: "admin.user.invited", module: "admin", description: "A user invitation was approved and the user created.", payloadExample: { roleId: "credit-analyst", branch: "Ikeja" } },
  { name: "admin.user.role-changed", module: "admin", description: "A user's role changed (after approval).", payloadExample: { from: "account-officer", to: "credit-analyst" } },
  { name: "admin.user.deactivated", module: "admin", description: "A user was deactivated (after approval)." },
  { name: "admin.user.reactivated", module: "admin", description: "A user was reactivated (after approval)." },
  { name: "admin.user.mfa-reset", module: "admin", description: "A user's MFA enrolment was reset." },
  { name: "admin.role.cloned", module: "admin", description: "A custom role was created by cloning (after approval)." },
  { name: "admin.role.updated", module: "admin", description: "A custom role was changed (after approval)." },
  { name: "admin.role.deleted", module: "admin", description: "A custom role was deleted (after approval)." },
  { name: "admin.sector-limits.changed", module: "admin", description: "Sector concentration limits changed (after approval)." },
  { name: "identity.role.permissions-changed", module: "admin", description: "A role's permissions changed (after approval).", payloadExample: { grant: ["portfolio.data.export"], revoke: [] } },
  { name: "admin.users.exported", module: "admin", description: "The user list was exported (CSV).", payloadExample: { rows: 42 } },
  { name: "admin.roles.exported", module: "admin", description: "Roles and limits were exported (CSV).", payloadExample: { rows: 25 } },
]);

defineHookPoints([
  { point: "admin.user.change.before", module: "admin", kind: "before", description: "Before a user invite / role change / deactivation / reactivation / lock / unlock / MFA reset is submitted. Veto to block; enrich the payload." },
  { point: "admin.user.change.after", module: "admin", kind: "after", description: "After a user change was submitted (or applied)." },
  { point: "admin.config.change.before", module: "admin", kind: "before", description: "Before a rule, role or sector-limit change is submitted from Admin. Veto to block." },
  { point: "admin.config.change.after", module: "admin", kind: "after", description: "After a configuration change was submitted to Operations." },
  { point: "identity.role.permissions-change.before", module: "admin", kind: "before", description: "Before a role permission change is submitted. Veto to block; enrich grant / revoke." },
  { point: "identity.role.permissions-change.after", module: "admin", kind: "after", description: "After a role permission change was submitted to Operations." },
]);
