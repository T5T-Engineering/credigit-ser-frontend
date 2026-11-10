import { expect, test, type Page } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { watchErrors } from "./ops";
import { approveInOps } from "./f1-local";

/**
 * 360 RAR analysis (PRD §6.2): enrichment adjustments are four-eyes (second analyst / CCO via Operations),
 * the advisory note is signed off through Operations, and an analyst can refresh an assessment directly.
 */

/** Open the first assessment from the list and return its obligor id. */
async function openFirstAssessment(page: Page): Promise<string> {
  const link = page.locator('a[href*="/credit-analysis/assessment"][href*="id="]').filter({ visible: true }).first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  const id = new URL(href, "http://x").searchParams.get("id")!;
  await page.goto(`/credit-analysis/assessment?id=${id}`);
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  return id;
}

/** The obligor's committed 360 RAR cardinal scores from the shared Risk Data Spine. */
async function obligorRar(page: Page, id: string) {
  return page.evaluate((oid) => JSON.parse(localStorage.getItem("credigit.ser.demo-data") ?? "{}").state?.obligors?.find((o: { id: string }) => o.id === oid)?.rar ?? null, id);
}

test.describe("360 RAR analysis", () => {
  test("enrichment adjustment → CCO approves in Operations → scores and posture updated @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "credit-analyst", "/credit-analysis/");
    const id = await openFirstAssessment(page);
    const name = (await page.getByRole("heading", { level: 2 }).first().innerText()).trim();

    await page.getByRole("button", { name: "Adjust enrichment inputs" }).click();
    await expect(page.getByText("Edit mode — analyst enrichment inputs")).toBeVisible();
    const input = page.getByRole("spinbutton").first();
    await expect(input).toBeVisible();
    const label = (await input.getAttribute("aria-label"))!; // "<Parameter> score"
    const rarBefore = await obligorRar(page, id);
    const current = Number(await input.inputValue());
    const next = current >= 5 ? 1.5 : 9.5;
    await input.fill(String(next));
    await page.getByLabel(/rationale for the adjustment/i).fill("Management interview 4 Nov 2026 — new off-take agreement signed.");
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByText(/submitted 1 adjustment for second-analyst \/ CCO approval/i)).toBeVisible();
    await expect(page.getByText("Enrichment adjustments awaiting approval")).toBeVisible();

    // The requester can't approve their own adjustment; the CCO decides in Operations.
    await approveInOps(page, "cco", `360 RAR enrichment — ${name}`);
    await expect(page.getByText(/^Approved/).first()).toBeVisible();

    await switchRole(page, "credit-analyst", `/credit-analysis/assessment?id=${id}&tab=parameters`);
    await expect(page.getByText("Enrichment adjustments awaiting approval")).toHaveCount(0);
    // The approved override is stored and the obligor's cardinal scores were recomputed and written back.
    const paramName = label.replace(/ score$/, "");
    const overrides = await page.evaluate((oid) => JSON.parse(localStorage.getItem("credigit.ser.credit-analysis") ?? "{}").state?.overrides?.[oid] ?? {}, id);
    expect(Object.values(overrides).map((o) => (o as { score: number }).score)).toContain(next);
    expect(await obligorRar(page, id)).not.toEqual(rarBefore);
    if (!test.info().project.name.includes("mobile")) {
      await expect(page.getByText("Analyst-adjusted").first()).toBeVisible();
      await expect(page.getByRole("progressbar", { name: `${paramName} score ${next.toFixed(1)} of 10` })).toBeVisible();
    } else {
      await expect(page.getByText(new RegExp(`^${next.toFixed(1)} / 10`)).first()).toBeVisible();
    }

    // Audit trail records the applied adjustment (CRO has audit access).
    await switchRole(page, "cro", "/audit/");
    await page.getByRole("combobox", { name: "Action" }).selectOption("Applied approved 360 RAR enrichment adjustments");
    await expect(page.getByText("Applied approved 360 RAR enrichment adjustments").filter({ visible: true }).first()).toBeVisible(); // table row (desktop) or card (mobile)
    errs.assertClean();
  });

  test("advisory note sign-off via Operations @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "credit-analyst", "/credit-analysis/");
    const id = await openFirstAssessment(page);
    const name = (await page.getByRole("heading", { level: 2 }).first().innerText()).trim();
    await page.getByRole("tab", { name: "Advisory" }).click();
    const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: /advisory note — credit analyst to relationship manager/i }) });
    await expect(panel).toBeVisible();
    // Neutral postures open the note in edit mode with a mandatory narrative — make sure there's text either way.
    const editor = panel.getByRole("textbox");
    if (await editor.count()) await editor.fill("Analyst narrative: obligor is transitional; maintain current exposure and review in 90 days.");
    await panel.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(/submitted for sign-off by a second analyst \/ the CCO/i)).toBeVisible();
    await expect(page.getByText("Sign-off awaiting approval")).toBeVisible();

    await approveInOps(page, "cco", `Advisory note sign-off — ${name}`);

    await switchRole(page, "credit-analyst", `/credit-analysis/assessment?id=${id}&tab=advisory`);
    await expect(page.getByText(/signed off by .*approved by/i).first()).toBeVisible();
    await expect(page.getByText("Sign-off awaiting approval")).toHaveCount(0);
    errs.assertClean();
  });

  test("refresh assessment re-reads feeds and stamps today's date", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "credit-analyst", "/credit-analysis/");
    await openFirstAssessment(page);
    await page.getByRole("button", { name: "Refresh assessment" }).click();
    await expect(page.getByText(/assessment refreshed — all feeds re-read/i)).toBeVisible();
    await expect(page.getByText(/\(0d\)/).first()).toBeVisible();
    await expect(page.getByText(/assessment is \d+ days old/i)).toHaveCount(0);
    errs.assertClean();
  });

  test("view-only role cannot adjust or refresh", async ({ page }) => {
    await signInAs(page, "account-officer", "/credit-analysis/");
    await openFirstAssessment(page);
    await expect(page.getByRole("button", { name: "Adjust enrichment inputs" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh assessment" })).toHaveCount(0);
  });
});
