import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncDubs } from "./sync-dubs"

const mockedCoreQuery = vi.mocked(coreQuery)

describe("syncDubs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes edition, mux metadata, and download rows for a Core variant", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "video-core-1",
            variants: [
              {
                id: "variant-1",
                videoId: "video-core-1",
                slug: "dub",
                language: { id: "lang-en" },
                duration: 10,
                lengthInMilliseconds: "10000",
                hls: "hls",
                dash: "dash",
                share: "share",
                downloadable: true,
                published: true,
                brightcoveId: "brightcove-1",
                videoEdition: { id: "edition-1", name: "Standard" },
                muxVideo: {
                  id: "mux-1",
                  assetId: "asset",
                  playbackId: "playback",
                },
                downloads: [
                  {
                    id: "download-1",
                    quality: "720p",
                    size: "1000",
                    height: 720,
                    width: 1280,
                    bitrate: 1200,
                    url: "download.mp4",
                  },
                ],
              },
            ],
          },
        ],
      },
    } as never)

    const tx = {
      videoDub: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: "dub-1" }),
      },
      videoEdition: {
        upsert: vi.fn().mockResolvedValue({ id: "edition-admin-1" }),
      },
      muxVideo: {
        upsert: vi.fn().mockResolvedValue({ id: "mux-admin-1" }),
      },
      videoDubDownload: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const prisma = {
      video: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "video-1", coreId: "video-core-1" }]),
      },
      language: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "language-1", coreId: "lang-en" }]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoDub: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncDubs({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(tx.videoDub.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          brightcoveId: "brightcove-1",
          videoEditionId: "edition-admin-1",
          muxVideoId: "mux-admin-1",
        }),
      }),
    )
    expect(tx.videoDubDownload.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          coreId: "download-1",
          videoDubId: "dub-1",
          bitrate: 1200,
        }),
      }),
    )
  })

  it("skips Core variants whose parent video is outside the admin video scope", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoVariants: [
          {
            id: "variant-missing-video",
            videoId: "video-core-missing",
            slug: "missing",
            language: { id: "lang-en" },
            duration: 10,
            lengthInMilliseconds: "10000",
            hls: null,
            dash: null,
            share: null,
            downloadable: false,
            published: true,
            brightcoveId: null,
            videoEdition: null,
            muxVideo: null,
            downloads: [],
          },
          {
            id: "variant-1",
            videoId: "video-core-1",
            slug: "dub",
            language: { id: "lang-en" },
            duration: 10,
            lengthInMilliseconds: "10000",
            hls: null,
            dash: null,
            share: null,
            downloadable: false,
            published: true,
            brightcoveId: null,
            videoEdition: null,
            muxVideo: null,
            downloads: [],
          },
        ],
      },
    } as never)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const tx = {
      videoDub: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: "dub-1" }),
      },
      videoEdition: {
        upsert: vi.fn(),
      },
      muxVideo: {
        upsert: vi.fn(),
      },
      videoDubDownload: {
        upsert: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const prisma = {
      video: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "video-1", coreId: "video-core-1" }]),
      },
      language: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "language-1", coreId: "lang-en" }]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoDub: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncDubs({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-04-28T00:00:00.000Z",
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(tx.videoDub.upsert).toHaveBeenCalledTimes(1)
    expect(tx.videoDub.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { coreId: "variant-1" },
      }),
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("core-sync.video-dub.skipped-missing-videos"),
    )
    warn.mockRestore()
  })
})
