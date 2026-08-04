import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  TypesenseClient,
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

function prismaFixture(): PrismaClient {
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
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaClient
}

function typesenseFixture({
  lexical = [catalogDocument],
  semantic = [],
}: {
  lexical?: TypesenseWatchCatalogDocument[]
  semantic?: Array<{
    videoId: string
    text: string
    vectorDistance: number
  }>
}) {
  return {
    multiSearch: vi.fn(async (searches: TypesenseSearchRequest[]) => {
      const search = searches[0]
      if (search.collection === TYPESENSE_WATCH_TRANSCRIPT_ALIAS) {
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
                text: entry.text,
                startSeconds: 42,
                embedding: [],
              },
            })),
          },
        ]
      }
      const isHydration = search.q === "*"
      const documents = isHydration ? [catalogDocument] : lexical
      return [
        {
          found: documents.length,
          out_of: documents.length,
          page: 1,
          search_time_ms: 1,
          hits: documents.map((document) => ({ document })),
        },
      ]
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

  it("returns transcript evidence when metadata has no matching terms", async () => {
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [],
        semantic: [
          {
            videoId: catalogDocument.id,
            text: "Ils partageaient tout ce qu'ils avaient.",
            vectorDistance: 0.2,
          },
        ],
      }) as unknown as TypesenseClient,
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
})
