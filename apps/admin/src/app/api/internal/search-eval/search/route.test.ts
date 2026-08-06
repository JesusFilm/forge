import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitAuthRoute = vi.fn()
const isValidSearchTraceSamplingBearer = vi.fn()
const defaultSearch = vi.fn()
const modernSearch = vi.fn()
const recordWatchSearchTraceSafely = vi.fn()
const createTypesenseWatchSearchService = vi.fn()
const prisma = {
  video: { findMany: vi.fn() },
}

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute }))
vi.mock("@/auth/search-trace-bearer", () => ({
  isValidSearchTraceSamplingBearer,
}))
vi.mock("@/db/client", () => ({ prisma }))
vi.mock("@/services/watch-search.service", () => ({
  WatchSearchService: vi.fn(() => ({ search: defaultSearch })),
  WatchSearchValidationError: class WatchSearchValidationError extends Error {},
}))
vi.mock("@/services/typesense-watch-search.service", () => ({
  createTypesenseWatchSearchService,
  TypesenseWatchSearchUnavailableError: class TypesenseWatchSearchUnavailableError extends Error {},
}))
vi.mock("@/services/search-trace.service", () => ({
  recordWatchSearchTraceSafely,
}))

const { POST } = await import("./route")

function request(body: unknown) {
  return new Request("http://admin.test/api/internal/search-eval/search", {
    method: "POST",
    headers: {
      authorization: "Bearer trace-key",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

const response = {
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
  requestId: "request-1",
  degraded: false,
  latencyMs: 42,
  laneStatuses: [],
  languageInterpretation: { targetLanguageSlug: "thai" },
}

describe("POST /api/internal/search-eval/search", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    isValidSearchTraceSamplingBearer.mockReturnValue(true)
    createTypesenseWatchSearchService.mockReturnValue({ search: modernSearch })
    modernSearch.mockResolvedValue(response)
    defaultSearch.mockResolvedValue({
      ...response,
      searchMode: "watch-search",
    })
    prisma.video.findMany.mockResolvedValue([
      { id: "video-1", coreId: "4_Jesus_16x9" },
    ])
    recordWatchSearchTraceSafely.mockResolvedValue(undefined)
  })

  it("runs MODERN through Admin and emits eval evidence plus normal analytics", async () => {
    const result = await POST(
      request({
        query: "พระเยซูคือใคร",
        locale: "th",
        languageSlug: "thai",
        mode: "modern",
        clientRequestId: "eval-modern-0001",
        contentType: "video",
        limit: 10,
      }),
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
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
      requestId: "request-1",
      degraded: false,
      latencyMs: 42,
      revision: null,
      laneStatuses: [],
    })
    expect(modernSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "พระเยซูคือใคร",
        mode: "modern",
        clientRequestId: "eval-modern-0001",
        targetLanguageSlug: "thai",
        queryLanguageSlug: "thai",
        resultTypes: ["video"],
      }),
    )
    expect(defaultSearch).not.toHaveBeenCalled()
    expect(recordWatchSearchTraceSafely).toHaveBeenCalledOnce()
  })

  it("keeps DEFAULT available for diagnostics", async () => {
    const result = await POST(
      request({ query: "Jesus", locale: "en", mode: "default" }),
    )

    expect(result.status).toBe(200)
    expect(defaultSearch).toHaveBeenCalledOnce()
    expect(modernSearch).not.toHaveBeenCalled()
  })

  it("authenticates, rate-limits, and rejects malformed mode", async () => {
    isValidSearchTraceSamplingBearer.mockReturnValueOnce(false)
    await expect(
      POST(request({ query: "Jesus", locale: "en", mode: "modern" })),
    ).resolves.toHaveProperty("status", 401)

    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    await expect(
      POST(request({ query: "Jesus", locale: "en", mode: "modern" })),
    ).resolves.toHaveProperty("status", 429)

    await expect(
      POST(request({ query: "Jesus", locale: "en", mode: "bad" })),
    ).resolves.toHaveProperty("status", 400)
  })
})
