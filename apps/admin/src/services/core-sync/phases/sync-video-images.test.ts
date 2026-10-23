import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncVideoImages } from "./sync-video-images"

const mockedCoreQuery = vi.mocked(coreQuery)

describe("syncVideoImages", () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks): clearAllMocks only wipes call
    // history, not queued mockResolvedValueOnce implementations, so a test
    // whose mocked call count doesn't match its actual call count would
    // leak a queued response into the next test.
    vi.resetAllMocks()
  })

  it("syncs image rows from the nested Video.images field", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "video-core-1",
            images: [
              {
                id: "image-1",
                updatedAt: "2026-05-07T00:00:00.000Z",
                aspectRatio: "16:9",
                url: "https://example.com/image.jpg",
                mobileCinematicHigh: "high.jpg",
                mobileCinematicLow: "low.jpg",
                mobileCinematicVeryLow: "very-low.jpg",
                thumbnail: "thumb.jpg",
                videoStill: "still.jpg",
              },
            ],
          },
        ],
      },
    } as never)

    const tx = {
      videoImage: {
        upsert: vi.fn().mockResolvedValue({ id: "image-admin-1" }),
      },
    }
    const prisma = {
      video: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "video-admin-1", coreId: "video-core-1" }]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoImage: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideoImages({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(tx.videoImage.upsert).toHaveBeenCalledWith({
      where: { coreId: "image-1" },
      create: {
        coreId: "image-1",
        videoId: "video-admin-1",
        url: "https://example.com/image.jpg",
        aspectRatio: "16:9",
        mobileCinematicHigh: "high.jpg",
        mobileCinematicLow: "low.jpg",
        mobileCinematicVeryLow: "very-low.jpg",
        thumbnail: "thumb.jpg",
        videoStill: "still.jpg",
        syncedAt: expect.any(Date),
      },
      update: {
        videoId: "video-admin-1",
        url: "https://example.com/image.jpg",
        aspectRatio: "16:9",
        mobileCinematicHigh: "high.jpg",
        mobileCinematicLow: "low.jpg",
        mobileCinematicVeryLow: "very-low.jpg",
        thumbnail: "thumb.jpg",
        videoStill: "still.jpg",
        syncedAt: expect.any(Date),
        deletedAt: null,
      },
    })
    expect(prisma.videoImage.updateMany).toHaveBeenCalledWith({
      where: {
        source: "CORE",
        deletedAt: null,
        OR: [{ syncedAt: null }, { syncedAt: { lt: expect.any(Date) } }],
      },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("flattens multiple images per video — the load-bearing coverage fix", async () => {
    // The previous flat `videoImages` query returned at most one row per
    // video (and missed many videos entirely). The nested approach
    // surfaces every image attached to each video. This test pins the
    // flattening so a future refactor can't silently revert to per-video
    // first-image-only behavior.
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "video-core-1",
            images: [
              {
                id: "image-poster",
                updatedAt: "2026-05-07T00:00:00.000Z",
                aspectRatio: "16:9",
                url: "poster.jpg",
                mobileCinematicHigh: "poster-high.jpg",
                mobileCinematicLow: null,
                mobileCinematicVeryLow: null,
                thumbnail: null,
                videoStill: null,
              },
              {
                id: "image-still",
                updatedAt: "2026-05-07T00:00:00.000Z",
                aspectRatio: "16:9",
                url: "still.jpg",
                mobileCinematicHigh: null,
                mobileCinematicLow: null,
                mobileCinematicVeryLow: null,
                thumbnail: "still-thumb.jpg",
                videoStill: "still-full.jpg",
              },
            ],
          },
        ],
      },
    } as never)

    const tx = {
      videoImage: {
        upsert: vi.fn().mockResolvedValue({ id: "x" }),
      },
    }
    const prisma = {
      video: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "video-admin-1", coreId: "video-core-1" }]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoImage: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideoImages({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.updated).toBe(2)
    expect(tx.videoImage.upsert).toHaveBeenCalledTimes(2)
    const upsertedCoreIds = tx.videoImage.upsert.mock.calls.map(
      (call) => call[0].where.coreId,
    )
    expect(upsertedCoreIds.sort()).toEqual(["image-poster", "image-still"])
  })

  it("forwards incremental updatedAt watermarks and skips full soft-delete", async () => {
    mockedCoreQuery.mockResolvedValueOnce({ data: { videos: [] } })
    mockedCoreQuery.mockResolvedValueOnce({ data: { videoImages: [] } })
    const prisma = {
      video: { findMany: vi.fn().mockResolvedValue([]) },
      videoImage: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    await syncVideoImages({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-05-07T00:00:00.000Z",
    })

    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        where: { updatedAt: { gte: "2026-05-07T00:00:00.000Z" } },
      }),
    )
    expect(prisma.videoImage.updateMany).not.toHaveBeenCalled()
  })

  it("self-heals an image touched without its parent video also being touched (own-updatedAt pass)", async () => {
    // Simulates the FGE-77/#2122 gap: the nested walk (filtered by the
    // PARENT video's updatedAt) sees nothing this run, but the image was
    // touched in Core on its own. The supplementary flat `videoImages`
    // query (filtered by the image's OWN updatedAt) must still pick it up.
    mockedCoreQuery.mockResolvedValueOnce({ data: { videos: [] } })
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoImages: [
          {
            id: "image-touched-alone",
            updatedAt: "2026-05-08T00:00:00.000Z",
            videoId: "video-core-1",
            aspectRatio: "16:9",
            url: "https://example.com/updated.jpg",
            mobileCinematicHigh: null,
            mobileCinematicLow: null,
            mobileCinematicVeryLow: null,
            thumbnail: null,
            videoStill: null,
          },
        ],
      },
    })

    const tx = {
      videoImage: {
        upsert: vi.fn().mockResolvedValue({ id: "image-admin-1" }),
      },
    }
    const prisma = {
      video: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "video-admin-1", coreId: "video-core-1" }]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoImage: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideoImages({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-05-07T00:00:00.000Z",
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(tx.videoImage.upsert).toHaveBeenCalledWith({
      where: { coreId: "image-touched-alone" },
      create: {
        coreId: "image-touched-alone",
        videoId: "video-admin-1",
        url: "https://example.com/updated.jpg",
        aspectRatio: "16:9",
        mobileCinematicHigh: null,
        mobileCinematicLow: null,
        mobileCinematicVeryLow: null,
        thumbnail: null,
        videoStill: null,
        syncedAt: expect.any(Date),
      },
      update: {
        videoId: "video-admin-1",
        url: "https://example.com/updated.jpg",
        aspectRatio: "16:9",
        mobileCinematicHigh: null,
        mobileCinematicLow: null,
        mobileCinematicVeryLow: null,
        thumbnail: null,
        videoStill: null,
        syncedAt: expect.any(Date),
        deletedAt: null,
      },
    })
    // Second (own-updatedAt) query must filter by the image's own
    // updatedAt, same `since` watermark, via the flat top-level query.
    expect(mockedCoreQuery).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        where: { updatedAt: { gte: "2026-05-07T00:00:00.000Z" } },
      }),
    )
    // Incremental soft-delete must stay off regardless of this pass.
    expect(prisma.videoImage.updateMany).not.toHaveBeenCalled()
  })

  it("warns (without failing the phase) when an image's parent video is not in admin", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "7_KnowGodBP",
            images: [
              {
                id: "image-bp",
                updatedAt: "2026-09-14T00:00:00.000Z",
                aspectRatio: "banner",
                url: "https://example.test/bp.jpg",
                mobileCinematicHigh: null,
                mobileCinematicLow: null,
                mobileCinematicVeryLow: null,
                thumbnail: null,
                videoStill: null,
              },
            ],
          },
        ],
      },
    })
    mockedCoreQuery.mockResolvedValueOnce({ data: { videoImages: [] } })
    const tx = { videoImage: { upsert: vi.fn() } }
    const prisma = {
      video: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoImage: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    const stats = await syncVideoImages({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-09-01T00:00:00.000Z",
    })

    // Orphans are tolerated (#1818); the orchestrator's parent watermark cap
    // is what guarantees the skipped rows are re-read once videos catches up.
    expect(stats.errors).toBe(0)
    expect(tx.videoImage.upsert).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("core-sync.video-image.skipped-missing-videos"),
    )
    const warning = JSON.parse(String(warnSpy.mock.calls[0][0]))
    expect(warning).toMatchObject({
      count: 1,
      samples: [{ imageId: "image-bp", videoId: "7_KnowGodBP" }],
    })
    warnSpy.mockRestore()
  })
})
