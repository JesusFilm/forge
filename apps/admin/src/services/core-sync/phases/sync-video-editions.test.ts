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
      $executeRaw: vi.fn().mockResolvedValue(1),
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
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
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

  it("retries a page transaction when Prisma reports P2024 pool pressure", async () => {
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

    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) }
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementationOnce(() => {
          throw Object.assign(new Error("pool exhausted"), { code: "P2024" })
        })
        .mockImplementationOnce(async (fn: (trx: typeof tx) => Promise<void>) =>
          fn(tx),
        ),
      videoEdition: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    const stats = await syncVideoEditions({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(stats.updated).toBe(1)
    expect(stats.errors).toBe(0)
    warnSpy.mockRestore()
  })

  it("does not retry a non-pool-timeout transaction error", async () => {
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

    const prisma = {
      $transaction: vi.fn().mockImplementationOnce(() => {
        throw new Error("some other failure")
      }),
      videoEdition: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)

    const stats = await syncVideoEditions({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(stats.errors).toBeGreaterThanOrEqual(1)
    errorSpy.mockRestore()
  })

  it("retries the soft-delete updateMany when Prisma reports P2024 pool pressure", async () => {
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

    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) }
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoEdition: {
        updateMany: vi
          .fn()
          .mockImplementationOnce(() => {
            throw Object.assign(new Error("pool exhausted"), {
              code: "P2024",
            })
          })
          .mockResolvedValueOnce({ count: 1 }),
      },
    }
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    const stats = await syncVideoEditions({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(prisma.videoEdition.updateMany).toHaveBeenCalledTimes(2)
    expect(stats.softDeleted).toBe(1)
    expect(stats.errors).toBe(0)
    warnSpy.mockRestore()
  })

  it("does not retry a non-pool-timeout soft-delete error", async () => {
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

    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) }
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      videoEdition: {
        updateMany: vi.fn().mockImplementationOnce(() => {
          throw new Error("some other failure")
        }),
      },
    }
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)

    const stats = await syncVideoEditions({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(prisma.videoEdition.updateMany).toHaveBeenCalledTimes(1)
    expect(stats.errors).toBeGreaterThanOrEqual(1)
    errorSpy.mockRestore()
  })
})
