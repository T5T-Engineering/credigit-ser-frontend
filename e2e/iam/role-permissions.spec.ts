import { expect, test } from "../platform/fixtures";
import { signInAs, switchRole } from "../helpers";
import { NAV, decide, latestOperationId } from "../platform/auth-helpers";

test("Role permission change goes through Operations and applies after a second person approves", async ({ page }) => {
  test.setTimeout(150_000);
  await signInAs(page, "system-admin", "/admin/permissions/?role=credit-analyst");
  await expect(page.getByRole("combobox", { name: "Role" })).toHaveValue("credit-analyst", NAV);

  await page.getByPlaceholder(/search by name, key or module/i).fill("ai.console.view");
  const cell = page.getByRole("checkbox", { name: /^Credit Analyst: View AI query console/ });
  await expect(cell).not.toBeChecked();
  await cell.check();
  await page.getByRole("button", { name: /request change \(1\)/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Analysts run ad-hoc portfolio queries for the MIS pack.");
  await dialog.getByRole("button", { name: /send for approval/i }).click();
  await expect(page.getByText(/sent for approval/i).first()).toBeVisible();

  // Not applied yet: the requester can't approve their own change.
  const id = await latestOperationId(page, "role.permissions-change");
  await page.goto(`/operations/item/?id=${id}`);
  await expect(page.getByText(/someone else must decide/i)).toBeVisible(NAV);

  // CRO (an eligible second person) approves.
  await switchRole(page, "cro", "/dashboard/");
  await decide(page, id, "Approve");
  await expect(page.getByText(/approved/i).first()).toBeVisible();

  // The Credit Analyst now has the AI console.
  await switchRole(page, "credit-analyst", "/ai/");
  await expect(page.getByText(/you don't have access to this/i)).toHaveCount(0, NAV);
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByText("AI analytics", { exact: true }).first()).toBeVisible();
  const iam = await page.evaluate(() => JSON.parse(localStorage.getItem("credigit.ser.iam") ?? "{}").state?.overrides?.["credit-analyst"]);
  expect(iam.grant).toContain("ai.console.view");
});
