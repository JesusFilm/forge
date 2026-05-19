import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import {
  VideoService,
  VideoLookupValidationError,
  VIDEOS_BY_CORE_IDS_MAX,
} from "./video.service"

function mockPrisma() {
  return {
    video: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

type Row = {
  id: string
  coreId: string
  label: string | null
  primaryLanguageBcp47: string | null
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
    primaryLanguageBcp47: "en",
    muxAssetId: "mux-asset-en",
    subtitleUrl: "https://example.com/en.vtt",
    ...overrides,
  }
}

const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
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
      prisma.$queryRaw.mockResolvedValueOnce([rowFixture()])

      const result = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(result).toEqual([
        {
          id: "v-1",
          coreId: "core-1",
          label: "featureFilm",
          primaryLanguageBcp47: "en",
          muxAssetId: "mux-asset-en",
          subtitleUrl: "https://example.com/en.vtt",
        },
      ])
    })

    it("uses one targeted raw SQL projection instead of loading relation graphs", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([])

      await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(prisma.video.findMany).not.toHaveBeenCalled()
      expect(prisma.$queryRaw).toHaveBeenCalledOnce()
      const sql = prisma.$queryRaw.mock.calls[0][0].join(" ")
      expect(sql).toContain("LEFT JOIN LATERAL")
      expect(sql).toContain("video_dub")
      expect(sql).toContain("video_subtitle")
      expect(sql).toContain("primary_language.deleted_at IS NULL")
      expect(sql).toContain("dub.deleted_at IS NULL")
      expect(sql).toContain("mux_video.deleted_at IS NULL")
      expect(sql).toContain("subtitle.deleted_at IS NULL")
      expect(sql).toContain("v.deleted_at IS NULL")
    })

    it("returns empty array on empty input without Prisma round-trip", async () => {
      const result = await service.getByCoreIds({ coreIds: [] })

      expect(result).toEqual([])
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it("throws VideoLookupValidationError when coreIds exceeds cap", async () => {
      const tooMany = Array.from(
        { length: VIDEOS_BY_CORE_IDS_MAX + 1 },
        (_, i) => `core-${i}`,
      )

      await expect(
        service.getByCoreIds({ coreIds: tooMany }),
      ).rejects.toBeInstanceOf(VideoLookupValidationError)
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it("returns null primaryLanguageBcp47 when video has no primary language", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        rowFixture({
          primaryLanguageBcp47: null,
          muxAssetId: null,
          subtitleUrl: null,
        }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.primaryLanguageBcp47).toBeNull()
      expect(row.muxAssetId).toBeNull()
      expect(row.subtitleUrl).toBeNull()
    })

    it("returns null muxAssetId when no primary-language dub exists", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([rowFixture({ muxAssetId: null })])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.muxAssetId).toBeNull()
    })

    it("returns null muxAssetId when primary-language dub has no muxVideo assetId", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([rowFixture({ muxAssetId: null })])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.muxAssetId).toBeNull()
    })

    it("orders subtitle candidates by primary/non-AI score in SQL", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        rowFixture({ subtitleUrl: "https://example.com/en-primary.vtt" }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en-primary.vtt")
      const sql = prisma.$queryRaw.mock.calls[0][0].join(" ")
      expect(sql).toContain("CASE WHEN subtitle.primary THEN 0 ELSE 1 END")
      expect(sql).toContain("CASE WHEN subtitle.ai_generated THEN 1 ELSE 0 END")
    })

    it("falls back to an AI subtitle when no non-AI primary-language subtitle exists", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        rowFixture({ subtitleUrl: "https://example.com/en-ai.vtt" }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en-ai.vtt")
    })

    it("returns null subtitleUrl when no primary-language subtitle exists", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        rowFixture({ subtitleUrl: null }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBeNull()
    })

    it("ignores subtitles with null vttSrc", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([rowFixture()])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en.vtt")
      const sql = prisma.$queryRaw.mock.calls[0][0].join(" ")
      expect(sql).toContain("subtitle.vtt_src IS NOT NULL")
    })

    it("excludes a coreId from results when no matching video exists", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([rowFixture()])

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
      prisma.$queryRaw.mockResolvedValueOnce([])

      await expect(service.getByCoreIds({ coreIds: exact })).resolves.toEqual(
        [],
      )
      expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    })

    it("passes duplicate coreIds through to the raw SQL IN list (caller dedupe is upstream)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([rowFixture()])

      const result = await service.getByCoreIds({
        coreIds: ["core-1", "core-1"],
      })

      expect(result).toHaveLength(1)
      const coreIdJoin = prisma.$queryRaw.mock.calls[0][1]
      expect(coreIdJoin.values).toEqual(["core-1", "core-1"])
    })

    it("normalizes empty-string vttSrc as missing (parity with null vttSrc)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        rowFixture({ subtitleUrl: null }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBeNull()
    })

    it("normalizes empty-string muxVideo.assetId as missing (parity with null assetId)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([rowFixture({ muxAssetId: null })])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.muxAssetId).toBeNull()
    })

    it("converts uppercase VideoLabel enum to camelCase wire shape", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
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
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...rowFixture(), label: "featureFilm" },
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.label).toBe("featureFilm")
    })
  })
})
