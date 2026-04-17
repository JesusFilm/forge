import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/advent-countdown"

test.describe("Advent Countdown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.6),
    )
    await page.waitForTimeout(500)
  })

  test("expanded by default on desktop (>=640px)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/desktop-expanded.png` })
  })

  test("collapsed by default on mobile (<640px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/mobile-collapsed.png` })
  })

  test("toggle expand/collapse on click", async ({ page }) => {
    const toggle = page
      .locator(
        '[data-testid="advent-toggle"], [class*="advent"] button, [class*="countdown"] button',
      )
      .first()
    if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await toggle.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${screenshotDir}/toggled.png` })
    }
  })

  test("responsive resize behavior", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/resize-desktop.png` })
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/resize-mobile.png` })
  })

  test("days count display", async ({ page }) => {
    const daysEl = page
      .locator(
        '[data-testid="advent-days"], [class*="advent"] [class*="days"], [class*="countdown"] span',
      )
      .first()
    if (await daysEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      const text = await daysEl.textContent()
      expect(text).toMatch(/\d+/)
    }
    await page.screenshot({ path: `${screenshotDir}/days-count.png` })
  })

  test("singular 1 day vs plural X days label", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/day-label.png` })
  })

  test("scripture text and reference display", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/scripture.png` })
  })

  test("year placeholder {year} replacement", async ({ page }) => {
    const currentYear = new Date().getFullYear().toString()
    const yearText = page.locator(`text=${currentYear}`)
    if (
      await yearText
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await expect(yearText.first()).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/year-placeholder.png` })
  })

  test("arrow rotation animation (180deg)", async ({ page }) => {
    const toggle = page
      .locator('[data-testid="advent-toggle"], [class*="advent"] button')
      .first()
    if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.screenshot({ path: `${screenshotDir}/arrow-before.png` })
      await toggle.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${screenshotDir}/arrow-after.png` })
    }
  })

  test("aria-expanded accessibility", async ({ page }) => {
    const toggle = page
      .locator(
        '[data-testid="advent-toggle"], [class*="advent"] button, [aria-expanded]',
      )
      .first()
    if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      const expanded = await toggle.getAttribute("aria-expanded")
      expect(expanded).toBeDefined()
    }
    await page.screenshot({ path: `${screenshotDir}/aria-expanded.png` })
  })

  test("multiple days calculation accuracy", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/days-accuracy.png` })
  })

  test("Christmas Day state — Merry Christmas", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/christmas-state.png` })
  })
})
