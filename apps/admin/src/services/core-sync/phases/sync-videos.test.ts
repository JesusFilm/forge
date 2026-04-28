import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({ coreQuery: vi.fn() }))

import { coreQuery } from "../core-client"
import { syncVideos } from "./sync-videos"

const mockedCoreQuery = vi.mocked(coreQuery)

function createProgress() {
  return { setTotal: vi.fn(), increment: vi.fn() }
}

function makeCoreVideo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "core-vid-1",
    slug: "v1",
    label: "featureFilm",
    primaryLanguageId: "core-lang-en",
    title: [{ value: "Hello", language: { bcp47: "en" } }],
    description: [{ value: "A film", language: { bcp47: "en" } }],
    snippet: [],
    imageAlt: [],
    locked: false,
    noIndex: false,
    updatedAt: "2026-04-27T00:00:00.000Z",
    ...overrides,
  }
}

describe("syncVideos", () => {
  beforeEach(() => {
    mockedCoreQuery.mockReset()
  })

  it("issues bulk Video INSERT then bulk VideoLocale INSERT (no $transaction wrapper)", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videos: [makeCoreVideo()] },
    } as never)

    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: "admin-vid-1", core_id: "core-vid-1" }])
    const executeRaw = vi.fn().mockResolvedValue(1)

    const prisma = {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      $transaction: vi.fn(),
      language: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "admin-lang-en", coreId: "core-lang-en" }]),
      },
      video: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const videoArg = queryRaw.mock.calls[0]?.[0] as { sql: string } | undefined
    expect(videoArg?.sql).toContain('INSERT INTO "video"')
    expect(videoArg?.sql).toContain('ON CONFLICT ("core_id") DO UPDATE')
    // MANAGER protection in the WHERE clause:
    expect(videoArg?.sql).toContain(
      `WHERE "video"."source" != 'manager'::"SourceTier"`,
    )
    expect(videoArg?.sql).toContain('RETURNING "id", "core_id"')

    const localeArg = executeRaw.mock.calls[0]?.[0] as
      | { sql: string }
      | undefined
    expect(localeArg?.sql).toContain('INSERT INTO "video_locale"')
    expect(localeArg?.sql).toContain(
      'ON CONFLICT ("video_id", "locale") DO UPDATE',
    )
  })

  it("MANAGER protection: when RETURNING omits a coreId (because the row is source='manager'), no VideoLocale upsert fires for it", async () => {
    // Two videos sent; only one comes back from RETURNING (the other
    // is filtered out by the `WHERE "video"."source" != 'manager'`
    // clause). The locale upsert must only target the surviving video.
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          makeCoreVideo({ id: "core-vid-1", slug: "v1" }),
          makeCoreVideo({ id: "core-vid-mgr", slug: "v-mgr" }),
        ],
      },
    } as never)

    const queryRaw = vi
      .fn()
      // RETURNING surfaces only the non-manager video.
      .mockResolvedValueOnce([{ id: "admin-vid-1", core_id: "core-vid-1" }])
    const executeRaw = vi.fn().mockResolvedValue(1)

    const prisma = {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      $transaction: vi.fn(),
      language: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      video: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    // Only one video counted as updated — the manager-protected one is
    // not in stats.updated.
    expect(stats.updated).toBe(1)

    // VideoLocale INSERT only contains rows for the surviving videoId.
    const localeArg = executeRaw.mock.calls[0]?.[0] as
      | { sql: string; values: unknown[] }
      | undefined
    expect(localeArg?.values).toContain("admin-vid-1")
    // The other admin video id was never minted, so the manager-vid
    // locale never lands.
  })

  it("skips the VideoLocale INSERT entirely when no videos in the page have any localized text", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          makeCoreVideo({
            id: "core-vid-1",
            title: [],
            description: [],
            snippet: [],
            imageAlt: [],
          }),
        ],
      },
    } as never)

    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: "admin-vid-1", core_id: "core-vid-1" }])
    const executeRaw = vi.fn().mockResolvedValue(1)

    const prisma = {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      $transaction: vi.fn(),
      language: { findMany: vi.fn().mockResolvedValue([]) },
      video: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }

    await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(queryRaw).toHaveBeenCalledTimes(1) // Video INSERT
    expect(executeRaw).not.toHaveBeenCalled() // No locale rows → no locale INSERT
  })

  it("increments stats.errors on bulk SQL failure and skips soft-delete", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videos: [makeCoreVideo()] },
    } as never)

    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error("connection reset")),
      $executeRaw: vi.fn(),
      $transaction: vi.fn(),
      language: { findMany: vi.fn().mockResolvedValue([]) },
      video: { updateMany: vi.fn() },
    }

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(1)
    expect(prisma.video.updateMany).not.toHaveBeenCalled()
  })

  it("skips soft-delete when the first full-sync page is empty", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videos: [] },
    } as never)

    const prisma = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      $transaction: vi.fn(),
      language: { findMany: vi.fn().mockResolvedValue([]) },
      video: { updateMany: vi.fn() },
    }

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.softDeleted).toBe(0)
    expect(prisma.video.updateMany).not.toHaveBeenCalled()
  })
})
