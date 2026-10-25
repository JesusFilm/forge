import type { Page } from "@playwright/test"
import { expect, test } from "./watch-audience-test"

const film = process.env.WATCH_AUDIENCE_TEST_FILM_SLUG ?? "jesus-feature-film"

async function scrollProbe(page: Page) {
  await page.evaluate(() => {
    const original = Element.prototype.scrollIntoView
    const calls: { empty: boolean; lesson: string | null; at: number }[] = []
    Object.assign(window, { lessonScrollCalls: calls })
    Element.prototype.scrollIntoView = function (...args) {
      if (
        this.matches(".scroll-mt-24") &&
        this.closest('[data-testid="watch-grow-course"]')
      )
        calls.push({
          empty: !this.firstElementChild,
          lesson: this.firstElementChild?.getAttribute("data-lesson") ?? null,
          at: performance.now(),
        })
      return original.apply(this, args)
    }
  })
}

async function calls(page: Page, clear = false) {
  return page.evaluate((reset) => {
    const rows = (
      window as unknown as {
        lessonScrollCalls: {
          empty: boolean
          lesson: string | null
          at: number
        }[]
      }
    ).lessonScrollCalls
    return reset ? rows.splice(0) : [...rows]
  }, clear)
}

// Observe beyond the old 70ms callback and native smooth-scroll animation.
// This is an observation window, not a delay inserted between the race inputs.
async function observeFocus(page: Page) {
  return page
    .getByTestId("watch-grow-plans")
    .getByRole("link")
    .nth(6)
    .evaluate(
      (target) =>
        new Promise<{ focused: boolean; visible: boolean }[]>((resolve) => {
          const rows: { focused: boolean; visible: boolean }[] = []
          const start = performance.now()
          const sample = () => {
            const box = target.getBoundingClientRect()
            rows.push({
              focused: document.activeElement === target,
              visible:
                box.top >= 0 &&
                box.bottom <= innerHeight &&
                box.left >= 0 &&
                box.right <= innerWidth,
            })
            if (performance.now() - start >= 600) resolve(rows)
            else requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        }),
    )
}

for (const language of ["english", "arabic-modern-standard"]) {
  for (const width of [390, 1280]) {
    test.describe(`lesson scroll ${language} ${width}px`, () => {
      test.use({ viewport: { width, height: 844 }, hasTouch: width === 390 })

      test("rapid trusted-keyboard close never scrolls an empty lesson or hides the seventh plan", async ({
        page,
      }, info) => {
        await page.goto(
          `/watch/${film}.html/${language}.html?as=grow&grow=full`,
        )
        const card = page.getByTestId("watch-grow-course-card").last()
        await expect(card).toBeVisible()
        await scrollProbe(page)
        const results = []
        // Real keyboard input drives the actual React handlers. No event
        // handler, timer, animation-frame or course state is mocked/frozen.
        for (let cycle = 0; cycle < 32; cycle++) {
          await card.focus()
          await page.keyboard.press("Enter")
          const path = await page
            .getByTestId("watch-grow-course-sheet")
            .evaluate((sheet) => {
              const stops = [
                ...document.querySelectorAll<HTMLElement>(
                  "a[href],button,input,select,textarea,[tabindex]",
                ),
              ].filter(
                (node) =>
                  node.tabIndex >= 0 &&
                  !node.matches(":disabled") &&
                  node.getClientRects().length > 0 &&
                  getComputedStyle(node).visibility !== "hidden",
              )
              const close = sheet.querySelector(
                '[aria-label="Close the lesson"]',
              )!
              const plan = document.querySelectorAll(
                '[data-testid="watch-grow-plans"] a[href]',
              )[6]!
              const after = stops.filter(
                (node) =>
                  !sheet.contains(node) &&
                  Boolean(
                    sheet.compareDocumentPosition(node) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
                  ),
              )
              return {
                close:
                  stops.indexOf(close as HTMLElement) -
                  stops.indexOf(document.activeElement as HTMLElement),
                plan: after.indexOf(plan as HTMLElement) + 1,
              }
            })
          expect(path.close).toBeGreaterThan(0)
          expect(path.plan).toBeGreaterThan(0)
          for (let tab = 0; tab < path.close; tab++)
            await page.keyboard.press("Tab")
          await page.keyboard.press("Enter")
          for (let tab = 0; tab < path.plan; tab++)
            await page.keyboard.press("Tab")
          const frames = await observeFocus(page)
          const scrolls = await calls(page, true)
          results.push({ cycle, path, scrolls, frames })
        }
        await info.attach("trusted keyboard scroll lifecycle", {
          body: JSON.stringify(results),
          contentType: "application/json",
        })
        expect(
          results.flatMap((row) => row.scrolls).filter((row) => row.empty),
        ).toEqual([])
        expect(
          results
            .flatMap((row) => row.frames)
            .every((row) => row.focused && row.visible),
        ).toBe(true)
        await expect(page.getByTestId("watch-grow-course-sheet")).toHaveCount(0)
        await page.screenshot({
          path: info.outputPath("seventh-plan-keyboard-focus.png"),
        })
      })

      test("an active lesson scrolls once; pointer/touch close and reopen remain usable", async ({
        page,
      }) => {
        await page.goto(
          `/watch/${film}.html/${language}.html?as=grow&grow=full`,
        )
        const start = page.getByTestId("watch-grow-course-start")
        await expect(start).toBeVisible()
        await scrollProbe(page)
        await start.focus()
        await page.keyboard.press("Enter")
        await expect.poll(async () => (await calls(page)).length).toBe(1)
        expect((await calls(page))[0]).toMatchObject({
          empty: false,
          lesson: "1",
        })
        const sheet = page.getByTestId("watch-grow-course-sheet")
        await expect(sheet).toBeInViewport()
        const close = sheet.getByRole("button", {
          name: "Close the lesson",
          exact: true,
        })
        if (width === 390) await close.tap()
        else await close.click()
        await expect(sheet).toHaveCount(0)
        if (width === 390) await start.tap()
        else await start.click()
        await expect.poll(async () => (await calls(page)).length).toBe(2)
        await expect(sheet).toBeInViewport()
      })
    })
  }
}
