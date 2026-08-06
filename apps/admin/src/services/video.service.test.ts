import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import {
  loadWatchRouteSnapshotRootLocaleBuckets,
  VideoService,
  VideoLookupValidationError,
  VIDEOS_BY_CORE_IDS_MAX,
} from "./video.service"

describe("loadWatchRouteSnapshotRootLocaleBuckets", () => {
  it("hydrates deduplicated public social images in one bounded root-only batch", async () => {
    const prisma = {
      videoLocale: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "locale-exact",
            videoId: "video-1",
            locale: "es-419",
            languageSlug: "spanish-latin-american",
            publishedAt: new Date("2026-07-31T00:00:00.000Z"),
            title: "Jesús",
            description: "Descripción",
            snippet: "Resumen",
            imageAlt: "Jesús",
            searchTitle: "Ver JESÚS",
            searchDescription: "Película completa",
            socialImageAssetId: "asset-1",
          },
          {
            id: "locale-broad",
            videoId: "video-1",
            locale: "es-419",
            languageSlug: "spanish",
            publishedAt: null,
            title: "Jesús amplio",
            description: null,
            snippet: null,
            imageAlt: null,
            searchTitle: null,
            searchDescription: null,
            socialImageAssetId: "asset-1",
          },
          {
            id: "locale-en",
            videoId: "video-1",
            locale: "en",
            languageSlug: "english",
            publishedAt: null,
            title: "Jesus",
            description: null,
            snippet: null,
            imageAlt: null,
            searchTitle: "Watch JESUS",
            searchDescription: null,
            socialImageAssetId: "asset-missing",
          },
        ]),
      },
      mediaAsset: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "asset-1",
            backend: "S3",
            status: "READY",
            visibility: "PUBLIC",
            objectKey: "images/jesus.jpg",
            previewObjectKey: "previews/jesus.jpg",
            muxPlaybackId: null,
            mimeType: "image/webp",
            width: 1200,
            height: 630,
          },
        ]),
      },
    }

    const buckets = await loadWatchRouteSnapshotRootLocaleBuckets({
      prisma: prisma as never,
      videoId: "video-1",
      locale: "es-419",
      languageSlug: "spanish-latin-american",
      includeUnpublished: false,
      publicMediaBaseUrl: "https://admin.example",
    })

    expect(prisma.videoLocale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ videoId: "video-1" }),
        select: expect.objectContaining({
          searchTitle: true,
          searchDescription: true,
          socialImageAssetId: true,
        }),
      }),
    )
    expect(prisma.mediaAsset.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["asset-1", "asset-missing"] },
          kind: "IMAGE",
          status: "READY",
          visibility: "PUBLIC",
        }),
      }),
    )
    expect(buckets.exactLocales[0]).toMatchObject({
      searchTitle: "Ver JESÚS",
      searchDescription: "Película completa",
      socialImage: {
        url: "https://admin.example/api/public/media-assets/asset-1/preview",
        width: 1200,
        height: 630,
        mimeType: "image/webp",
      },
    })
    expect(buckets.broadLocales[0]?.socialImage).toEqual(
      buckets.exactLocales[0]?.socialImage,
    )
    expect(buckets.englishLocales[0]?.socialImage).toBeNull()
  })

  it("does not issue an asset query when selected root buckets have no asset ids", async () => {
    const prisma = {
      videoLocale: { findMany: vi.fn().mockResolvedValue([]) },
      mediaAsset: { findMany: vi.fn() },
    }

    await loadWatchRouteSnapshotRootLocaleBuckets({
      prisma: prisma as never,
      videoId: "video-1",
      locale: "en",
      languageSlug: "english",
      includeUnpublished: true,
      publicMediaBaseUrl: "https://admin.example",
    })

    expect(prisma.mediaAsset.findMany).not.toHaveBeenCalled()
  })
})

