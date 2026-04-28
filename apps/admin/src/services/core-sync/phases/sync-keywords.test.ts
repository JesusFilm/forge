import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({ coreQuery: vi.fn() }))

import { coreQuery } from "../core-client"
import { syncKeywords } from "./sync-keywords"

const mockedCoreQuery = vi.mocked(coreQuery)

function createProgress() {
  return { setTotal: vi.fn(), increment: vi.fn() }
}

function createPrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
    language: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "admin-en", coreId: "core-lang-en" }]),
    },
    keyword: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    ...overrides,
  }
}

describe("syncKeywords", () => {
  beforeEach(() => {
    mockedCoreQuery.mockReset()
  })

  it("issues a single bulk INSERT … ON CONFLICT DO UPDATE for the batch (no $transaction wrapper)", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        keywords: [
          { id: "k1", value: "jesus", language: { id: "core-lang-en" } },
          { id: "k2", value: "faith", language: null },
        ],
      },
    } as never)

    const prisma = createPrisma({
      $executeRaw: vi.fn().mockResolvedValue(2),
    })
    const stats = await syncKeywords({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.updated).toBe(2)
    expect(stats.errors).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)

    const arg = (prisma.$executeRaw as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { sql: string } | undefined
    expect(arg?.sql).toContain('INSERT INTO "keyword"')
    expect(arg?.sql).toContain('ON CONFLICT ("core_id") DO UPDATE')
    expect(arg?.sql).not.toMatch(/\bBEGIN\b/i)
  })

  it("increments errors on bulk SQL failure and skips soft-delete sweep", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        keywords: [{ id: "k1", value: "jesus", language: null }],
      },
    } as never)

    const prisma = createPrisma({
      $executeRaw: vi.fn().mockRejectedValue(new Error("connection reset")),
    })
    const stats = await syncKeywords({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(1)
    expect(stats.updated).toBe(0)
    expect(prisma.keyword.updateMany).not.toHaveBeenCalled()
  })

  it("skips soft-delete when the first full-sync batch is empty", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { keywords: [] },
    } as never)

    const prisma = createPrisma()
    const stats = await syncKeywords({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.softDeleted).toBe(0)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.keyword.updateMany).not.toHaveBeenCalled()
  })
})
