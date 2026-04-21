import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncLanguages } from "./sync-languages"

const mockedCoreQuery = vi.mocked(coreQuery)

function createProgress() {
  return {
    setTotal: vi.fn(),
    increment: vi.fn(),
  }
}

describe("syncLanguages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("increments errors and continues when a page fails schema validation", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        languages: [
          {
            id: "lang-1",
            bcp47: "en",
            iso3: "eng",
            name: "English",
          },
        ],
      },
    } as never)

    const progress = createProgress()
    const prisma = {
      $transaction: vi.fn(),
      language: {
        updateMany: vi.fn(),
      },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress,
    })

    expect(stats.errors).toBe(1)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.language.updateMany).not.toHaveBeenCalled()
  })

  it("soft-deletes unseen core rows after a successful full sync", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        languages: [
          {
            id: "lang-1",
            bcp47: "en",
            iso3: "eng",
            name: [{ value: "English", language: { bcp47: "en" } }],
          },
        ],
      },
    } as never)

    const progress = createProgress()
    const tx = {
      language: {
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      language: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress,
    })

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.language.updateMany).toHaveBeenCalledWith({
      where: {
        source: "CORE",
        coreId: { notIn: ["lang-1"] },
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    })
    expect(stats.softDeleted).toBe(2)
    expect(stats.errors).toBe(0)
  })

  it("skips soft-delete when the first full-sync page is empty", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        languages: [],
      },
    } as never)

    const progress = createProgress()
    const prisma = {
      $transaction: vi.fn(),
      language: {
        updateMany: vi.fn(),
      },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress,
    })

    expect(stats.softDeleted).toBe(0)
    expect(prisma.language.updateMany).not.toHaveBeenCalled()
  })
})
