import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { TypesenseClient } from "./typesense-client"
import {
  buildAvailabilityDocuments,
  buildCatalogDocuments,
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
          language: "en",
          text: "Private transcript",
          startSeconds: 0,
          embeddingText,
          publiclyVisible: false,
        },
        {
          id: "chunk-public",
          videoId: "video-public",
          language: "fr",
          text: "Public transcript",
          startSeconds: 1,
          embeddingText,
          publiclyVisible: true,
        },
      ])
      .mockResolvedValueOnce([])
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: queryRaw,
    } as unknown as PrismaClient
    const typesense = {
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
    expect(typesense.importDocuments).toHaveBeenCalledWith(
      expect.stringContaining("watch_search_transcripts"),
      [
        expect.objectContaining({
          id: "chunk-private",
          publiclyVisible: false,
        }),
        expect.objectContaining({
          id: "chunk-public",
          publiclyVisible: true,
        }),
      ],
    )
  })

  it("restores the first alias when publishing the second alias fails", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
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
