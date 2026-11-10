import { expect, test } from "./fixtures";
import { switchRole } from "../helpers";
import { NAV, decide, enterDemoCode, gotoHydrated, latestOperationId, passwordSignIn } from "./auth-helpers";

test("request access → verify email → System Admin approves in Operations → sign in with the approved role @mobile", async ({ page }) => {
  test.setTimeout(180_000);
  const email = `ada.nwosu.${Date.now()}@harbourline.example`;
  const password = "Ada-Nwosu#2026x";

  await gotoHydrated(page, "/login/");
  await page.getByRole("link", { name: /request access/i }).click();
  await expect(page).toHaveURL(/\/register\//, NAV);
  await expect(page.getByRole("heading", { name: /request access/i })).toBeVisible();

  await page.getByLabel(/full name/i).fill("Ada Nwosu");
  await page.getByLabel(/work email/i).fill(email);
  await page.getByLabel(/institution/i).fill("Harbourline Bank");
  await page.getByLabel(/branch or office/i).selectOption({ index: 1 });
  await page.getByLabel(/role you need/i).selectOption("credit-analyst");

  // Password strength rules are listed and tick off as the password improves.
  await page.getByLabel(/^password/i).first().fill("short");
  await expect(page.getByText(/at least \d+ characters/i)).toBeVisible();
  await expect(page.getByText(/an uppercase letter/i)).toBeVisible();
  await expect(page.getByText(/a symbol/i)).toBeVisible();
  await page.getByLabel(/^confirm password/i).fill("short");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByText(/doesn't meet all the requirements/i)).toBeVisible();

  await page.getByLabel(/^password/i).first().fill(password);
  await page.getByLabel(/^confirm password/i).fill(password);
  await page.getByRole("button", { name: /^continue$/i }).click();

  await expect(page).toHaveURL(/\/verify\//, NAV);
  await expect(page.getByRole("heading", { name: /verify your email/i })).toBeVisible();
  await enterDemoCode(page);
  await expect(page.getByRole("heading", { name: /request sent for approval/i })).toBeVisible(NAV);

  // Can't sign in yet.
  await gotoHydrated(page, "/login/");
  await page.getByLabel(/work email/i).fill(email);
  await page.getByLabel(/^password/i).first().fill(password);
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByText(/waiting for approval/i)).toBeVisible();

  // System Admin approves the access request in Operations.
  await switchRole(page, "system-admin", "/operations/");
  await expect(page.getByText(/access request — ada nwosu/i).first()).toBeVisible(NAV);
  const id = await latestOperationId(page, "access.request");
  await decide(page, id, "Approve");
  await expect(page.getByText(/approved/i).first()).toBeVisible();

  // Sign out, then sign in as the new user with password + code.
  await page.evaluate(() => sessionStorage.removeItem("credigit.ser.session"));
  await passwordSignIn(page, email, password);
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem("credigit.ser.session") ?? "{}").state);
  expect(session.roleId).toBe("credit-analyst");
  expect(session.user).toMatchObject({ name: "Ada Nwosu", email, source: "password" });
  await page.goto("/settings/");
  await expect(page.getByText("Ada Nwosu").first()).toBeVisible(NAV);
  await expect(page.getByText(/credit analyst/i).first()).toBeVisible();
});
