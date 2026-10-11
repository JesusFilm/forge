import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { adminPrecomputedWatchPublicVisitDeliveryOperation } from "@forge/admin-graphql/operations"
import {
  createRecommendationExperimentBrowser,
  readRecommendationExperimentBrowser,
  RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
} from "@/lib/recommendation-experiment-browser"
import { resetRecommendationMutationAdmissionForTests } from "@/lib/recommendation-mutation-admission"

const { query, secret } = vi.hoisted(() => ({
  query: vi.fn(),
  secret: "public-watch-experiment-browser-secret-".repeat(2),
}))
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example",
    WATCH_RECOMMENDATION_TESTER_SECRET: secret,
  },
}))
vi.mock("@/lib/admin-client", () => ({ default: { query } }))

const { POST } = await import("./route")
const visitId = "22222222-2222-4222-8222-222222222222"
const seed = {
  seedMediaId: "source-1",
  locale: "en",
  audioLanguageSlug: "english",
}
const delivery = {
  contractVersion: "semantic-recommendation-v1",
  surfaceVersion: "watch-below-player-v1",
  strategyVersion: "precomputed-watch-preview-v1",
  classifierVersion: "legacy-position-v0",
  generationId: "generation-1",
  requestId: "request-1",
  result: "served",
  reason: null,
  expiresAt: "2026-10-07T00:00:00.000Z",
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
      contributors: [],
      capability: "secret-capability",
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
const incumbent = {
  ...delivery,
  strategyVersion: "semantic-transcript-pgvector-v1",
  items: [{ ...delivery.items[0], candidateGenerator: "semantic" }],
}
const publicVisit = (
  disposition: "inactive" | "ab" | "promoted",
  overrides: Record<string, unknown> = {},
) => ({
  disposition,
  status: disposition === "ab" ? "eligible" : "not_applicable",
  visitId,
  experimentId: disposition === "ab" ? "experiment-1" : null,
  generationId: disposition === "inactive" ? null : "generation-1",
  arm: disposition === "ab" ? "challenger" : null,
  reason: null,
  qualification: disposition === "ab" ? "unverified_browser" : null,
  measurementStatus: disposition === "ab" ? "recorded" : "not_applicable",
  delivery: disposition === "inactive" ? incumbent : delivery,
  ...overrides,
})

function request(
  options: {
    cookie?: string
    visitId?: string | null
    bot?: boolean
    unknown?: boolean
  } = {},
) {
  return new Request("https://watch.example/watch/api/recommendations", {
    method: "POST",
    headers: {
      origin: "https://watch.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...(options.unknown
        ? {}
        : { "user-agent": options.bot ? "Googlebot" : "Mozilla/5.0" }),
      ...(options.visitId === null
        ? {}
        : { "x-forge-recommendation-visit-id": options.visitId ?? visitId }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: JSON.stringify(seed),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "info").mockImplementation(() => undefined)
  resetRecommendationMutationAdmissionForTests()
})
afterEach(() => vi.restoreAllMocks())

describe("public precomputed Watch control", () => {
  it("serves the inactive incumbent from one Admin call without enrollment or browser cookie", async () => {
    query.mockResolvedValueOnce({
      data: { precomputedWatchPublicVisitDelivery: publicVisit("inactive") },
    })
    const response = await POST(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(body.delivery.strategyVersion).toBe(incumbent.strategyVersion)
    expect(body.delivery.experimentAttribution).toBeUndefined()
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]?.query).toBe(
      adminPrecomputedWatchPublicVisitDeliveryOperation,
    )
    expect(query.mock.calls[0]?.[0]?.fetchPolicy).toBe("no-cache")
    expect(query.mock.calls[0]?.[0]?.variables.visitId).toBe(visitId)
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
    )
  })

  it("serves a pinned A/B result and refreshes the same signed browser identity", async () => {
    const browser = createRecommendationExperimentBrowser(secret)!
    query.mockResolvedValue({
      data: { precomputedWatchPublicVisitDelivery: publicVisit("ab") },
    })
    const first = await POST(
      request({
        cookie: `${RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE}=${browser.value}`,
      }),
    )
    expect((await first.json()).delivery.experimentAttribution).toMatchObject({
      visitId,
      experimentId: "experiment-1",
      generationId: "generation-1",
      assignedArm: "challenger",
      measurementStatus: "recorded",
    })
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]?.variables.browserDigest).toBe(
      browser.digest,
    )
    expect(first.headers.get("set-cookie") ?? "").toContain(
      `${RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE}=${browser.value}`,
    )
    expect(first.headers.get("set-cookie") ?? "").toContain("Max-Age=15552000")
    const retry = await POST(
      request({
        cookie: `${RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE}=${browser.value}`,
      }),
    )
    expect(retry.status).toBe(200)
    expect(query.mock.calls[1]?.[0]?.variables).toMatchObject({
      visitId,
      browserDigest: browser.digest,
    })
  })

  it("sets a signed browser identity on the first admitted A/B visit", async () => {
    query.mockResolvedValueOnce({
      data: { precomputedWatchPublicVisitDelivery: publicVisit("ab") },
    })
    const response = await POST(request())
    const cookie = (response.headers.get("set-cookie") ?? "")
      .split(", ")
      .find((part) =>
        part.startsWith(`${RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE}=`),
      )
      ?.split(";")[0]
    expect(cookie).toBeDefined()
    const verified = readRecommendationExperimentBrowser(
      new Request("https://watch.example", {
        headers: { cookie: cookie ?? "" },
      }),
      secret,
    )
    expect(verified?.digest).toBe(
      query.mock.calls[0]?.[0]?.variables.browserDigest,
    )
    expect(query.mock.calls[0]?.[0]?.variables.visitId).toBe(visitId)
  })

  it("keeps zero-card eligible visits in the denominator", async () => {
    query.mockResolvedValueOnce({
      data: {
        precomputedWatchPublicVisitDelivery: publicVisit("ab", {
          delivery: {
            ...delivery,
            result: "empty",
            requestId: null,
            reason: "no_connections",
            items: [],
          },
        }),
      },
    })
    const response = await POST(request())
    expect((await response.json()).delivery).toMatchObject({
      result: "empty",
      items: [],
      experimentAttribution: {
        status: "eligible",
        measurementStatus: "recorded",
      },
    })
    expect(query).toHaveBeenCalledOnce()
  })

  it("does not issue an unbound incumbent request when an admitted visit has no delivery", async () => {
    query.mockResolvedValueOnce({
      data: {
        precomputedWatchPublicVisitDelivery: publicVisit("ab", {
          delivery: null,
        }),
      },
    })
    const response = await POST(request())
    expect((await response.json()).delivery).toMatchObject({
      result: "unavailable",
      experimentAttribution: {
        status: "eligible",
        assignedArm: "challenger",
        measurementStatus: "recorded",
      },
    })
    expect(query).toHaveBeenCalledOnce()
  })

  it("serves Admin's recorded incumbent fallback without a second delivery", async () => {
    query.mockResolvedValueOnce({
      data: {
        precomputedWatchPublicVisitDelivery: publicVisit("ab", {
          delivery: incumbent,
        }),
      },
    })
    const response = await POST(request())
    expect((await response.json()).delivery).toMatchObject({
      strategyVersion: "semantic-transcript-pgvector-v1",
      experimentAttribution: { assignedArm: "challenger" },
    })
    expect(query).toHaveBeenCalledOnce()
  })

  it.each(["unavailable", "conflict"])(
    "does not serve an unrecorded experimental delivery after %s measurement",
    async (measurementStatus) => {
      query
        .mockResolvedValueOnce({
          data: {
            precomputedWatchPublicVisitDelivery: publicVisit("ab", {
              measurementStatus,
              delivery,
            }),
          },
        })
        .mockResolvedValueOnce({
          data: { semanticRecommendationDelivery: incumbent },
        })
      const response = await POST(request())
      expect((await response.json()).delivery).toMatchObject({
        strategyVersion: "semantic-transcript-pgvector-v1",
        experimentAttribution: { measurementStatus },
      })
      expect(query).toHaveBeenCalledTimes(2)
    },
  )

  it("uses the incumbent when the public operation is unavailable", async () => {
    query
      .mockRejectedValueOnce(new Error("Admin public delivery unavailable"))
      .mockResolvedValueOnce({
        data: { semanticRecommendationDelivery: delivery },
      })
    const response = await POST(request())
    expect((await response.json()).delivery.result).toBe("served")
    expect(query).toHaveBeenCalledTimes(2)
  })

  it("rejects a public result for a different visit before serving it", async () => {
    query
      .mockResolvedValueOnce({
        data: {
          precomputedWatchPublicVisitDelivery: publicVisit("ab", {
            visitId: "33333333-3333-4333-8333-333333333333",
          }),
        },
      })
      .mockResolvedValueOnce({
        data: { semanticRecommendationDelivery: incumbent },
      })
    const response = await POST(request())
    const body = await response.json()
    expect(body.delivery.strategyVersion).toBe(incumbent.strategyVersion)
    expect(body.delivery.experimentAttribution).toBeUndefined()
    expect(query).toHaveBeenCalledTimes(2)
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
    )
  })

  it("keeps a retry with a conflicting browser identity unmeasured", async () => {
    query.mockResolvedValueOnce({
      data: {
        precomputedWatchPublicVisitDelivery: publicVisit("ab", {
          status: "unavailable",
          reason: "visit_identity_conflict",
          measurementStatus: "conflict",
          delivery: incumbent,
        }),
      },
    })
    const response = await POST(request())
    expect((await response.json()).delivery).toMatchObject({
      strategyVersion: incumbent.strategyVersion,
      experimentAttribution: {
        status: "unavailable",
        reason: "visit_identity_conflict",
        measurementStatus: "conflict",
      },
    })
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
    )
    expect(vi.mocked(console.info).mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining(
            "experimentAdmission=visit_identity_conflict",
          ),
        ],
      ]),
    )
  })

  it("reports an Admin admission failure while serving its incumbent recovery", async () => {
    query.mockResolvedValueOnce({
      data: {
        precomputedWatchPublicVisitDelivery: publicVisit("inactive", {
          status: "unavailable",
          reason: "visit_persistence_unavailable",
        }),
      },
    })
    const response = await POST(request())
    expect((await response.json()).delivery.strategyVersion).toBe(
      incumbent.strategyVersion,
    )
    expect(query).toHaveBeenCalledOnce()
    expect(vi.mocked(console.info).mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining(
            "experimentAdmission=public_delivery_unavailable",
          ),
        ],
      ]),
    )
  })

  it("keeps legacy and bot requests out of public admission", async () => {
    query.mockResolvedValue({
      data: { semanticRecommendationDelivery: delivery },
    })
    await POST(request({ visitId: null }))
    await POST(request({ bot: true }))
    await POST(request({ unknown: true }))
    expect(query).toHaveBeenCalledTimes(3)
    expect(query.mock.calls.every((call) => !call[0]?.variables?.visitId)).toBe(
      true,
    )
    expect(query.mock.calls[1]?.[0]?.variables).toMatchObject({
      eligibleHuman: false,
      trafficCategory: "declared_crawler",
    })
    expect(query.mock.calls[2]?.[0]?.variables.trafficCategory).toBe("unknown")
  })
})
