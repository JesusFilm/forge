import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SignJWT } from "jose"
import {
  adminPrivatePrecomputedWatchVisitDeliveryOperation,
  adminPrivateSemanticRecommendationFallbackOperation,
} from "@forge/admin-graphql/operations"
import {
  createRecommendationExperimentTesterLink,
  exchangeRecommendationExperimentTesterLink,
  readRecommendationExperimentTesterCookie,
  RECOMMENDATION_EXPERIMENT_TESTER_COOKIE,
} from "@/lib/recommendation-tester-token"
import {
  createRecommendationExperimentBrowser,
  RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
} from "@/lib/recommendation-experiment-browser"
import { resetRecommendationMutationAdmissionForTests } from "@/lib/recommendation-mutation-admission"

const { query, secret } = vi.hoisted(() => ({
  query: vi.fn(),
  secret: "private-watch-experiment-test-secret-".repeat(3),
}))
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example",
    WATCH_PRECOMPUTED_RECOMMENDATIONS_TEST_ENABLED: "true",
    WATCH_RECOMMENDATION_TESTER_SECRET: secret,
  },
}))
vi.mock("@/lib/admin-client", () => ({ default: { query } }))

const { POST } = await import("./route")
const { POST: exchange } = await import("./experiment-tester/route")
const config = { secret, origin: "https://watch.example" }
const testerId = "11111111-1111-4111-8111-111111111111"
const visitId = "22222222-2222-4222-8222-222222222222"
const delivery = {
  contractVersion: "semantic-recommendation-v1",
  surfaceVersion: "watch-below-player-v1",
  strategyVersion: "precomputed-watch-preview-v1",
  classifierVersion: "legacy-position-v0",
  generationId: "generation-1",
  requestId: "request-1",
  result: "served",
  reason: null,
  expiresAt: "2026-10-05T04:00:00.000Z",
  requestedCount: 6,
  composedCount: 1,
  shortfallReason: "insufficient_candidates",
  personalization: null,
  items: [
    {
      id: "item-1",
      position: 0,
      targetMediaId: "target-1",
      canonicalHref: "/watch/target-1.html",
      candidateGenerator: "precomputed",
      contributors: [
        {
          generator: "precomputed",
          generatorVersion: "precomputed-watch-preview-v1",
          rank: 1,
        },
      ],
      capability: "capability-1",
      videoSlug: "target-1",
      videoTitle: "Target 1",
      imageUrl: null,
      sceneIndex: 0,
      description: "",
      startSeconds: 0,
      endSeconds: null,
      durationSeconds: 60,
      similarity: 0,
      themes: [],
      demographics: [],
      spiritualContext: [],
      playbackId: "playback-1",
    },
  ],
}
const privateResult = (status: "eligible" | "excluded" | "unavailable") => ({
  status,
  visitId,
  experimentId: "private-test-1",
  generationId: "generation-1",
  arm: status === "eligible" ? "challenger" : null,
  reason: status === "eligible" ? null : "outside_frozen_cohort",
  qualification: "unverified_browser",
  measurementStatus: status === "eligible" ? "recorded" : "not_applicable",
  delivery: status === "eligible" ? delivery : null,
})

let testerCookie: string
function request(
  options: {
    browser?: boolean
    bot?: boolean
    visit?: boolean
    essentialOnly?: boolean
    visitId?: string
  } = {},
) {
  const browser = createRecommendationExperimentBrowser(secret)!
  const cookie = [
    `${RECOMMENDATION_EXPERIMENT_TESTER_COOKIE}=${testerCookie}`,
    ...(options.browser === false
      ? []
      : [`${RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE}=${browser.value}`]),
    ...(options.essentialOnly
      ? [`forge_recommendation_consent=v1.${"a".repeat(43)}.-`]
      : []),
  ].join("; ")
  return new Request("https://watch.example/watch/api/recommendations", {
    method: "POST",
    headers: {
      origin: "https://watch.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...(options.visit === false
        ? {}
        : { "x-forge-recommendation-visit-id": options.visitId ?? visitId }),
      ...(options.bot ? { "user-agent": "Googlebot" } : {}),
      cookie,
    },
    body: JSON.stringify({
      seedMediaId: "source-1",
      locale: "en",
      audioLanguageSlug: "english",
    }),
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.spyOn(console, "info").mockImplementation(() => undefined)
  resetRecommendationMutationAdmissionForTests()
  const link = await createRecommendationExperimentTesterLink(config, testerId)
  testerCookie = (await exchangeRecommendationExperimentTesterLink(
    new URL(link).hash.slice(1),
    config,
  ))!.cookie
})
afterEach(() => vi.restoreAllMocks())

