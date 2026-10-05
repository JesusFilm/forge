import { describe, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import {
  purgeExpiredRecommendationRequests,
  readRecommendationRetentionHealth,
} from "./retention.service"

type RetentionHealthSnapshot = Array<{
  latestSuccessAt: Date | null
  oldestOverdueAt: Date | null
}>

function rawSqlText(query: unknown): string {
  if (typeof query === "string") return query
  return query != null && typeof query === "object" && "sql" in query
    ? String(query.sql)
    : ""
}

function retentionQuery(
  profiles: Array<{ id: string; privacyGeneration: number }> = [],
) {
  return async (query: Prisma.Sql): Promise<unknown[]> => {
    if (query.sql.includes("pg_try_advisory_xact_lock"))
      return [{ locked: true }]
    if (query.sql.includes("UPDATE recommendation_profile")) return profiles
    if (query.sql.includes("SELECT id FROM recommendation_content_action"))
      return (query.values[0] as string[]).map((id) => ({ id }))
    if (query.sql.includes("JOIN recommendation_eligibility_decision decision"))
      return [{ count: 0n }]
    if (query.sql.includes("seed_sources AS MATERIALIZED"))
      return [
        {
          profiles: [],
          requests: [],
          episodes: [],
          outcomes: [],
          eligibility: [],
          sources: [],
          graphs: [],
          protocols: [],
          releases: [],
          studies: [],
          assignments: [],
          experiments: [],
          overflow: false,
        },
      ]
    return []
  }
}
function buildPrisma() {
  const requestIds = [{ id: "request-1" }, { id: "request-2" }]
  const count = () => vi.fn(async () => 0)
  const transaction = {
    $executeRaw: vi.fn(async (query: unknown) =>
      rawSqlText(query).includes(
        "DELETE FROM recommendation_profile_vector_snapshot",
      )
        ? 0
        : 1,
    ),
    $queryRaw: vi.fn(
      retentionQuery([{ id: "expired-profile-1", privacyGeneration: 3 }]),
    ),
    recommendationOwnerRelease: {
      findFirst: vi.fn(async (): Promise<{ expiresAt: Date } | null> => null),
    },
    recommendationCowatchTrialAuthority: {
      findFirst: vi.fn(
        async (): Promise<{ rawPopulationExpiresAt: Date } | null> => null,
      ),
    },
    recommendationCowatchGeneration: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationCowatchSuppression: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationViewer: {
      findMany: vi.fn(async (): Promise<Array<{ tokenDigest: string }>> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationRequest: {
      findMany: vi.fn(async () => requestIds),
      deleteMany: vi.fn(async () => ({ count: requestIds.length })),
      findFirst: vi.fn(async (): Promise<{ expiresAt: Date } | null> => null),
    },
    recommendationPrecomputedVisit: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationPrecomputedExperiment: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => null),
    },
    watchSurfaceExposure: {
      findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationServedItem: { count: count() },
    recommendationRenderedFact: { count: count() },
    recommendationImpression: { count: count() },
    recommendationSelection: { count: count() },
    recommendationPlaybackEpisode: {
      count: count(),
      findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async (): Promise<{ expiresAt: Date } | null> => null),
    },
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
      findMany: vi.fn(async () => [{ id: "expired-evaluation-1" }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationCompositionObservation: {
      findMany: vi.fn(async (): Promise<Array<{ runId: string }>> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async (): Promise<{ expiresAt: Date } | null> => null),
    },
    recommendationCompositionProtocol: {
      findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async (): Promise<{ expiresAt: Date } | null> => null),
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
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationProfileProjectionPointer: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationProfileProjectionContribution: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationProfileInterest: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => null),
    },
    recommendationProfileProjectionGeneration: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async (): Promise<{ expiresAt: Date } | null> => null),
    },
    recommendationPersonalizationDecision: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationExperimentAssignment: {
      findMany: vi.fn(async () => []),
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
      findMany: vi.fn(async () => []),
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
    pushAttribution: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    pushOpen: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    pushRegistration: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  }
  const prisma = {
    $queryRaw: vi.fn(
      async (_query?: unknown): Promise<RetentionHealthSnapshot> => [
        { latestSuccessAt: null, oldestOverdueAt: null },
      ],
    ),
    recommendationRetentionRun: {
      create: vi.fn(async () => ({ id: "retention-run-1" })),
      update: vi.fn(async (args) => args),
      findFirst: vi.fn(),
    },
    recommendationViewer: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
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
    recommendationPlaybackEpisode: { findFirst: vi.fn() },
    $transaction: vi.fn(async (callback) => callback(transaction)),
  }
  const client = {
    ...transaction,
    ...prisma,
    recommendationRequest: transaction.recommendationRequest,
    recommendationContentAction: transaction.recommendationContentAction,
    recommendationPlaybackEpisode: transaction.recommendationPlaybackEpisode,
    recommendationViewer: transaction.recommendationViewer,
    recommendationProfile: transaction.recommendationProfile,
    recommendationCowatchTrialAuthority:
      transaction.recommendationCowatchTrialAuthority,
  }
  for (const [key, value] of Object.entries(transaction)) {
    if (
      key.startsWith("recommendation") &&
      key !== "recommendationRetentionRun"
    )
      Object.assign(client, { [key]: value })
  }
  return { prisma: client, transaction }
}

