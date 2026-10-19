import { expect, test } from "@playwright/test"

// Run with the coordinator's existing-server config. This spec never starts a
// server or seeds content. Optional identities point at isolated DB fixtures.
const path =
  process.env.WATCH_FILM_FINDER_TEST_PATH ??
  process.env.WATCH_AUDIENCE_TEST_VIDEO_PATH ??
  "/watch/spanish-latin-american.html"
const languageSlug =
  process.env.WATCH_FILM_FINDER_TEST_LANGUAGE ?? "spanish-latin-american"
const expectedVideoSlug = process.env.WATCH_FILM_FINDER_TEST_VIDEO_SLUG
if (process.env.WATCH_FILM_FINDER_TEST_BASE_URL) {
  test.use({ baseURL: process.env.WATCH_FILM_FINDER_TEST_BASE_URL })
}

async function answerExplore(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Explore faith", exact: true }).click()
  const journey = page.getByTestId("watch-role-journey")
  for (let i = 0; i < 3; i += 1)
    await journey.locator("[data-option-id]").first().click()
}

test("live Admin cards retain selected audio through a canonical playable route", async ({
  page,
}) => {
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/api/film-finder")) requests.push(request.url())
  })
  await page.goto(path)
  await answerExplore(page)
  const launcher = page.getByTestId("watch-find-open")
  await expect(launcher).toBeVisible()
  expect(requests).toEqual([])
  const firstResponse = page.waitForResponse((response) =>
    response.url().includes("/api/film-finder"),
  )
  await launcher.click()
  const initial = await firstResponse
  expect(initial.status()).toBe(200)
  expect(initial.headers()["cache-control"]).toContain("no-store")
  expect(initial.request().headers().authorization).toBeUndefined()
  const dialog = page.getByRole("dialog", { name: "Find films for you" })
  await expect(dialog).toBeVisible()
  const audio = dialog.getByLabel("Film audio", { exact: true })
  if ((await audio.inputValue()) !== languageSlug) {
    const selectedResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/film-finder") &&
        new URL(response.url()).searchParams.get("languageSlug") ===
          languageSlug,
    )
    await audio.selectOption(languageSlug)
    expect((await selectedResponse).status()).toBe(200)
  }
  await expect(audio).toHaveValue(languageSlug)
  const cards = dialog.getByTestId("watch-finder-card")
  await expect(cards.first()).toBeVisible()
  const chosen = expectedVideoSlug
    ? cards
        .filter({ has: page.locator(`a[href*="/${expectedVideoSlug}.html"]`) })
        .first()
    : cards.first()
  await expect(chosen).toBeVisible()
  const link = chosen.getByRole("link")
  const href = await link.getAttribute("href")
  expect(href).toMatch(
    new RegExp(`/watch/[^/]+\\.html/${languageSlug}\\.html$`),
  )
  await link.click()
  await expect(page).toHaveURL((url) => url.pathname === href)
  await expect(page.getByTestId("watch-next-steps")).toBeVisible()
  expect(page.url()).not.toContain("/watch/search")
})

test("390px dialog contains keyboard focus, closes to its launcher, and reopens without changing the page URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(path)
  await answerExplore(page)
  const originalUrl = page.url()
  const launcher = page.getByTestId("watch-find-open")
  await launcher.focus()
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", { name: "Find films for you" })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 18; i += 1) {
    await page.keyboard.press("Tab")
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true)
  }
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(launcher).toBeFocused()
  expect(page.url()).toBe(originalUrl)
  await page.keyboard.press("Enter")
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(launcher).toBeFocused()
})
