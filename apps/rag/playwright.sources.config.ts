import { defineConfig } from "@playwright/test"

// Starts an isolated HTTP server with synthetic admission; no DB or credentials.
export default defineConfig({
  testDir: "./tests",
  testMatch: "portal-sources.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "./output/sources-tests",
  use: {
    launchOptions: { executablePath: process.env.PORTAL_TEST_CHROMIUM },
    viewport: { width: 1536, height: 1024 },
    trace: "off",
    screenshot: "off",
    video: "off",
    extraHTTPHeaders: { Cookie: "__Host-rag_portal=synthetic-sources-test" },
  },
})
