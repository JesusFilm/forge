import { writeFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"

const fixturePath =
  "/watch/demo-search/recommendation-traffic-fixture?surface=seeded"

function card(position: number, label = "Saved") {
  return {
    id: `${label}-item-${position}`,
    position,
    targetMediaId: `${label}-target-${position}`,
    canonicalHref: `/watch/${label.toLowerCase()}-target-${position}.html`,
    candidateGenerator: "precomputed",
    contributors: [
      {
        generator: "precomputed",
        generatorVersion: "precomputed-watch-preview-v1",
        rank: position + 1,
      },
    ],
    capability: `fixture-capability-${position}`,
    videoSlug: `${label.toLowerCase()}-target-${position}`,
    videoTitle: `${label} target ${position}`,
    imageUrl: "https://image.mux.com/fixture/thumbnail.jpg",
    playbackId: "fixture-playback",
    sceneIndex: 0,
    description: "",
    startSeconds: 0,
    endSeconds: null,
    durationSeconds: 60,
    similarity: 0,
    themes: [],
    demographics: [],
    spiritualContext: [],
  }
}

function delivery(
  items: ReturnType<typeof card>[],
  result: "served" | "empty" | "unavailable" = items.length
    ? "served"
    : "empty",
) {
  return {
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    strategyVersion: "precomputed-watch-preview-v1",
    classifierVersion: "legacy-position-v0",
    generationId: "browser-fixture-generation",
    requestId: result === "unavailable" ? null : "browser-fixture-request",
    result,
    reason:
      result === "empty"
        ? "no_connections"
        : result === "unavailable"
          ? "precomputed_delivery_unavailable"
          : null,
    expiresAt:
      result === "unavailable"
        ? null
        : new Date(Date.now() + 60_000).toISOString(),
    requestedCount: 6,
    composedCount: items.length,
    shortfallReason: items.length < 6 ? "insufficient_candidates" : null,
    personalization: null,
    previewAttribution: {
      assignedStrategy: "precomputed-watch-preview-v1",
      actualStrategy:
        result === "unavailable" ? null : "precomputed-watch-preview-v1",
      generationId: "browser-fixture-generation",
      reason: null,
    },
    items,
  }
}

async function routeRecommendations(
  page: Page,
  responseFor: (
    seedMediaId: string,
    audioLanguageSlug: string,
  ) => Promise<ReturnType<typeof delivery>> | ReturnType<typeof delivery>,
) {
  await page.route("**/watch/api/recommendations**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/watch/api/recommendations") {
      const body = request.postDataJSON() as {
        seedMediaId: string
        audioLanguageSlug: string
      }
      const selected = await responseFor(
        body.seedMediaId,
        body.audioLanguageSlug,
      )
      await route
        .fulfill({
          json: { delivery: selected, deliveryDisposition: "measured" },
        })
        .catch(() => undefined)
    } else {
      await route.fulfill({ json: { receipts: [] } }).catch(() => undefined)
    }
  })
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  )
  await page.route("**/_next/image**", (route) => route.abort())
}

test("saved one and six card slates render after the player shell, with timing evidence", async ({
  browser,
}, testInfo) => {
  const evidence: Array<Record<string, unknown>> = []
  for (const count of [1, 6]) {
    const page = await browser.newPage()
    await routeRecommendations(page, () =>
      delivery(Array.from({ length: count }, (_, position) => card(position))),
    )
    const response = await page.goto(fixturePath)
    expect(await response!.text()).toContain("Player shell ready")
    await expect(page.getByTestId("player-shell")).toBeVisible()
    await expect(
      page.getByRole("link", { name: /Saved target 0/ }),
    ).toBeVisible()
    await expect(
      page.locator(
        '[data-block-type="SemanticRecommendations"][data-state="ready"]',
      ),
    ).toBeVisible()
    expect(await page.getByRole("link", { name: /Saved target/ }).count()).toBe(
      count,
    )
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming
      const paint = performance
        .getEntriesByType("paint")
        .find((entry) => entry.name === "first-contentful-paint")
      const recommendation = performance
        .getEntriesByType("resource")
        .find((entry) => entry.name.includes("/watch/api/recommendations")) as
        | PerformanceResourceTiming
        | undefined
      return {
        responseEnd: navigation.responseEnd,
        domContentLoaded: navigation.domContentLoadedEventEnd,
        firstContentfulPaint: paint?.startTime ?? null,
        recommendationStart: recommendation?.startTime ?? null,
        recommendationEnd: recommendation?.responseEnd ?? null,
        resourceCount: performance.getEntriesByType("resource").length,
      }
    })
    expect(timing.recommendationStart).not.toBeNull()
    expect(timing.recommendationStart!).toBeGreaterThan(timing.responseEnd)
    expect(timing.firstContentfulPaint).not.toBeNull()
    expect(timing.firstContentfulPaint!).toBeLessThan(timing.recommendationEnd!)
    evidence.push({ count, ...timing })
    await page.close()
  }
  await writeFile(
    testInfo.outputPath("precomputed-watch-timing.json"),
    JSON.stringify(evidence, null, 2),
  )
})

