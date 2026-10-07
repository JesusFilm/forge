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
import { unlinkPushViewerIdentities } from "@/services/push/identity-unlink.service"
import { RECOMMENDATION_RETENTION_PROPAGATION_HOURS } from "./contracts"
import { suppressCowatchForProfiles } from "./cowatch/privacy"
import { purgeExpiredCowatchRefreshMetadata } from "./cowatch/refresh-retention"
import { purgeExpiredCompositionEvidence } from "./composition/service"
import { purgeExpiredOwnerReleases } from "./promotion/owner-authority"
import { purgeExpiredCowatchTrialAuthorities } from "./cowatch/trial-authority.service"
import { purgeExpiredPrecomputedVisitRoots } from "./precomputed/visit-retention"
import { purgeExpiredPrecomputedGenerations } from "./precomputed/generation-retention"
import { RecommendationConflictError, RecommendationInputError } from "./errors"
import { lockRetentionRoots } from "./retention-locks"

export const RECOMMENDATION_RETENTION_BATCH_SIZE = 100
export const RECOMMENDATION_RETENTION_MAX_BATCH_SIZE = 5_000
export const RECOMMENDATION_RETENTION_RUN_DAYS = 90
export const RECOMMENDATION_RETENTION_HEALTH_HOURS = 36
const RECOMMENDATION_PROFILE_AUDIT_DAYS = 365
const RECOMMENDATION_RETENTION_LOCK_ID = 368_000_001
const RECOMMENDATION_RETENTION_TIMEOUT_MS = 5_000
// An admitted phase may still exhaust the deadline; that remains a failure.
const RECOMMENDATION_RETENTION_MIN_PHASE_ADMISSION_MS = 750
const RECOMMENDATION_RETENTION_ROOT_CHUNK_SIZE = 50
const RECOMMENDATION_RETENTION_STANDALONE_EPISODE_PAGE_SIZE = 5
class RetentionPhaseBusy extends RecommendationConflictError {}
class RetentionBudgetYield extends Error {}

type RetiringProfile = Readonly<{ id: string; privacyGeneration: number }>

