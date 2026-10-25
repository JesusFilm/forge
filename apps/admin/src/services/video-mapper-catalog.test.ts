import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import {
  VIDEO_MAPPER_CATALOG_MAX_PAGE_SIZE,
  VIDEO_MAPPER_CATALOG_NON_INDEXABLE_REASONS,
  VideoLookupValidationError,
  VideoService,
  type VideoMapperCatalogItem,
} from "./video.service"

type MockPrisma = {
  video: { findMany: ReturnType<typeof vi.fn> }
  videoDub: {
    findMany: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
  }
  $executeRawUnsafe: ReturnType<typeof vi.fn>
  $queryRaw: ReturnType<typeof vi.fn>
  $transaction: ReturnType<typeof vi.fn>
}
type TransactionCallback = (tx: MockPrisma) => unknown | Promise<unknown>

function mockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    video: {
      findMany: vi.fn(),
    },
    videoDub: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(
      async (callback: TransactionCallback, _options: unknown) =>
        callback(prisma),
    ),
  }
  return prisma
}

function catalogRow(
  overrides: Partial<VideoMapperCatalogItem> = {},
): VideoMapperCatalogItem {
  return {
    coreId: "core-video-1",
    sourceTitle: "JESUS",
    sourceTitleLocale: "en",
    videoVariantId: "variant-en",
    adminVideoId: "admin-video-1",
    adminDubId: "dub-1",
    languageId: "lang-core-en",
    languageSlug: "english",
    locale: "en",
    editionCoreId: "edition-core-1",
    editionName: "Standard",
    durationSeconds: 7200,
    lengthInMilliseconds: "7200000",
    hlsUrl: "https://cdn.example.com/variant-en.m3u8",
    dashUrl: null,
    shareUrl: "https://watch.example.com/variant-en",
    downloadUrl: "https://cdn.example.com/variant-en-1080.mp4",
    downloadQuality: "1080p",
    downloadWidth: 1920,
    downloadHeight: 1080,
    mediaSourceType: "DOWNLOAD",
    mediaSourceUrl: "https://cdn.example.com/variant-en-1080.mp4",
    videoPublished: true,
    dubPublished: true,
    videoNoIndex: false,
    videoDeleted: false,
    dubDeleted: false,
    deletedAt: null,
    indexable: true,
    nonIndexableReason: null,
    ...overrides,
  }
}

