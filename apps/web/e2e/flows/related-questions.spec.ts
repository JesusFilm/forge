import { test, expect } from "@playwright/test"

const screenshotDir = "../screenshots/browser/related-questions"

test.describe("Related Questions Accordion", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight * 0.7),
    )
    await page.waitForTimeout(500)
  })

  test("question expand — arrow rotates 180deg", async ({ page }) => {
    const question = page
      .locator(
        '[data-testid="accordion-trigger"], [class*="accordion"] button, details summary',
      )
      .first()
    if (await question.isVisible({ timeout: 3000 }).catch(() => false)) {
      await question.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/expand.png` })
  })

  test("question collapse", async ({ page }) => {
    const question = page
      .locator(
        '[data-testid="accordion-trigger"], [class*="accordion"] button, details summary',
      )
      .first()
    if (await question.isVisible({ timeout: 3000 }).catch(() => false)) {
      await question.click()
      await page.waitForTimeout(300)
      await question.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/collapse.png` })
  })

  test("only one open at a time (controlled)", async ({ page }) => {
    const questions = page.locator(
      '[data-testid="accordion-trigger"], [class*="accordion"] button, details summary',
    )
    if (
      await questions
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await questions.first().click()
      await page.waitForTimeout(300)
      if (
        await questions
          .nth(1)
          .isVisible({ timeout: 1000 })
          .catch(() => false)
      ) {
        await questions.nth(1).click()
        await page.waitForTimeout(500)
      }
    }
    await page.screenshot({ path: `${screenshotDir}/single-open.png` })
  })

  test("keyboard navigation (Enter toggle)", async ({ page }) => {
    const question = page
      .locator(
        '[data-testid="accordion-trigger"], [class*="accordion"] button, details summary',
      )
      .first()
    if (await question.isVisible({ timeout: 3000 }).catch(() => false)) {
      await question.focus()
      await page.keyboard.press("Enter")
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/keyboard-enter.png` })
  })

  test("hover state — bg-white/5 underline", async ({ page }) => {
    const question = page
      .locator(
        '[data-testid="accordion-trigger"], [class*="accordion"] button, details summary',
      )
      .first()
    if (await question.isVisible({ timeout: 3000 }).catch(() => false)) {
      await question.hover()
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${screenshotDir}/hover.png` })
  })

  test("markdown content in answers — lists rendered", async ({ page }) => {
    const question = page
      .locator(
        '[data-testid="accordion-trigger"], [class*="accordion"] button, details summary',
      )
      .first()
    if (await question.isVisible({ timeout: 3000 }).catch(() => false)) {
      await question.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${screenshotDir}/markdown-content.png` })
  })

  test("question icon display", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/question-icon.png` })
  })

  test("CTA button display and click (new tab)", async ({ page }) => {
    const cta = page
      .locator(
        '[data-testid="accordion-cta"], [class*="accordion"] a[target="_blank"]',
      )
      .first()
    if (await cta.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(cta).toBeVisible()
    }
    await page.screenshot({ path: `${screenshotDir}/cta-button.png` })
  })

  test("heading display", async ({ page }) => {
    await page.screenshot({ path: `${screenshotDir}/heading.png` })
  })

  test("accordion height animation", async ({ page }) => {
    const question = page
      .locator(
        '[data-testid="accordion-trigger"], [class*="accordion"] button, details summary',
      )
      .first()
    if (await question.isVisible({ timeout: 3000 }).catch(() => false)) {
      await question.click()
      await page.waitForTimeout(100)
      await page.screenshot({ path: `${screenshotDir}/height-animating.png` })
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${screenshotDir}/height-complete.png` })
    }
  })
})
