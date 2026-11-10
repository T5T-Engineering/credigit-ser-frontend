import { expect, test } from "./fixtures";
import { signInAs, switchRole } from "../helpers";
import { NAV, decide, latestOperationId } from "./auth-helpers";

test("workflow change: add a step → Head of Risk approves → new version shown", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, "system-admin", "/operations/workflows/");
  const card = page.locator("section, article, div").filter({ has: page.getByRole("heading", { name: "Sector limit change", exact: true }) }).filter({ has: page.getByRole("button", { name: "Edit" }) }).last();
  await expect(card).toContainText(/v1/, NAV);
  await card.getByRole("button", { name: "Edit" }).click();

  const modal = page.getByRole("dialog", { name: /edit workflow — sector limit change/i });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /add step/i }).click();
  await modal.getByLabel(/step name/i).last().fill("CRO sign-off");
  await modal.getByRole("group", { name: /approver roles: cro sign-off/i }).getByRole("button", { name: /chief risk officer/i }).click();
  await modal.getByLabel(/reason for change/i).fill("Board asked for a CRO sign-off on sector limits.");
  await modal.getByRole("button", { name: /submit for approval/i }).click();
  await expect(page.getByText(/change submitted for approval/i).first()).toBeVisible();
  await expect(card.getByText(/change awaiting approval/i).or(card.getByRole("button", { name: "Edit" }).and(page.locator("[disabled]"))).first()).toBeVisible();

  const id = await latestOperationId(page, "workflow.change");
  await switchRole(page, "head-of-risk", "/operations/");
  await decide(page, id, "Approve");

  await page.goto("/operations/workflows/");
  const after = page.locator("section, article, div").filter({ has: page.getByRole("heading", { name: "Sector limit change", exact: true }) }).filter({ has: page.getByRole("button", { name: "Edit" }) }).last();
  await expect(after).toContainText(/v2/, NAV);
  await expect(after).toContainText(/2 step\(s\)/);
  await expect(page.getByRole("list", { name: /sector limit change workflow/i })).toContainText(/cro sign-off/i);
});

test("notification template: send test to me, then change wording via approval", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, "system-admin", "/operations/notifications/");
  await page.getByRole("searchbox", { name: /search notification templates/i }).fill("Business rule changed");
  await page.getByRole("row").filter({ hasText: "rules.changed" }).first().click();
  const drawer = page.getByRole("dialog", { name: /business rule changed/i });
  await expect(drawer).toBeVisible();
  await expect(drawer.frameLocator("iframe").first().getByText(/changed from/i)).toBeVisible();

  await drawer.getByRole("button", { name: /send test to me/i }).click();
  await expect(page.getByText(/test sent to you/i).first()).toBeVisible();

  // Change wording → submit for approval.
  await drawer.getByLabel(/^subject/i).fill("Business rule updated: {{label}}");
  await expect(drawer.frameLocator("iframe").first().getByRole("heading", { name: /business rule updated:/i })).toBeVisible();
  await drawer.getByLabel(/reason for change/i).fill("Clearer subject line for approvers.");
  await drawer.getByRole("button", { name: /submit for approval/i }).click();
  await expect(page.getByText(/change submitted for approval/i).first()).toBeVisible();
  await expect(drawer.getByText(/change awaiting approval/i)).toBeVisible();

  // Test email landed in the outbox for me.
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /outbox/i }).click();
  await expect(page.getByRole("row").or(page.getByRole("listitem")).filter({ hasText: /rule updated: step-up authentication threshold/i }).first()).toBeVisible();

  const id = await latestOperationId(page, "template.change");
  await switchRole(page, "head-of-risk", "/operations/");
  await decide(page, id, "Approve");

  const overrides = await page.evaluate(() => JSON.parse(localStorage.getItem("credigit.ser.notifications") ?? "{}").state?.overrides ?? {});
  expect(overrides["rules.changed"]?.subject).toBe("Business rule updated: {{label}}");
  await page.goto("/operations/notifications/");
  await page.getByRole("searchbox", { name: /search notification templates/i }).fill("Business rule changed");
  await expect(page.getByRole("row").filter({ hasText: "rules.changed" }).first()).not.toContainText("Default");
});

test("events & hooks: disabling an extension goes through approval", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, "cro", "/operations/events/");
  await page.getByRole("tab", { name: /subscriptions/i }).click();
  const sw = page.getByRole("switch", { name: /enable example · audit mirror/i });
  await expect(sw).toBeChecked();
  await sw.click();
  const modal = page.getByRole("dialog", { name: /disable example · audit mirror/i });
  await expect(modal).toBeVisible();
  await modal.getByLabel(/reason/i).fill("Pausing the mirror during the audit export.");
  await modal.getByRole("button", { name: /submit for approval/i }).click();
  await expect(page.getByText(/change submitted for approval/i).first()).toBeVisible();
  // Still enabled until approved.
  await expect(sw).toBeChecked();
  await expect(page.getByRole("link", { name: /awaiting approval/i }).first()).toBeVisible();

  const id = await latestOperationId(page, "extension.toggle");
  await switchRole(page, "system-admin", "/operations/");
  await decide(page, id, "Approve");

  await page.goto("/operations/events/");
  await page.getByRole("tab", { name: /subscriptions/i }).click();
  await expect(page.getByRole("switch", { name: /enable example · audit mirror/i })).not.toBeChecked(NAV);
  await page.getByRole("tab", { name: /event log/i }).click();
  await expect(page.getByText("operations.extension.toggled").first()).toBeVisible();
});
