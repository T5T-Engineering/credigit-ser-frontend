import { expect, test } from "./fixtures";
import { signInAs } from "../helpers";
import { DEMO_PASSWORD, NAV, fillCredentials, gotoHydrated, passwordSignIn } from "./auth-helpers";

test("change password in Settings → Password, then sign in with the new one", async ({ page }) => {
  test.setTimeout(150_000);
  await signInAs(page, "credit-analyst", "/settings/password/");
  const email = await page.evaluate(() => JSON.parse(sessionStorage.getItem("credigit.ser.session") ?? "{}").state.user.email as string);
  await expect(page.getByLabel(/current password/i)).toBeVisible(NAV);

  // Wrong current password is refused.
  const next = "Changed-Pass#2026y";
  await page.getByLabel(/current password/i).fill("Not-the-password1!");
  await page.getByLabel(/^new password/i).fill(next);
  await page.getByLabel(/confirm new password/i).fill(next);
  await page.getByRole("button", { name: /change password/i }).click();
  await expect(page.getByText(/current password is incorrect/i)).toBeVisible();

  await page.getByLabel(/current password/i).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /change password/i }).click();
  await expect(page.getByText(/password changed/i).first()).toBeVisible();

  // The user is notified (in-app + email in the outbox).
  const outbox = await page.evaluate(() => JSON.parse(localStorage.getItem("credigit.ser.notifications") ?? "{}").state?.outbox ?? []);
  expect(outbox.some((o: { templateId: string; to: string }) => o.templateId === "auth.password-changed" && o.to.includes(email))).toBe(true);

  // Sign out → old password fails, new password works.
  await page.evaluate(() => sessionStorage.removeItem("credigit.ser.session"));
  await gotoHydrated(page, "/login/");
  await fillCredentials(page, email, DEMO_PASSWORD);
  await expect(page.getByText(/email or password is incorrect/i)).toBeVisible();
  await passwordSignIn(page, email, next);
  const roleId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("credigit.ser.session") ?? "{}").state.roleId);
  expect(roleId).toBe("credit-analyst");
});
