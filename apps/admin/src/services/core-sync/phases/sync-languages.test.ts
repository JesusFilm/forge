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
    // Use mockReset (not clearAllMocks) so queued mockResolvedValueOnce
    // values from a prior test don't leak into the next one.
    mockedCoreQuery.mockReset()
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
      $executeRaw: vi.fn(),
      language: { updateMany: vi.fn() },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress,
    })

    expect(stats.errors).toBe(1)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.language.updateMany).not.toHaveBeenCalled()
  })

  it("issues a single bulk INSERT … ON CONFLICT DO UPDATE for the page (no $transaction wrapper)", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce({
        data: {
          languages: [
            {
              id: "lang-1",
              bcp47: "en",
              iso3: "eng",
              name: [{ value: "English", language: { bcp47: "en" } }],
            },
            {
              id: "lang-2",
              bcp47: "fr",
              iso3: "fra",
              name: [{ value: "French", language: { bcp47: "en" } }],
            },
          ],
        },
      } as never)
      .mockResolvedValueOnce({ data: { languages: [] } } as never)

    const progress = createProgress()
    const executeRaw = vi.fn().mockResolvedValue(2)
    const prisma = {
      $executeRaw: executeRaw,
      // Defensive: assert nothing slips through to the legacy path.
      $transaction: vi.fn(),
      language: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress,
    })

    expect(stats.updated).toBe(2)
    expect(stats.errors).toBe(0)
    // No legacy transaction wrapper.
    expect(prisma.$transaction).not.toHaveBeenCalled()
    // Single bulk statement for the page.
    expect(executeRaw).toHaveBeenCalledTimes(1)

    // SQL invariant — the statement must be the bulk-upsert shape.
    // Inspect the Prisma.Sql passed to $executeRaw. The Prisma.Sql
    // exposes the joined query text as `sql`.
    const arg = executeRaw.mock.calls[0]?.[0] as { sql: string } | undefined
    expect(arg?.sql).toContain('INSERT INTO "language"')
    expect(arg?.sql).toContain('ON CONFLICT ("core_id") DO UPDATE')
    expect(arg?.sql).not.toMatch(/\bBEGIN\b/i)
    expect(arg?.sql).not.toMatch(/timeout:\s*5_?000/i)
  })

  it("soft-deletes unseen core rows after a successful full sync", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({ data: { languages: [] } } as never)

    const progress = createProgress()
    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      language: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress,
    })

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
      $executeRaw: vi.fn(),
      language: { updateMany: vi.fn() },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress,
    })

    expect(stats.softDeleted).toBe(0)
    expect(prisma.language.updateMany).not.toHaveBeenCalled()
  })

  it("increments stats.errors on bulk SQL failure and continues paging", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({ data: { languages: [] } } as never)

    const progress = createProgress()
    const prisma = {
      $executeRaw: vi.fn().mockRejectedValue(new Error("connection reset")),
      language: { updateMany: vi.fn() },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress,
    })

    expect(stats.errors).toBe(1)
    expect(stats.updated).toBe(0)
    // Soft-delete sweep is gated on errors === 0; should be skipped.
    expect(prisma.language.updateMany).not.toHaveBeenCalled()
  })
})
