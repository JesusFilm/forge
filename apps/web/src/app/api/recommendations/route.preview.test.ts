import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  adminPrecomputedWatchPreviewDeliveryOperation,
  adminPrivateSemanticRecommendationFallbackOperation,
  adminPrivateSemanticRecommendationFallbackQuery,
} from "@forge/admin-graphql/operations"
import {
  createRecommendationTesterLink,
  exchangeRecommendationTesterLink,
  RECOMMENDATION_TESTER_COOKIE,
} from "@/lib/recommendation-tester-token"
import { resetRecommendationMutationAdmissionForTests } from "@/lib/recommendation-mutation-admission"

const { query, secret } = vi.hoisted(() => ({
  query: vi.fn(),
  secret: "precomputed-preview-test-secret-".repeat(3),
}))
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example",
    WATCH_PRECOMPUTED_RECOMMENDATIONS_PREVIEW_ENABLED: "true",
    WATCH_RECOMMENDATION_TESTER_SECRET: secret,
  },
}))
vi.mock("@/lib/admin-client", () => ({ default: { query } }))

const { POST } = await import("./route")
const seed = {
  seedMediaId: "source-1",
  locale: "en",
  audioLanguageSlug: "english",
}
const card = (position: number) => ({
  id: `item-${position}`,
  position,
  targetMediaId: `target-${position}`,
  canonicalHref: `/watch/target-${position}.html`,
  candidateGenerator: "precomputed",
  contributors: [
    {
      generator: "precomputed",
      generatorVersion: "precomputed-watch-preview-v1",
      rank: position + 1,
    },
  ],
  capability: `capability-${position}`,
  videoSlug: `target-${position}`,
  videoTitle: `Target ${position}`,
  imageUrl: `https://example.org/${position}.jpg`,
  sceneIndex: 0,
  description: "",
  startSeconds: 0,
  endSeconds: null,
  durationSeconds: 60,
  similarity: 0,
  themes: [],
  demographics: [],
  spiritualContext: [],
  playbackId: `playback-${position}`,
})
const precomputed = (
  items = [card(0)],
  overrides: Record<string, unknown> = {},
) => ({
  contractVersion: "semantic-recommendation-v1",
  surfaceVersion: "watch-below-player-v1",
  strategyVersion: "precomputed-watch-preview-v1",
  classifierVersion: "legacy-position-v0",
  generationId: "generation-1",
  requestId: "request-preview",
  result: items.length ? "served" : "empty",
  reason: items.length ? null : "no_connections",
  expiresAt: "2026-10-05T04:00:00.000Z",
  requestedCount: 6,
  composedCount: items.length,
  shortfallReason: items.length < 6 ? "insufficient_candidates" : null,
  items,
  ...overrides,
})
const incumbent = {
  ...precomputed([card(0)]),
  strategyVersion: "semantic-transcript-pgvector-v1",
  requestId: "request-incumbent",
  items: [{ ...card(0), candidateGenerator: "semantic" }],
  personalization: null,
}

