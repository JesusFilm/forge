import { defineConfig, devices } from "@playwright/test"

const port = 3125
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      `PLAYWRIGHT_TEST=1 ` +
      `ADMIN_GRAPHQL_URL=http://127.0.0.1:3003/api/graphql ` +
      `WEB_ADMIN_API_KEYS=playwright-test-key ` +
      `REVALIDATION_SECRET=playwright-test-secret ` +
      `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/watch/demo-search/language-inventory-fixture`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
