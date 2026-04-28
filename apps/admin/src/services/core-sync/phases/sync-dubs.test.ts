import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({ coreQuery: vi.fn() }))

import { coreQuery } from "../core-client"
import { syncDubs } from "./sync-dubs"

const mockedCoreQuery = vi.mocked(coreQuery)

function createProgress() {
  return { setTotal: vi.fn(), increment: vi.fn() }
}

function makeCoreVariant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "core-dub-1",
    videoId: "core-vid-1",
    slug: "v1-en",
    language: { id: "core-lang-en" },
    duration: 120,
    lengthInMilliseconds: "120000",
    hls: "https://hls/v1.m3u8",
    dash: null,
    share: null,
    downloadable: true,
    published: true,
    updatedAt: "2026-04-27T00:00:00.000Z",
    ...overrides,
  }
}

function createPrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ id: "admin-dub-1", core_id: "core-dub-1" }]),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    video: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "admin-vid-1", coreId: "core-vid-1" }]),
      // for the soft-delete sweep at end
    },
    language: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "admin-lang-en", coreId: "core-lang-en" }]),
    },
    videoDub: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    ...overrides,
  }
}

describe("syncDubs", () => {
  beforeEach(() => {
    mockedCoreQuery.mockReset()
  })

  it("issues a single bulk INSERT … ON CONFLICT DO UPDATE for the page (no $transaction wrapper)", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariants: [makeCoreVariant()] },
    } as never)

    const prisma = createPrisma()
    const stats = await syncDubs({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const arg = (prisma.$queryRaw as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { sql: string } | undefined
    expect(arg?.sql).toContain('INSERT INTO "video_dub"')
    expect(arg?.sql).toContain('ON CONFLICT ("core_id") DO UPDATE')
    expect(arg?.sql).toContain(
      `WHERE "video_dub"."source" != 'manager'::"SourceTier"`,
    )
  })

  it("filters out variants whose video FK is missing (logs warn, does not error)", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoVariants: [
          makeCoreVariant({
            id: "core-dub-orphan",
            videoId: "core-vid-unknown",
          }),
        ],
      },
    } as never)

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const prisma = createPrisma()
      const stats = await syncDubs({
        prisma: prisma as never,
        progress: createProgress(),
      })

      // Orphaned dub does not error — it's logged + counted in
      // stats.skipped. No bulk INSERT fires (eligibleVariants is
      // empty).
      expect(stats.errors).toBe(0)
      expect(stats.updated).toBe(0)
      expect(stats.skipped).toBe(1)
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
      // Confirm we logged the skip.
      expect(warnSpy).toHaveBeenCalled()
      const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(logged).toContain("missing_video_fk")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("skips soft-delete when the first full-sync page is empty", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariants: [] },
    } as never)

    const prisma = createPrisma()
    const stats = await syncDubs({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.softDeleted).toBe(0)
    expect(prisma.videoDub.updateMany).not.toHaveBeenCalled()
  })

  it("increments stats.errors on bulk SQL failure and skips soft-delete", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariants: [makeCoreVariant()] },
    } as never)

    const prisma = createPrisma({
      $queryRaw: vi.fn().mockRejectedValue(new Error("connection reset")),
    })
    const stats = await syncDubs({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(1)
    expect(prisma.videoDub.updateMany).not.toHaveBeenCalled()
  })
})