describe("VideoService.listMapperCatalogVariants", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: VideoService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new VideoService(prisma as unknown as PrismaClient)
  })

  it("returns a bounded page with cursors and mapper-required fields", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      catalogRow({ adminDubId: "dub-1", videoVariantId: "variant-en" }),
      catalogRow({
        adminDubId: "dub-2",
        videoVariantId: "variant-es",
        languageId: "lang-core-es",
        languageSlug: "spanish",
        locale: "es",
        mediaSourceType: "HLS",
        mediaSourceUrl: "https://cdn.example.com/variant-es.m3u8",
        downloadUrl: null,
      }),
      catalogRow({ adminDubId: "dub-3", videoVariantId: "variant-fr" }),
    ])

    const result = await service.listMapperCatalogVariants({ first: 2 })

    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0]).toMatchObject({
      coreId: "core-video-1",
      sourceTitle: "JESUS",
      sourceTitleLocale: "en",
      videoVariantId: "variant-en",
      adminVideoId: "admin-video-1",
      adminDubId: "dub-1",
      languageId: "lang-core-en",
      languageSlug: "english",
      locale: "en",
      editionCoreId: "edition-core-1",
      durationSeconds: 7200,
      lengthInMilliseconds: "7200000",
      hlsUrl: "https://cdn.example.com/variant-en.m3u8",
      downloadUrl: "https://cdn.example.com/variant-en-1080.mp4",
      mediaSourceType: "DOWNLOAD",
      mediaSourceUrl: "https://cdn.example.com/variant-en-1080.mp4",
      videoPublished: true,
      dubPublished: true,
      videoNoIndex: false,
      videoDeleted: false,
      dubDeleted: false,
      indexable: true,
      nonIndexableReason: null,
    })
    expect(result.pageInfo.hasNextPage).toBe(true)
    expect(result.pageInfo.startCursor).toEqual(expect.any(String))
    expect(result.pageInfo.endCursor).toEqual(expect.any(String))
    expect(result.pageInfo.endCursor).not.toBe(result.pageInfo.startCursor)
  })

  it("uses the end cursor as the stable VideoDub.id lower bound", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([catalogRow({ adminDubId: "dub-1" })])
      .mockResolvedValueOnce([catalogRow({ adminDubId: "dub-2" })])

    const firstPage = await service.listMapperCatalogVariants({ first: 1 })
    prisma.videoDub.findUnique.mockResolvedValueOnce({ id: "dub-1" })
    await service.listMapperCatalogVariants({
      first: 1,
      after: firstPage.pageInfo.endCursor,
    })

    expect(prisma.videoDub.findUnique).toHaveBeenCalledWith({
      where: { id: "dub-1" },
      select: { id: true },
    })
    const secondCall = prisma.$queryRaw.mock.calls[1]
    const cursorFilter = secondCall[1] as {
      sql: string
      values: readonly unknown[]
    }
    expect(cursorFilter.sql).toContain("WHERE d.id >")
    expect(cursorFilter.sql).not.toContain("::text IS NULL OR")
    expect(cursorFilter.values).toEqual(["dub-1"])
  })

  it("returns null cursors and no next page for an empty page", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    const result = await service.listMapperCatalogVariants({ first: 2 })

    expect(result.nodes).toEqual([])
    expect(result.pageInfo).toEqual({
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
    })
  })

  it("returns final-page cursors without hasNextPage for exact-size pages", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      catalogRow({ adminDubId: "dub-1" }),
      catalogRow({ adminDubId: "dub-2" }),
    ])

    const result = await service.listMapperCatalogVariants({ first: 2 })

    expect(result.nodes.map((node) => node.adminDubId)).toEqual([
      "dub-1",
      "dub-2",
    ])
    expect(result.pageInfo.startCursor).toEqual(expect.any(String))
    expect(result.pageInfo.endCursor).toEqual(expect.any(String))
    expect(result.pageInfo.hasNextPage).toBe(false)
  })

  it("clamps requested page size to the broad-sync maximum", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await service.listMapperCatalogVariants({
      first: VIDEO_MAPPER_CATALOG_MAX_PAGE_SIZE + 500,
    })

    const call = prisma.$queryRaw.mock.calls[0]
    expect(call[call.length - 1]).toBe(VIDEO_MAPPER_CATALOG_MAX_PAGE_SIZE + 1)
  })

  it("rejects invalid page sizes before querying", async () => {
    await expect(
      service.listMapperCatalogVariants({ first: 0 }),
    ).rejects.toBeInstanceOf(VideoLookupValidationError)
    await expect(
      service.listMapperCatalogVariants({ first: -1 }),
    ).rejects.toBeInstanceOf(VideoLookupValidationError)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("rejects invalid cursors before querying", async () => {
    await expect(
      service.listMapperCatalogVariants({ after: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(VideoLookupValidationError)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("rejects well-formed cursors that do not match a VideoDub", async () => {
    const unknownCursor = Buffer.from(
      "video-dub:dub-does-not-exist",
      "utf8",
    ).toString("base64url")
    prisma.videoDub.findUnique.mockResolvedValueOnce(null)

    await expect(
      service.listMapperCatalogVariants({ after: unknownCursor }),
    ).rejects.toBeInstanceOf(VideoLookupValidationError)

    expect(prisma.videoDub.findUnique).toHaveBeenCalledWith({
      where: { id: "dub-does-not-exist" },
      select: { id: true },
    })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("uses one flat SQL projection instead of loading nested video relations", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await service.listMapperCatalogVariants({ first: 5 })

    expect(prisma.video.findMany).not.toHaveBeenCalled()
    expect(prisma.videoDub.findMany).not.toHaveBeenCalled()
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      "SET LOCAL statement_timeout = '10000ms'",
    )
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: 11_000 }),
    )
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    const sql = prisma.$queryRaw.mock.calls[0][0].join(" ")
    expect(sql).toContain("WITH paged_dubs AS")
    expect(sql).toContain("paged_video_ids AS")
    expect(sql).toContain("published_state_by_video AS")
    expect(sql).toContain("selected_title_by_video AS")
    expect(sql).toContain("FROM video_dub d")
    expect(sql).toContain("ORDER BY d.id ASC")
    expect(sql).toContain("LEFT JOIN LATERAL")
    expect(sql).toContain("FROM video_locale locale")
    expect(sql).toContain("FROM video_dub_download download")
    expect(sql).toContain("AND d.downloadable = TRUE")
    expect(sql).toContain("AND download.url ~* '^https?://'")
    expect(sql).toContain("LIMIT")
    expect(sql).not.toContain("::text IS NULL OR")
    for (const reason of VIDEO_MAPPER_CATALOG_NON_INDEXABLE_REASONS) {
      expect(sql).toContain(`THEN '${reason}'`)
    }
  })
})
