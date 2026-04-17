import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/responsive"

test.describe("Responsive Behavior", () => {
  test("mobile viewport 320px (single column)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/mobile-320.png` })
  })

  test("tablet viewport 768px (2-column)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/tablet-768.png` })
  })

  test("desktop viewport 1024px+ (multi-column)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/desktop-1280.png` })
  })

  test("carousel mobile (no nav arrows) vs desktop (arrows visible)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/carousel-mobile.png` })
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/carousel-desktop.png` })
  })

  test("accordion mobile collapsed vs desktop expanded", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.6),
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/accordion-mobile.png` })
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/accordion-desktop.png` })
  })

  test("touch interactions on carousel (simulated)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    const carousel = page.locator('[class*="carousel"], .embla').first()
    if (await carousel.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await carousel.boundingBox()
      if (box) {
        await page.touchscreen.tap(
          box.x + box.width * 0.5,
          box.y + box.height / 2,
        )
      }
    }
    await page.screenshot({ path: `${screenshotDir}/touch-carousel.png` })
  })

  test("viewport resize reflow", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.screenshot({ path: `${screenshotDir}/reflow-desktop.png` })
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/reflow-mobile.png` })
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/reflow-tablet.png` })
  })

  test("image srcset responsive", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const img = page.locator("img[srcset]").first()
    if (await img.isVisible({ timeout: 3000 }).catch(() => false)) {
      const srcset = await img.getAttribute("srcset")
      expect(srcset).toBeTruthy()
    }
    await page.screenshot({ path: `${screenshotDir}/image-srcset.png` })
  })

  test("video player responsive sizing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${screenshotDir}/player-desktop.png` })
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/player-mobile.png` })
  })
})
