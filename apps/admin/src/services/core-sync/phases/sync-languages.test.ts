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
            slug: "english",
            name: "English",
            audioPreview: null,
          },
        ],
      },
    } as never)

    const progress = createProgress()
    const prisma = {
      $transaction: vi.fn(),
      language: {
        findMany: vi.fn().mockResolvedValue([]),
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
            slug: "english",
            name: [{ value: "English", language: { bcp47: "en" } }],
            audioPreview: {
              value: "https://cdn.example/audio.mp3",
              duration: 12,
              size: "1024",
              bitrate: 128,
              codec: "mp3",
            },
          },
        ],
      },
    } as never)

    const progress = createProgress()
    const tx = {
      language: {
        upsert: vi.fn().mockResolvedValue({ id: "language-1" }),
      },
      languageLocale: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      language: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      languageLocale: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
    expect(tx.languageLocale.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          languageId: "language-1",
          locale: "en",
          value: "English",
        }),
      }),
    )
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
        findMany: vi.fn().mockResolvedValue([]),
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

  it("nulls a duplicate Core slug owned by another language", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        languages: [
          {
            id: "lang-2",
            bcp47: "en-x-test",
            iso3: "tst",
            slug: "english",
            name: [{ value: "Test", language: { bcp47: "en" } }],
            audioPreview: null,
          },
        ],
      },
    } as never)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const tx = {
      language: {
        upsert: vi.fn().mockResolvedValue({ id: "language-2" }),
      },
      languageLocale: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      language: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ coreId: "lang-1", slug: "english" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      languageLocale: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncLanguages({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(0)
    expect(tx.language.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ slug: null }),
        update: expect.objectContaining({ slug: null }),
      }),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("core-sync.language.duplicate-slug"),
    )
    warn.mockRestore()
  })
})
