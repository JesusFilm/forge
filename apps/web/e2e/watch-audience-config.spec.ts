import { expect, test, type Locator, type Page } from "@playwright/test"
import { WatchAudienceConfigurationSchema } from "@forge/experience-schema"

import {
  isSafeWatchAudienceTarget,
  rankWatchAudienceActions,
  type WatchAudienceConfig,
  type WatchAudienceRoleDefinition,
} from "../src/lib/watch-audience-config"

// Real Admin publication and real Web/Auth session contracts: no intercepted
// routes, fabricated cookies or client-side auth bypass. The disposable preview
// owns published fixtures plus an UNPUBLISHED draft containing the sentinel.
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
const draftSentinel = process.env.WATCH_AUDIENCE_DRAFT_SENTINEL
// Supplied only after a genuine hosted Auth round trip (never committed).
const sessionCookie = process.env.WATCH_PARTNER_TEST_SESSION_COOKIE

async function publishedConfig(): Promise<WatchAudienceConfig> {
  const response = await fetch(adminUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      query: `query($locale: String!) {
        watchSetting(locale: $locale) {
          watchAudience(locale: $locale) { configJson rejected sourceLocale sourceBlockId }
        }
      }`,
      variables: { locale: configLocale },
    }),
  })
  expect(response.ok, `Admin answered ${response.status}`).toBe(true)
  const text = await response.text()
  expect(
    draftSentinel,
    "requires an unpublished draft sentinel fixture",
  ).toBeTruthy()
  expect(text).not.toContain(draftSentinel!)
  const body = JSON.parse(text) as {
    errors?: unknown
    data?: {
      watchSetting: {
        watchAudience: {
          configJson: string | null
          rejected: boolean
          sourceLocale: string
          sourceBlockId: string
        } | null
      } | null
    }
  }
  expect(body.errors).toBeUndefined()
  const projection = body.data?.watchSetting?.watchAudience
  expect(projection, "requires a published local audience fixture").toBeTruthy()
  expect(projection!.rejected).toBe(false)
  expect(projection!.sourceLocale).toBeTruthy()
  expect(projection!.sourceBlockId).toBeTruthy()
  const parsed = WatchAudienceConfigurationSchema.safeParse(
    JSON.parse(projection!.configJson!),
  )
  expect(parsed.success).toBe(true)
  if (!parsed.success) throw new Error("Invalid public audience projection")
  return parsed.data
}

function tabs(page: Page) {
  return page.getByTestId("watch-role-tabs")
}

async function selectRole(page: Page, role: WatchAudienceRoleDefinition) {
  const tab = tabs(page).getByRole("tab", { name: role.label, exact: true })
  // Minimum auto-scroll can leave a tab beneath the fixed Watch header.
  // Center it as a visitor would before an ordinary, actionable pointer click.
  await tab.evaluate((element) => element.scrollIntoView({ block: "center" }))
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
}

async function checkQuestions(
  frame: Locator,
  role: WatchAudienceRoleDefinition,
) {
  for (const question of role.questions) {
    await expect(
      frame.getByRole("heading", { name: question.prompt, exact: true }),
    ).toBeVisible()
    const options = frame.locator("[data-option-id]")
    await expect(options).toHaveCount(question.options.length)
    for (const option of question.options) {
      await expect(
        frame.locator(`[data-option-id="${option.id}"]`),
      ).toContainText(option.label)
    }
    await options.first().click()
  }
  await frame.getByRole("button", { name: "Start over", exact: true }).click()
}

async function checkRanking(frame: Locator, role: WatchAudienceRoleDefinition) {
  const chosen = role.questions.map((question) => question.options.at(-1)!)
  for (const option of chosen) {
    await frame.locator(`[data-option-id="${option.id}"]`).click()
  }
  const ranked = rankWatchAudienceActions(
    role,
    chosen.map((option) => option.id),
  )
  // A video may omit controls it cannot serve; the first universal target
  // bounds the possible winner without accepting any lower-ranked action.
  const firstUniversal = ranked.findIndex(
    ({ action }) => action.target.kind !== "current-video",
  )
  expect(firstUniversal).toBeGreaterThanOrEqual(0)
  const allowed = ranked
    .slice(0, firstUniversal + 1)
    .map(({ action }) => action.id)
  const result = frame
    .getByTestId("watch-journey-result")
    .locator("[data-action-id]")
  await expect(result).toBeVisible()
  expect(allowed).toContain(await result.getAttribute("data-action-id"))
  await frame.getByRole("button", { name: "Start over", exact: true }).click()
}

