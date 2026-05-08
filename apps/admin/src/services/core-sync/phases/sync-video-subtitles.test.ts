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

  it("syncs subtitles from the root videoSubtitles query", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoSubtitles: [
          {
            id: "subtitle-1",
            updatedAt: "2026-05-07T00:00:00.000Z",
            videoId: "video-core-1",
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
    } as never)

    const tx = {
      videoSubtitle: {
        upsert: vi.fn().mockResolvedValue({ id: "subtitle-admin-1" }),
      },
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
    expect(tx.videoSubtitle.upsert).toHaveBeenCalledWith({
      where: { coreId: "subtitle-1" },
      create: {
        coreId: "subtitle-1",
        videoId: "video-admin-1",
        videoEditionId: "edition-admin-1",
        languageId: "language-admin-1",
        value: "Subtitle text",
        primary: true,
        vttSrc: "subtitle.vtt",
        srtSrc: "subtitle.srt",
        syncedAt: expect.any(Date),
      },
      update: {
        videoId: "video-admin-1",
        videoEditionId: "edition-admin-1",
        languageId: "language-admin-1",
        value: "Subtitle text",
        primary: true,
        vttSrc: "subtitle.vtt",
        srtSrc: "subtitle.srt",
        syncedAt: expect.any(Date),
        deletedAt: null,
      },
    })
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
    mockedCoreQuery.mockResolvedValueOnce({ data: { videoSubtitles: [] } })
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
})
