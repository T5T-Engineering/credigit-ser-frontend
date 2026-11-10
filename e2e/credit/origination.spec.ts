import { expect, test } from "@playwright/test";
import { signInAs } from "../helpers";
import { clickOrDispatch, expectNoHorizontalOverflow } from "./credit-helpers";

test.describe("Loan origination wizard", () => {
  test("Account Officer creates and submits a new application through every step @mobile", async ({ page }) => {
    test.slow();
    await signInAs(page, "account-officer", "/origination/new/");
    const next = page.getByRole("button", { name: "Next", exact: true });
    const stepHeading = (name: string) => page.getByRole("heading", { level: 2, name });

    // 1. Obligor — validation blocks an empty step, then pick an existing obligor.
    await expect(stepHeading("Obligor")).toBeVisible();
    await clickOrDispatch(next);
    await expect(page.getByRole("alert").filter({ hasText: "Select an obligor to continue." })).toBeVisible();
    const obligors = page.getByRole("table").first();
    const firstRow = obligors.getByRole("row").nth(1);
    const obligorName = (await firstRow.getByRole("cell").first().innerText()).trim();
    await firstRow.getByRole("cell").first().click();
    await expect(page.getByText(`Selected: ${obligorName}`)).toBeVisible();
    await clickOrDispatch(next);

    // 2. Facility request
    await expect(stepHeading("Facility request")).toBeVisible();
    await page.getByLabel("Amount requested").fill("150000000");
    await page.getByLabel("Tenor").fill("24");
    await page.getByLabel("Purpose").fill("Working capital to finance inventory for the festive season.");
    await clickOrDispatch(next);

    // 3. Documents with simulated OCR
    await expect(stepHeading("Documents")).toBeVisible();
    await clickOrDispatch(next);
    await expect(page.getByRole("alert").filter({ hasText: /Still required/ })).toBeVisible();
    await page.getByRole("button", { name: "Use sample customer pack" }).click();
    await expect(page.getByText("Audited financial statements FY2025.pdf")).toBeVisible();
    // OCR runs on a timer; every document ends "Extracted".
    await expect(page.getByRole("progressbar", { name: /Processing OCR/ })).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText("Extracted from the audited financial statements")).toBeVisible();
    await expectNoHorizontalOverflow(page, { soft: true });
    await clickOrDispatch(next);

    // 4. Financial validation (COP Ratio)
    await expect(stepHeading("Financial validation")).toBeVisible();
    await expect(page.getByText("COP Ratio").first()).toBeVisible();
    const explanation = page.getByLabel(/Customer explanation/);
    if (await explanation.count()) await explanation.fill("Seasonal cash sales are banked through an affiliate account; reconciled by the AO.");
    await expectNoHorizontalOverflow(page, { soft: true });
    await clickOrDispatch(next);

    // 5. Bureau & CRMS
    await expect(stepHeading("Bureau & CRMS")).toBeVisible();
    await clickOrDispatch(next);
    await expect(page.getByRole("alert").filter({ hasText: /Run the bureau and CRMS checks/ })).toBeVisible();
    await page.getByRole("button", { name: "Run bureau & CRMS checks" }).click();
    await expect(page.getByRole("button", { name: "Re-run checks" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/No adverse findings|Adverse finding/).first()).toBeVisible();
    await expectNoHorizontalOverflow(page, { soft: true });
    await clickOrDispatch(next);

    // 6. Collateral — add new security
    await expect(stepHeading("Collateral")).toBeVisible();
    await page.getByRole("button", { name: "Add collateral" }).click();
    await page.getByLabel("Description").fill("Warehouse, Plot 12 Ikeja industrial estate");
    await page.getByLabel("Market value").fill("300000000");
    await expect(page.getByText("Security cover")).toBeVisible();
    await expectNoHorizontalOverflow(page, { soft: true });
    await clickOrDispatch(next);

    // 7. Routing preview
    await expect(stepHeading("Routing preview")).toBeVisible();
    await expect(page.getByText("Final authority")).toBeVisible();
    await expect(page.getByText(/Portfolio-limit gate/)).toBeVisible();
    await expectNoHorizontalOverflow(page, { soft: true });
    await clickOrDispatch(next);

    // Review & submit
    await expect(stepHeading("Review & submit")).toBeVisible();
    await expect(page.getByText(obligorName).first()).toBeVisible();
    await clickOrDispatch(page.getByRole("button", { name: "Submit application" }));

    // Record page
    await expect(page).toHaveURL(/\/origination\/application\/?\?id=APP-\d+/);
    const appId = new URL(page.url()).searchParams.get("id")!;
    await expect(page.getByRole("heading", { level: 1, name: obligorName })).toBeVisible();
    await expect(page.getByText(appId).first()).toBeVisible();
    await expect(page.getByText(/₦150,000,000/).first()).toBeVisible();
    await expect(page.getByText(/^(Analysis|Documents)$/).first()).toBeVisible();

    // It shows in the pipeline too.
    await page.goto("/origination/");
    await expect(page.getByText(appId).first()).toBeVisible();
  });
});
