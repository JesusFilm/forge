import {
  Prisma,
  RecommendationShadowEvaluationState,
  WorkflowRunStatus,
  type PrismaClient,
} from "@prisma/client"
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
import {
  dispatchRecommendationShadowEvaluation,
  HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY,
  RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY,
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
 * dispatch. Reusing evaluationId makes operator retries safe: an active or
 * completed workflow is returned, while a failed dispatch can be retried
 * without creating a second evaluation.
 */
export async function startExactHybridShadowEvaluation(
  prisma: PrismaClient,
  input: OperatorInput,
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
        generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
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

  assertExactRetry(evaluation, input)
  const priorWorkflow = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY,
      subjectType: "recommendation-shadow-evaluation",
      subjectId: input.evaluationId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      runtimeRunId: true,
      status: true,
      details: true,
    },
  })
  if (priorWorkflow) {
    const priorMinimumRuns = readMinimumRuns(priorWorkflow.details)
    if (priorMinimumRuns != null && priorMinimumRuns !== input.minimumRuns) {
      throw new RecommendationConflictError(
        "The shadow evaluation retry does not match its original minimumRuns",
      )
    }
    if (priorWorkflow.status !== WorkflowRunStatus.FAILED) {
      return {
        status: "already_dispatched" as const,
        evaluationId: evaluation.id,
        generation: evaluation.generation,
        created,
        dispatch: {
          queued: true as const,
          ledgerRunId: priorWorkflow.id,
          runId: priorWorkflow.runtimeRunId,
        },
      }
    }
  }

  if (evaluation.state !== RecommendationShadowEvaluationState.ACTIVE) {
    throw new RecommendationConflictError(
      "The shadow evaluation is already terminal and cannot be dispatched again",
    )
  }
  const dispatch = await dispatchRecommendationShadowEvaluation(
    {
      evaluationId: evaluation.id,
      expectedGeneration: evaluation.generation,
      generatorKey: HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY,
      minimumRuns: input.minimumRuns,
    },
    { actorId: input.actorId },
  )
  return {
    status: "queued" as const,
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
) {
  if (
    evaluation.manifestId !== HYBRID_PERSONALIZED_MANIFEST_ID ||
    evaluation.generatorVersion !== HYBRID_CANDIDATE_GENERATOR_SET_VERSION ||
    evaluation.contextVersion !== CANDIDATE_CONTEXT_VERSION ||
    evaluation.eligibilityVersion !== CANDIDATE_ELIGIBILITY_VERSION ||
    evaluation.windowStart.getTime() !== input.windowStart.getTime() ||
    evaluation.windowEnd.getTime() !== input.windowEnd.getTime() ||
    evaluation.requestedSampleSize !== input.requestedSampleSize ||
    !evaluation.manifest.enabled
  ) {
    throw new RecommendationConflictError(
      "The shadow evaluation retry does not match the exact hybrid evaluation",
    )
  }
}

function readMinimumRuns(details: Prisma.JsonValue): number | null {
  if (
    details == null ||
    typeof details !== "object" ||
    Array.isArray(details) ||
    !("minimumRuns" in details)
  ) {
    return null
  }
  const value = details.minimumRuns
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function isUniqueConflict(cause: unknown) {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2002"
  )
}
