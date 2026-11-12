import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test("sign-in page (Local mode) shows the email form and collapsible demo roles, no Microsoft button @mobile", async ({ page }) => {
  await page.goto("/login/");
  await expect(page.getByLabel(/work email/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in with microsoft/i })).toHaveCount(0);
  const front = page.getByRole("button", { name: /front office/i });
  await expect(front).toHaveAttribute("aria-expanded", "false");
  await front.click();
  await expect(front).toHaveAttribute("aria-expanded", "true");
});

test("demo sign-in lands on a role-aware dashboard", async ({ page }) => {
  await signInAs(page, "cro");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/good (morning|afternoon|evening)/i);
});
