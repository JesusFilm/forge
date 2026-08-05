import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { TypesenseClient } from "./typesense-client"
import {
  buildAvailabilityDocuments,
  buildCatalogDocuments,
  buildTypesenseWatchVideoDocuments,
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
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "./typesense-watch-search-schema"

function viewerSafeVideo(title: string) {
  return {
    id: "video-1",
    coreId: "core-1",
    slug: "video-1",
    label: null,
    locales: [{ locale: "en", title, description: `${title} description` }],
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
            title: "La communion",
            description: "Description française",
          },
        ],
        dubs: [
          {
            id: "dub-fr-long",
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
        languageId: "language-fr",
        languageSlug: "french",
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
    expect(subtitleSql).toContain("v.no_index = false")
    expect(subtitleSql).toContain("vl.status = 'published'")
    expect(subtitleSql).toContain(
      "vs.vtt_src IS NOT NULL OR vs.srt_src IS NOT NULL",
    )
    expect(documents).toEqual([
      expect.objectContaining({
        id: "video-1",
        titles: ["La communion"],
        localeCodes: ["fr"],
        imageUrl: "https://example.com/preferred.jpg",
        childCount: 1,
        audioOptionsJson: JSON.stringify([
          {
            id: "dub-fr-long",
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
            languageId: "language-fr",
            languageSlug: "french",
          },
        ]),
      }),
    ])

    expect(buildAvailabilityDocuments(documents)).toEqual([
      {
        id: "video-1:language-fr",
        videoId: "video-1",
        languageId: "language-fr",
        languageSlug: "french",
        languageEnglishName: "French",
        audio: true,
        subtitles: true,
        playbackId: "playback-fr",
        durationSeconds: 180,
      },
    ])
  })

  it("estimates vector RAM using the Typesense sizing formula", () => {
    expect(estimateTypesenseVectorMemoryBytes(17_118)).toBe(184_052_736)
    expect(() => estimateTypesenseVectorMemoryBytes(-1)).toThrow(
      "record count must be a non-negative integer",
    )
  })

  it("builds vectorless video anchors with a stable canonical identity", () => {
    expect(
      canonicalTypesenseVideoId("video-square", "4_Win4GoodNewsJesusAD1x1"),
    ).toBe("core:4_win4goodnewsjesus")

    const [document] = buildTypesenseWatchVideoDocuments(
      [
        {
          id: "video-square",
          coreId: "4_Win4GoodNewsJesusAD1x1",
          slug: "jesus-square",
          titles: ["JESUS"],
          localeCodes: ["en"],
          descriptions: ["The life of Jesus"],
          localesJson: "[]",
          label: null,
          childCount: 0,
          imageUrl: null,
          imageBlurDataUrl: null,
          audioLanguageSlugs: ["english"],
          subtitleLanguageSlugs: [],
          audioOptionsJson: "[]",
          subtitleOptionsJson: "[]",
        },
      ],
      "build-1",
    )

    expect(document).toEqual({
      id: "video:video-square",
      documentKind: "video",
      videoId: "video-square",
      canonicalVideoId: "core:4_win4goodnewsjesus",
      language: "__catalog__",
      publiclyVisible: true,
      titles: ["JESUS"],
      descriptions: ["The life of Jesus"],
      catalogGeneration: "build-1",
      text: "",
      startSeconds: null,
    })
    expect(document?.embedding).toBeUndefined()
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
          id: "video:video-public",
          documentKind: "video",
          canonicalVideoId: "core:public-core",
          titles: ["Vidéo publique"],
        }),
      ],
      [
        expect.objectContaining({
          id: "chunk-private",
          documentKind: "transcript",
          canonicalVideoId: "core:private-core",
          publiclyVisible: false,
        }),
        expect.objectContaining({
          id: "chunk-public",
          documentKind: "transcript",
          canonicalVideoId: "core:public-core",
          titles: ["Vidéo publique"],
          publiclyVisible: true,
          embedding: expect.any(Array),
        }),
      ],
    ])
    expect(transcriptImports[0]?.[0]).not.toHaveProperty("embedding")
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
        { name: "watch_search_transcripts_active", fields: [] },
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

    expect(typesense.createCollection).toHaveBeenCalledTimes(2)
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

  it("refreshes only video anchors when the reused transcript collection supports hybrid search", async () => {
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
    expect(typesense.deleteDocumentsByFilter).toHaveBeenCalledWith(
      "watch_search_transcripts_active",
      "documentKind:=video && catalogGeneration:!=`watch_search_catalog_metadata-hybrid-test`",
    )
    expect(typesense.importDocuments).toHaveBeenCalledWith(
      "watch_search_transcripts_active",
      [
        expect.objectContaining({
          id: "video:video-1",
          documentKind: "video",
          titles: ["Current"],
        }),
      ],
      "upsert",
    )
    const anchor = vi.mocked(typesense.importDocuments).mock.calls[0]?.[1]?.[0]
    expect(anchor).not.toHaveProperty("embedding")
    expect(stats).toMatchObject({
      transcriptReused: true,
      hybridReady: true,
      transcriptDocuments: 280_107,
      publicTranscriptDocuments: 17_462,
      videoDocuments: 1,
    })
  })

  it("patches renamed transcript titles without resending embeddings", async () => {
    const previousVideoDocument = {
      ...buildTypesenseWatchVideoDocuments(
        [
          {
            id: "video-1",
            coreId: "core-1",
            slug: "video-1",
            titles: ["Old"],
            localeCodes: ["en"],
            descriptions: [],
            localesJson: "[]",
            label: null,
            childCount: 0,
            imageUrl: null,
            imageBlurDataUrl: null,
            audioLanguageSlugs: [],
            subtitleLanguageSlugs: [],
            audioOptionsJson: "[]",
            subtitleOptionsJson: "[]",
          },
        ],
        "old-generation",
      )[0]!,
    }
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
      multiSearch: vi.fn(async (searches: Array<{ filter_by?: string }>) =>
        searches[0]?.filter_by === "documentKind:=video"
          ? [
              {
                found: 1,
                out_of: 1,
                page: 1,
                search_time_ms: 1,
                hits: [{ document: previousVideoDocument }],
              },
            ]
          : [
              { found: 1, out_of: 2, page: 1, search_time_ms: 1, hits: [] },
              { found: 1, out_of: 2, page: 1, search_time_ms: 1, hits: [] },
            ],
      ),
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

    expect(typesense.updateDocumentsByFilter).toHaveBeenCalledWith(
      "watch_search_transcripts_active",
      "documentKind:=transcript && videoId:=`video-1`",
      { titles: ["New"] },
    )
    expect(
      vi.mocked(typesense.updateDocumentsByFilter).mock.calls[0]?.[2],
    ).not.toHaveProperty("embedding")
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

  it("restores reused video anchors when later alias publication fails", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const previousVideoDocument = {
      id: "video:previous",
      documentKind: "video" as const,
      videoId: "previous",
      canonicalVideoId: "video:previous",
      language: "__catalog__",
      publiclyVisible: true,
      titles: ["Previous"],
      catalogGeneration: "watch_search_catalog_previous",
      text: "",
      startSeconds: null,
    }
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
      multiSearch: vi.fn(async (searches: Array<{ filter_by?: string }>) =>
        searches[0]?.filter_by === "documentKind:=video"
          ? [
              {
                found: 1,
                out_of: 1,
                page: 1,
                search_time_ms: 1,
                hits: [{ document: previousVideoDocument }],
              },
            ]
          : [
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
            ],
      ),
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

    expect(typesense.importDocuments).toHaveBeenCalledWith(
      "watch_search_transcripts_active",
      [previousVideoDocument],
      "upsert",
    )
    expect(typesense.deleteDocumentsByFilter).toHaveBeenCalledWith(
      "watch_search_transcripts_active",
      "documentKind:=video && catalogGeneration:=`watch_search_catalog_failed-hybrid-refresh`",
    )
    expect(typesense.updateDocumentsByFilter).toHaveBeenNthCalledWith(
      1,
      "watch_search_transcripts_active",
      "documentKind:=transcript && videoId:=`previous`",
      { titles: [] },
    )
    expect(typesense.updateDocumentsByFilter).toHaveBeenNthCalledWith(
      2,
      "watch_search_transcripts_active",
      "documentKind:=transcript && videoId:=`previous`",
      { titles: ["Previous"] },
    )
    for (const [, , update] of vi.mocked(typesense.updateDocumentsByFilter).mock
      .calls) {
      expect(update).not.toHaveProperty("embedding")
    }
  })

  it("rolls back metadata aliases without touching a reused transcript alias", async () => {
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
    expect(typesense.deleteCollection).toHaveBeenCalledTimes(2)
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
    expect(typesense.deleteCollection).toHaveBeenCalledTimes(3)
  })
})
