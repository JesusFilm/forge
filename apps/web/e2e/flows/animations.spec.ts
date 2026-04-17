import { test } from "@playwright/test"

const screenshotDir = "../screenshots/browser/animations"

test.describe("Animations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
  })

  test("search overlay fade in/out (0.2s)", async ({ page }) => {
    const searchToggle = page
      .locator('[data-testid="search-toggle"], header button')
      .first()
    if (await searchToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchToggle.click()
      await page.waitForTimeout(50)
      await page.screenshot({ path: `${screenshotDir}/overlay-fade-in.png` })
      await page.waitForTimeout(300)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(50)
      await page.screenshot({ path: `${screenshotDir}/overlay-fade-out.png` })
    }
  })

  test("card enter/exit animations (staggered delays)", async ({ page }) => {
    const searchToggle = page
      .locator('[data-testid="search-toggle"], header button')
      .first()
    if (await searchToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchToggle.click()
      await page.waitForTimeout(400)
      const input = page
        .locator(
          'input[type="search"], input[type="text"], input[placeholder*="earch"]',
        )
        .first()
      await input.fill("Jesus")
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${screenshotDir}/card-enter.png` })
    }
  })

  test("hover scale (1.02) on video cards", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    const card = page
      .locator('[class*="card"], [class*="video-card"], a[href*="/"]')
      .first()
    if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
      await card.hover()
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/hover-scale.png` })
  })

  test("image zoom 105% on hover (MediaCollection)", async ({ page }) => {
    const item = page
      .locator(
        '[data-testid="media-collection-item"], [class*="media-collection"] a',
      )
      .first()
    if (await item.isVisible({ timeout: 3000 }).catch(() => false)) {
      await item.hover()
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/image-zoom.png` })
  })

  test("arrow rotation (accordion)", async ({ page }) => {
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.7),
    )
    await page.waitForTimeout(500)
    const trigger = page
      .locator('[data-testid="accordion-trigger"], [class*="accordion"] button')
      .first()
    if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.screenshot({ path: `${screenshotDir}/arrow-collapsed.png` })
      await trigger.click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${screenshotDir}/arrow-expanded.png` })
    }
  })

  test("mesh gradient animation (quiz button)", async ({ page }) => {
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.5),
    )
    await page.waitForTimeout(500)
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.screenshot({ path: `${screenshotDir}/mesh-gradient-1.png` })
      await page.waitForTimeout(1000)
      await page.screenshot({ path: `${screenshotDir}/mesh-gradient-2.png` })
    }
  })

  test("accordion height animation", async ({ page }) => {
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.7),
    )
    await page.waitForTimeout(500)
    const trigger = page
      .locator('[data-testid="accordion-trigger"], [class*="accordion"] button')
      .first()
    if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await trigger.click()
      await page.waitForTimeout(100)
      await page.screenshot({ path: `${screenshotDir}/height-animating.png` })
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${screenshotDir}/height-done.png` })
    }
  })

  test("loading spinner rotation", async ({ page }) => {
    await page.route(
      "**/graphql*",
      (route) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(route.abort()), 5000),
        ),
    )
    await page.goto("/search?q=test")
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/spinner.png` })
  })
})
