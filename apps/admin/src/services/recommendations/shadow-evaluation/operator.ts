import { Prisma, type PrismaClient } from "@prisma/client"
import {
  CANDIDATE_CONTEXT_VERSION,
  CANDIDATE_ELIGIBILITY_VERSION,
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
} from "../candidate"
import { RECOMMENDATION_RAW_RETENTION_DAYS } from "../contracts"
import {
  RecommendationConflictError,
  RecommendationInputError,
  RecommendationInternalStateError,
} from "../errors"
import { HYBRID_PERSONALIZED_MANIFEST_ID } from "../promotion/manifest"
import { COWATCH_SHADOW_GENERATOR_KEY } from "../cowatch/graph"
import {
  dispatchRecommendationShadowEvaluation,
  HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY,
} from "./job"
import { createShadowEvaluation } from "./service"

const CLOCK_SKEW_MS = 60_000
const DAY_MS = 86_400_000
const MAX_SHADOW_SAMPLE_SIZE = 10_000

type OperatorInput = Readonly<{
  evaluationId: string
  windowStart: Date
  windowEnd: Date
  requestedSampleSize: number
  minimumRuns: number
  actorId: string
  now?: Date
}>

type ExistingEvaluation = NonNullable<
  Awaited<ReturnType<typeof findEvaluation>>
>

/**
 * Starts only the immutable semantic + profile hybrid shadow lane. The
 * evaluation row is canonical business truth and is committed before workflow
 * dispatch. The durable dispatch owns exact retries, including ambiguous start
 * outcomes. FAILED or a missing runtime ID never authorizes another start.
 */
export async function startExactHybridShadowEvaluation(
  prisma: PrismaClient,
  input: OperatorInput,
) {
  return startExactShadowEvaluation(prisma, input, {
    generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
    generatorKey: HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY,
  })
}

export async function startExactCowatchShadowEvaluation(
  prisma: PrismaClient,
  input: OperatorInput,
) {
  return startExactShadowEvaluation(prisma, input, {
    generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
    generatorKey: COWATCH_SHADOW_GENERATOR_KEY,
  })
}

async function startExactShadowEvaluation(
  prisma: PrismaClient,
  input: OperatorInput,
  lane: Readonly<{ generatorVersion: string; generatorKey: string }>,
) {
  const now = input.now ?? new Date()
  assertBoundedClosedWindow(input, now)

  let evaluation = await findEvaluation(prisma, input.evaluationId)
  let created = false
  if (!evaluation) {
    try {
      await createShadowEvaluation(prisma, {
        evaluationId: input.evaluationId,
        manifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        generatorVersion: lane.generatorVersion,
        contextVersion: CANDIDATE_CONTEXT_VERSION,
        eligibilityVersion: CANDIDATE_ELIGIBILITY_VERSION,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        requestedSampleSize: input.requestedSampleSize,
        now,
      })
      created = true
    } catch (cause) {
      if (!isUniqueConflict(cause)) throw cause
      evaluation = await findEvaluation(prisma, input.evaluationId)
      if (!evaluation) throw cause
    }
    evaluation ??= await findEvaluation(prisma, input.evaluationId)
  }

  if (!evaluation) {
    throw new RecommendationInternalStateError(
      "shadow_evaluation_commit_not_observable",
    )
  }

  assertExactRetry(evaluation, input, lane)
  const dispatch = await dispatchRecommendationShadowEvaluation(
    {
      evaluationId: evaluation.id,
      expectedGeneration: evaluation.generation,
      generatorKey: lane.generatorKey,
      minimumRuns: input.minimumRuns,
    },
    { actorId: input.actorId, client: prisma, now },
  )
  return {
    status:
      dispatch.state === "uncertain"
        ? ("dispatch_uncertain" as const)
        : dispatch.state === "terminal"
          ? ("terminal" as const)
          : dispatch.reused
            ? ("already_dispatched" as const)
            : ("queued" as const),
    evaluationId: evaluation.id,
    generation: evaluation.generation,
    created,
    dispatch,
  }
}

function findEvaluation(prisma: PrismaClient, evaluationId: string) {
  return prisma.recommendationShadowEvaluation.findUnique({
    where: { id: evaluationId },
    select: {
      id: true,
      manifestId: true,
      generatorVersion: true,
      contextVersion: true,
      eligibilityVersion: true,
      state: true,
      generation: true,
      windowStart: true,
      windowEnd: true,
      requestedSampleSize: true,
      manifest: { select: { enabled: true } },
    },
  })
}

function assertBoundedClosedWindow(input: OperatorInput, now: Date) {
  if (
    !Number.isInteger(input.requestedSampleSize) ||
    input.requestedSampleSize < 1 ||
    input.requestedSampleSize > MAX_SHADOW_SAMPLE_SIZE
  ) {
    throw new RecommendationInputError(
      `requestedSampleSize must be between 1 and ${MAX_SHADOW_SAMPLE_SIZE}`,
    )
  }
  if (
    !Number.isInteger(input.minimumRuns) ||
    input.minimumRuns < 1 ||
    input.minimumRuns > input.requestedSampleSize
  ) {
    throw new RecommendationInputError(
      "minimumRuns cannot exceed requestedSampleSize and must be positive",
    )
  }
  if (
    !Number.isFinite(input.windowStart.getTime()) ||
    !Number.isFinite(input.windowEnd.getTime()) ||
    input.windowStart >= input.windowEnd
  ) {
    throw new RecommendationInputError(
      "The shadow evaluation window is invalid",
    )
  }
  if (input.windowEnd.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    throw new RecommendationInputError(
      "The shadow evaluation requires a closed event window",
    )
  }
  if (
    input.windowStart.getTime() <
    now.getTime() - RECOMMENDATION_RAW_RETENTION_DAYS * DAY_MS
  ) {
    throw new RecommendationInputError(
      "The shadow evaluation window exceeds raw recommendation retention",
    )
  }
}

function assertExactRetry(
  evaluation: ExistingEvaluation,
  input: OperatorInput,
  lane: Readonly<{ generatorVersion: string; generatorKey: string }>,
) {
  if (
    evaluation.manifestId !== HYBRID_PERSONALIZED_MANIFEST_ID ||
    evaluation.generatorVersion !== lane.generatorVersion ||
    evaluation.contextVersion !== CANDIDATE_CONTEXT_VERSION ||
    evaluation.eligibilityVersion !== CANDIDATE_ELIGIBILITY_VERSION ||
    evaluation.windowStart.getTime() !== input.windowStart.getTime() ||
    evaluation.windowEnd.getTime() !== input.windowEnd.getTime() ||
    evaluation.requestedSampleSize !== input.requestedSampleSize ||
    !evaluation.manifest.enabled
  ) {
    throw new RecommendationConflictError(
      "The shadow evaluation retry does not match the exact lane evaluation",
    )
  }
}

function isUniqueConflict(cause: unknown) {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2002"
  )
}
