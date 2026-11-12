import { expect, test } from "../platform/fixtures";
import { NAV, enterDemoCode, fillCredentials, gotoHydrated, sampleEmail, setPasswordViaReset } from "../platform/auth-helpers";

/** Demo Local mode: no demo password ships; a seeded user sets one with a one-time code, then signs in with password + code. */
test("Local sign-in: set password with a code, then e-mail + password + one-time code @mobile", async ({ page }) => {
  const email = await sampleEmail(page);
  // Without a password the generic error is shown (no account enumeration).
  await fillCredentials(page, email, "Any-Password#2026");
  await expect(page.getByText(/email or password is incorrect/i)).toBeVisible();

  const password = "Local-Mode#2026q";
  await setPasswordViaReset(page, email, password);
  await expect(page.getByText(/password updated/i)).toBeVisible();

  await gotoHydrated(page, "/login/");
  await fillCredentials(page, email, password);
  await expect(page).toHaveURL(/\/verify\//, NAV);
  await expect(page.getByRole("heading", { name: /enter your sign-in code/i })).toBeVisible();
  await enterDemoCode(page);
  await expect(page).toHaveURL(/\/dashboard/, NAV);

  // The session carries the user and publishes the sign-in event.
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem("credigit.ser.session") ?? "{}").state);
  expect(session.user.email).toBe(email);
  const events = await page.evaluate(() => JSON.parse(localStorage.getItem("credigit.ser.events") ?? "{}").state?.log ?? []);
  expect(JSON.stringify(events)).toContain("identity.user.signed-in");
});
