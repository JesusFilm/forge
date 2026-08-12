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
    $queryRaw: vi.fn(async (): Promise<unknown[]> => []),
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
    seoEvidenceObservation: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    seoTicketOutboxAttempt: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    seoApprovalNonce: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    seoWorkloadAssertion: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    seoLesson: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    seoProposalVersion: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    seoDecision: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    seoExperiment: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    seoRun: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
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
      purgedSeoEvidenceObservationCount: 0,
      purgedSeoTicketOutboxAttemptCount: 0,
      purgedSeoApprovalNonceCount: 0,
      purgedSeoWorkloadAssertionCount: 0,
      purgedSeoLessonCount: 0,
      redactedSeoProposalVersionCount: 0,
      redactedSeoDecisionCount: 0,
      redactedSeoExperimentCount: 0,
      compactedSeoRunReportCount: 0,
      purgedBefore: "2026-05-30T00:00:00.000Z",
      redactedBefore: "2019-05-30T00:00:00.000Z",
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

  it("purges only expired terminal SEO detail and redacts seven-year audit fields without removing identities or digests", async () => {
    const prisma = buildPrisma()
    prisma.seoEvidenceObservation.deleteMany.mockResolvedValueOnce({ count: 2 })
    prisma.seoTicketOutboxAttempt.deleteMany.mockResolvedValueOnce({ count: 3 })
    prisma.seoApprovalNonce.deleteMany.mockResolvedValueOnce({ count: 4 })
    prisma.seoWorkloadAssertion.deleteMany.mockResolvedValueOnce({ count: 5 })
    prisma.seoLesson.deleteMany.mockResolvedValueOnce({ count: 6 })
    prisma.seoProposalVersion.updateMany.mockResolvedValueOnce({ count: 7 })
    prisma.seoDecision.updateMany.mockResolvedValueOnce({ count: 8 })
    prisma.seoExperiment.updateMany.mockResolvedValueOnce({ count: 9 })
    const now = new Date("2033-05-30T00:00:00.000Z")

    await expect(
      purgeExpiredSearchTraces(
        prisma as unknown as Parameters<typeof purgeExpiredSearchTraces>[0],
        now,
      ),
    ).resolves.toMatchObject({
      purgedCount: 44,
      purgedSeoEvidenceObservationCount: 2,
      purgedSeoTicketOutboxAttemptCount: 3,
      purgedSeoApprovalNonceCount: 4,
      purgedSeoWorkloadAssertionCount: 5,
      purgedSeoLessonCount: 6,
      redactedSeoProposalVersionCount: 7,
      redactedSeoDecisionCount: 8,
      redactedSeoExperimentCount: 9,
      compactedSeoRunReportCount: 0,
      redactedBefore: "2026-05-30T00:00:00.000Z",
    })

    const terminalExperiment = {
      legalHold: false,
      status: {
        in: [
          "BENEFICIAL",
          "NEUTRAL",
          "HARMFUL",
          "INCONCLUSIVE",
          "ROLLBACK_PROPOSED",
        ],
      },
    }
    const terminalProposalVersion = {
      OR: [
        { experiment: { is: null } },
        { experiment: { is: terminalExperiment } },
      ],
    }
    expect(prisma.seoEvidenceObservation.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        run: { proposalVersions: { every: terminalProposalVersion } },
      },
    })
    expect(prisma.seoTicketOutboxAttempt.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        outbox: { proposalVersion: terminalProposalVersion },
      },
    })
    expect(prisma.seoApprovalNonce.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        proposalVersion: terminalProposalVersion,
      },
    })
    expect(prisma.seoLesson.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["SUPERSEDED", "RETIRED"] },
        experiment: { is: terminalExperiment },
      },
    })
    expect(prisma.seoProposalVersion.updateMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lte: new Date("2026-05-30T00:00:00.000Z") },
        ...terminalProposalVersion,
        preChangeSnapshot: { not: { retention: "redacted" } },
      },
      data: expect.objectContaining({
        payload: { retention: "redacted" },
        preChangeSnapshot: { retention: "redacted" },
        treatmentSnapshot: { retention: "redacted" },
        evidence: [],
        caveats: [],
      }),
    })
    expect(prisma.seoDecision.updateMany).toHaveBeenCalledWith({
      where: {
        decidedAt: { lte: new Date("2026-05-30T00:00:00.000Z") },
        actorId: { not: "[redacted]" },
        proposalVersion: terminalProposalVersion,
      },
      data: {
        actorId: "[redacted]",
        reason: null,
        confounders: [],
      },
    })
    expect(prisma.seoExperiment.updateMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lte: new Date("2026-05-30T00:00:00.000Z") },
        ...terminalExperiment,
        preChangeSnapshot: { not: { retention: "redacted" } },
      },
      data: {
        preChangeSnapshot: { retention: "redacted" },
        treatmentSnapshot: { retention: "redacted" },
        confounders: [],
      },
    })
  })

  it("compacts expired SEO run detail while retaining safe totals and proposal links", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-30T00:00:00.000Z")
    const report = {
      schemaVersion: 1,
      detailState: "available",
      selectionPolicyId: "gsc-low-ctr-v1",
      queryDecisions: [{ query: "sensitive query" }],
      proposalRefs: [
        {
          proposalId: "proposal-reused",
          payloadDigest: "a".repeat(64),
          disposition: "reused_existing",
          version: 2,
          originatingRunId: "earlier-run",
        },
      ],
    }
    prisma.seoRun.findMany.mockResolvedValueOnce([
      {
        id: "run-1",
        report,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        completedAt: new Date("2026-05-01T00:00:00.000Z"),
        eligibleCount: 20,
        selectedCount: 3,
        wouldProposeCount: 2,
        proposedCount: 1,
        providerCoverage: { gsc: "available" },
        suppressedOperations: [],
        proposalVersions: [
          {
            proposalId: "proposal-new",
            version: 1,
            payloadDigest: "b".repeat(64),
            runId: "run-1",
          },
        ],
      },
    ])
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "run-1" }])
    prisma.seoRun.updateMany.mockResolvedValueOnce({ count: 1 })

    await expect(
      purgeExpiredSearchTraces(
        prisma as unknown as Parameters<typeof purgeExpiredSearchTraces>[0],
        now,
      ),
    ).resolves.toMatchObject({ compactedSeoRunReportCount: 1 })

    expect(prisma.seoRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "run-1",
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      }),
      data: {
        report: expect.objectContaining({
          schemaVersion: 1,
          detailState: "detail_expired",
          eligibleCount: 20,
          selectedCount: 3,
          proposalRefs: expect.arrayContaining([
            expect.objectContaining({ proposalId: "proposal-reused" }),
            expect.objectContaining({ proposalId: "proposal-new" }),
          ]),
          detailExpiresAt: "2026-05-30T00:00:00.000Z",
          compactedAt: "2026-05-30T00:00:00.000Z",
        }),
      },
    })
    expect(JSON.stringify(prisma.seoRun.updateMany.mock.calls)).not.toContain(
      "sensitive query",
    )
  })

  it("does not rewrite an already compacted SEO run report", async () => {
    const prisma = buildPrisma()

    await purgeExpiredSearchTraces(
      prisma as unknown as Parameters<typeof purgeExpiredSearchTraces>[0],
      new Date("2026-05-31T00:00:00.000Z"),
    )

    expect(prisma.seoRun.updateMany).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(prisma.seoRun.findMany).not.toHaveBeenCalled()
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
