import { expect, test, type Page } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { approveAs, watchErrors } from "./ops";

/** Flow 3 — Collateral & legal (PRD §6.5, §5.7): approvals routed through Operations. */

// Multi-role flows on the shared dev server compile many routes on first hit.
test.describe.configure({ timeout: 240_000 });

type Col = { id: string; type: string; perfection: string; facilityIds: string[] };

async function seededCollateral(page: Page): Promise<Col[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("credigit.ser.demo-data");
    return raw ? (JSON.parse(raw).state.collateral as Col[]) : [];
  });
}

test("revaluation is verified by Middle Office in Operations — the recorder can't verify their own @mobile", async ({ page }) => {
  const watch = watchErrors(page);
  await signInAs(page, "collateral-officer", "/collateral/");
  const all = await seededCollateral(page);
  const c = all.find((x) => x.type !== "Quoted shares" && x.facilityIds.length > 0)!;
  expect(c, "a non-share collateral with a live facility").toBeTruthy();

  await page.goto(`/collateral/item/?id=${c.id}`);
  await page.getByRole("button", { name: "Record revaluation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record revaluation" });
  await dialog.getByLabel("Open market value").fill("250000000");
  await dialog.getByLabel("Forced-sale value").fill("180000000");
  await dialog.getByLabel("Independent valuer").fill("Ubosi Eleh & Co");
  await dialog.getByRole("button", { name: "Save valuation" }).click();
  await expect(page.getByText(/Valuation recorded — submitted for approval \(OPS-/)).toBeVisible();
  await expect(page.getByText("Awaiting Middle Office verification").first()).toBeVisible();

  // Segregation of duties: the recorder sees no decision panel on their own request.
  await switchRole(page, "collateral-officer", "/operations/requests/");
  await page.getByRole("link", { name: new RegExp(`Verify valuation: ${c.id}`) }).first().click();
  await expect(page.getByText(/No decision needed from you/)).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Decision" })).toHaveCount(0);

  await approveAs(page, "middle-office-officer", `Verify valuation: ${c.id}`);
  await expect(page.getByText(/Decision recorded: Approved/)).toBeVisible();

  await switchRole(page, "middle-office-officer", `/collateral/item/?id=${c.id}`);
  await expect(page.getByText(/Verified through Operations \(OPS-/)).toBeVisible();
  watch.assertClean();
});

test("legal sufficiency sign-off is accepted by Credit Administration", async ({ page }) => {
  const watch = watchErrors(page);
  await signInAs(page, "legal-officer", "/collateral/legal/");
  const c = (await seededCollateral(page)).find((x) => x.perfection === "Registration")!;
  expect(c, "a collateral at the Registration step").toBeTruthy();

  await page.goto(`/collateral/item/?id=${c.id}`);
  await page.getByRole("button", { name: "Legal sign-off" }).click();
  const dialog = page.getByRole("dialog", { name: "Legal sufficiency sign-off" });
  await expect(dialog.getByLabel(/Legal opinion/)).toHaveValue(/legally sufficient/);
  await dialog.getByRole("button", { name: "Submit for acceptance" }).click();
  await expect(page.getByText(/Legal sufficiency opinion — submitted for approval \(OPS-/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Legal sign-off" })).toHaveCount(0);

  await approveAs(page, "credit-admin-officer", `Legal sufficiency: ${c.id}`);
  await expect(page.getByText(/Decision recorded: Approved/)).toBeVisible();

  await switchRole(page, "legal-officer", `/collateral/item/?id=${c.id}&tab=perfection`);
  await expect(page.getByText(/accepted by /).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Legal sign-off" })).toHaveCount(0);
  watch.assertClean();
});

test("margin call on shares is raised, then released after cover verification in Operations", async ({ page }) => {
  const watch = watchErrors(page);
  await signInAs(page, "collateral-officer", "/collateral/shares/");
  const callBtn = page.getByRole("button", { name: /^Margin call · / }).first();
  await expect(callBtn).toBeVisible();
  await callBtn.click();
  const raised = page.getByText(/Margin call raised on (COL-\d+) — exception (EXC-[\w-]+)/);
  await expect(raised).toBeVisible();
  const [, colId, excId] = (await raised.textContent())!.match(/(COL-\d+) — exception (EXC-[\w-]+)/)!;

  const row = page.getByRole("row").filter({ hasText: colId });
  await expect(row.getByText("Call raised")).toBeVisible();
  await row.getByRole("button", { name: "Release call" }).click();
  const dialog = page.getByRole("dialog", { name: "Release margin call" });
  await dialog.getByLabel(/Top-up evidence/).fill("CSCS statement — 120,000 additional units lien-marked");
  await dialog.getByRole("button", { name: "Submit for verification" }).click();
  await expect(page.getByText(new RegExp(`Release of the margin call on ${colId} submitted for cover verification`))).toBeVisible();

  // The requester can't release their own call.
  await openApprovalExpectAbsent(page, "collateral-officer", `Release margin call: ${colId}`);

  await approveAs(page, "middle-office-officer", `Release margin call: ${colId}`);
  await expect(page.getByText(/Decision recorded: Approved/)).toBeVisible();

  await switchRole(page, "collateral-officer", "/collateral/shares/");
  await expect(page.getByRole("row").filter({ hasText: colId }).getByText("Call raised")).toHaveCount(0);
  // The linked monitoring exception is resolved.
  await switchRole(page, "loan-review-officer", "/monitoring/exceptions/");
  const exc = await page.evaluate((id) => {
    const raw = localStorage.getItem("credigit.ser.monitoring");
    return raw ? (JSON.parse(raw).state.exceptions as { id: string; status: string }[]).find((e) => e.id === id)?.status : undefined;
  }, excId);
  expect(exc).toBe("Resolved");
  watch.assertClean();
});

async function openApprovalExpectAbsent(page: Page, roleId: string, title: string) {
  await switchRole(page, roleId, "/operations/");
  await expect(page.getByRole("heading", { name: /Approvals|Operations/ }).first()).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
}

