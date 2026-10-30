import type { Locator } from "@playwright/test"
import { expect, test } from "./watch-audience-test"

const film = process.env.WATCH_AUDIENCE_TEST_FILM_SLUG ?? "jesus-feature-film"

// Decode browser screenshots inside the fenced browser itself. Count the
// actual blue indicator pixels; DOM focus and a computed outline can both be
// present while the rendered control remains indistinguishable from blur.
async function bluePixels(control: Locator, png: Buffer) {
  return control.page().evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext("2d")!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < pixels.length; i += 4)
      if (
        pixels[i] === 37 &&
        pixels[i + 1] === 99 &&
        pixels[i + 2] === 235 &&
        pixels[i + 3] === 255
      )
        count += 1
    return count
  }, png.toString("base64"))
}

// Compare actual control pixels with animations disabled, keeping hover,
// selection, scroll, copy and geometry identical. A matching :focus-visible
// selector alone did not catch the original invisible ring/outline defects.
async function paintedFocus(control: Locator, name: string) {
  const page = control.page()
  const info = test.info()
  await control.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await control.evaluate((el) => (el as HTMLElement).blur())
  const bounds = await control.boundingBox()
  const blurred = await control.screenshot({ animations: "disabled" })
  await control.focus()
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Tab")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("outline-style", "solid")
  await expect(control).toHaveCSS("outline-width", "3px")
  // #2563eb is 5.17:1 against white and >3:1 against the dark course
  // surfaces; it also contrasts with the warm lesson sheet. It is inset so
  // carousel/rounded overflow containers cannot clip it away.
  await expect(control).toHaveCSS("outline-color", "rgb(37, 99, 235)")
  await expect(control).toHaveCSS("outline-offset", "-4px")
  const focused = await control.screenshot({ animations: "disabled" })
  expect(
    focused.equals(blurred),
    `${name}: focus must change painted pixels`,
  ).toBe(false)
  const addedBluePixels =
    (await bluePixels(control, focused)) - (await bluePixels(control, blurred))
  expect(
    addedBluePixels,
    `${name}: contrasting indicator must be painted`,
  ).toBeGreaterThan(50)
  await info.attach(`${name} painted indicator`, {
    body: JSON.stringify({
      addedBluePixels,
      outline: "3px #2563eb inset 4px",
      whiteContrast: 5.17,
    }),
    contentType: "application/json",
  })
  const focusedBounds = await control.boundingBox()
  expect(focusedBounds?.width).toBe(bounds?.width)
  expect(focusedBounds?.height).toBe(bounds?.height)
  await info.attach(`${name} blurred`, {
    body: blurred,
    contentType: "image/png",
  })
  await info.attach(`${name} keyboard focus`, {
    body: focused,
    contentType: "image/png",
  })
  // A pointer-only visit must not acquire the keyboard indicator.
  await control.evaluate((el) => (el as HTMLElement).blur())
}