let cookie: string
function request() {
  return new Request("https://watch.example/watch/api/recommendations", {
    method: "POST",
    headers: {
      origin: "https://watch.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie: `${RECOMMENDATION_TESTER_COOKIE}=${cookie}`,
    },
    body: JSON.stringify(seed),
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.spyOn(console, "info").mockImplementation(() => undefined)
  resetRecommendationMutationAdmissionForTests()
  const config = { secret, origin: "https://watch.example" }
  const link = await createRecommendationTesterLink(
    config,
    "11111111-1111-4111-8111-111111111111",
  )
  cookie = (await exchangeRecommendationTesterLink(
    new URL(link).hash.slice(1),
    config,
  ))!.cookie
})
afterEach(() => vi.restoreAllMocks())

describe("private saved-result Watch route", () => {
  it.each([1, 6])(
    "serves %i saved cards in the existing envelope without incumbent access",
    async (count) => {
      query.mockResolvedValue({
        data: {
          precomputedWatchPreviewDelivery: precomputed(
            Array.from({ length: count }, (_, index) => card(index)),
          ),
        },
      })
      const response = await POST(request())
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.delivery.items).toHaveLength(count)
      expect(body.delivery.previewAttribution).toEqual({
        assignedStrategy: "precomputed-watch-preview-v1",
        actualStrategy: "precomputed-watch-preview-v1",
        generationId: "generation-1",
        reason: null,
        assignedReason: null,
        actualReason: null,
      })
      expect(query).toHaveBeenCalledOnce()
      expect(query.mock.calls[0]?.[0]?.query).toBe(
        adminPrecomputedWatchPreviewDeliveryOperation,
      )
    },
  )

  it("hides a valid empty source without incumbent recovery", async () => {
    query.mockResolvedValue({
      data: { precomputedWatchPreviewDelivery: precomputed([]) },
    })
    const response = await POST(request())
    expect((await response.json()).delivery).toMatchObject({
      result: "empty",
      items: [],
      previewAttribution: {
        reason: "no_connections",
        actualStrategy: "precomputed-watch-preview-v1",
      },
    })
    expect(query).toHaveBeenCalledOnce()
  })

  it("recovers a technical read failure using the incumbent without public enrollment", async () => {
    query
      .mockResolvedValueOnce({
        data: {
          precomputedWatchPreviewDelivery: precomputed([], {
            result: "unavailable",
            reason: "not_in_generation",
            requestId: null,
          }),
        },
      })
      .mockResolvedValueOnce({
        data: { semanticRecommendationDelivery: incumbent },
      })
    const response = await POST(request())
    expect((await response.json()).delivery).toMatchObject({
      result: "served",
      previewAttribution: {
        assignedStrategy: "precomputed-watch-preview-v1",
        actualStrategy: "semantic-transcript-pgvector-v1",
        generationId: "generation-1",
        reason: "not_in_generation",
      },
    })
    expect(query.mock.calls[1]?.[0]?.query).toBe(
      adminPrivateSemanticRecommendationFallbackOperation,
    )
    expect(adminPrivateSemanticRecommendationFallbackQuery).toContain(
      "privatePreviewFallback: true",
    )
    expect(query.mock.calls[1]?.[0]?.variables).toEqual({
      seedMediaId: "source-1",
      locale: "en",
      audioLanguageSlug: "english",
      sessionDigest: expect.any(String),
    })
  })

  it("does not expose incumbent cards when preview transport fails and Admin denies the source", async () => {
    query
      .mockRejectedValueOnce(new Error("preview transport failed"))
      .mockResolvedValueOnce({
        data: {
          semanticRecommendationDelivery: {
            ...incumbent,
            result: "unavailable",
            reason: "source_unavailable",
            requestId: null,
            items: [],
          },
        },
      })
    const response = await POST(request())
    expect((await response.json()).delivery).toMatchObject({
      result: "unavailable",
      items: [],
      previewAttribution: {
        assignedStrategy: "precomputed-watch-preview-v1",
        actualStrategy: null,
        reason: "source_unavailable",
        assignedReason: "precomputed_upstream_unavailable",
        actualReason: "source_unavailable",
      },
    })
    expect(query.mock.calls[1]?.[0]?.query).toBe(
      adminPrivateSemanticRecommendationFallbackOperation,
    )
    expect(query).toHaveBeenCalledTimes(2)
  })

  it("bounds a near-timeout preview and fallback within one upstream budget", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    const budgets: number[] = []
    let fallbackStartedAt = 0
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      budgets.push(ms)
      return timeout(ms)
    })
    query
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_550))
        throw new Error("preview network timeout")
      })
      .mockImplementationOnce(async () => {
        fallbackStartedAt = Date.now()
        return { data: { semanticRecommendationDelivery: incumbent } }
      })
    const startedAt = Date.now()
    const response = await POST(request())
    expect((await response.json()).delivery.previewAttribution).toMatchObject({
      actualStrategy: "semantic-transcript-pgvector-v1",
      reason: "precomputed_upstream_unavailable",
    })
    expect(budgets).toHaveLength(2)
    expect(budgets[0]).toBeLessThanOrEqual(1_600)
    expect(budgets[1]).toBeLessThanOrEqual(2_000)
    expect(budgets[1]).toBeLessThanOrEqual(
      3_500 - (fallbackStartedAt - startedAt) + 100,
    )
  })

  it("keeps the player route usable if both deliveries fail", async () => {
    query.mockRejectedValue(new Error("offline"))
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await response.json()).delivery).toMatchObject({
      result: "unavailable",
      items: [],
      previewAttribution: {
        actualStrategy: null,
        reason: "precomputed_upstream_unavailable",
      },
    })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it("does not recover while source publication cannot be verified", async () => {
    query.mockResolvedValueOnce({
      data: {
        precomputedWatchPreviewDelivery: precomputed([], {
          result: "unavailable",
          reason: "source_eligibility_unavailable",
          requestId: null,
        }),
      },
    })
    const response = await POST(request())
    expect((await response.json()).delivery.previewAttribution).toMatchObject({
      actualStrategy: null,
      reason: "source_eligibility_unavailable",
    })
    expect(query).toHaveBeenCalledOnce()
  })

  it("does not bypass source publication or preview authorization denials", async () => {
    query.mockResolvedValueOnce({
      data: {
        precomputedWatchPreviewDelivery: precomputed([], {
          result: "unavailable",
          reason: "source_unavailable",
          requestId: null,
        }),
      },
    })
    expect((await (await POST(request())).json()).delivery.result).toBe(
      "unavailable",
    )
    expect(query).toHaveBeenCalledOnce()
    resetRecommendationMutationAdmissionForTests()
    query.mockClear()
    query.mockResolvedValueOnce({
      error: { errors: [{ extensions: { code: "UNAUTHENTICATED" } }] },
    })
    const denied = await POST(request())
    expect((await denied.json()).delivery.previewAttribution).toMatchObject({
      actualStrategy: null,
      reason: "preview_authorization_denied",
    })
    expect(query).toHaveBeenCalledOnce()
    resetRecommendationMutationAdmissionForTests()
    query.mockClear()
    query.mockRejectedValueOnce({
      errors: [{ extensions: { code: "UNAUTHENTICATED" } }],
    })
    const thrownGraphql = await POST(request())
    expect(
      (await thrownGraphql.json()).delivery.previewAttribution,
    ).toMatchObject({
      actualStrategy: null,
      reason: "preview_authorization_denied",
    })
    expect(query).toHaveBeenCalledOnce()
    resetRecommendationMutationAdmissionForTests()
    query.mockClear()
    query.mockRejectedValueOnce({ statusCode: 403 })
    const transportDenied = await POST(request())
    expect(
      (await transportDenied.json()).delivery.previewAttribution,
    ).toMatchObject({
      actualStrategy: null,
      reason: "preview_authorization_denied",
    })
    expect(query).toHaveBeenCalledOnce()
  })
})
