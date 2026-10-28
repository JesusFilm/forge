import {
  type PrismaClient,
  RecommendationProfileProjectionRunState,
} from "@prisma/client"

import { prisma } from "@/db/client"

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

export async function dispatchRecommendationProfileProjection(_input: {
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
  throw new Error("Behavioral recommendations have been retired")
}

export async function redispatchRecommendationProfileProjectionRun(_input: {
  runId: string
  expectedGeneration: number
  now?: Date
}) {
  throw new Error("Behavioral recommendations have been retired")
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

export async function dispatchRecommendationProfileFeedback(_input: {
  sessionDigest: string
  profileId: string
  privacyGeneration: number
  evidenceWatermark: Date
  now?: Date
}) {
  return {
    session: null,
    durable: null,
    skipped: "behavioral_recommendations_retired",
  }
}

export async function runRecommendationProfileProjectionJob(
  input: RecommendationProfileProjectionJobInput,
  client: PrismaClient = prisma,
): Promise<
  | Readonly<{
      status: "published"
      generationId: string
      projectionGeneration: number
      replay: boolean
    }>
  | Readonly<{ status: "fenced"; reason: string }>
  | Readonly<{ status: "empty"; replay: boolean }>
> {
  await client.recommendationProfileProjectionRun.updateMany({
    where: { id: input.runId, state: { in: ["PENDING", "CLAIMED"] } },
    data: {
      state: "FENCED",
      completedAt: new Date(),
      leaseExpiresAt: null,
      lastTransitionReason: "behavioral_recommendations_retired",
    },
  })
  return { status: "fenced", reason: "behavioral_recommendations_retired" }
}
