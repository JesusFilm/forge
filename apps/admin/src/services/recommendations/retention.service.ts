import { randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationConsentReceiptState,
  RecommendationConsentTransitionKind,
  RecommendationExperimentAssignmentState,
  RecommendationProfileErasureState,
  RecommendationProfileState,
  RecommendationRetentionRunStatus,
  type PrismaClient,
} from "@prisma/client"
import { RECOMMENDATION_RETENTION_PROPAGATION_HOURS } from "./contracts"
import { RecommendationInputError } from "./errors"

export const RECOMMENDATION_RETENTION_BATCH_SIZE = 500
export const RECOMMENDATION_RETENTION_MAX_BATCH_SIZE = 5_000
export const RECOMMENDATION_RETENTION_RUN_DAYS = 90
export const RECOMMENDATION_RETENTION_HEALTH_HOURS = 36
const RECOMMENDATION_PROFILE_AUDIT_DAYS = 365
const RECOMMENDATION_RETENTION_LOCK_ID = 368_000_001

type RetiringProfile = Readonly<{ id: string; privacyGeneration: number }>

export type RecommendationPurgeResult = Readonly<{
  status: "succeeded" | "skipped"
  runId: string
  rootsDeleted: number
  rowCounts: Record<string, number>
  oldestExpiredAtAfter: string | null
  overdueAfterRun: boolean
}>

function hoursBefore(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000)
}

