import { expect, test, type Locator } from "@playwright/test"

import { WATCH_AUDIENCE_CODE_CONFIG } from "../src/lib/watch-audience-config"

const videoPath =
  process.env.WATCH_AUDIENCE_TEST_VIDEO_PATH ?? "/watch/jesus.html"
const audioLanguage =
  process.env.WATCH_AUDIENCE_TEST_LANGUAGE_SLUG ?? "spanish-latin-american"

// Runs against real Watch home/video content; no questionnaire-only fixture or
// mocked player. The coordinator supplies the stage-enabled preview and owns
// production-load, analytics-receipt and playback measurements.
async function answerFirstOptions(frame: Locator) {
  for (let step = 1; step <= 3; step += 1) {
    await expect(
      frame.getByText(`Question ${step} of 3`, { exact: true }),
    ).toBeVisible()
    await frame.locator("[data-option-id]").first().click()
  }
}

for (const path of ["/watch", videoPath]) {
  test.describe(`audience frame at ${path}`, () => {
    for (const role of WATCH_AUDIENCE_CODE_CONFIG.roles) {
      test(`${role.id}: answers, changes, resets and offers a real next step`, async ({
        page,
      }) => {
        await page.goto(path)
        const frame = page.getByTestId("watch-next-steps")
        await frame.getByRole("tab", { name: role.label, exact: true }).click()
        await answerFirstOptions(frame)
        await expect(
          frame.getByRole("heading", { name: role.finish, exact: true }),
        ).toBeVisible()
        const result = frame
          .getByTestId("watch-journey-result")
          .locator("[data-action-id]")
        await expect(result).toBeVisible()
        if (await result.evaluate((element) => element.tagName === "A")) {
          await expect(result).toHaveAttribute(
            "href",
            /^(\/watch\/|https:\/\/)/,
          )
        } else {
          await expect(result).toBeEnabled()
        }
        await expect(
          frame.getByTestId("watch-journey-alternatives"),
        ).toBeVisible()
        await frame.getByRole("button", { name: "Back", exact: true }).click()
        await expect(
          frame.getByText("Question 3 of 3", { exact: true }),
        ).toBeVisible()
        await frame.locator("[data-option-id]").first().click()
        await frame
          .getByRole("button", { name: "Change answers", exact: true })
          .click()
        await expect(
          frame.getByText("Question 1 of 3", { exact: true }),
        ).toBeVisible()
        await answerFirstOptions(frame)
        await frame
          .getByRole("button", { name: "Start over", exact: true })
          .click()
        await expect(
          frame.locator('[data-option-id][aria-pressed="true"]'),
        ).toHaveCount(0)
        await expect(
          frame.getByText("Question 1 of 3", { exact: true }),
        ).toBeVisible()
      })
    }
  })
}

test("Share survives result navigation and reload with the selected audio language", async ({
  page,
}) => {
  await page.goto(`/watch/${audioLanguage}.html`)
  const frame = page.getByTestId("watch-next-steps")
  await expect(
    frame.getByText("English resources", { exact: true }),
  ).toBeVisible()
  await frame
    .getByRole("tab", { name: "Share your faith", exact: true })
    .click()
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
  await expect(
    frame.getByRole("tab", { name: "Share your faith", exact: true }),
  ).toHaveAttribute("aria-selected", "true")
  await page.reload()
  await expect(
    frame.getByRole("tab", { name: "Share your faith", exact: true }),
  ).toHaveAttribute("aria-selected", "true")
  await expect(
    frame.getByText("Question 1 of 3", { exact: true }),
  ).toBeVisible()
})

test("390px keyboard selection has one labelled panel, unique ids and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(videoPath)
  const frame = page.getByTestId("watch-next-steps")
  const explore = frame.getByRole("tab", { name: "Explore faith", exact: true })
  const partner = frame.getByRole("tab", {
    name: "Partner with us",
    exact: true,
  })
  await explore.focus()
  await page.keyboard.press("End")
  await expect(partner).toBeFocused()
  await expect(partner).toHaveAttribute("aria-selected", "true")
  const panel = frame.getByRole("tabpanel")
  await expect(panel).toHaveCount(1)
  expect(await panel.getAttribute("aria-labelledby")).toBe(
    await partner.getAttribute("id"),
  )
  expect(await partner.getAttribute("aria-controls")).toBe(
    await panel.getAttribute("id"),
  )
  await page.keyboard.press("ArrowRight")
  await expect(explore).toBeFocused()
  const ids = await frame
    .locator("[id]")
    .evaluateAll((elements) => elements.map((element) => element.id))
  expect(new Set(ids).size).toBe(ids.length)
  expect(
    await frame.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true)
})
