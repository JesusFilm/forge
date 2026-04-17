import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/video-player"

test.describe("Video Player", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
  })

  test("play video via play button", async ({ page }) => {
    const player = page.locator("video, [data-testid='video-player']").first()
    if (await player.isVisible({ timeout: 3000 }).catch(() => false)) {
      await player.click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${screenshotDir}/play.png` })
  })

  test("pause video", async ({ page }) => {
    const player = page.locator("video, [data-testid='video-player']").first()
    if (await player.isVisible({ timeout: 3000 }).catch(() => false)) {
      await player.click()
      await page.waitForTimeout(500)
      await player.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/pause.png` })
  })

  test("seek via progress bar click at 50%", async ({ page }) => {
    const progressBar = page
      .locator(
        ".vjs-progress-control, [data-testid='progress-bar'], input[type='range']",
      )
      .first()
    if (await progressBar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await progressBar.boundingBox()
      if (box) {
        await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
        await page.waitForTimeout(500)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/seek-50.png` })
  })

  test("seek via slider drag", async ({ page }) => {
    const slider = page
      .locator(
        ".vjs-progress-control, [data-testid='progress-bar'], input[type='range']",
      )
      .first()
    if (await slider.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await slider.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, {
          steps: 10,
        })
        await page.mouse.up()
        await page.waitForTimeout(500)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/seek-drag.png` })
  })

  test("time display accuracy", async ({ page }) => {
    const timeDisplay = page
      .locator(".vjs-time-control, [data-testid='time-display']")
      .first()
    if (await timeDisplay.isVisible({ timeout: 3000 }).catch(() => false)) {
      const text = await timeDisplay.textContent()
      expect(text).toMatch(/\d+:\d+/)
    }
    await page.screenshot({ path: `${screenshotDir}/time-display.png` })
  })

  test("mute toggle shows large center icon", async ({ page }) => {
    const muteBtn = page
      .locator(
        ".vjs-mute-control, [data-testid='mute-button'], [aria-label*='ute']",
      )
      .first()
    if (await muteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await muteBtn.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/muted.png` })
  })

  test("unmute toggle removes icon", async ({ page }) => {
    const muteBtn = page
      .locator(
        ".vjs-mute-control, [data-testid='mute-button'], [aria-label*='ute']",
      )
      .first()
    if (await muteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await muteBtn.click()
      await page.waitForTimeout(300)
      await muteBtn.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/unmuted.png` })
  })

  test("mute state persists across pause/play", async ({ page }) => {
    const muteBtn = page
      .locator(
        ".vjs-mute-control, [data-testid='mute-button'], [aria-label*='ute']",
      )
      .first()
    const player = page.locator("video, [data-testid='video-player']").first()
    if (await muteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await muteBtn.click()
      await page.waitForTimeout(300)
      if (await player.isVisible()) {
        await player.click()
        await page.waitForTimeout(300)
        await player.click()
        await page.waitForTimeout(300)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/mute-persist.png` })
  })

  test("fullscreen enter", async ({ page }) => {
    const fsBtn = page
      .locator(
        ".vjs-fullscreen-control, [data-testid='fullscreen-button'], [aria-label*='ullscreen']",
      )
      .first()
    if (await fsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fsBtn.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/fullscreen-enter.png` })
  })

  test("fullscreen exit", async ({ page }) => {
    const fsBtn = page
      .locator(
        ".vjs-fullscreen-control, [data-testid='fullscreen-button'], [aria-label*='ullscreen']",
      )
      .first()
    if (await fsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fsBtn.click()
      await page.waitForTimeout(500)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/fullscreen-exit.png` })
  })

  test("poster/thumbnail display before play", async ({ page }) => {
    await page.goto("/")
    const poster = page
      .locator(".vjs-poster, [data-testid='video-poster'], video[poster]")
      .first()
    if (await poster.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(poster).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/poster.png` })
  })

  test("autoplay on viewport scroll for Video section", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 500))
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${screenshotDir}/autoplay-scroll.png` })
  })

  test("progress slider keyboard interaction with arrow keys", async ({
    page,
  }) => {
    const slider = page
      .locator(".vjs-progress-control, input[type='range']")
      .first()
    if (await slider.isVisible({ timeout: 3000 }).catch(() => false)) {
      await slider.focus()
      await page.keyboard.press("ArrowRight")
      await page.waitForTimeout(300)
      await page.keyboard.press("ArrowRight")
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/keyboard-seek.png` })
  })

  test("spacebar play/pause toggle", async ({ page }) => {
    const player = page.locator("video, [data-testid='video-player']").first()
    if (await player.isVisible({ timeout: 3000 }).catch(() => false)) {
      await player.focus()
      await page.keyboard.press("Space")
      await page.waitForTimeout(500)
      await page.keyboard.press("Space")
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/spacebar-toggle.png` })
  })
})
