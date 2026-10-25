import { defineConfig } from "@playwright/test"
// Starts the real portal with synthetic admission and a dedicated localhost DB.
export default defineConfig({
  testDir: "./tests",
  testMatch: "portal-usage.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "./output/usage-tests",
  use: {
    launchOptions: { executablePath: process.env.PORTAL_TEST_CHROMIUM },
    viewport: { width: 1280, height: 900 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
})
