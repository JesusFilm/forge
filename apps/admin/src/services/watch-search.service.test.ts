import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  generateExperienceEmbeddingMock,
  hydrateMock,
  searchByExactTitleMock,
  searchByKeywordWeightedMock,
  searchByTrigramMock,
  searchVideoSemanticMock,
} = vi.hoisted(() => ({
  generateExperienceEmbeddingMock: vi.fn(),
  hydrateMock: vi.fn(),
  searchByExactTitleMock: vi.fn(),
  searchByKeywordWeightedMock: vi.fn(),
  searchByTrigramMock: vi.fn(),
  searchVideoSemanticMock: vi.fn(),
}))

vi.mock("./embeddings.service", () => ({
  EmbeddingsBatchError: class EmbeddingsBatchError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly cause?: unknown,
      readonly status?: number,
    ) {
      super(message)
      this.name = "EmbeddingsBatchError"
    }
  },
  EXPERIENCE_EMBEDDING_DIMENSIONS: 1536,
  OPENROUTER_EMBEDDING_MODEL: "qwen/qwen3-embedding-8b",
  generateExperienceEmbedding: generateExperienceEmbeddingMock,
}))

vi.mock("./hybrid-search-keyword-first-retrievers", () => ({
  searchByExactTitle: searchByExactTitleMock,
  searchByKeywordWeighted: searchByKeywordWeightedMock,
  searchByTrigram: searchByTrigramMock,
}))

vi.mock("./hybrid-search-retrievers", () => ({
  searchVideoSemantic: searchVideoSemanticMock,
}))

vi.mock("./search-watchability", () => ({
  SearchWatchabilityService: vi.fn(() => ({
    hydrate: hydrateMock,
  })),
}))

import { EmbeddingsBatchError } from "./embeddings.service"

import {
  prewarmWatchSearchQueryEmbeddings,
  WATCH_SEARCH_STARTER_QUERIES,
  WatchSearchService,
  WatchSearchValidationError,
} from "./watch-search.service"

