import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signInAs, switchRole } from "../helpers";
import { NAV, decide, latestOperationId } from "./auth-helpers";

const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

async function previewBrand(page: Page, accent: string, font: string) {
  const accentBox = page.getByRole("textbox", { name: "Accent", exact: true });
  await accentBox.fill(accent);
  await accentBox.press("Tab");
  await page.getByRole("combobox", { name: /application font/i }).selectOption(font);
  await expect(page.getByText(/personal preview — only you see this/i)).toBeVisible();
}

test("branding: personal preview + discard, then tenant brand change approved recolours and refonts the app @mobile", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, "system-admin", "/settings/branding/");
  await expect(page.getByRole("heading", { name: "Branding", level: 1 })).toBeVisible(NAV);
  const accent0 = (await cssVar(page, "--cg-brand-accent")).toLowerCase();
  const font0 = await cssVar(page, "--cg-font-family");
  expect(accent0).toBe("#e8401c");
  expect(font0).toMatch(/baloo 2/i);

  // Personal preview applies instantly, discard restores the tenant brand.
  await previewBrand(page, "#1D7A5F", "Inter");
  await expect.poll(() => cssVar(page, "--cg-brand-accent").then((v) => v.toLowerCase())).toBe("#1d7a5f");
  await expect.poll(() => cssVar(page, "--cg-font-family")).toMatch(/inter/i);
  await page.getByRole("button", { name: /discard preview/i }).click();
  await expect.poll(() => cssVar(page, "--cg-brand-accent").then((v) => v.toLowerCase())).toBe(accent0);
  await expect.poll(() => cssVar(page, "--cg-font-family")).toMatch(/baloo 2/i);

  // Request a tenant brand change.
  await previewBrand(page, "#1D7A5F", "Inter");
  await page.getByRole("button", { name: /request as tenant brand/i }).click();
  const modal = page.getByRole("dialog", { name: /request tenant brand change/i });
  await modal.getByLabel(/reason for the change/i).fill("Rebrand to the bank's new green identity.");
  await modal.getByRole("button", { name: /submit for approval/i }).click();
  await expect(modal.getByText(/sent for approval/i)).toBeVisible();
  await modal.getByRole("button", { name: "Done" }).click();
  const id = await latestOperationId(page, "brand.change");

  // Another user still sees the default until approval (preview is personal): reset this browser's brand first.
  await page.getByRole("button", { name: /discard preview/i }).click();
  await expect.poll(() => cssVar(page, "--cg-brand-accent").then((v) => v.toLowerCase())).toBe(accent0);

  // MD approves → the tenant brand applies across the app.
  await switchRole(page, "md", "/operations/");
  await decide(page, id, "Approve");
  await expect.poll(() => cssVar(page, "--cg-brand-accent").then((v) => v.toLowerCase()), NAV).toBe("#1d7a5f");
  await expect.poll(() => cssVar(page, "--cg-font-family")).toMatch(/inter/i);

  await switchRole(page, "account-officer", "/dashboard/");
  await expect.poll(() => cssVar(page, "--cg-brand-accent").then((v) => v.toLowerCase())).toBe("#1d7a5f");
  await expect.poll(() => cssVar(page, "--cg-font-family")).toMatch(/inter/i);
  // Body text actually uses the font.
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(bodyFont).toMatch(/inter/i);
});