function mockPrisma() {
  const tx = {
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
  }
  return {
    video: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    videoDub: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    language: {
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn((callback) => callback(tx)),
    tx,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

type Row = {
  id: string
  coreId: string
  label: string | null
  targetLocale: string | null
  primaryLanguageBcp47: string | null
  languageBcp47: string | null
  muxAssetId: string | null
  subtitleUrl: string | null
}

function rowFixture(overrides: Partial<Row> = {}): Row {
  return {
    id: "v-1",
    coreId: "core-1",
    // Prisma exposes the TS enum identifier (UPPER_SNAKE_CASE);
    // the service normalizes it to camelCase on the way out.
    label: "FEATURE_FILM",
    targetLocale: null,
    primaryLanguageBcp47: "en",
    languageBcp47: "en",
    muxAssetId: "mux-asset-en",
    subtitleUrl: "https://example.com/en.vtt",
    ...overrides,
  }
}

const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }
const PUBLIC_USER: Principal | null = null

describe("VideoService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: VideoService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new VideoService(prisma)
  })

  describe("list", () => {
    it("returns non-deleted videos ordered by updatedAt", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: {}, query: {} })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where).toHaveProperty("deletedAt", null)
      expect(call.orderBy).toEqual({ updatedAt: "desc" })
    })

    it("clamps limit to 200", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: { limit: 500 }, query: {} })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.take).toBe(200)
    })

    // U2 (2026-05-11): resolver authScopes is the sole gate for list/getById/
    // getBySlug. Re-adding a `user` param here breaks this assertion.
    it("does not require a user principal (resolver-only auth contract)", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])
      await expect(
        service.list({ input: {}, query: {} }),
      ).resolves.not.toThrow()
    })

    it("filters across video identifiers and localized metadata when search is present", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: { search: "Jesus Film" }, query: {} })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where.deletedAt).toBeNull()
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          { coreId: { contains: "Jesus Film", mode: "insensitive" } },
          { slug: { contains: "Jesus Film", mode: "insensitive" } },
          {
            locales: {
              some: {
                OR: expect.arrayContaining([
                  { title: { contains: "Jesus Film", mode: "insensitive" } },
                  {
                    description: {
                      contains: "Jesus Film",
                      mode: "insensitive",
                    },
                  },
                ]),
              },
            },
          },
        ]),
      )
    })

    it("adds enum filters for human-readable video label and source queries", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: { search: "feature film" }, query: {} })

      let call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where.OR).toEqual(
        expect.arrayContaining([{ label: { in: ["FEATURE_FILM"] } }]),
      )

      prisma.video.findMany.mockResolvedValueOnce([])
      await service.list({ input: { search: "mux" }, query: {} })

      call = prisma.video.findMany.mock.calls[1][0]
      expect(call.where.OR).toEqual(
        expect.arrayContaining([{ videoSource: { in: ["MUX"] } }]),
      )
    })

    it("filters through dub language and image metadata", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: { search: "english" }, query: {} })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          {
            dubs: {
              some: {
                OR: expect.arrayContaining([
                  {
                    language: {
                      is: expect.objectContaining({
                        OR: expect.arrayContaining([
                          {
                            slug: {
                              contains: "english",
                              mode: "insensitive",
                            },
                          },
                        ]),
                      }),
                    },
                  },
                ]),
              },
            },
          },
          {
            images: {
              some: {
                OR: expect.arrayContaining([
                  { url: { contains: "english", mode: "insensitive" } },
                  { kind: { contains: "english", mode: "insensitive" } },
                ]),
              },
            },
          },
        ]),
      )
    })

    it("filters by video library category labels", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({
        input: { category: "features", search: "" },
        query: {},
      })

      let call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          { deletedAt: null },
          { label: { in: ["FEATURE_FILM"] } },
        ]),
      )

      prisma.video.findMany.mockResolvedValueOnce([])
      await service.list({
        input: { category: "collections", search: "" },
        query: {},
      })

      call = prisma.video.findMany.mock.calls[1][0]
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          { deletedAt: null },
          { label: { in: ["COLLECTION"] } },
        ]),
      )

      prisma.video.findMany.mockResolvedValueOnce([])
      await service.list({
        input: { category: "episodes", search: "" },
        query: {},
      })

      call = prisma.video.findMany.mock.calls[2][0]
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          { deletedAt: null },
          { label: { in: ["EPISODE"] } },
        ]),
      )
    })

    it("does not add a category label filter for the all category", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: { category: "all" }, query: {} })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where).toEqual({ deletedAt: null })
    })

    it("filters videos through a collection parent relation", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({
        input: { collection: "the-story" },
        query: {},
      })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          { deletedAt: null },
          {
            parents: {
              some: {
                parent: {
                  deletedAt: null,
                  OR: [
                    { id: "the-story" },
                    { coreId: "the-story" },
                    { slug: "the-story" },
                  ],
                },
              },
            },
          },
        ]),
      )
    })

    it("combines search, category, collection, and dubbed language filters", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({
        input: {
          category: "series",
          collection: "the-story",
          language: "english",
          search: "Jesus",
        },
        query: {},
      })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { slug: { contains: "Jesus", mode: "insensitive" } },
            ]),
          }),
          { label: { in: ["SERIES"] } },
          {
            parents: {
              some: {
                parent: {
                  deletedAt: null,
                  OR: [
                    { id: "the-story" },
                    { coreId: "the-story" },
                    { slug: "the-story" },
                  ],
                },
              },
            },
          },
          {
            dubs: {
              some: {
                deletedAt: null,
                language: {
                  is: expect.objectContaining({
                    OR: expect.arrayContaining([
                      {
                        slug: {
                          contains: "english",
                          mode: "insensitive",
                        },
                      },
                    ]),
                  }),
                },
              },
            },
          },
        ]),
      )
    })

    it("applies supported video library sort orders", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.list({ input: { sort: "oldest" }, query: {} })

      let call = prisma.video.findMany.mock.calls[0][0]
      expect(call.orderBy).toEqual([{ updatedAt: "asc" }, { createdAt: "asc" }])

      prisma.video.findMany.mockResolvedValueOnce([])
      await service.list({ input: { sort: "created" }, query: {} })

      call = prisma.video.findMany.mock.calls[1][0]
      expect(call.orderBy).toEqual([
        { createdAt: "desc" },
        { updatedAt: "desc" },
      ])
    })
  })

  describe("getWatchLanguageInventory", () => {
    it("returns empty buckets when the requested language slug is unknown", async () => {
      prisma.language.findFirst.mockResolvedValueOnce(null)

      await expect(
        service.getWatchLanguageInventory({ languageSlug: "not-a-language" }),
      ).resolves.toMatchObject({
        language: null,
        counts: {
          audioCollections: 0,
          audioVideos: 0,
          subtitleOnlyVideos: 0,
          total: 0,
        },
        promoted: [],
        audioCollections: [],
        audioVideos: [],
        subtitleOnlyVideos: [],
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it("groups inventory rows into audio collections, audio videos, and subtitle-only videos", async () => {
      prisma.language.findFirst.mockResolvedValueOnce({
        slug: "spanish-latin-american",
        name: { en: "Spanish, Latin American" },
        bcp47: "es-419",
      })
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        {
          bucket: "audio_collection",
          bucketTotal: 1,
          id: "collection-1",
          coreId: "core-collection-1",
          slug: "story-of-jesus",
          title: "The Story of Jesus",
          description: null,
          imageUrl: null,
          imageAlt: null,
          label: "series",
          availability: "AUDIO",
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 12,
          publishedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          bucket: "audio_video",
          bucketTotal: 1,
          id: "video-1",
          coreId: "core-video-1",
          slug: "jesus-calms-the-storm",
          title: "Jesus Calms the Storm",
          description: "A short film.",
          imageUrl: "https://example.com/storm.jpg",
          imageAlt: "Jesus Calms the Storm",
          label: "shortFilm",
          availability: "AUDIO",
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: 420,
          childCount: 0,
          publishedAt: "2026-05-20T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
        },
        {
          bucket: "subtitle_video",
          bucketTotal: 1,
          id: "video-2",
          coreId: "core-video-2",
          slug: "following-jesus",
          title: "Following Jesus",
          description: "Available with translated subtitles.",
          imageUrl: null,
          imageAlt: null,
          label: "featureFilm",
          availability: "SUBTITLE_ONLY",
          watchLanguageSlug: "english",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: 3600,
          childCount: 0,
          publishedAt: "2026-05-15T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-15T00:00:00.000Z",
        },
      ])

      const inventory = await service.getWatchLanguageInventory({
        languageSlug: "spanish-latin-american",
        limit: 25,
      })

      expect(inventory.language).toMatchObject({
        slug: "spanish-latin-american",
        bcp47: "es-419",
      })
      expect(inventory.counts).toEqual({
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 1,
        total: 3,
      })
      expect(inventory.audioCollections).toHaveLength(1)
      expect(inventory.audioVideos).toHaveLength(1)
      expect(inventory.subtitleOnlyVideos).toHaveLength(1)
      expect(inventory.subtitleOnlyVideos[0]).toMatchObject({
        title: "Following Jesus",
        availability: "SUBTITLE_ONLY",
        watchLanguageSlug: "english",
      })
      expect(inventory.promoted.map((item) => item.title)).toEqual([
        "The Story of Jesus",
        "Jesus Calms the Storm",
        "Following Jesus",
      ])
      expect(prisma.tx.$executeRawUnsafe).toHaveBeenCalledWith(
        "SET LOCAL statement_timeout = '10000ms'",
      )
    })

    it("sorts promoted rows by the SQL recency timestamp", async () => {
      prisma.language.findFirst.mockResolvedValueOnce({
        slug: "spanish-latin-american",
        name: { en: "Spanish, Latin American" },
        bcp47: "es-419",
      })
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        {
          bucket: "audio_collection",
          bucketTotal: 1,
          id: "collection-1",
          coreId: "core-collection-1",
          slug: "story-of-jesus",
          title: "The Story of Jesus",
          description: null,
          imageUrl: null,
          imageAlt: null,
          label: "series",
          availability: "AUDIO",
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 12,
          publishedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          sortAt: "2026-06-10T00:00:00.000Z",
        },
        {
          bucket: "audio_video",
          bucketTotal: 1,
          id: "video-1",
          coreId: "core-video-1",
          slug: "jesus-calms-the-storm",
          title: "Jesus Calms the Storm",
          description: null,
          imageUrl: null,
          imageAlt: null,
          label: "shortFilm",
          availability: "AUDIO",
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: 420,
          childCount: 0,
          publishedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          sortAt: "2026-06-01T00:00:00.000Z",
        },
      ])

      const inventory = await service.getWatchLanguageInventory({
        languageSlug: "spanish-latin-american",
      })

      expect(inventory.promoted.map((item) => item.title)).toEqual([
        "The Story of Jesus",
        "Jesus Calms the Storm",
      ])
      expect(inventory.promoted[0]).not.toHaveProperty("sortAt")
    })

    it("computes collection sort order from parent and playable child publish/update dates", async () => {
      prisma.language.findFirst.mockResolvedValueOnce({
        slug: "spanish-latin-american",
        name: { en: "Spanish, Latin American" },
        bcp47: "es-419",
      })
      prisma.tx.$queryRaw.mockResolvedValueOnce([])

      await service.getWatchLanguageInventory({
        languageSlug: "spanish-latin-american",
      })

      const sql = prisma.tx.$queryRaw.mock.calls[0][0].join(" ")
      expect(sql).toContain("MAX(")
      expect(sql).toContain("FROM eligible_candidate_video child")
      expect(sql).toContain('child."hasAudio" = TRUE')
      expect(sql).toContain('COALESCE(child."publishedAt", child."createdAt")')
      expect(sql).toContain('COALESCE(child."updatedAt", child."createdAt")')
      expect(sql).toContain("ORDER BY")
      expect(sql).toContain('"sortAt" DESC NULLS LAST')
      expect(sql).toContain('relation.order AS "parentOrder"')
      expect(sql).toContain('parent_ref."parentOrder"')
    })

    it("bounds language candidates before expensive card hydration", async () => {
      prisma.language.findFirst.mockResolvedValueOnce({
        slug: "spanish-latin-american",
        name: { en: "Spanish, Latin American" },
        bcp47: "es-419",
      })
      prisma.tx.$queryRaw.mockResolvedValueOnce([])

      await service.getWatchLanguageInventory({
        languageSlug: "spanish-latin-american",
      })

      const sql = prisma.tx.$queryRaw.mock.calls[0][0].join(" ")
      const playableAudio = sql.indexOf("playable_audio AS MATERIALIZED")
      const subtitleCandidates = sql.indexOf(
        "usable_subtitle_video AS MATERIALIZED",
      )
      const candidateVideoSource = sql.indexOf("candidate_video_source AS")
      const recencyCutoff = sql.indexOf("candidate_cutoff AS")
      const prelimitedCandidates = sql.indexOf("prelimited_candidates AS")
      const candidateDisplay = sql.indexOf("candidate_display AS")
      const limitedCandidates = sql.indexOf(
        "limited_candidates AS",
        candidateDisplay,
      )
      const selectedImage = sql.indexOf("selected_image.image_url")
      const fallbackDub = sql.indexOf("fallback_dub.language_slug")

      expect(playableAudio).toBeGreaterThanOrEqual(0)
      expect(subtitleCandidates).toBeGreaterThan(playableAudio)
      expect(candidateVideoSource).toBeGreaterThan(subtitleCandidates)
      const subtitleCandidateSql = sql.slice(
        sql.indexOf("usable_subtitle AS MATERIALIZED"),
        candidateVideoSource,
      )
      expect(subtitleCandidateSql).toContain("SELECT DISTINCT")
      expect(subtitleCandidateSql).not.toContain("UNION ALL")
      expect(recencyCutoff).toBeGreaterThan(subtitleCandidates)
      expect(prelimitedCandidates).toBeGreaterThan(recencyCutoff)
      expect(candidateDisplay).toBeGreaterThan(prelimitedCandidates)
      expect(limitedCandidates).toBeGreaterThan(candidateDisplay)
      expect(selectedImage).toBeGreaterThan(limitedCandidates)
      expect(fallbackDub).toBeGreaterThan(limitedCandidates)
      expect(sql).not.toContain("published_videos AS")
      expect(sql).not.toContain("selected_locale AS")
      expect(sql).not.toContain("selected_image AS")
      expect(sql).toContain('BOOL_OR("hasAudio") AS "hasAudio"')
      expect(sql).toContain('BOOL_OR("hasSubtitle") AS "hasSubtitle"')
      expect(sql).not.toContain("same_language_audio")
      expect(sql).toContain(
        'candidate_recency."sortAt" IS NOT DISTINCT FROM candidate_cutoff."sortAt"',
      )
      expect(sql).toContain("dub.hls IS NOT NULL")
      expect(sql).toContain("dub.hls <> ''")
      expect(sql).toContain("subtitle.vtt_src IS NOT NULL")
      expect(sql).toContain("subtitle.srt_src IS NOT NULL")
    })

    it("resolves nonblank inventory titles before humanizing the slug", async () => {
      prisma.language.findFirst.mockResolvedValueOnce({
        slug: "arabic-modern-standard",
        name: { en: "Arabic, Modern Standard" },
        bcp47: "ar",
      })
      prisma.tx.$queryRaw.mockResolvedValueOnce([])

      await service.getWatchLanguageInventory({
        languageSlug: "arabic-modern-standard",
      })

      const sql = prisma.tx.$queryRaw.mock.calls[0][0].join(" ")
      const candidateDisplay = sql.slice(
        sql.indexOf("candidate_display AS"),
        sql.indexOf("ranked_candidates AS"),
      )
      const titleVideoIds = sql.slice(
        sql.indexOf("title_video_id AS MATERIALIZED"),
        sql.indexOf("title_locale AS MATERIALIZED"),
      )
      const titleLocale = sql.slice(
        sql.indexOf("title_locale AS MATERIALIZED"),
        sql.indexOf("candidate_display AS"),
      )
      const candidateLocale = candidateDisplay.slice(
        candidateDisplay.indexOf("LEFT JOIN LATERAL ("),
        candidateDisplay.indexOf(") candidate_locale ON TRUE"),
      )
      const parentReference = sql.slice(
        sql.indexOf("parent_ref.slug"),
        sql.indexOf(") parent_ref ON TRUE"),
      )
      const parentTitleLocale = parentReference.slice(
        parentReference.indexOf("LEFT JOIN LATERAL ("),
        parentReference.indexOf(") parent_title_locale ON TRUE"),
      )

      expect(sql).toContain("SELECT id, slug, bcp47")
      expect(candidateDisplay).toContain("candidate_title_locale.title")
      expect(candidateDisplay).toMatch(
        /LEFT JOIN title_locale candidate_title_locale\s+ON candidate_title_locale\."videoId" = candidate\.id/,
      )
      expect(titleVideoIds).toContain("SELECT candidate.id")
      expect(titleVideoIds).not.toContain("video_relation")
      expect(titleLocale).toContain("SELECT DISTINCT ON (locale.video_id)")
      expect(titleLocale).toContain(
        "NULLIF(BTRIM(locale.title), '') IS NOT NULL",
      )
      expect(titleLocale).toContain(
        "locale.language_id = inventory_language.id",
      )
      expect(titleLocale).toContain(
        "locale.language_slug = inventory_language.slug",
      )
      expect(titleLocale).toContain("locale.locale = inventory_language.bcp47")
      expect(titleLocale).toContain("locale.language_slug = 'english'")
      expect(titleLocale).toContain("locale.locale = 'en'")
      expect(candidateDisplay).toContain(
        "REGEXP_REPLACE(BTRIM(candidate.slug), '[-_]+', ' ', 'g')",
      )
      expect(candidateDisplay).toContain("candidate_locale.description")

      const metadataRequestedBcp47 = candidateLocale.indexOf(
        "WHEN locale.locale = inventory_language.bcp47 THEN 2",
      )
      const metadataEnglishSlug = candidateLocale.indexOf(
        "WHEN locale.language_slug = 'english' THEN 3",
      )
      const metadataEnglishLocale = candidateLocale.indexOf(
        "WHEN locale.locale = 'en' THEN 4",
      )

      expect(metadataRequestedBcp47).toBeGreaterThanOrEqual(0)
      expect(metadataEnglishSlug).toBeGreaterThan(metadataRequestedBcp47)
      expect(metadataEnglishLocale).toBeGreaterThan(metadataEnglishSlug)

      const requestedId = titleLocale.indexOf(
        "WHEN locale.language_id = inventory_language.id THEN 0",
      )
      const requestedSlug = titleLocale.indexOf(
        "WHEN locale.language_slug = inventory_language.slug THEN 1",
      )
      const requestedBcp47 = titleLocale.indexOf(
        "WHEN locale.locale = inventory_language.bcp47 THEN 2",
      )
      const englishSlug = titleLocale.indexOf(
        "WHEN locale.language_slug = 'english' THEN 3",
      )
      const englishLocale = titleLocale.indexOf(
        "WHEN locale.locale = 'en' THEN 4",
      )

      expect(requestedId).toBeGreaterThanOrEqual(0)
      expect(requestedSlug).toBeGreaterThan(requestedId)
      expect(requestedBcp47).toBeGreaterThan(requestedSlug)
      expect(englishSlug).toBeGreaterThan(requestedBcp47)
      expect(englishLocale).toBeGreaterThan(englishSlug)

      expect(parentReference).toContain("parent_title_locale.title")
      expect(parentTitleLocale).toContain(
        "NULLIF(BTRIM(locale.title), '') IS NOT NULL",
      )
      expect(parentReference).toContain(
        "REGEXP_REPLACE(BTRIM(parent.slug), '[-_]+', ' ', 'g')",
      )
      expect(parentTitleLocale).toMatch(
        /AND\s+\(\s*locale\.language_id = inventory_language\.id\s+OR locale\.language_slug = inventory_language\.slug\s+OR locale\.locale = inventory_language\.bcp47\s+OR locale\.language_slug = 'english'\s+OR locale\.locale = 'en'\s*\)/,
      )

      const parentRequestedId = parentTitleLocale.indexOf(
        "WHEN locale.language_id = inventory_language.id THEN 0",
      )
      const parentRequestedSlug = parentTitleLocale.indexOf(
        "WHEN locale.language_slug = inventory_language.slug THEN 1",
      )
      const parentRequestedBcp47 = parentTitleLocale.indexOf(
        "WHEN locale.locale = inventory_language.bcp47 THEN 2",
      )
      const parentEnglishSlug = parentTitleLocale.indexOf(
        "WHEN locale.language_slug = 'english' THEN 3",
      )
      const parentEnglishLocale = parentTitleLocale.indexOf(
        "WHEN locale.locale = 'en' THEN 4",
      )
      const parentFallback = parentTitleLocale.indexOf("ELSE 5")

      expect(parentRequestedId).toBeGreaterThanOrEqual(0)
      expect(parentRequestedSlug).toBeGreaterThan(parentRequestedId)
      expect(parentRequestedBcp47).toBeGreaterThan(parentRequestedSlug)
      expect(parentEnglishSlug).toBeGreaterThan(parentRequestedBcp47)
      expect(parentEnglishLocale).toBeGreaterThan(parentEnglishSlug)
      expect(parentFallback).toBeGreaterThan(parentEnglishLocale)
    })
  })

  describe("countActive", () => {
    it("counts the same non-deleted video scope used by list", async () => {
      prisma.video.count.mockResolvedValueOnce(12)

      await expect(service.countActive()).resolves.toBe(12)
      expect(prisma.video.count).toHaveBeenCalledWith({
        where: { deletedAt: null },
      })
    })

    it("uses the same search filter as list", async () => {
      prisma.video.count.mockResolvedValueOnce(4)

      await expect(service.countActive("published")).resolves.toBe(4)

      const call = prisma.video.count.mock.calls[0][0]
      expect(call.where.deletedAt).toBeNull()
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          {
            locales: {
              some: {
                OR: expect.arrayContaining([{ status: { in: ["PUBLISHED"] } }]),
              },
            },
          },
        ]),
      )
    })

    it("counts with the same category, collection, and language filters as list", async () => {
      prisma.video.count.mockResolvedValueOnce(7)

      await expect(
        service.countActive({
          category: "shortFilms",
          collection: "the-story",
          language: "spanish",
          search: "story",
        }),
      ).resolves.toBe(7)

      const call = prisma.video.count.mock.calls[0][0]
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { slug: { contains: "story", mode: "insensitive" } },
            ]),
          }),
          { label: { in: ["SHORT_FILM"] } },
          expect.objectContaining({
            parents: expect.objectContaining({
              some: expect.objectContaining({
                parent: expect.objectContaining({
                  OR: [
                    { id: "the-story" },
                    { coreId: "the-story" },
                    { slug: "the-story" },
                  ],
                }),
              }),
            }),
          }),
          expect.objectContaining({
            dubs: expect.objectContaining({
              some: expect.objectContaining({ deletedAt: null }),
            }),
          }),
        ]),
      )
    })
  })

  describe("getById", () => {
    it("returns the matching non-deleted row", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({ id: "v-1" })

      const result = await service.getById({ id: "v-1", query: {} })

      expect(result).toEqual({ id: "v-1" })
      expect(prisma.video.findFirst.mock.calls[0][0].where).toHaveProperty(
        "deletedAt",
        null,
      )
    })
  })

  describe("getBySlug", () => {
    it("returns the matching non-deleted row", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({ id: "v-1", slug: "jf" })

      const result = await service.getBySlug({ slug: "jf", query: {} })

      expect(result).toEqual({ id: "v-1", slug: "jf" })
    })
  })

  describe("getDubById", () => {
    it("returns the matching dub", async () => {
      prisma.videoDub.findFirst.mockResolvedValueOnce({ id: "dub-1" })

      const result = await service.getDubById({ id: "dub-1", query: {} })

      expect(result).toEqual({ id: "dub-1" })
    })

    // NOTE: this asserts the WHERE-clause SHAPE the resolver hands Prisma — the
    // dub itself and its parent video must both be non-deleted, mirroring what
    // `videoBySlug { dubs }` exposes. A mock cannot prove Prisma actually emits
    // the parent-video relation filter in SQL (the mocked-vs-real-contract gap);
    // that negative case (live dub under a soft-deleted video -> null) was
    // verified empirically against a real DB during review. There is no real-DB
    // integration harness in CI, so getBySlug/getById are gated the same way.
    it("gates on the dub id AND both the dub and its parent video being non-deleted", async () => {
      prisma.videoDub.findFirst.mockResolvedValueOnce(null)

      await service.getDubById({ id: "dub-1", query: {} })

      const where = prisma.videoDub.findFirst.mock.calls[0][0].where
      expect(where.id).toBe("dub-1")
      expect(where).toHaveProperty("deletedAt", null)
      expect(where.video).toEqual({ deletedAt: null })
    })

    it("threads the resolver's prisma query selection through", async () => {
      prisma.videoDub.findFirst.mockResolvedValueOnce({ id: "dub-1" })
      const query = { include: { downloads: true } }

      await service.getDubById({ id: "dub-1", query })

      expect(prisma.videoDub.findFirst.mock.calls[0][0]).toMatchObject(query)
    })
  })

  describe("getPreferredPlayableDub", () => {
    it("prefers a playable dub matching the requested language slug", async () => {
      prisma.videoDub.findFirst.mockResolvedValueOnce({ id: "dub-es" })

      const result = await service.getPreferredPlayableDub({
        videoId: "video-1",
        languageSlug: "spanish",
        query: { select: { id: true } },
      })

      expect(result).toEqual({ id: "dub-es" })
      const call = prisma.videoDub.findFirst.mock.calls[0][0]
      expect(call).toMatchObject({ select: { id: true } })
      expect(call.where).toMatchObject({
        videoId: "video-1",
        deletedAt: null,
        published: true,
        AND: [{ hls: { not: null } }, { hls: { not: "" } }],
        video: { deletedAt: null },
        language: {
          deletedAt: null,
          OR: [{ slug: "spanish" }, { bcp47: "spanish" }],
        },
      })
      expect(call.orderBy).toEqual([{ duration: "desc" }, { id: "asc" }])
      expect(prisma.video.findFirst).not.toHaveBeenCalled()
    })

    it("falls back to the primary language playable dub before longest playable", async () => {
      prisma.videoDub.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "dub-primary" })
      prisma.video.findFirst.mockResolvedValueOnce({
        primaryLanguageId: "language-en",
      })

      const result = await service.getPreferredPlayableDub({
        videoId: "video-1",
        languageSlug: "missing-language",
        query: {},
      })

      expect(result).toEqual({ id: "dub-primary" })
      expect(prisma.video.findFirst.mock.calls[0][0]).toEqual({
        where: { id: "video-1", deletedAt: null },
        select: { primaryLanguageId: true },
      })
      expect(prisma.videoDub.findFirst.mock.calls[1][0].where).toMatchObject({
        videoId: "video-1",
        languageId: "language-en",
        deletedAt: null,
        published: true,
        AND: [{ hls: { not: null } }, { hls: { not: "" } }],
      })
      expect(prisma.videoDub.findFirst).toHaveBeenCalledTimes(2)
    })

    it("falls back to the longest playable dub when no requested or primary dub exists", async () => {
      prisma.videoDub.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "dub-longest" })
      prisma.video.findFirst.mockResolvedValueOnce({
        primaryLanguageId: "language-en",
      })

      const result = await service.getPreferredPlayableDub({
        videoId: "video-1",
        languageSlug: "missing-language",
        query: {},
      })

      expect(result).toEqual({ id: "dub-longest" })
      const fallbackCall = prisma.videoDub.findFirst.mock.calls[2][0]
      expect(fallbackCall.where).toMatchObject({
        videoId: "video-1",
        deletedAt: null,
        published: true,
        AND: [{ hls: { not: null } }, { hls: { not: "" } }],
      })
      expect(fallbackCall.orderBy).toEqual([
        { duration: "desc" },
        { id: "asc" },
      ])
    })
  })

  describe("countPlayableDubLanguages", () => {
    it("counts distinct playable dub languages without loading dub payloads", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([
        { languageId: "language-en" },
        { languageId: "language-es" },
      ])

      const count = await service.countPlayableDubLanguages({
        videoId: "video-1",
      })

      expect(count).toBe(2)
      const call = prisma.videoDub.findMany.mock.calls[0][0]
      expect(call.where).toMatchObject({
        videoId: "video-1",
        deletedAt: null,
        published: true,
        AND: [{ hls: { not: null } }, { hls: { not: "" } }],
        video: { deletedAt: null },
        languageId: { not: null },
        language: { slug: { not: null }, deletedAt: null },
      })
      expect(call.distinct).toEqual(["languageId"])
      expect(call.select).toEqual({ languageId: true })
    })
  })

  describe("getByCoreId", () => {
    it("VIEWER can get by coreId", async () => {
      prisma.video.findFirst.mockResolvedValueOnce({
        id: "v-1",
        coreId: "core-1",
      })

      await service.getByCoreId({
        coreId: "core-1",
        user: VIEWER,
        query: {},
      })

      expect(prisma.video.findFirst.mock.calls[0][0].where).toHaveProperty(
        "coreId",
        "core-1",
      )
    })

    it("PUBLIC cannot get by coreId (Core sync internal — auth wall stays at the service)", async () => {
      await expect(
        service.getByCoreId({
          coreId: "core-1",
          user: PUBLIC_USER,
          query: {},
        }),
      ).rejects.toThrow("Forbidden")
    })
  })

  describe("getByCoreIds (feat-125 manager admin-trigger lookup)", () => {
    it("returns dispatch fields for a fully-populated video", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([rowFixture()])

      const result = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(result).toEqual([
        {
          id: "v-1",
          coreId: "core-1",
          label: "featureFilm",
          targetLocale: null,
          primaryLanguageBcp47: "en",
          languageBcp47: "en",
          muxAssetId: "mux-asset-en",
          subtitleUrl: "https://example.com/en.vtt",
        },
      ])
    })

    it("uses one targeted raw SQL projection instead of loading relation graphs", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([])

      await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(prisma.video.findMany).not.toHaveBeenCalled()
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
      expect(prisma.tx.$queryRaw).toHaveBeenCalledOnce()
      const sql = prisma.tx.$queryRaw.mock.calls[0][0].join(" ")
      expect(sql).toContain("LEFT JOIN LATERAL")
      expect(sql).toContain("video_dub")
      expect(sql).toContain("video_subtitle")
      expect(sql).toContain("primary_language.deleted_at IS NULL")
      expect(sql).toContain("dub.deleted_at IS NULL")
      expect(sql).toContain("mux_video.deleted_at IS NULL")
      expect(sql).toContain("subtitle.deleted_at IS NULL")
      expect(sql).toContain("v.deleted_at IS NULL")
    })

    it("resolves requested localized dispatch media instead of the primary-language source", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({
          targetLocale: "es",
          primaryLanguageBcp47: "en",
          languageBcp47: "es",
          muxAssetId: "mux-asset-es",
          subtitleUrl: "https://example.com/es.vtt",
        }),
      ])

      const [row] = await service.getByCoreIds({
        coreIds: ["core-1"],
        targetLocale: "es",
      })

      expect(row).toEqual(
        expect.objectContaining({
          targetLocale: "es",
          primaryLanguageBcp47: "en",
          languageBcp47: "es",
          muxAssetId: "mux-asset-es",
          subtitleUrl: "https://example.com/es.vtt",
        }),
      )
      const sql = prisma.tx.$queryRaw.mock.calls[0][0].join(" ")
      expect(sql).toContain("requested_language")
      expect(sql).toContain("selected_mux.asset_id")
      expect(sql).toContain("selected_subtitle.vtt_src")
    })

    it("sets a transaction-local statement timeout below manager's admin lookup timeout", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([])

      await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 9000,
      })
      expect(prisma.tx.$executeRawUnsafe).toHaveBeenCalledWith(
        "SET LOCAL statement_timeout = '8000ms'",
      )
    })

    it("returns empty array on empty input without Prisma round-trip", async () => {
      const result = await service.getByCoreIds({ coreIds: [] })

      expect(result).toEqual([])
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it("throws VideoLookupValidationError when coreIds exceeds cap", async () => {
      const tooMany = Array.from(
        { length: VIDEOS_BY_CORE_IDS_MAX + 1 },
        (_, i) => `core-${i}`,
      )

      await expect(
        service.getByCoreIds({ coreIds: tooMany }),
      ).rejects.toBeInstanceOf(VideoLookupValidationError)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it("returns null primaryLanguageBcp47 when video has no primary language", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({
          primaryLanguageBcp47: null,
          languageBcp47: null,
          muxAssetId: null,
          subtitleUrl: null,
        }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.primaryLanguageBcp47).toBeNull()
      expect(row.languageBcp47).toBeNull()
      expect(row.muxAssetId).toBeNull()
      expect(row.subtitleUrl).toBeNull()
    })

    it("returns null muxAssetId when no primary-language dub exists", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({ muxAssetId: null }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.muxAssetId).toBeNull()
    })

    it("returns null muxAssetId when primary-language dub has no muxVideo assetId", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({ muxAssetId: null }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.muxAssetId).toBeNull()
    })

    it("orders subtitle candidates by primary/non-AI score in SQL", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({ subtitleUrl: "https://example.com/en-primary.vtt" }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en-primary.vtt")
      const sql = prisma.tx.$queryRaw.mock.calls[0][0].join(" ")
      expect(sql).toContain("CASE WHEN subtitle.primary THEN 0 ELSE 1 END")
      expect(sql).toContain("CASE WHEN subtitle.ai_generated THEN 1 ELSE 0 END")
    })

    it("falls back to an AI subtitle when no non-AI primary-language subtitle exists", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({ subtitleUrl: "https://example.com/en-ai.vtt" }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en-ai.vtt")
    })

    it("returns null subtitleUrl when no primary-language subtitle exists", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({ subtitleUrl: null }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBeNull()
    })

    it("ignores subtitles with null vttSrc", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([rowFixture()])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en.vtt")
      const sql = prisma.tx.$queryRaw.mock.calls[0][0].join(" ")
      expect(sql).toContain("subtitle.vtt_src IS NOT NULL")
    })

    it("excludes a coreId from results when no matching video exists", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([rowFixture()])

      const result = await service.getByCoreIds({
        coreIds: ["core-1", "core-missing"],
      })

      expect(result).toHaveLength(1)
      expect(result[0]?.coreId).toBe("core-1")
    })

    it("accepts exactly VIDEOS_BY_CORE_IDS_MAX coreIds (boundary, should pass)", async () => {
      const exact = Array.from(
        { length: VIDEOS_BY_CORE_IDS_MAX },
        (_, i) => `core-${i}`,
      )
      prisma.tx.$queryRaw.mockResolvedValueOnce([])

      await expect(service.getByCoreIds({ coreIds: exact })).resolves.toEqual(
        [],
      )
      expect(prisma.tx.$queryRaw).toHaveBeenCalledOnce()
    })

    it("passes duplicate coreIds through to the raw SQL IN list (caller dedupe is upstream)", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([rowFixture()])

      const result = await service.getByCoreIds({
        coreIds: ["core-1", "core-1"],
      })

      expect(result).toHaveLength(1)
      const coreIdJoin = prisma.tx.$queryRaw.mock.calls[0].find(
        (value: unknown) =>
          typeof value === "object" &&
          value !== null &&
          "values" in value &&
          Array.isArray((value as { values?: unknown }).values),
      ) as { values: string[] }
      expect(coreIdJoin.values).toEqual(["core-1", "core-1"])
    })

    it("normalizes empty-string vttSrc as missing (parity with null vttSrc)", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({ subtitleUrl: null }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBeNull()
    })

    it("normalizes empty-string muxVideo.assetId as missing (parity with null assetId)", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({ muxAssetId: null }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.muxAssetId).toBeNull()
    })

    it("converts uppercase VideoLabel enum to camelCase wire shape", async () => {
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        rowFixture({ label: "FEATURE_FILM" }),
        { ...rowFixture({ coreId: "core-2" }), label: "BEHIND_THE_SCENES" },
      ])

      const result = await service.getByCoreIds({
        coreIds: ["core-1", "core-2"],
      })

      expect(result[0]?.label).toBe("featureFilm")
      expect(result[1]?.label).toBe("behindTheScenes")
    })

    it("passes already-camelCase label through unchanged (defensive — guards future Prisma config drift)", async () => {
      // If a future Prisma config change ever surfaces the
      // DB-stored camelCase value directly, the normalizer must
      // NOT silently lowercase it (`featureFilm` -> `featurefilm`
      // would corrupt the wire shape).
      prisma.tx.$queryRaw.mockResolvedValueOnce([
        { ...rowFixture(), label: "featureFilm" },
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.label).toBe("featureFilm")
    })

    it("logs a sanitized failure breadcrumb when the lookup throws", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const error = Object.assign(new Error("canceling statement"), {
        code: "P2010",
      })
      prisma.tx.$queryRaw.mockRejectedValueOnce(error)

      await expect(service.getByCoreIds({ coreIds: ["core-1"] })).rejects.toBe(
        error,
      )

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("event=lookup.failed"),
      )
      const message = warn.mock.calls[0][0]
      expect(message).toContain("coreIdCount=1")
      expect(message).toContain("errorName=Error")
      expect(message).toContain("errorCode=P2010")
      expect(message).not.toContain("core-1")
      expect(message).not.toContain("canceling statement")

      warn.mockRestore()
    })

    it("logs slow lookup phase timings without coreIds or secrets", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const now = vi
        .spyOn(Date, "now")
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(20)
        .mockReturnValueOnce(820)
        .mockReturnValueOnce(820)
        .mockReturnValueOnce(900)
      prisma.tx.$queryRaw.mockResolvedValueOnce([rowFixture()])

      await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("event=lookup.slow"),
      )
      const message = warn.mock.calls[0][0]
      expect(message).toContain("coreIdCount=1")
      expect(message).toContain("rowCount=1")
      expect(message).toMatch(/durationMs=\d+/)
      expect(message).toMatch(/transactionDurationMs=\d+/)
      expect(message).toMatch(/sqlDurationMs=\d+/)
      expect(message).not.toContain("core-1")
      expect(message).not.toContain("Bearer ")
      expect(message).not.toContain("DATABASE_URL")

      now.mockRestore()
      warn.mockRestore()
    })
  })

  describe("getWatchHomeVideos", () => {
    it("returns videos in caller order, omits unknown ids, and preserves duplicates", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        { id: "video-2", coreId: "core-2" },
        { id: "video-1", coreId: "core-1" },
      ])

      const result = await service.getWatchHomeVideos({
        coreIds: ["core-1", "core-missing", "core-2", "core-1"],
        query: { include: { images: true } },
      })

      expect(result.map((row) => row.coreId)).toEqual([
        "core-1",
        "core-2",
        "core-1",
      ])
      expect(prisma.video.findMany).toHaveBeenCalledWith({
        include: { images: true },
        where: {
          coreId: { in: ["core-1", "core-missing", "core-2"] },
          deletedAt: null,
        },
      })
    })

    it("returns empty array on empty input without Prisma round-trip", async () => {
      const result = await service.getWatchHomeVideos({
        coreIds: [],
        query: {},
      })

      expect(result).toEqual([])
      expect(prisma.video.findMany).not.toHaveBeenCalled()
    })

    it("forces coreId into select-shaped queries so caller ordering stays stable", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        { id: "video-1", coreId: "core-1" },
      ])

      await service.getWatchHomeVideos({
        coreIds: ["core-1"],
        query: { select: { id: true } },
      })

      expect(prisma.video.findMany).toHaveBeenCalledWith({
        select: { id: true, coreId: true },
        where: {
          coreId: { in: ["core-1"] },
          deletedAt: null,
        },
      })
    })

    it("throws VideoLookupValidationError when coreIds exceeds cap", async () => {
      const tooMany = Array.from(
        { length: VIDEOS_BY_CORE_IDS_MAX + 1 },
        (_, i) => `core-${i}`,
      )

      await expect(
        service.getWatchHomeVideos({ coreIds: tooMany, query: {} }),
      ).rejects.toBeInstanceOf(VideoLookupValidationError)
      expect(prisma.video.findMany).not.toHaveBeenCalled()
    })
  })

  describe("getChildDubLanguages", () => {
    it("queries playable dubs of the video's children, deduped by language for DISTINCT ON", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([])

      await service.getChildDubLanguages({ videoId: "series-1", user: VIEWER })

      const call = prisma.videoDub.findMany.mock.calls[0][0]
      // Playable predicate — must match apps/web's isPlayableLanguageVariant.
      expect(call.where).toMatchObject({
        deletedAt: null,
        published: true,
        hls: { not: null },
        languageId: { not: null },
        language: { slug: { not: null }, deletedAt: null },
      })
      // Children of `videoId`: this dub's video sits on the child side of a
      // VideoRelation whose parent is the requested video.
      expect(call.where.video.parents).toEqual({
        some: { parentId: "series-1" },
      })
      // DISTINCT ON (language_id) — one row per language; which dub wins is
      // irrelevant since only the (shared) language fields are projected.
      expect(call.distinct).toEqual(["languageId"])
      expect(call.orderBy).toEqual([{ languageId: "asc" }])
      // Only the language display fields are selected — no dub id/hls/duration.
      expect(call.select).toEqual({
        language: { select: { slug: true, name: true, bcp47: true } },
      })
    })

    it("restricts children to PUBLISHED-locale rows for a consumer/anonymous caller", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([])

      await service.getChildDubLanguages({
        videoId: "series-1",
        user: PUBLIC_USER,
      })

      const call = prisma.videoDub.findMany.mock.calls[0][0]
      expect(call.where.video).toMatchObject({
        deletedAt: null,
        locales: { some: { status: "PUBLISHED" } },
      })
    })

    it("does NOT gate children on a published locale for an EDITOR/ADMIN caller", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([])

      await service.getChildDubLanguages({ videoId: "series-1", user: EDITOR })

      const call = prisma.videoDub.findMany.mock.calls[0][0]
      expect(call.where.video.deletedAt).toBeNull()
      expect(call.where.video.locales).toBeUndefined()
    })

    it("flattens each distinct dub's language into the minimal picker shape", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([
        {
          language: { slug: "english", name: { en: "English" }, bcp47: "en" },
        },
        {
          language: { slug: "spanish", name: { en: "Spanish" }, bcp47: "es" },
        },
      ])

      const result = await service.getChildDubLanguages({
        videoId: "series-1",
        user: VIEWER,
      })

      expect(result).toEqual([
        { slug: "english", name: { en: "English" }, bcp47: "en" },
        { slug: "spanish", name: { en: "Spanish" }, bcp47: "es" },
      ])
    })

    it("surfaces null fields rather than throwing when a row's language is absent", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([{ language: null }])

      const [row] = await service.getChildDubLanguages({
        videoId: "series-1",
        user: VIEWER,
      })

      expect(row).toEqual({ slug: null, name: null, bcp47: null })
    })

    it("returns an empty array when the video has no playable child dubs", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([])

      const result = await service.getChildDubLanguages({
        videoId: "leaf-video",
        user: VIEWER,
      })

      expect(result).toEqual([])
    })
  })

  describe("getDownloadableChildDubs", () => {
    it("queries one downloadable Dub per visible direct child in the exact language", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([])

      await service.getDownloadableChildDubs({
        videoId: "series-1",
        languageSlug: "english",
        user: VIEWER,
        query: { include: { downloads: true } },
      })

      const call = prisma.videoDub.findMany.mock.calls[0][0]
      expect(call).toMatchObject({
        include: { downloads: true },
        where: {
          deletedAt: null,
          published: true,
          downloadable: true,
          language: { slug: "english", deletedAt: null },
          downloads: {
            some: {
              deletedAt: null,
              quality: { not: null },
              url: { not: null },
            },
          },
          video: {
            deletedAt: null,
            locales: { some: { status: "PUBLISHED", deletedAt: null } },
            parents: { some: { parentId: "series-1" } },
          },
        },
        distinct: ["videoId"],
        orderBy: [{ videoId: "asc" }, { duration: "desc" }, { id: "asc" }],
      })
    })

    it("does not require a published child locale for editors", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([])

      await service.getDownloadableChildDubs({
        videoId: "series-1",
        languageSlug: "english",
        user: EDITOR,
        query: {},
      })

      const call = prisma.videoDub.findMany.mock.calls[0][0]
      expect(call.where.video.deletedAt).toBeNull()
      expect(call.where.video.locales).toBeUndefined()
    })

    it("returns the selected Dub rows unchanged", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([
        { id: "dub-1", videoId: "episode-1" },
        { id: "dub-2", videoId: "episode-2" },
      ])

      await expect(
        service.getDownloadableChildDubs({
          videoId: "series-1",
          languageSlug: "english",
          user: VIEWER,
          query: {},
        }),
      ).resolves.toEqual([
        { id: "dub-1", videoId: "episode-1" },
        { id: "dub-2", videoId: "episode-2" },
      ])
    })
  })
})
