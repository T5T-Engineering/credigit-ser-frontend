import { expect, test } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { applicationStage, decide, decisionPanel, expectToast, facilityFor, findOperation, findOperationByPayload, selectDecision, switchRoleSamePerson } from "./credit-helpers";

test.describe("Credit administration → disbursement", () => {
  test("CP confirmed → release via Operations → Maker prepares → same person can't check → Checker authorises → Active / Booked @mobile", async ({ page }) => {
    test.slow();
    // Seeded APP-2026022: Fast-Track facility pending disbursement, one condition precedent still open, not released.
    const APP = "APP-2026022";
    await signInAs(page, "credit-admin-officer", "/credit-admin/");
    const fac = (await facilityFor(page, APP))!;
    expect(fac.status).toBe("Pending disbursement");
    const facUrl = `/credit-admin/facility/?id=${fac.id}`;
    await page.goto(facUrl);
    const release = page.getByRole("button", { name: "Release for disbursement" });
    await expect(release).toBeDisabled();
    await expect(page.getByText(/condition\(s\) precedent outstanding/)).toBeVisible();

    // Confirm the open CP on the Conditions tab.
    await page.getByRole("tab", { name: /Conditions precedent/ }).click();
    await page.getByRole("checkbox", { checked: false }).first().check({ force: true });
    await expect(page.getByText("All conditions precedent are cleared")).toBeVisible();

    // Release → Operations request (second-person confirmation).
    await release.click();
    await page.getByRole("dialog").getByRole("button", { name: "Request release" }).click();
    await expect(page.getByText(/Release requested — awaiting confirmation/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Release awaiting confirmation" })).toBeDisabled();
    const relOp = (await findOperation(page, fac.id, "credit-admin.release"))!;
    // The requester can't confirm their own release.
    await page.goto(`/operations/item?id=${relOp.id}`);
    await expect(page.getByText(/You requested this operation/)).toBeVisible();
    await expect(decisionPanel(page)).toHaveCount(0);
    await switchRole(page, "head-of-risk", `/operations/item?id=${relOp.id}`);
    await decide(page, "Approve", "All CPs evidenced on file; release.");
    await expectToast(page, /Decision recorded: Approved/);

    // Maker prepares the disbursement.
    await switchRole(page, "disbursement-maker", `/disbursement/?facility=${fac.id}`);
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText(/Released by/)).toBeVisible();
    await drawer.getByRole("button", { name: "Submit for authorisation" }).click();
    await expect(drawer.getByText(/prepared and sent to a Checker/)).toBeVisible();

    // The same person switching to the Checker role is blocked (no self-approval) — in the workspace and in Operations.
    await switchRoleSamePerson(page, "disbursement-checker", `/disbursement/?facility=${fac.id}`);
    await expect(page.getByRole("dialog").getByText(/You prepared it, so a different Checker must decide/)).toBeVisible();
    await expect(decisionPanel(page)).toHaveCount(0);
    const dsOp = (await findOperationByPayload(page, "disbursement.authorise", "facilityId", fac.id))!;
    expect(dsOp.status).toBe("Pending");
    await page.goto(`/operations/item?id=${dsOp.id}`);
    await expect(page.getByText(/You requested this operation/)).toBeVisible();

    // A different Checker authorises (below the step-up threshold). `?demoRole=` is a no-op when the role is
    // already active, so sign in as another person via an intermediate role.
    await switchRole(page, "cro", "/dashboard/");
    await switchRole(page, "disbursement-checker", `/disbursement/?facility=${fac.id}`);
    await expect(page.getByRole("button", { name: /Account menu: Ikhidie Nwachukwu/ })).toBeVisible();
    await decide(page, "Authorise", "Beneficiary and amount verified against the mandate.");
    await expect(page.getByRole("dialog").getByText(/Authorised — posted to the CBA/)).toBeVisible();
    await expect.poll(async () => (await facilityFor(page, APP))?.status).toBe("Active");
    expect(await applicationStage(page, APP)).toBe("Booked");
  });

  test("high-value disbursement needs Checker step-up; cancelling it records nothing", async ({ page }) => {
    test.slow();
    // Seeded APP-2026010: ₦3.66bn facility, released; a request was prepared before Operations existed.
    const APP = "APP-2026010";
    await signInAs(page, "disbursement-maker", "/disbursement/");
    const fac = (await facilityFor(page, APP))!;
    await page.goto(`/disbursement/?facility=${fac.id}`);
    const drawer = page.getByRole("dialog");
    const route = drawer.getByRole("button", { name: "Route to Operations" });
    const submit = drawer.getByRole("button", { name: "Submit for authorisation" });
    await expect(route.or(submit)).toBeVisible();
    await (await route.isVisible() ? route : submit).click();
    await expect(drawer.getByText(/sent to a Checker for authorisation/)).toBeVisible();

    await switchRole(page, "disbursement-checker", `/disbursement/?facility=${fac.id}`);
    // Cancel the step-up: nothing is recorded.
    const panel = decisionPanel(page);
    await selectDecision(page, "Authorise");
    await panel.getByRole("button", { name: /^Submit/ }).click();
    const dialog = page.getByRole("dialog", { name: /confirm it's you/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await facilityFor(page, APP))?.status).toBe("Pending disbursement");
    expect((await findOperationByPayload(page, "disbursement.authorise", "facilityId", fac.id))?.status).toBe("Pending");

    // Verify with a code and authorise.
    await decide(page, "Authorise", "Verified against the CBA mandate.", { stepUp: true });
    await expect(page.getByRole("dialog").getByText(/Authorised — posted to the CBA/)).toBeVisible();
    await expect.poll(async () => (await facilityFor(page, APP))?.status).toBe("Active");
    expect(await applicationStage(page, APP)).toBe("Booked");
  });
});
