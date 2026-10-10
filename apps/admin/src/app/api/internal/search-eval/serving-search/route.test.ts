import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitAuthRoute = vi.fn()
const isValidCandidateSearchEvalBearer = vi.fn()
const search = vi.fn()
const createTypesenseWatchSearchCandidateEvaluationService = vi.fn(() => ({
  search,
}))
const enqueueWatchSearchTrace = vi.fn()
const prisma = {
  video: { findMany: vi.fn() },
}

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute }))
vi.mock("@/auth/candidate-search-eval-bearer", () => ({
  isValidCandidateSearchEvalBearer,
}))
vi.mock("@/db/client", () => ({ prisma }))
vi.mock(
  "@/services/typesense-watch-search-candidate-evaluation.service",
  () => ({ createTypesenseWatchSearchCandidateEvaluationService }),
)
vi.mock("@/services/search-trace.service", () => ({
  enqueueWatchSearchTrace,
}))

const { POST } = await import("./route")

function request(
  body: unknown,
  authorization = "Bearer candidate-key",
  headers: Record<string, string> = {},
) {
  return new Request(
    "http://admin.test/api/internal/search-eval/serving-search",
    {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/internal/search-eval/serving-search", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "redis" })
    isValidCandidateSearchEvalBearer.mockReturnValue(true)
    prisma.video.findMany.mockResolvedValue([
      { id: "video-1", coreId: "4_Jesus_16x9" },
    ])
    search.mockResolvedValue({
      revision: "watch-search-candidate:serving-identity-fingerprint",
      response: {
        query: "Jesus",
        results: [
          {
            type: "video",
            id: "video-1",
            slug: "jesus",
            title: "JESUS",
            imageUrl: null,
            snippet: "The story of Jesus.",
            startSeconds: null,
            playbackId: "mux-1",
            score: 1,
            label: "FEATURE_FILM",
            durationSeconds: 120,
            childCount: null,
            languageSlug: "thai",
          },
        ],
        hasMore: false,
        searchMode: "watch-search-typesense",
        requestId: "serving-request-1",
        degraded: false,
        latencyMs: 42,
        laneStatuses: [],
      },
    })
  })

  it("executes the fixed modern Serving search", async () => {
    const response = await POST(
      request({
        query: "พระเยซูคือใคร",
        locale: "th",
        languageSlug: "thai",
        mode: "modern",
        contentType: "video",
        limit: 10,
      }),
    )

    expect(response.status).toBe(200)
    expect(
      createTypesenseWatchSearchCandidateEvaluationService,
    ).toHaveBeenCalledWith("SERVING")
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "พระเยซูคือใคร",
        mode: "modern",
        targetLanguageSlug: "thai",
        queryLanguageSlug: "thai",
        resultTypes: ["video"],
      }),
    )
    await expect(response.json()).resolves.toEqual({
      results: [
        expect.objectContaining({
          id: "video-1",
          canonicalVideoId: "core:4_jesus",
          languageSlug: "thai",
        }),
      ],
      hasMore: false,
      query: "Jesus",
      searchMode: "watch-search-typesense",
      requestId: "serving-request-1",
      degraded: false,
      latencyMs: 42,
      revision: "watch-search-candidate:serving-identity-fingerprint",
      laneStatuses: [],
    })
    expect(enqueueWatchSearchTrace).not.toHaveBeenCalled()
  })

  it("uses the dedicated Candidate bearer and rate limit before auth", async () => {
    isValidCandidateSearchEvalBearer.mockReturnValueOnce(false)
    const unauthorized = await POST(request({ query: "Jesus", locale: "en" }))
    expect(unauthorized.status).toBe(401)
    expect(search).not.toHaveBeenCalled()

    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "redis",
    })
    const limited = await POST(request({ query: "Jesus", locale: "en" }))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("60")
    expect(search).not.toHaveBeenCalled()
  })

  it("enforces body limits and rejects caller-controlled profile identity", async () => {
    const tooLarge = await POST(
      request({ query: "Jesus", locale: "en" }, "Bearer candidate-key", {
        "content-length": "4097",
      }),
    )
    expect(tooLarge.status).toBe(413)

    for (const body of [
      { query: "Jesus", locale: "en", mode: "default" },
      { query: "Jesus", locale: "en", mode: "hybrid" },
      { query: "Jesus", locale: "en", mode: "keyword-first" },
      { query: "Jesus", locale: "en", mode: "semantic-only" },
      { query: "Jesus", locale: "en", generationId: "generation-2" },
      { query: "Jesus", locale: "en", revision: "arbitrary" },
      { query: "Jesus", locale: "en", collection: "arbitrary" },
      { query: "Jesus", locale: "en", source: "EVALUATION" },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
    }
    expect(search).not.toHaveBeenCalled()
  })

  it("keeps internal failures private and does not write product analytics", async () => {
    search.mockRejectedValueOnce(
      new Error("secret serving collection, qualification, and key"),
    )
    const response = await POST(request({ query: "Jesus", locale: "en" }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Serving search eval is temporarily unavailable",
    })
    expect(enqueueWatchSearchTrace).not.toHaveBeenCalled()
  })
})
