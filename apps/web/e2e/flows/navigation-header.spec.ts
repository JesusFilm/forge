import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/navigation-header"

test.describe("Navigation & Header", () => {
  test("logo click navigates to home", async ({ page }) => {
    await page.goto("/search")
    await page.waitForLoadState("networkidle")
    const logo = page.locator('header a[href="/"]').first()
    await logo.click()
    await expect(page).toHaveURL("/")
    await page.screenshot({ path: `${screenshotDir}/logo-home.png` })
  })

  test("search toggle opens overlay with animation", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const searchToggle = page
      .locator('[data-testid="search-toggle"]')
      .or(page.locator('button:has([data-testid="search-icon"])'))
    await searchToggle.first().click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/search-overlay-open.png` })
  })

  test("search overlay closes via X button", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const searchToggle = page
      .locator('[data-testid="search-toggle"]')
      .or(page.locator("header button").first())
    await searchToggle.first().click()
    await page.waitForTimeout(300)
    const closeButton = page
      .locator('[data-testid="search-close"]')
      .or(page.locator('[aria-label="Close search"]'))
    await closeButton.first().click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/overlay-closed-x.png` })
  })

  test("search overlay closes via Escape key", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const searchToggle = page
      .locator('[data-testid="search-toggle"]')
      .or(page.locator("header button").first())
    await searchToggle.first().click()
    await page.waitForTimeout(300)
    await page.keyboard.press("Escape")
    await page.waitForTimeout(300)
    await page.screenshot({
      path: `${screenshotDir}/overlay-closed-escape.png`,
    })
  })
})
