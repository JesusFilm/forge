import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "./watch-audience-test"

const film = process.env.WATCH_AUDIENCE_TEST_FILM_SLUG ?? "jesus-feature-film"

// Discover the actual production chunk by its unique rendered contract, not a
// build-specific hash. Never intercept the route, auth or progress contracts.
async function chunksContaining(marker: string) {
  const dir = join(process.cwd(), ".next/static/chunks")
  const files = await readdir(dir)
  const matches = await Promise.all(
    files
      .filter((file) => file.endsWith(".js"))
      .map(async (file) =>
        (await readFile(join(dir, file), "utf8")).includes(marker)
          ? file
          : null,
      ),
  )
  const names = matches.filter((file): file is string => file !== null)
  expect(names.length, `production chunk for ${marker}`).toBe(1)
  return new Set(names)
}

for (const [language, width] of [
  ["english", 390],
  ["arabic-modern-standard", 1280],
] as const) {
  test.describe(`optional loading ${language} ${width}`, () => {
    test.use({ viewport: { width, height: 900 } })
    const url = `/watch/${film}.html/${language}.html?as=grow&growLesson=lesson-1`

    for (const outcome of ["success", "reject"] as const) {
      test(`eight-second course delay has visible bounded status, then ${outcome}`, async ({
        page,
      }, info) => {
        const chunks = await chunksContaining("watch-grow-course-sheet")
        let intercepted = 0
        const releaseChecks: { visible: boolean; elapsed: number }[] = []
        await page.route("**/_next/static/chunks/**", async (route) => {
          if (
            !chunks.has(
              new URL(route.request().url()).pathname.split("/").at(-1)!,
            )
          )
            return route.fallback()
          intercepted += 1
          // Intentional network fault duration, never an assertion sleep.
          const started = performance.now()
          // The emitted runtime performs one bounded retry. Delay the first
          // request for eight seconds; reject its retry immediately as well.
          if (intercepted === 1)
            await new Promise((resolve) => setTimeout(resolve, 8000))
          if (intercepted === 1)
            releaseChecks.push({
              visible: await page
                .getByRole("status")
                .filter({ hasText: "Loading the nine lessons…" })
                .isVisible(),
              elapsed: performance.now() - started,
            })
          if (outcome === "reject") await route.abort("failed")
          else await route.continue()
        })
        await page.goto(url, { waitUntil: "domcontentloaded" })
        const status = page
          .getByRole("status")
          .filter({ hasText: "Loading the nine lessons…" })
        await expect(status).toBeVisible()
        await expect(status).toHaveAttribute("lang", "en")
        await expect(status).toHaveAttribute("dir", "ltr")
        await expect(status).toHaveCSS("direction", "ltr")
        await info.attach("course loading status", {
          body: await status.screenshot(),
          contentType: "image/png",
        })
        if (outcome === "success") {
          await expect(
            page.getByRole("radio", { name: "On my own", exact: true }),
          ).toBeChecked({ timeout: 15000 })
          await expect(
            page.getByTestId("watch-grow-course-sheet"),
          ).toHaveAttribute("data-lesson", "1")
        } else {
          const alert = page
            .getByRole("alert")
            .filter({ hasText: "The nine lessons could not load." })
          await expect(alert).toBeVisible({ timeout: 15000 })
          await expect(
            alert.getByRole("link", { name: "The printed guide (PDF)" }),
          ).toBeVisible()
          await expect(page.getByTestId("watch-grow")).toBeVisible()
          await page.unroute("**/_next/static/chunks/**")
          await alert
            .getByRole("button", { name: "Try again", exact: true })
            .click()
          await expect(
            page.getByRole("radio", { name: "On my own", exact: true }),
          ).toBeChecked()
          await expect(
            page.getByTestId("watch-grow-course-sheet"),
          ).toHaveAttribute("data-lesson", "1")
        }
        await expect(status).toHaveCount(0)
        expect(intercepted).toBe(outcome === "reject" ? 4 : 1)
        expect(
          releaseChecks.every(
            (check) => check.visible && check.elapsed >= 8000,
          ),
        ).toBe(true)
        await info.attach("eight-second release checks", {
          body: JSON.stringify(releaseChecks),
          contentType: "application/json",
        })
        await expect(page.getByTestId("watch-role-tabs")).toBeVisible()
      })

      test(`pending prayer cannot hide usable lessons; optional ${outcome} stays local`, async ({
        page,
      }, info) => {
        const chunks = await chunksContaining(
          "watch-grow-prayer-subscribe-open",
        )
        let release!: () => void
        const pending = new Promise<void>((resolve) => {
          release = resolve
        })
        let intercepted = 0
        const errors: string[] = []
        page.on("pageerror", (error) => errors.push(error.message))
        await page.route("**/_next/static/chunks/**", async (route) => {
          if (
            !chunks.has(
              new URL(route.request().url()).pathname.split("/").at(-1)!,
            )
          )
            return route.fallback()
          intercepted += 1
          await pending
          if (outcome === "reject") await route.abort("failed")
          else await route.continue()
        })
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" })
          const course = page.getByTestId("watch-grow-course")
          await expect(
            course.getByRole("radio", { name: "On my own", exact: true }),
          ).toBeChecked()
          const close = course.getByRole("button", {
            name: "Close the lesson",
            exact: true,
          })
          await expect(close).toBeVisible()
          await close.focus()
          await expect(close).toBeFocused()
          await expect(
            page.getByTestId("watch-grow-prayer-subscribe-open"),
          ).toHaveCount(0)
          release()
          if (outcome === "reject") {
            const fallback = page
              .getByRole("status")
              .filter({ hasText: "The prayer guide is unavailable." })
            await expect(fallback).toBeVisible()
            await expect(fallback).toHaveAttribute("lang", "en")
            await expect(fallback).toHaveAttribute("dir", "ltr")
            await expect(fallback).toHaveCSS("direction", "ltr")
            await info.attach("contained prayer failure", {
              body: await fallback.screenshot(),
              contentType: "image/png",
            })
            await expect(
              page.getByRole("button", { name: "Try again", exact: true }),
            ).toHaveCount(0)
          } else {
            await expect(
              page.getByTestId("watch-grow-prayer-subscribe-open"),
            ).toBeVisible()
          }
          await expect(close).toBeFocused()
          await page.keyboard.press("Enter")
          await expect(close).toHaveCount(0)
          await expect(
            course.getByRole("radio", { name: "On my own", exact: true }),
          ).toBeChecked()
          await expect(page.getByTestId("hero-player-wrapper")).toBeAttached()
          expect(intercepted).toBe(outcome === "reject" ? 2 : 1)
          expect(errors).toEqual([])
          // A real fresh document can fetch a previously failed lazy chunk again.
          await page.unroute("**/_next/static/chunks/**")
          await page.goto(url, { waitUntil: "domcontentloaded" })
          await expect(
            page.getByTestId("watch-grow-prayer-subscribe-open"),
          ).toBeVisible()
          await expect(
            page.getByTestId("watch-grow-course-sheet"),
          ).toHaveAttribute("data-lesson", "1")
        } finally {
          release()
        }
      })
    }
  })
}
