import { expect, type Page } from "@playwright/test";

/** Sign in through demo access for a role (fresh browser context = fresh demo data). */
export async function signInAs(page: Page, roleId: string, path = "/dashboard/") {
  const sep = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${sep}demoRole=${roleId}`);
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

/** Switch demo role in the same browser (keeps localStorage data, e.g. a request just submitted). */
export async function switchRole(page: Page, roleId: string, path: string) {
  const sep = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${sep}demoRole=${roleId}`);
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

/** Fill a 6-digit code into the library CodeInput (any code works in the demo). */
export async function enterCode(page: Page, code = "123456") {
  const first = page.getByRole("textbox").filter({ has: page.locator("[inputmode='numeric']") }).first();
  await (await first.count() ? first : page.locator("input[inputmode='numeric']").first()).click();
  await page.keyboard.type(code);
}
