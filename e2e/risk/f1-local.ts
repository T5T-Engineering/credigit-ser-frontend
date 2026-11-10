import { expect, type Page } from "@playwright/test";
import { switchRole } from "../helpers";
import { decide } from "./ops";

/**
 * Local approval helper for the credit-analysis / monitoring specs: opens the request from the role's
 * Operations queue by its title link (more robust than clicking "Review & decide" while the queue hydrates),
 * then records the decision with the shared `decide()`.
 */
export async function approveInOps(page: Page, roleId: string, title: string, decision: "Approve" | "Reject" | "Return to requester" = "Approve") {
  await switchRole(page, roleId, "/operations/");
  const link = page.getByRole("link", { name: title, exact: false }).first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  await page.goto(href);
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: title }).first()).toBeVisible({ timeout: 30_000 });
  await decide(page, decision);
}
