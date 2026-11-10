import { expect, test as base } from "@playwright/test";

/** Platform specs fail on any uncaught page error (a crash during a demo is a bug even if the flow recovers). */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
      await use(errors);
      expect(errors, "uncaught page errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