describe("private A/B Watch route", () => {
  it("serves an eligible private result without issuing a second incumbent request", async () => {
    query.mockResolvedValueOnce({
      data: { privatePrecomputedWatchVisitDelivery: privateResult("eligible") },
    })
    const response = await POST(request())
    const body = await response.json()
    expect(body.delivery.result).toBe("served")
    expect(body.delivery.experimentAttribution).toMatchObject({
      assignedArm: "challenger",
      status: "eligible",
      measurementStatus: "recorded",
    })
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]?.query).toBe(
      adminPrivatePrecomputedWatchVisitDeliveryOperation,
    )
    expect(query.mock.calls[0]?.[0]?.variables).toMatchObject({
      consentReceiptDigest: null,
      profileTokenDigest: null,
    })
  })

  it("preserves a personalization-disabled viewer in the served and empty private arms", async () => {
    const disabledRequest = request({ essentialOnly: true })
    query.mockResolvedValueOnce({
      data: { privatePrecomputedWatchVisitDelivery: privateResult("eligible") },
    })
    const served = await POST(disabledRequest)
    expect((await served.json()).delivery.result).toBe("served")
    expect(query.mock.calls[0]?.[0]?.variables).toMatchObject({
      profileTokenDigest: null,
    })

    query.mockResolvedValueOnce({
      data: {
        privatePrecomputedWatchVisitDelivery: {
          ...privateResult("eligible"),
          delivery: { ...delivery, result: "empty", items: [] },
        },
      },
    })
    const empty = await POST(request({ essentialOnly: true }))
    expect((await empty.json()).delivery).toMatchObject({
      result: "empty",
      experimentAttribution: { status: "eligible" },
    })

    query.mockResolvedValueOnce({
      data: {
        privatePrecomputedWatchVisitDelivery: {
          ...privateResult("eligible"),
          delivery: { ...delivery, result: "empty", items: [] },
        },
      },
    })
    const noReceiptEmpty = await POST(request())
    expect((await noReceiptEmpty.json()).delivery).toMatchObject({
      result: "empty",
      experimentAttribution: { status: "eligible" },
    })
    expect(query.mock.calls[2]?.[0]?.variables).toMatchObject({
      consentReceiptDigest: null,
      profileTokenDigest: null,
    })
  })

  it("recovers an excluded visit through the private control without public enrollment", async () => {
    query
      .mockResolvedValueOnce({
        data: {
          privatePrecomputedWatchVisitDelivery: privateResult("excluded"),
        },
      })
      .mockResolvedValueOnce({
        data: { semanticRecommendationDelivery: delivery },
      })
    const response = await POST(request())
    expect((await response.json()).delivery.experimentAttribution.status).toBe(
      "excluded",
    )
    expect(query.mock.calls.map((call) => call[0].query)).toEqual([
      adminPrivatePrecomputedWatchVisitDeliveryOperation,
      adminPrivateSemanticRecommendationFallbackOperation,
    ])
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
    )
  })

  it("keeps transport failure and a missing visit ID out of the public enrollment path", async () => {
    query
      .mockRejectedValueOnce(new Error("private admission offline"))
      .mockResolvedValueOnce({
        data: { semanticRecommendationDelivery: delivery },
      })
    await POST(request())
    expect(query.mock.calls[1]?.[0]?.query).toBe(
      adminPrivateSemanticRecommendationFallbackOperation,
    )
    resetRecommendationMutationAdmissionForTests()
    query.mockClear().mockResolvedValueOnce({
      data: { semanticRecommendationDelivery: delivery },
    })
    await POST(request({ visit: false }))
    expect(query.mock.calls[0]?.[0]?.query).toBe(
      adminPrivateSemanticRecommendationFallbackOperation,
    )
  })

  it("handles excluded crawler traffic without a recommendation session", async () => {
    query
      .mockResolvedValueOnce({
        data: {
          privatePrecomputedWatchVisitDelivery: privateResult("excluded"),
        },
      })
      .mockResolvedValueOnce({
        data: { semanticRecommendationDelivery: delivery },
      })
    const response = await POST(request({ bot: true }))
    expect(response.status).toBe(200)
    expect(query.mock.calls[1]?.[0]?.query).toBe(
      adminPrivateSemanticRecommendationFallbackOperation,
    )
    expect(query.mock.calls[1]?.[0]?.variables.sessionDigest).toBe(
      "0".repeat(64),
    )
  })

  it("uses one provisional browser unit for lost-response retries and concurrent first tabs", async () => {
    query.mockImplementation(async ({ variables }) => ({
      data: {
        privatePrecomputedWatchVisitDelivery: {
          ...privateResult("eligible"),
          visitId: variables.visitId,
        },
      },
    }))
    const [first, retry] = await Promise.all([
      POST(request({ browser: false })),
      POST(request({ browser: false })),
    ])
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    const [next, another] = await Promise.all([
      POST(
        request({
          browser: false,
          visitId: "33333333-3333-4333-8333-333333333333",
        }),
      ),
      POST(
        request({
          browser: false,
          visitId: "44444444-4444-4444-8444-444444444444",
        }),
      ),
    ])
    expect(next.status).toBe(200)
    expect(another.status).toBe(200)
    expect(query).toHaveBeenCalledTimes(4)
    const units = query.mock.calls.map(
      ([operation]) => operation.variables.browserDigest,
    )
    expect(new Set(units).size).toBe(1)
    const visits = query.mock.calls.map(
      ([operation]) => operation.variables.visitId,
    )
    expect(visits.slice(0, 2)).toEqual([visitId, visitId])
    expect(new Set(visits.slice(2))).toEqual(
      new Set([
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
      ]),
    )
    expect(first.headers.get("set-cookie") ?? "").toContain(
      RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
    )
  })

  it("separates same-second invitation exchanges while keeping each browser stable", async () => {
    const fixedNow = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(fixedNow)
    const link = await createRecommendationExperimentTesterLink(
      config,
      testerId,
    )
    const activation = new URL(link).hash.slice(1)
    const first = await exchangeRecommendationExperimentTesterLink(
      activation,
      config,
    )
    const second = await exchangeRecommendationExperimentTesterLink(
      activation,
      config,
    )
    expect(first?.cookie).toBeTruthy()
    expect(second?.cookie).toBeTruthy()
    expect(first?.cookie).not.toBe(second?.cookie)
    query.mockImplementation(async ({ variables }) => ({
      data: {
        privatePrecomputedWatchVisitDelivery: {
          ...privateResult("eligible"),
          visitId: variables.visitId,
        },
      },
    }))
    testerCookie = first!.cookie
    await POST(request({ browser: false }))
    await POST(request({ browser: false }))
    testerCookie = second!.cookie
    await POST(request({ browser: false }))
    const units = query.mock.calls.map(
      ([operation]) => operation.variables.browserDigest,
    )
    expect(units[0]).toBe(units[1])
    expect(units[2]).not.toBe(units[0])
  })

  it("rejects a legacy private tester session without an individual nonce", async () => {
    const issuedAt = Math.floor(Date.now() / 1000)
    const legacy = await new SignJWT({
      scope: "forge.watch.precomputedExperiment",
    })
      .setProtectedHeader({
        alg: "HS256",
        typ: "watch-precomputed-experiment-tester+jwt",
      })
      .setIssuer(config.origin)
      .setAudience("watch-precomputed-experiment-tester:session")
      .setSubject(testerId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 30 * 86_400)
      .sign(new TextEncoder().encode(secret))
    expect(
      await readRecommendationExperimentTesterCookie(legacy, config),
    ).toBeNull()
  })

  it("does not issue a durable browser cookie when a tester link is exchanged", async () => {
    const link = await createRecommendationExperimentTesterLink(
      config,
      testerId,
    )
    const response = await exchange(
      new Request(
        "https://watch.example/watch/api/recommendations/experiment-tester",
        {
          method: "POST",
          headers: {
            origin: "https://watch.example",
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
          },
          body: JSON.stringify({ token: new URL(link).hash.slice(1) }),
        },
      ),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get("set-cookie") ?? "").toContain(
      RECOMMENDATION_EXPERIMENT_TESTER_COOKIE,
    )
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
    )
  })
})
