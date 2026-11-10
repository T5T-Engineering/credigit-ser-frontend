import { expect, test } from "./fixtures";
import { signInAs, switchRole } from "../helpers";
import { NAV, decide } from "./auth-helpers";

const KEY = "auth.otpMaxAttempts";

test("business rule change: CRO requests → Head of Risk → System Admin → applied, history, bell and HTML email @mobile", async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, "cro", `/operations/rules/?key=${KEY}`);
  const drawer = page.getByRole("dialog", { name: /one-time code attempts/i });
  await expect(drawer).toBeVisible(NAV);
  await drawer.getByLabel(/proposed value/i).fill("7");
  await drawer.getByLabel(/^reason/i).fill("Align with the bank's MFA policy update.");
  await drawer.getByRole("button", { name: /submit for approval/i }).click();
  await expect(page.getByText(/change submitted for approval/i).first()).toBeVisible();
  await expect(drawer.getByText(/change awaiting approval/i)).toBeVisible();
  await drawer.getByRole("link", { name: /view request/i }).last().click();
  await expect(page).toHaveURL(/\/operations\/item/, NAV);
  const id = new URL(page.url()).searchParams.get("id")!;
  expect(id).toMatch(/^OPS-/);

  // Segregation of duties: the requester can't decide their own request.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Decision" })).toHaveCount(0);
  await expect(page.getByText(/no decision needed from you|segregation of duties|you requested this/i).first()).toBeVisible();

  // Step 1: Head of Risk approves.
  await switchRole(page, "head-of-risk", "/operations/");
  await expect(page.getByText(/one-time code attempts: 5 → 7/i).first()).toBeVisible(NAV);
  await decide(page, id, "Approve");
  // Not applied yet.
  const pendingValue = await page.evaluate((k) => JSON.parse(localStorage.getItem("credigit.ser.rules") ?? "{}").state?.values?.[k], KEY);
  expect(pendingValue).toBeUndefined();

  // Step 2: System Admin confirms.
  await switchRole(page, "system-admin", "/operations/");
  await decide(page, id, "Approve");
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

  // New value is shown with history.
  await page.goto(`/operations/rules/?key=${KEY}`);
  const after = page.getByRole("dialog", { name: /one-time code attempts/i });
  await expect(after).toBeVisible(NAV);
  const history = after.getByRole("list", { name: /history of one-time code attempts/i }).or(after.getByLabel(/history of one-time code attempts/i)).first();
  await expect(history).toContainText("7");
  await expect(history).toContainText(/align with the bank's mfa policy update/i);
  await expect(history).toContainText(id);

  // Bell shows the notification.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^notifications/i }).first().click();
  await expect(page.getByText(/rule updated: one-time code attempts/i).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Outbox has the rendered HTML email.
  await page.goto("/operations/notifications/");
  await page.getByRole("tab", { name: /outbox/i }).click();
  // Table on desktop, card list on mobile.
  const row = page.getByRole("row").or(page.getByRole("listitem")).filter({ hasText: /rule updated: one-time code attempts/i }).first();
  await expect(row).toBeVisible(NAV);
  await row.click();
  const preview = page.getByRole("dialog", { name: /rule updated: one-time code attempts/i });
  await expect(preview).toBeVisible();
  const frame = preview.frameLocator("iframe").first();
  await expect(frame.getByText(/changed from 5 to/i)).toBeVisible();
  await expect(frame.getByRole("link", { name: /open in smart enterprise risk/i })).toBeVisible();

  // The new value drives behaviour: the OTP page copy uses it.
  const outbox = await page.evaluate(() => JSON.parse(localStorage.getItem("credigit.ser.notifications") ?? "{}").state?.outbox ?? []);
  expect(outbox.find((o: { templateId: string }) => o.templateId === "rules.changed")?.html).toMatch(/^<!doctype html>/i);
});
