"use client";

/**
 * Notifications (invariant 9: notified). Templates hold a subject and an HTML body with {{variables}};
 * `notify()` creates the in-app notification for the target roles/users and renders a branded HTML email
 * into the outbox (Operations → Notifications). The prototype doesn't send email: outbox items are
 * "Queued (demo — not sent)".
 *
 * Templates are registered by modules; tenant edits are stored as overrides (approved through Operations).
 * BACKEND SEAM: `notify` posts to the notification service (email/SMS/in-app).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultBrand } from "@credigit/web-ui";
import type { RoleId } from "../rbac/roles";
import { useDb, newId } from "../data/store";
import { publish } from "./events";
import { currentActor } from "./scope";
import { dataStorage, registerDatabaseStore } from "@/lib/data/workspace-storage";

export type TemplateVariable = { name: string; description: string; example: string };

export type NotificationTemplate = {
  id: string;
  name: string;
  module: string;
  /** Event that usually triggers it (documentation). */
  trigger: string;
  subject: string;
  /** HTML fragment for the email body. Variables: {{name}} (escaped). Keep markup simple (p, strong, ul/li). */
  body: string;
  /** Short in-app text (plain). */
  inApp: string;
  tone: "info" | "success" | "warning" | "danger";
  variables: TemplateVariable[];
};

export type OutboxItem = {
  id: string;
  templateId: string;
  to: string;
  subject: string;
  html: string;
  createdAt: string;
  status: "Queued (demo — not sent)" | "Sent" | "Failed";
};

type NotificationState = {
  overrides: Record<string, Pick<NotificationTemplate, "subject" | "body" | "inApp">>;
  outbox: OutboxItem[];
};

/** Bounded outbox kept in the browser (demo). */
const OUTBOX_LIMIT = 300;

export const useNotificationStore = create<NotificationState>()(
  persist((): NotificationState => ({ overrides: {}, outbox: [] }), { name: "credigit.ser.notifications", storage: dataStorage() }),
);

const templates = new Map<string, NotificationTemplate>();

export function defineTemplates(list: NotificationTemplate[]) {
  for (const t of list) templates.set(t.id, t);
}

/** Template with tenant overrides applied. */
export function getTemplate(id: string): NotificationTemplate | undefined {
  const base = templates.get(id);
  if (!base) return undefined;
  return { ...base, ...useNotificationStore.getState().overrides[id] };
}

export function baseTemplate(id: string): NotificationTemplate | undefined {
  return templates.get(id);
}

export function templateList(): NotificationTemplate[] {
  return [...templates.keys()].map((id) => getTemplate(id)!).sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Replace {{variables}}; values are HTML-escaped unless `escape` is false (plain-text contexts). */
export function fill(text: string, data: Record<string, unknown>, escape = true): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) => {
    const v = data[name];
    const s = v === undefined || v === null ? "" : String(v);
    return escape ? escapeHtml(s) : s;
  });
}

/** Live brand value (hex written by BrandProvider), falling back to the library brand defaults. */
function brandHex(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (rgb: number[]) => `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
/** Mix with white: `amount` of the colour is kept (email clients don't support color-mix()). */
const tint = (hex: string, amount: number) => toHex(channels(hex).map((n) => n * amount + 255 * (1 - amount)));
/** Mix with black: `amount` of the colour is kept. */
const shade = (hex: string, amount: number) => toHex(channels(hex).map((n) => n * amount));

/** Wrap a body in the branded, email-safe HTML layout (tables + inline styles, no scripts). */
export function renderEmail(template: NotificationTemplate, data: Record<string, unknown>): { subject: string; html: string } {
  const tenant = useDb.getState().tenant;
  const ink = brandHex("--cg-brand-primary", defaultBrand.colors.primary);
  const neutral = brandHex("--cg-brand-neutral", defaultBrand.colors.neutral);
  const accent = shade(brandHex("--cg-brand-accent", defaultBrand.colors.accent), 0.84); // matches --cg-accent-600 (AA on white)
  const paper = tint(neutral, 0);
  const canvas = tint(neutral, 0.06);
  const line = tint(neutral, 0.2);
  const fontVar = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--cg-font-family").trim();
  const font = (fontVar || defaultBrand.font.family).replace(/"/g, "'");
  const subject = fill(template.subject, data, false);
  const body = fill(template.body, data);
  const link = typeof data.link === "string" && data.link ? escapeHtml(data.link) : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${canvas};font-family:${font},Arial,sans-serif;color:${ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${canvas};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${paper};border-radius:24px;overflow:hidden">
<tr><td style="padding:24px 32px;background:${ink};color:${paper};font-size:18px;font-weight:700">${escapeHtml(tenant.shortName)} · Smart Enterprise Risk 360°</td></tr>
<tr><td style="padding:32px;font-size:16px;line-height:1.55;color:${ink}">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25">${escapeHtml(subject)}</h1>
${body}
${link ? `<p style="margin:28px 0 0"><a href="${link}" style="display:inline-block;background:${accent};color:${paper};text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Open in Smart Enterprise Risk 360°</a></p>` : ""}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid ${line};font-size:12px;line-height:1.5;color:${neutral}">You received this because of your role at ${escapeHtml(tenant.name)}. This message was generated automatically and recorded in the audit log. Don't reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

export type NotifyInput = {
  templateId: string;
  data: Record<string, unknown>;
  toRoles?: RoleId[];
  toUserIds?: string[];
  href?: string;
};

/** Send a notification: in-app (by role) + rendered HTML email per recipient into the outbox. */
export function notify(input: NotifyInput) {
  const template = getTemplate(input.templateId);
  if (!template) throw new Error(`Unknown notification template "${input.templateId}".`);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const data: Record<string, unknown> = { ...input.data, link: input.href ? `${origin}${input.href}` : input.data.link };
  const db = useDb.getState();
  const roleIds = input.toRoles ?? [];
  const recipients = db.users.filter((u) => u.status === "Active" && (roleIds.includes(u.roleId) || input.toUserIds?.includes(u.id)));
  const userRoleIds = recipients.filter((u) => input.toUserIds?.includes(u.id)).map((u) => u.roleId);
  db.upsert("notifications", {
    id: newId("NTF"),
    title: fill(template.subject, data, false),
    body: fill(template.inApp, data, false),
    tone: template.tone,
    createdAt: new Date().toISOString(),
    read: false,
    href: input.href,
    roleIds: [...new Set([...roleIds, ...userRoleIds])],
  });
  const { subject, html } = renderEmail(template, data);
  const items: OutboxItem[] = recipients.map((u) => ({ id: newId("OUT"), templateId: template.id, to: `${u.name} <${u.email}>`, subject, html, createdAt: new Date().toISOString(), status: "Queued (demo — not sent)" }));
  useNotificationStore.setState((s) => ({ outbox: [...items, ...s.outbox].slice(0, OUTBOX_LIMIT) }));
  const actor = currentActor();
  db.log({ actorId: actor.id, actorName: actor.name, roleId: actor.roleId, action: `Sent notification "${template.name}"`, entityType: "Notification", entityId: template.id, after: `${items.length} recipient(s)` });
  publish("platform.notification.sent", { module: "platform", subject: { type: "NotificationTemplate", id: template.id, title: template.name }, payload: { recipients: items.length } });
}

registerDatabaseStore(useNotificationStore);
