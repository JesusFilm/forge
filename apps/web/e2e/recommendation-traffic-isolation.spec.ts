import { writeFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"

const fixturePath = "/watch/demo-search/recommendation-traffic-fixture"
const sentinel = "contextual-fallback-unattributed-v1"
type Surface = "seeded" | "for-you"
type Attempt = { path: string; body: Record<string, unknown> }

function envelope(surface: Surface, sequence: number, contextual = false) {
  const items = Array.from(
    { length: surface === "seeded" ? 1 : 6 },
    (_, position) => ({
      id: `item-${position}`,
      position,
      targetMediaId: `target-${position}`,
      canonicalHref: `/watch/traffic-target-${position}.html`,
      candidateGenerator: "semantic",
      contributors: [],
      capability: contextual ? sentinel : "fixture-delivery-capability",
      videoId: `target-${position}`,
      videoSlug: `traffic-target-${position}`,
      videoTitle: `Fixture target ${position}`,
      imageUrl: "https://image.mux.com/fixture/thumbnail.jpg",
      playbackId: "fixture-playback",
      sceneIndex: 0,
      description: "Synthetic browser fixture",
      startSeconds: 0,
      endSeconds: null,
      durationSeconds: 60,
      similarity: 0.9,
      themes: [],
      demographics: [],
      spiritualContext: [],
    }),
  )
  return {
    contractVersion:
      surface === "seeded"
        ? "semantic-recommendation-v1"
        : "user-recommendation-v1",
    surfaceVersion:
      surface === "seeded" ? "watch-below-player-v1" : "watch-for-you-v1",
    strategyVersion: "browser-fixture-v1",
    classifierVersion: "browser-fixture-v1",
    requestId: contextual ? null : `fixture-${surface}-${sequence}`,
    result: contextual && surface === "seeded" ? "fallback" : "served",
    reason: contextual ? "traffic_contextual" : null,
    expiresAt: contextual ? null : new Date(Date.now() + 60000).toISOString(),
    requestedCount: items.length,
    composedCount: items.length,
    shortfallReason: null,
    personalization: null,
    items,
  }
}

async function intercept(
  page: Page,
  surface: Surface,
  options: {
    deferredFirst?: boolean
    contextual?: boolean
    deliveryDelay?: number
  } = {},
) {
  const attempts: Attempt[] = []
  let deliveryCount = 0
  const endpoint =
    surface === "seeded"
      ? "/watch/api/recommendations"
      : "/watch/api/recommendations/for-you"
  await page.route("**/watch/api/recommendations**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const body =
      request.method() === "POST"
        ? (request.postDataJSON() as Record<string, unknown>)
        : {}
    attempts.push({ path, body })
    if (path === endpoint) {
      deliveryCount += 1
      if (options.deliveryDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, options.deliveryDelay),
        )
      if (options.deferredFirst && deliveryCount === 1) {
        const delivery = envelope(surface, deliveryCount)
        await route.fulfill({
          json: {
            deliveryDisposition: "deferred",
            delivery: {
              ...delivery,
              requestId: null,
              expiresAt: null,
              result: "unavailable",
              reason: "traffic_deferred",
              items: [],
            },
          },
        })
      } else {
        await route.fulfill({
          json: {
            deliveryDisposition: options.contextual ? "contextual" : "measured",
            delivery: envelope(surface, deliveryCount, options.contextual),
          },
        })
      }
    } else if (path.endsWith("/profile") && options.contextual) {
      await route.fulfill({
        status: 403,
        json: { error: "machine_profile_rejected" },
      })
    } else if (path.endsWith("/playback") && options.contextual) {
      await route.fulfill({
        status: 403,
        json: { error: "machine_evidence_rejected" },
      })
    } else if (path.endsWith("/profile")) {
      const active = body.action === "grant"
      await route.fulfill({
        json: {
          profile: {
            consentContractVersion: "recommendation-consent-v1",
            consentChoice: active ? "personalization" : "undecided",
            state: active ? "active" : "session_only",
            choice: active ? "durable_allowed" : "session_only",
            privacyGeneration: active ? 1 : null,
            expiresAt: active
              ? new Date(Date.now() + 60000).toISOString()
              : null,
            erasureState: "not_required",
            cookieDisposition: "keep",
            consentCookieDisposition: "keep",
            consentExpiresAt: active
              ? new Date(Date.now() + 60000).toISOString()
              : null,
          },
        },
      })
    } else if (path.endsWith("/select")) {
      await route.fulfill({
        json: {
          claimNonce: body.claimNonce,
          canonicalHref: "/watch/traffic-target-0.html",
          targetMediaId: "target-0",
        },
      })
    } else if (path.endsWith("/playback") && body.action === "claim") {
      await route.fulfill({
        json: {
          episode: {
            episodeId: "fixture-episode",
            capability: "fixture-episode-capability",
            activeUntil: new Date(Date.now() + 60000).toISOString(),
            hardUntil: new Date(Date.now() + 120000).toISOString(),
          },
        },
      })
    } else {
      const events = body.events as Array<{ eventId: string }> | undefined
      await route.fulfill({
        json: {
          receipts: (events ?? []).map((event) => ({
            eventId: event.eventId,
            status: "accepted",
          })),
        },
      })
    }
  })
  // No synthetic media, remote catalog or provider requests leave this browser.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.abort(),
  )
  await page.route("**/_next/image**", (route) => route.abort())
  return { attempts, deliveryCount: () => deliveryCount }
}

