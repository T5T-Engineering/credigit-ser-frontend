import { expect, test } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { watchErrors } from "./ops";
import { approveInOps } from "./f2-local";

test.describe("Operational risk", () => {
  test.describe.configure({ timeout: 240_000 });

  test("loss event above the single-event threshold is logged and escalation roles are notified", async ({ page }) => {
    const watch = watchErrors(page);
    await signInAs(page, "operational-risk-analyst", "/operational-risk/loss-events/");
    await page.getByRole("button", { name: "Log loss event" }).click();
    const modal = page.getByRole("dialog", { name: "Log loss event" });
    const title = `E2E duplicate NIP posting ${Date.now() % 100000}`;
    await modal.getByLabel("Event title").fill(title);
    await modal.getByLabel("Event type").selectOption("External fraud");
    await modal.getByLabel("Indicator category").selectOption({ index: 1 });
    await modal.getByLabel("Business line").selectOption("Payment & settlement");
    await modal.getByLabel("Branch / location").selectOption("Head office");
    await modal.getByLabel("Date occurred").fill("2026-11-05");
    await modal.getByLabel("Gross loss").fill("40000000");
    await modal.getByLabel("Recovered to date").fill("5000000");
    await modal.getByLabel("Root cause").fill("Switch timeout caused duplicate settlement posting.");
    await expect(modal.getByText("Above the single-event escalation threshold")).toBeVisible();
    await modal.getByRole("button", { name: "Log event" }).click();
    await expect(modal).toBeHidden();
    await expect(page.getByText(/Above the single-event threshold: escalation roles notified/)).toBeVisible();
    await expect(page.getByRole("table", { name: /loss-event register/i }).getByRole("row").filter({ hasText: title })).toBeVisible();

    // Head of Risk (an escalation role) receives the in-app notification.
    await switchRole(page, "head-of-risk", "/dashboard/");
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" }).getByText(title).first()).toBeVisible();
    watch.assertClean();
  });

  test("KRI threshold change is approved in Operations and applied to the register @mobile", async ({ page }) => {
    const watch = watchErrors(page);
    await signInAs(page, "operational-risk-analyst", "/operational-risk/");
    await page.getByRole("searchbox", { name: /search/i }).first().fill("Critical-role vacancies");
    await page.getByText("Critical-role vacancies open > 60 days").first().click();
    const drawer = page.getByRole("dialog", { name: /critical-role vacancies/i });
    await drawer.getByRole("button", { name: "Propose threshold change" }).click();
    const modal = page.getByRole("dialog", { name: "Propose threshold change" });
    await modal.getByLabel("Amber from").fill("5");
    await modal.getByLabel("Red from").fill("8");
    await modal.getByLabel("Reason").fill("Board RMC widened tolerance after the Q3 hiring plan was approved.");
    await modal.getByRole("button", { name: "Submit for approval" }).click();
    await expect(modal).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/sent for approval/i).first()).toBeVisible();

    await approveInOps(page, "head-of-risk", "KRI-HC-02 thresholds: 4/7 → 5/8");
    await expect(page.getByText(/^approved/i).first()).toBeVisible();

    await switchRole(page, "operational-risk-analyst", "/operational-risk/");
    await page.getByRole("searchbox", { name: /search/i }).first().fill("Critical-role vacancies");
    await page.getByText("Critical-role vacancies open > 60 days").first().click();
    await expect(page.getByRole("dialog", { name: /critical-role vacancies/i })).toBeVisible();
    await page.getByRole("dialog", { name: /critical-role vacancies/i }).getByRole("button", { name: "Propose threshold change" }).click();
    await expect(page.getByRole("dialog", { name: "Propose threshold change" }).getByText(/Now 5/)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Propose threshold change" }).getByText(/Now 8/)).toBeVisible();
    watch.assertClean();
  });

  test("cancelling a KRI threshold proposal discards the draft", async ({ page }) => {
    await signInAs(page, "operational-risk-analyst", "/operational-risk/");
    await page.getByRole("searchbox", { name: /search/i }).first().fill("Critical-role vacancies");
    await page.getByText("Critical-role vacancies open > 60 days").first().click();
    const drawer = page.getByRole("dialog", { name: /critical-role vacancies/i });
    const modal = page.getByRole("dialog", { name: "Propose threshold change" });
    await drawer.getByRole("button", { name: "Propose threshold change" }).click();
    await modal.getByLabel("Amber from").fill("9");
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();
    await drawer.getByRole("button", { name: "Propose threshold change" }).click();
    await expect(modal.getByLabel("Amber from")).toHaveValue("");
  });

  test("RCSA self-assessment is signed off by the second line through Operations", async ({ page }) => {
    const watch = watchErrors(page);
    await signInAs(page, "operational-risk-analyst", "/operational-risk/rcsa/");
    const table = page.getByRole("table", { name: /rcsa risk & control register/i });
    const row = table.getByRole("row").filter({ hasText: "In progress" }).first();
    const riskTitle = (await row.locator("div.font-medium").first().textContent())!.trim();
    await row.click();
    const drawer = page.getByRole("dialog", { name: riskTitle });
    await drawer.getByRole("button", { name: /submit for second-line sign-off/i }).click();
    await expect(drawer.getByText(/second-line sign-off is with the approvers/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(table.getByRole("row").filter({ hasText: riskTitle }).getByText("Submitted")).toBeVisible();

    await approveInOps(page, "head-of-risk", `RCSA sign-off — ${riskTitle}`);
    await expect(page.getByText(/^approved/i).first()).toBeVisible();

    await switchRole(page, "operational-risk-analyst", "/operational-risk/rcsa/");
    await expect(page.getByRole("table", { name: /rcsa risk & control register/i }).getByRole("row").filter({ hasText: riskTitle }).getByText("Reviewed")).toBeVisible();
    watch.assertClean();
  });
});
