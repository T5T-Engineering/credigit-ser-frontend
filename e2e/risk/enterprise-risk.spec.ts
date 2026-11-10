import { expect, test } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { watchErrors } from "./ops";
import { approveInOps } from "./f2-local";

test.describe("Enterprise risk — Board Risk Committee pack", () => {
  test.describe.configure({ timeout: 240_000 });

  test("Head of Risk compiles and submits the BRC pack; CRO approves it in Operations", async ({ page }) => {
    const watch = watchErrors(page);
    await signInAs(page, "head-of-risk", "/enterprise-risk/brc-pack/");
    await page.getByLabel("Committee meeting date").fill("2026-12-03");
    await page.getByRole("button", { name: /compile pack \(\d+ sections\)/i }).click();
    // Compilation steps through each section, then shows the compiled draft.
    const packHeading = page.getByText(/^BRC-20261203-\d{2}$/).first();
    await expect(packHeading).toBeVisible({ timeout: 20_000 });
    const packId = (await packHeading.textContent())!.trim();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Submit to CRO" }).click();
    await expect(page.getByText(/sent for approval/i).first()).toBeVisible();
    await expect(page.getByText("Submitted to CRO", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Awaiting approval in Operations")).toBeVisible();

    // The Head of Risk can't approve their own submission (segregation of duties) — the CRO decides.
    await approveInOps(page, "cro", `BRC pack ${packId} — meeting 2026-12-03`);
    await expect(page.getByText(/^approved/i).first()).toBeVisible();

    await switchRole(page, "head-of-risk", "/enterprise-risk/brc-pack/");
    await expect(page.getByText(packId).first()).toBeVisible();
    await expect(page.getByText("Approved for BRC", { exact: true }).first()).toBeVisible();
    watch.assertClean();
  });

  test("a role with view-only access can't compile a pack", async ({ page }) => {
    const watch = watchErrors(page);
    await signInAs(page, "operational-risk-analyst", "/enterprise-risk/brc-pack/");
    await expect(page.getByRole("button", { name: /compile pack/i })).toBeDisabled();
    await expect(page.getByText(/can view packs but not compile them/i)).toBeVisible();
    watch.assertClean();
  });
});
