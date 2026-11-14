import { expect, type Locator, type Page } from "@playwright/test";

const handled = new WeakSet<Page>();

/**
 * Saves and commands confirm with the library's ResultDialog (modal, `data-tone`). It hides the page from role queries
 * until closed, so close it automatically whenever it blocks the next action. Specs that check its text do so first.
 */
export async function closeResultDialogs(page: Page) {
  if (handled.has(page)) return;
  handled.add(page);
  const result = page.locator('dialog[open][data-tone], [role="dialog"][data-tone]');
  await page.addLocatorHandler(
    result,
    async (dialog) => {
      // Best effort: the popup may already be gone (navigation, test teardown).
      try {
        await copyAndClose(dialog);
      } catch {
        /* nothing to close */
      }
    },
    { noWaitAfter: true },
  );
}

/** Keeps the outcome text checkable after the popup closes (specs written for toasts assert it later), then closes it. */
async function copyAndClose(dialog: Locator) {
  await dialog.evaluate((el) => {
    let log = document.getElementById("e2e-result-log");
    if (!log) {
      log = document.createElement("div");
      log.id = "e2e-result-log";
      log.setAttribute("style", "position:fixed;left:0;bottom:0;width:4px;height:4px;overflow:hidden;opacity:0;pointer-events:none");
      document.body.appendChild(log);
    }
    const entry = document.createElement("p");
    entry.textContent = (el as HTMLElement).innerText;
    log.prepend(entry);
  });
  await dialog.press("Escape", { noWaitAfter: true });
}

/** Sign in through demo access for a role (fresh browser context = fresh demo data). */
export async function signInAs(page: Page, roleId: string, path = "/dashboard/") {
  await closeResultDialogs(page);
  const sep = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${sep}demoRole=${roleId}`);
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

/** Switch demo role in the same browser (keeps localStorage data, e.g. a request just submitted). */
export async function switchRole(page: Page, roleId: string, path: string) {
  const sep = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${sep}demoRole=${roleId}`);
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

/** Fill a 6-digit code into the library CodeInput (any code works in the demo). */
export async function enterCode(page: Page, code = "123456") {
  const first = page.getByRole("textbox").filter({ has: page.locator("[inputmode='numeric']") }).first();
  await (await first.count() ? first : page.locator("input[inputmode='numeric']").first()).click();
  await page.keyboard.type(code);
}
