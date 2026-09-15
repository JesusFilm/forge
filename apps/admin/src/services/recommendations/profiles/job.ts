import { createHash, randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationProfileProjectionRunState,
  RecommendationProfileProjectionScope,
} from "@prisma/client"
import { start } from "workflow/api"
import { prisma } from "@/db/client"
import { runRecommendationProfileProjection } from "@/workflows/recommendationProfileProjection"
import { RecommendationInternalStateError } from "../errors"
import { createDatabaseRecommendationProfileProjectionService } from "./profile-projection.service"

export const RECOMMENDATION_PROFILE_PROJECTION_WORKFLOW_KEY =
  "recommendation-profile-projection"
export const RECOMMENDATION_PROFILE_PROJECTION_COALESCE_MS = 5 * 60_000
export const RECOMMENDATION_PROFILE_PROJECTION_LEASE_MS = 5 * 60_000
export const RECOMMENDATION_PROFILE_PROJECTION_MAX_ATTEMPTS = 3
export const RECOMMENDATION_PROFILE_RECONCILIATION_BATCH_SIZE = 100

export type RecommendationProfileProjectionJobInput = Readonly<{
  runId: string
  expectedGeneration: number
}>

export async function dispatchRecommendationProfileProjection(input: {
  sessionDigest: string | null
  profileId: string | null
  privacyGeneration: number | null
  now?: Date
  evidenceWatermark?: Date
  reconciliationCause?: string
  force?: boolean
}): Promise<{
  queued: true
  runId: string
  workflowRunId: string | null
  coalesced: boolean
}> {
  const result = await prepareRecommendationProfileProjection(input, false)
  if (!result) {
    throw new RangeError("Recommendation projection privacy scope is invalid")
  }
  return dispatchPreparedRecommendationProfileProjection(result, input.now)
}

async function prepareRecommendationProfileProjection(
  input: {
    sessionDigest: string | null
    profileId: string | null
    privacyGeneration: number | null
    now?: Date
    evidenceWatermark?: Date
    reconciliationCause?: string
    force?: boolean
  },
  requireActiveProfileSessionLink: boolean,
) {
  const now = input.now ?? new Date()
  if (
    input.sessionDigest != null &&
    !/^[a-f0-9]{64}$/.test(input.sessionDigest)
  ) {
    throw new RangeError("Recommendation projection session digest is invalid")
  }
  if (input.profileId == null && input.sessionDigest == null) {
    throw new RangeError("Session projection requires a session digest")
  }
  if ((input.profileId == null) !== (input.privacyGeneration == null)) {
    throw new RangeError("Recommendation projection privacy scope is invalid")
  }
  const scopeDigest = profileProjectionScopeDigest(input)
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`profile-projection-dispatch:${scopeDigest}`}, 459)
      )
    `)
    if (requireActiveProfileSessionLink) {
      if (
        input.profileId == null ||
        input.privacyGeneration == null ||
        input.sessionDigest == null
      )
        return null
      const profile = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM recommendation_profile
        WHERE id = ${input.profileId}
          AND state = 'active'
          AND token_digest IS NOT NULL
          AND privacy_generation = ${input.privacyGeneration}
          AND expires_at > ${now}
        FOR SHARE
      `)
      if (profile.length !== 1) return null
      const link = await tx.recommendationProfileSessionLink.findFirst({
        where: {
          profileId: input.profileId,
          privacyGeneration: input.privacyGeneration,
          sessionDigest: input.sessionDigest,
          expiresAt: { gt: now },
        },
        select: { id: true },
      })
      if (!link) return null
    }
    const recent = input.force
      ? null
      : await tx.recommendationProfileProjectionRun.findFirst({
          where: {
            profileId: input.profileId,
            privacyGeneration: input.privacyGeneration,
            sessionDigest: input.sessionDigest,
            state: {
              in: [
                RecommendationProfileProjectionRunState.PENDING,
                RecommendationProfileProjectionRunState.CLAIMED,
                RecommendationProfileProjectionRunState.COMPLETED,
              ],
            },
            createdAt: {
              gte: new Date(
                Math.max(
                  now.getTime() - RECOMMENDATION_PROFILE_PROJECTION_COALESCE_MS,
                  input.evidenceWatermark?.getTime() ?? 0,
                ),
              ),
            },
            expiresAt: { gt: now },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            workflowRunId: true,
            generation: true,
            state: true,
          },
        })
    if (recent) {
      const dispatchWasNeverRecorded =
        recent.state === RecommendationProfileProjectionRunState.PENDING &&
        recent.workflowRunId == null
      return { run: recent, coalesced: !dispatchWasNeverRecorded }
    }
    const pointer = await tx.$queryRaw<
      Array<{ generationId: string; pointerGeneration: number }>
    >(Prisma.sql`
      SELECT
        generation_id AS "generationId",
        pointer_generation AS "pointerGeneration"
      FROM recommendation_profile_projection_pointer
      WHERE scope_digest = ${scopeDigest}
      LIMIT 1
    `)
    const run = await tx.recommendationProfileProjectionRun.create({
      data: {
        scope: input.profileId
          ? RecommendationProfileProjectionScope.DURABLE
          : RecommendationProfileProjectionScope.SESSION,
        profileId: input.profileId,
        privacyGeneration: input.privacyGeneration,
        // The run is private workflow truth. Durable projections still need the
        // initiating session to build the separately bounded session-intent
        // channel; the published durable generation never stores this digest.
        sessionDigest: input.sessionDigest,
        reconciliationCause: boundedReason(
          input.reconciliationCause ?? "projection_request",
        ),
        expectedGenerationId: pointer[0]?.generationId ?? null,
        expectedPointerGeneration: pointer[0]?.pointerGeneration ?? 0,
        expiresAt: new Date(now.getTime() + 24 * 3_600_000),
      },
    })
    return { run, coalesced: false as const }
  })
}

