import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import {
  VideoService,
  VideoLookupValidationError,
  VIDEOS_BY_CORE_IDS_MAX,
} from "./video.service"

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
})
