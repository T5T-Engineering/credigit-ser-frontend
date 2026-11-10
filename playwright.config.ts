import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the production static build (`out/`), the same files Netlify serves.
 * Uses the system Microsoft Edge (`channel: "msedge"`) so no browser download is needed; on CI without Edge,
 * set E2E_CHANNEL=chromium after `npx playwright install chromium`.
 *   npm run build && npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 4700);
/** Point at a running server instead (e.g. the dev server: E2E_BASE_URL=http://localhost:3100). */
const EXTERNAL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: EXTERNAL ?? `http://localhost:${PORT}`,
    channel: process.env.E2E_CHANNEL ?? "msedge",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Edge"], channel: process.env.E2E_CHANNEL ?? "msedge" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: process.env.E2E_CHANNEL ?? "msedge" }, grep: /@mobile/ },
  ],
  webServer: EXTERNAL
    ? undefined
    : {
    command: `npx serve out -l ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}/login/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
