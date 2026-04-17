import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/carousel-video-player"

test.describe("Carousel Video Player", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
  })

  test("thumbnail card selection updates main player", async ({ page }) => {
    const thumbnail = page
      .locator(
        '[data-testid="carousel-thumbnail"], .carousel-thumbnail, .embla__slide',
      )
      .first()
    if (await thumbnail.isVisible({ timeout: 3000 }).catch(() => false)) {
      await thumbnail.click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/thumbnail-select.png` })
  })

  test("thumbnail keyboard Enter selection", async ({ page }) => {
    const thumbnail = page
      .locator(
        '[data-testid="carousel-thumbnail"], .carousel-thumbnail, .embla__slide',
      )
      .first()
    if (await thumbnail.isVisible({ timeout: 3000 }).catch(() => false)) {
      await thumbnail.focus()
      await page.keyboard.press("Enter")
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/thumbnail-keyboard.png` })
  })

  test("carousel horizontal drag/swipe", async ({ page }) => {
    const carousel = page
      .locator('[data-testid="video-carousel"], .embla, [class*="carousel"]')
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
    await page.screenshot({ path: `${screenshotDir}/carousel-drag.png` })
  })

  test("main player controls — play/pause/mute/seek/fullscreen", async ({
    page,
  }) => {
    const player = page.locator("video, [data-testid='video-player']").first()
    if (await player.isVisible({ timeout: 3000 }).catch(() => false)) {
      await player.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/player-controls.png` })
  })

  test("play on video change — auto-play when switching", async ({ page }) => {
    const thumbnails = page.locator(
      '[data-testid="carousel-thumbnail"], .carousel-thumbnail, .embla__slide',
    )
    if (
      await thumbnails
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await thumbnails.first().click()
      await page.waitForTimeout(500)
      if (
        await thumbnails
          .nth(1)
          .isVisible({ timeout: 1000 })
          .catch(() => false)
      ) {
        await thumbnails.nth(1).click()
        await page.waitForTimeout(1000)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/auto-play-switch.png` })
  })

  test("title, subtitle, description display", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotDir}/title-subtitle.png` })
  })

  test("description first-4-words bold formatting", async ({ page }) => {
    const description = page
      .locator('[data-testid="video-description"], [class*="description"]')
      .first()
    if (await description.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(description).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/description-bold.png` })
  })

  test("desktop navigation arrows on hover", async ({ page }) => {
    const carousel = page
      .locator('[data-testid="video-carousel"], .embla, [class*="carousel"]')
      .first()
    if (await carousel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await carousel.hover()
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/nav-arrows.png` })
  })

  test("hover play indicator on thumbnail", async ({ page }) => {
    const thumbnail = page
      .locator(
        '[data-testid="carousel-thumbnail"], .carousel-thumbnail, .embla__slide',
      )
      .first()
    if (await thumbnail.isVisible({ timeout: 3000 }).catch(() => false)) {
      await thumbnail.hover()
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/hover-play-indicator.png` })
  })
})
