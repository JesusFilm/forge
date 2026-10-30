import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./watch-audience-test"

const videoPath =
  process.env.WATCH_AUDIENCE_TEST_VIDEO_PATH ?? "/watch/jesus.html"

async function boundedGrow(page: Page) {
  const panel = page.getByTestId("watch-next-steps-panel")
  const grow = page.getByTestId("watch-grow")
  await expect(grow).toBeVisible()
  await expect
    .poll(async () => {
      const outer = await panel.boundingBox()
      const content = await grow.boundingBox()
      if (!outer || !content) return false
      return (
        content.width <= outer.width + 1 &&
        content.x >= outer.x - 1 &&
        content.x + content.width <= outer.x + outer.width + 1
      )
    })
    .toBe(true)
  // Measure the content itself: an overflow mask on an oversized grid cannot
  // satisfy this check. Only carousel viewports may clip their moving track.
  const geometry = await panel.evaluate((element) => ({
    panel: element.clientWidth,
    grid: element
      .querySelector('[data-testid="watch-role-journey"]')
      ?.parentElement?.getBoundingClientRect().width,
    pageOverflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }))
  expect(geometry.pageOverflow).toBe(0)
  expect(geometry.grid).toBeLessThanOrEqual(geometry.panel + 1)
  await test.info().attach("Grow geometry", {
    body: JSON.stringify({ viewport: page.viewportSize(), ...geometry }),
    contentType: "application/json",
  })
  return { panel, grow }
}

async function browseRail(
  page: Page,
  rail: Locator,
  nextLabel: string,
  cardSelector = 'a[href], button[data-testid="watch-grow-course-card"]',
) {
  const carousel = rail.locator('xpath=ancestor::*[@data-slot="carousel"]')
  const viewport = carousel.locator('[data-slot="carousel-content"]')
  const next = carousel.getByRole("button", {
    name: nextLabel,
    exact: true,
    includeHidden: true,
  })
  const cards = rail.locator(cardSelector)
  const first = cards.first()
  // Daily prayer starts at today's card. Real keyboard focus must also reveal
  // the first card before we exercise forward navigation from that boundary.
  await first.focus()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Shift+Tab")
  await expect(first).toBeFocused()
  await expect(next).toBeEnabled()
  await first.scrollIntoViewIfNeeded()
  if ((page.viewportSize()?.width ?? 0) < 768) {
    const beforeSwipe = await rail.evaluate(
      (element) => getComputedStyle(element).transform,
    )
    const box = (await first.boundingBox())!
    const client = await page.context().newCDPSession(page)
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width * 0.8, y: box.y + box.height / 2 }],
    })
    for (let step = 1; step <= 5; step += 1)
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: box.x + box.width * 0.8 - step * 24, y: box.y + box.height / 2 },
        ],
      })
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    })
    await client.detach()
    await expect
      .poll(() =>
        rail.evaluate((element) => getComputedStyle(element).transform),
      )
      .not.toBe(beforeSwipe)
  }
  await first.focus()
  await expect(first).toBeFocused()
  const initialTransform = await rail.evaluate(
    (element) => getComputedStyle(element).transform,
  )
  await page.keyboard.press("ArrowRight")
  await expect
    .poll(() => rail.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe(initialTransform)

  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await carousel.hover()
    await expect(next).toBeVisible()
    await next.click()
  }
  // Embla's focus handling must reveal even the last card. Native Tab keeps
  // every destination reachable on phones where edge controls are hidden.
  await first.focus()
  for (let index = 1; index < (await cards.count()); index += 1)
    await page.keyboard.press("Tab")
  const last = cards.last()
  await expect(last).toBeFocused()
  await expect
    .poll(async () => {
      const box = await last.boundingBox()
      const frame = await viewport.boundingBox()
      if (!box || !frame) return false
      return (
        box.x >= frame.x - 1 && box.x + box.width <= frame.x + frame.width + 1
      )
    })
    .toBe(true)
  await expect(last).toBeInViewport()
  for (let index = 1; index < (await cards.count()); index += 1)
    await page.keyboard.press("Shift+Tab")
  await expect(first).toBeFocused()
  await expect(next).toBeEnabled()
}

