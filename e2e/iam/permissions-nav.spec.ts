import { expect, test } from "../platform/fixtures";
import { signInAs } from "../helpers";
import { NAV } from "../platform/auth-helpers";

const denied = /you don't have access to this/i;
const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main" }).first();

test("System Admin holds every permission: every module is in the menu and business pages open", async ({ page }) => {
  await signInAs(page, "system-admin");
  for (const label of ["Dashboard", "Loan origination", "360 RAR analysis", "Credit administration", "Disbursement", "Portfolio & MIS", "IFRS 9 & ICAAP", "Enterprise risk", "Operations", "Users & roles", "AI analytics", "Audit log"]) {
    await expect(nav(page).getByText(label, { exact: true }).first()).toBeVisible();
  }
  // Formerly System Admin had no business-module access; now the permission set includes it.
  await page.goto("/enterprise-risk/register/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(NAV);
  await expect(page.getByText(denied)).toHaveCount(0);
  await page.goto("/admin/permissions/");
  await expect(page.getByRole("combobox", { name: "Role" })).toBeVisible(NAV);
});

test("A limited role sees only its permitted modules and sub-pages; direct URLs fail closed", async ({ page }) => {
  await signInAs(page, "account-officer");
  await expect(nav(page).getByText("Loan origination", { exact: true }).first()).toBeVisible();
  for (const label of ["Users & roles", "Enterprise risk", "AI analytics", "Audit log", "Disbursement"]) {
    await expect(nav(page).getByText(label, { exact: true })).toHaveCount(0);
  }
  await page.goto("/enterprise-risk/");
  await expect(page.getByText(denied)).toBeVisible(NAV);
  // Roles and permissions are readable by default (identity.permissions.view) but not changeable.
  await page.goto("/admin/permissions/");
  await expect(page.getByText(/view only/i)).toBeVisible(NAV);
  await expect(page.getByRole("button", { name: /request change/i })).toHaveCount(0);
  await page.goto("/admin/");
  await expect(page.getByText(denied)).toBeVisible(NAV);
});

test("Board reads the BRC pack (granted permission) but not the rest of Enterprise risk", async ({ page }) => {
  await signInAs(page, "board", "/enterprise-risk/brc-pack/");
  await expect(page.getByText(denied)).toHaveCount(0, NAV);
  await expect(page.getByRole("tab", { name: "BRC pack" }).or(page.getByRole("link", { name: "BRC pack" })).first()).toBeVisible();
  await page.goto("/enterprise-risk/register/");
  await expect(page.getByText(denied)).toBeVisible(NAV);
});
