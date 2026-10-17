import { expect, test, type Locator } from "@playwright/test"

import {
  isSafeWatchAudienceTarget,
  rankWatchAudienceActions,
  type WatchAudienceConfig,
} from "../src/lib/watch-audience-config"

// Runs against the real stage preview and the real Admin it reads: the
// expectation is whatever Admin publishes for the default template right now
// (`WatchSetting.watchAudience`), so there is no fixture, mock API or
// intercepted route. The coordinator seeds and publishes a local configuration
// (import script -> human publish) and owns revalidation, editor and
// production-load measurements.
const adminUrl =
  process.env.WATCH_AUDIENCE_ADMIN_GRAPHQL_URL ??
  process.env.ADMIN_GRAPHQL_URL ??
  "http://127.0.0.1:3003/api/graphql"
const bearer =
  process.env.WATCH_AUDIENCE_ADMIN_BEARER ??
  process.env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim() ??
  "playwright-test-key"
const configLocale = process.env.WATCH_AUDIENCE_CONFIG_LOCALE ?? "en"
const videoPath =
  process.env.WATCH_AUDIENCE_TEST_VIDEO_PATH ?? "/watch/jesus.html"
const surfaces = ["/watch", videoPath] as const

async function publishedConfig(): Promise<WatchAudienceConfig | null> {
  const response = await fetch(adminUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      query: `query($locale: String!) {
        watchSetting(locale: $locale) {
          watchAudience(locale: $locale) { configJson rejected }
        }
      }`,
      variables: { locale: configLocale },
    }),
  })
  expect(response.ok, `Admin answered ${response.status}`).toBe(true)
  const body = (await response.json()) as {
    errors?: unknown
    data?: {
      watchSetting: {
        watchAudience: { configJson: string | null; rejected: boolean } | null
      } | null
    }
  }
  expect(body.errors).toBeUndefined()
  const projection = body.data?.watchSetting?.watchAudience
  if (!projection) return null
  expect(projection.rejected).toBe(false)
  return JSON.parse(projection.configJson ?? "null") as WatchAudienceConfig
}

async function definitionOf(frame: Locator, config: WatchAudienceConfig) {
  const roles: { label: string; prompts: string[] }[] = []
  for (const role of config.roles) {
    await frame.getByRole("tab", { name: role.label, exact: true }).click()
    const prompts: string[] = []
    for (let step = 0; step < 3; step += 1) {
      prompts.push((await frame.locator("h3").first().innerText()).trim())
      await frame.locator("[data-option-id]").first().click()
    }
    roles.push({ label: role.label, prompts })
    await frame.getByRole("button", { name: "Start over", exact: true }).click()
  }
  return roles
}

test.describe("published audience configuration", () => {
  let config: WatchAudienceConfig

  test.beforeAll(async () => {
    const published = await publishedConfig()
    expect(
      published,
      `no published watchAudience for "${configLocale}"; import and publish the local fixture first`,
    ).not.toBeNull()
    config = published!
  })

  for (const path of surfaces) {
    test(`${path} shows exactly the published roles and questions`, async ({
      page,
    }) => {
      await page.goto(path)
      const frame = page.getByTestId("watch-next-steps")
      await expect(frame).toHaveCount(1)
      const labels = await frame.getByRole("tab").allInnerTexts()
      expect(labels.map((label) => label.trim())).toEqual(
        config.roles.map((role) => role.label),
      )
      for (const role of config.roles) {
        await frame.getByRole("tab", { name: role.label, exact: true }).click()
        for (let step = 0; step < 3; step += 1) {
          await expect(
            frame.getByRole("heading", {
              name: role.questions[step].prompt,
              exact: true,
            }),
          ).toBeVisible()
          const options = frame.locator("[data-option-id]")
          await expect(options).toHaveCount(role.questions[step].options.length)
          await options.first().click()
        }
      }
    })

    test(`${path} ranks with the published order and weights and never links an unsafe destination`, async ({
      page,
    }) => {
      await page.goto(path)
      const frame = page.getByTestId("watch-next-steps")
      for (const role of config.roles) {
        await frame.getByRole("tab", { name: role.label, exact: true }).click()
        const chosen = role.questions.map(
          (question) => question.options.at(-1)!,
        )
        for (let step = 0; step < 3; step += 1) {
          await frame
            .locator(`[data-option-id="${chosen[step].id}"]`)
            .first()
            .click()
        }
        const ranked = rankWatchAudienceActions(
          role,
          chosen.map((option) => option.id),
        )
        // The surface drops actions it cannot serve (e.g. current-video
        // controls on home), so the result is the first ranked action up to
        // and including the first one every surface serves.
        const firstUniversal = ranked.findIndex(
          ({ action }) => action.target.kind !== "current-video",
        )
        const allowed = ranked
          .slice(0, firstUniversal + 1)
          .map(({ action }) => action.id)
        const result = frame
          .getByTestId("watch-journey-result")
          .locator("[data-action-id]")
        await expect(result).toBeVisible()
        expect(allowed).toContain(await result.getAttribute("data-action-id"))
        await frame
          .getByRole("button", { name: "Start over", exact: true })
          .click()
      }
      const hrefs = await frame
        .locator("a[href]")
        .evaluateAll((anchors) =>
          anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
        )
      for (const href of hrefs) {
        expect(href).toMatch(/^(\/watch\/|https:\/\/)/)
      }
      for (const role of config.roles) {
        for (const action of role.actions) {
          expect(isSafeWatchAudienceTarget(action.target)).toBe(true)
        }
      }
    })
  }

  test("home and video present the same definition", async ({ page }) => {
    const seen: Awaited<ReturnType<typeof definitionOf>>[] = []
    for (const path of surfaces) {
      await page.goto(path)
      seen.push(
        await definitionOf(page.getByTestId("watch-next-steps"), config),
      )
    }
    expect(seen[1]).toEqual(seen[0])
  })

  test("serves no session state with the page", async ({ request }) => {
    const response = await request.get("/watch")
    expect(response.headers()["set-cookie"]).toBeUndefined()
  })
})
