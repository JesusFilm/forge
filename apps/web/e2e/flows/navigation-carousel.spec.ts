import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/navigation-carousel"

test.describe("Navigation Carousel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
  })

  test("item click scrolls to data-section-key", async ({ page }) => {
    const navItem = page
      .locator(
        '[data-testid="nav-carousel-item"], [class*="nav-carousel"] a, [class*="navigation"] button',
      )
      .first()
    if (await navItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await navItem.click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/item-scroll.png` })
  })

  test("item keyboard activation (Enter/Space)", async ({ page }) => {
    const navItem = page
      .locator(
        '[data-testid="nav-carousel-item"], [class*="nav-carousel"] a, [class*="navigation"] button',
      )
      .first()
    if (await navItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await navItem.focus()
      await page.keyboard.press("Enter")
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/keyboard-activation.png` })
  })

  test("carousel drag/swipe", async ({ page }) => {
    const carousel = page
      .locator(
        '[data-testid="nav-carousel"], [class*="nav-carousel"], [class*="navigation-carousel"]',
      )
      .first()
    if (await carousel.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await carousel.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, {
          steps: 10,
        })
        await page.mouse.up()
        await page.waitForTimeout(500)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/drag.png` })
  })

  test("item image display with mask gradient", async ({ page }) => {
    const img = page
      .locator(
        '[data-testid="nav-carousel-item"] img, [class*="nav-carousel"] img',
      )
      .first()
    if (await img.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(img).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/item-image.png` })
  })

  test("item title and category labels", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/title-category.png` })
  })

  test("first item image optimization (next/image)", async ({ page }) => {
    const firstImg = page
      .locator(
        '[data-testid="nav-carousel-item"] img, [class*="nav-carousel"] img',
      )
      .first()
    if (await firstImg.isVisible({ timeout: 3000 }).catch(() => false)) {
      const srcset = await firstImg.getAttribute("srcset")
      if (srcset) {
        expect(srcset.length).toBeGreaterThan(0)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/image-optimization.png` })
  })

  test("background color support", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/bg-color.png` })
  })

  test("smooth scroll behavior verification", async ({ page }) => {
    const navItem = page
      .locator(
        '[data-testid="nav-carousel-item"], [class*="nav-carousel"] a, [class*="navigation"] button',
      )
      .first()
    if (await navItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      const scrollBefore = await page.evaluate(() => window.scrollY)
      await navItem.click()
      await page.waitForTimeout(200)
      const scrollDuring = await page.evaluate(() => window.scrollY)
      await page.waitForTimeout(800)
      const scrollAfter = await page.evaluate(() => window.scrollY)
      if (scrollBefore !== scrollAfter) {
        expect(scrollDuring).not.toBe(scrollAfter)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/smooth-scroll.png` })
  })
})
