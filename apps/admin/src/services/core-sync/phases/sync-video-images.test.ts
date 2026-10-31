import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncVideoImages, fetchCoreImageIdSet } from "./sync-video-images"

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
        coreUpdatedAt: expect.any(Date),
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
        coreUpdatedAt: expect.any(Date),
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

  it("walks the full catalogue on incremental runs and skips full soft-delete", async () => {
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

    // No `where` filter on incremental runs — per-image freshness is now
    // decided from each image's own `coreUpdatedAt`, not the parent video's.
    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        where: undefined,
      }),
    )
    expect(prisma.videoImage.updateMany).not.toHaveBeenCalled()
  })

  it("picks up an image edited after its parent video was last touched", async () => {
    const since = "2026-10-01T00:00:00.000Z"
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "video-core-1",
            images: [
              {
                id: "image-1",
                // Newer than its stored `coreUpdatedAt` below.
                updatedAt: "2026-10-10T00:00:00.000Z",
                aspectRatio: "16:9",
                url: "https://example.com/new.jpg",
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
        findMany: vi.fn().mockResolvedValue([
          {
            // The parent video's own `updatedAt` is older than `since` —
            // the bug this ticket fixes is that an incremental run used to
            // filter on this value and would never see the image below.
            id: "video-admin-1",
            coreId: "video-core-1",
            images: [
              {
                coreId: "image-1",
                coreUpdatedAt: new Date("2026-09-01T00:00:00.000Z"),
              },
            ],
          },
        ]),
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
      since,
    })

    // Anti-vacuous: a phase that still filtered by the parent video's
    // `updatedAt` would send a non-undefined `where` here.
    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ where: undefined }),
    )

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(tx.videoImage.upsert).toHaveBeenCalledWith({
      where: { coreId: "image-1" },
      create: {
        coreId: "image-1",
        videoId: "video-admin-1",
        url: "https://example.com/new.jpg",
        aspectRatio: "16:9",
        mobileCinematicHigh: "high.jpg",
        mobileCinematicLow: "low.jpg",
        mobileCinematicVeryLow: "very-low.jpg",
        thumbnail: "thumb.jpg",
        videoStill: "still.jpg",
        coreUpdatedAt: new Date("2026-10-10T00:00:00.000Z"),
        syncedAt: expect.any(Date),
      },
      update: {
        videoId: "video-admin-1",
        url: "https://example.com/new.jpg",
        aspectRatio: "16:9",
        mobileCinematicHigh: "high.jpg",
        mobileCinematicLow: "low.jpg",
        mobileCinematicVeryLow: "very-low.jpg",
        thumbnail: "thumb.jpg",
        videoStill: "still.jpg",
        coreUpdatedAt: new Date("2026-10-10T00:00:00.000Z"),
        syncedAt: expect.any(Date),
        deletedAt: null,
      },
    })
  })

  it("skips the upsert when the stored coreUpdatedAt equals Core's updatedAt", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "video-core-1",
            images: [
              {
                id: "image-1",
                updatedAt: "2026-10-10T00:00:00.000Z",
                aspectRatio: "16:9",
                url: "https://example.com/same.jpg",
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
    } as never)

    const tx = {
      videoImage: {
        upsert: vi.fn().mockResolvedValue({ id: "image-admin-1" }),
      },
    }
    const prisma = {
      video: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "video-admin-1",
            coreId: "video-core-1",
            images: [
              {
                coreId: "image-1",
                coreUpdatedAt: new Date("2026-10-10T00:00:00.000Z"),
              },
            ],
          },
        ]),
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
      since: "2026-10-01T00:00:00.000Z",
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(0)
    expect(tx.videoImage.upsert).not.toHaveBeenCalled()
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

describe("fetchCoreImageIdSet", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("walks every page and returns the full set of Core image ids", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          { id: "video-1", images: [{ id: "image-1" }, { id: "image-2" }] },
          { id: "video-2", images: [{ id: "image-3" }] },
        ],
      },
    } as never)

    const result = await fetchCoreImageIdSet()

    expect(result.ids).toEqual(new Set(["image-1", "image-2", "image-3"]))
  })

  it("throws rather than returning a partial set when a page errors", async () => {
    mockedCoreQuery.mockRejectedValueOnce(new Error("core gateway down"))

    await expect(fetchCoreImageIdSet()).rejects.toThrow("core gateway down")
  })

  it("throws when the walk comes back empty", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videos: [] },
    } as never)

    await expect(fetchCoreImageIdSet()).rejects.toThrow(
      "Core image inventory walk returned no images",
    )
  })
})
