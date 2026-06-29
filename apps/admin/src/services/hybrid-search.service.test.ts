/**
 * Orchestrator-level tests for HybridSearchService. Retrievers are
 * stubbed by mocking the module import; embedder is injected via the
 * constructor so tests can simulate success and failure independently.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./hybrid-search-retrievers", () => ({
  searchVideoSemantic: vi.fn(),
  searchVideoKeyword: vi.fn(),
  searchExperienceSemantic: vi.fn(),
  searchExperienceKeyword: vi.fn(),
}))

vi.mock("./embeddings.service", () => ({
  EXPERIENCE_EMBEDDING_DIMENSIONS: 1536,
  OPENROUTER_EMBEDDING_MODEL: "qwen/qwen3-embedding-8b",
  generateExperienceEmbedding: vi.fn(),
}))

import { generateExperienceEmbedding } from "./embeddings.service"
import {
  searchVideoSemantic,
  searchVideoKeyword,
  searchExperienceSemantic,
  searchExperienceKeyword,
} from "./hybrid-search-retrievers"
import { __resetSearchHealthForTest, getStats } from "./hybrid-search-health"
import {
  formatSearchTimingLogLine,
  HybridSearchService,
  __resetQueryEmbeddingCacheForTest,
  normalizeMode,
  sanitizeForLog,
  type QueryEmbedder,
} from "./hybrid-search.service"

const hydrationRawRows: {
  images: unknown[]
  dubs: unknown[]
  childCounts: unknown[]
} = {
  images: [],
  dubs: [],
  childCounts: [],
}

function defaultHydrationRawQuery(
  strings: TemplateStringsArray,
): Promise<unknown[]> {
  const sql = strings.join(" ")
  if (sql.includes("FROM video_image")) {
    return Promise.resolve(hydrationRawRows.images)
  }
  if (sql.includes("FROM video_dub")) {
    return Promise.resolve(hydrationRawRows.dubs)
  }
  if (sql.includes("FROM video_relation")) {
    return Promise.resolve(hydrationRawRows.childCounts)
  }
  return Promise.resolve([])
}

function hydrationRawSqlContaining(pattern: string): string {
  const calls = mockPrisma.$queryRaw.mock.calls as Array<
    [TemplateStringsArray, ...unknown[]]
  >
  const call = calls.find((rawCall) => {
    const strings = rawCall[0]
    return strings?.join(" ").includes(pattern)
  })
  expect(call, `Expected hydration SQL containing ${pattern}`).toBeDefined()
  return call![0].join(" ")
}

const mockPrisma = {
  video: {
    // Default to empty hydration so paginated tests don't need to seed
    // per-video rows. Tests that need to assert hydration values re-stub
    // via `mockPrisma.video.findMany.mockResolvedValueOnce(...)`.
    findMany: vi.fn().mockResolvedValue([]),
  },
  videoLocale: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn(defaultHydrationRawQuery),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const loggerError = vi.fn()
const loggerWarn = vi.fn()
const logger = { error: loggerError, warn: loggerWarn }

function successEmbedder(vector: number[] = [0.1, 0.2, 0.3]): QueryEmbedder {
  return vi.fn().mockResolvedValue(vector)
}

function failingEmbedder(error = new Error("provider down")): QueryEmbedder {
  return vi.fn().mockRejectedValue(error)
}

function setupDefaultRetrievers() {
  vi.mocked(searchVideoSemantic).mockResolvedValue([])
  vi.mocked(searchVideoKeyword).mockResolvedValue([])
  vi.mocked(searchExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchExperienceKeyword).mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  __resetQueryEmbeddingCacheForTest()
  setupDefaultRetrievers()
  hydrationRawRows.images = []
  hydrationRawRows.dubs = []
  hydrationRawRows.childCounts = []
  // Restore default hydration stub after clearAllMocks wipes it.
  mockPrisma.video.findMany.mockResolvedValue([])
  mockPrisma.videoLocale.findMany.mockResolvedValue([])
  mockPrisma.$queryRaw.mockImplementation(defaultHydrationRawQuery)
  vi.mocked(generateExperienceEmbedding).mockResolvedValue({
    model: "qwen/qwen3-embedding-8b",
    dimensions: 1536,
    embedding: [0.1, 0.2, 0.3],
  })
})

describe("HybridSearchService", () => {
  it("orchestrates embed → 4 retrieve → fuse → dedup → paginate on happy path", async () => {
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: "1_Jesus",
        videoSlug: "jesus",
        videoTitle: "Jesus",
        imageUrl: null,
        sceneDescription: "A scene about forgiveness",
        startSeconds: 42,
        playbackId: "mux-1",
        similarity: 0.9,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])
    vi.mocked(searchVideoKeyword).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-2",
        videoCoreId: "2_Grace",
        videoSlug: "grace",
        videoTitle: "Grace",
        imageUrl: null,
        description: "Video about grace",
        playbackId: null,
        rank: 0.5,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({
      query: "forgiveness",
      locale: "en",
    })

    // All 4 retrievers were invoked with overfetch = DEFAULT_LIMIT * 3 = 60.
    expect(searchVideoSemantic).toHaveBeenCalledWith(
      mockPrisma,
      {
        queryEmbedding: "[0.1,0.2,0.3]",
        locale: "en",
        limit: 60,
      },
      expect.any(Object),
    )
    expect(searchVideoKeyword).toHaveBeenCalledWith(
      mockPrisma,
      {
        query: "forgiveness",
        locale: "en",
        limit: 60,
      },
      expect.any(Object),
    )
    expect(searchExperienceSemantic).toHaveBeenCalled()
    expect(searchExperienceKeyword).toHaveBeenCalled()

    expect(result.query).toBe("forgiveness")
    expect(result.searchMode).toBe("hybrid")
    expect(result.results).toHaveLength(2)
    // Semantic-video row comes first (higher RRF score — rank 1 in
    // semantic-video; keyword-video row was rank 1 in a different list).
    const first = result.results.find((r) => r.id === "vid-1")!
    expect(first).toMatchObject({
      type: "video",
      slug: "jesus",
      title: "Jesus",
      imageUrl: null,
      snippet: "A scene about forgiveness",
      startSeconds: 42,
      playbackId: "mux-1",
    })
  })

  it("degrades to keyword-only when embedder throws", async () => {
    vi.mocked(searchVideoKeyword).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-2",
        videoCoreId: null,
        videoSlug: "grace",
        videoTitle: "Grace",
        imageUrl: null,
        description: "Video about grace",
        playbackId: null,
        rank: 0.5,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: failingEmbedder(),
      logger,
    })

    const result = await service.search({ query: "grace", locale: "en" })

    expect(result.searchMode).toBe("keyword-only")
    expect(searchVideoSemantic).not.toHaveBeenCalled()
    expect(searchExperienceSemantic).not.toHaveBeenCalled()
    expect(searchVideoKeyword).toHaveBeenCalled()
    expect(searchExperienceKeyword).toHaveBeenCalled()

    // Counters updated
    const stats = getStats()
    expect(stats.attempts).toBe(1)
    expect(stats.failures).toBe(1)

    // Structured error log
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("event=query_embedding_failure"),
    )
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("error_class=Error"),
    )
  })

  it("returns internal trace metadata without changing search() response shape", async () => {
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: "core-1",
        videoSlug: "jesus",
        videoTitle: "Jesus",
        imageUrl: null,
        sceneDescription: "A scene about Jesus",
        startSeconds: 12,
        playbackId: "mux-1",
        similarity: 0.9,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const traced = await service.searchWithTrace({
      query: "jesus",
      locale: "en",
    })

    expect(traced.response).toMatchObject({
      query: "jesus",
      searchMode: "hybrid",
      hasMore: false,
    })
    expect(traced.trace).toEqual({
      searchMode: "hybrid",
      resultCount: 1,
      outcome: "success",
      traceClass: "none",
      failedRetrievers: [],
      contributingRetrievers: ["semantic-video"],
    })
    expect(traced.timings).toMatchObject({
      pipelineMode: "hybrid",
      totalMs: expect.any(Number),
      embeddingMs: expect.any(Number),
      retrievalsMs: expect.any(Number),
      retrievalWaitMs: expect.any(Number),
      fusionMs: expect.any(Number),
      dilutionCapMs: 0,
      dedupeMs: expect.any(Number),
      mappingMs: expect.any(Number),
      hydrationMs: expect.any(Number),
    })
    expect(traced.timings.retrievers.map((r) => r.label)).toEqual([
      "semantic-video",
      "keyword-video",
      "semantic-experience",
      "keyword-experience",
    ])
    expect(traced.timings.retrievers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "semantic-video",
          status: "fulfilled",
          resultCount: 1,
          elapsedMs: expect.any(Number),
        }),
      ]),
    )
    expect(traced.timings.db).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "hydration.video.findMany",
          status: "fulfilled",
          resultCount: 0,
          elapsedMs: expect.any(Number),
        }),
        expect.objectContaining({
          label: "hydration.videoLocale.findMany",
          status: "fulfilled",
          resultCount: 0,
          elapsedMs: expect.any(Number),
        }),
        expect.objectContaining({
          label: "hydration.videoImage.query",
          status: "fulfilled",
          resultCount: 0,
          elapsedMs: expect.any(Number),
        }),
        expect.objectContaining({
          label: "hydration.videoDub.query",
          status: "fulfilled",
          resultCount: 0,
          elapsedMs: expect.any(Number),
        }),
        expect.objectContaining({
          label: "hydration.videoChildCount.query",
          status: "fulfilled",
          resultCount: 0,
          elapsedMs: expect.any(Number),
        }),
      ]),
    )
    expect(await service.search({ query: "jesus", locale: "en" })).toEqual(
      expect.objectContaining({
        query: "jesus",
        searchMode: "hybrid",
      }),
    )
  })

  it("classifies embedding failure in trace metadata", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: failingEmbedder(),
      logger,
    })

    const traced = await service.searchWithTrace({
      query: "grace",
      locale: "en",
    })

    expect(traced.response.searchMode).toBe("keyword-only")
    expect(traced.trace).toMatchObject({
      searchMode: "keyword-only",
      outcome: "degraded",
      traceClass: "query_embedding_failure",
    })
    expect(traced.timings.retrievers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "semantic-video",
          status: "skipped",
          resultCount: 0,
          elapsedMs: 0,
        }),
        expect.objectContaining({
          label: "semantic-experience",
          status: "skipped",
          resultCount: 0,
          elapsedMs: 0,
        }),
      ]),
    )
  })

  it("classifies partial retriever failure separately from zero results", async () => {
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: "core-1",
        videoSlug: "jesus",
        videoTitle: "Jesus",
        imageUrl: null,
        sceneDescription: "A scene about Jesus",
        startSeconds: 12,
        playbackId: "mux-1",
        similarity: 0.9,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])
    vi.mocked(searchVideoKeyword).mockRejectedValueOnce(
      new Error("keyword index unavailable"),
    )
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const traced = await service.searchWithTrace({
      query: "jesus",
      locale: "en",
    })

    expect(traced.response.results).toHaveLength(1)
    expect(traced.trace.outcome).toBe("degraded")
    expect(traced.trace.traceClass).toBe("retrieval_failure")
    expect(traced.trace.failedRetrievers).toEqual(["keyword-video"])
    expect(traced.trace.contributingRetrievers).toEqual(["semantic-video"])
    expect(traced.timings.retrievers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "keyword-video",
          status: "rejected",
          resultCount: 0,
          elapsedMs: expect.any(Number),
        }),
      ]),
    )
  })

  it("formats structured timing logs without query text", () => {
    const line = formatSearchTimingLogLine({
      route: "graphql",
      locale: "en\nx=1",
      requestedMode: "keyword first",
      searchMode: "hybrid",
      outcome: "success",
      resultCount: 2,
      traceWriteMs: 1.2,
      timings: {
        pipelineMode: "keyword-first",
        totalMs: 123.4,
        embeddingMs: 15.2,
        retrievalsMs: 100,
        retrievalWaitMs: 80,
        fusionMs: 1,
        dilutionCapMs: 0,
        dedupeMs: 0.4,
        mappingMs: 0.3,
        hydrationMs: 6,
        retrievers: [
          {
            label: "semantic-video",
            status: "fulfilled",
            elapsedMs: 99,
            resultCount: 60,
          },
        ],
        db: [
          {
            label: "semantic-video.query",
            status: "fulfilled",
            elapsedMs: 98,
            resultCount: 60,
          },
        ],
      },
    })

    expect(line).toContain("event=search_timing")
    expect(line).toContain("route=graphql")
    expect(line).toContain("locale=en_x_1")
    expect(line).toContain("requested_mode=keyword_first")
    expect(line).toContain("pipeline_mode=keyword-first")
    expect(line).toContain("embedding_ms=15.2")
    expect(line).toContain("retrieval_wait_ms=80")
    expect(line).toContain("retriever_semantic_video_ms=99")
    expect(line).toContain("db_semantic_video_query_ms=98")
    expect(line).toContain("trace_write_ms=1.2")
    expect(line).not.toContain("Jesus")
  })

  describe("query embedding", () => {
    it("calls the embedder without a per-call source override", async () => {
      const embedder = successEmbedder()
      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder,
        logger,
      })

      await service.search({ query: "test", locale: "en" })

      expect(embedder).toHaveBeenCalledWith("test")
      const params = vi.mocked(searchVideoSemantic).mock.calls.at(-1)?.[1]
      expect(params).not.toHaveProperty("embeddingSource")
    })
  })

  it("restricts to video corpus when contentTypes=['video']", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({
      query: "test",
      locale: "en",
      contentTypes: ["video"],
    })

    expect(searchVideoSemantic).toHaveBeenCalled()
    expect(searchVideoKeyword).toHaveBeenCalled()
    expect(searchExperienceSemantic).not.toHaveBeenCalled()
    expect(searchExperienceKeyword).not.toHaveBeenCalled()
  })

  it("restricts to experience corpus when contentTypes=['experience']", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({
      query: "test",
      locale: "en",
      contentTypes: ["experience"],
    })

    expect(searchVideoSemantic).not.toHaveBeenCalled()
    expect(searchVideoKeyword).not.toHaveBeenCalled()
    expect(searchExperienceSemantic).toHaveBeenCalled()
    expect(searchExperienceKeyword).toHaveBeenCalled()
  })

  it("empty contentTypes falls back to both corpora", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({
      query: "test",
      locale: "en",
      contentTypes: [],
    })

    expect(searchVideoSemantic).toHaveBeenCalled()
    expect(searchExperienceSemantic).toHaveBeenCalled()
  })

  it("clamps limit to MAX_LIMIT (50)", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({ query: "test", locale: "en", limit: 100 })

    expect(searchVideoSemantic).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ limit: 150 }), // 50 * 3
      expect.any(Object),
    )
  })

  it("clamps limit minimum to 1", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({ query: "test", locale: "en", limit: -5 })

    expect(searchVideoSemantic).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ limit: 3 }), // 1 * 3
      expect.any(Object),
    )
  })

  it("sets hasMore when dedup returns more than offset + limit", async () => {
    // Produce 25 semantic-video rows; default limit 20, so the 21st row
    // plus beyond triggers hasMore.
    // IDs + coreIds are zero-padded + suffixed so neither layer 1
    // (coreId prefix) nor layer 2 (exact title) nor layer 3 (cosine
    // similarity) of dedup collapses them.
    const pad = (n: number) => String(n).padStart(3, "0")
    const many = Array.from({ length: 25 }, (_, i) => ({
      resultType: "video" as const,
      resultId: `vid-${pad(i)}`,
      videoCoreId: `core-${pad(i)}x`,
      videoSlug: `slug-${pad(i)}`,
      videoTitle: `Title ${pad(i)}`,
      imageUrl: null,
      sceneDescription: `desc ${pad(i)}`,
      startSeconds: i,
      playbackId: `mux-${pad(i)}`,
      similarity: 1 - i * 0.01,
      // Distinct-enough vectors so cosine similarity stays below 0.95.
      // Each row gets a unique unit vector along a distinct axis by
      // rotating through a long dim so no two rows ever collide.
      embeddingText: `[${Array.from({ length: 32 }, (_, j) => (j === i ? 1 : 0)).join(",")}]`,
    }))
    vi.mocked(searchVideoSemantic).mockResolvedValue(many)

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({ query: "test", locale: "en" })
    expect(result.results).toHaveLength(20)
    expect(result.hasMore).toBe(true)
  })

  it("unwraps allSettled — one rejected retrieval logs and returns []", async () => {
    vi.mocked(searchVideoKeyword).mockRejectedValue(
      new Error("boom keyword-video"),
    )
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: null,
        videoSlug: "a",
        videoTitle: "A",
        imageUrl: null,
        sceneDescription: "",
        startSeconds: 0,
        playbackId: null,
        similarity: 1,
        embeddingText: "[]",
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({ query: "x", locale: "en" })

    // Still returns the semantic-video row; keyword-video was dropped.
    expect(result.results).toHaveLength(1)
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("keyword-video retrieval failed"),
    )
  })

  it("rounds score to 3 decimal places", async () => {
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: null,
        videoSlug: "a",
        videoTitle: "A",
        imageUrl: null,
        sceneDescription: "",
        startSeconds: 0,
        playbackId: null,
        similarity: 1,
        embeddingText: "[]",
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({ query: "x", locale: "en" })
    // With 1 non-empty list, fuseRankedLists normalises to 1.0 for the
    // sole rank-1 row → rounded to 1.
    expect(result.results[0]!.score).toBe(1)
  })

  it("maps experience rows with null startSeconds + playbackId", async () => {
    vi.mocked(searchExperienceSemantic).mockResolvedValue([
      {
        resultType: "experience",
        resultId: "exp-loc-1",
        experienceSlug: "easter",
        experienceTitle: "Easter",
        experienceMetaDescription: "The resurrection",
        imageUrl: null,
        similarity: 0.8,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({
      query: "easter",
      locale: "en",
      contentTypes: ["experience"],
    })

    const exp = result.results.find((r) => r.id === "exp-loc-1")!
    expect(exp).toMatchObject({
      type: "experience",
      slug: "easter",
      title: "Easter",
      snippet: "The resurrection",
      imageUrl: null,
      startSeconds: null,
      playbackId: null,
    })
  })

  describe("card-pill hydration", () => {
    it("hydrates video display metadata so cards use descriptions and thumbnails instead of evidence text", async () => {
      vi.mocked(searchVideoSemantic).mockResolvedValue([
        {
          resultType: "video",
          resultId: "vid-transcript",
          videoCoreId: "1_jf",
          videoSlug: "who-is-jesus",
          videoTitle: "Who Is Jesus?",
          imageUrl: "",
          sceneDescription:
            "<b>Following Jesus</b> <b>Who is Jesus?</b> <b>Uh yes</b>",
          startSeconds: 17,
          playbackId: "",
          similarity: 0.9,
          embeddingText: "[]",
        },
      ])

      mockPrisma.video.findMany.mockResolvedValueOnce([
        {
          id: "vid-transcript",
          label: "EPISODE",
          primaryLanguageId: "lang-en",
        },
      ])
      mockPrisma.videoLocale.findMany.mockResolvedValueOnce([
        {
          videoId: "vid-transcript",
          description: "A concise public description of the video.",
          snippet: "A shorter fallback snippet.",
        },
      ])
      hydrationRawRows.images = [
        {
          videoId: "vid-transcript",
          mobileCinematicHigh: "https://cdn.example/cover-high.jpg",
          mobileCinematicLow: null,
          videoStill: null,
          url: null,
          thumbnail: null,
        },
      ]
      hydrationRawRows.dubs = [
        {
          videoId: "vid-transcript",
          languageId: "lang-en",
          duration: 70,
          playbackId: "mux-hydrated",
        },
      ]
      hydrationRawRows.childCounts = [
        { videoId: "vid-transcript", childCount: 0 },
      ]

      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger,
      })

      const result = await service.search({ query: "jesus", locale: "en" })

      expect(result.results[0]).toMatchObject({
        id: "vid-transcript",
        snippet: "A concise public description of the video.",
        imageUrl: "https://cdn.example/cover-high.jpg",
        playbackId: "mux-hydrated",
        label: "EPISODE",
        durationSeconds: 70,
        childCount: 0,
      })
    })

    it("populates label, durationSeconds, childCount on video rows from one batched findMany", async () => {
      vi.mocked(searchVideoSemantic).mockResolvedValue([
        {
          resultType: "video",
          resultId: "vid-series",
          videoCoreId: "1_series",
          videoSlug: "storyclubs",
          videoTitle: "StoryClubs",
          imageUrl: null,
          sceneDescription: "",
          startSeconds: 0,
          playbackId: null,
          similarity: 0.9,
          embeddingText: "[]",
        },
        {
          resultType: "video",
          resultId: "vid-clip",
          videoCoreId: "1_clip",
          videoSlug: "single-clip",
          videoTitle: "Single Clip",
          imageUrl: null,
          sceneDescription: "",
          startSeconds: 0,
          playbackId: null,
          similarity: 0.8,
          embeddingText: "[]",
        },
      ])

      mockPrisma.video.findMany.mockResolvedValueOnce([
        {
          id: "vid-series",
          label: "SERIES",
          primaryLanguageId: "lang-en",
        },
        {
          id: "vid-clip",
          label: "EPISODE",
          primaryLanguageId: "lang-en",
        },
      ])
      hydrationRawRows.dubs = [
        {
          videoId: "vid-clip",
          languageId: "lang-en",
          duration: 70,
          playbackId: null,
        },
      ]
      hydrationRawRows.childCounts = [
        { videoId: "vid-series", childCount: 13 },
        { videoId: "vid-clip", childCount: 0 },
      ]

      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger,
      })

      const result = await service.search({ query: "x", locale: "en" })
      const series = result.results.find((r) => r.id === "vid-series")!
      const clip = result.results.find((r) => r.id === "vid-clip")!

      expect(series).toMatchObject({
        label: "SERIES",
        childCount: 13,
        durationSeconds: null,
      })
      expect(clip).toMatchObject({
        label: "EPISODE",
        childCount: 0,
        durationSeconds: 70,
      })

      // Exactly one batched findMany — no per-row queries.
      expect(mockPrisma.video.findMany).toHaveBeenCalledTimes(1)
      const [args] = mockPrisma.video.findMany.mock.calls[0]
      expect(args.where).toEqual({
        id: { in: ["vid-series", "vid-clip"] },
        deletedAt: null,
      })
    })

    it("picks the primary-language dub when one exists, else the first playable dub", async () => {
      vi.mocked(searchVideoSemantic).mockResolvedValue([
        {
          resultType: "video",
          resultId: "vid-primary",
          videoCoreId: "1_p",
          videoSlug: "primary",
          videoTitle: "Primary",
          imageUrl: null,
          sceneDescription: "",
          startSeconds: 0,
          playbackId: null,
          similarity: 0.9,
          embeddingText: "[]",
        },
        {
          resultType: "video",
          resultId: "vid-fallback",
          videoCoreId: "1_f",
          videoSlug: "fallback",
          videoTitle: "Fallback",
          imageUrl: null,
          sceneDescription: "",
          startSeconds: 0,
          playbackId: null,
          similarity: 0.8,
          embeddingText: "[]",
        },
      ])

      mockPrisma.video.findMany.mockResolvedValueOnce([
        {
          id: "vid-primary",
          label: "EPISODE",
          primaryLanguageId: "lang-en",
        },
        {
          id: "vid-fallback",
          label: "EPISODE",
          primaryLanguageId: null,
        },
      ])
      hydrationRawRows.dubs = [
        {
          videoId: "vid-primary",
          languageId: "lang-fr",
          duration: 999,
          playbackId: null,
        },
        {
          videoId: "vid-primary",
          languageId: "lang-en",
          duration: 120,
          playbackId: null,
        },
        {
          videoId: "vid-fallback",
          languageId: "lang-es",
          duration: 60,
          playbackId: null,
        },
      ]
      hydrationRawRows.childCounts = [
        { videoId: "vid-primary", childCount: 0 },
        { videoId: "vid-fallback", childCount: 0 },
      ]

      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger,
      })

      const result = await service.search({ query: "x", locale: "en" })
      expect(
        result.results.find((r) => r.id === "vid-primary")!.durationSeconds,
      ).toBe(120)
      expect(
        result.results.find((r) => r.id === "vid-fallback")!.durationSeconds,
      ).toBe(60)
    })

    it("orders hydration dub ranking with a stable tie-breaker", async () => {
      vi.mocked(searchVideoSemantic).mockResolvedValue([
        {
          resultType: "video",
          resultId: "vid-tied-dubs",
          videoCoreId: "1_tied",
          videoSlug: "tied",
          videoTitle: "Tied",
          imageUrl: null,
          sceneDescription: "",
          startSeconds: 0,
          playbackId: null,
          similarity: 0.9,
          embeddingText: "[]",
        },
      ])
      mockPrisma.video.findMany.mockResolvedValueOnce([
        {
          id: "vid-tied-dubs",
          label: "EPISODE",
          primaryLanguageId: null,
        },
      ])
      hydrationRawRows.dubs = [
        {
          videoId: "vid-tied-dubs",
          languageId: "lang-a",
          duration: 120,
          playbackId: "mux-a",
        },
      ]

      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger,
      })

      await service.search({ query: "x", locale: "en" })

      expect(hydrationRawSqlContaining("FROM video_dub")).toMatch(
        /row_number\(\)\s+OVER\s*\(\s*PARTITION BY vd\.video_id\s+ORDER BY vd\.duration DESC,\s*vd\.id ASC\s*\)\s+AS hydration_rank/,
      )
    })

    it("keeps pre-hydration video fields when hydration fails", async () => {
      vi.mocked(searchVideoSemantic).mockResolvedValue([
        {
          resultType: "video",
          resultId: "vid-failure",
          videoCoreId: "1_failure",
          videoSlug: "failure",
          videoTitle: "Failure",
          imageUrl: "https://cdn.example/original.jpg",
          sceneDescription: "Evidence text survives.",
          startSeconds: 12,
          playbackId: "mux-original",
          similarity: 0.9,
          embeddingText: "[]",
        },
      ])
      mockPrisma.video.findMany.mockRejectedValueOnce(new Error("db down"))

      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger,
      })

      const result = await service.search({ query: "x", locale: "en" })

      expect(result.results[0]).toMatchObject({
        id: "vid-failure",
        snippet: "Evidence text survives.",
        imageUrl: "https://cdn.example/original.jpg",
        playbackId: "mux-original",
        label: null,
        durationSeconds: null,
        childCount: null,
      })
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining("event=hydration_failed"),
      )
    })

    it("leaves experience rows with null label/duration/childCount and never queries Video", async () => {
      vi.mocked(searchExperienceSemantic).mockResolvedValue([
        {
          resultType: "experience",
          resultId: "exp-1",
          experienceSlug: "easter",
          experienceTitle: "Easter",
          experienceMetaDescription: "",
          imageUrl: null,
          similarity: 0.9,
        },
      ])

      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger,
      })

      const result = await service.search({
        query: "easter",
        locale: "en",
        contentTypes: ["experience"],
      })
      const exp = result.results.find((r) => r.id === "exp-1")!
      expect(exp).toMatchObject({
        label: null,
        durationSeconds: null,
        childCount: null,
      })
      expect(mockPrisma.video.findMany).not.toHaveBeenCalled()
    })
  })

  describe("default query embedding cache", () => {
    function deferredEmbedding() {
      let resolve!: (value: {
        model: string
        dimensions: number
        embedding: number[]
      }) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<{
        model: string
        dimensions: number
        embedding: number[]
      }>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
      })
      return { promise, resolve, reject }
    }

    it("reuses a successful default embedding for identical queries", async () => {
      const service = new HybridSearchService({
        prisma: mockPrisma,
        logger,
      })

      await service.search({ query: "jesus", locale: "en" })
      await service.search({ query: "jesus", locale: "en" })

      expect(generateExperienceEmbedding).toHaveBeenCalledTimes(1)
      expect(getStats()).toMatchObject({ attempts: 1, failures: 0 })
      expect(searchVideoSemantic).toHaveBeenCalledTimes(2)
    })

    it("coalesces concurrent identical default embedding requests", async () => {
      const embedding = deferredEmbedding()
      vi.mocked(generateExperienceEmbedding).mockReturnValueOnce(
        embedding.promise,
      )
      const service = new HybridSearchService({
        prisma: mockPrisma,
        logger,
      })

      const first = service.search({ query: "jesus", locale: "en" })
      const second = service.search({ query: "jesus", locale: "en" })

      expect(generateExperienceEmbedding).toHaveBeenCalledTimes(1)
      embedding.resolve({
        model: "qwen/qwen3-embedding-8b",
        dimensions: 1536,
        embedding: [0.3, 0.2, 0.1],
      })
      await Promise.all([first, second])

      expect(getStats()).toMatchObject({ attempts: 1, failures: 0 })
      expect(searchVideoSemantic).toHaveBeenCalledTimes(2)
    })

    it("does not cache default embedding failures", async () => {
      vi.mocked(generateExperienceEmbedding)
        .mockRejectedValueOnce(new Error("provider down"))
        .mockResolvedValueOnce({
          model: "qwen/qwen3-embedding-8b",
          dimensions: 1536,
          embedding: [0.1, 0.2, 0.3],
        })
      const service = new HybridSearchService({
        prisma: mockPrisma,
        logger,
      })

      const degraded = await service.search({ query: "jesus", locale: "en" })
      const recovered = await service.search({ query: "jesus", locale: "en" })

      expect(degraded.searchMode).toBe("keyword-only")
      expect(recovered.searchMode).toBe("hybrid")
      expect(generateExperienceEmbedding).toHaveBeenCalledTimes(2)
      expect(getStats()).toMatchObject({ attempts: 2, failures: 1 })
    })
  })
})

describe("normalizeMode", () => {
  it("treats null / undefined / '' / 'hybrid' as the canonical hybrid value", () => {
    const warn = vi.fn()
    expect(normalizeMode(undefined, { warn })).toBe("hybrid")
    expect(normalizeMode(null, { warn })).toBe("hybrid")
    expect(normalizeMode("", { warn })).toBe("hybrid")
    expect(normalizeMode("hybrid", { warn })).toBe("hybrid")
    expect(warn).not.toHaveBeenCalled()
  })

  it("recognizes 'keyword-first' verbatim (no warn)", () => {
    const warn = vi.fn()
    expect(normalizeMode("keyword-first", { warn })).toBe("keyword-first")
    expect(warn).not.toHaveBeenCalled()
  })

  it("recognizes 'semantic-only' only for internal eval callers", () => {
    const warn = vi.fn()
    expect(
      normalizeMode(
        "semantic-only",
        { warn },
        { allowInternalEvalModes: true },
      ),
    ).toBe("semantic-only")
    expect(warn).not.toHaveBeenCalled()
  })

  it("treats public 'semantic-only' as unknown and falls back to hybrid", () => {
    const warn = vi.fn()
    expect(normalizeMode("semantic-only", { warn })).toBe("hybrid")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain("mode=semantic-only")
  })

  it("treats removed 'semantic-hnsw-prototype' as unknown for public and internal callers", () => {
    const warn = vi.fn()
    expect(normalizeMode("semantic-hnsw-prototype", { warn })).toBe("hybrid")
    expect(
      normalizeMode(
        "semantic-hnsw-prototype",
        { warn },
        { allowInternalEvalModes: true },
      ),
    ).toBe("hybrid")
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]![0]).toContain("mode=semantic-hnsw-prototype")
    expect(warn.mock.calls[1]![0]).toContain("mode=semantic-hnsw-prototype")
  })

  it("is case-sensitive — 'HYBRID' / 'Keyword-First' are unknown", () => {
    const warn = vi.fn()
    expect(normalizeMode("HYBRID", { warn })).toBe("hybrid")
    expect(normalizeMode("Keyword-First", { warn })).toBe("hybrid")
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("rejects whitespace-padded values as unknown", () => {
    const warn = vi.fn()
    // The contract is explicit recognition by literal match — leading
    // / trailing whitespace at the boundary is the caller's
    // responsibility to trim. The empty-string carve-out covers the
    // common `?mode=` shape; anything else warns.
    expect(normalizeMode(" hybrid", { warn })).toBe("hybrid")
    expect(normalizeMode("keyword-first ", { warn })).toBe("hybrid")
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("emits exactly one structured warn line on unknown values", () => {
    const warn = vi.fn()
    normalizeMode("garbage", { warn })
    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0]![0] as string
    expect(line).toContain("event=search_unknown_mode")
    expect(line).toContain("mode=garbage")
    expect(line).toContain("falling_back=hybrid")
  })

  it("never throws on weird inputs", () => {
    const warn = vi.fn()
    // Type-system says string|null|undefined; runtime can still see
    // anything if a caller bypasses the boundary.
    expect(() =>
      normalizeMode(123 as unknown as string, { warn }),
    ).not.toThrow()
    expect(() => normalizeMode({} as unknown as string, { warn })).not.toThrow()
  })
})

describe("sanitizeForLog", () => {
  it("strips CR, LF, and TAB to single spaces", () => {
    expect(sanitizeForLog("a\rb\nc\td")).toBe("a b c d")
  })

  it("does NOT collapse runs of whitespace (`\\r\\n` becomes two spaces)", () => {
    expect(sanitizeForLog("a\r\nb")).toBe("a  b")
  })

  it("clamps to 64 characters", () => {
    const input = "x".repeat(100)
    const result = sanitizeForLog(input)
    expect(result).toHaveLength(64)
    expect(result).toBe("x".repeat(64))
  })

  it("preserves input that fits within the budget", () => {
    expect(sanitizeForLog("hybrid")).toBe("hybrid")
    expect(sanitizeForLog("a".repeat(64))).toBe("a".repeat(64))
  })

  it("coerces non-string input via String(...)", () => {
    expect(sanitizeForLog(123)).toBe("123")
    expect(sanitizeForLog(null)).toBe("null")
    expect(sanitizeForLog(undefined)).toBe("undefined")
    expect(sanitizeForLog({})).toBe("[object Object]")
  })
})
