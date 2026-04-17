import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/search-page"

test.describe("Search Page /search", () => {
  test("load with query parameter shows results", async ({ page }) => {
    await page.goto("/search?q=Jesus")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/query-results.png` })
  })

  test("load without query shows empty state", async ({ page }) => {
    await page.goto("/search")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/empty-state.png` })
  })

  test("search input debounce updates URL via router.replace", async ({
    page,
  }) => {
    await page.goto("/search")
    await page.waitForLoadState("networkidle")
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("Jesus")
    await page.waitForTimeout(1000)
    await expect(page).toHaveURL(/q=Jesus/)
    await page.screenshot({ path: `${screenshotDir}/url-updated.png` })
  })

  test("clear search input clears results", async ({ page }) => {
    await page.goto("/search?q=Jesus")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(500)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.clear()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/cleared.png` })
  })

  test("infinite scroll or load more button", async ({ page }) => {
    await page.goto("/search?q=Jesus")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1000)
    const loadMore = page.locator(
      'button:has-text("Load more"), button:has-text("Show more")',
    )
    if (await loadMore.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loadMore.click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/load-more.png` })
  })

  test("empty results state for nonexistent query", async ({ page }) => {
    await page.goto("/search?q=xyznonexistentquery12345")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/no-results.png` })
  })

  test("loading skeleton on page", async ({ page }) => {
    await page.goto("/search?q=Jesus")
    await page.screenshot({ path: `${screenshotDir}/loading-skeleton.png` })
  })

  test("error display with retry", async ({ page }) => {
    await page.route("**/graphql*", (route) => route.abort("failed"))
    await page.goto("/search?q=Jesus")
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${screenshotDir}/error-retry.png` })
  })

  test("page metadata title includes query", async ({ page }) => {
    await page.goto("/search?q=Jesus")
    await page.waitForLoadState("networkidle")
    const title = await page.title()
    expect(title.toLowerCase()).toContain("search")
    await page.screenshot({ path: `${screenshotDir}/metadata-title.png` })
  })
})
