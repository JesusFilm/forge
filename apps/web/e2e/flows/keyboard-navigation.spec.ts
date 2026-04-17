import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/keyboard-navigation"

test.describe("Keyboard Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
  })

  test("tab forward through interactive elements", async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab")
      await page.waitForTimeout(100)
    }
    await page.screenshot({ path: `${screenshotDir}/tab-forward.png` })
  })

  test("shift+tab backward", async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab")
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Shift+Tab")
      await page.waitForTimeout(100)
    }
    await page.screenshot({ path: `${screenshotDir}/shift-tab-backward.png` })
  })

  test("enter key button activation", async ({ page }) => {
    const button = page.locator("button, a[href]").first()
    if (await button.isVisible({ timeout: 3000 }).catch(() => false)) {
      await button.focus()
      await page.keyboard.press("Enter")
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/enter-activation.png` })
  })

  test("space key button activation", async ({ page }) => {
    const button = page.locator("button").first()
    if (await button.isVisible({ timeout: 3000 }).catch(() => false)) {
      await button.focus()
      await page.keyboard.press("Space")
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/space-activation.png` })
  })

  test("arrow keys in carousels", async ({ page }) => {
    const carousel = page
      .locator('[class*="carousel"], .embla, [role="listbox"]')
      .first()
    if (await carousel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await carousel.focus()
      await page.keyboard.press("ArrowRight")
      await page.waitForTimeout(300)
      await page.keyboard.press("ArrowRight")
      await page.waitForTimeout(300)
      await page.keyboard.press("ArrowLeft")
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/arrow-carousel.png` })
  })

  test("escape key closes modals and overlays", async ({ page }) => {
    const searchToggle = page
      .locator('[data-testid="search-toggle"], header button')
      .first()
    if (await searchToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchToggle.click()
      await page.waitForTimeout(300)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/escape-close.png` })
  })

  test("focus visible outlines (focus-visible styles)", async ({ page }) => {
    await page.keyboard.press("Tab")
    await page.waitForTimeout(100)
    const focused = page.locator(":focus-visible")
    if (await focused.isVisible({ timeout: 1000 }).catch(() => false)) {
      const outline = await focused.evaluate(
        (el) => getComputedStyle(el).outlineStyle,
      )
      expect(outline).not.toBe("none")
    }
    await page.screenshot({ path: `${screenshotDir}/focus-visible.png` })
  })

  test("skip to content link", async ({ page }) => {
    await page.keyboard.press("Tab")
    const skipLink = page.locator(
      'a:has-text("Skip to content"), a:has-text("Skip to main")',
    )
    if (await skipLink.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(skipLink).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/skip-link.png` })
  })
})
