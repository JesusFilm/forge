import { expect, test, type Locator, type Page } from "@playwright/test"

import { WATCH_AUDIENCE_CODE_CONFIG } from "../src/lib/watch-audience-config"

const videoPath =
  process.env.WATCH_AUDIENCE_TEST_VIDEO_PATH ?? "/watch/jesus.html"
const audioLanguage =
  process.env.WATCH_AUDIENCE_TEST_LANGUAGE_SLUG ?? "spanish-latin-american"

// Runs against real Watch home/video content; no questionnaire-only fixture or
// mocked player. The coordinator supplies the stage-enabled preview and owns
// production-load, analytics-receipt and playback measurements. Per the
// prototype, home shows the compact role line + pills and the video page shows
// the questionnaire; the Partner questionnaire needs a real account session.
async function answerFirstOptions(frame: Locator) {
  for (let step = 1; step <= 3; step += 1) {
    await expect(
      frame.getByText(`Question ${step} of 3`, { exact: true }),
    ).toBeVisible()
    await frame.locator("[data-option-id]").first().click()
  }
}

function tab(page: Page, name: string) {
  return page
    .getByTestId("watch-role-tabs")
    .getByRole("tab", { name, exact: true })
}

for (const role of WATCH_AUDIENCE_CODE_CONFIG.roles.filter(
  (candidate) => candidate.id !== "partner",
)) {
  test(`video ${role.id}: answers, edits from the trail, resets and offers a real next step`, async ({
    page,
  }) => {
    await page.goto(videoPath)
    await tab(page, role.label).click()
    const frame = page.getByTestId("watch-next-steps")
    await answerFirstOptions(frame)
    await expect(
      frame.getByRole("heading", { name: role.finish, exact: true }),
    ).toBeVisible()
    const result = frame
      .getByTestId("watch-journey-result")
      .locator("[data-action-id]")
    await expect(result).toBeVisible()
    if (await result.evaluate((element) => element.tagName === "A")) {
      await expect(result).toHaveAttribute("href", /^(\/watch\/|https:\/\/)/)
    } else {
      await expect(result).toBeEnabled()
    }
    await expect(frame.getByTestId("watch-journey-alternatives")).toBeVisible()
    const trail = frame.getByRole("list", { name: "Your answers" })
    await trail.getByRole("button").nth(2).click()
    await expect(
      frame.getByText("Question 3 of 3", { exact: true }),
    ).toBeVisible()
    await frame.locator("[data-option-id]").first().click()
    await frame.getByRole("button", { name: "Start over", exact: true }).click()
    await expect(trail).toHaveCount(0)
    await expect(
      frame.getByText("Question 1 of 3", { exact: true }),
    ).toBeVisible()
  })
}

test("video Grow opens the one finder from the original lean button; Explore has no finder entry", async ({
  page,
}) => {
  await page.goto(videoPath)
  await tab(page, "Explore faith").click()
  await expect(page.getByTestId("watch-find-open")).toHaveCount(0)
  await tab(page, "Grow in faith").click()
  const open = page.getByTestId("watch-find-open")
  await expect(open).toHaveCount(1)
  await open.click()
  await expect(
    page.getByRole("dialog", { name: "Find films for you" }),
  ).toBeVisible()
  await expect(page.getByTestId("watch-find-flow")).toHaveCount(1)
})

test("home shows each role's compact line with canonical pills, no questionnaire", async ({
  page,
}) => {
  await page.goto("/watch")
  const band = page.getByTestId("watch-home-role-band")
  for (const role of WATCH_AUDIENCE_CODE_CONFIG.roles) {
    await tab(page, role.label).click()
    await expect(band).toHaveAttribute("data-role", role.id)
    await expect(band.getByTestId("watch-role-journey")).toHaveCount(0)
    const pills = band.getByRole("tabpanel").locator("a")
    await expect(pills.first()).toBeVisible()
    for (const href of await pills.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    )) {
      expect(href).toMatch(/^(\/watch\/|https:\/\/)/)
    }
  }
})

test("Share survives result navigation and reload with the selected audio language", async ({
  page,
}) => {
  await page.goto(`${videoPath}/${audioLanguage}.html`)
  const frame = page.getByTestId("watch-next-steps")
  await expect(
    frame.getByText("English resources", { exact: true }),
  ).toBeVisible()
  await tab(page, "Share your faith").click()
  await frame.getByRole("button", { name: "Family", exact: true }).click()
  await frame.getByRole("button", { name: "Curious", exact: true }).click()
  await frame
    .getByRole("button", { name: "Watch it together", exact: true })
    .click()
  const result = frame.getByTestId("watch-journey-result").getByRole("link")
  await expect(result).toHaveAttribute(
    "href",
    `/watch/conversation-starters.html/${audioLanguage}.html`,
  )
  await result.click()
  await expect(page).toHaveURL(
    (url) =>
      url.pathname ===
      `/watch/conversation-starters.html/${audioLanguage}.html`,
  )
  await page.goto(`/watch/${audioLanguage}.html`)
  await expect(tab(page, "Share your faith")).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await page.reload()
  await expect(tab(page, "Share your faith")).toHaveAttribute(
    "aria-selected",
    "true",
  )
})

test("390px keyboard selection has one labelled panel, unique ids and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(videoPath)
  const explore = tab(page, "Explore faith")
  const partner = tab(page, "Partner with us")
  await explore.focus()
  await page.keyboard.press("End")
  await expect(partner).toBeFocused()
  await expect(partner).toHaveAttribute("aria-selected", "true")
  const panel = page.getByTestId("watch-next-steps-panel")
  await expect(panel).toHaveCount(1)
  expect(await panel.getAttribute("aria-labelledby")).toBe(
    await partner.getAttribute("id"),
  )
  expect(await partner.getAttribute("aria-controls")).toBe(
    await panel.getAttribute("id"),
  )
  await page.keyboard.press("ArrowRight")
  await expect(explore).toBeFocused()
  const ids = await page
    .locator("[id]")
    .evaluateAll((elements) => elements.map((element) => element.id))
  expect(new Set(ids).size).toBe(ids.length)
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true)
})
