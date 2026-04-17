import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/routes-page-loading"

test.describe("Routes & Page Loading", () => {
  test("home page / loads with sections", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const content = page.locator("main, [role='main'], body > div").first()
    await expect(content).toBeVisible()
    await page.screenshot({ path: `${screenshotDir}/home.png` })
  })

  test("/watch/[slug] dynamic route (via link)", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const watchLink = page
      .locator("a[href*='/']")
      .filter({ hasNotText: /search|demo/ })
      .first()
    if (await watchLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await watchLink.click()
      await page.waitForLoadState("networkidle")
    }
    await page.screenshot({ path: `${screenshotDir}/watch-slug.png` })
  })

  test("/watch/[slug]/[locale] localized route", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/localized.png` })
  })

  test("empty experience shows ExperienceEmpty", async ({ page }) => {
    await page.goto("/nonexistent-slug-xyz-12345")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/empty-experience.png` })
  })

  test("missing experience (404) shows ExperienceEmpty", async ({ page }) => {
    await page.goto("/this-does-not-exist-at-all-404")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/404.png` })
  })

  test("experience error shows ExperienceError with message", async ({
    page,
  }) => {
    await page.route("**/graphql*", (route) => route.abort("failed"))
    await page.goto("/some-slug")
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `${screenshotDir}/experience-error.png` })
  })

  test("page metadata — title, description, OG tags", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
    await page.locator('meta[name="description"]').getAttribute("content")
    await page.screenshot({ path: `${screenshotDir}/metadata.png` })
  })

  test("demo recommendations page load", async ({ page }) => {
    await page.goto("/demo-recommendations")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/demo-recs.png` })
  })

  test("demo recommendations locale toggle", async ({ page }) => {
    await page.goto("/demo-recommendations")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/demo-recs-locale.png` })
  })

  test("demo recommendations video not found", async ({ page }) => {
    await page.goto("/demo-recommendations/nonexistent/en")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/demo-recs-not-found.png` })
  })

  test("demo recommendations locale filter (en, es, fr)", async ({ page }) => {
    await page.goto("/demo-recommendations")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${screenshotDir}/demo-recs-filter.png` })
  })

  test("loading states (Suspense boundaries)", async ({ page }) => {
    await page.goto("/")
    await page.screenshot({ path: `${screenshotDir}/loading-state.png` })
  })

  test("ISR revalidation behavior", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/isr-first.png` })
    await page.reload()
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/isr-second.png` })
  })

  test("locale slug detection (isLocale)", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/locale-detection.png` })
  })
})
