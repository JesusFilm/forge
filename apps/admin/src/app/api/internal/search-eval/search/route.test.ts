import { beforeEach, describe, expect, it, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  rateLimitAuthRoute: vi.fn(),
  isValidSearchTraceSamplingBearer: vi.fn(),
  search: vi.fn(),
  recordSearchTraceSafely: vi.fn(),
  languageFindFirst: vi.fn(),
}))

const {
  rateLimitAuthRoute,
  isValidSearchTraceSamplingBearer,
  search,
  recordSearchTraceSafely,
  languageFindFirst,
} = routeMocks

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: routeMocks.rateLimitAuthRoute,
}))
vi.mock("@/auth/search-trace-bearer", () => ({
  isValidSearchTraceSamplingBearer: routeMocks.isValidSearchTraceSamplingBearer,
}))
vi.mock("@/db/client", () => ({
  prisma: {
    language: {
      findFirst: routeMocks.languageFindFirst,
    },
  },
}))
vi.mock("@/services/search-trace.service", () => ({
  recordSearchTraceSafely: routeMocks.recordSearchTraceSafely,
}))
vi.mock("@/services/hybrid-search.service", () => {
  const contentTypes = new Set(["video", "experience"])
  const makeTimings = () => ({
    pipelineMode: "hybrid" as const,
    totalMs: 1,
    embeddingMs: 1,
    retrievalsMs: 0,
    retrievalWaitMs: 0,
    fusionMs: 0,
    dilutionCapMs: 0,
    dedupeMs: 0,
    mappingMs: 0,
    hydrationMs: 0,
    retrievers: [],
    db: [],
  })
  return {
    HybridSearchService: vi.fn(() => ({
      search: routeMocks.search,
      searchWithTrace: async (params: unknown) => {
        const response = await routeMocks.search(params)
        return {
          response,
          trace: {
            searchMode: response.searchMode,
            resultCount: response.results.length,
            outcome:
              response.searchMode === "keyword-only" ? "degraded" : "success",
            traceClass:
              response.searchMode === "keyword-only"
                ? "query_embedding_failure"
                : "none",
            failedRetrievers: [],
            contributingRetrievers: [],
          },
          timings: makeTimings(),
        }
      },
    })),
    formatSearchTimingLogLine: vi.fn(() => "[search] event=search_timing"),
    isContentType: (value: string) => contentTypes.has(value),
  }
})

