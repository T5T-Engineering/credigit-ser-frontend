import { expect, test, type Page } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { approveAs, watchErrors } from "./ops";

/** Flow 4 — IFRS 9 & ICAAP (PRD §6.7): proposals and changes approved through Operations. */

// Multi-role flows on the shared dev server compile many routes on first hit.
test.describe.configure({ timeout: 240_000 });

const facility = (page: Page, id: string) =>
  page.evaluate((fid) => {
    const raw = localStorage.getItem("credigit.ser.demo-data");
    return raw ? (JSON.parse(raw).state.facilities as { id: string; stage: number; cbnClass: string }[]).find((f) => f.id === fid) : undefined;
  }, id);

test("declassification proposal is approved and the facility stage/class is updated", async ({ page }) => {
  const watch = watchErrors(page);
  await signInAs(page, "predictive-analytics-officer", "/ifrs9/declassification/");
  const table = page.getByRole("table", { name: "Declassification candidates" });
  const propose = table.getByRole("button", { name: "Propose" }).first();
  await expect(propose, "at least one eligible Stage 2/3 facility").toBeVisible();
  await propose.click();

  const dialog = page.getByRole("dialog", { name: "Propose declassification" });
  await expect(dialog).toBeVisible();
  const facId = (await dialog.getByText(/^FAC-[\w-]+ · /).first().textContent())!.split(" · ")[0]!.trim();
  const migration = (await dialog.getByText(/^Stage \d → Stage \d$/).first().textContent())!;
  const [, from, to] = migration.match(/Stage (\d) → Stage (\d)/)!;
  await dialog.getByLabel("Performing portion").fill("100");
  await dialog.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText(/Submitted for approval/).first()).toBeVisible();
  await expect(page.getByText("Awaiting approval", { exact: true }).first()).toBeVisible();
  expect((await facility(page, facId))?.stage).toBe(Number(from));

  await approveAs(page, "head-of-risk", `Declassify ${facId}`);
  await expect(page.getByText(/Decision recorded: Approved/).first()).toBeVisible();

  await switchRole(page, "predictive-analytics-officer", "/ifrs9/declassification/");
  const history = page.getByRole("table", { name: "Declassification history" });
  await expect(history.getByRole("row").filter({ hasText: facId }).getByText("Approved")).toBeVisible();
  const f = await facility(page, facId);
  expect(f?.stage).toBe(Number(to));
  expect(f?.cbnClass).toBe(Number(to) === 1 ? "Performing" : "Watchlist");
  watch.assertClean();
});

test("model version approval runs Head of Risk validation then CRO approval @mobile", async ({ page }) => {
  const watch = watchErrors(page);
  await signInAs(page, "predictive-analytics-officer", "/ifrs9/models/");
  const register = page.getByRole("table", { name: "Model register" });
  const isMobile = (page.viewportSize()?.width ?? 1200) < 768;
  // Open the first model approved for production.
  const row = isMobile ? page.locator('[data-status="Approved"]:visible').first() : register.getByRole("row").filter({ hasText: "Approved" }).first();
  await row.click();
  const drawer = page.getByRole("dialog");
  const name = (await drawer.getByRole("heading").first().textContent())!.trim();
  await drawer.getByRole("button", { name: /Submit for validation/ }).click();

  const modal = page.getByRole("dialog", { name: "Submit for validation & approval" });
  await modal.getByLabel("Change").fill("Recalibrated on 2026 default experience");
  await modal.getByLabel("Version").fill("9.1");
  await modal.getByRole("button", { name: "Submit to Operations" }).click();
  await expect(page.getByText(/Submitted for approval/).first()).toBeVisible();
  const title = `${name} v9.1: Recalibrated on 2026 default experience`;

  // CRO cannot act before the validation step.
  await switchRole(page, "cro", "/operations/");
  await expect(page.getByText(title)).toHaveCount(0);

  await approveAs(page, "head-of-risk", title);
  await expect(page.getByText(/Decision recorded: In progress/).first()).toBeVisible();
  // Validation passed → the model waits for production approval.
  await expect
    .poll(() => page.evaluate((n) => (JSON.parse(localStorage.getItem("credigit.ser.ifrs9") ?? "{}").state?.models ?? []).find((x: { name: string }) => x.name === n)?.status, name))
    .toBe("Pending approval");
  await approveAs(page, "cro", title);
  await expect(page.getByText(/Decision recorded: Approved/).first()).toBeVisible();

  const models = await page.evaluate(() => JSON.parse(localStorage.getItem("credigit.ser.ifrs9") ?? "{}").state);
  const m = (models.models as { name: string; version: string; status: string }[] | undefined)?.find((x) => x.name === name);
  if (m) {
    expect(m.version).toBe("9.1");
    expect(m.status).toBe("Approved");
  }
  await switchRole(page, "predictive-analytics-officer", "/ifrs9/models/");
  if (!isMobile) await expect(register.getByRole("row").filter({ hasText: name }).getByText("v9.1")).toBeVisible();
  watch.assertClean();
});

test("ICAAP scenario severity change applies after Head of Risk and CRO approval", async ({ page }) => {
  const watch = watchErrors(page);
  await signInAs(page, "predictive-analytics-officer", "/ifrs9/icaap/");
  await page.getByRole("button", { name: "Propose scenario changes" }).click();
  await page.getByLabel("Severe PD multiplier").fill("2.75");
  await page.getByLabel("Reason", { exact: false }).last().fill("Board asked for a harsher severe case");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText(/Submitted for approval/).first()).toBeVisible();
  const title = "ICAAP stress scenarios: 1 change(s)";

  await approveAs(page, "head-of-risk", title);
  await approveAs(page, "cro", title);
  await expect(page.getByText(/Decision recorded: Approved/).first()).toBeVisible();

  await switchRole(page, "predictive-analytics-officer", "/ifrs9/icaap/");
  const scenarios = page.getByRole("table", { name: "ICAAP scenarios" });
  await expect(scenarios.getByRole("row").filter({ hasText: "Severe" }).getByText("2.75", { exact: true })).toBeVisible();
  watch.assertClean();
});
