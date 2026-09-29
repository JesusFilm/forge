import { defineConfig } from "@playwright/test"

// Requires portal:dev and its dedicated local database. Never target production.
export default defineConfig({
  testDir: "./tests",
  testMatch: "portal-*.e2e.ts",
  testIgnore: ["portal-sources.e2e.ts", "portal-usage.e2e.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "./output/portal-tests",
  use: {
    launchOptions: { executablePath: process.env.PORTAL_TEST_CHROMIUM },
    baseURL: "https://localhost:3445",
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    // Issuance responses must never enter trace, screenshot or video artifacts.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
})