async function dispatchPreparedRecommendationProfileProjection(
  prepared: {
    run: { id: string; generation: number; workflowRunId?: string | null }
    coalesced: boolean
  },
  suppliedNow?: Date,
) {
  if (prepared.coalesced) {
    return {
      queued: true as const,
      runId: prepared.run.id,
      workflowRunId: prepared.run.workflowRunId ?? null,
      coalesced: true,
    }
  }
  const now = suppliedNow ?? new Date()
  const run = prepared.run
  let workflow: Awaited<ReturnType<typeof start>>
  try {
    workflow = await start(runRecommendationProfileProjection, [
      { runId: run.id, expectedGeneration: run.generation },
    ])
  } catch (error) {
    await prisma.recommendationProfileProjectionRun.updateMany({
      where: {
        id: run.id,
        generation: run.generation,
        state: RecommendationProfileProjectionRunState.PENDING,
      },
      data: {
        failureReason: null,
        lastTransitionReason: "workflow_dispatch_failed",
        completedAt: null,
      },
    })
    throw error
  }
  await prisma.recommendationProfileProjectionRun
    .updateMany({
      where: {
        id: run.id,
        generation: run.generation,
        OR: [
          { state: RecommendationProfileProjectionRunState.PENDING },
          {
            state: RecommendationProfileProjectionRunState.CLAIMED,
            leaseExpiresAt: { lte: now },
          },
        ],
        AND: [
          {
            OR: [
              { workflowRunId: null },
              { workflowRunId: { not: workflow.runId } },
            ],
          },
        ],
      },
      data: { workflowRunId: workflow.runId },
    })
    .catch(() => {
      console.warn(
        "Recommendation profile projection started before its runtime identity could be recorded; workflow self-reconciliation will retry.",
      )
    })
  return {
    queued: true as const,
    runId: run.id,
    workflowRunId: workflow.runId,
    coalesced: false as const,
  }
}

