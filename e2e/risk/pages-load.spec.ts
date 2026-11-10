import { expect, test } from "@playwright/test";
import { allNavItems } from "../../src/lib/nav";
import { canAccess, roleById, roles, type RoleId } from "../../src/lib/rbac/roles";
import { signInAs } from "../helpers";
import { watchErrors } from "./ops";

/**
 * Flow 10 — every module page loads without uncaught errors.
 * Representative role: CRO. Modules the CRO can't open are loaded as the first role that can.
 */
const REPRESENTATIVE: RoleId = "cro";

for (const item of allNavItems) {
  const roleId = canAccess(roleById[REPRESENTATIVE], item.module) ? REPRESENTATIVE : roles.find((r) => canAccess(r, item.module))?.id;
  const pages = item.pages?.length ? item.pages : [{ label: item.label, href: item.href }];

  test(`${item.label}: every page loads cleanly as ${roleId ?? "—"}${item.module === "dashboard" ? " @mobile" : ""}`, async ({ page }) => {
    test.skip(!roleId, "No role can open this module");
    test.setTimeout(30_000 + pages.length * 30_000);
    const watch = watchErrors(page);
    await signInAs(page, roleId!, item.href.endsWith("/") ? item.href : `${item.href}/`);
    for (const p of pages) {
      await test.step(p.label, async () => {
        const [path, query] = p.href.split("?");
        await page.goto(`${path.endsWith("/") ? path : `${path}/`}${query ? `?${query}` : ""}`);
        await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
        await expect(page.locator("main")).toBeVisible();
        // Content settled: no global spinner, and no Next.js error overlay / boundary.
        await expect(page.getByText(/application error|unhandled runtime error|something went wrong/i)).toHaveCount(0);
        await expect(page.getByText(/you don.t have access|not authori[sz]ed|access restricted/i)).toHaveCount(0);
        await page.waitForLoadState("networkidle").catch(() => undefined);
      });
    }
    watch.assertClean();
  });
}
