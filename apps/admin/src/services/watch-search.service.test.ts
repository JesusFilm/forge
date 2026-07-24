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

const activeSearchLanguages = [
  { bcp47: "zh", slug: "chinese-guiliu" },
  { bcp47: "en", slug: "english" },
  { bcp47: "fr", slug: "french" },
  { bcp47: "de", slug: "german-standard" },
  { bcp47: "pt-BR", slug: "portuguese-brazil" },
  { bcp47: "ro", slug: "romanian" },
  { bcp47: "ru", slug: "russian" },
  { bcp47: "es", slug: "spanish-castilian" },
]

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

type WatchabilityKind =
  | "target_audio"
  | "target_subtitle"
  | "related_language"
  | "unavailable"

const WATCHABILITY_LANGUAGE: Record<
  WatchabilityKind,
  { languageSlug: string | null; languageEnglishName: string | null }
> = {
  target_audio: { languageSlug: "russian", languageEnglishName: "Russian" },
  target_subtitle: {
    languageSlug: "russian",
    languageEnglishName: "Russian",
  },
  related_language: {
    languageSlug: "english",
    languageEnglishName: "English",
  },
  unavailable: { languageSlug: null, languageEnglishName: null },
}

function watchabilityForKind(videoId: string, kind: WatchabilityKind) {
  const { languageSlug, languageEnglishName } = WATCHABILITY_LANGUAGE[kind]
  const audio = kind === "target_audio" || kind === "related_language"
  const subtitles = kind === "target_subtitle"

  return {
    videoId,
    kind,
    languageSlug,
    languageEnglishName,
    audio,
    subtitles,
    playbackId: audio ? `mux-${videoId}` : null,
    videoDubId: audio ? `dub-${videoId}` : null,
    videoSubtitleId: subtitles ? `sub-${videoId}` : null,
    durationSeconds: kind === "unavailable" ? null : 120,
    hrefLanguageSlug: languageSlug,
  }
}

function romanianWatchability(videoId: string, kind: WatchabilityKind) {
  const watchability = watchabilityForKind(videoId, kind)
  if (kind === "unavailable") return watchability
  return {
    ...watchability,
    languageSlug: kind === "related_language" ? "english" : "romanian",
    languageEnglishName: kind === "related_language" ? "English" : "Romanian",
    hrefLanguageSlug: kind === "related_language" ? "english" : "romanian",
  }
}

function exactTitleResult(resultId: string, videoTitle: string) {
  return {
    resultType: "video",
    resultId,
    videoCoreId: `core-${resultId}`,
    videoSlug: resultId,
    videoTitle,
    imageUrl: null,
    description: null,
    titleLength: videoTitle.length,
  }
}

function metadataResult(resultId: string, videoTitle: string) {
  return {
    resultType: "video",
    resultId,
    videoCoreId: `core-${resultId}`,
    videoSlug: resultId,
    videoTitle,
    imageUrl: null,
    description: `${videoTitle} metadata`,
    rank: 1,
    similarity: 1,
  }
}