function mockPrisma() {
  return {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    language: {
      findMany: vi.fn(),
    },
    videoImage: {
      findMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function targetAudioWatchability(videoId: string) {
  return {
    videoId,
    kind: "target_audio",
    languageSlug: "russian",
    languageEnglishName: "Russian",
    audio: true,
    subtitles: false,
    playbackId: `mux-${videoId}`,
    videoDubId: `dub-${videoId}`,
    videoSubtitleId: null,
    durationSeconds: 120,
    hrefLanguageSlug: "russian",
  }
}

function lexicalResults({
  exactTitle = [],
  keywordWeighted = [],
  trigram = [],
}: {
  exactTitle?: unknown[]
  keywordWeighted?: unknown[]
  trigram?: unknown[]
} = {}) {
  return {
    exactTitle,
    keywordWeighted,
    trigram,
  }
}

function mockLexicalResultsOnce(results: ReturnType<typeof lexicalResults>) {
  searchByKeywordWeightedMock.mockResolvedValueOnce(results.keywordWeighted)
  searchByTrigramMock.mockResolvedValueOnce(results.trigram)
  searchByExactTitleMock.mockResolvedValueOnce(results.exactTitle)
}

function mockLexicalResults(results: ReturnType<typeof lexicalResults>) {
  searchByKeywordWeightedMock.mockResolvedValue(results.keywordWeighted)
  searchByTrigramMock.mockResolvedValue(results.trigram)
  searchByExactTitleMock.mockResolvedValue(results.exactTitle)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function firstSemanticEmbeddingDetail(
  laneStatuses: Awaited<
    ReturnType<WatchSearchService["search"]>
  >["laneStatuses"],
) {
  return laneStatuses.find((lane) => lane.lane === "semantic_embedding")?.detail
}

describe("WatchSearchService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: WatchSearchService

  beforeEach(() => {
    vi.restoreAllMocks()
    prisma = mockPrisma()
    prisma.$executeRaw.mockResolvedValue(1)
    prisma.$queryRaw.mockResolvedValue([])
    prisma.language.findMany.mockResolvedValue([])
    prisma.videoImage.findMany.mockResolvedValue([])
    generateExperienceEmbeddingMock.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
    })
    mockLexicalResults(lexicalResults())
    searchVideoSemanticMock.mockResolvedValue([])
    hydrateMock.mockResolvedValue(new Map())
    service = new WatchSearchService(prisma, {
      embedder: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      logger: { warn: vi.fn() },
    })
  })

  it("normalizes the boundary input into the v2 response envelope", async () => {
    const result = await service.search({
      query: "  JESUS film  ",
      targetLanguageSlug: " spanish-castilian ",
      queryLanguageSlug: " en ",
      queryNamedLanguageSlug: " russian ",
      displayLanguageSlug: " english ",
      routeLanguageSlug: " english ",
      currentWatchLanguageSlug: " french ",
      acceptLanguage: " pt-BR,pt;q=0.9 ",
      limit: 5,
      offset: 10,
      resultTypes: ["video"],
    })

    expect(result).toMatchObject({
      query: "JESUS film",
      results: [],
      hasMore: false,
      nextOffset: 15,
      searchMode: "watch-search",
      degraded: false,
      languageInterpretation: {
        queryLanguageSlug: "en",
        queryNamedLanguageSlug: "russian",
        targetLanguageSlug: "spanish-castilian",
        targetLanguageSource: "explicit_target",
        displayLanguageSlug: "english",
        routeLanguageSlug: "english",
        currentWatchLanguageSlug: "french",
        acceptLanguage: "pt-BR,pt;q=0.9",
        acceptLanguageSlug: null,
      },
    })
    expect(result.requestId).toEqual(expect.any(String))
    expect(result.latencyMs).toEqual(expect.any(Number))
  })

  it("uses a valid client request id when one is supplied", async () => {
    const result = await service.search({
      query: "How can I know God?",
      clientRequestId: "search_request_123",
    })

    expect(result.requestId).toBe("search_request_123")
  })

  it("truncates long queries at the public boundary cap", async () => {
    const result = await service.search({ query: "x".repeat(250) })

    expect(result.query).toHaveLength(200)
  })

  it("rejects blank queries after trimming", async () => {
    await expect(service.search({ query: "   " })).rejects.toThrow(
      WatchSearchValidationError,
    )
  })

  it("clamps pagination to the service envelope bounds", async () => {
    const excessive = await service.search({
      query: "jesus",
      limit: 500,
      offset: -10,
    })
    expect(excessive.nextOffset).toBe(50)

    const invalid = await service.search({
      query: "jesus",
      limit: Number.NaN,
      offset: Number.NaN,
    })
    expect(invalid.nextOffset).toBe(20)
  })

  it("rejects unsupported result types from non-GraphQL callers", async () => {
    await expect(
      service.search({
        query: "jesus",
        resultTypes: ["playlist" as "video"],
      }),
    ).rejects.toThrow("Unsupported result type: playlist")
  })

  it("returns exact-title video results hydrated with target-language watchability", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-1",
            videoCoreId: "core-1",
            videoSlug: "jesus",
            videoTitle: "JESUS",
            imageUrl: null,
            description: "The story of Jesus.",
            titleLength: 5,
          },
        ],
      }),
    )
    hydrateMock.mockResolvedValue(
      new Map([
        [
          "video-1",
          {
            videoId: "video-1",
            kind: "target_audio",
            languageSlug: "russian",
            languageEnglishName: "Russian",
            audio: true,
            subtitles: false,
            playbackId: "mux-russian",
            videoDubId: "dub-russian",
            videoSubtitleId: null,
            durationSeconds: 7200,
            hrefLanguageSlug: "russian",
          },
        ],
      ]),
    )
    prisma.videoImage.findMany.mockResolvedValueOnce([
      {
        videoId: "video-1",
        url: "https://cdn.example/fallback.jpg",
        mobileCinematicHigh: "https://cdn.example/hero.jpg",
        mobileCinematicLow: "https://cdn.example/low.jpg",
        videoStill: "https://cdn.example/still.jpg",
        thumbnail: "https://cdn.example/thumb.jpg",
        blurDataUrl: "data:image/jpeg;base64,BLUR==",
      },
    ])

    const result = await service.search({
      query: "JESUS Russian",
      targetLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 10,
    })

    for (const retriever of [
      searchByKeywordWeightedMock,
      searchByTrigramMock,
      searchByExactTitleMock,
    ]) {
      expect(retriever).toHaveBeenCalledWith(prisma, {
        query: "JESUS",
        locale: "en",
        limit: 100,
      })
    }
    expect(hydrateMock).toHaveBeenCalledWith({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
    })
    expect(result.results).toEqual([
      expect.objectContaining({
        type: "video",
        id: "video-1",
        slug: "jesus",
        title: "JESUS",
        imageUrl: "https://cdn.example/hero.jpg",
        imageBlurDataUrl: "data:image/jpeg;base64,BLUR==",
        snippet: "The story of Jesus.",
        playbackId: "mux-russian",
        durationSeconds: 7200,
        languageSlug: "russian",
        evidence: {
          kind: "exact_title",
          languageSlug: null,
          label: "Title match",
        },
        availability: {
          kind: "target_audio",
          languageSlug: "russian",
          languageEnglishName: "Russian",
          audio: true,
          subtitles: false,
        },
        action: {
          kind: "watch",
          hrefLanguageSlug: "russian",
        },
        fallback: {
          kind: "none",
          message: null,
        },
      }),
    ])
  })

  it("orders target-language watchable exact-title results before fallback and unavailable results", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-unavailable",
            videoCoreId: "core-unavailable",
            videoSlug: "jesus-trailer",
            videoTitle: "Jesus Trailer",
            imageUrl: null,
            description: null,
            titleLength: 13,
          },
          {
            resultType: "video",
            resultId: "video-other-language",
            videoCoreId: "core-other-language",
            videoSlug: "who-is-jesus",
            videoTitle: "Who Is Jesus?",
            imageUrl: null,
            description: null,
            titleLength: 13,
          },
          {
            resultType: "video",
            resultId: "video-russian",
            videoCoreId: "core-russian",
            videoSlug: "birth-of-jesus",
            videoTitle: "Birth of Jesus",
            imageUrl: null,
            description: null,
            titleLength: 14,
          },
        ],
      }),
    )
    hydrateMock.mockResolvedValue(
      new Map([
        [
          "video-unavailable",
          {
            videoId: "video-unavailable",
            kind: "unavailable",
            languageSlug: null,
            languageEnglishName: null,
            audio: false,
            subtitles: false,
            playbackId: null,
            videoDubId: null,
            videoSubtitleId: null,
            durationSeconds: null,
            hrefLanguageSlug: null,
          },
        ],
        [
          "video-other-language",
          {
            videoId: "video-other-language",
            kind: "related_language",
            languageSlug: "dhundari",
            languageEnglishName: "Dhundari",
            audio: true,
            subtitles: false,
            playbackId: "mux-dhundari",
            videoDubId: "dub-dhundari",
            videoSubtitleId: null,
            durationSeconds: 240,
            hrefLanguageSlug: "dhundari",
          },
        ],
        [
          "video-russian",
          {
            videoId: "video-russian",
            kind: "target_audio",
            languageSlug: "russian",
            languageEnglishName: "Russian",
            audio: true,
            subtitles: false,
            playbackId: "mux-russian",
            videoDubId: "dub-russian",
            videoSubtitleId: null,
            durationSeconds: 300,
            hrefLanguageSlug: "russian",
          },
        ],
      ]),
    )

    const result = await service.search({
      query: "JESUS Russian",
      targetLanguageSlug: "russian",
      queryNamedLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 3,
    })

    expect(result.results.map((row) => row.slug)).toEqual([
      "birth-of-jesus",
      "who-is-jesus",
      "jesus-trailer",
    ])
    expect(result.results.map((row) => row.availability.kind)).toEqual([
      "target_audio",
      "related_language",
      "unavailable",
    ])
  })

  it("surfaces title-description keyword matches as metadata evidence", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        keywordWeighted: [
          {
            resultType: "video",
            resultId: "video-bible-project",
            videoCoreId: "core-bible-project",
            videoSlug: "the-lord-prayer-bp",
            videoTitle: "The Lord's Prayer",
            imageUrl: null,
            description: "Thanks to BibleProject for providing this series.",
            rank: 0.4,
          },
        ],
        trigram: [
          {
            resultType: "video",
            resultId: "video-bible-project",
            videoCoreId: "core-bible-project",
            videoSlug: "the-lord-prayer-bp",
            videoTitle: "The Lord's Prayer",
            imageUrl: null,
            description: "Thanks to BibleProject for providing this series.",
            similarity: 0.45,
          },
        ],
      }),
    )
    searchVideoSemanticMock.mockResolvedValueOnce([
      {
        resultType: "video",
        resultId: "video-loose-semantic",
        videoCoreId: "core-loose-semantic",
        videoSlug: "is-the-bible-reliable",
        videoTitle: "Is The Bible Reliable?",
        imageUrl: null,
        sceneDescription: "A transcript moment about the Bible.",
        startSeconds: 24,
        playbackId: "semantic-mux",
        similarity: 0.9,
        embeddingText: "[0.2,0.3]",
      },
    ])
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            targetAudioWatchability(videoId),
          ]),
        ),
    )

    const result = await service.search({
      query: "Bible project",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results.map((row) => row.slug)).toEqual([
      "the-lord-prayer-bp",
      "is-the-bible-reliable",
    ])
    expect(result.results[0]).toMatchObject({
      title: "The Lord's Prayer",
      snippet: "Thanks to BibleProject for providing this series.",
      score: 0.94,
      scoreBreakdown: {
        total: 0.94,
        sourceRelevance: 0.55,
        evidenceBoost: 0.14,
        relevance: 0.69,
        availability: 0.25,
        match: 0.14,
        sourceScore: 1,
      },
      evidence: {
        kind: "metadata",
        languageSlug: null,
        label: "Metadata match",
      },
    })
    expect(result.results[1]?.evidence.kind).toBe("transcript_semantic")
    expect(result.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "metadata_retrieval",
          status: "fulfilled",
          resultCount: 2,
        }),
        expect.objectContaining({
          lane: "metadata_watchability",
          status: "fulfilled",
          resultCount: 1,
        }),
      ]),
    )
  })

  it("does not expose semantic playback ids without a watchable option", async () => {
    searchVideoSemanticMock.mockResolvedValueOnce([
      {
        resultType: "video",
        resultId: "video-semantic-unavailable",
        videoCoreId: "core-semantic-unavailable",
        videoSlug: "semantic-unavailable",
        videoTitle: "Semantic Unavailable",
        imageUrl: null,
        sceneDescription: "Transcript evidence with a draft mux id.",
        startSeconds: 18,
        playbackId: "draft-semantic-mux",
        similarity: 0.94,
        embeddingText: "[0.2,0.3]",
      },
    ])
    hydrateMock.mockResolvedValueOnce(new Map())

    const result = await service.search({
      query: "draft semantic",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results[0]).toMatchObject({
      id: "video-semantic-unavailable",
      playbackId: null,
      availability: {
        kind: "unavailable",
        audio: false,
        subtitles: false,
      },
    })
  })

  it("uses a stable rerank window across pages so pagination does not duplicate fallback rows", async () => {
    const rows = [
      "fallback-a",
      "fallback-b",
      "fallback-c",
      "target-d",
      "target-e",
    ].map((slug) => ({
      resultType: "video",
      resultId: slug,
      videoCoreId: `core-${slug}`,
      videoSlug: slug,
      videoTitle: slug,
      imageUrl: null,
      description: null,
      titleLength: slug.length,
    }))
    searchByExactTitleMock.mockImplementation(
      async (_prisma: unknown, { limit }: { limit: number }) =>
        rows.slice(0, limit),
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            {
              videoId,
              kind: videoId.startsWith("target-")
                ? "target_audio"
                : "related_language",
              languageSlug: videoId.startsWith("target-")
                ? "russian"
                : "english",
              languageEnglishName: videoId.startsWith("target-")
                ? "Russian"
                : "English",
              audio: true,
              subtitles: false,
              playbackId: `mux-${videoId}`,
              videoDubId: `dub-${videoId}`,
              videoSubtitleId: null,
              durationSeconds: 60,
              hrefLanguageSlug: videoId.startsWith("target-")
                ? "russian"
                : "english",
            },
          ]),
        ),
    )

    const firstPage = await service.search({
      query: "jesus russian",
      targetLanguageSlug: "russian",
      queryNamedLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 2,
      offset: 0,
    })
    const secondPage = await service.search({
      query: "jesus russian",
      targetLanguageSlug: "russian",
      queryNamedLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 2,
      offset: 2,
    })

    expect(firstPage.results.map((row) => row.slug)).toEqual([
      "target-d",
      "target-e",
    ])
    expect(secondPage.results.map((row) => row.slug)).toEqual([
      "fallback-a",
      "fallback-b",
    ])
  })

  it("fills exact-title results with bounded transcript-semantic results without duplicating videos", async () => {
    prisma.language.findMany.mockResolvedValue([
      { slug: "russian", bcp47: "ru" },
      { slug: "english", bcp47: "en" },
    ])
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-exact",
            videoCoreId: "core-exact",
            videoSlug: "jesus",
            videoTitle: "JESUS",
            imageUrl: null,
            description: "Exact title result.",
            titleLength: 5,
          },
        ],
      }),
    )
    searchVideoSemanticMock.mockImplementation(async (_prisma, { locale }) =>
      locale === "ru"
        ? [
            {
              resultType: "video",
              resultId: "video-exact",
              videoCoreId: "core-exact",
              videoSlug: "jesus",
              videoTitle: "JESUS",
              imageUrl: null,
              sceneDescription: "Duplicate semantic evidence.",
              startSeconds: 10,
              playbackId: "semantic-mux-exact",
              similarity: 0.99,
              embeddingText: "[0.1,0.2]",
            },
            {
              resultType: "video",
              resultId: "video-semantic",
              videoCoreId: "core-semantic",
              videoSlug: "forgiven",
              videoTitle: "Forgiven",
              imageUrl: null,
              sceneDescription: "A transcript moment about forgiveness.",
              startSeconds: 390.75,
              playbackId: "semantic-mux",
              similarity: 0.91,
              embeddingText: "[0.2,0.3]",
            },
          ]
        : [],
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            targetAudioWatchability(videoId),
          ]),
        ),
    )
    service = new WatchSearchService(prisma, {
      embedder: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      logger: { warn: vi.fn() },
    })

    const result = await service.search({
      query: "Jesus Russian forgiveness",
      targetLanguageSlug: "russian",
      queryNamedLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(searchVideoSemanticMock).toHaveBeenCalledWith(prisma, {
      queryEmbedding: "[0.1,0.2,0.3]",
      locale: "ru",
      limit: 40,
    })
    expect(searchVideoSemanticMock).toHaveBeenCalledWith(prisma, {
      queryEmbedding: "[0.1,0.2,0.3]",
      locale: "en",
      limit: 40,
    })
    expect(result.degraded).toBe(false)
    expect(result.results.map((row) => row.slug)).toEqual(["jesus", "forgiven"])
    expect(result.results.map((row) => row.evidence.kind)).toEqual([
      "exact_title",
      "transcript_semantic",
    ])
    expect(result.results[1]?.evidence.languageSlug).toBe("russian")
    expect(result.results[1]?.startSeconds).toBe(390)
    expect(hydrateMock).toHaveBeenCalledTimes(2)
    expect(hydrateMock).toHaveBeenNthCalledWith(1, {
      candidates: [{ videoId: "video-exact" }],
      targetLanguageSlug: "russian",
    })
    expect(hydrateMock).toHaveBeenNthCalledWith(2, {
      candidates: [{ videoId: "video-exact" }, { videoId: "video-semantic" }],
      targetLanguageSlug: "russian",
    })
  })

  it("suppresses low-confidence transcript-semantic guesses instead of returning nonsense results", async () => {
    prisma.language.findMany.mockResolvedValue([
      { slug: "english", bcp47: "en" },
    ])
    searchVideoSemanticMock.mockResolvedValueOnce([
      {
        resultType: "video",
        resultId: "video-random-neighbor",
        videoCoreId: "core-random-neighbor",
        videoSlug: "unrelated-video",
        videoTitle: "Unrelated Video",
        imageUrl: null,
        sceneDescription: "A transcript moment that is merely nearby.",
        startSeconds: 12,
        playbackId: "semantic-mux-random",
        similarity: 0.28,
        embeddingText: "[0.2,0.3]",
      },
    ])

    const result = await service.search({
      query: "xqzv jmpld frrbn 839471",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(hydrateMock).not.toHaveBeenCalled()
    expect(result.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "semantic_retrieval",
          status: "fulfilled",
          resultCount: 0,
          reason: "below_confidence_threshold",
        }),
        expect.objectContaining({
          lane: "semantic_watchability",
          status: "skipped",
          resultCount: 0,
          reason: "no_semantic_candidates",
        }),
      ]),
    )
  })

  it("keeps exact-title matches even when weak semantic neighbours are filtered out", async () => {
    prisma.language.findMany.mockResolvedValue([
      { slug: "english", bcp47: "en" },
    ])
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-exact",
            videoCoreId: "core-exact",
            videoSlug: "jesus",
            videoTitle: "JESUS",
            imageUrl: null,
            description: "Exact title result.",
            titleLength: 5,
          },
        ],
      }),
    )
    searchVideoSemanticMock.mockResolvedValueOnce([
      {
        resultType: "video",
        resultId: "video-weak-semantic",
        videoCoreId: "core-weak-semantic",
        videoSlug: "weak-semantic",
        videoTitle: "Weak Semantic",
        imageUrl: null,
        sceneDescription: "Weak semantic evidence.",
        startSeconds: 12,
        playbackId: "semantic-mux-weak",
        similarity: 0.24,
        embeddingText: "[0.2,0.3]",
      },
    ])
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            targetAudioWatchability(videoId),
          ]),
        ),
    )

    const result = await service.search({
      query: "Jesus",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results.map((row) => row.slug)).toEqual(["jesus"])
    expect(result.results[0]?.evidence.kind).toBe("exact_title")
    expect(hydrateMock).toHaveBeenCalledTimes(1)
    expect(hydrateMock).toHaveBeenCalledWith({
      candidates: [{ videoId: "video-exact" }],
      targetLanguageSlug: "english",
    })
  })

  it("starts transcript availability without waiting for exact-title availability to finish", async () => {
    prisma.language.findMany.mockResolvedValue([
      { slug: "russian", bcp47: "ru" },
      { slug: "english", bcp47: "en" },
    ])
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-exact",
            videoCoreId: "core-exact",
            videoSlug: "jesus",
            videoTitle: "JESUS",
            imageUrl: null,
            description: "Exact title result.",
            titleLength: 5,
          },
        ],
      }),
    )
    searchVideoSemanticMock.mockResolvedValueOnce([
      {
        resultType: "video",
        resultId: "video-semantic",
        videoCoreId: "core-semantic",
        videoSlug: "forgiven",
        videoTitle: "Forgiven",
        imageUrl: null,
        sceneDescription: "A transcript moment about forgiveness.",
        startSeconds: 24,
        playbackId: "semantic-mux",
        similarity: 0.9,
        embeddingText: "[0.2,0.3]",
      },
    ])
    searchVideoSemanticMock.mockResolvedValueOnce([])
    const exactTitleAvailability =
      deferred<Map<string, ReturnType<typeof targetAudioWatchability>>>()
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) => {
        if (candidates.some(({ videoId }) => videoId === "video-exact")) {
          return exactTitleAvailability.promise
        }
        return new Map(
          candidates.map(({ videoId }) => [
            videoId,
            targetAudioWatchability(videoId),
          ]),
        )
      },
    )

    const searchPromise = service.search({
      query: "Jesus Russian forgiveness",
      targetLanguageSlug: "russian",
      queryNamedLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 10,
    })

    await vi.waitFor(() => {
      expect(hydrateMock).toHaveBeenCalledWith({
        candidates: [{ videoId: "video-semantic" }],
        targetLanguageSlug: "russian",
      })
    })
    exactTitleAvailability.resolve(
      new Map([["video-exact", targetAudioWatchability("video-exact")]]),
    )
    const result = await searchPromise

    expect(result.results.map((row) => row.slug)).toEqual(["jesus", "forgiven"])
  })

  it("keeps successful transcript-semantic locale results when another locale retrieval fails", async () => {
    prisma.language.findMany.mockResolvedValue([
      { slug: "russian", bcp47: "ru" },
      { slug: "english", bcp47: "en" },
    ])
    searchVideoSemanticMock.mockImplementation(async (_prisma, { locale }) => {
      if (locale === "en") throw new Error("statement timeout")
      return [
        {
          resultType: "video",
          resultId: "video-prayer",
          videoCoreId: "core-prayer",
          videoSlug: "prayer",
          videoTitle: "Prayer",
          imageUrl: null,
          sceneDescription: "A transcript moment about prayer.",
          startSeconds: 12,
          playbackId: "semantic-mux-prayer",
          similarity: 0.88,
          embeddingText: "[0.4,0.5]",
        },
      ]
    })
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            targetAudioWatchability(videoId),
          ]),
        ),
    )
    const warn = vi.fn()
    service = new WatchSearchService(prisma, {
      embedder: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      logger: { warn },
    })

    const result = await service.search({
      query: "prayer",
      targetLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.degraded).toBe(true)
    expect(result.results.map((row) => row.slug)).toEqual(["prayer"])
    expect(result.results[0]?.evidence.kind).toBe("transcript_semantic")
    expect(result.results[0]?.evidence.languageSlug).toBe("russian")
    expect(result.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "semantic_embedding",
          status: "fulfilled",
          resultCount: 1,
          reason: null,
        }),
        expect.objectContaining({
          lane: "semantic_retrieval",
          status: "degraded",
          resultCount: 1,
          reason: "partial_locale_failure",
        }),
      ]),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "event=semantic_retrieval_failure locale=en error_class=Error",
      ),
    )
  })

  it("keeps exact-title results and marks the response degraded when semantic embedding fails", async () => {
    prisma.language.findMany.mockResolvedValue([
      { slug: "russian", bcp47: "ru" },
    ])
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-exact",
            videoCoreId: "core-exact",
            videoSlug: "jesus",
            videoTitle: "JESUS",
            imageUrl: null,
            description: "Exact title result.",
            titleLength: 5,
          },
        ],
      }),
    )
    hydrateMock.mockResolvedValue(
      new Map([["video-exact", targetAudioWatchability("video-exact")]]),
    )
    const warn = vi.fn()
    service = new WatchSearchService(prisma, {
      embedder: vi.fn().mockRejectedValue(new Error("provider down")),
      logger: { warn },
    })

    const result = await service.search({
      query: "Jesus Russian",
      targetLanguageSlug: "russian",
      queryNamedLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.degraded).toBe(true)
    expect(result.results.map((row) => row.slug)).toEqual(["jesus"])
    expect(searchVideoSemanticMock).not.toHaveBeenCalled()
    expect(result.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "semantic_embedding",
          status: "degraded",
          resultCount: 0,
          reason: "query_embedding_failure",
        }),
        expect.objectContaining({
          lane: "semantic_retrieval",
          status: "skipped",
          resultCount: 0,
          reason: "missing_query_embedding",
        }),
        expect.objectContaining({
          lane: "semantic_watchability",
          status: "skipped",
          reason: "no_semantic_candidates",
        }),
      ]),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("event=query_embedding_failure"),
    )
  })

  it("surfaces provider embedding error codes in lane diagnostics", async () => {
    prisma.language.findMany.mockResolvedValue([
      { slug: "russian", bcp47: "ru" },
    ])
    const warn = vi.fn()
    service = new WatchSearchService(prisma, {
      embedder: vi
        .fn()
        .mockRejectedValue(
          new EmbeddingsBatchError(
            "request_failed",
            "Embedding request failed with status 429",
            undefined,
            429,
          ),
        ),
      logger: { warn },
    })

    const result = await service.search({
      query: "Jesus Russian",
      targetLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "semantic_embedding",
          status: "degraded",
          reason: "query_embedding_request_failed",
          detail: "http_429",
        }),
      ]),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "event=query_embedding_request_failed error_class=EmbeddingsBatchError error_code=request_failed status=429",
      ),
    )
  })

  it("times out semantic embedding and still returns exact-title results", async () => {
    prisma.language.findMany.mockResolvedValue([
      { slug: "russian", bcp47: "ru" },
    ])
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-exact",
            videoCoreId: "core-exact",
            videoSlug: "jesus",
            videoTitle: "JESUS",
            imageUrl: null,
            description: "Exact title result.",
            titleLength: 5,
          },
        ],
      }),
    )
    hydrateMock.mockResolvedValue(
      new Map([["video-exact", targetAudioWatchability("video-exact")]]),
    )
    const warn = vi.fn()
    service = new WatchSearchService(prisma, {
      embedder: vi.fn(() => new Promise<number[]>(() => {})),
      logger: { warn },
      semanticEmbeddingTimeoutMs: 1,
    })

    const result = await service.search({
      query: "Jesus Russian",
      targetLanguageSlug: "russian",
      queryNamedLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.degraded).toBe(true)
    expect(result.results.map((row) => row.slug)).toEqual(["jesus"])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("event=query_embedding_timeout"),
    )
  })

  it("does not include semantic wait time in exact-title availability timing", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-exact",
            videoCoreId: "core-exact",
            videoSlug: "jesus",
            videoTitle: "JESUS",
            imageUrl: null,
            description: "Exact title result.",
            titleLength: 5,
          },
        ],
      }),
    )
    hydrateMock.mockResolvedValue(
      new Map([["video-exact", targetAudioWatchability("video-exact")]]),
    )
    service = new WatchSearchService(prisma, {
      embedder: vi.fn(async () => {
        await delay(50)
        return [0.1, 0.2, 0.3]
      }),
    })

    const result = await service.search({
      query: "Jesus Russian",
      targetLanguageSlug: "russian",
      queryNamedLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 10,
    })

    const exactTitle = result.laneStatuses.find(
      (lane) => lane.lane === "exact_watchability",
    )
    const semanticEmbedding = result.laneStatuses.find(
      (lane) => lane.lane === "semantic_embedding",
    )

    expect(semanticEmbedding?.elapsedMs).toBeGreaterThanOrEqual(45)
    expect(exactTitle?.elapsedMs).toBeLessThan(semanticEmbedding!.elapsedMs / 2)
  })

  it("uses cached query embeddings from the database", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        embedding: [0.1, 0.2, 0.3],
        expiresAt: new Date(Date.now() + 60_000),
      },
    ])
    service = new WatchSearchService(prisma)

    const result = await service.search({
      query: "Jesus Chinese",
      targetLanguageSlug: "chinese-guiliu",
      displayLanguageSlug: "english",
    })

    expect(generateExperienceEmbeddingMock).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(result.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "semantic_embedding",
          detail: "cache_hit",
        }),
      ]),
    )
  })

  it("regenerates expired query embedding cache rows", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        embedding: [0.1, 0.2, 0.3],
        expiresAt: new Date(Date.now() - 60_000),
      },
    ])
    generateExperienceEmbeddingMock.mockResolvedValueOnce({
      embedding: [0.4, 0.5, 0.6],
    })
    service = new WatchSearchService(prisma)

    const result = await service.search({
      query: "Jesus German",
      targetLanguageSlug: "german-standard",
      displayLanguageSlug: "english",
    })

    expect(result.degraded).toBe(false)
    expect(generateExperienceEmbeddingMock).toHaveBeenCalledWith("Jesus German")
    expect(result.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "semantic_embedding",
          status: "fulfilled",
          detail: "cache_expired",
        }),
      ]),
    )
  })

  it("stores default query embeddings in the database for repeated watch searches", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        embedding: [0.1, 0.2, 0.3],
        expiresAt: new Date(Date.now() + 60_000),
      },
    ])
    service = new WatchSearchService(prisma)

    const first = await service.search({
      query: "Jesus Chinese",
      targetLanguageSlug: "chinese-guiliu",
      displayLanguageSlug: "english",
    })
    const second = await service.search({
      query: "  Jesus   Chinese  ",
      targetLanguageSlug: "chinese-guiliu",
      displayLanguageSlug: "english",
    })

    expect(generateExperienceEmbeddingMock).toHaveBeenCalledTimes(1)
    expect(generateExperienceEmbeddingMock).toHaveBeenCalledWith(
      "Jesus Chinese",
    )
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
    expect(prisma.$executeRaw.mock.calls[0]).toContain(86_400_000)
    expect(firstSemanticEmbeddingDetail(first.laneStatuses)).toBe("cache_miss")
    expect(firstSemanticEmbeddingDetail(second.laneStatuses)).toBe("cache_hit")
  })

  it("prewarms default watch category query embeddings", async () => {
    await prewarmWatchSearchQueryEmbeddings({ prisma })

    expect(generateExperienceEmbeddingMock).toHaveBeenCalledTimes(
      WATCH_SEARCH_STARTER_QUERIES.length,
    )
    expect(
      generateExperienceEmbeddingMock.mock.calls.map(([query]) => query),
    ).toEqual([...WATCH_SEARCH_STARTER_QUERIES])
  })

  it("marks subtitle-only exact-title matches as subtitle fallbacks", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          {
            resultType: "video",
            resultId: "video-1",
            videoCoreId: "core-1",
            videoSlug: "jesus",
            videoTitle: "JESUS",
            imageUrl: null,
            description: null,
            titleLength: 5,
          },
        ],
      }),
    )
    hydrateMock.mockResolvedValue(
      new Map([
        [
          "video-1",
          {
            videoId: "video-1",
            kind: "target_subtitle",
            languageSlug: "russian",
            languageEnglishName: "Russian",
            audio: false,
            subtitles: true,
            playbackId: null,
            videoDubId: null,
            videoSubtitleId: "sub-russian",
            durationSeconds: null,
            hrefLanguageSlug: "russian",
          },
        ],
      ]),
    )

    const result = await service.search({
      query: "JESUS",
      targetLanguageSlug: "russian",
    })

    expect(result.results[0]).toMatchObject({
      availability: {
        kind: "target_subtitle",
        audio: false,
        subtitles: true,
      },
      fallback: {
        kind: "subtitle",
        message: "Target-language subtitles are available.",
      },
    })
  })
})
