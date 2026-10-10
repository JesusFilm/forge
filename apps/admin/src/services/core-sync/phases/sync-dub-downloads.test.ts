import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncDubDownloads } from "./sync-dub-downloads"

const mockedCoreQuery = vi.mocked(coreQuery)

describe("syncDubDownloads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("bulk upserts download rows from the root videoVariantDownloads query", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoVariantDownloads: [
          {
            id: "download-1",
            updatedAt: "2026-05-07T00:00:00.000Z",
            videoVariantId: "variant-1",
            quality: "fhd",
            size: 1000,
            height: 1080,
            width: 1920,
            bitrate: 1200,
            url: "download.mp4",
          },
        ],
      },
    } as never)
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariantDownloads: [] },
    } as never)

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
    }
    const prisma = {
      videoDub: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "dub-1", coreId: "variant-1" }]),
      },
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoDubDownload: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncDubDownloads({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        offset: 0,
        limit: 20000,
        where: undefined,
      }),
    )
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    const call = tx.$executeRaw.mock.calls[0] as [
      ReadonlyArray<string>,
      ...unknown[],
    ]
    const [strings, ...values] = call
    const sql = strings.join("?")
    expect(sql).toMatch(/INSERT\s+INTO\s+"?video_dub_download"?/i)
    expect(sql).toContain("unnest(")
    expect(sql).toContain('ON CONFLICT ("core_id")')
    expect(sql).toContain("IS DISTINCT FROM")
    expect(values).toHaveLength(10)
    expect(values[1]).toContain("download-1")
    expect(values[2]).toContain("dub-1")
    expect(values[8]).toContain("1200")
    expect(values[9]).toBe(true)
  })

  it("forwards incremental updatedAt watermarks and skips full soft-delete", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariantDownloads: [] },
    } as never)
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariantDownloads: [] },
    } as never)

    const prisma = {
      videoDub: { findMany: vi.fn().mockResolvedValue([]) },
      videoDubDownload: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    await syncDubDownloads({
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
    expect(prisma.videoDubDownload.updateMany).not.toHaveBeenCalled()
  })
})