function semanticResult(
  resultId: string,
  videoTitle: string,
  similarity: number,
) {
  return {
    resultType: "video",
    resultId,
    videoCoreId: `core-${resultId}`,
    videoSlug: resultId,
    videoTitle,
    imageUrl: null,
    sceneDescription: `${videoTitle} transcript`,
    startSeconds: 12,
    playbackId: `semantic-${resultId}`,
    similarity,
    embeddingText: "[0.2,0.3]",
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
    prisma.language.findMany.mockResolvedValue(activeSearchLanguages)
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
        queryLanguageSlug: "english",
        queryNamedLanguageSlug: "russian",
        targetLanguageSlug: "spanish-castilian",
        targetLanguageSource: "explicit_target",
        displayLanguageSlug: "english",
        routeLanguageSlug: "english",
        currentWatchLanguageSlug: "french",
        acceptLanguage: "pt-BR,pt;q=0.9",
        acceptLanguageSlug: "portuguese-brazil",
      },
    })
    expect(result.requestId).toEqual(expect.any(String))
    expect(result.latencyMs).toEqual(expect.any(Number))
  })

  it("returns the same hydrated ranking for locale and canonical target identities", async () => {
    mockLexicalResults(
      lexicalResults({
        exactTitle: [
          exactTitleResult("z-whole-title", "JESUS"),
          exactTitleResult("a-broader-title", "The Life of Jesus"),
        ],
      }),
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(videoId, "target_audio"),
          ]),
        ),
    )

    const localeIdentity = await service.search({
      query: "Jesus",
      targetLanguageSlug: "en",
      displayLanguageSlug: "en",
      limit: 2,
    })
    const canonicalIdentity = await service.search({
      query: "Jesus",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 2,
    })

    expect(localeIdentity.languageInterpretation.targetLanguageSlug).toBe(
      "english",
    )
    expect(canonicalIdentity.languageInterpretation.targetLanguageSlug).toBe(
      "english",
    )
    expect(localeIdentity.results.map((result) => result.id)).toEqual(
      canonicalIdentity.results.map((result) => result.id),
    )
    expect(hydrateMock.mock.calls).toHaveLength(2)
    for (const [input] of hydrateMock.mock.calls) {
      expect(input).toMatchObject({ targetLanguageSlug: "english" })
    }
  })

  it("uses the canonical Language BCP-47 value for non-English lexical retrieval", async () => {
    await service.search({
      query: "Hoffnung",
      targetLanguageSlug: "english",
      displayLanguageSlug: "de",
    })
    await service.search({
      query: "Hoffnung",
      targetLanguageSlug: "english",
      displayLanguageSlug: "german-standard",
    })

    for (const retriever of [
      searchByExactTitleMock,
      searchByKeywordWeightedMock,
      searchByTrigramMock,
    ]) {
      expect(retriever).toHaveBeenCalledTimes(4)
      expect(retriever).toHaveBeenNthCalledWith(
        1,
        prisma,
        expect.objectContaining({ locale: "de" }),
      )
      expect(retriever).toHaveBeenNthCalledWith(
        2,
        prisma,
        expect.objectContaining({ locale: "en" }),
      )
      expect(retriever).toHaveBeenNthCalledWith(
        3,
        prisma,
        expect.objectContaining({ locale: "de" }),
      )
      expect(retriever).toHaveBeenNthCalledWith(
        4,
        prisma,
        expect.objectContaining({ locale: "en" }),
      )
    }
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

  it.each(["JESUS", "Isus", "Iisus"])(
    "retrieves Romanian-playable JESUS through bounded English exact-title evidence for %s",
    async (query) => {
      searchByExactTitleMock.mockImplementation(
        async (_prisma, input: { query: string; locale: string }) =>
          input.locale === "en" && input.query === "JESUS"
            ? [exactTitleResult("video-jesus", "JESUS")]
            : [],
      )
      hydrateMock.mockImplementation(
        async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
          new Map(
            candidates.map(({ videoId }) => [
              videoId,
              romanianWatchability(videoId, "target_audio"),
            ]),
          ),
      )

      const result = await service.search({
        query,
        targetLanguageSlug: "romanian",
        displayLanguageSlug: "romanian",
      })

      expect(result.results).toEqual([
        expect.objectContaining({
          id: "video-jesus",
          title: "JESUS",
          playbackId: "mux-video-jesus",
          availability: expect.objectContaining({
            kind: "target_audio",
            languageSlug: "romanian",
          }),
          action: {
            kind: "watch",
            hrefLanguageSlug: "romanian",
          },
        }),
      ])
      expect(
        searchByExactTitleMock.mock.calls.map(([, input]) => [
          input.locale,
          input.query,
        ]),
      ).toEqual(
        query === "JESUS"
          ? [
              ["ro", "JESUS"],
              ["en", "JESUS"],
            ]
          : [
              ["ro", query],
              ["ro", "JESUS"],
              ["en", query],
              ["en", "JESUS"],
            ],
      )
    },
  )

  it("prefers primary-locale evidence and hydrates a duplicate video only once across locales and lanes", async () => {
    searchByExactTitleMock.mockImplementation(
      async (_prisma, input: { locale: string }) => [
        exactTitleResult(
          "video-shared",
          input.locale === "ro" ? "Isus" : "JESUS",
        ),
      ],
    )
    searchByKeywordWeightedMock.mockImplementation(
      async (_prisma, input: { locale: string }) =>
        input.locale === "en" ? [metadataResult("video-shared", "JESUS")] : [],
    )
    searchByTrigramMock.mockImplementation(
      async (_prisma, input: { locale: string }) =>
        input.locale === "en" ? [metadataResult("video-shared", "JESUS")] : [],
    )
    searchVideoSemanticMock.mockImplementation(
      async (_prisma, input: { locale: string }) => [
        semanticResult(
          "video-shared",
          input.locale === "ro" ? "Isus" : "JESUS",
          input.locale === "ro" ? 0.8 : 1,
        ),
      ],
    )
    hydrateMock.mockResolvedValue(
      new Map([
        ["video-shared", romanianWatchability("video-shared", "unavailable")],
      ]),
    )

    const result = await service.search({
      query: "JESUS",
      targetLanguageSlug: "romanian",
      displayLanguageSlug: "romanian",
    })

    expect(result.results).toEqual([
      expect.objectContaining({
        id: "video-shared",
        title: "Isus",
        evidence: expect.objectContaining({ kind: "exact_title" }),
      }),
    ])
    expect(hydrateMock).toHaveBeenCalledTimes(1)
    expect(hydrateMock).toHaveBeenCalledWith({
      candidates: [{ videoId: "video-shared" }],
      targetLanguageSlug: "romanian",
    })
    expect(
      searchByExactTitleMock.mock.calls.map(([, input]) => input.locale),
    ).toEqual(["ro", "en"])
  })

  it("keeps an eligible fallback exact-title match ahead of native semantic evidence for the same video", async () => {
    searchByExactTitleMock.mockImplementation(
      async (_prisma, input: { locale: string }) =>
        input.locale === "en" ? [exactTitleResult("video-jesus", "JESUS")] : [],
    )
    searchVideoSemanticMock.mockImplementation(
      async (_prisma, input: { locale: string }) =>
        input.locale === "ro"
          ? [semanticResult("video-jesus", "Isus", 0.9)]
          : [],
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            romanianWatchability(videoId, "target_audio"),
          ]),
        ),
    )

    const result = await service.search({
      query: "JESUS",
      targetLanguageSlug: "romanian",
      displayLanguageSlug: "romanian",
    })

    expect(result.results).toEqual([
      expect.objectContaining({
        id: "video-jesus",
        title: "JESUS",
        evidence: expect.objectContaining({ kind: "exact_title" }),
      }),
    ])
  })

  it("prefers native semantic evidence over a stronger fallback duplicate", async () => {
    searchVideoSemanticMock.mockImplementation(
      async (_prisma, input: { locale: string }) =>
        input.locale === "ro"
          ? [semanticResult("video-shared", "Isus", 0.7)]
          : input.locale === "en"
            ? [semanticResult("video-shared", "JESUS", 0.95)]
            : [],
    )
    hydrateMock.mockResolvedValue(
      new Map([
        ["video-shared", romanianWatchability("video-shared", "target_audio")],
      ]),
    )

    const result = await service.search({
      query: "credință",
      targetLanguageSlug: "romanian",
      displayLanguageSlug: "romanian",
    })

    expect(result.results).toEqual([
      expect.objectContaining({
        id: "video-shared",
        title: "Isus",
        evidence: expect.objectContaining({
          kind: "transcript_semantic",
          languageSlug: "romanian",
        }),
      }),
    ])
  })

  it("keeps the strongest semantic duplicate within native evidence locales", async () => {
    searchVideoSemanticMock.mockImplementation(
      async (_prisma, input: { locale: string }) =>
        input.locale === "ro"
          ? [semanticResult("video-shared", "Isus", 0.4)]
          : input.locale === "ru"
            ? [semanticResult("video-shared", "Иисус", 0.8)]
            : [],
    )
    hydrateMock.mockResolvedValue(
      new Map([
        ["video-shared", romanianWatchability("video-shared", "target_audio")],
      ]),
    )

    const result = await service.search({
      query: "credință",
      queryLanguageSlug: "russian",
      targetLanguageSlug: "romanian",
      displayLanguageSlug: "romanian",
    })

    expect(result.results).toEqual([
      expect.objectContaining({
        id: "video-shared",
        title: "Иисус",
        evidence: expect.objectContaining({
          kind: "transcript_semantic",
          languageSlug: "russian",
        }),
      }),
    ])
  })

  it.each(["fiul risipitor", "anxietate", "iertare", "Crăciun"])(
    "returns a Romanian-playable fallback result and excludes English-only inventory for %s",
    async (query) => {
      const playableId = `video-playable-${query}`
      const englishOnlyId = `video-english-only-${query}`
      if (query === "Crăciun") {
        searchVideoSemanticMock.mockImplementation(
          async (_prisma, input: { locale: string }) =>
            input.locale === "en"
              ? [
                  semanticResult(playableId, "Christmas Story", 0.8),
                  semanticResult(englishOnlyId, "Christmas Feature", 1),
                ]
              : [],
        )
      } else {
        const fallbackCandidates = [
          metadataResult(playableId, "Relevant Story"),
          metadataResult(englishOnlyId, "Stronger English Result"),
        ]
        searchByKeywordWeightedMock.mockImplementation(
          async (_prisma, input: { locale: string }) =>
            input.locale === "en" ? fallbackCandidates : [],
        )
        searchByTrigramMock.mockImplementation(
          async (_prisma, input: { locale: string }) =>
            input.locale === "en" ? fallbackCandidates : [],
        )
      }
      hydrateMock.mockImplementation(
        async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
          new Map(
            candidates.map(({ videoId }) => [
              videoId,
              romanianWatchability(
                videoId,
                videoId === playableId ? "target_subtitle" : "related_language",
              ),
            ]),
          ),
      )

      const result = await service.search({
        query,
        targetLanguageSlug: "romanian",
        displayLanguageSlug: "romanian",
      })

      expect(result.results.map((candidate) => candidate.id)).toEqual([
        playableId,
      ])
      expect(result.results[0]).toMatchObject({
        availability: {
          kind: "target_subtitle",
          languageSlug: "romanian",
        },
        action: {
          kind: "watch",
          hrefLanguageSlug: "romanian",
        },
      })
      expect(result.results).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: englishOnlyId }),
        ]),
      )
    },
  )

  it("does not fan out duplicate English lexical requests for an English display locale", async () => {
    await service.search({
      query: "JESUS",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
    })

    for (const retriever of [
      searchByExactTitleMock,
      searchByKeywordWeightedMock,
      searchByTrigramMock,
    ]) {
      expect(retriever).toHaveBeenCalledTimes(1)
      expect(retriever).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ locale: "en" }),
      )
    }
  })

  it("uses every watchability tier after whole-title class and relevance tie", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          exactTitleResult("a-unavailable", "Hope Unavailable"),
          exactTitleResult("b-related", "Hope Related"),
          exactTitleResult("c-subtitle", "Hope Subtitle"),
          exactTitleResult("d-audio", "Hope Audio"),
        ],
      }),
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(
              videoId,
              videoId === "d-audio"
                ? "target_audio"
                : videoId === "c-subtitle"
                  ? "target_subtitle"
                  : videoId === "b-related"
                    ? "related_language"
                    : "unavailable",
            ),
          ]),
        ),
    )

    const result = await service.search({
      query: "Hope",
      targetLanguageSlug: "russian",
      displayLanguageSlug: "english",
      limit: 4,
    })

    expect(result.results.map((row) => row.id)).toEqual([
      "d-audio",
      "c-subtitle",
      "b-related",
      "a-unavailable",
    ])
    expect(result.results.map((row) => row.availability.kind)).toEqual([
      "target_audio",
      "target_subtitle",
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

  it("ranks a whole-title match first when capped totals tie and ID favors the broader result", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          exactTitleResult("z-whole-title", "King of Kings"),
          exactTitleResult("a-broader-title", "The King of Kings Story"),
        ],
      }),
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(
              videoId,
              videoId === "z-whole-title" ? "unavailable" : "target_audio",
            ),
          ]),
        ),
    )

    const result = await service.search({
      query: "King of Kings",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results.map((row) => row.id)).toEqual([
      "z-whole-title",
      "a-broader-title",
    ])
    expect(result.results.map((row) => row.score)).toEqual([1, 1])
    expect(result.results.map((row) => row.scoreBreakdown.relevance)).toEqual([
      1, 0.75,
    ])
  })

  it("normalizes case and whitespace before assigning whole-title priority", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          exactTitleResult("z-normalized-whole", "  tHE\n CHOSEN  "),
          exactTitleResult("a-broader", "The Chosen Story"),
        ],
      }),
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(videoId, "target_audio"),
          ]),
        ),
    )

    const result = await service.search({
      query: "  THE   chosen  ",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results.map((row) => row.id)).toEqual([
      "z-normalized-whole",
      "a-broader",
    ])
    expect(result.results.map((row) => row.score)).toEqual([1, 1])
  })

  it("uses relevance before watchability within the same whole-title class", async () => {
    searchVideoSemanticMock.mockResolvedValueOnce([
      semanticResult("z-more-relevant", "Faithful Witness", 1),
      semanticResult("a-more-watchable", "Faithful Journey", 0.6),
    ])
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(
              videoId,
              videoId === "z-more-relevant" ? "unavailable" : "target_audio",
            ),
          ]),
        ),
    )

    const result = await service.search({
      query: "Faith",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results.map((row) => row.id)).toEqual([
      "z-more-relevant",
      "a-more-watchable",
    ])
    expect(result.results.map((row) => row.scoreBreakdown.relevance)).toEqual([
      0.63, 0.41,
    ])
    expect(result.results.map((row) => row.score)).toEqual([0.63, 0.66])
  })

  it("uses unrounded relevance before watchability within one display-score bucket", async () => {
    searchVideoSemanticMock.mockResolvedValueOnce([
      semanticResult("z-more-relevant", "Faithful Witness", 0.6008),
      semanticResult("a-more-watchable", "Faithful Journey", 0.6),
    ])
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(
              videoId,
              videoId === "z-more-relevant" ? "unavailable" : "target_audio",
            ),
          ]),
        ),
    )

    const result = await service.search({
      query: "Faith",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results.map((row) => row.id)).toEqual([
      "z-more-relevant",
      "a-more-watchable",
    ])
    expect(result.results.map((row) => row.scoreBreakdown.relevance)).toEqual([
      0.41, 0.41,
    ])
  })

  it("uses result ID as the final tie-break after semantic priorities tie", async () => {
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [
          exactTitleResult("z-stable", "Hope Story"),
          exactTitleResult("a-stable", "Hope Journey"),
        ],
      }),
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(videoId, "unavailable"),
          ]),
        ),
    )

    const result = await service.search({
      query: "Hope",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results.map((row) => row.id)).toEqual([
      "a-stable",
      "z-stable",
    ])
  })

  it("orders representative non-whole-title exact, metadata, and semantic candidates by relevance", async () => {
    const metadata = metadataResult("m-metadata", "Faith in Practice")
    mockLexicalResultsOnce(
      lexicalResults({
        exactTitle: [exactTitleResult("z-exact", "Faith Journey")],
        keywordWeighted: [metadata],
        trigram: [metadata],
      }),
    )
    searchVideoSemanticMock.mockResolvedValueOnce([
      semanticResult("a-semantic", "Faith and Life", 1),
    ])
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(
              videoId,
              videoId === "z-exact"
                ? "unavailable"
                : videoId === "m-metadata"
                  ? "target_subtitle"
                  : "target_audio",
            ),
          ]),
        ),
    )

    const result = await service.search({
      query: "Faith",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 10,
    })

    expect(result.results.map((row) => row.id)).toEqual([
      "z-exact",
      "m-metadata",
      "a-semantic",
    ])
    expect(result.results.map((row) => row.evidence.kind)).toEqual([
      "exact_title",
      "metadata",
      "transcript_semantic",
    ])
    expect(result.results.map((row) => row.scoreBreakdown.relevance)).toEqual([
      0.75, 0.69, 0.63,
    ])
    expect(result.results.map((row) => row.score)).toEqual([0.75, 0.87, 0.88])
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

  it("keeps a saturated whole-title result on page one without duplicates across adjacent pages", async () => {
    const rows = [
      exactTitleResult("a-broader", "Jesus Stories"),
      exactTitleResult("b-broader", "Jesus for Children"),
      exactTitleResult("c-broader", "Who Is Jesus?"),
      exactTitleResult("d-broader", "The Life of Jesus"),
      exactTitleResult("z-whole-title", "JESUS"),
    ]
    searchByExactTitleMock.mockImplementation(
      async (_prisma: unknown, { limit }: { limit: number }) =>
        rows.slice(0, limit),
    )
    hydrateMock.mockImplementation(
      async ({ candidates }: { candidates: Array<{ videoId: string }> }) =>
        new Map(
          candidates.map(({ videoId }) => [
            videoId,
            watchabilityForKind(videoId, "target_audio"),
          ]),
        ),
    )

    const firstPage = await service.search({
      query: "Jesus",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 2,
      offset: 0,
    })
    const secondPage = await service.search({
      query: "Jesus",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      limit: 2,
      offset: 2,
    })

    const firstPageIds = firstPage.results.map((row) => row.id)
    const secondPageIds = secondPage.results.map((row) => row.id)
    expect(firstPageIds).toEqual(["z-whole-title", "a-broader"])
    expect(secondPageIds).toEqual(["b-broader", "c-broader"])
    expect(new Set([...firstPageIds, ...secondPageIds]).size).toBe(4)
    expect(firstPage.hasMore).toBe(true)
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
      candidates: [{ videoId: "video-semantic" }],
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
