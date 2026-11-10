import { expect, type Locator, type Page } from "@playwright/test";
import { enterCode } from "../helpers";

/** The library DecisionPanel (a form whose legend starts "Your decision"). */
export function decisionPanel(page: Page): Locator {
  return page.locator("form").filter({ has: page.getByRole("radiogroup", { name: "Decision" }) }).first();
}

/**
 * Pick a decision, comment and submit in the DecisionPanel. When `stepUp` is set, the StepUpAuthDialog must
 * open and is completed with a 6-digit code (any code works in the demo).
 */
export async function decide(page: Page, action: string | RegExp, comment: string, opts: { stepUp?: boolean } = {}) {
  const panel = decisionPanel(page);
  await expect(panel).toBeVisible();
  await selectDecision(page, action);
  await panel.getByLabel("Comment").fill(comment);
  await panel.getByRole("button", { name: /^Submit/ }).click();
  if (opts.stepUp) {
    const dialog = page.getByRole("dialog", { name: /confirm it's you/i });
    await expect(dialog).toBeVisible();
    await enterCode(page);
    await expect(dialog).toBeHidden();
  }
}

/** Choose an action in the DecisionPanel by clicking its visible pill label (the radio input itself is sr-only). */
export async function selectDecision(page: Page, action: string | RegExp) {
  const panel = decisionPanel(page);
  const radio = panel.getByRole("radio", { name: action });
  await panel.getByRole("radiogroup", { name: "Decision" }).locator("label").filter({ has: page.getByRole("radio", { name: action }) }).click();
  await expect(radio).toBeChecked();
}

/**
 * Assert the page doesn't scroll sideways (phones). On failure, names the deepest elements whose removal
 * narrows the document — usually an absolutely positioned (e.g. sr-only) node escaping an overflow clip.
 */
export async function expectNoHorizontalOverflow(page: Page, opts: { soft?: boolean } = {}) {
  const culprits = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth + 1) return [] as string[];
    const base = doc.scrollWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *")).reverse()) {
      if (el.getBoundingClientRect().right <= doc.clientWidth + 1 || getComputedStyle(el).position === "fixed") continue;
      const prev = el.style.display;
      el.style.display = "none";
      const now = doc.scrollWidth;
      el.style.display = prev;
      if (now < base) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} "${(el.textContent ?? "").trim().slice(0, 40)}" (${base}→${now}px)`);
      if (out.length >= 5) break;
    }
    return out.length ? out : [`document ${base}px > viewport ${doc.clientWidth}px`];
  });
  (opts.soft ? expect.soft : expect)(culprits, "page overflows horizontally").toEqual([]);
}

/** Wait for a toast with the given title. */
export async function expectToast(page: Page, title: string | RegExp) {
  await expect(page.getByText(title).first()).toBeVisible();
}

/** Read an operation instance (by subject id + type prefix) from the persisted Operations store. */
export async function findOperation(page: Page, subjectId: string, typePrefix: string) {
  return page.evaluate(
    ([sid, prefix]) => {
      const raw = JSON.parse(localStorage.getItem("credigit.ser.operations") ?? "{}");
      const list = (raw.state?.instances ?? []) as { id: string; operationType: string; subject: { id: string }; status: string; stepIndex: number; awaitingAdjudication?: boolean; requestedBy: { id: string } }[];
      return list.find((i) => i.subject.id === sid && i.operationType.startsWith(prefix)) ?? null;
    },
    [subjectId, typePrefix] as const,
  );
}

/** Latest operation of a type whose payload matches `key = value`. */
export async function findOperationByPayload(page: Page, type: string, key: string, value: string) {
  return page.evaluate(
    ([t, k, v]) => {
      const raw = JSON.parse(localStorage.getItem("credigit.ser.operations") ?? "{}");
      const list = (raw.state?.instances ?? []) as { id: string; operationType: string; payload: Record<string, unknown>; status: string }[];
      return list.find((i) => i.operationType === t && i.payload?.[k] === v) ?? null;
    },
    [type, key, value] as const,
  );
}

type Facility = { id: string; status: string; outstanding: number; approvedAmount: number };

/** Facility booked from an application (Risk Data Spine in localStorage). */
export async function facilityFor(page: Page, appId: string): Promise<Facility | null> {
  return page.evaluate((a) => {
    const st = JSON.parse(localStorage.getItem("credigit.ser.demo-data") ?? "{}").state ?? {};
    return ((st.facilities ?? []) as (Facility & { applicationId?: string })[]).find((f) => f.applicationId === a) ?? null;
  }, appId);
}

export async function applicationStage(page: Page, appId: string): Promise<string | undefined> {
  return page.evaluate((a) => {
    const st = JSON.parse(localStorage.getItem("credigit.ser.demo-data") ?? "{}").state ?? {};
    return ((st.applications ?? []) as { id: string; stage: string }[]).find((x) => x.id === a)?.stage;
  }, appId);
}

/**
 * Switch role the way the user menu does: the same person keeps their identity and takes another role
 * (used to prove no-self-approval). Then opens `path`.
 */
export async function switchRoleSamePerson(page: Page, roleId: string, path: string) {
  await page.evaluate((r) => {
    const raw = JSON.parse(sessionStorage.getItem("credigit.ser.session") ?? "{}");
    raw.state.roleId = r;
    sessionStorage.setItem("credigit.ser.session", JSON.stringify(raw));
  }, roleId);
  await page.goto(path);
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

/**
 * Click, falling back to a DOM click when the page is wider than a phone viewport (the zoomed layout makes
 * Playwright's pointer hit-test miss). The overflow itself is asserted separately with expectNoHorizontalOverflow.
 */
export async function clickOrDispatch(target: Locator) {
  try {
    await target.click({ timeout: 5_000 });
  } catch {
    await target.dispatchEvent("click");
  }
}
