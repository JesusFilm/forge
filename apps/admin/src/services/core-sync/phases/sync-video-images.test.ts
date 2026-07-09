import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncVideoImages } from "./sync-video-images"

const mockedCoreQuery = vi.mocked(coreQuery)

describe("syncVideoImages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
