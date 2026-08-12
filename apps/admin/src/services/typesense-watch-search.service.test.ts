import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  TypesenseClient,
  TypesenseSearchResult,
  TypesenseSearchRequest,
} from "./typesense-client"
import { TypesenseRequestError } from "./typesense-client"
import { resolveSearchLanguageSignals } from "./search-language-resolution"
import { buildAvailabilityDocuments } from "./typesense-watch-search-indexer"
import { buildTypesenseWatchLexicalDocuments } from "./typesense-watch-search-lexical"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  type TypesenseWatchAvailabilityDocument,
  type TypesenseWatchCatalogDocument,
  type TypesenseWatchTranscriptDocument,
} from "./typesense-watch-search-schema"
import {
  createCandidateWatchSearchProfile,
  type TypesenseWatchSearchCollectionBinding,
} from "./typesense-watch-search-profile"
import {
  resolveTypesenseWatchSearchApiKey,
  TypesenseWatchSearchService,
} from "./typesense-watch-search.service"

vi.mock("./search-language-resolution", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./search-language-resolution")>()
  return {
    ...actual,
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
  }
})

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

const jesusChineseCatalogDocument: TypesenseWatchCatalogDocument = {
  id: "cmp76xcw602imny01vnsbwwy9",
  coreId: "1_jf-0-0",
  slug: "jesus",
  titles: ["JESUS", "耶稣", "耶穌"],
  localeCodes: ["en", "zh-hans", "zh-hant"],
  descriptions: [],
  localesJson: JSON.stringify([
    {
      locale: "en",
      languageSlug: "english",
      title: "JESUS",
      description: "The life of Jesus.",
    },
    {
      locale: "zh-Hans",
      languageSlug: "chinese-simplified",
      title: "耶稣",
      description: "耶稣的一生。",
    },
    {
      locale: "zh-Hant",
      languageSlug: "chinese-traditional",
      title: "耶穌",
      description: "耶穌的一生。",
    },
  ]),
  label: "featureFilm",
  childCount: 0,
  imageUrl: "https://example.com/jesus.jpg",
  imageBlurDataUrl: null,
  audioLanguageSlugs: ["mandarin-china"],
  subtitleLanguageSlugs: [],
  audioOptionsJson: JSON.stringify([
    {
      id: "dub-mandarin-china",
      languageId: "language-mandarin-china",
      languageSlug: "mandarin-china",
      languageEnglishName: "Mandarin Chinese",
      playbackId: "playback-mandarin-china",
      durationSeconds: 7_677,
    },
  ]),
  subtitleOptionsJson: "[]",
}

const japaneseCatalogDocument: TypesenseWatchCatalogDocument = {
  id: "video-japan",
  coreId: "core-japan",
  slug: "japan",
  titles: ["日本"],
  localeCodes: ["ja"],
  descriptions: [],
  localesJson: JSON.stringify([
    {
      locale: "ja",
      languageSlug: "japanese",
      title: "日本",
      description: "日本について。",
    },
  ]),
  label: "shortFilm",
  childCount: 0,
  imageUrl: "https://example.com/japan.jpg",
  imageBlurDataUrl: null,
  audioLanguageSlugs: ["japanese"],
  subtitleLanguageSlugs: [],
  audioOptionsJson: JSON.stringify([
    {
      id: "dub-japanese",
      languageId: "language-japanese",
      languageSlug: "japanese",
      languageEnglishName: "Japanese",
      playbackId: "playback-japanese",
      durationSeconds: 180,
    },
  ]),
  subtitleOptionsJson: "[]",
}

const candidateFieldManifests = {
  catalog: [{ name: "slug", type: "string" }],
  availability: [{ name: "videoId", type: "string" }],
  lexical: [
    { name: "title_en", type: "string[]" },
    { name: "title_fr", type: "string[]" },
    { name: "title_ja", type: "string[]" },
    { name: "title_ru", type: "string[]" },
    { name: "title_zh", type: "string[]" },
    { name: "title_fallback", type: "string[]" },
    { name: "metadata_en", type: "string[]" },
    { name: "metadata_fr", type: "string[]" },
    { name: "metadata_ja", type: "string[]" },
    { name: "metadata_ru", type: "string[]" },
    { name: "metadata_zh", type: "string[]" },
    { name: "metadata_fallback", type: "string[]" },
  ],
  transcript: [{ name: "embedding", type: "float[]", num_dim: 1536 }],
} as const

function candidateProfile() {
  return createCandidateWatchSearchProfile({
    generationId: "generation-1",
    applicationRevision: "revision-1",
    transcriptProjectionRevision: 7n,
    fieldManifests: candidateFieldManifests,
    collections: {
      catalog: "watch_search_candidate_generation-1_catalog",
      availability: "watch_search_candidate_generation-1_availability",
      lexical: "watch_search_candidate_generation-1_lexical",
      transcript: "watch_search_transcripts_20260809",
    },
  })
}

function availabilityDocumentsForCatalog(
  catalog: TypesenseWatchCatalogDocument[],
): TypesenseWatchAvailabilityDocument[] {
  return buildAvailabilityDocuments(catalog)
}

