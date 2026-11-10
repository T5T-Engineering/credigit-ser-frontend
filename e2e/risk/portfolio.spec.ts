import { expect, test } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { approveAs, watchErrors } from "./ops";

/** Flow 8 — Portfolio & MIS: report generation, validation & release; executive summary sign-off (PRD §6.6.6, §6.11, §6.12). */

test.describe("Portfolio reports & executive summary", () => {
  test("MIS officer generates a report run (AI-drafted, gated by the CBA reconciliation break)", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "portfolio-mis-officer", "/portfolio/reports/");
    const catalogue = page.getByRole("table", { name: "Report catalogue" });
    const row = catalogue.getByRole("row").filter({ hasText: "Large exposures return" });
    await row.getByRole("button", { name: "Generate" }).click();

    const runs = page.getByRole("table", { name: "Report runs" });
    const newRun = runs.getByRole("row").filter({ hasText: "Large exposures return" }).filter({ hasText: /RUN-(?!0933)/ }).first();
    await expect(newRun).toContainText("Generating");
    // Simulated generation finishes → AI draft awaiting validation.
    await expect(newRun).toContainText("AI-drafted — awaiting validation");
    // TD-502: the simulated CBA suspense break blocks release of runs generated now (business rule).
    await expect(page.getByText(/release is blocked while a cba reconciliation break is open/i)).toBeVisible();
    await expect(newRun).toContainText("Break open");
    await expect(newRun.getByRole("button", { name: /validate & submit/i })).toBeDisabled();
    errs.assertClean();
  });

  test("validate & submit a reconciled run → Head of Risk releases it in Operations", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "portfolio-mis-officer", "/portfolio/reports/");
    const runs = page.getByRole("table", { name: "Report runs" });
    const run = runs.getByRole("row").filter({ hasText: "RUN-0933" });
    await expect(run).toContainText("Validated");
    await run.getByRole("button", { name: /validate & submit/i }).click();
    await expect(run).toContainText("Submitted for release");
    await expect(run.getByRole("link", { name: "Awaiting approval" })).toBeVisible();

    // Maker can't release their own request (segregation of duties): it isn't in their queue.
    await switchRole(page, "portfolio-mis-officer", "/operations/");
    await expect(page.getByText(/Release Large exposures return — Oct 2026/)).toHaveCount(0);

    await approveAs(page, "head-of-risk", "Release Large exposures return — Oct 2026");
    await expect(page.getByText(/^Approved/).first()).toBeVisible();

    await switchRole(page, "portfolio-mis-officer", "/portfolio/reports/");
    const released = page.getByRole("table", { name: "Report runs" }).getByRole("row").filter({ hasText: "RUN-0933" });
    await expect(released).toContainText("Released");
    await expect(released).not.toContainText("Awaiting approval");
    errs.assertClean();
  });

  test("Head of Risk submits the AI executive summary → CRO signs it off @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "head-of-risk", "/executive/");
    const card = page.locator("section, article, div").filter({ has: page.getByText("Executive risk summary", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Submit for sign-off" }) }).last();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Submit for sign-off" }).click();
    await expect(page.getByText(/awaiting sign-off in operations/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for sign-off" })).toHaveCount(0);

    await approveAs(page, "cro", /Sign off executive risk summary/);
    await expect(page.getByText(/^Approved/).first()).toBeVisible();

    await switchRole(page, "head-of-risk", "/executive/");
    await expect(page.getByText(/through Operations/).first()).toBeVisible();
    await expect(page.getByText(/awaiting sign-off in operations/i)).toHaveCount(0);
    errs.assertClean();
  });
});
