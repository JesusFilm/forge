import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  TypesenseClient,
  TypesenseSearchResult,
  TypesenseSearchRequest,
} from "./typesense-client"
import { TypesenseRequestError } from "./typesense-client"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  type TypesenseWatchAvailabilityDocument,
  type TypesenseWatchCatalogDocument,
  type TypesenseWatchTranscriptDocument,
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
  localeCodes: ["fr", "en"],
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

function availabilityDocumentsForCatalog(
  catalog: TypesenseWatchCatalogDocument[],
): TypesenseWatchAvailabilityDocument[] {
  return catalog.flatMap((document) => {
    const byLanguage = new Map<string, TypesenseWatchAvailabilityDocument>()
    const audio = JSON.parse(document.audioOptionsJson) as Array<{
      languageId: string
      languageSlug: string
      languageEnglishName: string | null
      playbackId: string | null
      durationSeconds: number | null
    }>
    const subtitles = JSON.parse(document.subtitleOptionsJson) as Array<{
      languageId: string
      languageSlug: string
    }>
    for (const option of audio) {
      byLanguage.set(option.languageId, {
        id: `${document.id}:${option.languageId}`,
        videoId: document.id,
        ...option,
        audio: true,
        subtitles: false,
      })
    }
    for (const option of subtitles) {
      const existing = byLanguage.get(option.languageId)
      if (existing) {
        existing.subtitles = true
      } else {
        byLanguage.set(option.languageId, {
          id: `${document.id}:${option.languageId}`,
          videoId: document.id,
          languageId: option.languageId,
          languageSlug: option.languageSlug,
          languageEnglishName: null,
          audio: false,
          subtitles: true,
          playbackId: null,
          durationSeconds: null,
        })
      }
    }
    return [...byLanguage.values()]
  })
}

function prismaFixture({
  fallbackLanguages = [],
}: {
  fallbackLanguages?: Array<{ id: string; slug: string }>
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
        fallbackLanguages.map((fallbackLanguage) => ({
          fallbackLanguageId: fallbackLanguage.id,
          fallbackLanguage: { slug: fallbackLanguage.slug },
        })),
      ),
    },
  } as unknown as PrismaClient
}

