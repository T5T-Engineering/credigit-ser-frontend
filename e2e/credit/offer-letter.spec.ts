import { expect, test } from "@playwright/test";
import { switchRole, signInAs } from "../helpers";
import { decide, expectToast, findOperation } from "./credit-helpers";

/**
 * Seeded APP-2026005: ₦58m Standard request raised by the Account Officer (USR-001), at the final
 * Credit Analyst + Group Head co-sign tier. Below the step-up threshold.
 */
const APP = "APP-2026005";
const appUrl = `/origination/application/?id=${APP}`;
const letterUrl = `/offer-letters/letter/?applicationId=${APP}`;
/** Offer-letter id generated for the application (`letterIdFor`). */
const LETTER = `OL-${APP.replace(/^APP-/, "")}`;

test.describe("Offer letter", () => {
  test("final approval → release → Legal sign-off via Operations → issue → acceptance → Conditions @mobile", async ({ page }) => {
    test.slow();
    await signInAs(page, "credit-analyst", appUrl);
    const op = await findOperation(page, APP, "credit.facility-approval");
    expect(op?.stepIndex).toBe(1);

    // Final tier co-signs in Operations.
    await page.goto(`/operations/item?id=${op!.id}`);
    await decide(page, "Approve", "Debt service cover adequate; approve.");
    await expectToast(page, /Decision recorded/);
    await switchRole(page, "group-head", `/operations/item?id=${op!.id}`);
    await decide(page, "Approve", "Concur with the analyst; approve.");
    await expectToast(page, /Decision recorded: Approved/);

    // Initiator releases the fully approved request to the offer letter.
    await switchRole(page, "account-officer", appUrl);
    await expect(page.getByText("Fully approved").first()).toBeVisible();
    await page.getByRole("button", { name: "Release to offer letter" }).click();
    await expect(page.getByRole("link", { name: "Open offer letter" })).toBeVisible();
    await page.getByRole("link", { name: "Open offer letter" }).click();
    await expect(page).toHaveURL(/offer-letters\/letter/);

    // Composer: auto-generated draft with clauses; AO sends it to Legal (Operations).
    await expect(page.getByText("Draft — not yet sent to Legal")).toBeVisible();
    await page.getByRole("tab", { name: /Clauses/ }).click();
    await expect(page.getByText(/Auto-tagged/).first()).toBeVisible();
    await page.getByRole("button", { name: "Send to Legal for sign-off" }).click();
    await expect(page.getByText("Awaiting Legal sign-off & issue")).toBeVisible();
    const signoff = await findOperation(page, LETTER, "offer-letters.letter.signoff");
    expect(signoff?.status).toBe("Pending");

    // Legal sees it in Operations → Approvals and signs off from the letter.
    await switchRole(page, "legal-officer", "/operations/");
    await expect(page.getByText(/Sign off & issue offer letter/).first()).toBeVisible();
    await page.goto(letterUrl);
    await page.getByRole("button", { name: "Legal sign-off & issue" }).click();
    const modal = page.getByRole("dialog", { name: "Legal sign-off" });
    await expect(modal.getByRole("button", { name: "Sign off & issue" })).toBeDisabled();
    await modal.getByLabel(/I confirm the conditions and covenants text/).check({ force: true });
    await modal.getByRole("button", { name: "Sign off & issue" }).click();
    await expect(modal).toBeHidden();
    await expect(page.getByText("Signed off and issued")).toBeVisible();
    await expect.poll(async () => (await findOperation(page, LETTER, "offer-letters.letter.signoff"))?.status).toBe("Approved");

    // AO records customer acceptance → application moves to Conditions.
    await switchRole(page, "account-officer", letterUrl);
    await page.getByRole("button", { name: "Record customer acceptance" }).click();
    const accept = page.getByRole("dialog", { name: "Record customer acceptance" });
    await accept.getByLabel("Signed duplicate copy of the offer letter received").check({ force: true });
    await accept.getByLabel(/Memorandum of Acceptance executed/).check({ force: true });
    await accept.getByRole("button", { name: "Record acceptance" }).click();
    await expect(page.getByText("Customer acceptance recorded.")).toBeVisible();
    await page.goto(appUrl);
    await expect(page.getByText("Conditions", { exact: true }).first()).toBeVisible();
  });
});
