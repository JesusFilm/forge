import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  TypesenseClient,
  TypesenseSearchHit,
  TypesenseSearchResult,
  TypesenseSearchRequest,
} from "./typesense-client"
import { TypesenseRequestError } from "./typesense-client"
import { resolveTypesenseWatchSearchApiKey } from "./typesense-client-config"
import { resolveSearchLanguageSignals } from "./search-language-resolution"
import { buildAvailabilityDocuments } from "./typesense-watch-search-indexer"
import {
  buildTypesenseWatchCandidateLexicalDocuments,
  buildTypesenseWatchLexicalDocuments,
  type TypesenseWatchLexicalDocument,
} from "./typesense-watch-search-lexical"
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
  typesenseLexicalMatchQuality,
  TypesenseWatchSearchService,
} from "./typesense-watch-search.service"
import { WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION } from "./typesense-watch-search-ranking"

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
  containerLanguagesJson: "[]",
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
  containerLanguagesJson: "[]",
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
  containerLanguagesJson: "[]",
}

const candidateFieldManifests = {
  catalog: [{ name: "slug", type: "string" }],
  availability: [{ name: "videoId", type: "string" }],
  lexical: [
    { name: "title_exact_keys", type: "string[]" },
    { name: "title_en", type: "string[]" },
    { name: "title_fr", type: "string[]" },
    { name: "title_ja", type: "string[]" },
    { name: "title_ru", type: "string[]" },
    { name: "title_tr", type: "string[]" },
    { name: "title_zh", type: "string[]" },
    { name: "title_fallback", type: "string[]" },
    { name: "metadata_en", type: "string[]" },
    { name: "metadata_fr", type: "string[]" },
    { name: "metadata_ja", type: "string[]" },
    { name: "metadata_ru", type: "string[]" },
    { name: "metadata_tr", type: "string[]" },
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
  lexicalLanes,
  titleLexical = lexical,
  exactLexical = titleLexical,
  allowUnverifiedExactHits = false,
  metadataLexical = lexical,
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
  lexicalLanes?: Partial<
    Record<
      "title" | "metadata",
      Array<{
        videoId: string
        textMatchInfo?: TypesenseSearchHit<TypesenseWatchLexicalDocument>["text_match_info"]
      }>
    >
  >
  titleLexical?: TypesenseWatchCatalogDocument[]
  exactLexical?: TypesenseWatchCatalogDocument[]
  allowUnverifiedExactHits?: boolean
  metadataLexical?: TypesenseWatchCatalogDocument[]
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
        return searches.map((request) => {
          const requestedFilterValues = [
            ...String(request.filter_by ?? "").matchAll(/`([^`]+)`/g),
          ].map((match) => match[1])
          const lexicalLane =
            String(request.query_by) === "title_exact_keys"
              ? "exact"
              : String(request.query_by).startsWith("title_")
                ? "title"
                : String(request.query_by).startsWith("metadata_")
                  ? "metadata"
                  : null
          const laneCatalogDocuments =
            lexicalLane === "exact"
              ? exactLexical
              : lexicalLane === "title"
                ? titleLexical
                : lexicalLane === "metadata"
                  ? metadataLexical
                  : lexical
          const filteredLexicalDocuments = (
            lexicalLane === "exact"
              ? buildTypesenseWatchCandidateLexicalDocuments(
                  laneCatalogDocuments,
                )
              : buildTypesenseWatchLexicalDocuments(laneCatalogDocuments)
          ).filter(
            (document) =>
              (lexicalLane !== "exact" ||
                allowUnverifiedExactHits ||
                document.title_exact_keys?.includes(String(request.q))) &&
              (requestedFilterValues.length === 0 ||
                requestedFilterValues.includes(document.languageIdentity)),
          )
          const configuredLexicalHits =
            lexicalLane === "title" || lexicalLane === "metadata"
              ? lexicalLanes?.[lexicalLane]
              : undefined
          const lexicalEntries = configuredLexicalHits
            ? configuredLexicalHits.flatMap(({ videoId, textMatchInfo }) => {
                const document = filteredLexicalDocuments.find(
                  (candidate) => candidate.videoId === videoId,
                )
                return document
                  ? [
                      {
                        vectorDistance: undefined,
                        textMatchInfo,
                        document,
                      },
                    ]
                  : []
              })
            : filteredLexicalDocuments.map((document) => ({
                vectorDistance: undefined,
                textMatchInfo: undefined,
                document,
              }))
          const entries =
            request.collection === binding.lexical
              ? lexicalEntries
              : semanticEntries.map((entry) => ({
                  ...entry,
                  textMatchInfo: undefined,
                }))
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
                text_match_info: entry.textMatchInfo,
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

describe("typesenseLexicalMatchQuality", () => {
  it("keeps exact and missing metadata at neutral quality", () => {
    expect(typesenseLexicalMatchQuality(undefined)).toBe(1)
    expect(
      typesenseLexicalMatchQuality({
        tokens_matched: 3,
        num_tokens_dropped: 0,
        typo_prefix_score: 0,
      }),
    ).toBe(1)
    expect(
      typesenseLexicalMatchQuality({
        tokens_matched: -1,
        num_tokens_dropped: Number.NaN,
        typo_prefix_score: Number.POSITIVE_INFINITY,
      }),
    ).toBe(1)
  })

  it("reduces quality monotonically for dropped tokens and typo-prefix cost", () => {
    const exact = typesenseLexicalMatchQuality({})
    const oneDrop = typesenseLexicalMatchQuality({ num_tokens_dropped: 1 })
    const twoDrops = typesenseLexicalMatchQuality({ num_tokens_dropped: 2 })
    const oneTypoPrefixCost = typesenseLexicalMatchQuality({
      typo_prefix_score: 1,
    })
    const twoTypoPrefixCosts = typesenseLexicalMatchQuality({
      typo_prefix_score: 2,
    })
    const combined = typesenseLexicalMatchQuality({
      num_tokens_dropped: 1,
      typo_prefix_score: 1,
    })

    expect(exact).toBe(1)
    expect(oneDrop).toBeCloseTo(0.2)
    expect(twoDrops).toBeLessThan(oneDrop)
    expect(oneTypoPrefixCost).toBeCloseTo(0.8)
    expect(twoTypoPrefixCosts).toBeLessThan(oneTypoPrefixCost)
    expect(combined).toBeLessThan(oneDrop)
    for (const quality of [
      exact,
      oneDrop,
      twoDrops,
      oneTypoPrefixCost,
      twoTypoPrefixCosts,
      combined,
    ]) {
      expect(quality).toBeGreaterThanOrEqual(0)
      expect(quality).toBeLessThanOrEqual(1)
    }
  })

  it("guards the Typesense 30.2 matched-token encoding cap", () => {
    expect(
      typesenseLexicalMatchQuality({
        tokens_matched: 15,
        num_tokens_dropped: 5,
      }),
    ).toBe(1)
    expect(
      typesenseLexicalMatchQuality({
        tokens_matched: 14,
        num_tokens_dropped: 1,
      }),
    ).toBeCloseTo(0.2)
  })
})

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
    const profile = createCandidateWatchSearchProfile(
      {
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
      },
      "none:operator-accepted:launch-1",
    )
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
      profile.binding.lexical,
      profile.binding.transcript,
    ])
    expect(typesense.multiSearch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        query_by: "title_exact_keys",
        prefix: false,
        num_typos: 0,
      }),
      expect.objectContaining({
        query_by:
          "title_fr,title_fallback,title_en,title_ja,title_ru,title_tr,title_zh",
        filter_by: undefined,
      }),
      expect.objectContaining({
        query_by:
          "metadata_fr,metadata_fallback,metadata_en,metadata_ja,metadata_ru,metadata_tr,metadata_zh",
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
      profile.binding.lexical,
      profile.binding.transcript,
      profile.binding.catalog,
      profile.binding.availability,
    ])
    expect(response.results[0]?.id).toBe(catalogDocument.id)
    expect(response).not.toHaveProperty("diagnostics")
    expect(response.retrievalIdentity).toEqual({
      profile: "CANDIDATE",
      generationId: "generation-1",
      applicationRevision: "revision-1",
      rankingRevision: "title-and-brand-v1",
      transcriptProjectionRevision: "7",
      evaluationRevision: "none:operator-accepted:launch-1",
    })
    expect(diagnostics).toMatchObject({
      profile: "CANDIDATE",
      generationId: "generation-1",
      applicationRevision: "revision-1",
      transcriptProjectionRevision: 7n,
      binding: profile.binding,
      retrievalCalls: 2,
      logicalSubsearches: 6,
    })
  })

  it("reports all retrieval sources without double-counting title contribution", async () => {
    const russian: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-jesus-russian",
      coreId: "core-jesus",
      slug: "jesus-russian",
      titles: ["Иисус"],
      localeCodes: ["ru"],
      localesJson: JSON.stringify([
        {
          locale: "ru",
          languageSlug: "russian",
          title: "Иисус",
          description: null,
        },
      ]),
    }
    const profile = candidateProfile()
    const typesense = typesenseFixture({
      lexical: [russian],
      exactLexical: [russian],
      titleLexical: [russian],
      metadataLexical: [russian],
      semantic: [
        {
          videoId: russian.id,
          text: "The life of Jesus",
          vectorDistance: 0.1,
        },
      ],
      catalog: [russian],
      binding: profile.binding,
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture({ evidenceLanguages: [{ slug: "russian", bcp47: "ru" }] }),
      typesense as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => embedding) },
    )

    const { response, diagnostics } = await service.searchWithDiagnostics({
      query: "Иисус",
    })

    expect(response.results.map(({ id }) => id)).toEqual([russian.id])
    expect(response.languageInterpretation.targetLanguageSlug).toBe("french")
    expect(diagnostics.rankingMode).toBe("TITLE_AND_BRAND")
    expect(diagnostics.rankingTrace).toEqual([
      expect.objectContaining({
        canonicalVideoId: "core:core-jesus",
        evidenceTier: "NORMALIZED_WHOLE_TITLE",
        retrievalSources: [
          "global_exact_title",
          "localized_title",
          "metadata",
          "semantic",
        ],
        titleRank: 1,
        titleContribution: 0.56 / 61,
      }),
    ])
  })

  it("reports exact-title provenance when playback selects a canonical sibling", async () => {
    const exactButUnavailable: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-jesus-russian-unavailable",
      coreId: "core-jesus-siblings",
      slug: "jesus-russian-unavailable",
      titles: ["Иисус"],
      localeCodes: ["ru"],
      localesJson: JSON.stringify([
        {
          locale: "ru",
          languageSlug: "russian",
          title: "Иисус",
          description: null,
        },
      ]),
      audioLanguageSlugs: [],
      subtitleLanguageSlugs: [],
      audioOptionsJson: "[]",
      subtitleOptionsJson: "[]",
      containerLanguagesJson: "[]",
    }
    const playableSibling: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-jesus-playable-sibling",
      coreId: "core-jesus-siblings",
      slug: "jesus-playable-sibling",
      titles: ["Иисус — история"],
    }
    const profile = candidateProfile()
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        exactLexical: [exactButUnavailable],
        titleLexical: [playableSibling],
        metadataLexical: [],
        catalog: [exactButUnavailable, playableSibling],
        binding: profile.binding,
      }) as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => []) },
    )

    const { response, diagnostics } = await service.searchWithDiagnostics({
      query: "Иисус",
    })

    expect(response.results.map(({ id }) => id)).toEqual([playableSibling.id])
    expect(diagnostics.rankingTrace[0]).toMatchObject({
      selectedVideoId: playableSibling.id,
      retrievalSources: ["global_exact_title", "localized_title"],
    })
  })

  it("leaves a partial-only group at one contribution beside an exact group", async () => {
    const exact: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-exact-jesus",
      coreId: "core-exact-jesus",
      titles: ["Jesus"],
      localesJson: JSON.stringify([
        {
          locale: "en",
          languageSlug: "english",
          title: "Jesus",
          description: null,
        },
      ]),
    }
    const partial: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-partial-jesus",
      coreId: "core-partial-jesus",
      titles: ["Jesus Film Collection"],
      localesJson: JSON.stringify([
        {
          locale: "en",
          languageSlug: "english",
          title: "Jesus Film Collection",
          description: null,
        },
      ]),
    }
    const profile = candidateProfile()
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        exactLexical: [exact],
        titleLexical: [exact, partial],
        metadataLexical: [],
        catalog: [exact, partial],
        binding: profile.binding,
      }) as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => []) },
    )

    const { diagnostics } = await service.searchWithDiagnostics({
      query: "Jesus",
      limit: 2,
    })
    const partialTrace = diagnostics.rankingTrace.find(
      ({ canonicalVideoId }) => canonicalVideoId === "core:core-partial-jesus",
    )

    expect(partialTrace).toMatchObject({
      retrievalSources: ["localized_title"],
      titleRank: 2,
      titleContribution: 0.56 / 62,
    })
  })

  it.each([
    ["Cyrillic", "Иисус", "ru"],
    ["Han", "耶稣", "zh"],
    ["Kana", "イエス", "ja"],
    ["Arabic", "يسوع", "fil"],
    ["Latin", "JESUS", "en"],
  ])(
    "retrieves an exact %s title globally and verifies it before ranking",
    async (_script, title, locale) => {
      const localized: TypesenseWatchCatalogDocument = {
        ...catalogDocument,
        id: `video-${locale}-${title}`,
        coreId: `core-${locale}-${title}`,
        titles: [title],
        localeCodes: [locale],
        localesJson: JSON.stringify([
          {
            locale,
            languageSlug: `language-${locale}`,
            title,
            description: null,
          },
        ]),
      }
      const profile = candidateProfile()
      const service = new TypesenseWatchSearchService(
        prismaFixture(),
        typesenseFixture({
          lexical: [localized],
          exactLexical: [localized],
          titleLexical: [],
          metadataLexical: [],
          catalog: [localized],
          binding: profile.binding,
        }) as unknown as TypesenseClient,
        { profile, embedder: vi.fn(async () => embedding) },
      )

      const { response, diagnostics } = await service.searchWithDiagnostics({
        query: title,
      })

      expect(response.results.map(({ id }) => id)).toEqual([localized.id])
      expect(diagnostics.rankingTrace[0]).toMatchObject({
        evidenceTier: "NORMALIZED_WHOLE_TITLE",
        retrievalSources: ["global_exact_title"],
        wholeTitleMatch: true,
        titleContribution: 0.56 / 61,
      })
    },
  )

  it("discards an exact-key hit when its localized title does not verify", async () => {
    const staleDocument: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-stale-exact-key",
      coreId: "core-stale-exact-key",
      titles: ["Not the query"],
      localeCodes: ["ru"],
      localesJson: JSON.stringify([
        {
          locale: "ru",
          languageSlug: "russian",
          title: "Not the query",
          description: null,
        },
      ]),
    }
    const profile = candidateProfile()
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        exactLexical: [staleDocument],
        allowUnverifiedExactHits: true,
        titleLexical: [],
        metadataLexical: [],
        catalog: [staleDocument],
        binding: profile.binding,
      }) as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => []) },
    )

    const { response, diagnostics } = await service.searchWithDiagnostics({
      query: "Иисус",
    })

    expect(response.results).toEqual([])
    expect(diagnostics.rankingTrace).toEqual([])
  })

  it("uses locale-aware verification before accepting an exact key", async () => {
    const turkishCollision: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "video-turkish-case-collision",
      coreId: "core-turkish-case-collision",
      titles: ["i"],
      localeCodes: ["tr"],
      localesJson: JSON.stringify([
        {
          locale: "tr",
          languageSlug: "turkish",
          title: "i",
          description: null,
        },
      ]),
    }
    const profile = candidateProfile()
    const service = new TypesenseWatchSearchService(
      prismaFixture({
        targetLanguage: {
          id: "language-tr",
          slug: "turkish",
          name: { en: "Turkish" },
        },
        evidenceLanguages: [{ slug: "turkish", bcp47: "tr" }],
      }),
      typesenseFixture({
        exactLexical: [turkishCollision],
        titleLexical: [],
        metadataLexical: [],
        catalog: [turkishCollision],
        binding: profile.binding,
      }) as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => []) },
    )

    const { response, diagnostics } = await service.searchWithDiagnostics({
      query: "I",
      queryLanguageSlug: "turkish",
      displayLanguageSlug: "turkish",
    })

    expect(response.results).toEqual([])
    expect(diagnostics.rankingTrace).toEqual([])
  })

  it("does not let Typesense order break ties between duplicate exact titles", async () => {
    const duplicates = ["alpha", "beta"].map(
      (suffix): TypesenseWatchCatalogDocument => ({
        ...catalogDocument,
        id: `video-${suffix}`,
        coreId: `core-${suffix}`,
        titles: ["Jesus"],
        localesJson: JSON.stringify([
          {
            locale: "en",
            languageSlug: "english",
            title: "Jesus",
            description: null,
          },
        ]),
      }),
    )
    const profile = candidateProfile()
    const search = async (exactLexical: TypesenseWatchCatalogDocument[]) => {
      const service = new TypesenseWatchSearchService(
        prismaFixture(),
        typesenseFixture({
          exactLexical,
          titleLexical: [],
          metadataLexical: [],
          catalog: duplicates,
          binding: profile.binding,
        }) as unknown as TypesenseClient,
        { profile, embedder: vi.fn(async () => []) },
      )
      return service.searchWithDiagnostics({ query: "Jesus", limit: 2 })
    }

    const forward = await search(duplicates)
    const reversed = await search([...duplicates].reverse())

    expect(forward.response.results.map(({ id }) => id)).toEqual(
      reversed.response.results.map(({ id }) => id),
    )
    expect(
      forward.diagnostics.rankingTrace.map(
        ({ canonicalVideoId, titleRank, titleContribution }) => ({
          canonicalVideoId,
          titleRank,
          titleContribution,
        }),
      ),
    ).toEqual(
      reversed.diagnostics.rankingTrace.map(
        ({ canonicalVideoId, titleRank, titleContribution }) => ({
          canonicalVideoId,
          titleRank,
          titleContribution,
        }),
      ),
    )
    expect(
      forward.diagnostics.rankingTrace.map(({ titleRank }) => titleRank),
    ).toEqual([1, 1])
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

  it("activates title-and-brand ranking only for the candidate profile", async () => {
    const bibleProjectCollection: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "candidate-bibleproject-collection",
      coreId: "core-candidate-bibleproject-collection",
      slug: "candidate-bibleproject-collection",
      titles: ["The BibleProject Collection"],
      localeCodes: ["fr"],
      localesJson: JSON.stringify([
        {
          locale: "fr",
          languageSlug: "french",
          title: "The BibleProject Collection",
          description: null,
        },
      ]),
    }
    const profile = candidateProfile()
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [bibleProjectCollection],
        catalog: [bibleProjectCollection],
        binding: profile.binding,
      }) as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => embedding) },
    )

    const { diagnostics } = await service.searchWithDiagnostics({
      query: "BibleProject",
      targetLanguageSlug: "french",
    })

    expect(diagnostics).toMatchObject({
      profile: "CANDIDATE",
      rankingImplementation: "title-and-brand-v1",
      rankingMode: "TITLE_AND_BRAND",
      rankingAnchor: {
        compactCore: "bibleproject",
      },
    })
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

  it.each([
    {
      evidenceCase: "unrelated",
      queryLanguageSlug: "french",
      expectedEvidenceLanguageSlug: "french",
    },
    {
      evidenceCase: "unknown",
      queryLanguageSlug: null,
      expectedEvidenceLanguageSlug: null,
    },
  ])(
    "keeps $evidenceCase Candidate evidence out of the public card snippet",
    async ({ queryLanguageSlug, expectedEvidenceLanguageSlug }) => {
      vi.mocked(resolveSearchLanguageSignals).mockResolvedValueOnce({
        queryLanguageSlug,
        queryNamedLanguageSlug: null,
        targetLanguageSlug: "english",
        targetLanguageSource: "explicit_target",
        displayLanguageSlug: "english",
        displayLanguageBcp47: "en",
        routeLanguageSlug: "english",
        routeLanguageBcp47: "en",
        currentWatchLanguageSlug: null,
        acceptLanguage: null,
        acceptLanguageSlug: null,
      })
      const englishCatalog: TypesenseWatchCatalogDocument = {
        ...catalogDocument,
        titles: ["JESUS"],
        localeCodes: ["en"],
        localesJson: JSON.stringify([
          {
            locale: "en",
            languageSlug: "english",
            title: "JESUS",
            description: "The life of Jesus.",
          },
        ]),
        audioLanguageSlugs: ["english"],
        audioOptionsJson: JSON.stringify([
          {
            id: "dub-en",
            languageId: "language-en",
            languageSlug: "english",
            languageEnglishName: "English",
            playbackId: "playback-en",
            durationSeconds: 180,
          },
        ]),
      }
      const profile = candidateProfile()
      const typesense = typesenseFixture({
        lexical: [englishCatalog],
        semantic: [
          {
            videoId: englishCatalog.id,
            text: "La vie de Jésus.",
            vectorDistance: 0.1,
          },
        ],
        catalog: [englishCatalog],
        binding: profile.binding,
      })
      const service = new TypesenseWatchSearchService(
        prismaFixture({
          targetLanguage: {
            id: "language-en",
            slug: "english",
            name: { en: "English" },
          },
          evidenceLanguages: [
            { slug: "english", bcp47: "en" },
            { slug: "french", bcp47: "fr" },
          ],
        }),
        typesense as unknown as TypesenseClient,
        { profile, embedder: vi.fn(async () => embedding) },
      )

      const response = await service.search({
        query: "jesus",
        displayLanguageSlug: "english",
        targetLanguageSlug: "english",
      })

      expect(response.results).toHaveLength(1)
      expect(response.results[0]).toMatchObject({
        title: "JESUS",
        description: "The life of Jesus.",
        snippet: "The life of Jesus.",
        playbackId: "playback-en",
        startSeconds: 42,
        evidence: {
          kind: "exact_title",
          languageSlug: expectedEvidenceLanguageSlug,
        },
        availability: {
          kind: "target_audio",
          languageSlug: "english",
        },
      })
      expect(typesense.multiSearch).toHaveBeenCalledTimes(2)
    },
  )

  it("keeps Candidate evidence that matches the selected target language", async () => {
    vi.mocked(resolveSearchLanguageSignals).mockResolvedValueOnce({
      queryLanguageSlug: "french",
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "french",
      targetLanguageSource: "explicit_target",
      displayLanguageSlug: "english",
      displayLanguageBcp47: "en",
      routeLanguageSlug: "english",
      routeLanguageBcp47: "en",
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    })
    const profile = candidateProfile()
    const typesense = typesenseFixture({
      lexical: [catalogDocument],
      semantic: [
        {
          videoId: catalogDocument.id,
          text: "Les croyants partagent leur vie.",
          vectorDistance: 0.1,
        },
      ],
      binding: profile.binding,
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesense as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "community",
      displayLanguageSlug: "english",
      targetLanguageSlug: "french",
    })

    expect(response.results[0]).toMatchObject({
      title: "The Fellowship of the Believers",
      description: "The believers share their lives.",
      snippet: "Les croyants partagent leur vie.",
      playbackId: "playback-fr",
      evidence: {
        kind: "transcript_semantic",
        languageSlug: "french",
      },
      availability: {
        kind: "target_audio",
        languageSlug: "french",
      },
    })
    expect(typesense.multiSearch).toHaveBeenCalledTimes(2)
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
    expect(response.retrievalIdentity).toEqual({
      profile: "CURRENT",
      generationId: null,
      applicationRevision: null,
      rankingRevision: "legacy-rrf",
      transcriptProjectionRevision: null,
      evaluationRevision: null,
    })
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

  it("uses Title-and-brand mode to keep precise metadata ahead of semantic-only results", async () => {
    const bibleProjectCollection: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "bibleproject-collection",
      coreId: "core-bibleproject-collection",
      slug: "bibleproject-collection",
      titles: ["The BibleProject Collection"],
      descriptions: ["The complete BibleProject collection."],
      localeCodes: ["fr"],
      localesJson: JSON.stringify([
        {
          locale: "fr",
          languageSlug: "french",
          title: "The BibleProject Collection",
          description: "The complete BibleProject collection.",
        },
      ]),
    }
    const bibleProjectVideo: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "bibleproject-video",
      coreId: "core-bibleproject-video",
      slug: "bibleproject-gospel",
      titles: ["Gospel"],
      descriptions: ["A BibleProject animation about the biblical story."],
      localeCodes: ["fr"],
      localesJson: JSON.stringify([
        {
          locale: "fr",
          languageSlug: "french",
          title: "Gospel",
          description: "A BibleProject animation about the biblical story.",
        },
      ]),
    }
    const unrelatedSemantic: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "semantic-gospel-part-4",
      coreId: "core-semantic-gospel-part-4",
      slug: "gospel-part-4",
      titles: ["Gospel Part 4"],
      descriptions: ["A transcript-semantic result."],
      localeCodes: ["fr"],
      localesJson: JSON.stringify([
        {
          locale: "fr",
          languageSlug: "french",
          title: "Gospel Part 4",
          description: "A transcript-semantic result.",
        },
      ]),
    }
    const catalog = [
      bibleProjectCollection,
      bibleProjectVideo,
      unrelatedSemantic,
    ]
    const fixtureInput = {
      lexical: catalog,
      titleLexical: [bibleProjectCollection],
      metadataLexical: [bibleProjectVideo],
      hybrid: [
        {
          document: {
            id: "chunk-semantic-gospel-part-4",
            documentKind: "transcript",
            videoId: unrelatedSemantic.id,
            videoEditionId: "edition-semantic-gospel-part-4",
            canonicalVideoId: "core:core-semantic-gospel-part-4",
            language: "fr",
            publiclyVisible: true,
            text: "A semantically similar transcript about a gospel project.",
            startSeconds: 42,
          },
          vectorDistance: 0.1,
        },
      ],
      catalog,
    } satisfies Parameters<typeof typesenseFixture>[0]
    const currentTypesense = typesenseFixture(fixtureInput)
    const legacyService = new TypesenseWatchSearchService(
      prismaFixture(),
      currentTypesense as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )
    const legacy = await legacyService.searchWithDiagnostics({
      query: "the bible project",
      targetLanguageSlug: "french",
    })

    expect(legacy.response.results.map((result) => result.id)).toEqual([
      bibleProjectCollection.id,
      unrelatedSemantic.id,
      bibleProjectVideo.id,
    ])
    expect(legacy.diagnostics).toMatchObject({
      rankingImplementation: "legacy-rrf",
      rankingMode: "SEMANTIC",
      rankingAnchor: null,
    })

    const profile = candidateProfile()
    const candidateTypesense = typesenseFixture({
      ...fixtureInput,
      binding: profile.binding,
    })
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      candidateTypesense as unknown as TypesenseClient,
      {
        embedder: vi.fn(async () => embedding),
        profile,
      },
    )

    const { response, diagnostics } = await service.searchWithDiagnostics({
      query: "the bible project",
      targetLanguageSlug: "french",
    })

    expect(response.results.map((result) => result.id)).toEqual([
      bibleProjectCollection.id,
      bibleProjectVideo.id,
      unrelatedSemantic.id,
    ])
    expect(response).not.toHaveProperty("rankingMode")
    expect(diagnostics.rankingImplementation).toBe(
      WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION,
    )
    expect(diagnostics.rankingMode).toBe("TITLE_AND_BRAND")
    expect(diagnostics.rankingAnchor).toMatchObject({
      compactCore: "bibleproject",
      sourceCanonicalVideoId: "core:core-bibleproject-collection",
    })
    expect(diagnostics.rankingTrace).toEqual([
      expect.objectContaining({
        canonicalVideoId: "core:core-bibleproject-collection",
        evidenceTier: "UNIQUE_TITLE_CORE",
        retrievalSources: ["localized_title"],
        finalRank: 1,
        selectedVideoId: bibleProjectCollection.id,
        titleRank: 1,
        titleContribution: 0.56 / 61,
        metadataRank: null,
        semanticRank: null,
        watchabilityOutcome: "target_audio",
      }),
      expect.objectContaining({
        canonicalVideoId: "core:core-bibleproject-video",
        evidenceTier: "ANCHOR_METADATA",
        retrievalSources: ["metadata"],
        finalRank: 2,
        selectedVideoId: bibleProjectVideo.id,
        titleRank: null,
        metadataRank: 1,
        metadataContribution: 0.14 / 61,
        semanticRank: null,
        watchabilityOutcome: "target_audio",
      }),
      expect.objectContaining({
        canonicalVideoId: "core:core-semantic-gospel-part-4",
        evidenceTier: "SEMANTIC_FILL",
        retrievalSources: ["semantic"],
        finalRank: 3,
        selectedVideoId: unrelatedSemantic.id,
        titleRank: null,
        metadataRank: null,
        semanticRank: 1,
        semanticContribution: 0.3 / 61,
        watchabilityOutcome: "target_audio",
      }),
    ])
    expect(candidateTypesense.multiSearch.mock.calls[0]?.[0]).toHaveLength(4)

    const pageOne = await service.search({
      query: "the bible project",
      targetLanguageSlug: "french",
      limit: 2,
    })
    const pageTwo = await service.search({
      query: "the bible project",
      targetLanguageSlug: "french",
      offset: 2,
      limit: 1,
    })
    expect(
      [...pageOne.results, ...pageTwo.results].map(({ id }) => id),
    ).toEqual(response.results.map(({ id }) => id))
  })

  it("does not apply normalized title-core boosts when an anchor is ambiguous", async () => {
    const titles = [
      {
        ...catalogDocument,
        id: "bibleproject-series",
        coreId: "core-bibleproject-series",
        slug: "bibleproject-series",
        titles: ["BibleProject Series"],
      },
      {
        ...catalogDocument,
        id: "bibleproject-collection",
        coreId: "core-bibleproject-collection",
        slug: "bibleproject-collection",
        titles: ["BibleProject Collection"],
      },
    ]
    const profile = candidateProfile()
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: titles,
        titleLexical: titles,
        metadataLexical: [],
        catalog: titles,
        binding: profile.binding,
      }) as unknown as TypesenseClient,
      { profile, embedder: vi.fn(async () => embedding) },
    )

    const { diagnostics } = await service.searchWithDiagnostics({
      query: "the bible project series",
      targetLanguageSlug: "french",
    })

    expect(diagnostics.rankingMode).toBe("SEMANTIC")
    expect(diagnostics.rankingAnchor).toBeNull()
    expect(diagnostics.rankingTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ wholeTitleMatch: false }),
        expect.objectContaining({ wholeTitleMatch: false }),
      ]),
    )
  })

  it("keeps conceptual searches in Semantic mode with the existing fused order", async () => {
    const first: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "semantic-first",
      coreId: "core-semantic-first",
      slug: "comfort-after-loss",
      titles: ["Comfort After Loss"],
    }
    const second: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "semantic-second",
      coreId: "core-semantic-second",
      slug: "starting-again",
      titles: ["Starting Again"],
    }
    const catalog = [first, second]
    const profile = candidateProfile()
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: catalog,
        titleLexical: [],
        metadataLexical: [],
        hybrid: catalog.map((document, index) => ({
          document: {
            id: `semantic-chunk-${index}`,
            documentKind: "transcript" as const,
            videoId: document.id,
            videoEditionId: `edition-${index}`,
            canonicalVideoId: `core:${document.coreId}`,
            language: "fr",
            publiclyVisible: true,
            text: `Conceptual transcript ${index}`,
            startSeconds: index,
          },
          vectorDistance: 0.1 + index / 10,
        })),
        catalog,
        binding: profile.binding,
      }) as unknown as TypesenseClient,
      {
        embedder: vi.fn(async () => embedding),
        profile,
      },
    )

    const { response, diagnostics } = await service.searchWithDiagnostics({
      query: "hope after divorce",
      targetLanguageSlug: "french",
    })

    expect(diagnostics.rankingMode).toBe("SEMANTIC")
    expect(diagnostics.rankingAnchor).toBeNull()
    expect(response.results.map((result) => result.id)).toEqual([
      first.id,
      second.id,
    ])
  })

  it("orders candidate locale fields from language evidence without removing any", async () => {
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
            "title_fr,title_fallback,title_en,title_ja,title_ru,title_tr,title_zh",
          query_by_weights: "4,1,4,4,4,4,4",
          num_typos: "2,1,2,2,2,2,2",
        }),
        expect.objectContaining({
          query_by:
            "metadata_fr,metadata_fallback,metadata_en,metadata_ja,metadata_ru,metadata_tr,metadata_zh",
          query_by_weights: "4,1,4,4,4,4,4",
          num_typos: "2,1,2,2,2,2,2",
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

  it("ranks a complete metadata match above a dropped-token title match", async () => {
    const partialTitle: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "partial-world-title",
      coreId: "core-partial-world-title",
      slug: "the-world",
      titles: ["The World"],
      descriptions: ["A story about the world."],
      localesJson: JSON.stringify([
        {
          locale: "fr",
          title: "The World",
          description: "A story about the world.",
        },
      ]),
    }
    const completeMetadata: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "complete-world-cup-metadata",
      coreId: "core-complete-world-cup-metadata",
      slug: "championship-stories",
      titles: ["Championship Stories"],
      descriptions: ["Stories from the World Cup."],
      localesJson: JSON.stringify([
        {
          locale: "fr",
          title: "Championship Stories",
          description: "Stories from the World Cup.",
        },
      ]),
    }
    const catalog = [partialTitle, completeMetadata]
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: catalog,
        catalog,
        lexicalLanes: {
          title: [
            {
              videoId: partialTitle.id,
              textMatchInfo: {
                tokens_matched: 1,
                num_tokens_dropped: 1,
                typo_prefix_score: 0,
              },
            },
          ],
          metadata: [
            {
              videoId: completeMetadata.id,
              textMatchInfo: {
                tokens_matched: 2,
                num_tokens_dropped: 0,
                typo_prefix_score: 0,
              },
            },
          ],
        },
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "World Cup",
      targetLanguageSlug: "french",
    })

    expect(response.results.map((result) => result.id)).toEqual([
      completeMetadata.id,
      partialTitle.id,
    ])
  })

  it("keeps an exact Bible Project brand title ahead of degraded title recall", async () => {
    const degradedTitle: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "partial-bible-title",
      coreId: "core-partial-bible-title",
      slug: "the-bible",
      titles: ["The Bible"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "The Bible", description: null },
      ]),
    }
    const bibleProject: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "the-bible-project",
      coreId: "core-the-bible-project",
      slug: "the-bible-project",
      titles: ["The Bible Project"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "The Bible Project", description: null },
      ]),
    }
    const catalog = [degradedTitle, bibleProject]
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: catalog,
        catalog,
        lexicalLanes: {
          title: [
            {
              videoId: degradedTitle.id,
              textMatchInfo: {
                tokens_matched: 2,
                num_tokens_dropped: 1,
                typo_prefix_score: 0,
              },
            },
            {
              videoId: bibleProject.id,
              textMatchInfo: {
                tokens_matched: 3,
                num_tokens_dropped: 0,
                typo_prefix_score: 0,
              },
            },
          ],
          metadata: [],
        },
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "The Bible Project",
      targetLanguageSlug: "french",
    })

    expect(response.results.map((result) => result.id)).toEqual([
      bibleProject.id,
      degradedTitle.id,
    ])
    expect(response.results[0]?.evidence.kind).toBe("exact_title")
  })

  it("keeps typo-prefix and dropped-token title results with lower scores", async () => {
    const exactTitle: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "exact-bible-title",
      coreId: "core-exact-bible-title",
      slug: "bible-study",
      titles: ["Bible Study"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "Bible Study", description: null },
      ]),
    }
    const fuzzyTitle: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "fuzzy-bibble-title",
      coreId: "core-fuzzy-bibble-title",
      slug: "bibble-stories",
      titles: ["Bibble Stories"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "Bibble Stories", description: null },
      ]),
    }
    const oneDrop: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "one-dropped-token",
      coreId: "core-one-dropped-token",
      slug: "alpha-beta",
      titles: ["Alpha Beta"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "Alpha Beta", description: null },
      ]),
    }
    const twoDrops: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "two-dropped-tokens",
      coreId: "core-two-dropped-tokens",
      slug: "alpha",
      titles: ["Alpha"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "Alpha", description: null },
      ]),
    }

    const typoCatalog = [fuzzyTitle, exactTitle]
    const typoService = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: typoCatalog,
        catalog: typoCatalog,
        lexicalLanes: {
          title: [
            {
              videoId: fuzzyTitle.id,
              textMatchInfo: { typo_prefix_score: 1 },
            },
            {
              videoId: exactTitle.id,
              textMatchInfo: { typo_prefix_score: 0 },
            },
          ],
          metadata: [],
        },
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )
    const dropCatalog = [twoDrops, oneDrop]
    const dropService = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: dropCatalog,
        catalog: dropCatalog,
        lexicalLanes: {
          title: [
            {
              videoId: twoDrops.id,
              textMatchInfo: { num_tokens_dropped: 2 },
            },
            {
              videoId: oneDrop.id,
              textMatchInfo: { num_tokens_dropped: 1 },
            },
          ],
          metadata: [],
        },
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const [typoResponse, dropResponse] = await Promise.all([
      typoService.search({ query: "Bible", targetLanguageSlug: "french" }),
      dropService.search({
        query: "Alpha Beta Gamma",
        targetLanguageSlug: "french",
      }),
    ])

    expect(typoResponse.results.map((result) => result.id)).toEqual([
      exactTitle.id,
      fuzzyTitle.id,
    ])
    expect(dropResponse.results.map((result) => result.id)).toEqual([
      oneDrop.id,
      twoDrops.id,
    ])
  })

  it("uses the best same-lane locale hit while summing separate lanes", async () => {
    const titleOnly: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "a-title-only",
      coreId: "shared-canonical-video",
      slug: "title-only",
      titles: ["Community Stories"],
      localesJson: JSON.stringify([
        { locale: "fr", title: "Community Stories", description: null },
      ]),
    }
    const multiLane: TypesenseWatchCatalogDocument = {
      ...catalogDocument,
      id: "z-multi-lane",
      coreId: "shared-canonical-video",
      slug: "multi-lane",
      titles: ["Community Stories"],
      descriptions: ["Community Stories"],
      localesJson: JSON.stringify([
        {
          locale: "fr",
          title: "Community Stories",
          description: "Community Stories",
        },
      ]),
    }
    const catalog = [multiLane, titleOnly]
    const service = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: catalog,
        catalog,
        lexicalLanes: {
          title: [
            {
              videoId: multiLane.id,
              textMatchInfo: { num_tokens_dropped: 1 },
            },
            {
              videoId: multiLane.id,
              textMatchInfo: { num_tokens_dropped: 0 },
            },
            {
              videoId: titleOnly.id,
              textMatchInfo: { num_tokens_dropped: 0 },
            },
          ],
          metadata: [
            {
              videoId: multiLane.id,
              textMatchInfo: { num_tokens_dropped: 0 },
            },
          ],
        },
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )

    const response = await service.search({
      query: "Community",
      targetLanguageSlug: "french",
    })

    expect(response.results.map((result) => result.id)).toEqual([multiLane.id])
    expect(response.results[0]?.scoreBreakdown.sourceScore).toBeCloseTo(0.7)
  })

  it("adds semantic evidence to a lexical candidate instead of discarding it", async () => {
    const degradedLexicalLanes = {
      title: [
        {
          videoId: catalogDocument.id,
          textMatchInfo: {
            tokens_matched: 1,
            num_tokens_dropped: 1,
            typo_prefix_score: 0,
          },
        },
      ],
      metadata: [],
    }
    const lexicalOnly = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
        lexicalLanes: degradedLexicalLanes,
        semantic: [],
      }) as unknown as TypesenseClient,
      { embedder: vi.fn(async () => embedding) },
    )
    const hybrid = new TypesenseWatchSearchService(
      prismaFixture(),
      typesenseFixture({
        lexical: [catalogDocument],
        lexicalLanes: degradedLexicalLanes,
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
    expect(hybridResponse.results[0]).toMatchObject({
      snippet: "The believers shared their lives.",
      startSeconds: 42,
      evidence: { kind: "exact_title", languageSlug: "french" },
    })
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
      drop_tokens_threshold: 1,
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
      containerLanguagesJson: "[]",
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
      containerLanguagesJson: "[]",
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
      containerLanguagesJson: "[]",
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
        semantic: [
          {
            videoId: catalogDocument.id,
            text: "Communion with Jesus",
            vectorDistance: 0.1,
          },
        ],
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

    const { response, diagnostics } = await service.searchWithDiagnostics({
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
    expect(diagnostics).toMatchObject({
      profile: "CURRENT",
      rankingImplementation: "legacy-rrf",
      rankingMode: "SEMANTIC",
      rankingAnchor: null,
    })
    expect(diagnostics.rankingTrace[0]).toMatchObject({
      selectedVideoId: catalogDocument.id,
      retrievalSources: ["semantic"],
    })
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
