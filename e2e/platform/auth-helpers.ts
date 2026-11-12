import { expect, type Page } from "@playwright/test";

/** Password the specs set for seeded users (no demo password ships in the bundle — AUTH-FR-18). */
export const TEST_PASSWORD = "E2e-Pass#2026z";

/** Navigations can hit a first-time route compile on the dev server. */
export const NAV = { timeout: 45_000 };

/** Sample seeded email shown in the demo hint on the sign-in page. */
export async function sampleEmail(page: Page): Promise<string> {
  await gotoHydrated(page, "/login/");
  const hint = page.getByRole("alert").filter({ hasText: /prototype sign-in/i }).first();
  await expect(hint).toBeVisible();
  const text = (await hint.textContent()) ?? "";
  const m = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  expect(m, "sample email in sign-in hint").not.toBeNull();
  return m![0];
}

/** Email of the seeded user for a role (read from the persisted demo data). */
export async function emailForRole(page: Page, roleId: string): Promise<string> {
  const email = await page.evaluate((r) => {
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.getItem(localStorage.key(i)!) ?? "";
      if (!raw.includes("\"users\"")) continue;
      try {
        const users = JSON.parse(raw)?.state?.users as { roleId: string; email: string; status: string }[] | undefined;
        const u = users?.find((x) => x.roleId === r && x.status === "Active");
        if (u) return u.email;
      } catch { /* ignore */ }
    }
    return null;
  }, roleId);
  expect(email, `seeded email for ${roleId}`).toBeTruthy();
  return email!;
}

/** Navigate and wait until the client has hydrated (the dev server hydrates slowly; a pre-hydration submit reloads the page). */
export async function gotoHydrated(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

export async function fillCredentials(page: Page, email: string, password: string) {
  await page.getByLabel(/work email/i).fill(email);
  await page.getByLabel(/^password/i).first().fill(password);
  await page.getByRole("button", { name: /^continue$/i }).click();
}

/** Read the demo one-time code from the verify page and enter it. */
export async function enterDemoCode(page: Page) {
  const hint = page.getByText(/your code is/i);
  await expect(hint).toBeVisible();
  const code = ((await hint.textContent()) ?? "").match(/\d{6}/)?.[0];
  expect(code, "demo code on screen").toBeTruthy();
  const input = page.locator("input[inputmode='numeric']").first();
  await input.click();
  await page.keyboard.type(code!); // auto-submits on the last digit
  return code!;
}

/** "Set or reset your password" with the on-screen demo code (seeded users have no password until they set one). */
export async function setPasswordViaReset(page: Page, email: string, password: string) {
  await gotoHydrated(page, "/forgot-password/");
  await page.getByLabel(/work email/i).fill(email);
  await page.getByRole("button", { name: /send code/i }).click();
  await expect(page).toHaveURL(/\/verify\//, NAV);
  await expect(page.getByRole("heading", { name: /enter your reset code/i })).toBeVisible();
  await enterDemoCode(page);
  await expect(page).toHaveURL(/reset-password/, NAV);
  await page.getByLabel(/^new password/i).fill(password);
  await page.getByLabel(/confirm new password/i).fill(password);
  await page.getByRole("button", { name: /reset password/i }).click();
  await expect(page).toHaveURL(/notice=password-reset/, NAV);
}

/** Full password + OTP sign-in from the login page. */
export async function passwordSignIn(page: Page, email: string, password: string) {
  await gotoHydrated(page, "/login/");
  await fillCredentials(page, email, password);
  await expect(page).toHaveURL(/\/verify\//, NAV);
  await enterDemoCode(page);
  await expect(page).toHaveURL(/\/dashboard/, NAV);
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

/** Id of the newest operation of a type (from the persisted Operations store). */
export async function latestOperationId(page: Page, operationType: string): Promise<string> {
  let id: string | null = null;
  await expect(async () => {
    id = await page.evaluate((t) => {
      const raw = localStorage.getItem("credigit.ser.operations");
      const list = (raw ? JSON.parse(raw).state?.instances : []) as { id: string; operationType: string }[];
      return list.find((i) => i.operationType === t)?.id ?? null;
    }, operationType);
    expect(id).toBeTruthy();
  }).toPass({ timeout: 10_000 });
  return id!;
}

/** As the signed-in role, open an operation and record a decision through the DecisionPanel. */
export async function decide(page: Page, id: string, decision: "Approve" | "Reject" | "Return to requester", comment = "Reviewed in end-to-end test, all good.") {
  await page.goto(`/operations/item/?id=${id}`);
  await expect(page.getByRole("radiogroup", { name: "Decision" })).toBeVisible(NAV);
  await page.getByRole("radiogroup", { name: "Decision" }).getByText(decision, { exact: true }).click();
  await page.getByPlaceholder(/state the basis for your decision/i).fill(comment);
  await page.getByRole("button", { name: new RegExp(`^submit: ${decision}`, "i") }).click();
  await expect(page.getByRole("radiogroup", { name: "Decision" })).toHaveCount(0, NAV);
}
