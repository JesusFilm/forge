import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncVideoOrigins } from "./sync-video-origins"

const mockedCoreQuery = vi.mocked(coreQuery)

describe("syncVideoOrigins", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("syncs video origins from the root videoOrigins query", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoOrigins: [
          {
            id: "origin-1",
            updatedAt: "2026-05-07T00:00:00.000Z",
            name: "Original",
            description: "Core origin",
          },
        ],
      },
    } as never)

    const tx = {
      videoOrigin: {
        upsert: vi.fn().mockResolvedValue({ id: "origin-admin-1" }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoOrigin: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideoOrigins({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        offset: 0,
        limit: 10000,
        where: undefined,
      }),
    )
    expect(tx.videoOrigin.upsert).toHaveBeenCalledWith({
      where: { coreId: "origin-1" },
      create: {
        coreId: "origin-1",
        name: "Original",
        description: "Core origin",
        syncedAt: expect.any(Date),
      },
      update: {
        name: "Original",
        description: "Core origin",
        syncedAt: expect.any(Date),
        deletedAt: null,
      },
    })
    expect(prisma.videoOrigin.updateMany).toHaveBeenCalledWith({
      where: {
        source: "CORE",
        coreId: { notIn: ["origin-1"] },
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("forwards incremental updatedAt watermarks", async () => {
    mockedCoreQuery.mockResolvedValueOnce({ data: { videoOrigins: [] } })

    await syncVideoOrigins({
      prisma: {} as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-05-07T00:00:00.000Z",
    })

    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        where: { updatedAt: { gte: "2026-05-07T00:00:00.000Z" } },
      }),
    )
  })
})