describe("recommendation retention service", () => {
  it("unlinks push rows for an expired viewer before deleting the viewer", async () => {
    const { prisma, transaction } = buildPrisma()
    const digests = ["c".repeat(64), "d".repeat(64)]
    transaction.recommendationViewer.findMany.mockResolvedValueOnce(
      digests.map((tokenDigest) => ({ tokenDigest })),
    )

    await purgeExpiredRecommendationRequests(
      prisma as never,
      new Date("2026-09-17T00:00:00.000Z"),
      2,
    )

    const scope = { where: { viewerDigest: { in: digests } } }
    expect(transaction.pushAttribution.deleteMany).toHaveBeenCalledWith(scope)
    expect(transaction.pushOpen.deleteMany).toHaveBeenCalledWith(scope)
    expect(transaction.pushRegistration.updateMany).toHaveBeenCalledWith({
      ...scope,
      data: { viewerDigest: null },
    })
    // The registration keeps the phone's push address through every identity
    // event, and the unlink lands before the viewer row is gone.
    expect(transaction.pushRegistration.deleteMany).not.toHaveBeenCalled()
    expect(
      transaction.pushRegistration.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transaction.recommendationViewer.deleteMany.mock.invocationCallOrder[0],
    )
  })

  it("leaves push rows alone when no viewer expired", async () => {
    const { prisma, transaction } = buildPrisma()

    await purgeExpiredRecommendationRequests(
      prisma as never,
      new Date("2026-09-17T00:00:00.000Z"),
      2,
    )

    expect(transaction.pushAttribution.deleteMany).not.toHaveBeenCalled()
    expect(transaction.pushOpen.deleteMany).not.toHaveBeenCalled()
    expect(transaction.pushRegistration.updateMany).not.toHaveBeenCalled()
  })

  it("skips only vector orphan collection while a publisher holds its shared lock", async () => {
    const { prisma, transaction } = buildPrisma()
    const normalQuery = retentionQuery([])
    transaction.$queryRaw.mockImplementation(async (query: Prisma.Sql) =>
      query.sql.includes("pg_try_advisory_xact_lock(368000002)")
        ? [{ locked: false }]
        : normalQuery(query),
    )

    await expect(
      purgeExpiredRecommendationRequests(prisma as never, new Date(), 500),
    ).resolves.toMatchObject({
      status: "succeeded",
      profileVectorSweepSkipped: true,
      rowCounts: { orphanProfileVectorSnapshots: 0 },
    })
    expect(
      transaction.$executeRaw.mock.calls.some(([query]) =>
        rawSqlText(query).includes(
          "DELETE FROM recommendation_profile_vector_snapshot",
        ),
      ),
    ).toBe(false)
  })

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
      batchLimitReached: true,
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
    const eligibilityQuery = transaction.$queryRaw.mock.calls
      .map(([query]) => query as Prisma.Sql)
      .find((query) =>
        query.sql.includes("JOIN recommendation_eligibility_decision decision"),
      )
    expect(eligibilityQuery?.sql).toContain("UNION")
    expect(eligibilityQuery?.values).toEqual([
      ["request-1", "request-2"],
      ["request-1", "request-2"],
    ])
    expect(
      transaction.recommendationPlaybackEpisode.findFirst,
    ).toHaveBeenCalledWith({
      where: { requestId: null, expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { expiresAt: true },
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
    ).toHaveBeenCalledWith({
      where: { id: "expired-evaluation-1", expiresAt: { lte: now } },
    })
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
    ).toHaveBeenCalledTimes(1)
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
      .mockImplementation(
        retentionQuery([{ id: "newly-expired-profile", privacyGeneration: 7 }]),
      )

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

  it("reports a standalone playback backlog that remains after the bounded batch", async () => {
    const { prisma, transaction } = buildPrisma()
    const now = new Date("2026-09-17T00:00:00.000Z")
    transaction.recommendationRequest.findMany.mockResolvedValueOnce([])
    transaction.recommendationContentAction.findMany.mockResolvedValueOnce([])
    transaction.recommendationPlaybackEpisode.findMany.mockResolvedValueOnce([
      { id: "standalone-episode-1" },
    ])
    transaction.recommendationPlaybackEpisode.findFirst.mockResolvedValue({
      expiresAt: new Date("2026-09-15T00:00:00.000Z"),
    })
    transaction.recommendationPlaybackEpisode.deleteMany.mockResolvedValueOnce({
      count: 1,
    })

    await expect(
      purgeExpiredRecommendationRequests(prisma as never, now, 1),
    ).resolves.toMatchObject({
      rootsDeleted: 0,
      rowCounts: { expiredStandaloneEpisodes: 1 },
      oldestExpiredAtAfter: "2026-09-15T00:00:00.000Z",
      overdueAfterRun: true,
      batchLimitReached: true,
    })
  })

  it.each([
    "requests",
    "watch exposures",
    "direct actions",
    "standalone episodes",
    "viewers",
    "expired profiles",
    "pending profile erasures",
    "retired profiles",
  ])("continues when the %s selection fills its batch", async (selection) => {
    const { prisma, transaction } = buildPrisma()
    const now = new Date("2026-09-17T00:00:00.000Z")
    transaction.recommendationRequest.findMany.mockResolvedValue([])
    transaction.watchSurfaceExposure.findMany.mockResolvedValue([])
    transaction.recommendationContentAction.findMany.mockResolvedValue([])
    transaction.recommendationPlaybackEpisode.findMany.mockResolvedValue([])
    transaction.recommendationShadowEvaluation.findMany.mockResolvedValue([])
    transaction.recommendationViewer.findMany.mockResolvedValue([])
    transaction.recommendationProfile.findMany.mockReset().mockResolvedValue([])
    transaction.$queryRaw.mockReset().mockImplementation(retentionQuery())
    if (selection === "requests") {
      transaction.recommendationRequest.findMany.mockResolvedValue([
        { id: "request-1" },
      ])
    } else if (selection === "watch exposures") {
      transaction.watchSurfaceExposure.findMany.mockResolvedValue([
        { id: "exposure-1" },
      ])
    } else if (selection === "direct actions") {
      transaction.recommendationContentAction.findMany.mockResolvedValue([
        { id: "action-1" },
      ])
    } else if (selection === "standalone episodes") {
      transaction.recommendationPlaybackEpisode.findMany.mockResolvedValue([
        { id: "episode-1" },
      ])
    } else if (selection === "viewers") {
      transaction.recommendationViewer.findMany.mockResolvedValue([
        { tokenDigest: "digest-1" },
      ])
    } else if (selection === "expired profiles") {
      transaction.$queryRaw.mockImplementation(
        retentionQuery([{ id: "profile-1", privacyGeneration: 1 }]),
      )
      transaction.recommendationProfile.findMany
        .mockResolvedValueOnce([{ id: "profile-1", privacyGeneration: 1 }])
        .mockResolvedValue([])
    } else if (selection === "pending profile erasures") {
      transaction.recommendationProfile.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "profile-1", privacyGeneration: 1 }])
        .mockResolvedValue([])
    } else {
      transaction.recommendationProfile.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "profile-1" }])
    }

    await expect(
      purgeExpiredRecommendationRequests(prisma as never, now, 1),
    ).resolves.toMatchObject({
      status: "succeeded",
      overdueAfterRun: false,
      batchLimitReached: true,
    })
  })

  it("stops after an empty bounded selection", async () => {
    const { prisma, transaction } = buildPrisma()
    transaction.recommendationRequest.findMany.mockResolvedValue([])
    transaction.recommendationContentAction.findMany.mockResolvedValue([])
    transaction.recommendationPlaybackEpisode.findMany.mockResolvedValue([])
    transaction.recommendationShadowEvaluation.findMany.mockResolvedValue([])
    transaction.recommendationViewer.findMany.mockResolvedValue([])
    transaction.recommendationProfile.findMany.mockReset().mockResolvedValue([])
    transaction.$queryRaw.mockReset().mockImplementation(retentionQuery())

    await expect(
      purgeExpiredRecommendationRequests(prisma as never, new Date(), 1),
    ).resolves.toMatchObject({
      status: "succeeded",
      batchLimitReached: false,
    })
  })

  it("does not report a skipped lock as a drained batch", async () => {
    const { prisma, transaction } = buildPrisma()
    transaction.$queryRaw.mockReset().mockResolvedValueOnce([{ locked: false }])

    await expect(
      purgeExpiredRecommendationRequests(prisma as never),
    ).resolves.toMatchObject({
      status: "skipped",
      batchLimitReached: false,
      overdueAfterRun: false,
    })
    expect(transaction.recommendationRequest.findMany).not.toHaveBeenCalled()
  })

  it("continues when an expired authority tombstone remains after the bounded purge", async () => {
    const { prisma, transaction } = buildPrisma()
    const now = new Date("2026-09-29T00:00:00Z")
    const rawPopulationExpiresAt = new Date("2026-09-27T00:00:00Z")
    transaction.recommendationRequest.findMany.mockResolvedValue([])
    transaction.recommendationContentAction.findMany.mockResolvedValue([])
    transaction.recommendationPlaybackEpisode.findMany.mockResolvedValue([])
    transaction.recommendationShadowEvaluation.findMany.mockResolvedValue([])
    transaction.recommendationViewer.findMany.mockResolvedValue([])
    transaction.recommendationProfile.findMany.mockReset().mockResolvedValue([])
    transaction.$queryRaw.mockReset().mockImplementation(retentionQuery())
    transaction.recommendationCowatchTrialAuthority.findFirst.mockResolvedValue(
      { rawPopulationExpiresAt },
    )
    await expect(
      purgeExpiredRecommendationRequests(prisma as never, now, 1),
    ).resolves.toMatchObject({
      status: "succeeded",
      rootsDeleted: 0,
      batchLimitReached: true,
      overdueAfterRun: true,
      oldestExpiredAtAfter: rawPopulationExpiresAt.toISOString(),
      rowCounts: { expiredCowatchTrialAuthorities: 1 },
    })
  })

  it("continues an expired request batch before the 24-hour propagation threshold", async () => {
    const { prisma, transaction } = buildPrisma()
    const now = new Date("2026-08-20T10:30:00.000Z")
    const oldestExpiry = new Date("2026-08-19T10:31:00.000Z")
    transaction.recommendationRequest.findMany.mockResolvedValueOnce([
      { id: "request-1" },
    ])
    transaction.recommendationContentAction.findMany.mockResolvedValue([])
    transaction.recommendationProfile.findMany.mockReset().mockResolvedValue([])
    transaction.$queryRaw.mockReset().mockImplementation(retentionQuery())
    transaction.recommendationRequest.findFirst.mockResolvedValueOnce({
      expiresAt: oldestExpiry,
    })

    await expect(
      purgeExpiredRecommendationRequests(prisma as never, now, 1),
    ).resolves.toMatchObject({
      status: "succeeded",
      oldestExpiredAtAfter: oldestExpiry.toISOString(),
      overdueAfterRun: false,
      batchLimitReached: true,
    })
  })

  it("continues a subfull profile-generation backlog before it is overdue", async () => {
    const { prisma, transaction } = buildPrisma()
    const now = new Date("2026-10-03T10:30:00.000Z")
    const oldestExpiry = new Date("2026-10-03T10:00:00.000Z")
    transaction.recommendationRequest.findMany.mockResolvedValue([])
    transaction.recommendationContentAction.findMany.mockResolvedValue([])
    transaction.recommendationPlaybackEpisode.findMany.mockResolvedValue([])
    transaction.recommendationShadowEvaluation.findMany.mockResolvedValue([])
    transaction.recommendationViewer.findMany.mockResolvedValue([])
    transaction.recommendationProfile.findMany.mockReset().mockResolvedValue([])
    transaction.$queryRaw.mockReset().mockImplementation(retentionQuery())
    transaction.recommendationProfileProjectionGeneration.findFirst.mockResolvedValueOnce(
      { expiresAt: oldestExpiry },
    )

    await expect(
      purgeExpiredRecommendationRequests(prisma as never, now, 100),
    ).resolves.toMatchObject({
      status: "succeeded",
      rootsDeleted: 0,
      oldestExpiredAtAfter: oldestExpiry.toISOString(),
      overdueAfterRun: false,
      batchLimitReached: true,
    })
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
    const healthQuery = prisma.$queryRaw.mock.calls[0]?.[0] as
      | { strings: readonly string[] }
      | undefined
    expect(healthQuery?.strings.join("?")).toContain(
      "recommendation_playback_episode WHERE request_id IS NULL",
    )

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
