import { randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationProfileProjectionRunState,
  RecommendationProfileProjectionScope,
} from "@prisma/client"
import { start } from "workflow/api"
import { prisma } from "@/db/client"
import { runRecommendationProfileProjection } from "@/workflows/recommendationProfileProjection"
import { createDatabaseRecommendationProfileProjectionService } from "./profile-projection.service"

export const RECOMMENDATION_PROFILE_PROJECTION_WORKFLOW_KEY =
  "recommendation-profile-projection"
export const RECOMMENDATION_PROFILE_PROJECTION_COALESCE_MS = 5 * 60_000

export type RecommendationProfileProjectionJobInput = Readonly<{
  runId: string
  expectedGeneration: number
}>

export async function dispatchRecommendationProfileProjection(input: {
  sessionDigest: string
  profileId: string | null
  privacyGeneration: number | null
  now?: Date
  evidenceWatermark?: Date
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
    sessionDigest: string
    profileId: string | null
    privacyGeneration: number | null
    now?: Date
    evidenceWatermark?: Date
  },
  requireActiveProfileSessionLink: boolean,
) {
  const now = input.now ?? new Date()
  if (!/^[a-f0-9]{64}$/.test(input.sessionDigest)) {
    throw new RangeError("Recommendation projection session digest is invalid")
  }
  if ((input.profileId == null) !== (input.privacyGeneration == null)) {
    throw new RangeError("Recommendation projection privacy scope is invalid")
  }
  return prisma.$transaction(async (tx) => {
    if (requireActiveProfileSessionLink) {
      if (input.profileId == null || input.privacyGeneration == null)
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
    const recent = await tx.recommendationProfileProjectionRun.findFirst({
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
        state: RecommendationProfileProjectionRunState.FAILED,
        failureReason: "workflow_dispatch_failed",
        completedAt: now,
      },
    })
    throw error
  }
  await prisma.recommendationProfileProjectionRun
    .updateMany({
      where: {
        id: run.id,
        generation: run.generation,
        state: RecommendationProfileProjectionRunState.PENDING,
        OR: [
          { workflowRunId: null },
          { workflowRunId: { not: workflow.runId } },
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

export async function markRecommendationProfileProjectionRuntimeStarted(
  input: RecommendationProfileProjectionJobInput,
  runtimeRunId: string,
): Promise<void> {
  await prisma.recommendationProfileProjectionRun.updateMany({
    where: {
      id: input.runId,
      generation: input.expectedGeneration,
      state: RecommendationProfileProjectionRunState.PENDING,
      OR: [{ workflowRunId: null }, { workflowRunId: { not: runtimeRunId } }],
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
  if (!run.sessionDigest) {
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
  const claimed = await prisma.recommendationProfileProjectionRun.updateMany({
    where: {
      id: run.id,
      generation: input.expectedGeneration,
      state: RecommendationProfileProjectionRunState.PENDING,
      expiresAt: { gt: now },
    },
    data: {
      state: RecommendationProfileProjectionRunState.CLAIMED,
      claimId,
      claimedAt: now,
      heartbeatAt: now,
    },
  })
  if (claimed.count !== 1) {
    return { status: "fenced", reason: "claim_generation_changed" }
  }
  try {
    const service = createDatabaseRecommendationProfileProjectionService(prisma)
    const receipt = await service.project({
      sessionDigest: run.sessionDigest,
      profileId: run.profileId,
      privacyGeneration: run.privacyGeneration,
      now,
    })
    const completed =
      await prisma.recommendationProfileProjectionRun.updateMany({
        where: {
          id: run.id,
          generation: input.expectedGeneration,
          state: RecommendationProfileProjectionRunState.CLAIMED,
          claimId,
        },
        data: {
          state: RecommendationProfileProjectionRunState.COMPLETED,
          projectionId: receipt.generationId,
          completedAt: now,
          heartbeatAt: now,
          claimId: null,
          failureReason: null,
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
    await prisma.recommendationProfileProjectionRun.updateMany({
      where: {
        id: run.id,
        generation: input.expectedGeneration,
        state: RecommendationProfileProjectionRunState.CLAIMED,
        claimId,
      },
      data: {
        state: RecommendationProfileProjectionRunState.FAILED,
        failureReason: profileProjectionFailureReason(error),
        completedAt: now,
        heartbeatAt: now,
        claimId: null,
      },
    })
    throw error
  }
}

function profileProjectionFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : ""
  if (message.includes("revoked")) return "privacy_generation_revoked"
  if (message.includes("dimension")) return "embedding_dimension_invalid"
  return "profile_projection_failed"
}
