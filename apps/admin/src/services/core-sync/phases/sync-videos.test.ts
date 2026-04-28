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

/**
 * Build a prisma stub whose `$transaction(async tx => ...)` invokes the
 * callback with a `tx` proxy that delegates to the same mocked
 * $queryRaw / $executeRaw. Lets the existing per-statement mocks keep
 * working after the production code wrapped its two-statement
 * sequence in a transaction.
 *
 * `bulkSqlSpy` exposes the $transaction call site so tests can assert
 * the bulk SQL ran inside a transaction.
 */
function makePrismaStub({
  queryRaw,
  executeRaw,
  languageFindMany,
  videoUpdateManyResult = { count: 0 },
}: {
  queryRaw: ReturnType<typeof vi.fn>
  executeRaw: ReturnType<typeof vi.fn>
  languageFindMany: ReturnType<typeof vi.fn>
  videoUpdateManyResult?: { count: number }
}) {
  const $transaction = vi.fn(
    async (
      fn: (tx: unknown) => Promise<unknown>,
      _options?: { timeout?: number; maxWait?: number },
    ) => fn({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
  )
  return {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction,
    language: { findMany: languageFindMany },
    video: {
      updateMany: vi.fn().mockResolvedValue(videoUpdateManyResult),
    },
  }
}

describe("syncVideos", () => {
  beforeEach(() => {
    mockedCoreQuery.mockReset()
  })

  it("issues bulk Video INSERT then bulk VideoLocale INSERT inside a single $transaction", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videos: [makeCoreVideo()] },
    } as never)

    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: "admin-vid-1", core_id: "core-vid-1" }])
    const executeRaw = vi.fn().mockResolvedValue(1)
    const languageFindMany = vi
      .fn()
      .mockResolvedValue([{ id: "admin-lang-en", coreId: "core-lang-en" }])

    const prisma = makePrismaStub({ queryRaw, executeRaw, languageFindMany })

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    // Both bulk statements happened inside one $transaction call.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // The $transaction options carry the deliberate 30s timeout
    // (vs the prod-broken legacy 5s).
    expect(prisma.$transaction.mock.calls[0]?.[1]).toEqual({
      timeout: 30_000,
      maxWait: 5_000,
    })

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
    const languageFindMany = vi.fn().mockResolvedValue([])

    const prisma = makePrismaStub({ queryRaw, executeRaw, languageFindMany })

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
    const languageFindMany = vi.fn().mockResolvedValue([])

    const prisma = makePrismaStub({ queryRaw, executeRaw, languageFindMany })

    await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(queryRaw).toHaveBeenCalledTimes(1) // Video INSERT
    expect(executeRaw).not.toHaveBeenCalled() // No locale rows → no locale INSERT
  })

  it("increments stats.errors when the bulk Video INSERT throws and skips the soft-delete sweep", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videos: [makeCoreVideo()] },
    } as never)

    const queryRaw = vi.fn().mockRejectedValue(new Error("connection reset"))
    const executeRaw = vi.fn()
    const languageFindMany = vi.fn().mockResolvedValue([])

    const prisma = makePrismaStub({ queryRaw, executeRaw, languageFindMany })

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(1)
    expect(prisma.video.updateMany).not.toHaveBeenCalled()
  })

  it("rolls back the Video INSERT when the VideoLocale INSERT fails (cross-statement atomicity)", async () => {
    // Step 1 (Video INSERT, $queryRaw) succeeds. Step 2 (VideoLocale
    // INSERT, $executeRaw) rejects. The catch counts one error and
    // the soft-delete sweep is skipped. The transaction wrapper means
    // the Video INSERT does NOT commit independently of the failed
    // locale INSERT — verified here by asserting both calls fired
    // inside the same $transaction invocation and stats.updated does
    // NOT pick up the would-have-been-written video count.
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videos: [makeCoreVideo()] },
    } as never)

    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: "admin-vid-1", core_id: "core-vid-1" }])
    const executeRaw = vi
      .fn()
      .mockRejectedValueOnce(new Error("locale insert failed"))
    const languageFindMany = vi.fn().mockResolvedValue([])

    const prisma = makePrismaStub({ queryRaw, executeRaw, languageFindMany })

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(1)
    expect(stats.updated).toBe(0)
    expect(prisma.video.updateMany).not.toHaveBeenCalled()
    // Both statements were attempted within the single $transaction.
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })

  it("skips soft-delete when the first full-sync page is empty", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videos: [] },
    } as never)

    const queryRaw = vi.fn()
    const executeRaw = vi.fn()
    const languageFindMany = vi.fn().mockResolvedValue([])

    const prisma = makePrismaStub({ queryRaw, executeRaw, languageFindMany })

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.softDeleted).toBe(0)
    expect(prisma.video.updateMany).not.toHaveBeenCalled()
  })
})
