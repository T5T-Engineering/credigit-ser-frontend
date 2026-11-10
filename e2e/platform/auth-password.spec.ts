import { expect, test } from "./fixtures";
import { DEMO_PASSWORD, NAV, enterDemoCode, fillCredentials, passwordSignIn, sampleEmail } from "./auth-helpers";

test.describe("email + password sign-in", () => {
  test("seeded user signs in with password and one-time code @mobile", async ({ page }) => {
    const email = await sampleEmail(page);
    await passwordSignIn(page, email, DEMO_PASSWORD);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/good (morning|afternoon|evening)/i);
  });

  test("wrong password N times locks the account; reset unlocks it", async ({ page }) => {
    const email = await sampleEmail(page);
    const max = 5; // default of rule auth.passwordMaxAttempts
    for (let i = 1; i <= max; i++) {
      await page.getByLabel(/work email/i).fill(email);
      await page.getByLabel(/^password/i).first().fill(`Wrong-password-${i}`);
      await page.getByRole("button", { name: /^continue$/i }).click();
      if (i < max) await expect(page.getByText(/email or password is incorrect/i)).toBeVisible();
    }
    await expect(page.getByText(/account is now locked/i)).toBeVisible();
    // Even the right password is refused now.
    await fillCredentials(page, email, DEMO_PASSWORD);
    await expect(page.getByText(/this account is locked/i)).toBeVisible();

    // Forgot password → code → new password.
    await page.getByRole("link", { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/forgot-password/, NAV);
    await page.getByLabel(/work email/i).fill(email);
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page).toHaveURL(/\/verify\//, NAV);
    await expect(page.getByRole("heading", { name: /enter your reset code/i })).toBeVisible();
    await enterDemoCode(page);
    await expect(page).toHaveURL(/reset-password/, NAV);
    const fresh = "Fresh-Pass#2026x";
    await page.getByLabel(/^new password/i).fill(fresh);
    await page.getByLabel(/confirm new password/i).fill(fresh);
    await page.getByRole("button", { name: /reset password/i }).click();
    await expect(page).toHaveURL(/notice=password-reset/, NAV);
    await expect(page.getByText(/password updated/i)).toBeVisible();

    // Old password no longer works, new one does (account unlocked).
    await fillCredentials(page, email, DEMO_PASSWORD);
    await expect(page.getByText(/email or password is incorrect/i)).toBeVisible();
    await passwordSignIn(page, email, fresh);
  });
});
