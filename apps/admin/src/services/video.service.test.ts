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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

type Row = {
  id: string
  coreId: string
  label: string | null
  primaryLanguage: { bcp47: string } | null
  dubs: Array<{
    language: { bcp47: string } | null
    muxVideo: { assetId: string | null } | null
  }>
  subtitles: Array<{
    language: { bcp47: string } | null
    vttSrc: string | null
    primary: boolean
    aiGenerated: boolean
  }>
}

function rowFixture(overrides: Partial<Row> = {}): Row {
  return {
    id: "v-1",
    coreId: "core-1",
    label: "feature_film",
    primaryLanguage: { bcp47: "en" },
    dubs: [
      {
        language: { bcp47: "en" },
        muxVideo: { assetId: "mux-asset-en" },
      },
    ],
    subtitles: [
      {
        language: { bcp47: "en" },
        vttSrc: "https://example.com/en.vtt",
        primary: true,
        aiGenerated: false,
      },
    ],
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
      prisma.video.findMany.mockResolvedValueOnce([rowFixture()])

      const result = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(result).toEqual([
        {
          id: "v-1",
          coreId: "core-1",
          label: "feature_film",
          primaryLanguageBcp47: "en",
          muxAssetId: "mux-asset-en",
          subtitleUrl: "https://example.com/en.vtt",
        },
      ])
    })

    it("filters out soft-deleted videos via where clause", async () => {
      prisma.video.findMany.mockResolvedValueOnce([])

      await service.getByCoreIds({ coreIds: ["core-1"] })

      const call = prisma.video.findMany.mock.calls[0][0]
      expect(call.where).toMatchObject({
        coreId: { in: ["core-1"] },
        deletedAt: null,
      })
    })

    it("returns empty array on empty input without Prisma round-trip", async () => {
      const result = await service.getByCoreIds({ coreIds: [] })

      expect(result).toEqual([])
      expect(prisma.video.findMany).not.toHaveBeenCalled()
    })

    it("throws VideoLookupValidationError when coreIds exceeds cap", async () => {
      const tooMany = Array.from(
        { length: VIDEOS_BY_CORE_IDS_MAX + 1 },
        (_, i) => `core-${i}`,
      )

      await expect(
        service.getByCoreIds({ coreIds: tooMany }),
      ).rejects.toBeInstanceOf(VideoLookupValidationError)
      expect(prisma.video.findMany).not.toHaveBeenCalled()
    })

    it("returns null primaryLanguageBcp47 when video has no primary language", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        rowFixture({ primaryLanguage: null }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.primaryLanguageBcp47).toBeNull()
      expect(row.muxAssetId).toBeNull()
      expect(row.subtitleUrl).toBeNull()
    })

    it("returns null muxAssetId when no primary-language dub exists", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        rowFixture({
          dubs: [
            {
              language: { bcp47: "es" },
              muxVideo: { assetId: "mux-asset-es" },
            },
          ],
        }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.muxAssetId).toBeNull()
    })

    it("returns null muxAssetId when primary-language dub has no muxVideo assetId", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        rowFixture({
          dubs: [
            {
              language: { bcp47: "en" },
              muxVideo: { assetId: null },
            },
          ],
        }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.muxAssetId).toBeNull()
    })

    it("prefers primary non-AI subtitle when multiple primary-language candidates exist", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        rowFixture({
          subtitles: [
            {
              language: { bcp47: "en" },
              vttSrc: "https://example.com/en-ai.vtt",
              primary: false,
              aiGenerated: true,
            },
            {
              language: { bcp47: "en" },
              vttSrc: "https://example.com/en-primary.vtt",
              primary: true,
              aiGenerated: false,
            },
            {
              language: { bcp47: "en" },
              vttSrc: "https://example.com/en-secondary.vtt",
              primary: false,
              aiGenerated: false,
            },
          ],
        }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en-primary.vtt")
    })

    it("falls back to an AI subtitle when no non-AI primary-language subtitle exists", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        rowFixture({
          subtitles: [
            {
              language: { bcp47: "en" },
              vttSrc: "https://example.com/en-ai.vtt",
              primary: false,
              aiGenerated: true,
            },
          ],
        }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en-ai.vtt")
    })

    it("returns null subtitleUrl when no primary-language subtitle exists", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        rowFixture({
          subtitles: [
            {
              language: { bcp47: "es" },
              vttSrc: "https://example.com/es.vtt",
              primary: true,
              aiGenerated: false,
            },
          ],
        }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBeNull()
    })

    it("ignores subtitles with null vttSrc", async () => {
      prisma.video.findMany.mockResolvedValueOnce([
        rowFixture({
          subtitles: [
            {
              language: { bcp47: "en" },
              vttSrc: null,
              primary: true,
              aiGenerated: false,
            },
            {
              language: { bcp47: "en" },
              vttSrc: "https://example.com/en.vtt",
              primary: false,
              aiGenerated: false,
            },
          ],
        }),
      ])

      const [row] = await service.getByCoreIds({ coreIds: ["core-1"] })

      expect(row.subtitleUrl).toBe("https://example.com/en.vtt")
    })

    it("excludes a coreId from results when no matching video exists", async () => {
      prisma.video.findMany.mockResolvedValueOnce([rowFixture()])

      const result = await service.getByCoreIds({
        coreIds: ["core-1", "core-missing"],
      })

      expect(result).toHaveLength(1)
      expect(result[0]?.coreId).toBe("core-1")
    })
  })
})
