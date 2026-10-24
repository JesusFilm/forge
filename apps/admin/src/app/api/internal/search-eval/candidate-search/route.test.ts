import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitAuthRoute = vi.fn()
const isValidCandidateSearchEvalBearer = vi.fn()
const search = vi.fn()
const createTypesenseWatchSearchCandidateEvaluationService = vi.fn(() => ({
  search,
}))
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

const { POST } = await import("./route")

function request(body: unknown, authorization = "Bearer candidate-key") {
  return new Request(
    "http://admin.test/api/internal/search-eval/candidate-search",
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/internal/search-eval/candidate-search", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "redis" })
    isValidCandidateSearchEvalBearer.mockReturnValue(true)
    prisma.video.findMany.mockResolvedValue([
      { id: "video-1", coreId: "4_Jesus_16x9" },
    ])
    search.mockResolvedValue({
      revision: "watch-search-candidate:identity-fingerprint",
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
        requestId: "candidate-request-1",
        degraded: false,
        latencyMs: 42,
        laneStatuses: [],
      },
    })
  })

  it("returns a Candidate result through the existing evaluation response contract", async () => {
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
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "พระเยซูคือใคร",
        mode: "modern",
        targetLanguageSlug: "thai",
        queryLanguageSlug: "thai",
        resultTypes: ["video"],
      }),
    )
    expect(
      createTypesenseWatchSearchCandidateEvaluationService,
    ).toHaveBeenCalledWith("EVALUATION")
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
      requestId: "candidate-request-1",
      degraded: false,
      latencyMs: 42,
      revision: "watch-search-candidate:identity-fingerprint",
      laneStatuses: [],
    })
  })

  it("requires the dedicated Candidate bearer and enforces admission", async () => {
    isValidCandidateSearchEvalBearer.mockReturnValueOnce(false)
    const unauthorized = await POST(request({ query: "Jesus", locale: "en" }))
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toEqual({
      error: "Authorization required",
    })
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

  it("rejects non-modern mode and caller-controlled Candidate identity", async () => {
    for (const body of [
      { query: "Jesus", locale: "en", mode: "default" },
      { query: "Jesus", locale: "en", generationId: "generation-2" },
      { query: "Jesus", locale: "en", revision: "arbitrary" },
      { query: "Jesus", locale: "en", collection: "arbitrary" },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
    }
    expect(search).not.toHaveBeenCalled()
  })

  it("keeps internal failures private", async () => {
    search.mockRejectedValueOnce(new Error("secret collection and key"))
    const response = await POST(request({ query: "Jesus", locale: "en" }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Candidate search eval is temporarily unavailable",
    })
  })
})
