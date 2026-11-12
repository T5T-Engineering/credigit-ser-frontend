import { expect, test, type Page } from "@playwright/test";
import { signInAs, switchRole } from "../helpers";
import { decide, watchErrors } from "../risk/ops";

/**
 * Operations user scope and atomic apply (docs/modules/operations: OPS-FR-16, OPS-FR-17, OPS-FR-18).
 * Requests and notifications are seeded into the browser stores so each rule is tested in isolation.
 */

type SeedUser = { id: string; roleId: string; name: string; status: string };

async function users(page: Page): Promise<SeedUser[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("credigit.ser.demo-data") ?? "{}").state?.users ?? []);
}

/** Add an operation instance to the persisted Operations store, then reload so the app rehydrates it. */
async function seedOperation(page: Page, instance: Record<string, unknown>) {
  await page.evaluate((inst) => {
    const raw = JSON.parse(localStorage.getItem("credigit.ser.operations") ?? "null") ?? { state: { definitions: {}, instances: [] }, version: 0 };
    raw.state.instances = [inst, ...(raw.state.instances ?? [])];
    localStorage.setItem("credigit.ser.operations", JSON.stringify(raw));
  }, instance);
}

function instance(id: string, type: string, title: string, requester: SeedUser, payload: unknown, steps: unknown[]) {
  const now = new Date().toISOString();
  return {
    id,
    operationType: type,
    definitionVersion: 1,
    title,
    subject: { type: "E2E", id, title },
    payload,
    summary: [],
    steps,
    requestedBy: { id: requester.id, name: requester.name, roleId: requester.roleId },
    requestedAt: now,
    status: "Pending",
    stepIndex: 0,
    decisions: [],
    stepStartedAt: now,
  };
}

const reviewStep = { id: "review", name: "Head of Risk review", approverRoles: ["head-of-risk"], mode: "any", slaHours: 48 };

test("an operation item is visible only to its requester, approvers and oversight (OPS-FR-16)", async ({ page }) => {
  const watch = watchErrors(page);
  await signInAs(page, "cro", "/operations/");
  const cro = (await users(page)).find((u) => u.roleId === "cro")!;
  const title = "E2E scoped request — sector review";
  await seedOperation(page, instance("OPS-E2ESCOPE", "rule.change", title, cro, { key: "operations.minCommentLength", value: 12, reason: "Scope test" }, [reviewStep]));

  // A role with no part in the request is refused, not shown the payload.
  await switchRole(page, "account-officer", "/operations/item/?id=OPS-E2ESCOPE");
  await expect(page.getByText("You don't have access to this operation")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: title })).toHaveCount(0);

  // The approver role on the route sees it.
  await switchRole(page, "head-of-risk", "/operations/item/?id=OPS-E2ESCOPE");
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: title }).first()).toBeVisible();

  // The requester sees it.
  await switchRole(page, "cro", "/operations/item/?id=OPS-E2ESCOPE");
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: title }).first()).toBeVisible();
  watch.assertClean();
});

test("a failing apply leaves the request Failed, not Approved, and tells the requester (OPS-FR-17)", async ({ page }) => {
  // The broken payload makes the workflow.change apply throw on purpose.
  const watch = watchErrors(page, [/Cannot read properties of undefined/i]);
  await signInAs(page, "cro", "/operations/");
  const cro = (await users(page)).find((u) => u.roleId === "cro")!;
  const title = "E2E broken workflow change";
  await seedOperation(page, instance("OPS-E2EFAIL", "workflow.change", title, cro, { operationType: "e2e.none", name: "Broken", enabled: true, version: 2 }, [reviewStep]));

  await switchRole(page, "head-of-risk", "/operations/item/?id=OPS-E2EFAIL");
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: title }).first()).toBeVisible();
  await decide(page, "Approve");
  await expect(page.getByText("Failed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/applying the change failed/i).first()).toBeVisible();
  const status = await page.evaluate(() => JSON.parse(localStorage.getItem("credigit.ser.operations") ?? "{}").state.instances.find((i: { id: string }) => i.id === "OPS-E2EFAIL")?.status);
  expect(status).toBe("Failed");

  // The requester is told personally.
  await switchRole(page, "cro", "/dashboard/");
  await page.getByRole("button", { name: /^notifications/i }).first().click();
  await expect(page.getByText(/approved request could not be applied/i).first()).toBeVisible();
  watch.assertClean();
});

test("personal notifications reach only their addressee; role broadcasts reach the role (OPS-FR-18)", async ({ page }) => {
  const watch = watchErrors(page);
  await signInAs(page, "account-officer", "/dashboard/");
  const all = await users(page);
  const me = all.find((u) => u.roleId === "account-officer")!;
  const colleague = all.find((u) => u.roleId === "account-officer" && u.id !== me.id && u.status === "Active")!;
  await page.evaluate(
    ({ meId, otherId }) => {
      const raw = JSON.parse(localStorage.getItem("credigit.ser.demo-data")!);
      const at = new Date().toISOString();
      const n = (id: string, title: string, extra: Record<string, unknown>) => ({ id, title, body: title, tone: "info", createdAt: at, read: false, roleIds: [], ...extra });
      raw.state.notifications = [
        n("NTF-E2E-MINE", "E2E personal for me", { userIds: [meId] }),
        n("NTF-E2E-OTHER", "E2E personal for my colleague", { userIds: [otherId] }),
        n("NTF-E2E-ROLE", "E2E role broadcast", { roleIds: ["account-officer"] }),
        ...raw.state.notifications,
      ];
      localStorage.setItem("credigit.ser.demo-data", JSON.stringify(raw));
    },
    { meId: me.id, otherId: colleague.id },
  );
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  await page.getByRole("button", { name: /^notifications/i }).first().click();
  await expect(page.getByText("E2E personal for me").first()).toBeVisible();
  await expect(page.getByText("E2E role broadcast").first()).toBeVisible();
  await expect(page.getByText("E2E personal for my colleague")).toHaveCount(0);
  watch.assertClean();
});
