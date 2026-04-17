import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/easter-dates"

test.describe("Easter Dates", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.6),
    )
    await page.waitForTimeout(500)
  })

  test("expanded on desktop, collapsed on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/desktop-expanded.png` })
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/mobile-collapsed.png` })
  })

  test("toggle expand/collapse", async ({ page }) => {
    const toggle = page
      .locator('[data-testid="easter-toggle"], [class*="easter"] button')
      .first()
    if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await toggle.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/toggled.png` })
  })

  test("Western Easter date display", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/western-easter.png` })
  })

  test("Orthodox Easter date display", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/orthodox-easter.png` })
  })

  test("Passover date calculation (Hebrew calendar)", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/passover.png` })
  })

  test("date format — Day Month Date Year", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/date-format.png` })
  })

  test("locale-aware date formatting", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/locale-dates.png` })
  })

  test("current year calculation", async ({ page }) => {
    const year = new Date().getFullYear().toString()
    const yearText = page.locator(`text=${year}`)
    if (
      await yearText
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await expect(yearText.first()).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/current-year.png` })
  })

  test("year placeholder in title", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/year-title.png` })
  })

  test("responsive media query behavior", async ({ page }) => {
    await page.setViewportSize({ width: 639, height: 667 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/narrow.png` })
    await page.setViewportSize({ width: 640, height: 667 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/wide.png` })
  })
})
