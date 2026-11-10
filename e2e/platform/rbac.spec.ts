import { expect, test } from "./fixtures";
import { signInAs } from "../helpers";
import { NAV } from "./auth-helpers";

const denied = /you don't have access to this/i;

test("Account Officer: no Admin, no AI console, Operations is view-only, direct URLs are gated @mobile", async ({ page, isMobile }) => {
  await signInAs(page, "account-officer");
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  if (!isMobile) {
    await expect(nav.getByText("Users & roles", { exact: true })).toHaveCount(0);
    await expect(nav.getByText("AI analytics", { exact: true })).toHaveCount(0);
    await expect(nav.getByText("Operations", { exact: true }).first()).toBeVisible();
  }

  await page.goto("/admin/");
  await expect(page.getByText(denied)).toBeVisible(NAV);
  await page.goto("/ai/");
  await expect(page.getByText(denied)).toBeVisible(NAV);
  await expect(page.getByLabel(/ask a question/i)).toHaveCount(0);

  await page.goto("/operations/rules/");
  await expect(page.getByRole("button", { name: "Details" }).first()).toBeVisible(NAV);
  await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(0);
  await page.goto("/operations/rules/?key=auth.otpMaxAttempts");
  const drawer = page.getByRole("dialog", { name: /one-time code attempts/i });
  await expect(drawer.getByText(/view only/i)).toBeVisible();
  await expect(drawer.getByRole("button", { name: /submit for approval/i })).toHaveCount(0);
});

test("IT support: AI console in platform scope only", async ({ page }) => {
  await signInAs(page, "it-support", "/ai/");
  await expect(page.getByText(/platform scope/i).first()).toBeVisible(NAV);
  await page.getByLabel(/ask a question/i).fill("Top 10 obligors by exposure in Manufacturing");
  await page.getByRole("button", { name: /^ask$/i }).click();
  await expect(page.getByText(/outside your query scope/i).first()).toBeVisible();
  // Admin is view-only for IT support; Operations rule editing isn't offered.
  await page.goto("/operations/rules/");
  await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(0, NAV);
});
