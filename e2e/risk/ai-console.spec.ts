import { expect, test } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { watchErrors } from "./ops";

/** Flow 9 — AI analytics & NL query console (PRD §6.12–6.13). */

test.describe("AI query console", () => {
  test("CRO asks a suggested question → answer with chart & table, logged and audited @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "cro", "/ai/");
    // The example answer's charts must not widen the layout viewport (mobile horizontal overflow regression).
    await expect(page.getByRole("button", { name: "Top 10 obligors by exposure in Manufacturing" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const question = "Top 10 obligors by exposure in Manufacturing";
    await page.getByRole("button", { name: question }).click();

    // The asked question appears as a logged exchange (with an NLQ reference) and the answer renders.
    const exchange = page.getByText(/NLQ-/).first();
    await expect(exchange).toBeVisible();
    await expect(page.getByText(/example answer \(not logged\)/i)).toHaveCount(0);
    const answerTable = page.getByRole("table").first();
    await expect(answerTable).toBeVisible();
    expect(await answerTable.getByRole("row").count()).toBeGreaterThan(1);
    await expect(page.locator("svg[role='img'], [role='img'] svg, figure svg").first()).toBeVisible();
    await expect(page.getByRole("figure").filter({ hasText: "SEC-MFG" }).locator("code")).toBeVisible();

    // Query log
    await switchRole(page, "cro", "/ai/log/");
    await expect(page.getByRole("table", { name: "Query log" }).getByRole("row").filter({ hasText: question })).toContainText("answered");

    // Immutable audit trail entry
    await switchRole(page, "cro", "/audit/");
    await expect(page.getByRole("row").or(page.getByRole("listitem")).filter({ hasText: "AI query answered" }).filter({ hasText: question }).first()).toBeVisible();
    errs.assertClean();
  });

  test("a role without console access sees the restriction", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "credit-analyst", "/ai/");
    await expect(page.getByText(/you don't have access to this|restricted to designated power users/i).first()).toBeVisible();
    // Not offered in the navigation either.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "AI analytics" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ask" })).toHaveCount(0);
    await expect(page.getByLabel("Ask a question")).toHaveCount(0);
    errs.assertClean();
  });

  test("IT support (platform scope) is refused a customer-data question", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "it-support", "/ai/");
    await expect(page.getByText("Platform scope", { exact: true })).toBeVisible();
    // Only platform suggestions are offered.
    await expect(page.getByRole("button", { name: "Connector health status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Top 10 obligors by exposure in Manufacturing" })).toHaveCount(0);

    await page.getByLabel("Ask a question").fill("NPL ratio by branch");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText("Outside your query scope")).toBeVisible();
    await expect(page.getByText(/limited to platform-health and configuration data/i).first()).toBeVisible();

    await switchRole(page, "it-support", "/ai/log/");
    await expect(page.getByRole("table", { name: "Query log" }).getByRole("row").filter({ hasText: "NPL ratio by branch" })).toContainText("refused");
    errs.assertClean();
  });
});
