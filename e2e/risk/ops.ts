import { expect, type Page } from "@playwright/test";
import { switchRole } from "../helpers";

/**
 * Shared helpers for the risk-module specs.
 * Decisions go through Operations (invariant 9): the approver signs in, opens their queue,
 * reviews the request and records a decision in the DecisionPanel.
 */

/** Collect uncaught page errors and console errors; call `assertClean()` at the end of a test. */
export function watchErrors(page: Page, ignore: RegExp[] = []) {
  const errors: string[] = [];
  const ignored = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /\[HMR\]/i, ...ignore];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (ignored.some((r) => r.test(t))) return;
    errors.push(`console.error: ${t}`);
  });
  return {
    errors,
    assertClean: () => expect(errors, errors.join("\n")).toEqual([]),
  };
}

/** Open the role's Operations queue and the request whose title matches. */
export async function openApproval(page: Page, roleId: string, title: string | RegExp) {
  await switchRole(page, roleId, "/operations/");
  const card = page.locator("article, li, div").filter({ hasText: title }).filter({ has: page.getByRole("link", { name: /review & decide/i }) }).last();
  await expect(card).toBeVisible();
  await card.getByRole("link", { name: /review & decide/i }).click();
  // First compile of /operations/item on a cold dev server can exceed the default expect timeout.
  await expect(page).toHaveURL(/\/operations\/item/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: title }).first()).toBeVisible({ timeout: 30_000 });
}

/** Record a decision on the open operation detail page (handles step-up with any 6-digit code). */
export async function decide(page: Page, decision: "Approve" | "Reject" | "Return to requester" = "Approve", comment = "Reviewed in end-to-end test — evidence checked and in order.") {
  const panel = page.locator("form").filter({ has: page.getByRole("radiogroup", { name: "Decision" }) });
  await expect(panel).toBeVisible();
  await panel.getByRole("radio", { name: decision }).check({ force: true });
  await panel.getByPlaceholder(/state the basis/i).fill(comment);
  await panel.getByRole("button", { name: /^submit/i }).click();
  const stepUp = page.getByRole("dialog").filter({ hasText: /verification code|re-auth|step-up/i });
  // Step-up appears only above the tenant threshold.
  const outcome = await Promise.race([
    stepUp.waitFor({ state: "visible", timeout: 5_000 }).then(() => "stepup" as const).catch(() => "none" as const),
    page.getByText(/decision recorded/i).first().waitFor({ state: "visible", timeout: 5_000 }).then(() => "done" as const).catch(() => "none" as const),
  ]);
  if (outcome === "stepup") {
    await stepUp.getByRole("textbox").first().click();
    await page.keyboard.type("123456");
    const verify = stepUp.getByRole("button", { name: /verify/i });
    if (await verify.isEnabled().catch(() => false)) await verify.click().catch(() => undefined);
  }
  await expect(page.getByText(/decision recorded/i).first()).toBeVisible();
}

/** Approve the request (by title) as the given role, through Operations. */
export async function approveAs(page: Page, roleId: string, title: string | RegExp, comment?: string) {
  await openApproval(page, roleId, title);
  await decide(page, "Approve", comment);
}

/** Final status shown on the operation page after deciding. */
export async function expectOperationStatus(page: Page, status: RegExp) {
  await expect(page.getByText(status).first()).toBeVisible();
}