export async function redispatchRecommendationProfileProjectionRun(input: {
  runId: string
  expectedGeneration: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  const run = await prisma.recommendationProfileProjectionRun.findFirst({
    where: {
      id: input.runId,
      generation: input.expectedGeneration,
      expiresAt: { gt: now },
      attemptCount: { lt: RECOMMENDATION_PROFILE_PROJECTION_MAX_ATTEMPTS },
      OR: [
        {
          state: RecommendationProfileProjectionRunState.PENDING,
          workflowRunId: null,
        },
        {
          state: RecommendationProfileProjectionRunState.PENDING,
          lastTransitionReason: { not: null },
        },
        {
          state: RecommendationProfileProjectionRunState.CLAIMED,
          leaseExpiresAt: { lte: now },
        },
      ],
    },
    select: { id: true, generation: true, workflowRunId: true },
  })
  if (!run) return null
  return dispatchPreparedRecommendationProfileProjection(
    { run, coalesced: false },
    now,
  )
}

export async function markRecommendationProfileProjectionRuntimeStarted(
  input: RecommendationProfileProjectionJobInput,
  runtimeRunId: string,
): Promise<void> {
  const now = new Date()
  await prisma.recommendationProfileProjectionRun.updateMany({
    where: {
      id: input.runId,
      generation: input.expectedGeneration,
      OR: [
        { state: RecommendationProfileProjectionRunState.PENDING },
        {
          state: RecommendationProfileProjectionRunState.CLAIMED,
          leaseExpiresAt: { lte: now },
        },
      ],
      AND: [
        {
          OR: [
            { workflowRunId: null },
            { workflowRunId: { not: runtimeRunId } },
          ],
        },
      ],
    },
    data: { workflowRunId: runtimeRunId },
  })
}

export async function dispatchRecommendationProfileFeedback(input: {
  sessionDigest: string
  profileId: string
  privacyGeneration: number
  evidenceWatermark: Date
  now?: Date
}) {
  const now = input.now ?? new Date()
  const prepared = await prepareRecommendationProfileProjection(
    {
      sessionDigest: input.sessionDigest,
      profileId: input.profileId,
      privacyGeneration: input.privacyGeneration,
      evidenceWatermark: input.evidenceWatermark,
      reconciliationCause: "evidence_advanced",
      now,
    },
    true,
  )
  const durable = prepared
    ? await dispatchPreparedRecommendationProfileProjection(prepared, now)
    : null
  return {
    session: null,
    durable,
    skipped: durable == null ? "profile_generation_unavailable" : null,
  }
}

export async function runRecommendationProfileProjectionJob(
  input: RecommendationProfileProjectionJobInput,
): Promise<
  | Readonly<{
      status: "published"
      generationId: string
      projectionGeneration: number
      replay: boolean
    }>
  | Readonly<{ status: "fenced"; reason: string }>
> {
  const now = new Date()
  const run = await prisma.recommendationProfileProjectionRun.findUnique({
    where: { id: input.runId },
  })
  if (!run) return { status: "fenced", reason: "run_missing" }
  if (
    run.scope === RecommendationProfileProjectionScope.SESSION &&
    !run.sessionDigest
  ) {
    return { status: "fenced", reason: "session_scope_missing" }
  }
  if (
    run.state === RecommendationProfileProjectionRunState.COMPLETED &&
    run.projectionId
  ) {
    return {
      status: "published",
      generationId: run.projectionId,
      projectionGeneration: run.generation,
      replay: true,
    }
  }
  const claimId = randomUUID()
  const leaseExpiresAt = new Date(
    now.getTime() + RECOMMENDATION_PROFILE_PROJECTION_LEASE_MS,
  )
  const claimed = await prisma.$queryRaw<
    Array<{ generation: number; attemptCount: number }>
  >(Prisma.sql`
    UPDATE recommendation_profile_projection_run
    SET state = 'claimed',
        generation = CASE WHEN state = 'claimed' THEN generation + 1 ELSE generation END,
        attempt_count = attempt_count + 1,
        claim_id = ${claimId}::uuid,
        claimed_at = ${now},
        heartbeat_at = ${now},
        lease_expires_at = ${leaseExpiresAt},
        last_transition_reason = CASE
          WHEN state = 'claimed' THEN 'expired_claim_reclaimed'
          ELSE 'claim_acquired'
        END,
        completed_at = NULL,
        failure_reason = NULL
    WHERE id = ${run.id}
      AND generation = ${input.expectedGeneration}
      AND expires_at > ${now}
      AND attempt_count < ${RECOMMENDATION_PROFILE_PROJECTION_MAX_ATTEMPTS}
      AND (
        state = 'pending'
        OR (state = 'claimed' AND lease_expires_at <= ${now})
      )
    RETURNING generation, attempt_count AS "attemptCount"
  `)
  const activeClaim = claimed[0]
  if (!activeClaim) {
    await prisma.recommendationProfileProjectionRun.updateMany({
      where: {
        id: run.id,
        generation: input.expectedGeneration,
        state: {
          in: [
            RecommendationProfileProjectionRunState.PENDING,
            RecommendationProfileProjectionRunState.CLAIMED,
          ],
        },
        attemptCount: {
          gte: RECOMMENDATION_PROFILE_PROJECTION_MAX_ATTEMPTS,
        },
      },
      data: {
        state: RecommendationProfileProjectionRunState.FAILED,
        failureReason: "projection_attempts_exhausted",
        lastTransitionReason: "projection_attempts_exhausted",
        completedAt: now,
        claimId: null,
        leaseExpiresAt: null,
      },
    })
    return { status: "fenced", reason: "claim_generation_changed" }
  }
  try {
    const service = createDatabaseRecommendationProfileProjectionService(prisma)
    const receipt = await service.project({
      sessionDigest: run.sessionDigest,
      profileId: run.profileId,
      privacyGeneration: run.privacyGeneration,
      now,
      expectedPointer:
        run.expectedPointerGeneration != null
          ? {
              generationId: run.expectedGenerationId,
              pointerGeneration: run.expectedPointerGeneration,
            }
          : null,
      runFence: {
        runId: run.id,
        claimId,
        generation: activeClaim.generation,
      },
    })
    const completed =
      await prisma.recommendationProfileProjectionRun.updateMany({
        where: {
          id: run.id,
          generation: activeClaim.generation,
          state: RecommendationProfileProjectionRunState.CLAIMED,
          claimId,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          state: RecommendationProfileProjectionRunState.COMPLETED,
          projectionId: receipt.generationId,
          completedAt: now,
          heartbeatAt: now,
          leaseExpiresAt: null,
          claimId: null,
          failureReason: null,
          lastTransitionReason: "projection_published",
        },
      })
    if (completed.count !== 1) {
      return { status: "fenced", reason: "completion_generation_changed" }
    }
    return {
      status: "published",
      generationId: receipt.generationId,
      projectionGeneration: receipt.generation,
      replay: receipt.replay,
    }
  } catch (error) {
    const failureReason = profileProjectionFailureReason(error)
    const retryable =
      activeClaim.attemptCount <
        RECOMMENDATION_PROFILE_PROJECTION_MAX_ATTEMPTS &&
      !failureReason.endsWith("_fenced") &&
      failureReason !== "privacy_generation_revoked"
    await prisma.recommendationProfileProjectionRun.updateMany({
      where: {
        id: run.id,
        generation: activeClaim.generation,
        state: RecommendationProfileProjectionRunState.CLAIMED,
        claimId,
      },
      data: {
        state: retryable
          ? RecommendationProfileProjectionRunState.PENDING
          : failureReason.endsWith("_fenced")
            ? RecommendationProfileProjectionRunState.FENCED
            : RecommendationProfileProjectionRunState.FAILED,
        failureReason: retryable ? null : failureReason,
        lastTransitionReason: failureReason,
        completedAt: retryable ? null : now,
        heartbeatAt: now,
        leaseExpiresAt: null,
        claimId: null,
      },
    })
    throw error
  }
}

function profileProjectionFailureReason(error: unknown): string {
  if (error instanceof RecommendationInternalStateError) {
    switch (error.code) {
      case "profile_projection_generation_revoked":
        return "privacy_generation_revoked"
      case "profile_projection_embedding_dimension_invalid":
        return "embedding_dimension_invalid"
      case "profile_projection_pointer_fenced":
        return "pointer_generation_fenced"
      case "profile_projection_input_fenced":
        return "eligibility_input_fenced"
      case "profile_projection_claim_fenced":
        return "claim_generation_fenced"
    }
  }
  return "profile_projection_failed"
}

function profileProjectionScopeDigest(input: {
  profileId: string | null
  privacyGeneration: number | null
  sessionDigest: string | null
}): string {
  return createHash("sha256")
    .update(
      input.profileId
        ? `durable:${input.profileId}:${input.privacyGeneration}`
        : `session:${input.sessionDigest}`,
    )
    .digest("hex")
}

function boundedReason(value: string): string {
  return /^[a-z0-9_]{1,64}$/.test(value) ? value : "projection_request"
}
