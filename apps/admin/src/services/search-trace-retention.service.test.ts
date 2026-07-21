import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    NODE_ENV: "test",
  },
}))

const { env } = await import("@/config/env")
const {
  SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS,
  isSearchTraceRetentionSchedulerFresh,
  purgeExpiredSearchTraces,
  readSearchTraceRetentionHealth,
} = await import("./search-trace-retention.service")

const envMutable = env as { NODE_ENV?: "development" | "test" | "production" }

function buildPrisma() {
  return {
    searchTrace: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    searchEvalCandidate: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    watchSearchEvent: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    queryEmbeddingCache: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    workflowRun: {
      findFirst: vi.fn(),
    },
  }
}

describe("search trace retention service", () => {
  afterEach(() => {
    envMutable.NODE_ENV = "test"
  })

  it("purges only rows whose raw expiration has passed", async () => {
    const prisma = buildPrisma()
    prisma.searchTrace.deleteMany.mockResolvedValueOnce({ count: 3 })
    prisma.searchEvalCandidate.deleteMany.mockResolvedValueOnce({ count: 2 })
    prisma.watchSearchEvent.deleteMany.mockResolvedValueOnce({ count: 4 })
    prisma.queryEmbeddingCache.deleteMany.mockResolvedValueOnce({ count: 5 })
    const now = new Date("2026-05-30T00:00:00.000Z")

    await expect(
      purgeExpiredSearchTraces(
        prisma as unknown as Parameters<typeof purgeExpiredSearchTraces>[0],
        now,
      ),
    ).resolves.toEqual({
      purgedCount: 14,
      purgedRawTraceCount: 3,
      purgedGeneratedCandidateCount: 2,
      purgedWatchSearchEventCount: 4,
      purgedQueryEmbeddingCacheCount: 5,
      purgedBefore: "2026-05-30T00:00:00.000Z",
    })
    expect(prisma.searchTrace.deleteMany).toHaveBeenCalledWith({
      where: {
        rawExpiresAt: {
          lte: now,
        },
      },
    })
    expect(prisma.searchEvalCandidate.deleteMany).toHaveBeenCalledWith({
      where: {
        retentionExpiresAt: {
          lte: now,
        },
        promotionStatus: {
          not: "PROMOTED",
        },
      },
    })
    expect(prisma.watchSearchEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    })
    expect(prisma.queryEmbeddingCache.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    })
  })

  it("treats non-production retention as healthy for local/test capture", async () => {
    envMutable.NODE_ENV = "test"
    const prisma = buildPrisma()

    await expect(
      readSearchTraceRetentionHealth(
        prisma as unknown as Parameters<
          typeof readSearchTraceRetentionHealth
        >[0],
      ),
    ).resolves.toMatchObject({
      healthy: true,
      reason: "not-production",
    })
    expect(prisma.workflowRun.findFirst).not.toHaveBeenCalled()
  })

  it("treats an active scheduler ledger as healthy in production", async () => {
    envMutable.NODE_ENV = "production"
    const prisma = buildPrisma()
    const now = new Date("2026-05-30T00:00:00.000Z")
    prisma.workflowRun.findFirst.mockResolvedValueOnce({
      id: "scheduler-ledger-1",
      updatedAt: new Date(
        now.getTime() - SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS + 1,
      ),
    })

    await expect(
      readSearchTraceRetentionHealth(
        prisma as unknown as Parameters<
          typeof readSearchTraceRetentionHealth
        >[0],
        now,
      ),
    ).resolves.toEqual({
      healthy: true,
      reason: "scheduler-active",
      latestPurgeAt: null,
      activeSchedulerRunId: "scheduler-ledger-1",
    })
  })

  it("does not treat a stale active scheduler ledger as healthy", async () => {
    envMutable.NODE_ENV = "production"
    const prisma = buildPrisma()
    const now = new Date("2026-05-30T00:00:00.000Z")
    prisma.workflowRun.findFirst
      .mockResolvedValueOnce({
        id: "scheduler-ledger-1",
        updatedAt: new Date(
          now.getTime() - SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS - 1,
        ),
      })
      .mockResolvedValueOnce(null)

    await expect(
      readSearchTraceRetentionHealth(
        prisma as unknown as Parameters<
          typeof readSearchTraceRetentionHealth
        >[0],
        now,
      ),
    ).resolves.toMatchObject({
      healthy: false,
      reason: "missing",
      activeSchedulerRunId: null,
    })
  })

  it("falls back to a recent purge heartbeat in production", async () => {
    envMutable.NODE_ENV = "production"
    const prisma = buildPrisma()
    const now = new Date("2026-05-30T00:00:00.000Z")
    const recent = new Date(
      now.getTime() - SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS + 1,
    )
    prisma.workflowRun.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        finishedAt: recent,
        updatedAt: recent,
      })

    await expect(
      readSearchTraceRetentionHealth(
        prisma as unknown as Parameters<
          typeof readSearchTraceRetentionHealth
        >[0],
        now,
      ),
    ).resolves.toEqual({
      healthy: true,
      reason: "recent-purge",
      latestPurgeAt: recent.toISOString(),
      activeSchedulerRunId: null,
    })
  })

  it("reports missing retention health when scheduler and purge heartbeat are absent", async () => {
    envMutable.NODE_ENV = "production"
    const prisma = buildPrisma()
    prisma.workflowRun.findFirst.mockResolvedValue(null)

    await expect(
      readSearchTraceRetentionHealth(
        prisma as unknown as Parameters<
          typeof readSearchTraceRetentionHealth
        >[0],
        new Date("2026-05-30T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      healthy: false,
      reason: "missing",
      latestPurgeAt: null,
      activeSchedulerRunId: null,
    })
  })

  it("classifies scheduler freshness by updatedAt/createdAt within the health window", () => {
    const now = new Date("2026-05-30T00:00:00.000Z")
    expect(
      isSearchTraceRetentionSchedulerFresh(
        {
          updatedAt: new Date(
            now.getTime() - SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS + 1,
          ),
        },
        now,
      ),
    ).toBe(true)
    expect(
      isSearchTraceRetentionSchedulerFresh(
        {
          createdAt: new Date(
            now.getTime() - SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS - 1,
          ),
        },
        now,
      ),
    ).toBe(false)
  })
})
