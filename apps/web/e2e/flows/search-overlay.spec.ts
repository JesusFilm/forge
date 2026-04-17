import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/search-overlay"

test.describe("Search Overlay", () => {
  async function openSearchOverlay(page: import("@playwright/test").Page) {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const searchToggle = page
      .locator('[data-testid="search-toggle"]')
      .or(page.locator("header button").first())
    await searchToggle.first().click()
    await page.waitForTimeout(400)
  }

  test("empty overlay initial state — input focused, no results", async ({
    page,
  }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await expect(input).toBeFocused()
    await page.screenshot({ path: `${screenshotDir}/empty-initial.png` })
  })

  test("type query with debounce — results load", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("Jesus")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/query-results.png` })
  })

  test("loading skeleton display after delay", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("test query")
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${screenshotDir}/loading-skeleton.png` })
  })

  test("rapid query changes — only latest result shown", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("first")
    await page.waitForTimeout(100)
    await input.fill("second")
    await page.waitForTimeout(100)
    await input.fill("Jesus")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/rapid-query-latest.png` })
  })

  test("search results animate in with staggered animation", async ({
    page,
  }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("Jesus")
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${screenshotDir}/staggered-animation.png` })
  })

  test("no results state", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("xyznonexistentquery12345")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/no-results.png` })
  })

  test("search error state with Retry button", async ({ page }) => {
    await page.route("**/graphql*", (route) => route.abort("failed"))
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("test")
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${screenshotDir}/error-retry.png` })
  })

  test("load more results (pagination)", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("Jesus")
    await page.waitForTimeout(1500)
    const loadMore = page.locator(
      'button:has-text("Load more"), button:has-text("Show more"), button:has-text("More")',
    )
    if (await loadMore.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loadMore.click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/load-more.png` })
  })

  test("load more error + retry", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("Jesus")
    await page.waitForTimeout(1500)
    await page.route("**/graphql*", (route) => route.abort("failed"))
    const loadMore = page.locator(
      'button:has-text("Load more"), button:has-text("Show more"), button:has-text("More")',
    )
    if (await loadMore.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loadMore.click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/load-more-error.png` })
  })

  test("click result card navigates to watch page", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill("Jesus")
    await page.waitForTimeout(1500)
    const resultCard = page
      .locator('[data-testid="search-result"]')
      .or(page.locator('a[href*="/"]').filter({ hasText: /.+/ }))
    if (
      await resultCard
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false)
    ) {
      await resultCard.first().click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/result-navigate.png` })
  })

  test("tab focus trap (forward and backward wrap)", async ({ page }) => {
    await openSearchOverlay(page)
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab")
    }
    await page.screenshot({ path: `${screenshotDir}/focus-trap-forward.png` })
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab")
    }
    await page.screenshot({ path: `${screenshotDir}/focus-trap-backward.png` })
  })

  test("body scroll lock while overlay open", async ({ page }) => {
    await openSearchOverlay(page)
    const scrollY = await page.evaluate(() => {
      window.scrollTo(0, 100)
      return window.scrollY
    })
    expect(scrollY).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `${screenshotDir}/scroll-lock.png` })
  })

  test("long query truncation (200 char limit)", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    const longQuery = "a".repeat(250)
    await input.fill(longQuery)
    await page.waitForTimeout(500)
    const value = await input.inputValue()
    expect(value.length).toBeLessThanOrEqual(200)
    await page.screenshot({ path: `${screenshotDir}/long-query.png` })
  })

  test("special characters in search query", async ({ page }) => {
    await openSearchOverlay(page)
    const input = page
      .locator(
        'input[type="search"], input[type="text"], input[placeholder*="earch"]',
      )
      .first()
    await input.fill('<script>alert("xss")</script>')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/special-chars.png` })
  })
})