export type RecommendationPurgeResult = Readonly<{
  status: "succeeded" | "skipped" | "yielded"
  runId: string
  rootsDeleted: number
  rowCounts: Record<string, number>
  oldestExpiredAtAfter: string | null
  overdueAfterRun: boolean | null
  batchLimitReached: boolean
  continuationRequired?: boolean
  profileVectorSweepSkipped?: boolean
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
    // Split the relation OR into request-led branches to give PostgreSQL a
    // bounded count path. UNION keeps once-per-decision accounting.
    tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*) AS count FROM (
        SELECT decision.id FROM recommendation_outcome_revision outcome
        JOIN recommendation_eligibility_decision decision
          ON decision.outcome_id = outcome.id
        WHERE outcome.request_id = ANY(${requestIds}::text[])
        UNION
        SELECT decision.id FROM recommendation_content_action action
        JOIN recommendation_eligibility_decision decision
          ON decision.content_action_id = action.id
        WHERE action.request_id = ANY(${requestIds}::text[])
      ) counted
    `),
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
    eligibilityDecisions: Number(eligibilityDecisions[0]?.count ?? 0),
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
 * Resumable bounded phases reacquire the same advisory transaction lock on one
 * connection. No lock survives a phase commit. Individual request/profile
 * erasure stays atomic; partial failure retains counts without a success watermark.
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

  const rowCounts: Record<string, number> = {}
  let profileVectorSweepSkipped = false
  const deadline = Date.now() + RECOMMENDATION_RETENTION_TIMEOUT_MS
  const phase = async <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { terminal?: boolean } = {},
  ): Promise<T> => {
    const remaining = deadline - Date.now()
    if (remaining <= 0)
      throw new RecommendationConflictError(
        "Recommendation retention batch deadline exceeded",
      )
    if (
      !options.terminal &&
      remaining <= RECOMMENDATION_RETENTION_MIN_PHASE_ADMISSION_MS
    )
      throw new RetentionBudgetYield()
    const before = { ...rowCounts }
    try {
      return await prisma.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<
            Array<{ locked: boolean }>
          >(Prisma.sql`
          SELECT pg_try_advisory_xact_lock(${RECOMMENDATION_RETENTION_LOCK_ID}) AS locked
        `)
          if (!lock?.locked)
            throw new RetentionPhaseBusy(
              "Recommendation retention phase lock not acquired",
            )
          const admittedRemaining = deadline - Date.now()
          if (admittedRemaining <= 0)
            throw new RecommendationConflictError(
              "Recommendation retention batch deadline exceeded",
            )
          if (
            !options.terminal &&
            admittedRemaining <= RECOMMENDATION_RETENTION_MIN_PHASE_ADMISSION_MS
          )
            throw new RetentionBudgetYield()
          await tx.$queryRaw(
            Prisma.sql`SELECT set_config('statement_timeout', ${String(admittedRemaining)}, true), set_config('transaction_timeout', ${String(admittedRemaining)}, true)`,
          )

          const result = await operation(tx)
          await tx.recommendationRetentionRun.update({
            where: { id: run.id },
            data: {
              rootsDeleted: rowCounts.requests ?? 0,
              rowCounts,
            },
          })
          return result
        },
        { timeout: remaining, maxWait: remaining },
      )
    } catch (error) {
      for (const key of Object.keys(rowCounts)) delete rowCounts[key]
      Object.assign(rowCounts, before)
      throw error
    }
  }
  const countPhase = (
    key: string,
    operation: (tx: Prisma.TransactionClient) => Promise<{ count: number }>,
  ) =>
    phase(async (tx) => {
      rowCounts[key] = (await operation(tx)).count
    })
  try {
    const roots = await phase((tx) =>
      tx.recommendationRequest.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      }),
    )
    const requestIds = roots.map((root) => root.id)
    // Private Watch test visits are independent roots: empty deliveries have
    // no recommendation_request to carry them through ordinary request purge.
    const precomputedPurge = await phase(async (tx) => {
      const result = await purgeExpiredPrecomputedVisitRoots(
        tx,
        now,
        batchSize,
        requestIds,
      )
      rowCounts.expiredPrecomputedVisits = result.visitsDeleted
      rowCounts.expiredPrecomputedExperiments = result.experimentsDeleted
      rowCounts.expiredPrecomputedControlEvents = result.controlEventsDeleted
      rowCounts.expiredPrecomputedBaselineVisits = result.baselineVisitsDeleted
      rowCounts.expiredPrecomputedBaselineRuns = result.baselineRunsDeleted
      rowCounts.expiredPrecomputedLaunchCapacityReceipts =
        result.launchCapacityReceiptsDeleted
      return result
    })
    // One generation at a time; a large terminal graph enters the non-servable
    // retiring state and drains bounded child pages on subsequent passes.
    const precomputedGenerationPurge = await phase(async (tx) => {
      const result = await purgeExpiredPrecomputedGenerations(tx, now, 1)
      rowCounts.expiredPrecomputedGenerations = result.generationsDeleted
      rowCounts.abandonedPrecomputedGenerations = result.generationsAbandoned
      rowCounts.retiringPrecomputedGenerations = result.generationsRetiring
      rowCounts.precomputedGenerationFinalSources = result.finalSourcesDeleted
      rowCounts.precomputedGenerationBuildSources = result.buildSourcesDeleted
      rowCounts.precomputedGenerationChoices =
        result.provisionalChoicesDeleted + result.provisionalChoicesPruned
      rowCounts.precomputedGenerationModelCalls = result.modelCallsDeleted
      rowCounts.precomputedGenerationHistoryCalls = result.historyCallsDeleted
      rowCounts.precomputedGenerationCheckpointsCleared =
        result.checkpointsCleared
      rowCounts.precomputedGenerationProofsExpired = result.proofsDeleted
      return result
    })
    await phase(async (tx) => {
      const removed = await purgeExpiredCompositionEvidence(tx, now)
      rowCounts.expiredCompositionObservations = removed.observations
      rowCounts.expiredCompositionProtocols = removed.protocols
    })
    await phase(async (tx) => {
      rowCounts.expiredCowatchTrialAuthorities =
        await purgeExpiredCowatchTrialAuthorities(tx, now)
    })
    await phase(async (tx) => {
      rowCounts.expiredOwnerReleases = await purgeExpiredOwnerReleases(tx, now)
    })
    await phase(async (tx) => {
      const removed = await purgeExpiredCowatchRefreshMetadata(tx, now)
      rowCounts.expiredCowatchRefreshAttempts = removed.attempts
      rowCounts.expiredCowatchRefreshGrants = removed.grants
    })
    const expiredWatchExposures = await phase((tx) =>
      tx.watchSurfaceExposure.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      }),
    )
    await countPhase("expiredWatchSurfaceExposures", (tx) =>
      tx.watchSurfaceExposure.deleteMany({
        where: { id: { in: expiredWatchExposures.map(({ id }) => id) } },
      }),
    )
    const directActions = await phase((tx) =>
      tx.recommendationContentAction.findMany({
        where: { requestId: null, expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      }),
    )
    const directActionIds = directActions.map((action) => action.id)
    // Preserve per-episode dependency admission and atomic deletion, but cap
    // this pre-root phase independently so a playback backlog cannot consume
    // the whole run before expired requests are reached.
    const standaloneEpisodePageSize = Math.min(
      batchSize,
      RECOMMENDATION_RETENTION_STANDALONE_EPISODE_PAGE_SIZE,
    )
    const standaloneEpisodes = await phase((tx) =>
      tx.recommendationPlaybackEpisode.findMany({
        where: { requestId: null, expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: standaloneEpisodePageSize,
        select: { id: true },
      }),
    )
    const standaloneEpisodeIds = standaloneEpisodes.map(({ id }) => id)
    rowCounts.expiredStandalonePlaybackFacts = 0
    rowCounts.expiredStandaloneOutcomes = 0
    rowCounts.expiredStandaloneEpisodes = 0
    for (const episodeId of standaloneEpisodeIds) {
      await phase(async (tx) => {
        await lockRetentionRoots(tx, { episodeIds: [episodeId] })
        const current = await tx.recommendationPlaybackEpisode.findFirst({
          where: { id: episodeId, requestId: null, expiresAt: { lte: now } },
          select: { id: true },
        })
        if (!current) return
        rowCounts.expiredStandalonePlaybackFacts +=
          await tx.recommendationPlaybackFact.count({ where: { episodeId } })
        rowCounts.expiredStandaloneOutcomes +=
          await tx.recommendationOutcomeRevision.count({ where: { episodeId } })
        rowCounts.expiredStandaloneEpisodes += (
          await tx.recommendationPlaybackEpisode.deleteMany({
            where: { id: episodeId },
          })
        ).count
      })
    }
    await phase(async (tx) => {
      const actions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM recommendation_content_action WHERE id = ANY(${directActionIds}::text[])
          AND request_id IS NULL AND expires_at <= ${now} ORDER BY id FOR UPDATE
      `)
      const admittedIds = actions.map(({ id }) => id)
      rowCounts.expiredEligibilityDecisions =
        admittedIds.length === 0
          ? 0
          : await tx.recommendationEligibilityDecision.count({
              where: { contentActionId: { in: admittedIds } },
            })
      rowCounts.expiredContentActions = (
        await tx.recommendationContentAction.deleteMany({
          where: { id: { in: admittedIds } },
        })
      ).count
    })
    for (
      let start = 0;
      start < requestIds.length;
      start += RECOMMENDATION_RETENTION_ROOT_CHUNK_SIZE
    ) {
      const selected = requestIds.slice(
        start,
        start + RECOMMENDATION_RETENTION_ROOT_CHUNK_SIZE,
      )
      await phase(async (tx) => {
        await lockRetentionRoots(tx, { requestIds: selected })
        const current = await tx.recommendationRequest.findMany({
          where: { id: { in: selected }, expiresAt: { lte: now } },
          select: { id: true },
        })
        const currentIds = current.map(({ id }) => id)
        if (currentIds.length === 0) return
        const unarchivedLinks =
          await tx.recommendationPrecomputedVisitRequest.count({
            where: { requestId: { in: currentIds } },
          })
        if (unarchivedLinks > 0)
          throw new RecommendationConflictError(
            "Expired request still has unarchived private visit evidence",
          )
        const children = await countRequestChildren(tx, currentIds)
        await tx.recommendationContentAction.deleteMany({
          where: { requestId: { in: currentIds }, expiresAt: { lte: now } },
        })
        const removed = await tx.recommendationRequest.deleteMany({
          where: { id: { in: currentIds } },
        })
        if (removed.count > 0)
          for (const [key, count] of Object.entries(children))
            rowCounts[key] = (rowCounts[key] ?? 0) + count
      })
    }
    await phase((tx) =>
      tx.recommendationTraceAccessAudit.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    const expiredProjectionRunPage = await phase(async (tx) => {
      const rows = await tx.recommendationProfileProjectionRun.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      })
      rowCounts.expiredProfileProjectionRuns = rows.length
        ? (
            await tx.recommendationProfileProjectionRun.deleteMany({
              where: { id: { in: rows.map(({ id }) => id) } },
            })
          ).count
        : 0
      return rows.length
    })
    const expiredContributionPage = await phase(async (tx) => {
      const rows =
        await tx.recommendationProfileProjectionContribution.findMany({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: batchSize,
          select: { id: true },
        })
      rowCounts.expiredProfileProjectionContributions = rows.length
        ? (
            await tx.recommendationProfileProjectionContribution.deleteMany({
              where: { id: { in: rows.map(({ id }) => id) } },
            })
          ).count
        : 0
      return rows.length
    })
    const expiredInterestPage = await phase(async (tx) => {
      const rows = await tx.recommendationProfileInterest.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      })
      rowCounts.expiredProfileInterests = rows.length
        ? (
            await tx.recommendationProfileInterest.deleteMany({
              where: { id: { in: rows.map(({ id }) => id) } },
            })
          ).count
        : 0
      return rows.length
    })
    // A generation may still be referenced by a live run or served decision.
    // Its old cascade would unlink every reference in one unbounded DELETE.
    const expiredRunLinkPage = await phase(async (tx) => {
      const rows = await tx.recommendationProfileProjectionRun.findMany({
        where: { projection: { is: { expiresAt: { lte: now } } } },
        orderBy: { id: "asc" },
        take: batchSize,
        select: { id: true },
      })
      rowCounts.expiredProjectionRunLinksUnlinked = rows.length
        ? (
            await tx.recommendationProfileProjectionRun.updateMany({
              where: { id: { in: rows.map(({ id }) => id) } },
              data: { projectionId: null },
            })
          ).count
        : 0
      return rows.length
    })
    const expiredDecisionLinkPage = await phase(async (tx) => {
      const rows = await tx.recommendationPersonalizationDecision.findMany({
        where: {
          projectionGeneration: { is: { expiresAt: { lte: now } } },
        },
        orderBy: { requestId: "asc" },
        take: batchSize,
        select: { requestId: true },
      })
      rowCounts.expiredProjectionDecisionLinksUnlinked = rows.length
        ? (
            await tx.recommendationPersonalizationDecision.updateMany({
              where: {
                requestId: { in: rows.map(({ requestId }) => requestId) },
              },
              data: { projectionGenerationId: null },
            })
          ).count
        : 0
      return rows.length
    })
    const expiredGenerationPage = await phase(async (tx) => {
      const where = {
        expiresAt: { lte: now },
        contributions: { none: {} },
        interests: { none: {} },
        workflowRuns: { none: {} },
        servingDecisions: { none: {} },
      }
      const rows = await tx.recommendationProfileProjectionGeneration.findMany({
        where,
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      })
      rowCounts.expiredProfileProjectionGenerations = rows.length
        ? (
            await tx.recommendationProfileProjectionGeneration.deleteMany({
              where: { ...where, id: { in: rows.map(({ id }) => id) } },
            })
          ).count
        : 0
      return rows.length
    })
    await phase(async (tx) => {
      // Publisher transactions hold this dedicated key in shared mode from
      // before their profile row locks until commit. Do not block other
      // retention phases when a publisher is active.
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(368000002) AS locked`,
      )
      if (!lock?.locked) {
        profileVectorSweepSkipped = true
        rowCounts.orphanProfileVectorSnapshots = 0
        return
      }
      rowCounts.orphanProfileVectorSnapshots = await tx.$executeRaw(Prisma.sql`
        DELETE FROM recommendation_profile_vector_snapshot snapshot
        WHERE snapshot.digest IN (
          SELECT candidate.digest
          FROM recommendation_profile_vector_snapshot candidate
          WHERE candidate.created_at < ${hoursBefore(now, 24)}
            AND NOT EXISTS (
              SELECT 1 FROM recommendation_profile_interest interest
              WHERE interest.vector_digest = candidate.digest
            )
          ORDER BY candidate.created_at, candidate.digest
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
      `)
    })
    const expiredGraphs = await phase((tx) =>
      tx.recommendationCowatchGeneration.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      }),
    )
    rowCounts.expiredCowatchGenerations = 0
    for (const graph of expiredGraphs) {
      await phase(async (tx) => {
        await lockRetentionRoots(tx, { graphIds: [graph.id] })
        rowCounts.expiredCowatchGenerations += (
          await tx.recommendationCowatchGeneration.deleteMany({
            where: { id: graph.id, expiresAt: { lte: now } },
          })
        ).count
      })
    }
    await countPhase("expiredCowatchSuppressions", (tx) =>
      tx.recommendationCowatchSuppression.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    const expiredViewers = await phase((tx) =>
      tx.recommendationViewer.findMany({
        where: { expiresAt: { lte: now } },
        take: batchSize,
        orderBy: { expiresAt: "asc" },
        select: { tokenDigest: true },
      }),
    )
    await phase(async (tx) => {
      // A viewer expiry ends the push link in the same transaction. The
      // registration keeps the phone's push address; only the digest goes.
      const pushUnlink = await unlinkPushViewerIdentities(
        tx,
        expiredViewers.map((viewer) => viewer.tokenDigest),
      )
      rowCounts.pushRegistrationsUnlinked = pushUnlink.registrationsUnlinked
      rowCounts.pushOpensDeleted = pushUnlink.opensDeleted
      rowCounts.pushAttributionsDeleted = pushUnlink.attributionsDeleted
      rowCounts.expiredViewers = (
        await tx.recommendationViewer.deleteMany({
          where: {
            tokenDigest: {
              in: expiredViewers.map((viewer) => viewer.tokenDigest),
            },
          },
        })
      ).count
    })
    await countPhase("expiredConsentReceipts", (tx) =>
      tx.recommendationConsentReceipt.updateMany({
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
      }),
    )
    const {
      expiredProfiles,
      remainingErasureCapacity,
      olderPendingProfileErasures,
    } = await phase(async (tx) => {
      const expiredProfiles = await tx.recommendationProfile.findMany({
        where: {
          state: RecommendationProfileState.ACTIVE,
          expiresAt: { lte: now },
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true, privacyGeneration: true },
      })
      const newlyExpiredProfileIds = expiredProfiles.map(({ id }) => id)
      const remainingErasureCapacity = Math.max(
        0,
        batchSize - expiredProfiles.length,
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
      await lockRetentionRoots(tx, {
        profileIds: [...expiredProfiles, ...olderPendingProfileErasures].map(
          ({ id }) => id,
        ),
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
      // Profiles fenced in this run are erased first. Otherwise an existing
      // pending backlog can leave their session-linked projections selectable
      // after the durable profile itself has expired.
      const pendingProfileErasures = [
        ...expiredProfilesFenced,
        ...olderPendingProfileErasures,
      ]
      await eraseRetiringProfileInfluence(tx, pendingProfileErasures)
      await suppressCowatchForProfiles(
        tx,
        pendingProfileErasures.map(({ id }) => id),
      )
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
      return {
        expiredProfiles,
        remainingErasureCapacity,
        olderPendingProfileErasures,
      }
    })
    await countPhase("expiredProfileSessionLinks", (tx) =>
      tx.recommendationProfileSessionLink.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    await countPhase("expiredConsentTransitions", (tx) =>
      tx.recommendationConsentTransition.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    await countPhase("expiredControlEvaluations", (tx) =>
      tx.recommendationControlEvaluation.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    const expiredShadowEvaluations = await phase((tx) =>
      tx.recommendationShadowEvaluation.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      }),
    )
    rowCounts.expiredShadowEvaluations = 0
    for (const evaluation of expiredShadowEvaluations) {
      await phase(async (tx) => {
        // Completion owns graph/protocol before its terminal evaluation write.
        // Block publication at profile/request roots, then take that same order.
        await lockRetentionRoots(tx, { evaluationIds: [evaluation.id] })
        rowCounts.expiredShadowEvaluations += (
          await tx.recommendationShadowEvaluation.deleteMany({
            where: { id: evaluation.id, expiresAt: { lte: now } },
          })
        ).count
      })
    }
    await countPhase("expiredPromotionEvents", (tx) =>
      tx.recommendationPromotionEvent.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    await countPhase("expiredPromotionRuns", (tx) =>
      tx.recommendationPromotionRun.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    await countPhase("expiredPromotionApprovals", (tx) =>
      tx.recommendationPromotionApproval.deleteMany({
        where: {
          expiresAt: { lte: now },
          pointers: { none: {} },
          runs: { none: {} },
        },
      }),
    )
    await countPhase("expiredExperimentEvaluations", (tx) =>
      tx.recommendationExperimentEvaluation.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    await countPhase("expiredExperimentEvaluationRuns", (tx) =>
      tx.recommendationExperimentEvaluationRun.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
    )
    const expiredAssignments = await phase((tx) =>
      tx.recommendationExperimentAssignment.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      }),
    )
    await phase(async (tx) => {
      await lockRetentionRoots(tx, {
        assignmentIds: expiredAssignments.map(({ id }) => id),
      })
      rowCounts.expiredExperimentAssignments = (
        await tx.recommendationExperimentAssignment.deleteMany({
          where: {
            id: { in: expiredAssignments.map(({ id }) => id) },
            expiresAt: { lte: now },
          },
        })
      ).count
    })
    const expiredExperiments = await phase((tx) =>
      tx.recommendationExperiment.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      }),
    )
    rowCounts.expiredExperiments = 0
    for (const experiment of expiredExperiments) {
      await phase(async (tx) => {
        await lockRetentionRoots(tx, { experimentIds: [experiment.id] })
        rowCounts.expiredExperiments += (
          await tx.recommendationExperiment.deleteMany({
            where: { id: experiment.id, expiresAt: { lte: now } },
          })
        ).count
      })
    }
    const retiredProfiles = await phase((tx) =>
      tx.recommendationProfile.findMany({
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
      }),
    )
    rowCounts.retiredProfilesDeleted = 0
    for (const profile of retiredProfiles) {
      await phase(async (tx) => {
        await lockRetentionRoots(tx, { profileIds: [profile.id] })
        rowCounts.retiredProfilesDeleted += (
          await tx.recommendationProfile.deleteMany({
            where: {
              id: profile.id,
              state: {
                in: [
                  RecommendationProfileState.TOMBSTONED,
                  RecommendationProfileState.EXPIRED,
                ],
              },
              erasureState: RecommendationProfileErasureState.COMPLETED,
              updatedAt: {
                lte: new Date(
                  now.getTime() -
                    RECOMMENDATION_PROFILE_AUDIT_DAYS * 86_400_000,
                ),
              },
            },
          })
        ).count
      })
    }
    await phase((tx) =>
      tx.recommendationRetentionRun.deleteMany({
        where: { id: { not: run.id }, expiresAt: { lte: now } },
      }),
    )
    const [
      oldestExpiredRoot,
      oldestExpiredPrecomputedVisit,
      oldestExpiredPrecomputedBaselineVisit,
      oldestExpiredPrecomputedExperiment,
      oldestExpiredPrecomputedBaselineRun,
      oldestExpiredWatchExposure,
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
      oldestExpiredCompositionObservation,
      oldestExpiredCompositionProtocol,
      oldestExpiredCowatchTrialAuthority,
      oldestExpiredOwnerRelease,
    ] = await phase((tx) =>
      Promise.all([
        tx.recommendationRequest.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationPrecomputedVisit.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationPrecomputedBaselineVisit.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationPrecomputedExperiment.findFirst({
          where: { expiresAt: { lte: now }, visits: { none: {} } },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.recommendationPrecomputedBaselineRun.findFirst({
          where: {
            expiresAt: { lte: now },
            enabled: false,
            visits: { none: {} },
          },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: { expiresAt: true },
        }),
        tx.watchSurfaceExposure.findFirst({
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
        tx.recommendationCompositionObservation.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: { expiresAt: "asc" },
          select: { expiresAt: true },
        }),
        tx.recommendationCompositionProtocol.findFirst({
          where: { expiresAt: { lte: now } },
          orderBy: { expiresAt: "asc" },
          select: { expiresAt: true },
        }),
        tx.recommendationCowatchTrialAuthority.findFirst({
          where: { rawPopulationExpiresAt: { lte: now } },
          orderBy: { rawPopulationExpiresAt: "asc" },
          select: { rawPopulationExpiresAt: true },
        }),
        tx.recommendationOwnerRelease.findFirst({
          where: {
            expiresAt: { lte: now },
            pointers: { none: {} },
          },
          orderBy: { expiresAt: "asc" },
          select: { expiresAt: true },
        }),
      ]),
    )
    const oldestExpiredAt = earliestDate([
      oldestExpiredRoot?.expiresAt,
      oldestExpiredPrecomputedVisit?.expiresAt,
      oldestExpiredPrecomputedBaselineVisit?.expiresAt,
      oldestExpiredPrecomputedExperiment?.expiresAt,
      oldestExpiredPrecomputedBaselineRun?.expiresAt,
      oldestExpiredWatchExposure?.expiresAt,
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
      oldestExpiredCompositionObservation?.expiresAt,
      oldestExpiredCompositionProtocol?.expiresAt,
      oldestExpiredCowatchTrialAuthority?.rawPopulationExpiresAt,
      oldestExpiredOwnerRelease?.expiresAt,
    ])
    const overdueAfterRun =
      oldestExpiredAt != null &&
      oldestExpiredAt <=
        hoursBefore(now, RECOMMENDATION_RETENTION_PROPAGATION_HOURS)
    // A full selection may leave more expired roots. An exact-size batch
    // causes one harmless empty follow-up; no additional database scan is
    // needed to keep younger expired backlog moving before it is overdue.
    const batchLimitReached =
      oldestExpiredCompositionObservation != null ||
      oldestExpiredCompositionProtocol != null ||
      oldestExpiredCowatchTrialAuthority != null ||
      oldestExpiredOwnerRelease != null ||
      oldestExpiredProfileProjectionRun != null ||
      oldestExpiredProfileProjectionContribution != null ||
      oldestExpiredProfileInterest != null ||
      oldestExpiredProfileProjectionGeneration != null ||
      requestIds.length === batchSize ||
      precomputedPurge.visitPageFull ||
      precomputedPurge.experimentPageFull ||
      precomputedPurge.controlEventPageFull ||
      precomputedPurge.launchCapacityReceiptPageFull ||
      precomputedPurge.baselineVisitPageFull ||
      precomputedPurge.baselineFinalizationPageFull ||
      precomputedPurge.baselineRunPageFull ||
      precomputedGenerationPurge.pageFull ||
      expiredWatchExposures.length === batchSize ||
      directActionIds.length === batchSize ||
      standaloneEpisodeIds.length === standaloneEpisodePageSize ||
      expiredProjectionRunPage === batchSize ||
      expiredContributionPage === batchSize ||
      expiredInterestPage === batchSize ||
      expiredRunLinkPage === batchSize ||
      expiredDecisionLinkPage === batchSize ||
      expiredGenerationPage === batchSize ||
      expiredViewers.length === batchSize ||
      expiredProfiles.length === batchSize ||
      (remainingErasureCapacity > 0 &&
        olderPendingProfileErasures.length === remainingErasureCapacity) ||
      expiredGraphs.length === batchSize ||
      expiredShadowEvaluations.length === batchSize ||
      expiredAssignments.length === batchSize ||
      expiredExperiments.length === batchSize ||
      retiredProfiles.length === batchSize ||
      rowCounts.orphanProfileVectorSnapshots === batchSize
    await phase(
      (tx) =>
        tx.recommendationRetentionRun.update({
          where: { id: run.id },
          data: {
            status: RecommendationRetentionRunStatus.SUCCEEDED,
            rootsDeleted: rowCounts.requests ?? 0,
            rowCounts: rowCounts satisfies Prisma.InputJsonValue,
            oldestExpiredAtAfter: oldestExpiredAt,
            reasonCode: overdueAfterRun ? "overdue_roots_remain" : null,
            completedAt: now,
          },
        }),
      { terminal: true },
    )
    return {
      status: "succeeded",
      runId: run.id,
      rootsDeleted: rowCounts.requests ?? 0,
      rowCounts,
      oldestExpiredAtAfter: oldestExpiredAt?.toISOString() ?? null,
      overdueAfterRun,
      batchLimitReached,
      profileVectorSweepSkipped,
    }
  } catch (error) {
    let failure = error
    if (failure instanceof RetentionBudgetYield) {
      try {
        // Every earlier phase committed its counters with its own mutations.
        // This phase was refused before work, so the remaining backlog is
        // deliberately unknown and the scheduler must continue immediately.
        await phase(
          (tx) =>
            tx.recommendationRetentionRun.update({
              where: { id: run.id },
              data: {
                status: RecommendationRetentionRunStatus.SKIPPED,
                rootsDeleted: rowCounts.requests ?? 0,
                rowCounts: rowCounts satisfies Prisma.InputJsonValue,
                oldestExpiredAtAfter: null,
                reasonCode: "budget_yield",
                completedAt: now,
              },
            }),
          { terminal: true },
        )
        return {
          status: "yielded",
          runId: run.id,
          rootsDeleted: rowCounts.requests ?? 0,
          rowCounts,
          oldestExpiredAtAfter: null,
          overdueAfterRun: null,
          // Older scheduler steps only know this continuation bit. A budget
          // yield is incomplete even when no row-count cap was reached.
          batchLimitReached: true,
          continuationRequired: true,
          profileVectorSweepSkipped,
        }
      } catch (terminalError) {
        failure = terminalError
      }
    }
    const lockBusy = failure instanceof RetentionPhaseBusy
    const durable = await prisma.recommendationRetentionRun.update({
      where: { id: run.id },
      data: {
        status: lockBusy
          ? RecommendationRetentionRunStatus.SKIPPED
          : RecommendationRetentionRunStatus.FAILED,
        // Counts are committed with each mutation phase. An uncertain COMMIT
        // acknowledgement must never overwrite them with a local snapshot.
        reasonCode: lockBusy
          ? "lock_not_acquired"
          : failure instanceof Error
            ? failure.constructor.name.slice(0, 64)
            : "UnknownError",
        completedAt: now,
      },
    })
    if (lockBusy) {
      const counts = durable?.rowCounts
      const committedCounts =
        counts != null && typeof counts === "object" && !Array.isArray(counts)
          ? Object.fromEntries(
              Object.entries(counts).filter(
                (entry): entry is [string, number] =>
                  typeof entry[1] === "number",
              ),
            )
          : rowCounts
      return {
        status: "skipped",
        runId: run.id,
        rootsDeleted: durable?.rootsDeleted ?? committedCounts.requests ?? 0,
        rowCounts: committedCounts,
        oldestExpiredAtAfter: null,
        overdueAfterRun: false,
        batchLimitReached: Object.keys(committedCounts).length > 0,
        profileVectorSweepSkipped,
      }
    }
    throw failure
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
        (SELECT min(expires_at) FROM recommendation_viewer WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_request WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_precomputed_visit WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_precomputed_baseline_visit WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_precomputed_baseline_run
          WHERE expires_at <= ${propagationCutoff} AND enabled = false
            AND NOT EXISTS (
              SELECT 1 FROM recommendation_precomputed_baseline_visit AS visit
              WHERE visit.run_id = recommendation_precomputed_baseline_run.id
            )),
        (SELECT min(expires_at) FROM recommendation_precomputed_experiment AS experiment
          WHERE expires_at <= ${propagationCutoff}
            AND NOT EXISTS (
              SELECT 1 FROM recommendation_precomputed_visit AS visit
              WHERE visit.experiment_id = experiment.id
            )),
        (SELECT min(expires_at) FROM recommendation_content_action WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_eligibility_decision WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_control_evaluation WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_shadow_evaluation WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_composition_observation WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(expires_at) FROM recommendation_composition_protocol WHERE expires_at <= ${propagationCutoff}),
        (SELECT min(raw_population_expires_at) FROM recommendation_cowatch_trial_authority WHERE raw_population_expires_at <= ${propagationCutoff}),
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
