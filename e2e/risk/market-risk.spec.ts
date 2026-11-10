import { expect, test, type Page } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { watchErrors } from "./ops";
import { approveInOps as approveAs } from "./f2-local";

/** Row in the breach log (desktop table row or mobile card). */
function breachRow(page: Page, text: string | RegExp) {
  const log = page.getByRole("table", { name: /limit breach log/i }).or(page.getByRole("list", { name: /limit breach log/i }));
  // Newest first (default sort), so .first() is the breach raised in this test.
  return log.getByRole("row").or(log.getByRole("listitem")).filter({ hasText: text }).first();
}

test.describe("Market & liquidity risk", () => {
  test.describe.configure({ timeout: 240_000 });
  test("analyst raises a detected limit breach, escalates it, and closure is approved in Operations @mobile", async ({ page }) => {
    const watch = watchErrors(page);
    await signInAs(page, "market-risk-analyst", "/market-risk/");
    const alert = page.getByRole("alert").filter({ hasText: /not yet in the breach log/i });
    await expect(alert).toBeVisible();
    // Raise the first detected exceedance.
    const firstLine = alert.getByRole("button", { name: "Raise breach" }).first();
    const metric = (await alert.locator("span.font-semibold").first().textContent())!.trim();
    await firstLine.click();
    await expect(page.getByText(/breach raised and alert recipients notified/i).first()).toBeVisible();

    const row = breachRow(page, metric);
    await expect(row.getByText(/open/i).first()).toBeVisible();

    // Escalate up the §6.4.4 ladder once.
    await row.getByRole("button", { name: "Escalate" }).click();
    await expect(page.getByText("Breach escalated").first()).toBeVisible();
    await expect(row.getByText(/escalated/i).first()).toBeVisible();

    // Request closure → Operations.
    await row.getByRole("button", { name: "Request close" }).click();
    const modal = page.getByRole("dialog", { name: /request breach closure/i });
    await modal.getByLabel(/resolution note/i).fill("Position reduced below the limit; desk head confirmed.");
    await modal.getByRole("button", { name: /submit for approval/i }).click();
    await expect(page.getByText(/closure submitted for approval/i).first()).toBeVisible();
    await expect(row.getByRole("link", { name: /closure awaiting approval/i })).toBeVisible();

    // Head of Risk approves in Operations.
    await approveAs(page, "head-of-risk", new RegExp(`Close breach .*${metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.getByText(/^approved/i).first()).toBeVisible();

    // Back as the analyst: breach shows Closed with the approver.
    await switchRole(page, "market-risk-analyst", "/market-risk/");
    const closedRow = breachRow(page, metric);
    await expect(closedRow.getByText(/closed/i).first()).toBeVisible();
    await expect(closedRow.getByText(/closed · /i)).toBeVisible();
    watch.assertClean();
  });

  test("stress test run is saved and approved by Head of Risk then CRO", async ({ page }) => {
    const watch = watchErrors(page);
    await signInAs(page, "market-risk-analyst", "/market-risk/stress-testing/");
    const name = `E2E severe run ${Date.now() % 100000}`;
    await page.getByLabel(/run name/i).fill(name);
    await page.getByRole("button", { name: /run & save/i }).click();
    await expect(page.getByText("Stress run saved").first()).toBeVisible();
    const runs = page.getByRole("table", { name: /stress-test runs/i });
    const row = runs.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /submit for approval/i }).click();
    await expect(page.getByText("Submitted for approval").first()).toBeVisible();
    await expect(row.getByRole("link", { name: /awaiting approval/i })).toBeVisible();

    await approveAs(page, "head-of-risk", `Stress scenario: ${name}`);
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    await approveAs(page, "cro", `Stress scenario: ${name}`);
    await expect(page.getByText(/^approved/i).first()).toBeVisible();

    await switchRole(page, "market-risk-analyst", "/market-risk/stress-testing/");
    await expect(page.getByRole("table", { name: /stress-test runs/i }).getByRole("row").filter({ hasText: name }).getByText("Approved")).toBeVisible();
    watch.assertClean();
  });
});
