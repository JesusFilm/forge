import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncVideoEditions } from "./sync-video-editions"

const mockedCoreQuery = vi.mocked(coreQuery)

describe("syncVideoEditions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("syncs video editions as their own phase", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoEditions: [
          {
            id: "edition-1",
            name: "Standard",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
        ],
      },
    } as never)

    const tx = {
      videoEdition: {
        upsert: vi.fn().mockResolvedValue({ id: "edition-admin-1" }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoEdition: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncVideoEditions({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(tx.videoEdition.upsert).toHaveBeenCalledWith({
      where: { coreId: "edition-1" },
      create: {
        coreId: "edition-1",
        name: "Standard",
        syncedAt: expect.any(Date),
      },
      update: {
        name: "Standard",
        syncedAt: expect.any(Date),
        deletedAt: null,
      },
    })
    expect(prisma.videoEdition.updateMany).toHaveBeenCalledWith({
      where: {
        source: "CORE",
        coreId: { notIn: ["edition-1"] },
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("forwards incremental updatedAt watermarks", async () => {
    mockedCoreQuery.mockResolvedValueOnce({ data: { videoEditions: [] } })
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await syncVideoEditions({
      prisma: {} as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-05-06T00:00:00.000Z",
    })

    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        where: { updatedAt: { gte: "2026-05-06T00:00:00.000Z" } },
      }),
    )
    warnSpy.mockRestore()
  })
})