test.describe("published audience configuration", () => {
  let config: WatchAudienceConfig
  test.beforeAll(async () => {
    config = await publishedConfig()
  })

  test.afterEach(async ({ page }) => {
    // Includes serialized HTML/RSC, not just currently visible authored copy.
    expect(await page.content()).not.toContain(draftSentinel!)
  })

  test("home presents the published roles in the compact navigation band", async ({
    page,
  }) => {
    await page.goto("/watch")
    await expect(page.getByTestId("watch-home-tv-carousel")).toBeVisible()
    const band = page.getByTestId("watch-home-role-band")
    await expect(band).toHaveCount(1)
    expect(
      (await tabs(page).getByRole("tab").allInnerTexts()).map((label) =>
        label.trim(),
      ),
    ).toEqual(config.roles.map((role) => role.label))
    await expect(page.getByTestId("watch-next-steps")).toHaveCount(0)
    await expect(page.getByTestId("watch-role-journey")).toHaveCount(0)
    for (const role of config.roles) {
      await selectRole(page, role)
      await expect(band).toHaveAttribute("data-role", role.id)
      const pills = band.getByRole("tabpanel").getByRole("link")
      await expect(pills.first()).toBeVisible()
      for (const href of await pills.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")),
      )) {
        expect(href).toMatch(/^(\/watch\/|https:\/\/)/)
      }
    }
  })

  test("video uses external published tabs and exact questions/ranking; anonymous Partner stays locked", async ({
    page,
  }) => {
    await page.goto(videoPath)
    const frame = page.getByTestId("watch-next-steps")
    await expect(frame).toHaveCount(1)
    await expect(frame.getByRole("tab")).toHaveCount(0)
    expect(
      (await tabs(page).getByRole("tab").allInnerTexts()).map((label) =>
        label.trim(),
      ),
    ).toEqual(config.roles.map((role) => role.label))
    for (const role of config.roles) {
      await selectRole(page, role)
      await expect(frame).toHaveAttribute("data-role", role.id)
      if (role.id === "partner") {
        await expect(page.getByTestId("watch-partner-panel")).toHaveAttribute(
          "data-account-state",
          "signed-out",
        )
        await expect(frame.getByTestId("watch-role-journey")).toHaveCount(0)
        await expect(
          page.getByTestId("watch-partner-download-tools"),
        ).toHaveCount(0)
      } else {
        await checkQuestions(frame, role)
        await checkRanking(frame, role)
      }
      for (const action of role.actions)
        expect(isSafeWatchAudienceTarget(action.target)).toBe(true)
    }
  })

  test("genuine signed-in Partner sees the published questionnaire and resources", async ({
    page,
    context,
    baseURL,
  }) => {
    expect(
      sessionCookie,
      "requires a session from a real hosted Auth round trip",
    ).toBeTruthy()
    await context.addCookies([
      {
        name: "forge_web_session",
        value: sessionCookie!,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ])
    const sessionResponse = await context.request.get(
      `/watch/api/auth/session?callbackURL=${encodeURIComponent(videoPath)}`,
    )
    expect(sessionResponse.ok()).toBe(true)
    expect((await sessionResponse.json()).authenticated).toBe(true)
    await page.goto(videoPath)
    const role = config.roles.find((role) => role.id === "partner")!
    await selectRole(page, role)
    await expect(page.getByTestId("watch-partner-panel")).toHaveAttribute(
      "data-account-state",
      "signed-in",
    )
    const frame = page.getByTestId("watch-next-steps")
    await checkQuestions(frame, role)
    await checkRanking(frame, role)
    await expect(page.getByTestId("watch-partner-resources")).toBeVisible()
    for (const link of await frame.locator("a[href]").all()) {
      await expect(link).toHaveAttribute("href", /^(\/watch\/|https:\/\/)/)
    }
  })

  test("home defers category requests and persona chunks until intent, without progress writes", async ({
    page,
  }) => {
    const routeRequests: string[] = []
    const writes: string[] = []
    const scriptUrls = new Set<string>()
    const scriptBodies = async () =>
      Promise.all(
        [...scriptUrls].map(async (url) => {
          // Inspect immutable sources for URLs the browser actually requested.
          // Chromium can evict cached/preload response bodies before CDP reads
          // them; a separate HTTP read keeps that cache artifact out of proof.
          const response = await page.request.get(url)
          expect(response.ok(), `script source ${url}`).toBe(true)
          return response.text()
        }),
      )
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.searchParams.has("_rsc")) routeRequests.push(url.pathname)
      if (
        url.origin === new URL(page.url()).origin &&
        url.pathname.includes("/_next/static/chunks/") &&
        url.pathname.endsWith(".js")
      )
        scriptUrls.add(url.href)
      if (
        request.method() === "POST" &&
        /learning|progress|audience|finder/.test(url.pathname)
      )
        writes.push(url.pathname)
    })
    await page.goto("/watch")
    await expect(page.getByTestId("watch-home-tv-carousel")).toBeVisible()
    await expect(page.getByTestId("watch-home-role-band")).toBeVisible()
    // Observe the same initial-entry window used for production sampling.
    await page.waitForTimeout(3500)
    const scripts = await scriptBodies()
    const hero = page.getByTestId("watch-home-tv-actions").getByRole("link")
    const heroPaths = await hero.evaluateAll((links) =>
      links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
    )
    const category = page.getByTestId("watch-home-category-see-all")
    const href = await category.getAttribute("href")
    expect(href).toBeTruthy()
    const categoryPath = new URL(href!, page.url()).pathname
    // The existing hero may prefetch its own film; no other route is eager.
    expect(routeRequests.filter((path) => !heroPaths.includes(path))).toEqual(
      [],
    )
    expect(routeRequests).not.toContain(categoryPath)
    expect(scripts.length).toBeGreaterThan(0)
    for (const marker of [
      "watch-grow-course",
      "watch-partner-download-tools",
      "watch-share-kit-launcher",
    ]) {
      expect(
        scripts.some((body) => body.includes(marker)),
        marker,
      ).toBe(false)
    }
    expect(writes).toEqual([])
    // Entering the viewport alone must not arm category links either.
    await category.scrollIntoViewIfNeeded()
    await expect(category).toBeInViewport()
    await page.waitForTimeout(1000)
    expect(routeRequests.filter((path) => !heroPaths.includes(path))).toEqual(
      [],
    )
    expect(writes).toEqual([])
    // Keyboard intent arms only this link, and ordinary navigation still works.
    await category.focus()
    await expect.poll(() => routeRequests.includes(categoryPath)).toBe(true)
    await category.press("Enter")
    await expect(page).toHaveURL((url) => url.pathname === categoryPath)
    // Positive control: these same resource markers arrive after selecting
    // Share on video, so absence on home cannot pass through an inert probe.
    await page.goto(videoPath)
    const share = config.roles.find((role) => role.id === "share")!
    await selectRole(page, share)
    await expect(page.getByTestId("watch-share-ideas")).toBeVisible()
    const afterIntentScripts = await scriptBodies()
    expect(
      afterIntentScripts.some((body) =>
        body.includes("watch-share-kit-launcher"),
      ),
    ).toBe(true)
  })

  test("cached home and video HTML contain neither session cookies nor draft content", async ({
    request,
  }) => {
    for (const path of ["/watch", videoPath]) {
      const response = await request.get(path)
      expect(response.ok()).toBe(true)
      expect(response.headers()["set-cookie"]).toBeUndefined()
      expect(await response.text()).not.toContain(draftSentinel!)
    }
  })
})