for (const width of [1280, 390]) {
  test.describe(`Grow geometry at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width < 768 })

    test("initial video defers audience resources and requests until intent", async ({
      page,
    }) => {
      const scripts = new Set<string>()
      const audienceRequests: string[] = []
      page.on("request", (request) => {
        const url = new URL(request.url())
        if (
          url.pathname.includes("/_next/static/chunks/") &&
          url.pathname.endsWith(".js")
        )
          scripts.add(url.href)
        if (/learning-progress|film-finder|audience/.test(url.pathname))
          audienceRequests.push(`${request.method()} ${url.pathname}`)
      })
      const bodies = () =>
        Promise.all(
          [...scripts].map(async (url) => {
            const response = await page.request.get(url)
            expect(response.ok()).toBe(true)
            return response.text()
          }),
        )
      await page.goto(videoPath)
      await expect(page.getByTestId("watch-next-steps")).toHaveAttribute(
        "data-role",
        "explore",
      )
      await page.waitForTimeout(3500)
      const initial = await bodies()
      expect(initial.length).toBeGreaterThan(0)
      for (const marker of [
        '"data-testid":"watch-find-flow","data-step":',
        '"data-testid":"watch-grow-course-sheet"',
        '"data-testid":"watch-grow-story"',
        "watch-partner-download-tools",
        "watch-share-kit-launcher",
      ])
        expect(
          initial.some((body) => body.includes(marker)),
          marker,
        ).toBe(false)
      expect(audienceRequests).toEqual([])
      // Positive control: the actual course implementation arrives on intent.
      await page.goto(`${videoPath}?as=grow&grow=full`)
      await expect(page.getByTestId("watch-grow-course-card")).toHaveCount(9)
      expect(
        (await bodies()).some((body) =>
          body.includes('"data-testid":"watch-grow-course-sheet"'),
        ),
      ).toBe(true)
    })

    test("lean resources fit the panel and every plan stays keyboard reachable", async ({
      page,
    }) => {
      await page.goto(`${videoPath}?as=grow`)
      await expect(page.getByTestId("watch-grow")).toHaveAttribute(
        "data-shape",
        "lean",
      )
      await boundedGrow(page)
      const rail = page.getByTestId("watch-grow-plan-rail")
      await expect(rail.locator("a[href]")).toHaveCount(15)
      await browseRail(page, rail, "More plans")

      // Synthetic DOM sizing stress only: the real published projection/auth
      // requests remain untouched. Locale propagation has rendered unit tests.
      await page.getByTestId("watch-role-journey").evaluate((element) => {
        element.setAttribute("lang", "ar")
        element.setAttribute("dir", "rtl")
        element.querySelector("h3")!.textContent =
          "ما الخطوة التالية التي تريد أن تتخذها في رحلتك اليوم؟ ".repeat(12)
      })
      await boundedGrow(page)
      const question = page.getByTestId("watch-role-journey").locator("h3")
      expect(
        await question.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true)
      await expect(page.getByTestId("watch-role-journey")).toHaveAttribute(
        "dir",
        "rtl",
      )
    })

    test("full course and solo/group/leader modes fit without disabling the lesson rail", async ({
      page,
    }) => {
      const writes: string[] = []
      page.on("request", (request) => {
        if (
          request.method() !== "GET" &&
          /learning-progress/.test(request.url())
        )
          writes.push(new URL(request.url()).pathname)
      })
      await page.goto(`${videoPath}?as=grow&grow=full`)
      const course = page.getByTestId("watch-grow-course")
      await expect(course).not.toHaveAttribute("data-loading", "true")
      await expect(course.getByTestId("watch-grow-course-card")).toHaveCount(9)
      await boundedGrow(page)
      await browseRail(
        page,
        page.getByTestId("watch-grow-course-rail"),
        "Later lessons",
      )

      for (const mode of ["solo", "joining", "leading"]) {
        const control = page.getByTestId(`watch-grow-course-mode-${mode}`)
        await control.evaluate((element) =>
          element.scrollIntoView({ block: "center" }),
        )
        await control.focus()
        await page.keyboard.press("Space")
        await expect(control).toBeChecked()
        await boundedGrow(page)
        await expect(
          course.getByRole("button", {
            name: "Later lessons",
            exact: true,
            includeHidden: true,
          }),
        ).toBeEnabled()
      }
      await course.getByTestId("watch-grow-course-start").click()
      const sheet = page.getByTestId("watch-grow-course-sheet")
      await expect(sheet).toBeVisible()
      await boundedGrow(page)
      expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(
        (await course.boundingBox())!.width + 1,
      )
      await sheet
        .getByRole("button", { name: "Close the lesson", exact: true })
        .click()
      await expect(sheet).toHaveCount(0)
      const plans = page.getByTestId("watch-grow-plans").getByRole("link")
      await expect(plans).toHaveCount(15)
      for (const plan of await plans.all()) {
        await plan.focus()
        await expect(plan).toBeInViewport()
        expect(
          await plan.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return box.x >= 0 && box.right <= window.innerWidth
          }),
        ).toBe(true)
      }
      await browseRail(
        page,
        page.getByTestId("watch-grow-prayer-rail"),
        "Later days",
        "button",
      )
      await boundedGrow(page)
      expect(writes).toEqual([])
    })
  })
}
