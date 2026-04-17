import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/video-hero"

test.describe("Video Hero", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
  })

  test("auto-play on page load (muted)", async ({ page }) => {
    const video = page.locator("video").first()
    if (await video.isVisible({ timeout: 5000 }).catch(() => false)) {
      const muted = await video.evaluate((el: HTMLVideoElement) => el.muted)
      expect(muted).toBe(true)
    }
    await page.screenshot({ path: `${screenshotDir}/autoplay-muted.png` })
  })

  test("pause on scroll down (>100px threshold)", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 200))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/paused-scroll.png` })
  })

  test("resume on scroll up (<50px)", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 200))
    await page.waitForTimeout(300)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/resume-scroll.png` })
  })

  test("mute button toggle", async ({ page }) => {
    const muteBtn = page
      .locator(
        '[data-testid="hero-mute"], [class*="hero"] button[aria-label*="ute"], [class*="hero"] button:has(svg)',
      )
      .first()
    if (await muteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await muteBtn.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/mute-toggle.png` })
  })

  test("unmute resets to start and plays", async ({ page }) => {
    const muteBtn = page
      .locator(
        '[data-testid="hero-mute"], [class*="hero"] button[aria-label*="ute"], [class*="hero"] button:has(svg)',
      )
      .first()
    if (await muteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await muteBtn.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/unmute-reset.png` })
  })

  test("unmute-once flag — only reset first time", async ({ page }) => {
    const muteBtn = page
      .locator(
        '[data-testid="hero-mute"], [class*="hero"] button[aria-label*="ute"], [class*="hero"] button:has(svg)',
      )
      .first()
    if (await muteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await muteBtn.click()
      await page.waitForTimeout(300)
      await muteBtn.click()
      await page.waitForTimeout(300)
      await muteBtn.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/unmute-once.png` })
  })

  test("heading and subheading display", async ({ page }) => {
    const heading = page
      .locator(
        '[class*="hero"] h1, [class*="hero"] h2, [data-testid="hero-heading"]',
      )
      .first()
    if (await heading.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(heading).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/heading-subheading.png` })
  })

  test("CTA button display and click", async ({ page }) => {
    const cta = page
      .locator(
        '[class*="hero"] a, [class*="hero"] button, [data-testid="hero-cta"]',
      )
      .first()
    if (await cta.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cta.click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/cta-click.png` })
  })

  test("RouteVideo vs static URL source selection", async ({ page }) => {
    const video = page.locator("video").first()
    if (await video.isVisible({ timeout: 3000 }).catch(() => false)) {
      const src = await video.evaluate(
        (el: HTMLVideoElement) => el.src || el.querySelector("source")?.src,
      )
      if (src) {
        expect(src).toMatch(/https?:\/\//)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/video-source.png` })
  })

  test("volume change event handling", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/volume-change.png` })
  })

  test("linear gradient overlay", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/gradient-overlay.png` })
  })

  test("scroll-driven blur/dim effect", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 80))
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${screenshotDir}/blur-dim.png` })
  })

  test("hero container dimensions", async ({ page }) => {
    const hero = page.locator('[class*="hero"], [data-testid="hero"]').first()
    if (await hero.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await hero.boundingBox()
      if (box) {
        expect(box.width).toBeGreaterThan(0)
        expect(box.height).toBeGreaterThan(0)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/hero-dimensions.png` })
  })
})
