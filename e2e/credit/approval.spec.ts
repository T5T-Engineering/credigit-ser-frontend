import { expect, test } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { decide, decisionPanel, expectToast, findOperation } from "./credit-helpers";

/**
 * Seeded APP-2026016: ₦302m Standard request in Recommendation, raised by the Account Officer (USR-001),
 * routed BDM → Credit Analyst + Group Head (adjudicator CCO) → CCO + Directorate Head. Above the ₦100m step-up threshold.
 */
const APP = "APP-2026016";
const appUrl = (tab = "approvals") => `/origination/application/?id=${APP}&tab=${tab}`;

test.describe("Credit approval via Operations", () => {
  test("BDM recommend → co-signer dissent → CCO adjudicates → next tier, with step-up and SoD @mobile", async ({ page }) => {
    test.slow();
    // Initiator cannot decide (segregation of duties).
    await signInAs(page, "account-officer", appUrl());
    await expect(page.getByRole("heading", { name: /Credit approval — APP-2026016/ })).toBeVisible();
    await expect(decisionPanel(page)).toHaveCount(0);
    const op = await findOperation(page, APP, "credit.facility-approval");
    expect(op).not.toBeNull();
    await page.goto(`/operations/item?id=${op!.id}`);
    await expect(page.getByText(/You requested this operation/)).toBeVisible();
    await expect(decisionPanel(page)).toHaveCount(0);

    // Tier 1 — BDM recommends from the application's Approvals tab, with step-up (high value).
    await switchRole(page, "bdm", appUrl());
    await decide(page, "Recommend", "Strong relationship; collateral search complete. Recommend.", { stepUp: true });
    await expectToast(page, "Decision recorded");
    await expect.poll(async () => (await findOperation(page, APP, "credit.facility-approval"))?.stepIndex).toBe(1);
    await expect(page.getByText("Approval", { exact: true }).first()).toBeVisible(); // stage moved Recommendation → Approval

    // Tier 2 — Credit Analyst approves from Operations item page, with step-up.
    await switchRole(page, "credit-analyst", `/operations/item?id=${op!.id}`);
    await decide(page, "Approve", "Cash flows cover debt service 1.6x; approve.", { stepUp: true });
    await expectToast(page, /Decision recorded/);
    // Group Head dissents (decline needs no step-up).
    await switchRole(page, "group-head", `/operations/item?id=${op!.id}`);
    await decide(page, "Reject", "Sector leverage above appetite; I do not support.");
    await expectToast(page, /Decision recorded/);
    await expect.poll(async () => (await findOperation(page, APP, "credit.facility-approval"))?.awaitingAdjudication).toBe(true);

    // Adjudicator (CCO) decides on the Approvals tab with step-up → next tier.
    await switchRole(page, "cco", appUrl());
    await expect(decisionPanel(page)).toContainText("(adjudicator)");
    await decide(page, "Approve", "Adjudicated: approve subject to domiciliation of proceeds.", { stepUp: true });
    await expectToast(page, "Decision recorded");
    await expect.poll(async () => (await findOperation(page, APP, "credit.facility-approval"))?.stepIndex).toBe(2);
    const after = await findOperation(page, APP, "credit.facility-approval");
    expect(after!.status).toBe("In progress");
    expect(after!.awaitingAdjudication).toBeFalsy();

    // The next tier (Directorate Head) sees it in Operations → Approvals.
    await switchRole(page, "directorate-head", "/operations/");
    await expect(page.getByText(/Credit approval — APP-2026016/).first()).toBeVisible();

    // Audit log carries the decisions.
    await switchRole(page, "cro", "/audit/");
    // Table rows on desktop, cards on phones: match visible text, not <option>s in the filters.
    const entry = (re: RegExp) => page.getByText(re).filter({ visible: true }).first();
    await expect(entry(/Decision \(reject\) on step "Tier 2/)).toBeVisible();
    await expect(entry(/Decision \(approve\) on step "Tier 2/)).toBeVisible();
    await expect(entry(/Decision \(approve\) on step "Tier 1/)).toBeVisible();
    await expect(page.getByText(/Sector leverage above appetite/).filter({ visible: true }).first()).toBeVisible();
  });
});
