import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncVideoSubtitles } from "./sync-video-subtitles"

const mockedCoreQuery = vi.mocked(coreQuery)

describe("syncVideoSubtitles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("syncs subtitles via videos(offset, limit) → subtitles inline", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "video-core-1",
            subtitles: [
              {
                id: "subtitle-1",
                languageId: "language-core-1",
                primary: true,
                edition: "edition-1",
                vttSrc: "subtitle.vtt",
                srtSrc: "subtitle.srt",
                value: "Subtitle text",
                videoEdition: { id: "edition-core-1" },
              },
            ],
          },
        ],
      },
    } as never)

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
    }
    const prisma = {
      video: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "video-admin-1", coreId: "video-core-1" }]),
      },
      language: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "language-admin-1", coreId: "language-core-1" },
          ]),
      },
      videoEdition: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "edition-admin-1", coreId: "edition-core-1" },
          ]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoSubtitle: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(prisma.videoSubtitle.updateMany).toHaveBeenCalledWith({
      where: {
        source: "CORE",
        deletedAt: null,
        OR: [{ syncedAt: null }, { syncedAt: { lt: expect.any(Date) } }],
      },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("forwards incremental updatedAt watermarks and skips full soft-delete", async () => {
    mockedCoreQuery.mockResolvedValueOnce({ data: { videos: [] } })
    const prisma = {
      video: { findMany: vi.fn().mockResolvedValue([]) },
      language: { findMany: vi.fn().mockResolvedValue([]) },
      videoEdition: { findMany: vi.fn().mockResolvedValue([]) },
      videoSubtitle: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    await syncVideoSubtitles({
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
    expect(prisma.videoSubtitle.updateMany).not.toHaveBeenCalled()
  })

  it("handles videos with no subtitles gracefully", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          { id: "video-core-1", subtitles: [] },
          { id: "video-core-2", subtitles: [] },
        ],
      },
    } as never)

    const prisma = {
      video: { findMany: vi.fn().mockResolvedValue([]) },
      language: { findMany: vi.fn().mockResolvedValue([]) },
      videoEdition: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
      videoSubtitle: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("flattens subtitles from multiple videos in the same page", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "video-core-1",
            subtitles: [
              {
                id: "sub-1",
                languageId: "lang-core-1",
                primary: true,
                edition: "wl7",
                vttSrc: "en.vtt",
                srtSrc: null,
                value: "en.vtt",
                videoEdition: { id: "ed-core-1" },
              },
            ],
          },
          {
            id: "video-core-2",
            subtitles: [
              {
                id: "sub-2",
                languageId: "lang-core-2",
                primary: false,
                edition: "wl7",
                vttSrc: "fr.vtt",
                srtSrc: null,
                value: "fr.vtt",
                videoEdition: { id: "ed-core-1" },
              },
            ],
          },
        ],
      },
    } as never)

    const tx = { $executeRaw: vi.fn().mockResolvedValue(2) }
    const prisma = {
      video: {
        findMany: vi.fn().mockResolvedValue([
          { id: "v1", coreId: "video-core-1" },
          { id: "v2", coreId: "video-core-2" },
        ]),
      },
      language: {
        findMany: vi.fn().mockResolvedValue([
          { id: "l1", coreId: "lang-core-1" },
          { id: "l2", coreId: "lang-core-2" },
        ]),
      },
      videoEdition: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "e1", coreId: "ed-core-1" }]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoSubtitle: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.updated).toBe(2)
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
  })
})
