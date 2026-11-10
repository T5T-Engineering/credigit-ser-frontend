import { expect, test } from "./fixtures";
import { signInAs } from "../helpers";
import { NAV } from "./auth-helpers";

test("idle session: warning dialog, stay signed in, then automatic sign-out", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  await signInAs(page, "credit-analyst");
  const dialog = page.getByRole("dialog", { name: /are you still there/i });
  await expect(dialog).toHaveCount(0);

  // Idle limit (per-role business rule, ≤ 15 min by default) minus the warning window.
  await page.clock.fastForward("16:00");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /stay signed in/i }).last().click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard/);

  // Idle again and let the warning run out.
  await page.clock.fastForward("16:00");
  await expect(dialog).toBeVisible();
  await page.clock.runFor(70_000);
  await expect(page).toHaveURL(/\/login\//, NAV);
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem("credigit.ser.session") ?? "{}").state?.user ?? null);
  expect(session).toBeNull();
});

test("signing out from a ?demoRole link stays signed out", async ({ page }) => {
  await signInAs(page, "cro");
  await expect(page).not.toHaveURL(/demoRole=/);
  await page.getByRole("button", { name: /^account menu/i }).click();
  // With 25 demo roles the menu runs past the viewport and has no scroll (library Menu, reported) — use the keyboard.
  await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeAttached();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login\//, NAV);
  await expect(page.getByRole("button", { name: /sign in with microsoft/i })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/login\//);
  const user = await page.evaluate(() => JSON.parse(sessionStorage.getItem("credigit.ser.session") ?? "{}").state?.user ?? null);
  expect(user).toBeNull();
});
