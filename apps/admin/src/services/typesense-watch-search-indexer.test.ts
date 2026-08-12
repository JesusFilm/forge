import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { TypesenseClient } from "./typesense-client"
import {
  buildAvailabilityDocuments,
  buildCatalogDocuments,
  buildTypesenseWatchCandidateProjectionSnapshot,
  canonicalTypesenseVideoId,
  estimateTypesenseVectorMemoryBytes,
  parseTypesenseVector,
  rebuildTypesenseWatchSearchIndex,
  TypesenseWatchSearchIndexError,
} from "./typesense-watch-search-indexer"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "./typesense-watch-search-schema"

function viewerSafeVideo(title: string) {
  return {
    id: "video-1",
    coreId: "core-1",
    slug: "video-1",
    label: null,
    locales: [
      {
        locale: "en",
        languageSlug: "english",
        title,
        description: `${title} description`,
      },
    ],
    dubs: [],
    images: [],
    children: [],
  }
}

describe("Typesense Watch Search indexer", () => {
  it("builds catalog documents through the viewer-safety projection", async () => {
    const videoFindMany = vi.fn(async () => [
      {
        id: "video-1",
        coreId: "core-1",
        slug: "communion",
        label: "episode",
        locales: [
          {
            locale: "fr",
            languageSlug: "french",
            title: "La communion",
            description: "Description française",
          },
        ],
        dubs: [
          {
            id: "dub-fr-long",
            videoEditionId: "edition-1",
            duration: 180,
            language: {
              id: "language-fr",
              slug: "french",
              name: { en: "French" },
            },
            muxVideo: { playbackId: "playback-fr" },
          },
          {
            id: "dub-fr-short",
            videoEditionId: "edition-1",
            duration: 90,
            language: {
              id: "language-fr",
              slug: "french",
              name: { en: "French" },
            },
            muxVideo: { playbackId: "playback-short" },
          },
        ],
        images: [
          {
            url: "https://example.com/fallback.jpg",
            mobileCinematicHigh: "https://example.com/preferred.jpg",
            mobileCinematicLow: null,
            videoStill: null,
            thumbnail: null,
            blurDataUrl: "blur-data",
          },
        ],
        children: [{ childId: "child-1" }],
      },
    ])
    const queryRaw = vi.fn(async (_query: unknown) => [
      {
        id: "subtitle-fr",
        videoId: "video-1",
        videoEditionId: "edition-1",
        languageId: "language-fr",
        languageSlug: "french",
        languageName: { en: "French" },
        hrefLanguageSlug: "french",
        playbackId: "playback-fr",
        durationSeconds: 180,
        actionVideoDubId: "dub-fr-long",
        actionPriority: 0,
      },
    ])
    const prisma = {
      video: { findMany: videoFindMany },
      $queryRaw: queryRaw,
    } as unknown as PrismaClient

    const documents = await buildCatalogDocuments(prisma)

    expect(videoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          noIndex: false,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          NOT: { restrictViewPlatforms: { has: "watch" } },
        },
        select: expect.objectContaining({
          dubs: expect.objectContaining({
            where: expect.objectContaining({
              deletedAt: null,
              published: true,
              AND: [{ hls: { not: null } }, { hls: { not: "" } }],
            }),
            orderBy: [{ duration: "desc" }, { id: "asc" }],
          }),
        }),
      }),
    )
    const subtitleSql = (
      queryRaw.mock.calls[0]?.[0] as unknown as { strings: string[] }
    ).strings.join(" ")
    expect(subtitleSql).toContain("video.no_index = FALSE")
    expect(subtitleSql).toContain("published_locale.status = 'published'")
    expect(subtitleSql).toContain("NULLIF(BTRIM(vs.vtt_src), '') IS NOT NULL")
    expect(subtitleSql).not.toContain("vs.srt_src")
    expect(subtitleSql).toContain(
      "vs.video_id IS NULL OR vs.video_id = preferred_dub.video_id",
    )
    expect(subtitleSql).toContain(
      "preferred_dub.video_edition_id = vs.video_edition_id",
    )
    expect(subtitleSql).toContain("video.primary_language_id")
    expect(subtitleSql).toContain("fallback_language.slug = 'english'")
    expect(subtitleSql).toContain("video_dub.duration DESC NULLS LAST")
    expect(subtitleSql).toContain("fallback_language.slug ASC")
    expect(subtitleSql).toContain("video_dub.id ASC")
    expect(documents).toEqual([
      expect.objectContaining({
        id: "video-1",
        titles: ["La communion"],
        localeCodes: ["fr"],
        localesJson: JSON.stringify([
          {
            locale: "fr",
            languageSlug: "french",
            title: "La communion",
            description: "Description française",
          },
        ]),
        imageUrl: "https://example.com/preferred.jpg",
        childCount: 1,
        audioOptionsJson: JSON.stringify([
          {
            id: "dub-fr-long",
            videoEditionId: "edition-1",
            languageId: "language-fr",
            languageSlug: "french",
            languageEnglishName: "French",
            playbackId: "playback-fr",
            durationSeconds: 180,
          },
        ]),
        subtitleOptionsJson: JSON.stringify([
          {
            id: "subtitle-fr",
            videoEditionId: "edition-1",
            languageId: "language-fr",
            languageSlug: "french",
            languageEnglishName: "French",
            hrefLanguageSlug: "french",
            playbackId: "playback-fr",
            durationSeconds: 180,
            actionVideoDubId: "dub-fr-long",
            actionPriority: 0,
          },
        ]),
      }),
    ])

    expect(buildAvailabilityDocuments(documents)).toEqual([
      {
        id: "video-1:edition-1:language-fr",
        videoId: "video-1",
        videoEditionId: "edition-1",
        languageId: "language-fr",
        languageSlug: "french",
        languageEnglishName: "French",
        audio: true,
        subtitles: true,
        playbackId: "playback-fr",
        durationSeconds: 180,
        hrefLanguageSlug: "french",
        actionVideoDubId: "dub-fr-long",
        actionPriority: null,
      },
    ])
  })

  it("stores a same-edition playable action on compact subtitle availability", () => {
    const documents = buildAvailabilityDocuments([
      {
        ...viewerSafeVideo("Mary"),
        titles: ["Mary"],
        localeCodes: ["en"],
        descriptions: [],
        localesJson: JSON.stringify([
          { locale: "en", title: "Mary", description: null },
        ]),
        childCount: 0,
        imageUrl: null,
        imageBlurDataUrl: null,
        audioLanguageSlugs: ["english"],
        subtitleLanguageSlugs: ["russian"],
        audioOptionsJson: JSON.stringify([
          {
            id: "dub-en",
            videoEditionId: "edition-1",
            languageId: "language-en",
            languageSlug: "english",
            languageEnglishName: "English",
            playbackId: "playback-en",
            durationSeconds: 181,
          },
        ]),
        subtitleOptionsJson: JSON.stringify([
          {
            id: "subtitle-ru",
            videoEditionId: "edition-1",
            languageId: "language-ru",
            languageSlug: "russian",
            languageEnglishName: "Russian",
            hrefLanguageSlug: "english",
            playbackId: "playback-en",
            durationSeconds: 181,
            actionVideoDubId: "dub-en",
            actionPriority: 1,
          },
        ]),
      },
    ])

    expect(documents).toContainEqual({
      id: "video-1:edition-1:language-ru",
      videoId: "video-1",
      videoEditionId: "edition-1",
      languageId: "language-ru",
      languageSlug: "russian",
      languageEnglishName: "Russian",
      audio: false,
      subtitles: true,
      playbackId: "playback-en",
      durationSeconds: 181,
      hrefLanguageSlug: "english",
      actionVideoDubId: "dub-en",
      actionPriority: 1,
    })
  })

  it("derives deterministic candidate projections from one repeatable-read snapshot", async () => {
    let sourceTitle = "Before snapshot"
    const transaction = vi.fn(
      async (
        run: (tx: unknown) => Promise<unknown>,
        options: { isolationLevel: string; timeout: number },
      ) => {
        const capturedTitle = sourceTitle
        const tx = {
          video: {
            findMany: vi.fn(async () => {
              sourceTitle = "After snapshot"
              return [viewerSafeVideo(capturedTitle)]
            }),
          },
          $queryRaw: vi.fn(async () => []),
        }
        expect(options).toEqual({
          isolationLevel: "RepeatableRead",
          timeout: 60_000,
        })
        return run(tx)
      },
    )
    const prisma = { $transaction: transaction } as unknown as PrismaClient

    const before = await buildTypesenseWatchCandidateProjectionSnapshot(prisma)
    const after = await buildTypesenseWatchCandidateProjectionSnapshot(prisma)

    expect(before.catalog[0]?.titles).toEqual(["Before snapshot"])
    expect(before.lexical[0]).toMatchObject({
      title_en: ["Before snapshot"],
      metadata_en: ["Before snapshot description"],
    })
    expect(before.counts).toEqual({ catalog: 1, availability: 0, lexical: 1 })
    expect(before.digests).toEqual(
      expect.objectContaining({
        catalog: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        availability: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        lexical: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        combined: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    )
    expect(after.digests.combined).not.toBe(before.digests.combined)
  })

  it("estimates vector RAM using the Typesense sizing formula", () => {
    expect(estimateTypesenseVectorMemoryBytes(17_118)).toBe(184_052_736)
    expect(() => estimateTypesenseVectorMemoryBytes(-1)).toThrow(
      "record count must be a non-negative integer",
    )
  })

  it("builds a stable canonical identity for physical variants", () => {
    expect(
      canonicalTypesenseVideoId("video-square", "4_Win4GoodNewsJesusAD1x1"),
    ).toBe("core:4_win4goodnewsjesus")
  })

  it("parses a complete pgvector value", () => {
    const vector = parseTypesenseVector(
      `[${new Array(TYPESENSE_WATCH_EMBEDDING_DIMENSIONS).fill("0.125").join(",")}]`,
    )
    expect(vector).toHaveLength(TYPESENSE_WATCH_EMBEDDING_DIMENSIONS)
    expect(vector[0]).toBe(0.125)
  })

  it("rejects malformed and wrong-dimension vectors", () => {
    expect(() => parseTypesenseVector("not-a-vector")).toThrow(
      TypesenseWatchSearchIndexError,
    )
    expect(() => parseTypesenseVector("[1,2,3]")).toThrow(
      `Transcript vector must contain ${TYPESENSE_WATCH_EMBEDDING_DIMENSIONS} finite values`,
    )
  })

  it("rejects an invalid import batch size before touching dependencies", async () => {
    await expect(
      rebuildTypesenseWatchSearchIndex({
        prisma: {} as never,
        typesense: {} as never,
        batchSize: 0,
      }),
    ).rejects.toThrow("batch size must be a positive integer")
  })

  it("indexes the broad transcript corpus with per-record public visibility", async () => {
    const embeddingText = `[${new Array(TYPESENSE_WATCH_EMBEDDING_DIMENSIONS)
      .fill("0")
      .join(",")}]`
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "chunk-private",
          videoId: "video-private",
          videoEditionId: "edition-private",
          coreId: "private-core",
          language: "en",
          text: "Private transcript",
          startSeconds: 0,
          embeddingText,
          publiclyVisible: false,
        },
        {
          id: "chunk-public",
          videoId: "video-public",
          videoEditionId: "edition-public",
          coreId: "public-core",
          language: "fr",
          text: "Public transcript",
          startSeconds: 1,
          embeddingText,
          publiclyVisible: true,
        },
      ])
      .mockResolvedValueOnce([])
    const prisma = {
      video: {
        findMany: vi.fn(async () => [
          {
            id: "video-public",
            coreId: "public-core",
            slug: "public-video",
            label: null,
            locales: [
              {
                locale: "fr",
                title: "Vidéo publique",
                description: "Description publique",
              },
            ],
            dubs: [],
            images: [],
            children: [],
          },
        ]),
      },
      $queryRaw: queryRaw,
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => []),
      getAlias: vi.fn(async () => undefined),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      upsertAlias: vi.fn(async () => ({})),
    } as unknown as TypesenseClient

    const stats = await rebuildTypesenseWatchSearchIndex({
      prisma,
      typesense,
      buildId: "broad-corpus-test",
    })

    const transcriptSql = (
      queryRaw.mock.calls[1]?.[0] as unknown as { strings: string[] }
    ).strings.join(" ")
    expect(transcriptSql).toContain('AS "publiclyVisible"')
    expect(transcriptSql).not.toMatch(
      /JOIN video v\s+ON v\.id = vt\.video_id\s+AND v\.deleted_at/,
    )
    expect(stats.transcriptDocuments).toBe(2)
    expect(stats.publicTranscriptDocuments).toBe(1)
    const transcriptImports = vi
      .mocked(typesense.importDocuments)
      .mock.calls.filter(([collection]) =>
        String(collection).includes("watch_search_transcripts"),
      )
      .map(([, documents]) => documents)
    expect(transcriptImports).toEqual([
      [
        expect.objectContaining({
          id: "chunk-private",
          documentKind: "transcript",
          videoEditionId: "edition-private",
          canonicalVideoId: "core:private-core",
          publiclyVisible: false,
        }),
        expect.objectContaining({
          id: "chunk-public",
          documentKind: "transcript",
          videoEditionId: "edition-public",
          canonicalVideoId: "core:public-core",
          publiclyVisible: true,
          embedding: expect.any(Array),
        }),
      ],
    ])
    expect(transcriptImports[0]?.[0]).not.toHaveProperty("titles")
    expect(typesense.importDocuments).toHaveBeenCalledWith(
      "watch_search_lexical_broad-corpus-test",
      [expect.objectContaining({ title_fr: ["Vidéo publique"] })],
    )
  })

  it("reuses the active transcript collection for routine metadata rebuilds", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => [
        { name: "watch_search_catalog_previous", fields: [] },
        { name: "watch_search_availability_previous", fields: [] },
        { name: "watch_search_lexical_previous", fields: [] },
        {
          name: "watch_search_transcripts_active",
          fields: [{ name: "videoEditionId", type: "string" }],
        },
        { name: "watch_search_transcripts_old", fields: [] },
        { name: "watch_search_transcripts_partial", fields: [] },
        { name: "unrelated_collection", fields: [] },
      ]),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name:
          alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
            ? "watch_search_transcripts_active"
            : `${alias}_previous`,
      })),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      multiSearch: vi.fn(async () => [
        {
          found: 280_107,
          out_of: 280_107,
          page: 1,
          search_time_ms: 1,
          hits: [],
        },
        {
          found: 17_462,
          out_of: 280_107,
          page: 1,
          search_time_ms: 1,
          hits: [],
        },
      ]),
      upsertAlias: vi.fn(async () => ({})),
      deleteCollection: vi.fn(async () => undefined),
    } as unknown as TypesenseClient

    const stats = await rebuildTypesenseWatchSearchIndex({
      prisma,
      typesense,
      buildId: "metadata-only-test",
    })

    expect(typesense.createCollection).toHaveBeenCalledTimes(3)
    expect(typesense.createCollection).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining("watch_search_transcripts"),
      }),
    )
    expect(typesense.upsertAlias).not.toHaveBeenCalledWith(
      TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      expect.any(String),
    )
    expect(typesense.multiSearch).toHaveBeenCalledWith([
      expect.objectContaining({
        collection: "watch_search_transcripts_active",
        q: "*",
      }),
      expect.objectContaining({
        collection: "watch_search_transcripts_active",
        q: "*",
        filter_by: "publiclyVisible:=true",
      }),
    ])
    expect(stats).toMatchObject({
      transcriptDocuments: 280_107,
      publicTranscriptDocuments: 17_462,
      transcriptCollection: "watch_search_transcripts_active",
      transcriptReused: true,
      retiredCollections: [
        "watch_search_catalog_previous",
        "watch_search_availability_previous",
        "watch_search_lexical_previous",
        "watch_search_transcripts_old",
        "watch_search_transcripts_partial",
      ],
      retirementFailures: [],
    })
    expect(typesense.deleteCollection).not.toHaveBeenCalledWith(
      "watch_search_transcripts_active",
    )
    expect(typesense.deleteCollection).not.toHaveBeenCalledWith(
      "unrelated_collection",
    )
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("requires an explicit rebuild when reused transcripts lack edition IDs", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => [
        {
          name: "watch_search_transcripts_active",
          fields: [
            { name: "documentKind", type: "string" },
            { name: "canonicalVideoId", type: "string" },
            { name: "titles", type: "string[]" },
          ],
        },
      ]),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name:
          alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
            ? "watch_search_transcripts_active"
            : `${alias}_previous`,
      })),
      createCollection: vi.fn(async () => ({})),
    } as unknown as TypesenseClient

    await expect(
      rebuildTypesenseWatchSearchIndex({
        prisma,
        typesense,
        buildId: "missing-edition-id",
      }),
    ).rejects.toThrow("rerun with --rebuild-transcripts")
    expect(typesense.createCollection).not.toHaveBeenCalled()
  })

  it("publishes the lexical projection without mutating reused transcripts", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => [viewerSafeVideo("Current")]) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => [
        {
          name: "watch_search_transcripts_active",
          fields: [
            { name: "documentKind", type: "string" },
            { name: "canonicalVideoId", type: "string" },
            { name: "titles", type: "string[]" },
            { name: "videoEditionId", type: "string" },
          ],
        },
      ]),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name:
          alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
            ? "watch_search_transcripts_active"
            : `${alias}_previous`,
      })),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      deleteDocumentsByFilter: vi.fn(async () => 0),
      updateDocumentsByFilter: vi.fn(async () => 0),
      multiSearch: vi.fn(async (searches: Array<{ filter_by?: string }>) =>
        searches[0]?.filter_by === "documentKind:=video"
          ? [
              {
                found: 0,
                out_of: 281_214,
                page: 1,
                search_time_ms: 1,
                hits: [],
              },
            ]
          : [
              {
                found: 280_107,
                out_of: 281_214,
                page: 1,
                search_time_ms: 1,
                hits: [],
              },
              {
                found: 17_462,
                out_of: 281_214,
                page: 1,
                search_time_ms: 1,
                hits: [],
              },
            ],
      ),
      upsertAlias: vi.fn(async () => ({})),
      deleteCollection: vi.fn(async () => undefined),
    } as unknown as TypesenseClient

    const stats = await rebuildTypesenseWatchSearchIndex({
      prisma,
      typesense,
      buildId: "metadata-hybrid-test",
    })

    expect(typesense.multiSearch).toHaveBeenCalledWith([
      expect.objectContaining({ filter_by: "documentKind:=transcript" }),
      expect.objectContaining({
        filter_by: "documentKind:=transcript && publiclyVisible:=true",
      }),
    ])
    expect(typesense.importDocuments).toHaveBeenCalledWith(
      "watch_search_lexical_metadata-hybrid-test",
      [
        expect.objectContaining({
          id: "video-1:slug:english",
          videoId: "video-1",
          canonicalVideoId: "core:core-1",
          languageIdentity: "slug:english",
          title_en: ["Current"],
          metadata_en: ["Current description"],
        }),
      ],
    )
    expect(typesense.importDocuments).not.toHaveBeenCalledWith(
      "watch_search_transcripts_active",
      expect.anything(),
      expect.anything(),
    )
    expect(typesense.deleteDocumentsByFilter).not.toHaveBeenCalled()
    expect(typesense.updateDocumentsByFilter).not.toHaveBeenCalled()
    expect(typesense.upsertAlias).toHaveBeenCalledWith(
      TYPESENSE_WATCH_LEXICAL_ALIAS,
      "watch_search_lexical_metadata-hybrid-test",
    )
    expect(stats).toMatchObject({
      transcriptReused: true,
      hybridReady: true,
      transcriptDocuments: 280_107,
      publicTranscriptDocuments: 17_462,
      videoDocuments: 0,
      lexicalDocuments: 1,
      lexicalCollection: "watch_search_lexical_metadata-hybrid-test",
      lexicalSearchableBytes: expect.any(Number),
      estimatedKeywordMemoryLowBytes: expect.any(Number),
      estimatedKeywordMemoryHighBytes: expect.any(Number),
    })
  })

  it("moves renamed titles through the lexical alias without transcript patches", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => [viewerSafeVideo("New")]) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => [
        {
          name: "watch_search_transcripts_active",
          fields: [
            { name: "documentKind" },
            { name: "canonicalVideoId" },
            { name: "titles" },
            { name: "videoEditionId" },
          ],
        },
      ]),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name:
          alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
            ? "watch_search_transcripts_active"
            : `${alias}_previous`,
      })),
      multiSearch: vi.fn(async () => [
        { found: 1, out_of: 2, page: 1, search_time_ms: 1, hits: [] },
        { found: 1, out_of: 2, page: 1, search_time_ms: 1, hits: [] },
      ]),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      deleteDocumentsByFilter: vi.fn(async () => 0),
      updateDocumentsByFilter: vi.fn(async () => 1),
      upsertAlias: vi.fn(async () => ({})),
      deleteCollection: vi.fn(async () => undefined),
    } as unknown as TypesenseClient

    await rebuildTypesenseWatchSearchIndex({
      prisma,
      typesense,
      buildId: "title-rename",
    })

    expect(typesense.importDocuments).toHaveBeenCalledWith(
      "watch_search_lexical_title-rename",
      [expect.objectContaining({ title_en: ["New"] })],
    )
    expect(typesense.updateDocumentsByFilter).not.toHaveBeenCalled()
    expect(typesense.deleteDocumentsByFilter).not.toHaveBeenCalled()
  })

  it("rebuilds transcripts when explicitly requested", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => [
        { name: "watch_search_catalog_previous", fields: [] },
        { name: "watch_search_availability_previous", fields: [] },
        { name: "watch_search_transcripts_previous", fields: [] },
      ]),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name: `${alias}_previous`,
      })),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      upsertAlias: vi.fn(async () => ({})),
      deleteCollection: vi.fn(async () => undefined),
    } as unknown as TypesenseClient

    const stats = await rebuildTypesenseWatchSearchIndex({
      prisma,
      typesense,
      buildId: "manual-full-test",
      transcriptStrategy: "rebuild",
    })

    expect(typesense.createCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining("watch_search_transcripts"),
      }),
    )
    expect(typesense.upsertAlias).toHaveBeenCalledWith(
      TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      expect.stringContaining("watch_search_transcripts"),
    )
    expect(stats.transcriptReused).toBe(false)
    expect(stats.retiredCollections).toEqual([
      "watch_search_catalog_previous",
      "watch_search_availability_previous",
      "watch_search_transcripts_previous",
    ])
  })

  it("rolls back the new lexical alias without touching reused transcripts", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => [
        {
          name: "watch_search_transcripts_active",
          fields: [
            { name: "documentKind", type: "string" },
            { name: "canonicalVideoId", type: "string" },
            { name: "titles", type: "string[]" },
            { name: "videoEditionId", type: "string" },
          ],
        },
      ]),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name:
          alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
            ? "watch_search_transcripts_active"
            : `${alias}_previous`,
      })),
      multiSearch: vi.fn(async () => [
        {
          found: 280_107,
          out_of: 280_108,
          page: 1,
          search_time_ms: 1,
          hits: [],
        },
        {
          found: 17_462,
          out_of: 280_108,
          page: 1,
          search_time_ms: 1,
          hits: [],
        },
      ]),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      deleteDocumentsByFilter: vi.fn(async () => 1),
      updateDocumentsByFilter: vi.fn(async () => 1),
      upsertAlias: vi.fn(async (alias: string, collection: string) => {
        if (
          alias === TYPESENSE_WATCH_CATALOG_ALIAS &&
          collection !== `${TYPESENSE_WATCH_CATALOG_ALIAS}_previous`
        ) {
          throw new Error("catalog alias failed")
        }
      }),
      deleteAlias: vi.fn(async () => undefined),
      deleteCollection: vi.fn(async () => undefined),
    } as unknown as TypesenseClient

    await expect(
      rebuildTypesenseWatchSearchIndex({
        prisma,
        typesense,
        buildId: "failed-hybrid-refresh",
      }),
    ).rejects.toThrow("catalog alias failed")

    expect(typesense.upsertAlias).toHaveBeenCalledWith(
      TYPESENSE_WATCH_LEXICAL_ALIAS,
      `${TYPESENSE_WATCH_LEXICAL_ALIAS}_previous`,
    )
    expect(typesense.importDocuments).not.toHaveBeenCalledWith(
      "watch_search_transcripts_active",
      expect.anything(),
      expect.anything(),
    )
    expect(typesense.deleteDocumentsByFilter).not.toHaveBeenCalled()
    expect(typesense.updateDocumentsByFilter).not.toHaveBeenCalled()
  })

  it("rolls back metadata aliases without touching a reused transcript alias", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => [
        {
          name: "transcripts_active",
          fields: [{ name: "videoEditionId", type: "string" }],
        },
      ]),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name:
          alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
            ? "transcripts_active"
            : `${alias}_previous`,
      })),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      multiSearch: vi.fn(async () => [
        {
          found: 280_107,
          out_of: 280_107,
          page: 1,
          search_time_ms: 1,
          hits: [],
        },
        {
          found: 17_462,
          out_of: 280_107,
          page: 1,
          search_time_ms: 1,
          hits: [],
        },
      ]),
      upsertAlias: vi.fn(async (alias: string, collection: string) => {
        if (
          alias === TYPESENSE_WATCH_CATALOG_ALIAS &&
          collection !== `${TYPESENSE_WATCH_CATALOG_ALIAS}_previous`
        ) {
          throw new Error("catalog alias failed")
        }
      }),
      deleteAlias: vi.fn(async () => undefined),
      deleteCollection: vi.fn(async () => undefined),
    } as unknown as TypesenseClient

    await expect(
      rebuildTypesenseWatchSearchIndex({
        prisma,
        typesense,
        buildId: "metadata-rollback-test",
      }),
    ).rejects.toThrow("catalog alias failed")

    expect(typesense.upsertAlias).not.toHaveBeenCalledWith(
      TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      expect.any(String),
    )
    expect(typesense.deleteCollection).toHaveBeenCalledTimes(3)
    expect(typesense.deleteCollection).not.toHaveBeenCalledWith(
      "transcripts_active",
    )
  })

  it("restores the first alias when publishing the second alias fails", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      listCollections: vi.fn(async () => []),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name:
          alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
            ? "transcripts_previous"
            : alias === TYPESENSE_WATCH_AVAILABILITY_ALIAS
              ? "availability_previous"
              : alias === TYPESENSE_WATCH_LEXICAL_ALIAS
                ? "lexical_previous"
                : "catalog_previous",
      })),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      upsertAlias: vi.fn(async (alias: string, collection: string) => {
        if (
          alias === TYPESENSE_WATCH_CATALOG_ALIAS &&
          collection !== "catalog_previous"
        ) {
          throw new Error("catalog alias failed")
        }
      }),
      deleteAlias: vi.fn(async () => undefined),
      deleteCollection: vi.fn(async () => undefined),
    } as unknown as TypesenseClient

    await expect(
      rebuildTypesenseWatchSearchIndex({
        prisma,
        typesense,
        buildId: "rollback-test",
        transcriptStrategy: "rebuild",
      }),
    ).rejects.toThrow("catalog alias failed")

    expect(typesense.upsertAlias).toHaveBeenCalledWith(
      TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      "transcripts_previous",
    )
    expect(typesense.upsertAlias).toHaveBeenCalledWith(
      TYPESENSE_WATCH_AVAILABILITY_ALIAS,
      "availability_previous",
    )
    expect(typesense.upsertAlias).toHaveBeenCalledWith(
      TYPESENSE_WATCH_LEXICAL_ALIAS,
      "lexical_previous",
    )
    expect(typesense.deleteCollection).toHaveBeenCalledTimes(4)
  })
})
