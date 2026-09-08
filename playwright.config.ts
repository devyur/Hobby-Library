import { defineConfig, devices } from "@playwright/test";

// End-to-end browser tests, separate from the Vitest unit/component suite
// (`npm run test`). Use this for flows that need a real browser — auth
// forms, redirects, cookies — where driving Server Actions via raw HTTP
// requests is unreliable (see issue #9's QA history).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
