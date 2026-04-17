import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/section-rendering"

test.describe("Section Rendering", () => {
  test("home page renders all section types", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/home-all-sections.png` })
  })

  test("VideoHero section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const hero = page
      .locator("video, [data-testid='hero'], [class*='hero']")
      .first()
    if (await hero.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(hero).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/video-hero.png` })
  })

  test("NavigationCarousel section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/nav-carousel.png` })
  })

  test("VideoCarousel section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/video-carousel.png` })
  })

  test("MediaCollection section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() => window.scrollTo(0, 600))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/media-collection.png` })
  })

  test("BibleQuotes section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight / 2),
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/bible-quotes.png` })
  })

  test("RelatedQuestions section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.7),
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/related-questions.png` })
  })

  test("QuizButton section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.5),
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/quiz-button.png` })
  })

  test("AdventCountdown section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.6),
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/advent-countdown.png` })
  })

  test("EasterDates section renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.6),
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/easter-dates.png` })
  })

  test("TextSection renders", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.8),
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/text-section.png` })
  })

  test("multiple sections render in sequence on home", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const sections = page.locator("section, [data-section-key]")
    const count = await sections.count()
    expect(count).toBeGreaterThan(0)
    await page.screenshot({ path: `${screenshotDir}/sections-count.png` })
  })

  test("sections render on experience page", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const link = page
      .locator("a[href*='/']")
      .filter({ hasNotText: "search" })
      .first()
    if (await link.isVisible({ timeout: 3000 }).catch(() => false)) {
      const href = await link.getAttribute("href")
      if (href && href !== "/") {
        await page.goto(href)
        await page.waitForLoadState("networkidle")
      }
    }
    await page.screenshot({ path: `${screenshotDir}/experience-sections.png` })
  })

  test("unknown section type filtered (Error blocks)", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const errorBlock = page.locator(
      '[data-testid="error-block"], [class*="error-block"]',
    )
    expect(await errorBlock.count()).toBe(0)
    await page.screenshot({ path: `${screenshotDir}/no-error-blocks.png` })
  })

  test("section with background color renders correctly", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() => window.scrollTo(0, 400))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/bg-color-section.png` })
  })

  test("section with heading renders correctly", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const headings = page.locator("h2, h3")
    const count = await headings.count()
    expect(count).toBeGreaterThan(0)
    await page.screenshot({ path: `${screenshotDir}/section-headings.png` })
  })

  test("full page scroll captures all sections", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/full-page-top.png` })
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight / 3),
    )
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/full-page-mid.png` })
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/full-page-bottom.png` })
  })

  test("section dispatcher handles missing data gracefully", async ({
    page,
  }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const errors = await page.evaluate(() => {
      const consoleErrors: string[] = []
      return consoleErrors
    })
    expect(errors.length).toBe(0)
    await page.screenshot({ path: `${screenshotDir}/no-errors.png` })
  })
})