test("valid empty and both-failed deliveries hide only the recommendation row", async ({
  page,
}) => {
  let result: "empty" | "unavailable" = "empty"
  await routeRecommendations(page, async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
    return delivery([], result)
  })
  const firstResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/watch/api/recommendations",
  )
  await page.goto(fixturePath)
  await expect(page.getByTestId("player-shell")).toBeVisible()
  await expect(
    page.locator(
      '[data-block-type="SemanticRecommendations"][data-state="loading"]',
    ),
  ).toBeVisible()
  await firstResponse
  await expect(
    page.locator(
      '[data-block-type="SemanticRecommendations"][data-state="loading"]',
    ),
  ).toHaveCount(0)
  await expect(
    page.locator('[data-block-type="SemanticRecommendations"]'),
  ).toHaveCount(0)
  result = "unavailable"
  const secondResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/watch/api/recommendations",
  )
  await page.getByTestId("switch-seed").click()
  await expect(
    page.locator(
      '[data-block-type="SemanticRecommendations"][data-state="loading"]',
    ),
  ).toBeVisible()
  await secondResponse
  await expect(
    page.locator(
      '[data-block-type="SemanticRecommendations"][data-state="loading"]',
    ),
  ).toHaveCount(0)
  await expect(page.getByTestId("player-shell")).toBeVisible()
  await expect(
    page.locator('[data-block-type="SemanticRecommendations"]'),
  ).toHaveCount(0)
})

test("a playable alternative renders, then a changed audio choice hides the row", async ({
  page,
}) => {
  await routeRecommendations(page, (_seed, audio) =>
    audio === "english" ? delivery([card(0, "Alternative")]) : delivery([]),
  )
  await page.goto(fixturePath)
  await expect(
    page.getByRole("link", { name: /Alternative target 0/ }),
  ).toBeVisible()
  const spanishResponse = page.waitForResponse((response) => {
    if (new URL(response.url()).pathname !== "/watch/api/recommendations")
      return false
    return response.request().postDataJSON()?.audioLanguageSlug === "spanish"
  })
  await page.getByTestId("switch-audio").click()
  await spanishResponse
  await expect(
    page.getByRole("link", { name: /Alternative target 0/ }),
  ).toHaveCount(0)
  await expect(
    page.locator('[data-block-type="SemanticRecommendations"]'),
  ).toHaveCount(0)
  await expect(page.getByTestId("player-shell")).toBeVisible()
})

test("late source responses cannot replace the current source's saved cards", async ({
  page,
}) => {
  let releaseOld!: () => void
  let oldStarted!: () => void
  const oldStartedPromise = new Promise<void>((resolve) => {
    oldStarted = resolve
  })
  const oldPending = new Promise<void>((resolve) => {
    releaseOld = resolve
  })
  await routeRecommendations(page, async (source) => {
    if (source === "seed-fixture") {
      oldStarted()
      await oldPending
      return delivery([card(0, "Old")])
    }
    return delivery([card(0, "New")])
  })
  await page.goto(fixturePath)
  await expect(page.getByTestId("player-shell")).toBeVisible()
  await oldStartedPromise
  await page.getByTestId("switch-seed").click()
  await expect(page.getByRole("link", { name: /New target 0/ })).toBeVisible()
  releaseOld()
  await page.waitForTimeout(100)
  await expect(page.getByRole("link", { name: /Old target 0/ })).toHaveCount(0)
})