function daysAfter(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

async function eraseRetiringProfileInfluence(
  tx: Prisma.TransactionClient,
  profiles: readonly RetiringProfile[],
): Promise<void> {
  if (profiles.length === 0) return
  const profileIds = profiles.map(({ id }) => id)
  const links = await tx.recommendationProfileSessionLink.findMany({
    where: { profileId: { in: profileIds } },
    select: { sessionDigest: true },
  })
  const sessionDigests = [
    ...new Set(links.map(({ sessionDigest }) => sessionDigest)),
  ]
  const scope = {
    OR: [
      { profileId: { in: profileIds } },
      ...(sessionDigests.length > 0
        ? [{ sessionDigest: { in: sessionDigests } }]
        : []),
    ],
  }
  await tx.recommendationProfileProjectionRun.deleteMany({ where: scope })
  await tx.recommendationProfileProjectionPointer.deleteMany({ where: scope })
  await tx.recommendationProfileProjectionGeneration.deleteMany({
    where: scope,
  })
}

async function redactRetiringProfileShadowRuns(
  tx: Prisma.TransactionClient,
  profiles: readonly RetiringProfile[],
  now: Date,
): Promise<void> {
  if (profiles.length === 0) return
  const runs = await tx.recommendationShadowRun.findMany({
    where: { projectionProfileId: { in: profiles.map(({ id }) => id) } },
    select: { id: true },
  })
  if (runs.length === 0) return
  const ids = runs.map(({ id }) => id)
  await tx.recommendationShadowNomination.deleteMany({
    where: { runId: { in: ids } },
  })
  await tx.recommendationShadowRun.updateMany({
    where: { id: { in: ids } },
    data: {
      state: "FENCED",
      generation: { increment: 1 },
      claimId: null,
      projectionProfileId: null,
      privacyGeneration: null,
      contextProjectionRef: null,
      contextProjectionDigest: null,
      failureReason: "profile_generation_revoked",
      finishedAt: now,
    },
  })
}

async function countRequestChildren(
  tx: Prisma.TransactionClient,
  requestIds: string[],
): Promise<Record<string, number>> {
  if (requestIds.length === 0) return {}
  const where = { requestId: { in: requestIds } }
  const [
    items,
    rendered,
    impressions,
    selections,
    episodes,
    playbackFacts,
    outcomes,
    contentActions,
    eligibilityDecisions,
    audits,
    conflicts,
    submissionBudgets,
    candidateRuns,
    candidateStageEvidence,
    promotionSlateFences,
    traceAccessLinksCleared,
  ] = await Promise.all([
    tx.recommendationServedItem.count({ where }),
    tx.recommendationRenderedFact.count({ where }),
    tx.recommendationImpression.count({ where }),
    tx.recommendationSelection.count({ where }),
    tx.recommendationPlaybackEpisode.count({ where }),
    tx.recommendationPlaybackFact.count({ where }),
    tx.recommendationOutcomeRevision.count({ where }),
    tx.recommendationContentAction.count({ where }),
    tx.recommendationEligibilityDecision.count({
      where: {
        OR: [
          { outcome: { is: { requestId: { in: requestIds } } } },
          { contentAction: { is: { requestId: { in: requestIds } } } },
        ],
      },
    }),
    tx.recommendationEvidenceAudit.count({ where }),
    tx.recommendationConflict.count({ where }),
    tx.recommendationCapabilitySubmissionBudget.count({ where }),
    tx.recommendationCandidateRun.count({ where }),
    tx.recommendationCandidateStageEvidence.count({
      where: { run: { is: { requestId: { in: requestIds } } } },
    }),
    tx.recommendationPromotionSlateFence.count({ where }),
    tx.recommendationTraceAccessAudit.count({ where }),
  ])
  return {
    requests: requestIds.length,
    items,
    rendered,
    impressions,
    selections,
    episodes,
    playbackFacts,
    outcomes,
    contentActions,
    eligibilityDecisions,
    audits,
    conflicts,
    submissionBudgets,
    candidateRuns,
    candidateStageEvidence,
    promotionSlateFences,
    traceAccessLinksCleared,
  }
}

/**
 * Purges request roots in one advisory-locked bounded transaction. Cascades
 * remove raw descendants; trace-access audit links become NULL atomically.
 */
export async function purgeExpiredRecommendationRequests(
  prisma: PrismaClient,
  now: Date = new Date(),
  batchSize = RECOMMENDATION_RETENTION_BATCH_SIZE,
): Promise<RecommendationPurgeResult> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > RECOMMENDATION_RETENTION_MAX_BATCH_SIZE
  ) {
    throw new RecommendationInputError(
      "Recommendation retention batch size is invalid",
    )
  }
  const run = await prisma.recommendationRetentionRun.create({
    data: {
      status: RecommendationRetentionRunStatus.RUNNING,
      batchSize,
      expiresAt: daysAfter(now, RECOMMENDATION_RETENTION_RUN_DAYS),
    },
  })

  try {
    return await prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(${RECOMMENDATION_RETENTION_LOCK_ID}) AS locked
      `)
      if (!lock[0]?.locked) {
        await tx.recommendationRetentionRun.update({
          where: { id: run.id },
          data: {
            status: RecommendationRetentionRunStatus.SKIPPED,
            reasonCode: "lock_not_acquired",
            completedAt: now,
          },
        })
        return {
          status: "skipped",
          runId: run.id,
          rootsDeleted: 0,
          rowCounts: {},
          oldestExpiredAtAfter: null,
          overdueAfterRun: false,
        }
      }

      const roots = await tx.recommendationRequest.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      })
      const requestIds = roots.map((root) => root.id)
      const rowCounts = await countRequestChildren(tx, requestIds)
      const directActions = await tx.recommendationContentAction.findMany({
        where: { requestId: null, expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      })
      const directActionIds = directActions.map((action) => action.id)
      const standaloneEpisodes =
        await tx.recommendationPlaybackEpisode.findMany({
          where: { requestId: null, expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: batchSize,
          select: { id: true },
        })
      const standaloneEpisodeIds = standaloneEpisodes.map(({ id }) => id)
      rowCounts.expiredStandalonePlaybackFacts =
        standaloneEpisodeIds.length === 0
          ? 0
          : await tx.recommendationPlaybackFact.count({
              where: { episodeId: { in: standaloneEpisodeIds } },
            })
      rowCounts.expiredStandaloneOutcomes =
        standaloneEpisodeIds.length === 0
          ? 0
          : await tx.recommendationOutcomeRevision.count({
              where: { episodeId: { in: standaloneEpisodeIds } },
            })
      rowCounts.expiredStandaloneEpisodes =
        standaloneEpisodeIds.length === 0
          ? 0
          : (
              await tx.recommendationPlaybackEpisode.deleteMany({
                where: { id: { in: standaloneEpisodeIds } },
              })
            ).count
      rowCounts.expiredEligibilityDecisions =
        directActionIds.length === 0
          ? 0
          : await tx.recommendationEligibilityDecision.count({
              where: { contentActionId: { in: directActionIds } },
            })
      const expiredContentActions =
        directActionIds.length === 0
          ? { count: 0 }
          : await tx.recommendationContentAction.deleteMany({
              where: { id: { in: directActionIds } },
            })
      rowCounts.expiredContentActions = expiredContentActions.count
      if (requestIds.length > 0) {
        // Matched content actions inherit the request root's retention horizon,
        // but their SET NULL lineage foreign keys cannot satisfy the lineage
        // check while candidate_generator is populated. Remove those already-
        // expired, request-owned rows (and their cascading eligibility
        // decisions) before deleting the owning roots.
        await tx.recommendationContentAction.deleteMany({
          where: {
            requestId: { in: requestIds },
            expiresAt: { lte: now },
          },
        })
        await tx.recommendationRequest.deleteMany({
          where: { id: { in: requestIds } },
        })
      }
      await tx.recommendationTraceAccessAudit.deleteMany({
        where: { expiresAt: { lte: now } },
      })
      rowCounts.expiredProfileProjectionRuns = (
        await tx.recommendationProfileProjectionRun.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredProfileProjectionContributions = (
        await tx.recommendationProfileProjectionContribution.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredProfileInterests = (
        await tx.recommendationProfileInterest.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredProfileProjectionGenerations = (
        await tx.recommendationProfileProjectionGeneration.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredConsentReceipts = (
        await tx.recommendationConsentReceipt.updateMany({
          where: {
            state: RecommendationConsentReceiptState.ACTIVE,
            expiresAt: { lte: now },
          },
          data: {
            tokenDigest: null,
            profileId: null,
            state: RecommendationConsentReceiptState.EXPIRED,
            revokedAt: now,
            revokeReason: "receipt_expired",
          },
        })
      ).count
      const expiredProfiles = await tx.recommendationProfile.findMany({
        where: {
          state: RecommendationProfileState.ACTIVE,
          expiresAt: { lte: now },
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true, privacyGeneration: true },
      })
      const expiredProfilesFenced =
        expiredProfiles.length === 0
          ? []
          : await tx.$queryRaw<RetiringProfile[]>(Prisma.sql`
              UPDATE recommendation_profile
              SET token_digest = NULL,
                  state = 'expired',
                  tombstoned_at = ${now},
                  tombstone_reason = 'expire',
                  erasure_state = 'pending',
                  erasure_requested_at = ${now},
                  updated_at = ${now}
              WHERE id IN (${Prisma.join(expiredProfiles.map(({ id }) => id))})
                AND state = 'active'
                AND expires_at <= ${now}
              RETURNING id, privacy_generation AS "privacyGeneration"
            `)
      rowCounts.expiredProfilesFenced = expiredProfilesFenced.length
      await redactRetiringProfileShadowRuns(tx, expiredProfilesFenced, now)
      if (expiredProfilesFenced.length > 0) {
        const expiredProfileIds = expiredProfilesFenced.map(({ id }) => id)
        rowCounts.profileConsentReceiptsRevoked = (
          await tx.recommendationConsentReceipt.updateMany({
            where: {
              profileId: { in: expiredProfileIds },
              state: RecommendationConsentReceiptState.ACTIVE,
            },
            data: {
              tokenDigest: null,
              profileId: null,
              state: RecommendationConsentReceiptState.REVOKED,
              revokedAt: now,
              revokeReason: "profile_expired",
            },
          })
        ).count
        await tx.recommendationExperimentAssignment.updateMany({
          where: {
            profileId: { in: expiredProfileIds },
            state: RecommendationExperimentAssignmentState.ACTIVE,
          },
          data: {
            state: RecommendationExperimentAssignmentState.FENCED,
            fencedAt: now,
            fenceReason: "profile_expire",
          },
        })
        await tx.recommendationConsentTransition.updateMany({
          where: { profileId: { in: expiredProfileIds } },
          data: { profileId: null },
        })
        await tx.recommendationConsentTransition.createMany({
          data: expiredProfilesFenced.map((profile) => ({
            auditId: randomUUID(),
            profileId: profile.id,
            kind: RecommendationConsentTransitionKind.EXPIRE,
            fromGeneration: profile.privacyGeneration,
            toGeneration: null,
            erasureState: RecommendationProfileErasureState.PENDING,
            occurredAt: now,
            expiresAt: daysAfter(now, RECOMMENDATION_PROFILE_AUDIT_DAYS),
          })),
        })
      } else {
        rowCounts.profileConsentReceiptsRevoked = 0
      }
      const newlyExpiredProfileIds = expiredProfilesFenced.map(({ id }) => id)
      const remainingErasureCapacity = Math.max(
        0,
        batchSize - expiredProfilesFenced.length,
      )
      const olderPendingProfileErasures =
        remainingErasureCapacity === 0
          ? []
          : await tx.recommendationProfile.findMany({
              where: {
                state: {
                  in: [
                    RecommendationProfileState.TOMBSTONED,
                    RecommendationProfileState.EXPIRED,
                  ],
                },
                tokenDigest: null,
                erasureState: RecommendationProfileErasureState.PENDING,
                ...(newlyExpiredProfileIds.length > 0
                  ? { id: { notIn: newlyExpiredProfileIds } }
                  : {}),
              },
              orderBy: [{ erasureRequestedAt: "asc" }, { id: "asc" }],
              take: remainingErasureCapacity,
              select: { id: true, privacyGeneration: true },
            })
      // Profiles fenced in this run are erased first. Otherwise an existing
      // pending backlog can leave their session-linked projections selectable
      // after the durable profile itself has expired.
      const pendingProfileErasures = [
        ...expiredProfilesFenced,
        ...olderPendingProfileErasures,
      ]
      await eraseRetiringProfileInfluence(tx, pendingProfileErasures)
      if (pendingProfileErasures.length > 0) {
        const pendingProfileIds = pendingProfileErasures.map(({ id }) => id)
        await tx.recommendationProfileSessionLink.deleteMany({
          where: { profileId: { in: pendingProfileIds } },
        })
        await tx.recommendationConsentTransition.updateMany({
          where: { profileId: { in: pendingProfileIds } },
          data: {
            profileId: null,
            erasureState: RecommendationProfileErasureState.COMPLETED,
          },
        })
        const completed = await tx.recommendationProfile.updateMany({
          where: {
            id: { in: pendingProfileIds },
            state: {
              in: [
                RecommendationProfileState.TOMBSTONED,
                RecommendationProfileState.EXPIRED,
              ],
            },
            tokenDigest: null,
            erasureState: RecommendationProfileErasureState.PENDING,
          },
          data: {
            erasureState: RecommendationProfileErasureState.COMPLETED,
            erasureCompletedAt: now,
            erasureFailureCode: null,
            updatedAt: now,
          },
        })
        rowCounts.profileErasuresCompleted = completed.count
      } else {
        rowCounts.profileErasuresCompleted = 0
      }
      rowCounts.expiredProfileSessionLinks = (
        await tx.recommendationProfileSessionLink.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredConsentTransitions = (
        await tx.recommendationConsentTransition.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredControlEvaluations = (
        await tx.recommendationControlEvaluation.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredShadowEvaluations = (
        await tx.recommendationShadowEvaluation.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredPromotionEvents = (
        await tx.recommendationPromotionEvent.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredPromotionRuns = (
        await tx.recommendationPromotionRun.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredPromotionApprovals = (
        await tx.recommendationPromotionApproval.deleteMany({
          where: {
            expiresAt: { lte: now },
            pointers: { none: {} },
            runs: { none: {} },
          },
        })
      ).count
      rowCounts.expiredExperimentEvaluations = (
        await tx.recommendationExperimentEvaluation.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredExperimentEvaluationRuns = (
        await tx.recommendationExperimentEvaluationRun.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredExperimentAssignments = (
        await tx.recommendationExperimentAssignment.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      rowCounts.expiredExperiments = (
        await tx.recommendationExperiment.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count
      const retiredProfiles = await tx.recommendationProfile.findMany({
        where: {
          state: {
            in: [
              RecommendationProfileState.TOMBSTONED,
              RecommendationProfileState.EXPIRED,
            ],
          },
          erasureState: RecommendationProfileErasureState.COMPLETED,
          updatedAt: {
            lte: new Date(
              now.getTime() - RECOMMENDATION_PROFILE_AUDIT_DAYS * 86_400_000,
            ),
          },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      })
      rowCounts.retiredProfilesDeleted =
        retiredProfiles.length === 0
          ? 0
          : (
              await tx.recommendationProfile.deleteMany({
                where: { id: { in: retiredProfiles.map(({ id }) => id) } },
              })
            ).count
      await tx.recommendationRetentionRun.deleteMany({
        where: { id: { not: run.id }, expiresAt: { lte: now } },
      })
      const [
        oldestExpiredRoot,
        oldestExpiredAction,
        oldestExpiredDecision,
        oldestExpiredControlEvaluation,
        oldestExpiredShadowEvaluation,
        oldestExpiredPromotionEvent,
        oldestExpiredPromotionRun,
        oldestExpiredPromotionApproval,
        oldestExpiredExperimentEvaluation,
        oldestExpiredExperimentEvaluationRun,
        oldestExpiredExperimentAssignment,
        oldestExpiredExperiment,
        oldestExpiredProfileProjectionRun,
        oldestExpiredProfileProjectionContribution,
        oldestExpiredProfileInterest,
        oldestExpiredProfileProjectionGeneration,
        oldestExpiredStandaloneEpisode,
      ] = await Promise.all([
        tx.recommendationRequest.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationContentAction.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationEligibilityDecision.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationControlEvaluation.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationShadowEvaluation.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationPromotionEvent.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationPromotionRun.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationPromotionApproval.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationExperimentEvaluation.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationExperimentEvaluationRun.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationExperimentAssignment.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationExperiment.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationProfileProjectionRun.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationProfileProjectionContribution.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationProfileInterest.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationProfileProjectionGeneration.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationPlaybackEpisode.findFirst({
          where: { requestId: null, expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
      ])
      const oldestExpiredAt = earliestDate([
        oldestExpiredRoot?.expiresAt,
        oldestExpiredAction?.expiresAt,
        oldestExpiredDecision?.expiresAt,
        oldestExpiredControlEvaluation?.expiresAt,
        oldestExpiredShadowEvaluation?.expiresAt,
        oldestExpiredPromotionEvent?.expiresAt,
        oldestExpiredPromotionRun?.expiresAt,
        oldestExpiredPromotionApproval?.expiresAt,
        oldestExpiredExperimentEvaluation?.expiresAt,
        oldestExpiredExperimentEvaluationRun?.expiresAt,
        oldestExpiredExperimentAssignment?.expiresAt,
        oldestExpiredExperiment?.expiresAt,
        oldestExpiredProfileProjectionRun?.expiresAt,
        oldestExpiredProfileProjectionContribution?.expiresAt,
        oldestExpiredProfileInterest?.expiresAt,
        oldestExpiredProfileProjectionGeneration?.expiresAt,
        oldestExpiredStandaloneEpisode?.expiresAt,
      ])
      const overdueAfterRun =
        oldestExpiredAt != null &&
        oldestExpiredAt <=
          hoursBefore(now, RECOMMENDATION_RETENTION_PROPAGATION_HOURS)
      await tx.recommendationRetentionRun.update({
        where: { id: run.id },
        data: {
          status: RecommendationRetentionRunStatus.SUCCEEDED,
          rootsDeleted: requestIds.length,
          rowCounts: rowCounts satisfies Prisma.InputJsonValue,
          oldestExpiredAtAfter: oldestExpiredAt,
          reasonCode: overdueAfterRun ? "overdue_roots_remain" : null,
          completedAt: now,
        },
      })
      return {
        status: "succeeded",
        runId: run.id,
        rootsDeleted: requestIds.length,
        rowCounts,
        oldestExpiredAtAfter: oldestExpiredAt?.toISOString() ?? null,
        overdueAfterRun,
      }
    })
  } catch (error) {
    await prisma.recommendationRetentionRun
      .update({
        where: { id: run.id },
        data: {
          status: RecommendationRetentionRunStatus.FAILED,
          reasonCode:
            error instanceof Error
              ? error.constructor.name.slice(0, 64)
              : "UnknownError",
          completedAt: now,
        },
      })
      .catch(() => {})
    throw error
  }
}

export type RecommendationRetentionHealth = Readonly<{
  healthy: boolean
  reason: "healthy" | "retention_overdue" | "missing_success_watermark"
  latestSuccessAt: Date | null
  oldestOverdueAt: Date | null
}>

export async function readRecommendationRetentionHealth(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<RecommendationRetentionHealth> {
  const propagationCutoff = hoursBefore(
    now,
    RECOMMENDATION_RETENTION_PROPAGATION_HOURS,
  )
  const freshnessCutoff = hoursBefore(
    now,
    RECOMMENDATION_RETENTION_HEALTH_HOURS,
  )
  const [snapshot] = await prisma.$queryRaw<
    Array<{
      latestSuccessAt: Date | null
      oldestOverdueAt: Date | null
    }>
  >(Prisma.sql`
    SELECT
      (
        SELECT max(completed_at)
        FROM recommendation_retention_run
        WHERE status = 'succeeded'
      ) AS "latestSuccessAt",
      LEAST(
        (SELECT min(expires_at) FROM recommendation_request WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_content_action WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_eligibility_decision WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_control_evaluation WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_shadow_evaluation WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_promotion_event WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_promotion_run WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_promotion_approval WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_experiment_evaluation WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_experiment_evaluation_run WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_experiment_assignment WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_experiment WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_profile_projection_run WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_profile_projection_contribution WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_profile_interest WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_profile_projection_generation WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_playback_episode WHERE request_id IS NULL AND expires_at <= ${propagationCutoff})
      ) AS "oldestOverdueAt"
  `)
  const latestSuccessAt = snapshot?.latestSuccessAt ?? null
  const oldestOverdueAt = snapshot?.oldestOverdueAt ?? null
  if (oldestOverdueAt) {
    return {
      healthy: false,
      reason: "retention_overdue",
      latestSuccessAt,
      oldestOverdueAt,
    }
  }
  if (latestSuccessAt == null || latestSuccessAt < freshnessCutoff) {
    return {
      healthy: false,
      reason: "missing_success_watermark",
      latestSuccessAt,
      oldestOverdueAt: null,
    }
  }
  return {
    healthy: true,
    reason: "healthy",
    latestSuccessAt,
    oldestOverdueAt: null,
  }
}

function earliestDate(values: Array<Date | null | undefined>): Date | null {
  return values.reduce<Date | null>((oldest, candidate) => {
    if (!candidate) return oldest
    return !oldest || candidate < oldest ? candidate : oldest
  }, null)
}
