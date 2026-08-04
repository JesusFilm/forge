import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  TypesenseClient,
  TypesenseSearchResult,
  TypesenseSearchRequest,
} from "./typesense-client"
import {
  TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  type TypesenseWatchCatalogDocument,
} from "./typesense-watch-search-schema"
import { TypesenseWatchSearchService } from "./typesense-watch-search.service"

vi.mock("./search-language-resolution", () => ({
  resolveSearchLanguageSignals: vi.fn(async () => ({
    queryLanguageSlug: "french",
    queryNamedLanguageSlug: null,
    targetLanguageSlug: "french",
    targetLanguageSource: "target_language",
    displayLanguageSlug: "french",
    displayLanguageBcp47: "fr",
    routeLanguageSlug: "french",
    routeLanguageBcp47: "fr",
    currentWatchLanguageSlug: null,
    acceptLanguage: null,
    acceptLanguageSlug: null,
  })),
}))

const catalogDocument: TypesenseWatchCatalogDocument = {
  id: "video-communion",
  coreId: "core-communion",
  slug: "the-fellowship-of-the-believers",
  titles: ["La communion des croyants", "The Fellowship of the Believers"],
  descriptions: ["Les croyants partagent leur vie."],
  localesJson: JSON.stringify([
    {
      locale: "fr",
      title: "La communion des croyants",
      description: "Les croyants partagent leur vie.",
    },
    {
      locale: "en",
      title: "The Fellowship of the Believers",
      description: "The believers share their lives.",
    },
  ]),
  label: "episode",
  childCount: 0,
  imageUrl: "https://example.com/communion.jpg",
  imageBlurDataUrl: null,
  audioLanguageSlugs: ["french"],
  subtitleLanguageSlugs: [],
  audioOptionsJson: JSON.stringify([
    {
      id: "dub-fr",
      languageId: "language-fr",
      languageSlug: "french",
      languageEnglishName: "French",
      playbackId: "playback-fr",
      durationSeconds: 180,
    },
  ]),
  subtitleOptionsJson: "[]",
}

function prismaFixture({
  fallbackLanguageIds = [],
}: {
  fallbackLanguageIds?: string[]
} = {}): PrismaClient {
  return {
    language: {
      findFirst: vi.fn(async () => ({
        id: "language-fr",
        slug: "french",
        name: { en: "French" },
      })),
      findMany: vi.fn(async () => [{ slug: "french", bcp47: "fr" }]),
    },
    languageFallback: {
      findMany: vi.fn(async () =>
        fallbackLanguageIds.map((fallbackLanguageId) => ({
          fallbackLanguageId,
        })),
      ),
    },
  } as unknown as PrismaClient
}

function typesenseFixture({
  lexical = [catalogDocument],
  semantic = [],
  semanticError,
  catalog = lexical.length > 0 ? lexical : [catalogDocument],
}: {
  lexical?: TypesenseWatchCatalogDocument[]
  semantic?: Array<{
    videoId: string
    text: string
    vectorDistance: number
  }>
  semanticError?: Error
  catalog?: TypesenseWatchCatalogDocument[]
}) {
  return {
    multiSearch: vi.fn(async (searches: TypesenseSearchRequest[]) => {
      const search = searches[0]
      if (search.collection === TYPESENSE_WATCH_TRANSCRIPT_ALIAS) {
        if (semanticError) throw semanticError
        return [
          {
            found: semantic.length,
            out_of: semantic.length,
            page: 1,
            search_time_ms: 2,
            hits: semantic.map((entry, index) => ({
              vector_distance: entry.vectorDistance,
              document: {
                id: `chunk-${index}`,
                videoId: entry.videoId,
                language: "fr",
                publiclyVisible: true,
                text: entry.text,
                startSeconds: 42,
                embedding: [],
              },
            })),
          },
        ]
      }
      const isHydration = search.q === "*"
      const documents = isHydration ? catalog : lexical
      let hydrationOffset = 0
      return searches.map((request, index) => {
        const perPage = Number(request.per_page ?? documents.length)
        const page = Number(request.page ?? index + 1)
        const start = isHydration ? hydrationOffset : (page - 1) * perPage
        if (isHydration) hydrationOffset += perPage
        const pageDocuments = documents.slice(start, start + perPage)
        return {
          found: documents.length,
          out_of: documents.length,
          page,
          search_time_ms: 1,
          hits: pageDocuments.map((document) => ({ document })),
        } satisfies TypesenseSearchResult<TypesenseWatchCatalogDocument>
      })
    }),
  }
}

