import { expect, type Page } from "@playwright/test";
import { switchRole } from "../helpers";
import { decide } from "./ops";

/**
 * Local approve helper for the market / op-risk / ERM specs: same as ops.approveAs but tolerant of the
 * dev server's first-compile time for /operations/item (client navigation can take >10 s under load).
 */
export async function approveInOps(page: Page, roleId: string, title: string | RegExp, comment?: string) {
  await switchRole(page, roleId, "/operations/");
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible({ timeout: 30_000 });
  const card = page.locator("article").filter({ hasText: title }).first();
  const target = (await card.count()) ? card : page.locator("div").filter({ hasText: title }).filter({ has: page.getByRole("link", { name: /review & decide/i }) }).last();
  await expect(target.getByRole("link", { name: /review & decide/i })).toBeVisible();
  await target.getByRole("link", { name: /review & decide/i }).click();
  await expect(page).toHaveURL(/\/operations\/item/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: title }).first()).toBeVisible({ timeout: 30_000 });
  await decide(page, "Approve", comment);
}
