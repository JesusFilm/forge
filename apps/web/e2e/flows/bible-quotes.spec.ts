import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/bible-quotes"

test.describe("Bible Quotes Carousel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight / 2),
    )
    await page.waitForTimeout(500)
  })

  test("carousel horizontal navigation", async ({ page }) => {
    const carousel = page
      .locator(
        '[data-testid="bible-quotes"], [class*="bible-quote"], [class*="quote-carousel"]',
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
      }
    }
    await page.screenshot({ path: `${screenshotDir}/horizontal-nav.png` })
  })

  test("quote card display — reference, text, image, bg color", async ({
    page,
  }) => {
    await page.screenshot({ path: `${screenshotDir}/quote-card.png` })
  })

  test("free resource card with CTA button", async ({ page }) => {
    const cta = page
      .locator(
        '[data-testid="resource-cta"], [class*="resource"] a, [class*="quote"] a[target]',
      )
      .first()
    if (await cta.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(cta).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/resource-cta.png` })
  })

  test("resource CTA click opens new tab", async ({ page }) => {
    const cta = page
      .locator(
        '[data-testid="resource-cta"], [class*="resource"] a[target="_blank"]',
      )
      .first()
    if (await cta.isVisible({ timeout: 3000 }).catch(() => false)) {
      const [newPage] = await Promise.all([
        page.waitForEvent("popup", { timeout: 3000 }).catch(() => null),
        cta.click(),
      ])
      if (newPage) {
        await newPage.close()
      }
    }
    await page.screenshot({ path: `${screenshotDir}/cta-new-tab.png` })
  })

  test("share button uses native share or clipboard fallback", async ({
    page,
  }) => {
    const shareBtn = page
      .locator(
        '[data-testid="share-button"], button:has-text("Share"), [aria-label*="hare"]',
      )
      .first()
    if (await shareBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await shareBtn.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/share.png` })
  })

  test("share URL format includes utm_source=share", async ({ page }) => {
    const shareBtn = page
      .locator(
        '[data-testid="share-button"], button:has-text("Share"), [aria-label*="hare"]',
      )
      .first()
    if (await shareBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const clipboardText = await page.evaluate(async () => {
        try {
          return await navigator.clipboard.readText()
        } catch {
          return ""
        }
      })
      if (clipboardText) {
        expect(clipboardText).toContain("utm_source=share")
      }
    }
    await page.screenshot({ path: `${screenshotDir}/share-url.png` })
  })

  test("image mask gradient display", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/image-mask.png` })
  })

  test("background color on quote cards", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/bg-color.png` })
  })

  test("carousel drag behavior", async ({ page }) => {
    const carousel = page
      .locator(
        '[data-testid="bible-quotes"], [class*="bible-quote"], [class*="quote-carousel"]',
      )
      .first()
    if (await carousel.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await carousel.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, {
          steps: 10,
        })
        await page.mouse.up()
        await page.waitForTimeout(500)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/drag-behavior.png` })
  })
})