async function timing(page: Page) {
  return page.evaluate(() => ({
    navigation: performance.getEntriesByType("navigation").map((entry) => {
      const navigation = entry as PerformanceNavigationTiming
      return {
        responseEnd: navigation.responseEnd,
        domContentLoaded: navigation.domContentLoadedEventEnd,
        load: navigation.loadEventEnd,
      }
    }),
    paint: performance
      .getEntriesByType("paint")
      .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
    requests: performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/api/recommendations"))
      .map((entry) => {
        const resource = entry as PerformanceResourceTiming
        return {
          path: new URL(resource.name).pathname,
          startTime: resource.startTime,
          duration: resource.duration,
          responseEnd: resource.responseEnd,
        }
      }),
    activationAt:
      (window as Window & { fixtureActivationAt?: number })
        .fixtureActivationAt ?? null,
  }))
}

for (const surface of ["seeded", "for-you"] as const) {
  test(`${surface}: ordinary baseline and simulated prerender activation preserve attribution`, async ({
    browser,
  }, testInfo) => {
    // This tests a document lifecycle property fixture, not Chrome's native prerender implementation.
    const baseline = await browser.newPage()
    const ordinary = await intercept(baseline, surface, { deliveryDelay: 300 })
    const response = await baseline.goto(`${fixturePath}?surface=${surface}`)
    expect(await response!.text()).toContain("Player shell ready")
    await expect(baseline.getByTestId("player-shell")).toBeVisible()
    await expect(
      baseline.getByRole("link", { name: /Fixture target 0/ }),
    ).toBeVisible()
    expect(ordinary.deliveryCount()).toBe(1)
    const baselineTiming = await timing(baseline)
    const ordinaryDelivery = baselineTiming.requests.find(
      (request) =>
        request.path ===
        (surface === "seeded"
          ? "/watch/api/recommendations"
          : "/watch/api/recommendations/for-you"),
    )!
    expect(ordinaryDelivery.startTime).toBeGreaterThan(
      baselineTiming.navigation[0].responseEnd,
    )
    expect(
      baselineTiming.paint.find(
        (entry) => entry.name === "first-contentful-paint",
      )!.startTime,
    ).toBeLessThan(ordinaryDelivery.responseEnd)
    await baseline.close()

    const page = await browser.newPage()
    await page.addInitScript(() =>
      Object.defineProperty(document, "prerendering", {
        configurable: true,
        writable: true,
        value: true,
      }),
    )
    const deferred = await intercept(page, surface, {
      deferredFirst: true,
      deliveryDelay: 300,
    })
    await page.goto(`${fixturePath}?surface=${surface}`)
    await expect(page.getByTestId("traffic-fixture")).toHaveAttribute(
      "data-hydrated",
      "true",
    )
    await expect(page.getByTestId("player-shell")).toBeVisible()
    await page.waitForTimeout(250)
    expect(deferred.attempts).toEqual([])
    const beforeActivation = await timing(page)
    expect(beforeActivation.requests).toEqual([])
    await page.evaluate(() => {
      ;(
        window as Window & { fixtureActivationAt?: number }
      ).fixtureActivationAt = performance.now()
      Object.defineProperty(document, "prerendering", { value: false })
      document.dispatchEvent(new Event("prerenderingchange"))
      document.dispatchEvent(new Event("prerenderingchange"))
    })
    const card = page.getByRole("link", { name: /Fixture target 0/ })
    await expect(card).toBeVisible()
    await page.bringToFront()
    await card.scrollIntoViewIfNeeded()

    await expect
      .poll(
        () =>
          deferred.attempts.filter(
            (attempt) =>
              (attempt.body.events as Array<{ kind: string }> | undefined)?.[0]
                ?.kind === "impression",
          ).length,
      )
      .toBeGreaterThan(0)
    expect(deferred.deliveryCount()).toBe(2)
    expect(
      deferred.attempts
        .filter((attempt) => attempt.path.endsWith("/profile"))
        .map((attempt) => attempt.body.action),
    ).toEqual(["status", "grant"])
    const rendered = deferred.attempts.filter(
      (attempt) =>
        (attempt.body.events as Array<{ kind: string }> | undefined)?.[0]
          ?.kind === "render",
    )
    expect(rendered).toHaveLength(surface === "seeded" ? 1 : 6)
    expect(
      rendered.every(
        (attempt) =>
          attempt.body.requestId === `fixture-${surface}-2` &&
          attempt.body.capability === "fixture-delivery-capability",
      ),
    ).toBe(true)
    const activeTiming = await timing(page)
    expect(
      activeTiming.requests.every(
        (request) => request.startTime >= activeTiming.activationAt!,
      ),
    ).toBe(true)
    expect(
      activeTiming.requests.every(
        (request) => request.startTime > activeTiming.navigation[0].responseEnd,
      ),
    ).toBe(true)
    await card.click()
    await expect(page.getByTestId("destination")).toHaveAttribute(
      "data-href",
      "/watch/traffic-target-0.html",
    )
    await expect
      .poll(
        () =>
          deferred.attempts.filter((attempt) => attempt.body.action === "claim")
            .length,
      )
      .toBe(1)
    const selection = deferred.attempts.find((attempt) =>
      attempt.path.endsWith("/select"),
    )!
    const claim = deferred.attempts.find(
      (attempt) => attempt.body.action === "claim",
    )!
    expect(selection.body.requestId).toBe(`fixture-${surface}-2`)
    expect(claim.body.claimNonce).toBe(selection.body.claimNonce)
    expect(claim.body.mediaId).toBe("target-0")
    expect(await page.locator("body").innerHTML()).not.toMatch(
      /fixture-delivery-capability|fixture-episode-capability/,
    )
    await expect
      .poll(() =>
        page.evaluate(() =>
          sessionStorage.getItem("forge.recommendation.tab-correlation-v1"),
        ),
      )
      .toBeNull()
    // Dispatch a synthetic persisted pageshow; this is BFCache lifecycle handling, not an actual cache restore.
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    )
    await expect.poll(deferred.deliveryCount).toBe(3)
    const timingPath = testInfo.outputPath("request-timing.json")
    await writeFile(
      timingPath,
      JSON.stringify(
        {
          fixture: "simulated-prerender-and-BFCache-events",
          surface,
          ordinary: baselineTiming,
          beforeActivation,
          activated: activeTiming,
          initialDeliveryCount: 2,
          selectionCount: 1,
          claimCount: 1,
        },
        null,
        2,
      ),
    )
    await testInfo.attach("request-timing.json", {
      path: timingPath,
      contentType: "application/json",
    })
    await page.close()
  })
}

for (const surface of ["seeded", "for-you"] as const) {
  test(`${surface}: renders contextual crawler responses without attributed actions`, async ({
    browser,
  }) => {
    // Origin rejection and database exclusion are separately tested at their service boundaries.
    const page = await browser.newPage({ userAgent: "Applebot/fixture" })
    const crawler = await intercept(page, surface, { contextual: true })
    await page.goto(`${fixturePath}?surface=${surface}`)
    const card = page.getByRole("link", { name: /Fixture target 0/ })
    await expect(card).toBeVisible()
    expect(await card.getAttribute("href")).toBe("/watch/traffic-target-0.html")
    await card.click()
    await expect(page.getByTestId("destination")).toHaveAttribute(
      "data-href",
      "/watch/traffic-target-0.html",
    )
    expect(crawler.deliveryCount()).toBe(1)
    expect(
      crawler.attempts.some(
        (attempt) =>
          attempt.path.endsWith("/evidence") ||
          attempt.path.endsWith("/select") ||
          attempt.body.action === "grant" ||
          attempt.body.action === "claim",
      ),
    ).toBe(false)
    expect(await page.locator("body").innerHTML()).not.toMatch(
      /fixture-delivery-capability|fixture-episode-capability/,
    )
    await page.close()
  })
}
