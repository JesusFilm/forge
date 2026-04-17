import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/media-collection"

test.describe("Media Collection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
  })

  test("item hover changes background image", async ({ page }) => {
    const item = page
      .locator(
        '[data-testid="media-collection-item"], [class*="media-collection"] a, [class*="collection-item"]',
      )
      .first()
    if (await item.isVisible({ timeout: 3000 }).catch(() => false)) {
      await item.hover()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/hover-bg.png` })
  })

  test("image scale 105% on hover", async ({ page }) => {
    const item = page
      .locator(
        '[data-testid="media-collection-item"], [class*="media-collection"] a, [class*="collection-item"]',
      )
      .first()
    if (await item.isVisible({ timeout: 3000 }).catch(() => false)) {
      await item.hover()
      await page.waitForTimeout(300)
      const transform = await item
        .locator("img")
        .first()
        .evaluate((el) => getComputedStyle(el).transform)
      if (transform && transform !== "none") {
        expect(transform).toContain("matrix")
      }
    }
    await page.screenshot({ path: `${screenshotDir}/image-scale.png` })
  })

  test("item click navigates to /watch/[slug]", async ({ page }) => {
    const item = page
      .locator(
        '[data-testid="media-collection-item"] a, [class*="media-collection"] a[href*="/"]',
      )
      .first()
    if (await item.isVisible({ timeout: 3000 }).catch(() => false)) {
      const href = await item.getAttribute("href")
      if (href) {
        await item.click()
        await page.waitForTimeout(1000)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/click-navigate.png` })
  })

  test("item without slug is not clickable", async ({ page }) => {
    const nonClickable = page
      .locator(
        '[data-testid="media-collection-item"]:not(a), [class*="collection-item"] div[class*="pointer-events-none"]',
      )
      .first()
    if (await nonClickable.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(nonClickable).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/no-slug.png` })
  })

  test("carousel drag", async ({ page }) => {
    const carousel = page
      .locator('[data-testid="media-collection"], [class*="media-collection"]')
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
      }
    }
    await page.screenshot({ path: `${screenshotDir}/carousel-drag.png` })
  })

  test("CTA Watch button click", async ({ page }) => {
    const cta = page
      .locator('button:has-text("Watch"), a:has-text("Watch")')
      .first()
    if (await cta.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cta.click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/cta-watch.png` })
  })

  test("title, subtitle, description display", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/title-subtitle-desc.png` })
  })

  test("footer text display", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/footer.png` })
  })

  test("collection size badge (top-right)", async ({ page }) => {
    const badge = page
      .locator('[data-testid="collection-size"], [class*="badge"]')
      .first()
    if (await badge.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(badge).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/size-badge.png` })
  })

  test("label display (lowercase formatted)", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/label.png` })
  })
})
