"use client";

import { useState } from "react";
import { ResultDialog, type ShowResultOptions } from "@credigit/web-ui";

/**
 * Shows a page's save / command outcome as a popup (library `ResultDialog`) instead of an inline alert at the top of the page,
 * where it is easily missed. `value` is the page's outcome state; each new value opens the popup once, OK closes it.
 */
export function OutcomePopup<T>({ value, map }: { value: T | null | undefined; map: (value: T) => ShowResultOptions | null }) {
  const [closed, setClosed] = useState<T | null>(null);
  if (value === null || value === undefined || closed === value) return null;
  const options = map(value);
  if (!options) return null;
  return <ResultDialog {...options} open onOpenChange={(open) => !open && setClosed(value)} />;
}

/** Popup copy for the common `{ tone, text }` / `{ ok, message | reason }` outcome shapes. */
export const outcomeCopy = {
  toneText:
    (titles: { success: string; danger: string; info?: string }) =>
    (v: { tone: "success" | "danger" | "info"; text: string; title?: string }): ShowResultOptions => ({
      tone: v.tone,
      title: v.title ?? (v.tone === "danger" ? titles.danger : v.tone === "info" ? (titles.info ?? titles.success) : titles.success),
      description: v.text,
    }),
  okMessage:
    (titles: { success: string; danger: string } = { success: "Done", danger: "Not done" }) =>
    (v: { ok: true; message?: string } | { ok: false; reason: string }): ShowResultOptions =>
      v.ok ? { tone: "success", title: titles.success, description: v.message } : { tone: "danger", title: titles.danger, description: v.reason },
  text: (title: string, tone: ShowResultOptions["tone"] = "success") => (v: string): ShowResultOptions => ({ tone, title, description: v }),
};