const { GET, POST } = await import("./route")

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://admin.test/api/internal/search-eval/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer eval-key",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/internal/search-eval/search", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    isValidSearchTraceSamplingBearer.mockReturnValue(true)
    languageFindFirst.mockResolvedValue(null)
    search.mockResolvedValue({
      results: [
        {
          type: "video",
          id: "video-1",
          slug: "jesus",
          title: "JESUS",
          imageUrl: null,
          snippet: "The story of Jesus.",
          startSeconds: null,
          playbackId: null,
          score: 1,
          label: "FEATURE_FILM",
          durationSeconds: 120,
          childCount: null,
        },
      ],
      hasMore: false,
      query: "Jesus",
      searchMode: "hybrid",
    })
  })

  it("runs Admin search for a valid internal eval bearer without recording a trace", async () => {
    const response = await POST(
      request({
        query: "Jesus",
        locale: "en",
        limit: 10,
        mode: "keyword-first",
        contentType: "video",
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      results: [{ id: "video-1" }],
      query: "Jesus",
      searchMode: "hybrid",
    })
    expect(rateLimitAuthRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "search-eval-search",
        limit: 60,
        windowMs: 60_000,
      }),
    )
    expect(search).toHaveBeenCalledWith({
      query: "Jesus",
      locale: "en",
      limit: 10,
      offset: undefined,
      mode: "keyword-first",
      allowInternalEvalModes: true,
      contentTypes: ["video"],
    })
    expect(recordSearchTraceSafely).not.toHaveBeenCalled()
  })

  it("passes the HNSW prototype mode through as an internal eval mode", async () => {
    const response = await POST(
      request({
        query: "Jesus",
        locale: "en",
        limit: 10,
        mode: "semantic-hnsw-prototype",
        contentType: "video",
      }),
    )

    expect(response.status).toBe(200)
    expect(search).toHaveBeenCalledWith({
      query: "Jesus",
      locale: "en",
      limit: 10,
      offset: undefined,
      mode: "semantic-hnsw-prototype",
      allowInternalEvalModes: true,
      contentTypes: ["video"],
    })
  })

  it("resolves a public language slug before running Admin search", async () => {
    languageFindFirst.mockResolvedValueOnce({ bcp47: "es" })

    const response = await POST(
      request({
        query: "Jesus",
        locale: "en",
        languageSlug: "spanish-castilian",
        limit: 10,
      }),
    )

    expect(response.status).toBe(200)
    expect(languageFindFirst).toHaveBeenCalledWith({
      where: { slug: "spanish-castilian", deletedAt: null },
      select: { bcp47: true },
    })
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Jesus",
        locale: "es",
        limit: 10,
        allowInternalEvalModes: true,
      }),
    )
  })

  it("rejects unsafe or unknown language slugs before search", async () => {
    for (const body of [
      { query: "Jesus", locale: "en", languageSlug: "../spanish" },
      { query: "Jesus", locale: "en", languageSlug: "x".repeat(129) },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
    }

    languageFindFirst.mockResolvedValueOnce(null)
    const response = await POST(
      request({
        query: "Jesus",
        locale: "en",
        languageSlug: "missing-language",
      }),
    )
    expect(response.status).toBe(400)
    expect(search).not.toHaveBeenCalled()
  })

  it("rejects missing bearer before parsing the body", async () => {
    isValidSearchTraceSamplingBearer.mockReturnValue(false)
    const text = vi.fn(async () => {
      throw new Error("body should not be read")
    })

    const response = await POST({
      headers: new Headers(),
      text,
    } as unknown as Request)

    expect(response.status).toBe(401)
    expect(text).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
  })

  it("returns 429 before auth or body parsing when rate-limited", async () => {
    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    const text = vi.fn(async () => JSON.stringify({}))

    const response = await POST({
      headers: new Headers({ authorization: "Bearer eval-key" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{}"))
          controller.close()
        },
      }),
      text,
    } as unknown as Request)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")
    expect(isValidSearchTraceSamplingBearer).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })

  it("requires JSON, a bounded query, locale, and valid content type", async () => {
    await expect(
      POST(
        new Request("http://admin.test/api/internal/search-eval/search", {
          method: "POST",
          headers: { authorization: "Bearer eval-key" },
          body: "{}",
        }),
      ),
    ).resolves.toHaveProperty("status", 415)

    for (const body of [
      {},
      { query: "", locale: "en" },
      { query: "x".repeat(1025), locale: "en" },
      { query: "Jesus" },
      { query: "Jesus", locale: "en\ninjected" },
      { query: "Jesus", locale: "x".repeat(33) },
      { query: "Jesus", locale: "en", limit: 51 },
      { query: "Jesus", locale: "en", offset: -1 },
      { query: "Jesus", locale: "en", contentType: "bad" },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
    }
    expect(search).not.toHaveBeenCalled()
  })

  it("rejects chunked bodies after the byte cap without fully parsing", async () => {
    const response = await POST({
      headers: new Headers({
        authorization: "Bearer eval-key",
        "content-type": "application/json",
      }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4097))
          controller.close()
        },
      }),
    } as unknown as Request)

    expect(response.status).toBe(413)
    expect(search).not.toHaveBeenCalled()
  })

  it("rejects declared oversized bodies before search", async () => {
    const response = await POST({
      headers: new Headers({
        authorization: "Bearer eval-key",
        "content-type": "application/json",
        "content-length": "4097",
      }),
      body: null,
    } as unknown as Request)

    expect(response.status).toBe(413)
    expect(search).not.toHaveBeenCalled()
  })

  it("maps search failures to a 503 without leaking details", async () => {
    search.mockRejectedValueOnce(new Error("provider secret leaked?"))

    const response = await POST(request({ query: "Jesus", locale: "en" }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Search is temporarily unavailable",
    })
  })
})

describe("GET /api/internal/search-eval/search", () => {
  it("is closed", async () => {
    await expect(GET()).resolves.toHaveProperty("status", 401)
  })
})
