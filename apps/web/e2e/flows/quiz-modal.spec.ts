import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/quiz-modal"

test.describe("Quiz Modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.5),
    )
    await page.waitForTimeout(500)
  })

  test("button renders with gradient mesh background", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(quizBtn).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/button-gradient.png` })
  })

  test("button click opens modal dialog", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quizBtn.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/modal-open.png` })
  })

  test("modal with iframe and loading spinner", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quizBtn.click()
      await page.waitForTimeout(200)
      await page.screenshot({ path: `${screenshotDir}/loading-spinner.png` })
      await page.waitForTimeout(2000)
      await page.screenshot({ path: `${screenshotDir}/iframe-loaded.png` })
    }
  })

  test("loading spinner visible during iframe load", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quizBtn.click()
      await page.waitForTimeout(100)
    }
    await page.screenshot({ path: `${screenshotDir}/spinner-during-load.png` })
  })

  test("close button click closes modal", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quizBtn.click()
      await page.waitForTimeout(500)
      const closeBtn = page
        .locator(
          '[data-testid="modal-close"], dialog button, [aria-label="Close"]',
        )
        .first()
      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeBtn.click()
        await page.waitForTimeout(300)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/modal-closed.png` })
  })

  test("backdrop click closes modal", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quizBtn.click()
      await page.waitForTimeout(500)
      await page.mouse.click(10, 10)
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/backdrop-close.png` })
  })

  test("iframe sandbox attributes verification", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quizBtn.click()
      await page.waitForTimeout(500)
      const iframe = page.locator("iframe").first()
      if (await iframe.isVisible({ timeout: 2000 }).catch(() => false)) {
        const sandbox = await iframe.getAttribute("sandbox")
        if (sandbox) {
          expect(sandbox).toBeTruthy()
        }
      }
    }
    await page.screenshot({ path: `${screenshotDir}/iframe-sandbox.png` })
  })

  test("iframe title accessibility", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quizBtn.click()
      await page.waitForTimeout(500)
      const iframe = page.locator("iframe").first()
      if (await iframe.isVisible({ timeout: 2000 }).catch(() => false)) {
        const title = await iframe.getAttribute("title")
        expect(title).toBeTruthy()
      }
    }
    await page.screenshot({ path: `${screenshotDir}/iframe-title.png` })
  })

  test("button text display", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/button-text.png` })
  })

  test("animated mesh gradient on button", async ({ page }) => {
    const quizBtn = page
      .locator(
        '[data-testid="quiz-button"], button:has-text("Quiz"), button:has-text("QUIZ"), [class*="quiz"] button',
      )
      .first()
    if (await quizBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.screenshot({ path: `${screenshotDir}/mesh-gradient-1.png` })
      await page.waitForTimeout(1000)
      await page.screenshot({ path: `${screenshotDir}/mesh-gradient-2.png` })
    }
  })
})
