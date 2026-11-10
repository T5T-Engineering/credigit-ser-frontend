import { expect, test, type Page } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { decide, decisionPanel, expectToast, facilityFor } from "./credit-helpers";

type Waiver = { id: string; status: string; approverRoleIds: string[]; withinTolerance: boolean; operationId?: string; conditionId: string; cpKey: string };

async function latestWaiver(page: Page): Promise<Waiver | undefined> {
  return page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("credigit.ser.credit-admin") ?? "{}").state ?? {};
    const list = Object.values(st.waivers ?? {}) as (Waiver & { requestedAt: string })[];
    return list.filter((w) => w.id.startsWith("WVR")).sort((a, b) => b.id.localeCompare(a.id))[0];
  });
}

async function cpStatus(page: Page, key: string, cpId: string) {
  return page.evaluate(([k, c]) => JSON.parse(localStorage.getItem("credigit.ser.credit-admin") ?? "{}").state?.cp?.[k]?.[c]?.status as string | undefined, [key, cpId] as const);
}

test.describe("Waiver request", () => {
  test("Credit Admin raises a waiver → approving tier decides in Operations → condition waived @mobile", async ({ page }) => {
    test.slow();
    // Seeded APP-2026022: facility pending disbursement with an open condition precedent.
    await signInAs(page, "credit-admin-officer", "/credit-admin/");
    const fac = (await facilityFor(page, "APP-2026022"))!;
    await page.goto(`/credit-admin/waivers/?facility=${fac.id}&new=1`);

    const modal = page.getByRole("dialog", { name: "New waiver, deferral or sanction" });
    await expect(modal).toBeVisible();
    await modal.getByLabel("Request type").selectOption("Waiver");
    await expect(modal.getByLabel("Facility")).toHaveValue(fac.id);
    const condition = modal.getByLabel("Condition");
    const firstOpen = await condition.locator("option:not([value=''])").first().getAttribute("value");
    await condition.selectOption(firstOpen!);
    await expect(modal.getByText(/Routes to .* the tier that approved the original facility/)).toBeVisible();
    await modal.getByLabel("Reason").fill("Customer awaiting CAC filing; condition set aside until the next review.");
    await modal.getByRole("button", { name: "Submit for approval" }).click();
    await expect(modal).toBeHidden();

    // The request opens in a drawer; the requester can't decide it.
    const drawer = page.getByRole("dialog").filter({ hasText: /Waiver WVR-/ });
    await expect(drawer.getByText("Awaiting the approving tier")).toBeVisible();
    await expect(decisionPanel(page)).toHaveCount(0);
    const w = (await latestWaiver(page))!;
    expect(w.status).toBe("Pending approval");
    expect(w.withinTolerance).toBe(false);
    expect(w.operationId).toBeTruthy();

    // The approving tier sees it in Operations → Approvals and approves on the item page.
    const approver = w.approverRoleIds[0]!;
    await switchRole(page, approver, "/operations/");
    await expect(page.getByText(new RegExp(`Waiver ${w.id}`)).first()).toBeVisible();
    await page.goto(`/operations/item?id=${w.operationId}`);
    await decide(page, "Approve", "Low-risk documentation item; waiver granted.");
    await expectToast(page, /Decision recorded: Approved/);

    // The waiver register and the facility reflect the decision (Credit Admin's view).
    await switchRole(page, "credit-admin-officer", `/credit-admin/waivers/?facility=${fac.id}`);
    // Open the request (row on desktop, card on phones) and read its status in the drawer.
    await page.getByText(w.id).filter({ visible: true }).first().click();
    const decided = page.getByRole("dialog", { name: `Waiver ${w.id}` });
    await expect(decided.getByText("Approved").first()).toBeVisible();
    await expect(decided.getByText(/Low-risk documentation item; waiver granted/)).toBeVisible();
    expect(await cpStatus(page, w.cpKey, w.conditionId)).toBe("waived");
  });

  test("a role below the approving tier can't approve the waiver from Operations", async ({ page }) => {
    test.slow();
    await signInAs(page, "credit-admin-officer", "/credit-admin/");
    const fac = (await facilityFor(page, "APP-2026022"))!;
    await page.goto(`/credit-admin/waivers/?facility=${fac.id}&new=1`);
    const modal = page.getByRole("dialog", { name: "New waiver, deferral or sanction" });
    await modal.getByLabel("Request type").selectOption("Waiver");
    const condition = modal.getByLabel("Condition");
    await condition.selectOption((await condition.locator("option:not([value=''])").first().getAttribute("value"))!);
    await modal.getByLabel("Reason").fill("Customer awaiting CAC filing; condition set aside until the next review.");
    await modal.getByRole("button", { name: "Submit for approval" }).click();
    const w = (await latestWaiver(page))!;
    expect(w.approverRoleIds).not.toContain("bdm");

    // The BDM is on the workflow step (first tier) but below the facility's approving tier.
    await switchRole(page, "bdm", `/operations/item?id=${w.operationId}`);
    await decide(page, "Approve", "Trying to approve below my tier.");
    await expectToast(page, /Decision not recorded/);
    await expect(page.getByText(/Outside Credit Administration's delegated tolerance/).first()).toBeVisible();
    expect((await latestWaiver(page))!.status).toBe("Pending approval");
  });
});
