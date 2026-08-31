import { describe, expect, it, vi } from "vitest"
import {
  purgeExpiredRecommendationRequests,
  readRecommendationRetentionHealth,
} from "./retention.service"

type RetentionHealthSnapshot = Array<{
  latestSuccessAt: Date | null
  oldestOverdueAt: Date | null
}>

function buildPrisma() {
  const requestIds = [{ id: "request-1" }, { id: "request-2" }]
  const count = () => vi.fn(async () => 0)
  const transaction = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([
        { id: "expired-profile-1", privacyGeneration: 3 },
      ]),
    recommendationRequest: {
      findMany: vi.fn(async () => requestIds),
      deleteMany: vi.fn(async () => ({ count: requestIds.length })),
      findFirst: vi.fn(async () => null),
    },
    recommendationServedItem: { count: count() },
    recommendationRenderedFact: { count: count() },
    recommendationImpression: { count: count() },
    recommendationSelection: { count: count() },
    recommendationPlaybackEpisode: { count: count() },
    recommendationPlaybackFact: { count: count() },
    recommendationOutcomeRevision: { count: count() },
    recommendationContentAction: {
      count: count(),
      findMany: vi.fn(async () => [{ id: "direct-action-1" }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationEligibilityDecision: {
      count: count(),
      findFirst: vi.fn(async () => null),
    },
    recommendationControlEvaluation: {
      deleteMany: vi.fn(async () => ({ count: 2 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationShadowEvaluation: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationPromotionEvent: {
      deleteMany: vi.fn(async () => ({ count: 3 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationPromotionRun: {
      deleteMany: vi.fn(async () => ({ count: 2 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationPromotionApproval: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationShadowRun: {
      findMany: vi.fn(async () => [{ id: "shadow-run-1" }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationShadowNomination: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationEvidenceAudit: { count: count() },
    recommendationConflict: { count: count() },
    recommendationCapabilitySubmissionBudget: { count: count() },
    recommendationCandidateRun: { count: count() },
    recommendationCandidateStageEvidence: { count: count() },
    recommendationPromotionSlateFence: { count: count() },
    recommendationTraceAccessAudit: {
      count: count(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationProfile: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          { id: "expired-profile-1", privacyGeneration: 3 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationProfileSessionLink: {
      findMany: vi.fn(async () => [{ sessionDigest: "a".repeat(64) }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationProfileProjectionRun: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationProfileProjectionPointer: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationProfileProjectionContribution: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationProfileInterest: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationProfileProjectionGeneration: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationExperimentAssignment: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationExperimentEvaluation: {
      deleteMany: vi.fn(async () => ({ count: 2 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationExperimentEvaluationRun: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationExperiment: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationConsentTransition: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationConsentReceipt: {
      updateMany: vi
        .fn()
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 1 }),
    },
    recommendationRetentionRun: {
      update: vi.fn(async (args) => args),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  }
  const prisma = {
    $queryRaw: vi.fn(
      async (): Promise<RetentionHealthSnapshot> => [
        { latestSuccessAt: null, oldestOverdueAt: null },
      ],
    ),
    recommendationRetentionRun: {
      create: vi.fn(async () => ({ id: "retention-run-1" })),
      update: vi.fn(async (args) => args),
      findFirst: vi.fn(),
    },
    recommendationRequest: { findFirst: vi.fn() },
    recommendationContentAction: { findFirst: vi.fn() },
    recommendationEligibilityDecision: { findFirst: vi.fn() },
    recommendationControlEvaluation: { findFirst: vi.fn() },
    recommendationShadowEvaluation: { findFirst: vi.fn() },
    recommendationPromotionEvent: { findFirst: vi.fn() },
    recommendationPromotionRun: { findFirst: vi.fn() },
    recommendationPromotionApproval: { findFirst: vi.fn() },
    recommendationExperimentEvaluation: { findFirst: vi.fn() },
    recommendationExperimentEvaluationRun: { findFirst: vi.fn() },
    recommendationExperimentAssignment: { findFirst: vi.fn() },
    recommendationExperiment: { findFirst: vi.fn() },
    recommendationProfileProjectionRun: { findFirst: vi.fn() },
    recommendationProfileProjectionContribution: { findFirst: vi.fn() },
    recommendationProfileInterest: { findFirst: vi.fn() },
    recommendationProfileProjectionGeneration: { findFirst: vi.fn() },
    $transaction: vi.fn(async (callback) => callback(transaction)),
  }
  return { prisma, transaction }
}

describe("recommendation retention service", () => {
  it("takes one advisory-locked bounded batch and records sanitized counts", async () => {
    const { prisma, transaction } = buildPrisma()
    const now = new Date("2026-09-17T00:00:00.000Z")

    await expect(
      purgeExpiredRecommendationRequests(prisma as never, now, 2),
    ).resolves.toMatchObject({
      status: "succeeded",
      runId: "retention-run-1",
      rootsDeleted: 2,
      rowCounts: {
        submissionBudgets: 0,
        candidateRuns: 0,
        candidateStageEvidence: 0,
        expiredContentActions: 1,
        expiredEligibilityDecisions: 0,
        expiredProfilesFenced: 1,
        expiredConsentReceipts: 2,
        profileConsentReceiptsRevoked: 1,
        profileErasuresCompleted: 1,
        expiredProfileSessionLinks: 1,
        expiredControlEvaluations: 2,
        expiredShadowEvaluations: 1,
        expiredPromotionEvents: 3,
        expiredPromotionRuns: 2,
        expiredPromotionApprovals: 1,
      },
      overdueAfterRun: false,
    })
    expect(transaction.recommendationRequest.findMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: 2,
      select: { id: true },
    })
    expect(transaction.recommendationRequest.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["request-1", "request-2"] } },
    })
    expect(
      transaction.recommendationContentAction.findMany,
    ).toHaveBeenCalledWith({
      where: { requestId: null, expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: 2,
      select: { id: true },
    })
    expect(
      transaction.recommendationContentAction.deleteMany,
    ).toHaveBeenCalledWith({
      where: { id: { in: ["direct-action-1"] } },
    })
    expect(
      transaction.recommendationContentAction.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        requestId: { in: ["request-1", "request-2"] },
        expiresAt: { lte: now },
      },
    })
    expect(
      transaction.recommendationContentAction.deleteMany,
    ).toHaveBeenCalledBefore(transaction.recommendationRequest.deleteMany)
    expect(
      transaction.recommendationEligibilityDecision.count,
    ).toHaveBeenCalledWith({
      where: { contentActionId: { in: ["direct-action-1"] } },
    })
    expect(transaction.recommendationProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["expired-profile-1"] },
        }),
        data: expect.objectContaining({
          erasureState: "COMPLETED",
        }),
      }),
    )
    expect(
      transaction.recommendationConsentReceipt.updateMany,
    ).toHaveBeenNthCalledWith(1, {
      where: { state: "ACTIVE", expiresAt: { lte: now } },
      data: {
        tokenDigest: null,
        profileId: null,
        state: "EXPIRED",
        revokedAt: now,
        revokeReason: "receipt_expired",
      },
    })
    expect(
      transaction.recommendationConsentReceipt.updateMany,
    ).toHaveBeenNthCalledWith(2, {
      where: {
        profileId: { in: ["expired-profile-1"] },
        state: "ACTIVE",
      },
      data: {
        tokenDigest: null,
        profileId: null,
        state: "REVOKED",
        revokedAt: now,
        revokeReason: "profile_expired",
      },
    })
    expect(transaction.recommendationProfile.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ["expired-profile-1"] },
          erasureState: "PENDING",
        }),
        take: 1,
      }),
    )
    expect(
      transaction.recommendationExperimentAssignment.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        profileId: { in: ["expired-profile-1"] },
        state: "ACTIVE",
      },
      data: {
        state: "FENCED",
        fencedAt: now,
        fenceReason: "profile_expire",
      },
    })
    expect(
      transaction.recommendationControlEvaluation.deleteMany,
    ).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } })
    expect(
      transaction.recommendationShadowEvaluation.deleteMany,
    ).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } })
    expect(
      transaction.recommendationExperimentEvaluation.deleteMany,
    ).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } })
    expect(
      transaction.recommendationPromotionApproval.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        pointers: { none: {} },
        runs: { none: {} },
      },
    })
    expect(
      transaction.recommendationExperimentEvaluationRun.deleteMany,
    ).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } })
    expect(
      transaction.recommendationConsentTransition.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileId: { in: ["expired-profile-1"] } },
      }),
    )
    expect(
      transaction.recommendationProfileProjectionGeneration.deleteMany,
    ).toHaveBeenCalledTimes(2)
    expect(
      transaction.recommendationShadowNomination.deleteMany,
    ).toHaveBeenCalledWith({ where: { runId: { in: ["shadow-run-1"] } } })
    expect(transaction.recommendationRetentionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "retention-run-1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          rootsDeleted: 2,
          reasonCode: null,
        }),
      }),
    )
  })

  it("erases a newly expired profile before an older pending backlog", async () => {
    const { prisma, transaction } = buildPrisma()
    const now = new Date("2026-09-17T00:00:00.000Z")
    transaction.recommendationProfile.findMany
      .mockReset()
      .mockResolvedValueOnce([
        { id: "newly-expired-profile", privacyGeneration: 7 },
      ])
      .mockResolvedValueOnce([])
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([
        { id: "newly-expired-profile", privacyGeneration: 7 },
      ])

    await purgeExpiredRecommendationRequests(prisma as never, now, 1)

    expect(
      transaction.recommendationProfileProjectionRun.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        OR: [
          { profileId: { in: ["newly-expired-profile"] } },
          { sessionDigest: { in: ["a".repeat(64)] } },
        ],
      },
    })
    expect(transaction.recommendationProfile.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ erasureState: "PENDING" }),
      }),
    )
  })

  it("requires both a recent durable success and no propagation-overdue root", async () => {
    const { prisma } = buildPrisma()
    const now = new Date("2026-09-17T00:00:00.000Z")
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        latestSuccessAt: new Date("2026-09-16T12:00:00.000Z"),
        oldestOverdueAt: null,
      },
    ])
    await expect(
      readRecommendationRetentionHealth(prisma as never, now),
    ).resolves.toMatchObject({ healthy: true, reason: "healthy" })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)

    prisma.$queryRaw.mockResolvedValueOnce([
      {
        latestSuccessAt: new Date("2026-09-16T12:00:00.000Z"),
        oldestOverdueAt: new Date("2026-09-15T00:00:00.000Z"),
      },
    ])
    await expect(
      readRecommendationRetentionHealth(prisma as never, now),
    ).resolves.toMatchObject({
      healthy: false,
      reason: "retention_overdue",
    })
  })

  it("reports an overdue eligibility projection after its raw root has gone", async () => {
    const { prisma } = buildPrisma()
    const now = new Date("2026-09-17T00:00:00.000Z")
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        latestSuccessAt: new Date("2026-09-16T12:00:00.000Z"),
        oldestOverdueAt: new Date("2026-09-15T00:00:00.000Z"),
      },
    ])

    await expect(
      readRecommendationRetentionHealth(prisma as never, now),
    ).resolves.toMatchObject({
      healthy: false,
      reason: "retention_overdue",
      oldestOverdueAt: new Date("2026-09-15T00:00:00.000Z"),
    })
  })

  it("reports an overdue aggregate control evaluation independently of raw roots", async () => {
    const { prisma } = buildPrisma()
    const now = new Date("2026-09-17T00:00:00.000Z")
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        latestSuccessAt: new Date("2026-09-16T12:00:00.000Z"),
        oldestOverdueAt: new Date("2026-09-15T00:00:00.000Z"),
      },
    ])

    await expect(
      readRecommendationRetentionHealth(prisma as never, now),
    ).resolves.toMatchObject({
      healthy: false,
      reason: "retention_overdue",
      oldestOverdueAt: new Date("2026-09-15T00:00:00.000Z"),
    })
  })
})