for (const width of [390, 1280]) {
  for (const language of ["english", "arabic-modern-standard"]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test.describe(`painted focus ${language} ${width} ${colorScheme}`, () => {
        test.use({
          viewport: { width, height: 900 },
          colorScheme,
          hasTouch: true,
        })
        test("cold lesson return keeps its lesson open after URL cleanup without progress writes", async ({
          page,
        }) => {
          const writes: string[] = []
          page.on("request", (request) => {
            if (
              request.method() !== "GET" &&
              /learning-progress/.test(request.url())
            )
              writes.push(request.url())
          })
          await page.goto(
            `/watch/${film}.html/${language}.html?as=grow&growLesson=lesson-1`,
          )
          const course = page.getByTestId("watch-grow-course")
          await expect(
            course.getByRole("radio", { name: "On my own", exact: true }),
          ).toBeChecked()
          await expect(
            course.getByTestId("watch-grow-course-sheet"),
          ).toHaveAttribute("data-lesson", "1")
          await expect(page).not.toHaveURL(/growLesson=/)
          await expect(page.getByTestId("watch-grow")).toHaveAttribute(
            "data-shape",
            "full",
          )
          const close = course.getByRole("button", {
            name: "Close the lesson",
            exact: true,
          })
          await paintedFocus(close, "cold return lesson close")
          await close.focus()
          await expect(close).toBeFocused()
          await page.keyboard.press("Enter")
          await expect(close).toHaveCount(0)
          if (width >= 768) {
            const later = course.getByRole("button", {
              name: "Later lessons",
              exact: true,
            })
            await expect(later).toBeEnabled()
            await later.focus()
            await expect(later).toHaveCSS("outline-color", "rgb(37, 99, 235)")
            const rail = course.getByTestId("watch-grow-course-rail")
            const transform = await rail.evaluate(
              (el) => getComputedStyle(el).transform,
            )
            await page.keyboard.press("Enter")
            await expect(rail).not.toHaveCSS("transform", transform)
          }
          expect(writes).toEqual([])
        })

        test("role tabs paint contrasting focus and retain roving selection", async ({
          page,
        }) => {
          await page.goto(`/watch/${film}.html/${language}.html?as=grow`)
          const tabs = page.getByTestId("watch-role-tabs").getByRole("tab")
          await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
          await paintedFocus(tabs.nth(1), "selected Grow tab")
          await tabs.nth(1).tap()
          await expect(tabs.nth(1)).toHaveCSS("outline-style", "none")
          // Test an unselected background without activating it by pointer.
          await paintedFocus(
            page.getByRole("button", { name: "Copy", exact: true }).last(),
            "lean Scripture copy",
          )
          await tabs.nth(1).focus()
          await page.keyboard.press("ArrowRight")
          await expect(tabs.nth(2)).toBeFocused()
          await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true")
          await expect(tabs.nth(1)).toHaveAttribute("tabindex", "-1")
          await tabs.nth(1).focus()
          await expect(tabs.nth(1)).toHaveCSS(
            "outline-color",
            "rgb(37, 99, 235)",
          )
          const focused = await tabs
            .nth(1)
            .screenshot({ animations: "disabled" })
          await tabs.nth(1).evaluate((el) => (el as HTMLElement).blur())
          const blurred = await tabs
            .nth(1)
            .screenshot({ animations: "disabled" })
          expect(focused.equals(blurred)).toBe(false)
          expect(
            (await bluePixels(tabs.nth(1), focused)) -
              (await bluePixels(tabs.nth(1), blurred)),
            "unselected tab: contrasting indicator must be painted",
          ).toBeGreaterThan(50)
          await tabs.nth(2).focus()
          await page.keyboard.press("Home")
          await expect(tabs.first()).toBeFocused()
          await page.keyboard.press("End")
          await expect(tabs.last()).toBeFocused()
          await expect(tabs.last()).toHaveAttribute("aria-selected", "true")
        })

        test("lesson cards, lesson close and course siblings paint keyboard focus", async ({
          page,
        }) => {
          await page.goto(
            `/watch/${film}.html/${language}.html?as=grow&grow=full`,
          )
          const course = page.getByTestId("watch-grow-course")
          const card = course.getByTestId("watch-grow-course-card").first()
          await paintedFocus(card, "lesson card")
          await card.focus()
          await expect(card).toBeFocused()
          await page.keyboard.press("Enter")
          const close = course.getByRole("button", {
            name: "Close the lesson",
            exact: true,
          })
          await paintedFocus(close, "lesson close")
          await close.focus()
          await expect(close).toBeFocused()
          await page.keyboard.press("Enter")
          await expect(close).toHaveCount(0)
          await course
            .getByRole("radio", { name: "In a group", exact: true })
            .locator("..")
            .click()
          await paintedFocus(
            course
              .getByTestId("watch-grow-course-group")
              .getByRole("link", { name: "About the strategy", exact: true }),
            "group resource",
          )
          await course
            .getByRole("radio", { name: "Leading a group", exact: true })
            .locator("..")
            .click()
          await paintedFocus(
            course.getByRole("button", { name: /Before you lead/ }),
            "leader preparation",
          )
          const planTabs = page
            .getByRole("tablist", { name: "Who the plan is for" })
            .getByRole("tab")
          await paintedFocus(planTabs.first(), "selected plan tab")
          await course
            .getByRole("radio", { name: "On my own", exact: true })
            .locator("..")
            .click()
          await course.getByTestId("watch-grow-course-start").focus()
          await page.keyboard.press("Enter")
          await course.getByTestId("watch-grow-course-play-story").click()
          const story = page.getByRole("dialog", {
            name: "Lesson 1 as a story",
          })
          await paintedFocus(
            story.getByRole("button", { name: "Close the story", exact: true }),
            "story portal close",
          )
          await page.keyboard.press("Escape")
          await expect(story).toHaveCount(0)
          await expect(
            course.getByTestId("watch-grow-course-play-story"),
          ).toBeFocused()
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - innerWidth,
            ),
          ).toBe(0)
        })
      })
    }
  }
}
