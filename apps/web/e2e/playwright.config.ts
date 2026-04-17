import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.BASE_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./flows",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PW_SKIP_WEBSERVER
    ? undefined
    : {
        command: "pnpm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 30_000,
      },
})