describe("TypesenseWatchSearchService", () => {
  const embedding = new Array(TYPESENSE_WATCH_EMBEDDING_DIMENSIONS).fill(0)

  beforeEach(() => vi.clearAllMocks())

  it("returns the French communion title and target audio", async () => {
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "La communion des croyants",
      displayLanguageSlug: "french",
      targetLanguageSlug: "french",
    })

    expect(response.searchMode).toBe("watch-search-typesense")
    expect(response.results[0]).toMatchObject({
      slug: "the-fellowship-of-the-believers",
      title: "La communion des croyants",
      playbackId: "playback-fr",
      availability: { kind: "target_audio", audio: true },
      evidence: { kind: "exact_title" },
    })
  })

  it("uses the existing token-contained exact-title semantics", async () => {
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "communion",
      displayLanguageSlug: "french",
      targetLanguageSlug: "french",
      queryLanguageSlug: "french",
    })

    expect(response.results[0]?.evidence.kind).toBe("exact_title")
  })

  it("ranks a whole-title match ahead of broader exact-title matches", async () => {
    const broadMatch: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "a-broad-match",
      slug: "jesus-film",
      titles: ["JESUS Film"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "JESUS Film", description: null },
      ]),
    }
    const wholeTitleMatch: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "z-whole-title-match",
      slug: "jesus",
      titles: ["JESUS"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "JESUS", description: null },
      ]),
    }
    const catalog = [broadMatch, wholeTitleMatch]
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: catalog,
        catalog,
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "JESUS",
      displayLanguageSlug: "french",
      targetLanguageSlug: "french",
    })

    expect(response.results.map((result) => result.id)).toEqual([
      wholeTitleMatch.id,
      broadMatch.id,
    ])
  })

  it("pages lexical candidates beyond Typesense's 250-hit page limit", async () => {
    const catalog = Array.from({ length: 260 }, (_value, index) => ({
      ...catalogDocument,
      id: `video-${index.toString().padStart(3, "0")}`,
      slug: `care-${index}`,
      titles: [`Care ${index}`],
      localesJson: JSON.stringify([
        { locale: "fr", title: `Care ${index}`, description: null },
      ]),
    }))
    const typesense = typesenseFixture({ lexical: catalog, catalog })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "Care",
      targetLanguageSlug: "french",
      offset: 250,
      limit: 1,
    })

    expect(response.results.map((result) => result.id)).toEqual(["video-250"])
    expect(response.hasMore).toBe(true)
    expect(
      typesense.multiSearch.mock.calls.some(
        ([searches]) => searches.length === 2 && searches[1]?.page === 2,
      ),
    ).toBe(true)
  })

  it("returns transcript evidence when metadata has no matching terms", async () => {
    const typesense = typesenseFixture({
      lexical: [],
      semantic: [
        {
          videoId: catalogDocument.id,
          text: "Ils partageaient tout ce qu'ils avaient.",
          vectorDistance: 0.2,
        },
      ],
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "a community caring for each other",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      id: catalogDocument.id,
      snippet: "Ils partageaient tout ce qu'ils avaient.",
      startSeconds: 42,
      evidence: { kind: "transcript_semantic", languageSlug: "french" },
    })
    const semanticRequest = typesense.multiSearch.mock.calls
      .flatMap(([searches]) => searches)
      .find((search) => search.collection === TYPESENSE_WATCH_TRANSCRIPT_ALIAS)
    expect(semanticRequest?.filter_by).toBe(
      "language:=[`fr`] && publiclyVisible:=true",
    )
  })

  it("uses indexed target subtitles when target audio is unavailable", async () => {
    const subtitleDocument: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      audioLanguageSlugs: [],
      audioOptionsJson: "[]",
      subtitleLanguageSlugs: ["french"],
      subtitleOptionsJson: JSON.stringify([
        {
          id: "subtitle-fr",
          languageId: "language-fr",
          languageSlug: "french",
        },
      ]),
    }
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [subtitleDocument],
        catalog: [subtitleDocument],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "communion",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      availability: {
        kind: "target_subtitle",
        audio: false,
        subtitles: true,
      },
      fallback: { kind: "subtitle" },
      action: { hrefLanguageSlug: "french" },
    })
  })

  it("uses an indexed related-language audio fallback", async () => {
    const relatedDocument: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      audioLanguageSlugs: ["english"],
      audioOptionsJson: JSON.stringify([
        {
          id: "dub-en",
          languageId: "language-en",
          languageSlug: "english",
          languageEnglishName: "English",
          playbackId: "playback-en",
          durationSeconds: 175,
        },
      ]),
    }
    const service = new TypesenseWatchSearchService(
      prismaFixture({ fallbackLanguageIds: ["language-en"] }),
      typesenseFixture({
        lexical: [relatedDocument],
        catalog: [relatedDocument],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "communion",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      playbackId: "playback-en",
      availability: {
        kind: "related_language",
        languageSlug: "english",
        audio: true,
      },
      fallback: { kind: "related_language" },
      action: { hrefLanguageSlug: "english" },
    })
  })

  it("returns lexical results as degraded when embedding exceeds its budget", async () => {
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
      }) as unknown as TypesenseClient,
      {
        embedder: vi.fn(() => new Promise<number[]>(() => {})),
        embeddingTimeoutMs: 5,
        logger: { warn: vi.fn() },
      },
    )

    const response = await service.search({
      query: "communion",
      targetLanguageSlug: "french",
    })

    expect(response.results).toHaveLength(1)
    expect(response.degraded).toBe(true)
    expect(response.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "semantic_embedding",
          status: "degraded",
          reason: "query_embedding_timeout",
        }),
      ]),
    )
  })

  it("times embedding separately when semantic retrieval fails", async () => {
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
        semanticError: new Error("typesense_retrieval_failed"),
      }) as unknown as TypesenseClient,
      {
        embedder: vi.fn(async () => embedding),
        logger: { warn: vi.fn() },
      },
    )

    const response = await service.search({
      query: "communion",
      targetLanguageSlug: "french",
    })
    const embeddingLanes = response.laneStatuses.filter(
      (lane) => lane.lane === "semantic_embedding",
    )
    const retrievalLane = response.laneStatuses.find(
      (lane) => lane.lane === "semantic_retrieval",
    )

    expect(embeddingLanes).toEqual([
      expect.objectContaining({ status: "fulfilled", resultCount: 1 }),
    ])
    expect(retrievalLane).toEqual(
      expect.objectContaining({
        status: "degraded",
        reason: "typesense_retrieval_failed",
      }),
    )
    expect(retrievalLane?.startedOffsetMs).toBeGreaterThanOrEqual(
      embeddingLanes[0]?.startedOffsetMs ?? 0,
    )
  })
})
