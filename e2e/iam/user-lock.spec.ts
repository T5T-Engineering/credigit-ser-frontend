import { expect, test } from "../platform/fixtures";
import { signInAs } from "../helpers";
import { NAV, emailForRole, fillCredentials, gotoHydrated, passwordSignIn, setPasswordViaReset } from "../platform/auth-helpers";

test("System Admin locks and unlocks a user's sign-in with a required reason", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, "system-admin", "/admin/");
  const email = await emailForRole(page, "credit-analyst");
  const name = await page.evaluate((e) => {
    const users = JSON.parse(localStorage.getItem("credigit.ser.demo-data") ?? "{}").state?.users as { email: string; name: string }[] | undefined;
    return users?.find((u) => u.email === e)?.name ?? null;
  }, email);
  const password = "Lock-Test#2026k";
  await setPasswordViaReset(page, email, password);

  const lockOrUnlock = async (action: "Lock sign-in" | "Unlock sign-in") => {
    await signInAs(page, "system-admin", "/admin/");
    await page.getByRole("searchbox").first().fill(email);
    await page.getByRole("button", { name: new RegExp(`^manage ${name ?? ""}`, "i") }).first().click();
    await page.getByRole("menuitem", { name: action }).click();
    const dialog = page.getByRole("dialog");
    // Reason is required.
    await dialog.getByRole("button", { name: action }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox").fill("Security review after a phishing report.");
    await dialog.getByRole("button", { name: action }).click();
    await expect(page.getByText(action === "Lock sign-in" ? /sign-in locked for/i : /sign-in unlocked for/i)).toBeVisible(NAV);
  };

  await lockOrUnlock("Lock sign-in");
  await expect(page.getByRole("cell", { name: "Locked" }).or(page.getByText("Locked", { exact: true })).first()).toBeVisible();

  // The locked user can't sign in, even with the right password.
  await page.evaluate(() => sessionStorage.removeItem("credigit.ser.session"));
  await gotoHydrated(page, "/login/");
  await fillCredentials(page, email, password);
  await expect(page.getByText(/this account is locked/i)).toBeVisible();

  await lockOrUnlock("Unlock sign-in");
  await page.evaluate(() => sessionStorage.removeItem("credigit.ser.session"));
  await passwordSignIn(page, email, password);
});
