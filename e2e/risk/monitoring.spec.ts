import { expect, test, type Page } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { watchErrors } from "./ops";
import { approveInOps } from "./f1-local";

/**
 * Loan review & monitoring (PRD §6.4): exceptions raised from past-due obligations enter the escalation protocol,
 * out-of-cycle escalation and resolution (with curing evidence) are signed off through Operations, covenant tests
 * are recorded with evidence, and the exception queue supports the keyboard-accessible "Move" menu.
 */

type StoredException = { id: string; facilityId?: string; status: string; level: number; type: string };

async function exceptionsInStore(page: Page): Promise<StoredException[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("credigit.ser.monitoring");
    return raw ? (JSON.parse(raw).state?.exceptions ?? []) : [];
  });
}

/** Raise a past-due exception from the first past-due row that has none open; returns the facility + exception ids. */
async function raiseFromPastDue(page: Page) {
  const table = page.getByRole("table", { name: /past-due obligations/i });
  await expect(table).toBeVisible();
  // Default sort is DPD descending (oldest arrears already have exceptions); sort ascending to find fresh ones.
  await table.getByRole("button", { name: "DPD" }).click();
  const row = table.getByRole("row").filter({ has: page.getByRole("cell", { name: "None", exact: true }) }).first();
  await expect(row).toBeVisible();
  const facilityId = (await row.getByRole("cell").first().innerText()).trim();
  await row.getByRole("button", { name: `Actions for ${facilityId}` }).click();
  await page.getByRole("menuitem", { name: "Raise exception" }).click();
  const dialog = page.getByRole("dialog", { name: "Raise exception" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Exception type")).toHaveValue("Past-due obligation");
  await dialog.getByRole("button", { name: "Raise at Level 1" }).click();
  await expect(dialog).toBeHidden();
  const ex = (await exceptionsInStore(page)).find((e) => e.facilityId === facilityId && e.status !== "Resolved");
  expect(ex, `exception raised for ${facilityId}`).toBeTruthy();
  // The row now links to the open exception.
  await expect(table.getByRole("link", { name: ex!.id })).toBeVisible();
  return { facilityId, exceptionId: ex!.id };
}

async function openException(page: Page, id: string) {
  await page.goto(`/monitoring/exceptions?id=${id}`);
  const drawer = page.getByRole("dialog").filter({ hasText: id });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe("Loan monitoring", () => {
  test("raise from past-due → escalate (Head of Risk signs off) → resolve with evidence (CCO signs off)", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "loan-review-officer", "/monitoring/");
    const { exceptionId } = await raiseFromPastDue(page);

    // Request an out-of-cycle escalation: routed to Operations, exception stays at Level 1 until signed off.
    let drawer = await openException(page, exceptionId);
    await drawer.getByRole("button", { name: "Request escalation to Level 2" }).click();
    const esc = page.getByRole("dialog", { name: "Request escalation to Level 2" });
    await esc.getByLabel(/reason/i).fill("Obligor has stopped responding; further arrears expected this week.");
    await esc.getByRole("button", { name: "Submit for sign-off" }).click();
    await expect(page.getByText(new RegExp(`Escalation of ${exceptionId} sent for sign-off`))).toBeVisible();
    expect((await exceptionsInStore(page)).find((e) => e.id === exceptionId)!.level).toBe(1);

    await approveInOps(page, "head-of-risk", `Escalate to Level 2: ${exceptionId}`);

    await switchRole(page, "loan-review-officer", "/monitoring/exceptions/");
    const afterEsc = (await exceptionsInStore(page)).find((e) => e.id === exceptionId)!;
    expect(afterEsc.level).toBe(2);
    expect(afterEsc.status).toBe("Escalated");

    // Resolve with curing evidence → CCO signs off → Resolved.
    drawer = await openException(page, exceptionId);
    await expect(drawer.getByText("Level 2").first()).toBeVisible();
    await drawer.getByRole("button", { name: "Submit curing evidence" }).click();
    const res = page.getByRole("dialog", { name: "Submit curing evidence" });
    await expect(res.getByRole("button", { name: "Submit for sign-off" })).toBeDisabled();
    await res.getByLabel("Evidence").fill("CBA credit ref FT26314XK2 — arrears cleared");
    await res.getByRole("button", { name: "Submit for sign-off" }).click();
    await expect(page.getByText(new RegExp(`Curing evidence for ${exceptionId} sent for sign-off`))).toBeVisible();

    await approveInOps(page, "cco", `Close as cured: ${exceptionId}`);

    await switchRole(page, "loan-review-officer", "/monitoring/exceptions/");
    expect((await exceptionsInStore(page)).find((e) => e.id === exceptionId)!.status).toBe("Resolved");
    drawer = await openException(page, exceptionId);
    await expect(drawer.getByText(/CBA credit ref FT26314XK2/).first()).toBeVisible();
    errs.assertClean();
  });

  test("covenant test recorded with evidence", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "loan-review-officer", "/monitoring/covenants/");
    const table = page.getByRole("table", { name: "Covenant register" });
    await expect(table).toBeVisible();
    const trigger = table.getByRole("button", { name: /^Actions for / }).first();
    const covId = (await trigger.getAttribute("aria-label"))!.replace("Actions for ", "");
    await trigger.click();
    await page.getByRole("menuitem", { name: "Record covenant test" }).click();
    const dialog = page.getByRole("dialog", { name: "Record covenant test" });
    await expect(dialog.getByRole("button", { name: "Save result" })).toBeDisabled();
    await dialog.getByRole("radio", { name: "Passed" }).check({ force: true });
    await dialog.getByLabel("Evidence reference").fill("Q3 2026 management accounts.pdf");
    await dialog.getByLabel(/result note/i).fill("DSCR 1.42x on Q3 management accounts");
    await dialog.getByRole("button", { name: "Save result" }).click();
    await expect(dialog).toBeHidden();
    const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem("credigit.ser.monitoring") ?? "{}").state?.covenantTests?.[id], covId);
    expect(stored).toMatchObject({ status: "Compliant", evidence: "Q3 2026 management accounts.pdf" });
    await page.getByRole("searchbox", { name: /search/i }).first().fill(covId);
    const row = table.getByRole("row").filter({ has: page.getByRole("button", { name: `Actions for ${covId}` }) });
    await expect(row.getByText("Compliant")).toBeVisible();

    await switchRole(page, "cro", "/audit/");
    await page.getByRole("combobox", { name: "Action" }).selectOption("Recorded covenant test");
    await expect(page.getByText("Recorded covenant test").filter({ visible: true }).first()).toBeVisible(); // table row (desktop) or card (mobile)
    errs.assertClean();
  });

  test("exceptions board: move menu starts review; moving to Resolved asks for evidence @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await signInAs(page, "loan-review-officer", "/monitoring/exceptions/");
    const board = page.getByRole("list", { name: "Exception workflow" });
    await expect(board).toBeVisible();
    const raisedCol = board.getByRole("listitem", { name: /^Raised/ });
    const moveBtn = raisedCol.getByRole("button", { name: /^Move / }).first();
    await expect(moveBtn).toBeVisible();
    const cardName = (await moveBtn.getAttribute("aria-label"))!.replace(/^Move /, "");
    const reviewCol = board.getByRole("listitem", { name: /^Under review/ });
    const before = await reviewCol.locator("[data-card-id]").count();
    await moveBtn.click();
    await page.getByRole("menuitem", { name: "Move to Under review" }).click();
    await expect(reviewCol.locator("[data-card-id]")).toHaveCount(before + 1);
    await expect(reviewCol.getByRole("button", { name: `Move ${cardName}` }).first()).toBeVisible();

    // Moving to Resolved never closes silently — it opens the curing-evidence dialog.
    await reviewCol.getByRole("button", { name: `Move ${cardName}` }).first().click();
    await page.getByRole("menuitem", { name: "Move to Resolved" }).click();
    await expect(page.getByRole("dialog", { name: "Submit curing evidence" })).toBeVisible();
    await page.getByRole("dialog", { name: "Submit curing evidence" }).getByRole("button", { name: "Cancel" }).click();
    errs.assertClean();
  });

  test("exceptions board: drag a card to Under review", async ({ page }) => {
    await signInAs(page, "loan-review-officer", "/monitoring/exceptions/");
    const board = page.getByRole("list", { name: "Exception workflow" });
    const raisedCol = board.getByRole("listitem", { name: /^Raised/ });
    const reviewCol = board.getByRole("listitem", { name: /^Under review/ });
    const card = raisedCol.locator("[draggable=true]").first();
    await expect(card).toBeVisible();
    const id = await card.getAttribute("data-card-id");
    const before = await reviewCol.locator("[data-card-id]").count();
    // Real pointer drag (locator.dragTo scrolls mid-drag on this tall board and can pick up a different card).
    await card.scrollIntoViewIfNeeded();
    const from = (await card.boundingBox())!;
    const to = (await reviewCol.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10);
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect(reviewCol.locator("[data-card-id]")).toHaveCount(before + 1);
    await expect(reviewCol.locator(`[data-card-id="${id}"]`)).toBeVisible();
  });

  test("view-only role sees no monitoring actions", async ({ page }) => {
    await signInAs(page, "credit-analyst", "/monitoring/exceptions/");
    const board = page.getByRole("list", { name: "Exception workflow" });
    await expect(board).toBeVisible();
    await expect(board.getByRole("button", { name: /^Move / })).toHaveCount(0);
  });
});