function prismaFixture({
  fallbackLanguages = [],
  targetLanguage = {
    id: "language-fr",
    slug: "french",
    name: { en: "French" },
  },
  evidenceLanguages = [{ slug: "french", bcp47: "fr" }],
}: {
  fallbackLanguages?: Array<{ id: string; slug: string }>
  targetLanguage?: {
    id: string
    slug: string
    name: Record<string, string>
  }
  evidenceLanguages?: Array<{ slug: string; bcp47: string }>
} = {}): PrismaClient {
  return {
    language: {
      findFirst: vi.fn(async () => targetLanguage),
      findMany: vi.fn(async () => evidenceLanguages),
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
  availabilityFound,
  availabilityError,
  binding = {
    catalog: TYPESENSE_WATCH_CATALOG_ALIAS,
    availability: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
    lexical: TYPESENSE_WATCH_LEXICAL_ALIAS,
    transcript: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  },
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
  availabilityFound?: number
  availabilityError?: Error
  binding?: TypesenseWatchSearchCollectionBinding
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
      if (searches.some((search) => search.collection === binding.lexical)) {
        if (hybridError) throw hybridError
        const inferredSemantic = semantic.map((entry, index) => ({
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
            text: entry.text,
            startSeconds: 42,
          },
        }))
        const semanticEntries = (hybrid ?? inferredSemantic).filter(
          (entry) =>
            entry.document.documentKind === "transcript" &&
            String(entry.document.language) === "fr",
        )
        const lexicalDocuments = buildTypesenseWatchLexicalDocuments(lexical)
        return searches.map((request) => {
          const requestedFilterValues = [
            ...String(request.filter_by ?? "").matchAll(/`([^`]+)`/g),
          ].map((match) => match[1])
          const entries =
            request.collection === binding.lexical
              ? lexicalDocuments
                  .filter(
                    (document) =>
                      requestedFilterValues.length === 0 ||
                      requestedFilterValues.includes(document.languageIdentity),
                  )
                  .map((document) => ({
                    vectorDistance: undefined,
                    document,
                  }))
              : semanticEntries
          const groups = new Map<string, Array<(typeof entries)[number]>>()
          for (const entry of entries) {
            const group = groups.get(entry.document.canonicalVideoId) ?? []
            group.push(entry)
            groups.set(entry.document.canonicalVideoId, group)
          }
          const groupedDocuments = [...groups.entries()]
          const perPage = Number(request.per_page ?? groupedDocuments.length)
          const page = Number(request.page ?? 1)
          const start = (page - 1) * perPage
          const groupLimit = Number(request.group_limit ?? 1)
          const pageGroups = groupedDocuments.slice(start, start + perPage)
          return {
            found: groupedDocuments.length,
            out_of: groupedDocuments.length,
            page,
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
        if (request.collection === binding.transcript) {
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
        if (request.collection === binding.availability) {
          if (availabilityError) throw availabilityError
          const requestedValues = [
            ...String(request.filter_by ?? "").matchAll(/`([^`]+)`/g),
          ].map((match) => match[1])
          const documents = availability.filter(
            (document) =>
              requestedValues.includes(document.videoId) &&
              requestedValues.includes(document.languageId) &&
              (request.filter_by?.toString().includes("audio:=true")
                ? document.audio
                : true),
          )
          const perPage = Number(request.per_page ?? documents.length)
          const page = Number(request.page ?? 1)
          const pageDocuments = documents.slice(
            (page - 1) * perPage,
            page * perPage,
          )
          return {
            found: availabilityFound ?? documents.length,
            out_of: availabilityFound ?? documents.length,
            page,
            search_time_ms: 1,
            hits: pageDocuments.map((document) => ({
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
  it("requires the search-only key for candidates while preserving the current fallback", () => {
    const legacyOnly = {
      legacyApiKey: "legacy-key",
      searchApiKey: undefined,
    }
    expect(
      resolveTypesenseWatchSearchApiKey({
        ...legacyOnly,
        allowLegacyFallback: true,
      }),
    ).toBe("legacy-key")
    expect(
      resolveTypesenseWatchSearchApiKey({
        ...legacyOnly,
        allowLegacyFallback: false,
      }),
    ).toBeUndefined()
    expect(
      resolveTypesenseWatchSearchApiKey({
        searchApiKey: "search-only-key",
        legacyApiKey: "legacy-key",
        allowLegacyFallback: false,
      }),
    ).toBe("search-only-key")
  })

  const embedding = new Array(TYPESENSE_WATCH_EMBEDDING_DIMENSIONS).fill(0)

  beforeEach(() => vi.clearAllMocks())

  it("uses one exact candidate binding for every retrieval lane", async () => {
    const profile = createCandidateWatchSearchProfile({
      generationId: "generation-1",
      applicationRevision: "revision-1",
      transcriptProjectionRevision: 7n,
      fieldManifests: candidateFieldManifests,
      collections: {
        catalog: "watch_search_candidate_generation-1_catalog",
        availability: "watch_search_candidate_generation-1_availability",
        lexical: "watch_search_candidate_generation-1_lexical",
        transcript: "watch_search_transcripts_20260809",
      },
    })
    const typesense = typesenseFixture({
      lexical: [catalogDocument],
      binding: profile.binding,
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => embedding) },
    )

    const { response, diagnostics } = await service.searchWithDiagnostics({
      query: "communion",
    })

    expect(typesense.multiSearch).toHaveBeenCalledTimes(2)
    expect(
      typesense.multiSearch.mock.calls[0]?.[0].map(
        (request) => request.collection,
      ),
    ).toEqual([
      profile.binding.lexical,
      profile.binding.lexical,
      profile.binding.transcript,
    ])
    expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        query_by: "title_en,title_fr,title_ja,title_ru,title_zh,title_fallback",
        filter_by: undefined,
      }),
      expect.objectContaining({
        query_by:
          "metadata_en,metadata_fr,metadata_ja,metadata_ru,metadata_zh,metadata_fallback",
        filter_by: undefined,
      }),
      expect.objectContaining({
        filter_by: "documentKind:=transcript && publiclyVisible:=true",
      }),
    ])
    expect(
      typesense.multiSearch.mock.calls.flatMap(([searches]) =>
        searches.map((request) => request.collection),
      ),
    ).toEqual([
      profile.binding.lexical,
      profile.binding.lexical,
      profile.binding.transcript,
      profile.binding.catalog,
      profile.binding.availability,
    ])
    expect(response.results[0]?.id).toBe(catalogDocument.id)
    expect(response).not.toHaveProperty("diagnostics")
    expect(diagnostics).toMatchObject({
      profile: "CANDIDATE",
      generationId: "generation-1",
      applicationRevision: "revision-1",
      transcriptProjectionRevision: 7n,
      binding: profile.binding,
      retrievalCalls: 2,
      logicalSubsearches: 5,
    })
  })

  it("never retries a missing candidate projection through current aliases", async () => {
    const profile = createCandidateWatchSearchProfile({
      generationId: "generation-1",
      applicationRevision: "revision-1",
      transcriptProjectionRevision: 7n,
      fieldManifests: candidateFieldManifests,
      collections: {
        catalog: "watch_search_candidate_generation-1_catalog",
        availability: "watch_search_candidate_generation-1_availability",
        lexical: "watch_search_candidate_generation-1_lexical",
        transcript: "watch_search_transcripts_20260809",
      },
    })
    const typesense = {
      multiSearch: vi.fn(async () => {
        throw new TypesenseRequestError(
          `missing ${profile.binding.lexical}`,
          404,
        )
      }),
    }
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense,
      { profile, embedder: vi.fn(async () => embedding) },
    )

    await expect(service.search({ query: "JESUS" })).rejects.toThrow(
      profile.binding.lexical,
    )
    expect(typesense.multiSearch).toHaveBeenCalledTimes(1)
  })

  it("uses retrieved lexical Language evidence to choose candidate playback", async () => {
    vi.mocked(resolveSearchLanguageSignals).mockResolvedValueOnce({
      queryLanguageSlug: "japanese",
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "english",
      targetLanguageSource: "fallback",
      displayLanguageSlug: "english",
      displayLanguageBcp47: "en",
      routeLanguageSlug: null,
      routeLanguageBcp47: null,
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    })
    const profile = candidateProfile()
    const typesense = typesenseFixture({
      lexical: [japaneseCatalogDocument],
      binding: profile.binding,
    })
    const prisma = prismaFixture({
      targetLanguage: {
        id: "language-japanese",
        slug: "japanese",
        name: { en: "Japanese" },
      },
      evidenceLanguages: [
        { slug: "japanese", bcp47: "ja" },
        { slug: "english", bcp47: "en" },
      ],
    })
    const service = new TypesenseWatchSearchService(
      prisma,
      typesense as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({ query: "hope" })

    expect(response.languageInterpretation.targetLanguageSlug).toBe("japanese")
    expect(response.results[0]).toMatchObject({
      id: japaneseCatalogDocument.id,
      playbackId: "playback-japanese",
      evidence: { languageSlug: "japanese" },
      availability: { kind: "target_audio", languageSlug: "japanese" },
    })
    expect(typesense.multiSearch).toHaveBeenCalledTimes(2)
    expect(prisma.language.findFirst).toHaveBeenCalledTimes(2)
  })

  it("keeps an explicit target ahead of retrieved candidate Language evidence", async () => {
    vi.mocked(resolveSearchLanguageSignals).mockResolvedValueOnce({
      queryLanguageSlug: "japanese",
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "explicit_target",
      displayLanguageSlug: "english",
      displayLanguageBcp47: "en",
      routeLanguageSlug: null,
      routeLanguageBcp47: null,
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    })
    const profile = candidateProfile()
    const typesense = typesenseFixture({
      lexical: [japaneseCatalogDocument],
      binding: profile.binding,
    })
    const prisma = prismaFixture({
      targetLanguage: {
        id: "language-es",
        slug: "spanish-castilian",
        name: { en: "Spanish" },
      },
      evidenceLanguages: [
        { slug: "japanese", bcp47: "ja" },
        { slug: "spanish-castilian", bcp47: "es" },
      ],
    })
    const service = new TypesenseWatchSearchService(
      prisma,
      typesense as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "hope",
      targetLanguageSlug: "spanish-castilian",
    })

    expect(response.languageInterpretation).toMatchObject({
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "explicit_target",
    })
    expect(response.results[0]).toMatchObject({
      evidence: { languageSlug: "japanese" },
      availability: { kind: "unavailable" },
    })
    expect(typesense.multiSearch).toHaveBeenCalledTimes(2)
    expect(prisma.language.findFirst).toHaveBeenCalledTimes(1)
  })

  it("returns internal work diagnostics without changing the public response", async () => {
    const typesense = typesenseFixture({ lexical: [catalogDocument] })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const { response, diagnostics } = await service.searchWithDiagnostics({
      query: "communion",
    })

    expect(response).not.toHaveProperty("diagnostics")
    expect(diagnostics).toMatchObject({
      profile: "CURRENT",
      generationId: null,
      retrievalCalls: 2,
      logicalSubsearches: 5,
      hydratedRecords: 1,
    })
    expect(diagnostics.queryFieldCount).toBeGreaterThan(0)
    expect(diagnostics.queryByBytes).toBeGreaterThan(0)
    expect(diagnostics.candidates).toBeGreaterThan(0)
    expect(diagnostics.typesenseWallTimeMs).toBeGreaterThanOrEqual(0)
    expect(diagnostics.retryCount).toBe(0)
    expect(diagnostics.groupedHits).toBeGreaterThan(0)
    expect(diagnostics.binding).toEqual({
      catalog: TYPESENSE_WATCH_CATALOG_ALIAS,
      availability: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
      lexical: TYPESENSE_WATCH_LEXICAL_ALIAS,
      transcript: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
    })
  })

  it("gives every candidate locale field equal authority and lowers only fallback", async () => {
    const typesense = typesenseFixture({ lexical: [catalogDocument] })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      {
        embedder: vi.fn(async () => embedding),
        profile: candidateProfile(),
      },
    )

    await service.search({ query: "耶稣" })

    expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          query_by:
            "title_en,title_fr,title_ja,title_ru,title_zh,title_fallback",
          query_by_weights: "4,4,4,4,4,1",
          num_typos: "2,2,2,2,2,1",
        }),
        expect.objectContaining({
          query_by:
            "metadata_en,metadata_fr,metadata_ja,metadata_ru,metadata_zh,metadata_fallback",
          query_by_weights: "4,4,4,4,4,1",
          num_typos: "2,2,2,2,2,1",
        }),
      ]),
    )
  })

  it.each([
    {
      name: "Thai",
      query: "พระเยซู",
      slug: "thai",
      bcp47: "th",
      titleFields: "title_th,title_fallback",
      metadataFields: "metadata_th,metadata_fallback",
    },
    {
      name: "Filipino",
      query: "Hesus",
      slug: "filipino",
      bcp47: "fil",
      titleFields: "title_fallback",
      metadataFields: "metadata_fallback",
    },
    {
      name: "Maori",
      query: "Ihu",
      slug: "maori",
      bcp47: "mi",
      titleFields: "title_mi,title_fallback",
      metadataFields: "metadata_mi,metadata_fallback",
    },
  ])(
    "uses locale-aware $name title and metadata fields",
    async ({ query, slug, bcp47, titleFields, metadataFields }) => {
      vi.mocked(resolveSearchLanguageSignals).mockResolvedValueOnce({
        queryLanguageSlug: slug,
        queryNamedLanguageSlug: null,
        targetLanguageSlug: slug,
        targetLanguageSource: "explicit_target",
        displayLanguageSlug: slug,
        displayLanguageBcp47: bcp47,
        routeLanguageSlug: slug,
        routeLanguageBcp47: bcp47,
        currentWatchLanguageSlug: null,
        acceptLanguage: null,
        acceptLanguageSlug: null,
      })
      const typesense = typesenseFixture({ lexical: [catalogDocument] })
      const service = new TypesenseWatchSearchService(
        prismaFixture(),
        typesense as unknown as TypesenseClient,
        { embedder: vi.fn(async () => embedding) },
      )

      await service.search({ query, targetLanguageSlug: slug })

      expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            query_by: titleFields,
            filter_by: expect.stringContaining(`\`slug:${slug}\``),
          }),
          expect.objectContaining({
            query_by: metadataFields,
            filter_by: expect.stringContaining(
              `\`locale:${bcp47.toLowerCase()}\``,
            ),
          }),
        ]),
      )
    },
  )

  it.each([
    {
      query: "耶稣",
      localizationSlug: "chinese-simplified",
      targetLanguageSource: "query_script" as const,
    },
    {
      query: "耶穌",
      localizationSlug: "chinese-traditional",
      targetLanguageSource: "query_script" as const,
    },
    {
      query: "耶稣",
      localizationSlug: "chinese-simplified",
      targetLanguageSource: "explicit_target" as const,
    },
  ])(
    "retrieves the production-shaped JESUS localization for $query with $targetLanguageSource Mandarin audio",
    async ({ query, localizationSlug, targetLanguageSource }) => {
      vi.mocked(resolveSearchLanguageSignals).mockResolvedValueOnce({
        queryLanguageSlug: null,
        queryNamedLanguageSlug: null,
        targetLanguageSlug: "mandarin-china",
        targetLanguageSource,
        displayLanguageSlug: "english",
        displayLanguageBcp47: "en",
        routeLanguageSlug: null,
        routeLanguageBcp47: null,
        currentWatchLanguageSlug: null,
        acceptLanguage: null,
        acceptLanguageSlug: null,
      })
      const typesense = typesenseFixture({
        lexical: [jesusChineseCatalogDocument],
      })
      const service = new TypesenseWatchSearchService(
        prismaFixture({
          targetLanguage: {
            id: "language-mandarin-china",
            slug: "mandarin-china",
            name: { en: "Mandarin Chinese" },
          },
          evidenceLanguages: [{ slug: "mandarin-china", bcp47: "zh" }],
        }),
        typesense as unknown as TypesenseClient,
        { embedder: vi.fn(async () => embedding) },
      )

      const response = await service.search({
        query,
        targetLanguageSlug:
          targetLanguageSource === "explicit_target"
            ? "mandarin-china"
            : undefined,
      })
      const titleRequest = typesense.multiSearch.mock.calls[0]?.[0].find(
        (request) =>
          request.collection === TYPESENSE_WATCH_LEXICAL_ALIAS &&
          String(request.query_by).startsWith("title_"),
      )

      expect(titleRequest).toMatchObject({
        query_by: "title_zh,title_fallback",
        filter_by:
          "languageIdentity:=[`slug:chinese-simplified`,`slug:chinese-traditional`]",
      })
      expect(titleRequest?.filter_by).toContain(`\`slug:${localizationSlug}\``)
      expect(response.results[0]).toMatchObject({
        id: jesusChineseCatalogDocument.id,
        slug: "jesus",
        playbackId: "playback-mandarin-china",
        availability: {
          kind: "target_audio",
          languageSlug: "mandarin-china",
          audio: true,
        },
        evidence: { kind: "exact_title" },
      })
    },
  )

  it("keeps English lexical recall when Mandarin playback is selected", async () => {
    vi.mocked(resolveSearchLanguageSignals).mockResolvedValueOnce({
      queryLanguageSlug: null,
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "mandarin-china",
      targetLanguageSource: "explicit_target",
      displayLanguageSlug: "english",
      displayLanguageBcp47: "en",
      routeLanguageSlug: null,
      routeLanguageBcp47: null,
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    })
    const typesense = typesenseFixture({
      lexical: [jesusChineseCatalogDocument],
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture({
        targetLanguage: {
          id: "language-mandarin-china",
          slug: "mandarin-china",
          name: { en: "Mandarin Chinese" },
        },
        evidenceLanguages: [{ slug: "mandarin-china", bcp47: "zh" }],
      }),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "JESUS",
      targetLanguageSlug: "mandarin-china",
    })
    const titleRequest = typesense.multiSearch.mock.calls[0]?.[0].find(
      (request) =>
        request.collection === TYPESENSE_WATCH_LEXICAL_ALIAS &&
        String(request.query_by).startsWith("title_"),
    )

    expect(titleRequest).toMatchObject({
      query_by: "title_en,title_fallback",
      filter_by: "languageIdentity:=[`slug:english`,`locale:en`]",
    })
    expect(response.results[0]).toMatchObject({
      id: jesusChineseCatalogDocument.id,
      slug: "jesus",
      playbackId: "playback-mandarin-china",
      availability: {
        kind: "target_audio",
        languageSlug: "mandarin-china",
      },
      evidence: { kind: "exact_title" },
    })
  })

  it("keeps a Kanji-only query in Japanese lexical recall when Japanese playback is selected", async () => {
    vi.mocked(resolveSearchLanguageSignals).mockResolvedValueOnce({
      queryLanguageSlug: null,
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "japanese",
      targetLanguageSource: "explicit_target",
      displayLanguageSlug: "japanese",
      displayLanguageBcp47: "ja",
      routeLanguageSlug: null,
      routeLanguageBcp47: null,
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    })
    const typesense = typesenseFixture({ lexical: [japaneseCatalogDocument] })
    const service = new TypesenseWatchSearchService(
      prismaFixture({
        targetLanguage: {
          id: "language-japanese",
          slug: "japanese",
          name: { en: "Japanese" },
        },
        evidenceLanguages: [{ slug: "japanese", bcp47: "ja" }],
      }),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "日本",
      targetLanguageSlug: "japanese",
    })
    const titleRequest = typesense.multiSearch.mock.calls[0]?.[0].find(
      (request) =>
        request.collection === TYPESENSE_WATCH_LEXICAL_ALIAS &&
        String(request.query_by).startsWith("title_"),
    )

    expect(titleRequest).toMatchObject({
      query_by: "title_ja,title_fallback",
      filter_by: "languageIdentity:=[`slug:japanese`,`locale:ja`]",
    })
    expect(response.results[0]).toMatchObject({
      id: japaneseCatalogDocument.id,
      slug: "japan",
      playbackId: "playback-japanese",
      availability: {
        kind: "target_audio",
        languageSlug: "japanese",
      },
      evidence: { kind: "exact_title" },
    })
  })

  it("starts query embedding while language resolution is still pending", async () => {
    type LanguageSignals = Awaited<
      ReturnType<typeof resolveSearchLanguageSignals>
    >
    let resolveLanguage!: (value: LanguageSignals) => void
    const languagePromise = new Promise<LanguageSignals>((resolve) => {
      resolveLanguage = resolve
    })
    vi.mocked(resolveSearchLanguageSignals).mockReturnValueOnce(languagePromise)
    const embedder = vi.fn(async () => embedding)
    const typesense = typesenseFixture({ lexical: [catalogDocument] })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder },
    )

    const responsePromise = service.search({
      query: "communion",
      targetLanguageSlug: "french",
    })
    await vi.waitFor(() => expect(embedder).toHaveBeenCalledTimes(1))
    expect(typesense.multiSearch).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 10))

    resolveLanguage({
      queryLanguageSlug: "french",
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "french",
      targetLanguageSource: "explicit_target",
      displayLanguageSlug: "french",
      displayLanguageBcp47: "fr",
      routeLanguageSlug: "french",
      routeLanguageBcp47: "fr",
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    })
    const response = await responsePromise

    expect(typesense.multiSearch.mock.calls[0]?.[0]).toHaveLength(3)
    const languageLane = response.laneStatuses.find(
      (lane) => lane.lane === "language_resolution",
    )
    const embeddingLane = response.laneStatuses.find(
      (lane) => lane.lane === "semantic_embedding",
    )
    expect(languageLane?.status).toBe("fulfilled")
    expect(embeddingLane?.elapsedMs).toBeLessThan(languageLane?.elapsedMs ?? 0)
  })

  it("reuses language context across requests sharing the Prisma client", async () => {
    const prisma = prismaFixture()
    const typesense = typesenseFixture({ lexical: [catalogDocument] })
    const first = new TypesenseWatchSearchService(
      prisma,
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )
    const second = new TypesenseWatchSearchService(
      prisma,
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    await first.search({ query: "communion", targetLanguageSlug: "french" })
    await second.search({ query: "JESUS", targetLanguageSlug: "french" })

    expect(prisma.language.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.language.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.languageFallback.findMany).toHaveBeenCalledTimes(1)
  })

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

  it("adds semantic evidence to a lexical candidate instead of discarding it", async () => {
    const lexicalOnly = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
        semantic: [],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )
    const hybrid = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
        semantic: [
          {
            videoId: catalogDocument.id,
            text: "The believers shared their lives.",
            vectorDistance: 0.1,
          },
        ],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const [lexicalResponse, hybridResponse] = await Promise.all([
      lexicalOnly.search({ query: "communion", targetLanguageSlug: "french" }),
      hybrid.search({ query: "communion", targetLanguageSlug: "french" }),
    ])

    expect(hybridResponse.results[0]?.id).toBe(catalogDocument.id)
    expect(hybridResponse.results[0]?.score).toBeGreaterThan(
      lexicalResponse.results[0]?.score ?? 0,
    )
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
    const titleRequest = requests.find(
      (request) =>
        request.collection === TYPESENSE_WATCH_LEXICAL_ALIAS &&
        String(request.query_by).startsWith("title_"),
    )
    const metadataRequest = requests.find(
      (request) =>
        request.collection === TYPESENSE_WATCH_LEXICAL_ALIAS &&
        String(request.query_by).startsWith("metadata_"),
    )
    const semanticRequest = requests.find(
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

    expect(titleRequest).toMatchObject({
      query_by: "title_fr,title_fallback",
      filter_by: "languageIdentity:=[`slug:french`,`locale:fr`]",
      group_limit: 3,
      prioritize_exact_match: true,
      // Disabled on the title lane only: dropped-token title hits outrank
      // full-phrase description matches (the "World Cup" regression).
      drop_tokens_threshold: 0,
    })
    expect(metadataRequest).toMatchObject({
      query_by: "metadata_fr,metadata_fallback",
      group_limit: 3,
      // The metadata lane keeps the dropped-token retry as the long-query
      // recall safety net.
      drop_tokens_threshold: 1,
    })
    expect(titleRequest).not.toHaveProperty("validate_field_names")
    expect(semanticRequest?.q).toBe("*")
    expect(semanticRequest?.vector_query).toContain(
      "k:80, distance_threshold:0.5",
    )
    expect(semanticRequest?.vector_query).not.toContain("alpha:")
    expect(semanticRequest?.filter_by).toBe(
      "documentKind:=transcript && publiclyVisible:=true && language:=[`fr`]",
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
        "id,videoId,videoEditionId,languageId,languageSlug,languageEnglishName,audio,subtitles,playbackId,durationSeconds,hrefLanguageSlug,actionVideoDubId,actionPriority",
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

  it("retries legacy hydration once for an old availability action projection", async () => {
    const logger = { warn: vi.fn() }
    const legacySubtitleDocument: TypesenseWatchCatalogDocument = {
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
    const typesense = typesenseFixture({
      lexical: [legacySubtitleDocument],
      catalog: [legacySubtitleDocument],
      availabilityError: new TypesenseRequestError(
        "Typesense search failed: Could not find a field named `videoEditionId` in the schema.",
        400,
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
      playbackId: null,
      availability: { kind: "target_subtitle" },
      action: { hrefLanguageSlug: null },
    })
    const calls = typesense.multiSearch.mock.calls.flatMap(
      ([searches]) => searches,
    )
    expect(
      calls.filter(
        (request) => request.collection === TYPESENSE_WATCH_AVAILABILITY_ALIAS,
      ),
    ).toHaveLength(1)
    expect(
      calls.filter((request) =>
        request.include_fields?.toString().includes("audioOptionsJson"),
      ),
    ).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(
      "[typesense-watch-search] event=availability_projection_fallback",
    )
  })

  it("paginates edition-scoped availability instead of truncating hydration", async () => {
    const availability = Array.from({ length: 251 }, (_, index) => ({
      id: `video-communion:edition-${index}:language-fr`,
      videoId: "video-communion",
      videoEditionId: `edition-${index}`,
      languageId: "language-fr",
      languageSlug: "french",
      languageEnglishName: "French",
      audio: false,
      subtitles: true,
      playbackId: "playback-en",
      durationSeconds: 175,
      hrefLanguageSlug: "english",
      actionVideoDubId: "dub-en",
      actionPriority: 1,
    }))
    const typesense = typesenseFixture({ availability })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "communion",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      availability: { kind: "target_subtitle" },
      action: { hrefLanguageSlug: "english" },
    })
    expect(
      typesense.multiSearch.mock.calls
        .flatMap(([searches]) => searches)
        .filter(
          (request) =>
            request.collection === TYPESENSE_WATCH_AVAILABILITY_ALIAS,
        )
        .map((request) => request.page ?? 1),
    ).toEqual([1, 2])
  })

  it("falls back without scheduling unbounded availability overflow searches", async () => {
    const logger = { warn: vi.fn() }
    const typesense = typesenseFixture({ availabilityFound: 12_751 })
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
    const calls = typesense.multiSearch.mock.calls.flatMap(
      ([searches]) => searches,
    )
    expect(
      calls.filter(
        (request) => request.collection === TYPESENSE_WATCH_AVAILABILITY_ALIAS,
      ),
    ).toHaveLength(1)
    expect(
      calls.filter((request) =>
        request.include_fields?.toString().includes("audioOptionsJson"),
      ),
    ).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(
      "[typesense-watch-search] event=availability_overflow_fallback",
    )
  })

  it("does not retry unrelated availability failures", async () => {
    const typesense = typesenseFixture({
      availabilityError: new TypesenseRequestError(
        "Typesense search failed: request timed out",
        500,
      ),
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    await expect(
      service.search({ query: "communion", targetLanguageSlug: "french" }),
    ).rejects.toThrow("request timed out")
    expect(
      typesense.multiSearch.mock.calls
        .flatMap(([searches]) => searches)
        .some((request) =>
          request.include_fields?.toString().includes("audioOptionsJson"),
        ),
    ).toBe(false)
  })

  it("does not treat an alias-tagged 400 as a missing availability alias", async () => {
    const typesense = typesenseFixture({
      availabilityError: new TypesenseRequestError(
        `Typesense search failed for ${TYPESENSE_WATCH_AVAILABILITY_ALIAS}: invalid filter_by expression`,
        400,
      ),
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    await expect(
      service.search({ query: "communion", targetLanguageSlug: "french" }),
    ).rejects.toThrow("invalid filter_by expression")
    expect(
      typesense.multiSearch.mock.calls
        .flatMap(([searches]) => searches)
        .some((request) =>
          request.include_fields?.toString().includes("audioOptionsJson"),
        ),
    ).toBe(false)
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
    expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
          page: 2,
          per_page: 250,
        }),
      ]),
    )
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
      "documentKind:=transcript && publiclyVisible:=true && language:=[`fr`]",
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
    expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
          query_by: "title_fr,title_fallback",
        }),
        expect.objectContaining({
          collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
          query_by: "metadata_fr,metadata_fallback",
        }),
        expect.objectContaining({
          collection: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
          q: "*",
          group_by: "canonicalVideoId",
          group_limit: 3,
          filter_by:
            "documentKind:=transcript && publiclyVisible:=true && language:=[`fr`]",
        }),
      ]),
    )
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
      lexical: [catalogDocument],
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
      lexical: [catalogDocument],
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
          videoEditionId: "edition-1",
          languageId: "language-fr",
          languageSlug: "french",
          languageEnglishName: "French",
          hrefLanguageSlug: "english",
          playbackId: "playback-en",
          durationSeconds: 175,
          actionVideoDubId: "dub-en",
          actionPriority: 1,
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
        languageSlug: "french",
      },
      fallback: { kind: "subtitle" },
      playbackId: "playback-en",
      durationSeconds: 175,
      action: { hrefLanguageSlug: "english" },
    })
  })

  it("does not hydrate semantic subtitle evidence from another edition", async () => {
    const subtitleDocument: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      audioLanguageSlugs: [],
      audioOptionsJson: "[]",
      subtitleLanguageSlugs: ["french"],
      subtitleOptionsJson: "[]",
    }
    const typesense = typesenseFixture({
      lexical: [],
      catalog: [subtitleDocument],
      availability: [
        {
          id: "video-communion:edition-b:language-fr",
          videoId: "video-communion",
          videoEditionId: "edition-b",
          languageId: "language-fr",
          languageSlug: "french",
          languageEnglishName: "French",
          audio: false,
          subtitles: true,
          playbackId: "playback-en-b",
          durationSeconds: 175,
          hrefLanguageSlug: "english",
          actionVideoDubId: "dub-en-b",
          actionPriority: 1,
        },
      ],
      hybrid: [
        {
          vectorDistance: 0.1,
          document: {
            id: "chunk-edition-a",
            documentKind: "transcript",
            videoId: "video-communion",
            videoEditionId: "edition-a",
            canonicalVideoId: "core:core-communion",
            language: "fr",
            publiclyVisible: true,
            text: "Semantic evidence from edition A",
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

    expect(response.results[0]).toMatchObject({
      playbackId: null,
      availability: { kind: "unavailable" },
      action: { hrefLanguageSlug: null },
    })
    const semanticRequest = typesense.multiSearch.mock.calls
      .flatMap(([searches]) => searches)
      .find(
        (request) => request.collection === TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      )
    expect(semanticRequest?.include_fields).toContain("videoEditionId")
  })

  it("keeps the winning semantic edition and evidence tuple together", async () => {
    const subtitleDocument: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      audioLanguageSlugs: [],
      audioOptionsJson: "[]",
      subtitleLanguageSlugs: ["french"],
      subtitleOptionsJson: "[]",
    }
    const typesense = typesenseFixture({
      lexical: [],
      catalog: [subtitleDocument],
      availability: [
        {
          id: "video-communion:edition-a:language-fr",
          videoId: "video-communion",
          videoEditionId: "edition-a",
          languageId: "language-fr",
          languageSlug: "french",
          languageEnglishName: "French",
          audio: false,
          subtitles: true,
          playbackId: "playback-en-a",
          durationSeconds: 175,
          hrefLanguageSlug: "english",
          actionVideoDubId: "dub-en-a",
          actionPriority: 1,
        },
        {
          id: "video-communion:edition-b:language-fr",
          videoId: "video-communion",
          videoEditionId: "edition-b",
          languageId: "language-fr",
          languageSlug: "french",
          languageEnglishName: "French",
          audio: false,
          subtitles: true,
          playbackId: "playback-en-b",
          durationSeconds: 176,
          hrefLanguageSlug: "spanish-castilian",
          actionVideoDubId: "dub-en-b",
          actionPriority: 1,
        },
      ],
      hybrid: [
        {
          vectorDistance: 0.1,
          document: {
            id: "chunk-edition-a",
            documentKind: "transcript",
            videoId: "video-communion",
            videoEditionId: "edition-a",
            canonicalVideoId: "core:core-communion",
            language: "fr",
            publiclyVisible: true,
            text: "Winning semantic evidence",
            startSeconds: 12,
          },
        },
        {
          vectorDistance: 0.2,
          document: {
            id: "chunk-edition-b",
            documentKind: "transcript",
            videoId: "video-communion",
            videoEditionId: "edition-b",
            canonicalVideoId: "core:core-communion",
            language: "fr",
            publiclyVisible: true,
            text: "Lower-ranked semantic evidence",
            startSeconds: 24,
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

    expect(response.results[0]).toMatchObject({
      snippet: "Winning semantic evidence",
      startSeconds: 12,
      playbackId: "playback-en-a",
      availability: { kind: "target_subtitle" },
      evidence: {
        kind: "transcript_semantic",
        languageSlug: "french",
      },
      action: { hrefLanguageSlug: "english" },
    })
  })

  it("fails closed for target subtitles when semantic evidence has no edition", async () => {
    const subtitleDocument: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      audioLanguageSlugs: [],
      audioOptionsJson: "[]",
      subtitleLanguageSlugs: ["french"],
      subtitleOptionsJson: JSON.stringify([
        {
          id: "subtitle-fr",
          videoEditionId: "edition-a",
          languageId: "language-fr",
          languageSlug: "french",
          hrefLanguageSlug: "english",
          playbackId: "playback-en",
          durationSeconds: 175,
          actionVideoDubId: "dub-en",
          actionPriority: 1,
        },
      ]),
    }
    const typesense = typesenseFixture({
      lexical: [],
      catalog: [subtitleDocument],
      hybrid: [
        {
          vectorDistance: 0.1,
          document: {
            id: "chunk-without-edition",
            documentKind: "transcript",
            videoId: "video-communion",
            canonicalVideoId: "core:core-communion",
            language: "fr",
            publiclyVisible: true,
            text: "Editionless semantic evidence",
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

    expect(response.results[0]).toMatchObject({
      playbackId: null,
      availability: { kind: "unavailable" },
      action: { hrefLanguageSlug: null },
    })
  })

  it("keeps target audio available for editionless semantic evidence", async () => {
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [],
        catalog: [catalogDocument],
        hybrid: [
          {
            vectorDistance: 0.1,
            document: {
              id: "chunk-without-edition",
              documentKind: "transcript",
              videoId: "video-communion",
              canonicalVideoId: "core:core-communion",
              language: "fr",
              publiclyVisible: true,
              text: "Editionless semantic evidence",
              startSeconds: 12,
            },
          },
        ],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "community",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      playbackId: "playback-fr",
      availability: { kind: "target_audio" },
    })
  })

  it("keeps related audio available for editionless semantic evidence", async () => {
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
        lexical: [],
        catalog: [relatedDocument],
        hybrid: [
          {
            vectorDistance: 0.1,
            document: {
              id: "chunk-without-edition",
              documentKind: "transcript",
              videoId: "video-communion",
              canonicalVideoId: "core:core-communion",
              language: "fr",
              publiclyVisible: true,
              text: "Editionless semantic evidence",
              startSeconds: 12,
            },
          },
        ],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "community",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      playbackId: "playback-en",
      availability: {
        kind: "related_language",
        languageSlug: "english",
      },
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
        collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
        q: "communion",
        query_by: "title_fr,title_fallback",
        per_page: 100,
        page: 1,
      }),
      expect.objectContaining({
        collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
        q: "communion",
        query_by: "metadata_fr,metadata_fallback",
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
        reason: "lexical_projection_fallback:Field canonicalVideoId not found",
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
