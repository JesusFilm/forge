import { defineConfig } from "@playwright/test"

// Production server + synthetic Admin are started separately so this test can
// never silently use the default dev server. See the manifest freshness runbook.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "watch-manifest-document-status.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
})