function typesenseFixture({
  lexical = [catalogDocument],
  semantic = [],
  hybrid,
  hybridError,
  catalog = lexical.length > 0 ? lexical : [catalogDocument],
  availability = availabilityDocumentsForCatalog(catalog),
  availabilityError,
}: {
  lexical?: TypesenseWatchCatalogDocument[]
  semantic?: Array<{
    videoId: string
    text: string
    vectorDistance: number
  }>
  hybrid?: Array<{
    document: TypesenseWatchTranscriptDocument
    vectorDistance?: number
  }>
  hybridError?: Error
  catalog?: TypesenseWatchCatalogDocument[]
  availability?: TypesenseWatchAvailabilityDocument[]
  availabilityError?: Error
}) {
  function projectDocument<TDocument extends object>(
    document: TDocument,
    request: TypesenseSearchRequest,
  ): TDocument {
    const includeFields = String(request.include_fields ?? "")
      .split(",")
      .filter(Boolean)
    const excludeFields = new Set(
      String(request.exclude_fields ?? "")
        .split(",")
        .filter(Boolean),
    )
    const entries = Object.entries(document).filter(([field]) =>
      includeFields.length > 0
        ? includeFields.includes(field)
        : !excludeFields.has(field),
    )
    return Object.fromEntries(entries) as TDocument
  }

  return {
    multiSearch: vi.fn(async (searches: TypesenseSearchRequest[]) => {
      if (searches.some((search) => search.group_by != null)) {
        if (hybridError) throw hybridError
        const inferredHybrid = [
          ...lexical.map((document) => ({
            vectorDistance: undefined,
            document: {
              id: `video:${document.id}`,
              documentKind: "video" as const,
              videoId: document.id,
              canonicalVideoId: `core:${document.coreId ?? document.id}`,
              language: "__catalog__",
              publiclyVisible: true,
              titles: document.titles,
              descriptions: document.descriptions,
              text: "",
              startSeconds: null,
            },
          })),
          ...semantic.map((entry, index) => ({
            vectorDistance: entry.vectorDistance,
            document: {
              id: `chunk-${index}`,
              documentKind: "transcript" as const,
              videoId: entry.videoId,
              canonicalVideoId: `core:${
                catalog.find((document) => document.id === entry.videoId)
                  ?.coreId ?? entry.videoId
              }`,
              language: "fr",
              publiclyVisible: true,
              titles: catalog.find((document) => document.id === entry.videoId)
                ?.titles,
              text: entry.text,
              startSeconds: 42,
            },
          })),
        ]
        const query = String(searches[0]?.q ?? "").toLocaleLowerCase()
        const entries = [...(hybrid ?? inferredHybrid)].sort((left, right) => {
          const leftExact = left.document.titles?.some(
            (title) => title.toLocaleLowerCase() === query,
          )
          const rightExact = right.document.titles?.some(
            (title) => title.toLocaleLowerCase() === query,
          )
          return Number(rightExact) - Number(leftExact)
        })
        const groups = new Map<string, Array<(typeof entries)[number]>>()
        for (const entry of entries) {
          const group = groups.get(entry.document.canonicalVideoId) ?? []
          group.push(entry)
          groups.set(entry.document.canonicalVideoId, group)
        }
        return searches.map((request) => {
          const groupedDocuments = [...groups.entries()]
          const offset = Number(request.offset ?? 0)
          const limit = Number(request.limit ?? groupedDocuments.length)
          const groupLimit = Number(request.group_limit ?? 1)
          const pageGroups = groupedDocuments.slice(offset, offset + limit)
          return {
            found: groupedDocuments.length,
            out_of: groupedDocuments.length,
            page: 1,
            search_time_ms: 2,
            grouped_hits: pageGroups.map(([canonicalVideoId, group]) => ({
              group_key: [canonicalVideoId],
              found: group.length,
              hits: group.slice(0, groupLimit).map((entry) => ({
                vector_distance: entry.vectorDistance,
                document: projectDocument(entry.document, request),
              })),
            })),
          }
        })
      }
      return searches.map((request) => {
        if (request.collection === TYPESENSE_WATCH_TRANSCRIPT_ALIAS) {
          return {
            found: semantic.length,
            out_of: semantic.length,
            page: 1,
            search_time_ms: 2,
            hits: semantic.map((entry, index) => ({
              vector_distance: entry.vectorDistance,
              document: {
                id: `chunk-${index}`,
                documentKind: "transcript" as const,
                videoId: entry.videoId,
                canonicalVideoId: `video:${entry.videoId}`,
                language: "fr",
                publiclyVisible: true,
                text: entry.text,
                startSeconds: 42,
              },
            })),
          }
        }
        if (request.collection === TYPESENSE_WATCH_AVAILABILITY_ALIAS) {
          if (availabilityError) throw availabilityError
          const requestedValues = [
            ...String(request.filter_by ?? "").matchAll(/`([^`]+)`/g),
          ].map((match) => match[1])
          const documents = availability.filter(
            (document) =>
              requestedValues.includes(document.videoId) &&
              requestedValues.includes(document.languageId),
          )
          return {
            found: documents.length,
            out_of: documents.length,
            page: 1,
            search_time_ms: 1,
            hits: documents.map((document) => ({
              document: projectDocument(document, request),
            })),
          } satisfies TypesenseSearchResult<TypesenseWatchAvailabilityDocument>
        }
        const isHydration = request.q === "*"
        const requestedIds = isHydration
          ? [...String(request.filter_by ?? "").matchAll(/`([^`]+)`/g)].map(
              (match) => match[1],
            )
          : []
        const documents = isHydration
          ? catalog.filter((document) => requestedIds.includes(document.id))
          : lexical
        const perPage = Number(request.per_page ?? documents.length)
        const page = Number(request.page ?? 1)
        const start = isHydration ? 0 : (page - 1) * perPage
        const pageDocuments = documents.slice(start, start + perPage)
        return {
          found: documents.length,
          out_of: documents.length,
          page,
          search_time_ms: 1,
          hits: pageDocuments.map((document) => ({
            document: projectDocument(document, request),
          })),
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
      snippet: "Les croyants partagent leur vie.",
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
      coreId: "core-broad-match",
      slug: "jesus-film",
      titles: ["JESUS Film"],
      localeCodes: ["fr"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "JESUS Film", description: null },
      ]),
    }
    const wholeTitleMatch: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "z-whole-title-match",
      coreId: "core-whole-title-match",
      slug: "jesus",
      titles: ["JESUS"],
      localeCodes: ["fr"],
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

  it("bounds the full-document hydration payload for broad lexical queries", async () => {
    const catalog = Array.from({ length: 100 }, (_value, index) => ({
      ...catalogDocument,
      id: `jesus-${index.toString().padStart(3, "0")}`,
      coreId: `core-jesus-${index}`,
      slug: `jesus-${index}`,
      titles: [index === 0 ? "JESUS" : `JESUS Film ${index}`],
      localeCodes: ["fr"],
      localesJson: JSON.stringify([
        {
          locale: "fr",
          title: index === 0 ? "JESUS" : `JESUS Film ${index}`,
          description: null,
        },
      ]),
    }))
    const typesense = typesenseFixture({ lexical: catalog, catalog })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "JESUS",
      targetLanguageSlug: "french",
    })

    const requests = typesense.multiSearch.mock.calls.flatMap(
      ([searches]) => searches,
    )
    const hybridRequest = requests.find(
      (request) =>
        request.collection === TYPESENSE_WATCH_TRANSCRIPT_ALIAS &&
        request.group_by === "canonicalVideoId",
    )
    const resultHydrationRequests = requests.filter(
      (request) =>
        request.collection !== TYPESENSE_WATCH_TRANSCRIPT_ALIAS &&
        request.collection !== TYPESENSE_WATCH_AVAILABILITY_ALIAS &&
        request.q === "*" &&
        request.include_fields ===
          "id,slug,titles,localesJson,label,childCount,imageUrl,imageBlurDataUrl",
    )
    const availabilityRequest = requests.find(
      (request) => request.collection === TYPESENSE_WATCH_AVAILABILITY_ALIAS,
    )

    expect(hybridRequest).toMatchObject({
      query_by: "titles,descriptions",
      query_by_weights: "4,1",
      group_limit: 3,
      drop_tokens_threshold: 1,
      rerank_hybrid_matches: false,
    })
    expect(hybridRequest?.vector_query).toContain("k:80, alpha:0.3")
    expect(hybridRequest?.vector_query).toContain("distance_threshold:0.6")
    expect(hybridRequest?.filter_by).toBe(
      "publiclyVisible:=true && (documentKind:=video || language:=[`fr`])",
    )
    expect(
      requests.some(
        (request) =>
          request.q === "*" &&
          request.include_fields === "id,titles,localesJson",
      ),
    ).toBe(false)
    expect(resultHydrationRequests).toHaveLength(1)
    expect(resultHydrationRequests[0]?.per_page).toBe(21)
    expect(availabilityRequest).toMatchObject({
      q: "*",
      include_fields:
        "id,videoId,languageId,languageSlug,languageEnglishName,audio,subtitles,playbackId,durationSeconds",
    })
    expect(availabilityRequest?.filter_by).toContain(
      "languageId:=[`language-fr`]",
    )
    expect(
      typesense.multiSearch.mock.calls.some(
        ([searches]) =>
          searches.includes(resultHydrationRequests[0]) &&
          availabilityRequest != null &&
          searches.includes(availabilityRequest),
      ),
    ).toBe(true)
    expect(
      requests.some((request) =>
        String(request.include_fields).includes("audioOptionsJson"),
      ),
    ).toBe(false)
    expect(response.results).toHaveLength(20)
    expect(response.hasMore).toBe(true)
  })

  it("falls back to legacy catalog watchability while the availability alias is absent", async () => {
    const logger = { warn: vi.fn() }
    const typesense = typesenseFixture({
      lexical: [catalogDocument],
      availabilityError: new TypesenseRequestError(
        "availability alias missing",
        404,
      ),
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding), logger },
    )

    const response = await service.search({
      query: "communion",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      playbackId: "playback-fr",
      availability: { kind: "target_audio" },
    })
    expect(
      typesense.multiSearch.mock.calls
        .flatMap(([searches]) => searches)
        .some(
          (request) =>
            request.collection === TYPESENSE_WATCH_AVAILABILITY_ALIAS,
        ),
    ).toBe(true)
    expect(
      typesense.multiSearch.mock.calls
        .flatMap(([searches]) => searches)
        .some(
          (request) =>
            request.q === "*" &&
            request.include_fields ===
              "id,slug,titles,localesJson,label,childCount,imageUrl,imageBlurDataUrl,audioOptionsJson,subtitleOptionsJson",
        ),
    ).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      "[typesense-watch-search] event=availability_alias_fallback",
    )
  })

  it("falls back to legacy locale JSON until the active index has locale codes", async () => {
    const legacyDocument = { ...catalogDocument, localeCodes: undefined }
    const legacyCatalog = {
      ...legacyDocument,
      titles: ["The Fellowship of the Believers", "La communion des croyants"],
      localesJson: JSON.stringify([
        {
          locale: "en",
          title: "The Fellowship of the Believers",
          description: "The believers share their lives.",
        },
        {
          locale: "fr",
          title: "La communion des croyants",
          description: "Les croyants partagent leur vie.",
        },
      ]),
    } as TypesenseWatchCatalogDocument
    const typesense = typesenseFixture({
      lexical: [legacyCatalog],
      catalog: [legacyCatalog],
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "communion",
      displayLanguageSlug: "french",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      title: "La communion des croyants",
      snippet: "Les croyants partagent leur vie.",
      evidence: { kind: "exact_title" },
    })
    expect(
      typesense.multiSearch.mock.calls
        .flatMap(([searches]) => searches)
        .some(
          (request) =>
            request.q === "*" &&
            request.include_fields === "id,titles,localesJson",
        ),
    ).toBe(false)
  })

  it("uses one offset query for deep native pagination", async () => {
    const catalog = Array.from({ length: 260 }, (_value, index) => ({
      ...catalogDocument,
      id: `video-${index.toString().padStart(3, "0")}`,
      coreId: `core-care-${index}`,
      slug: `care-${index}`,
      titles: [`Care ${index}`],
      localeCodes: ["fr"],
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
    expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        collection: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
        offset: 250,
        limit: 2,
      }),
    ])
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
      "publiclyVisible:=true && (documentKind:=video || language:=[`fr`])",
    )
    expect(semanticRequest?.group_by).toBe("canonicalVideoId")
    const semanticCatalogHydration = typesense.multiSearch.mock.calls
      .flatMap(([searches]) => searches)
      .find(
        (search) =>
          search.collection !== TYPESENSE_WATCH_TRANSCRIPT_ALIAS &&
          search.q === "*" &&
          search.include_fields != null,
      )
    expect(semanticCatalogHydration?.include_fields).toBe(
      "id,slug,titles,localesJson,label,childCount,imageUrl,imageBlurDataUrl",
    )
    expect(
      typesense.multiSearch.mock.calls
        .flatMap(([searches]) => searches)
        .some(
          (search) =>
            search.include_fields ===
            "id,audioLanguageSlugs,subtitleLanguageSlugs",
        ),
    ).toBe(false)
  })

  it("uses one grouped native hybrid request and returns one language variant", async () => {
    const embedder = vi.fn(async () => embedding)
    const typesense = typesenseFixture({
      lexical: [],
      catalog: [catalogDocument],
      hybrid: [
        {
          vectorDistance: 0.2,
          document: {
            id: "chunk-fr",
            documentKind: "transcript",
            videoId: catalogDocument.id,
            canonicalVideoId: "core:communion",
            language: "fr",
            publiclyVisible: true,
            titles: catalogDocument.titles,
            text: "Communion en français",
            startSeconds: 12,
          },
        },
        {
          vectorDistance: 0.21,
          document: {
            id: "chunk-en",
            documentKind: "transcript",
            videoId: catalogDocument.id,
            canonicalVideoId: "core:communion",
            language: "en",
            publiclyVisible: true,
            titles: catalogDocument.titles,
            text: "Communion in English",
            startSeconds: 14,
          },
        },
      ],
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder },
    )

    const response = await service.search({
      query: "a community sharing life",
      targetLanguageSlug: "french",
    })

    expect(response.results).toHaveLength(1)
    expect(response.results[0]).toMatchObject({
      id: catalogDocument.id,
      snippet: "Communion en français",
      evidence: {
        kind: "transcript_semantic",
        languageSlug: "french",
      },
    })
    expect(embedder).toHaveBeenCalledTimes(1)
    expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        collection: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
        group_by: "canonicalVideoId",
        group_limit: 3,
        filter_by:
          "publiclyVisible:=true && (documentKind:=video || language:=[`fr`])",
      }),
    ])
  })

  it("chooses the best watchable sibling within a canonical group", async () => {
    const unavailable: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-unavailable",
      coreId: "core-shared",
      slug: "unavailable-edition",
      audioLanguageSlugs: [],
      subtitleLanguageSlugs: [],
      audioOptionsJson: "[]",
      subtitleOptionsJson: "[]",
    }
    const playable: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-playable",
      coreId: "core-shared",
      slug: "playable-edition",
    }
    const typesense = typesenseFixture({
      lexical: [],
      catalog: [unavailable, playable],
      hybrid: [
        {
          vectorDistance: 0.05,
          document: {
            id: "chunk-unavailable",
            documentKind: "transcript",
            videoId: unavailable.id,
            canonicalVideoId: "core:shared",
            language: "fr",
            publiclyVisible: true,
            titles: ["A distant title"],
            text: "Stronger but unavailable evidence",
            startSeconds: 10,
          },
        },
        {
          vectorDistance: 0.3,
          document: {
            id: "chunk-playable",
            documentKind: "transcript",
            videoId: playable.id,
            canonicalVideoId: "core:shared",
            language: "fr",
            publiclyVisible: true,
            titles: ["Another distant title"],
            text: "Playable sibling evidence",
            startSeconds: 20,
          },
        },
      ],
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "community",
      targetLanguageSlug: "french",
    })

    expect(response.results).toHaveLength(1)
    expect(response.results[0]).toMatchObject({
      id: playable.id,
      slug: playable.slug,
      snippet: "Playable sibling evidence",
      availability: { kind: "target_audio" },
    })
    expect(typesense.multiSearch).toHaveBeenCalledTimes(2)
    expect(typesense.multiSearch.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          q: "*",
          filter_by: expect.stringContaining("`video-unavailable`"),
        }),
      ]),
    )
    expect(typesense.multiSearch.mock.calls[1]?.[0][0]?.filter_by).toContain(
      "`video-playable`",
    )
  })

  it("computes native hasMore after catalog hydration", async () => {
    const typesense = typesenseFixture({
      lexical: [],
      catalog: [catalogDocument],
      hybrid: [
        {
          vectorDistance: 0.2,
          document: {
            id: "chunk-playable",
            documentKind: "transcript",
            videoId: catalogDocument.id,
            canonicalVideoId: "core:playable",
            language: "fr",
            publiclyVisible: true,
            titles: ["Playable"],
            text: "Playable evidence",
            startSeconds: 12,
          },
        },
        {
          vectorDistance: 0.21,
          document: {
            id: "chunk-orphan",
            documentKind: "transcript",
            videoId: "missing-catalog-video",
            canonicalVideoId: "core:orphan",
            language: "fr",
            publiclyVisible: true,
            titles: ["Orphan"],
            text: "Orphan evidence",
            startSeconds: 14,
          },
        },
      ],
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "community",
      targetLanguageSlug: "french",
      limit: 1,
    })

    expect(response.results.map((result) => result.id)).toEqual([
      catalogDocument.id,
    ])
    expect(response.hasMore).toBe(false)
  })

  it("reports distinct native metadata and semantic group contributions", async () => {
    const typesense = typesenseFixture({
      lexical: [],
      catalog: [catalogDocument],
      hybrid: [
        {
          document: {
            id: "video-anchor",
            documentKind: "video",
            videoId: catalogDocument.id,
            canonicalVideoId: "core:communion",
            language: "__catalog__",
            publiclyVisible: true,
            titles: ["Unrelated metadata"],
            text: "",
            startSeconds: null,
          },
        },
        {
          vectorDistance: 0.2,
          document: {
            id: "chunk-fr",
            documentKind: "transcript",
            videoId: catalogDocument.id,
            canonicalVideoId: "core:communion",
            language: "fr",
            publiclyVisible: true,
            titles: ["Unrelated metadata"],
            text: "Semantic evidence",
            startSeconds: 12,
          },
        },
      ],
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "community",
      targetLanguageSlug: "french",
    })

    expect(response.laneStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "metadata_retrieval",
          resultCount: 1,
        }),
        expect.objectContaining({
          lane: "semantic_retrieval",
          resultCount: 1,
        }),
      ]),
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
      prismaFixture({
        fallbackLanguages: [{ id: "language-en", slug: "english" }],
      }),
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

  it("preserves configured fallback priority instead of availability document order", async () => {
    const relatedDocument: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      audioLanguageSlugs: ["english", "spanish-castilian"],
      audioOptionsJson: JSON.stringify([
        {
          id: "dub-en",
          languageId: "language-en",
          languageSlug: "english",
          languageEnglishName: "English",
          playbackId: "playback-en",
          durationSeconds: 175,
        },
        {
          id: "dub-es",
          languageId: "language-es",
          languageSlug: "spanish-castilian",
          languageEnglishName: "Spanish, Castilian",
          playbackId: "playback-es",
          durationSeconds: 176,
        },
      ]),
    }
    const service = new TypesenseWatchSearchService(
      prismaFixture({
        fallbackLanguages: [
          { id: "language-es", slug: "spanish-castilian" },
          { id: "language-en", slug: "english" },
        ],
      }),
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
      playbackId: "playback-es",
      availability: { languageSlug: "spanish-castilian" },
    })
  })

  it("returns lexical results as degraded when embedding exceeds its budget", async () => {
    const embedder = vi.fn(() => new Promise<number[]>(() => {}))
    const typesense = typesenseFixture({
      lexical: [catalogDocument],
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      {
        embedder,
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
    expect(embedder).toHaveBeenCalledTimes(1)
    expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        q: "communion",
        per_page: 100,
        page: 1,
      }),
    ])
  })

  it("falls back to the legacy dual query without embedding twice", async () => {
    const embedder = vi.fn(async () => embedding)
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
        hybridError: new TypesenseRequestError(
          "Field canonicalVideoId not found",
          400,
        ),
      }) as unknown as TypesenseClient,
      {
        embedder,
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
        reason: "native_hybrid_fallback:Field canonicalVideoId not found",
      }),
    )
    expect(retrievalLane?.startedOffsetMs).toBeGreaterThanOrEqual(
      embeddingLanes[0]?.startedOffsetMs ?? 0,
    )
    expect(embedder).toHaveBeenCalledTimes(1)
  })

  it("reserves one multi-search slot for legacy semantic retrieval", async () => {
    const typesense = typesenseFixture({
      lexical: [catalogDocument],
      hybridError: new TypesenseRequestError(
        "Field canonicalVideoId not found",
        400,
      ),
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding), logger: { warn: vi.fn() } },
    )

    await service.search({
      query: "communion",
      targetLanguageSlug: "french",
      offset: 20_000,
      limit: 50,
    })

    const legacyRequests = typesense.multiSearch.mock.calls[1]?.[0] ?? []
    expect(legacyRequests).toHaveLength(50)
    expect(
      legacyRequests.filter(
        (request) => request.collection === TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      ),
    ).toHaveLength(1)
  })

  it("does not double Typesense latency after a transient hybrid failure", async () => {
    const embedder = vi.fn(async () => embedding)
    const typesense = typesenseFixture({
      hybridError: new TypesenseRequestError("upstream unavailable", 503),
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder, logger: { warn: vi.fn() } },
    )

    await expect(
      service.search({ query: "communion", targetLanguageSlug: "french" }),
    ).rejects.toThrow("upstream unavailable")
    expect(embedder).toHaveBeenCalledTimes(1)
    expect(typesense.multiSearch).toHaveBeenCalledTimes(1)
  })
})
