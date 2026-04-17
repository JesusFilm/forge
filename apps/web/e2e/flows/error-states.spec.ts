import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/error-states"

test.describe("Error States", () => {
  test("GraphQL connection error", async ({ page }) => {
    await page.route("**/graphql*", (route) => route.abort("connectionrefused"))
    await page.goto("/")
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `${screenshotDir}/graphql-error.png` })
  })

  test("missing credentials (401) shows friendly message", async ({ page }) => {
    await page.route("**/graphql*", (route) =>
      route.fulfill({
        status: 401,
        body: JSON.stringify({ error: "Unauthorized" }),
      }),
    )
    await page.goto("/")
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `${screenshotDir}/unauthorized.png` })
  })

  test("null blocks filtered from rendering", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const nullBlock = page.locator('[data-testid="null-block"]')
    expect(await nullBlock.count()).toBe(0)
    await page.screenshot({ path: `${screenshotDir}/null-blocks.png` })
  })

  test("missing video URL — section returns null", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/missing-video-url.png` })
  })

  test("invalid locale param falls back to DEFAULT_LOCALE", async ({
    page,
  }) => {
    await page.goto("/some-slug/xx-invalid-locale")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/invalid-locale.png` })
  })

  test("empty search results", async ({ page }) => {
    await page.goto("/search?q=xyznonexistentquery12345")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/empty-search.png` })
  })

  test("search rate limited (retryAfterSeconds)", async ({ page }) => {
    await page.route("**/graphql*", (route) =>
      route.fulfill({
        status: 429,
        body: JSON.stringify({
          errors: [
            { message: "Rate limited", extensions: { retryAfterSeconds: 5 } },
          ],
        }),
      }),
    )
    await page.goto("/search?q=test")
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${screenshotDir}/rate-limited.png` })
  })

  test("malformed search response", async ({ page }) => {
    await page.route("**/graphql*", (route) =>
      route.fulfill({ status: 200, body: "not json" }),
    )
    await page.goto("/search?q=test")
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${screenshotDir}/malformed-response.png` })
  })

  test("long query truncation", async ({ page }) => {
    const longQ = "a".repeat(250)
    await page.goto(`/search?q=${longQ}`)
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/long-query.png` })
  })

  test("special characters in search", async ({ page }) => {
    await page.goto('/search?q=<script>alert("xss")</script>')
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/special-chars.png` })
  })

  test("missing routeVideo context", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/missing-route-video.png` })
  })
})
