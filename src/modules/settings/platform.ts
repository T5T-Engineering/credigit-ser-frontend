"use client";

/**
 * Platform registrations for the settings module: business rules, operation types (Operations workflow),
 * notification templates, events and hook points. See docs/FRONTEND-CONVENTIONS.md → Platform services.
 */
import type { BrandConfig } from "@credigit/web-ui";
import { useDb } from "@/lib/data/store";
import { defineEvents, publish } from "@/lib/platform/events";
import { defineHookPoints } from "@/lib/platform/hooks";
import { defineTemplates, notify } from "@/lib/platform/notifications";
import { registerOperation } from "@/lib/platform/operations";
import { defineRules } from "@/lib/platform/rules";
import { setApprovedBrand } from "./brand-store";

defineRules([
  {
    key: "settings.brand.requesterRoles",
    label: "Who can request a tenant brand change",
    description: "Roles that may submit colours, logos and font for the tenant. Everyone else can only preview.",
    module: "settings",
    category: "Branding",
    type: "roles",
    default: ["system-admin"],
    source: "(System Admin configures the tenant)",
  },
  {
    key: "settings.brand.personalPreview",
    label: "Allow personal brand preview",
    description: "Let users try colours and fonts in their own browser without changing the tenant brand.",
    module: "settings",
    category: "Branding",
    type: "boolean",
    default: true,
    source: "Tenant parameter",
  },
]);

export type BrandChangePayload = { brand: BrandConfig; summary: string; reason: string };

registerOperation<BrandChangePayload>({
  type: "brand.change",
  finalApproverEligible: true,
  name: "Tenant brand change",
  module: "settings",
  description: "Change the tenant's colours, logos and font for every user. Requested by the System Admin, approved by one approver.",
  defaultSteps: [{ id: "approve", name: "Brand approval", approverRoles: ["system-admin", "md"], mode: "any", slaHours: 48 }],
  apply: ({ brand, summary }, { instance, actor }) => {
    const before = useDb.getState();
    setApprovedBrand(brand, { by: actor.name, operationId: instance.id });
    before.log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action: "Applied tenant brand (approved)", entityType: "Branding", entityId: "tenant", after: summary });
    publish("settings.brand.changed", { module: "settings", subject: { type: "Branding", id: "tenant", title: brand.name, href: "/settings/branding" }, payload: { summary, operationId: instance.id } });
    notify({ templateId: "settings.brand-changed", toRoles: ["system-admin"], href: "/settings/branding", data: { name: brand.name, summary, approvedBy: actor.name, requester: instance.requestedBy.name } });
  },
});

defineTemplates([
  {
    id: "settings.brand-changed",
    name: "Tenant brand changed",
    module: "settings",
    trigger: "settings.brand.changed",
    subject: "New tenant brand applied: {{name}}",
    inApp: "The tenant brand changed ({{summary}}), approved by {{approvedBy}}.",
    body: "<p>The tenant brand for every user is now <strong>{{name}}</strong>.</p><ul><li>Change: {{summary}}</li><li>Requested by: {{requester}}</li><li>Approved by: {{approvedBy}}</li></ul><p>Screens, charts, documents and emails use the new colours, logo and font from now on.</p>",
    tone: "info",
    variables: [
      { name: "name", description: "Brand name", example: "Harbourline Bank" },
      { name: "summary", description: "Colours / font / logo summary", example: "Navy, teal and slate · Inter · custom logo" },
      { name: "requester", description: "Who requested it", example: "Chinedu Okafor" },
      { name: "approvedBy", description: "Who approved it", example: "Ngozi Bello" },
    ],
  },
]);

defineEvents([
  { name: "settings.brand.changed", module: "settings", description: "The tenant brand (colours, logos, font) changed after approval.", payloadExample: { summary: "Inter · custom logo", operationId: "OPS-…" } },
]);

defineHookPoints([
  { point: "settings.brand.change.before", module: "settings", kind: "before", description: "Before a tenant brand change is submitted. Veto to block (e.g. contrast policy); enrich the payload." },
  { point: "settings.brand.change.after", module: "settings", kind: "after", description: "After a tenant brand change was submitted to Operations." },
]);
