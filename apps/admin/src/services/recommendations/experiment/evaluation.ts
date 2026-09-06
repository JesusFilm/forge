import { createHash, randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationExperimentEvaluationRunState,
  RecommendationExperimentEvaluationState,
  type PrismaClient,
} from "@prisma/client"
import {
  RecommendationInputError,
  RecommendationInternalStateError,
} from "../errors"
import {
  evaluateExperimentEvidence,
  type ExperimentCounts,
  type ExperimentWatermarks,
} from "./policy"

const DAY_MS = 86_400_000
const EVALUATION_RETENTION_DAYS = 365
const EVALUATION_LOCK_ID = 384_000_001

type AggregateRow = {
  controlAssigned: bigint | number
  challengerAssigned: bigint | number
  controlExposed: bigint | number
  challengerExposed: bigint | number
  controlSelections: bigint | number
  challengerSelections: bigint | number
  controlQualified: bigint | number
  challengerQualified: bigint | number
  controlMission: bigint | number
  challengerMission: bigint | number
  controlPlaybackErrors: bigint | number
  challengerPlaybackErrors: bigint | number
  contamination: bigint | number
  conflictingOutcomes: bigint | number
}

export type ExperimentEvaluationInput = Readonly<{
  counts: ExperimentCounts
  watermarks: ExperimentWatermarks
}>

type Dependencies = Readonly<{
  prisma: PrismaClient
  now?: () => Date
  newId?: () => string
  loadEvidence?: (
    tx: Prisma.TransactionClient,
    input: {
      experimentId: string
      windowStart: Date
      windowEnd: Date
      capturedAt: Date
    },
  ) => Promise<ExperimentEvaluationInput>
}>

export type ExperimentEvaluationResult =
  | Readonly<{
      status: "published" | "existing"
      evaluationId: string
      revision: number
      state: "pass" | "fail" | "inconclusive" | "data_unhealthy"
    }>
  | Readonly<{
      status: "fenced"
      reason: "run_missing" | "claim_lost" | "experiment_generation_changed"
    }>

export class RecommendationExperimentEvaluationService {
  constructor(private readonly deps: Dependencies) {}

  async createRun(input: {
    experimentId: string
    windowStart: Date
    windowEnd: Date
    expectedExperimentGeneration: number
  }): Promise<{ runId: string; generation: number }> {
    const now = this.deps.now?.() ?? new Date()
    assertWindow(input.windowStart, input.windowEnd, now)
    return this.deps.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EVALUATION_LOCK_ID})`
        const experiment = await tx.recommendationExperiment.findUnique({
          where: { id: input.experimentId },
          select: { generation: true, expiresAt: true },
        })
        if (
          !experiment ||
          experiment.generation !== input.expectedExperimentGeneration
        ) {
          throw new RecommendationInputError(
            "Recommendation experiment generation is invalid",
          )
        }
        const previous =
          await tx.recommendationExperimentEvaluationRun.findFirst({
            where: {
              experimentId: input.experimentId,
              windowStart: input.windowStart,
              windowEnd: input.windowEnd,
            },
            orderBy: { generation: "desc" },
            select: { generation: true },
          })
        const generation = (previous?.generation ?? 0) + 1
        const created = await tx.recommendationExperimentEvaluationRun.create({
          data: {
            id: this.deps.newId?.() ?? randomUUID(),
            experimentId: input.experimentId,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            generation,
            expiresAt: new Date(
              Math.min(
                experiment.expiresAt.getTime(),
                now.getTime() + EVALUATION_RETENTION_DAYS * DAY_MS,
              ),
            ),
          },
        })
        return { runId: created.id, generation }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async claimRun(input: {
    runId: string
    expectedGeneration: number
    claimId?: string
  }): Promise<{ status: "claimed"; claimId: string } | { status: "fenced" }> {
    const claimId = input.claimId ?? randomUUID()
    const now = this.deps.now?.() ?? new Date()
    const claimed =
      await this.deps.prisma.recommendationExperimentEvaluationRun.updateMany({
        where: {
          id: input.runId,
          generation: input.expectedGeneration,
          state: RecommendationExperimentEvaluationRunState.PENDING,
        },
        data: {
          state: RecommendationExperimentEvaluationRunState.CLAIMED,
          claimId,
          claimedAt: now,
          heartbeatAt: now,
        },
      })
    return claimed.count === 1
      ? { status: "claimed", claimId }
      : { status: "fenced" }
  }

  async heartbeat(input: {
    runId: string
    expectedGeneration: number
    claimId: string
  }): Promise<boolean> {
    const heartbeat =
      await this.deps.prisma.recommendationExperimentEvaluationRun.updateMany({
        where: {
          id: input.runId,
          generation: input.expectedGeneration,
          claimId: input.claimId,
          state: RecommendationExperimentEvaluationRunState.CLAIMED,
        },
        data: { heartbeatAt: this.deps.now?.() ?? new Date() },
      })
    return heartbeat.count === 1
  }

  async evaluateClaimedRun(input: {
    runId: string
    expectedGeneration: number
    expectedExperimentGeneration: number
    claimId: string
  }): Promise<ExperimentEvaluationResult> {
    const capturedAt = this.deps.now?.() ?? new Date()
    return this.deps.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EVALUATION_LOCK_ID})`
        const run = await tx.recommendationExperimentEvaluationRun.findUnique({
          where: { id: input.runId },
          include: { experiment: true },
        })
        if (!run) return { status: "fenced", reason: "run_missing" }
        if (
          run.state !== RecommendationExperimentEvaluationRunState.CLAIMED ||
          run.generation !== input.expectedGeneration ||
          run.claimId !== input.claimId
        ) {
          return { status: "fenced", reason: "claim_lost" }
        }
        if (run.experiment.generation !== input.expectedExperimentGeneration) {
          await fenceRun(tx, run.id, input, capturedAt)
          return {
            status: "fenced",
            reason: "experiment_generation_changed",
          }
        }
        assertWindow(run.windowStart, run.windowEnd, capturedAt)

        const evidence = await (this.deps.loadEvidence ?? loadEvidence)(tx, {
          experimentId: run.experimentId,
          windowStart: run.windowStart,
          windowEnd: run.windowEnd,
          capturedAt,
        })
        const decision = evaluateExperimentEvidence({
          counts: evidence.counts,
          expectedChallengerProbability: run.experiment.challengerProbability,
          watermarks: evidence.watermarks,
          windowEnd: run.windowEnd,
          inputCapturedAt: capturedAt,
        })
        const inputDigest = digest({
          experimentVersion: run.experiment.experimentVersion,
          experimentGeneration: run.experiment.generation,
          configurationDigest: run.experiment.configurationDigest,
          assignmentPolicyVersion: run.experiment.assignmentPolicyVersion,
          outcomePolicyVersion: run.experiment.outcomePolicyVersion,
          integrityPolicyVersion: run.experiment.integrityPolicyVersion,
          evaluationPolicyVersion: run.experiment.evaluationPolicyVersion,
          windowStart: run.windowStart,
          windowEnd: run.windowEnd,
          counts: evidence.counts,
          watermarks: evidence.watermarks,
        })
        const duplicate =
          await tx.recommendationExperimentEvaluation.findUnique({
            where: {
              experimentId_windowStart_windowEnd_inputDigest: {
                experimentId: run.experimentId,
                windowStart: run.windowStart,
                windowEnd: run.windowEnd,
                inputDigest,
              },
            },
          })
        if (duplicate) {
          await completeRun(tx, run.id, input, capturedAt)
          return {
            status: "existing",
            evaluationId: duplicate.id,
            revision: duplicate.revision,
            state: policyState(duplicate.state),
          }
        }
        const previous = await tx.recommendationExperimentEvaluation.findFirst({
          where: {
            experimentId: run.experimentId,
            windowStart: run.windowStart,
            windowEnd: run.windowEnd,
          },
          orderBy: [{ revision: "desc" }, { evaluatedAt: "desc" }],
          select: { id: true, revision: true },
        })
        const revision = (previous?.revision ?? 0) + 1
        const created = await tx.recommendationExperimentEvaluation.create({
          data: {
            id: this.deps.newId?.() ?? randomUUID(),
            experimentId: run.experimentId,
            runId: run.id,
            revision,
            supersedesId: previous?.id ?? null,
            state: DATABASE_STATE[decision.state],
            windowStart: run.windowStart,
            windowEnd: run.windowEnd,
            inputCapturedAt: capturedAt,
            assignmentWatermark: evidence.watermarks.assignment,
            exposureWatermark: evidence.watermarks.exposure,
            outcomeWatermark: evidence.watermarks.outcome,
            missionWatermark: evidence.watermarks.mission,
            eligibilityWatermark: evidence.watermarks.eligibility,
            assignmentPolicyVersion: run.experiment.assignmentPolicyVersion,
            outcomePolicyVersion: run.experiment.outcomePolicyVersion,
            integrityPolicyVersion: run.experiment.integrityPolicyVersion,
            evaluationPolicyVersion: run.experiment.evaluationPolicyVersion,
            inputDigest,
            counts: evidence.counts satisfies Prisma.InputJsonValue,
            intentToTreat:
              decision.intentToTreat satisfies Prisma.InputJsonValue,
            exposedOnly: decision.exposedOnly satisfies Prisma.InputJsonValue,
            uncertainty: decision.uncertainty satisfies Prisma.InputJsonValue,
            guardrails: decision.guardrails satisfies Prisma.InputJsonValue,
            sampleRatio: decision.sampleRatio satisfies Prisma.InputJsonValue,
            reasonCodes: decision.reasonCodes,
            evaluatedAt: capturedAt,
            expiresAt: new Date(
              Math.min(
                run.experiment.expiresAt.getTime(),
                capturedAt.getTime() + EVALUATION_RETENTION_DAYS * DAY_MS,
              ),
            ),
          },
        })
        await completeRun(tx, run.id, input, capturedAt)
        return {
          status: "published",
          evaluationId: created.id,
          revision,
          state: decision.state,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async failClaimedRun(input: {
    runId: string
    expectedGeneration: number
    claimId: string
    reason: string
  }): Promise<boolean> {
    const failed =
      await this.deps.prisma.recommendationExperimentEvaluationRun.updateMany({
        where: {
          id: input.runId,
          generation: input.expectedGeneration,
          claimId: input.claimId,
          state: RecommendationExperimentEvaluationRunState.CLAIMED,
        },
        data: {
          state: RecommendationExperimentEvaluationRunState.FAILED,
          failureReason: input.reason.slice(0, 64),
          completedAt: this.deps.now?.() ?? new Date(),
        },
      })
    return failed.count === 1
  }
}

export function createRecommendationExperimentEvaluationService(
  prisma: PrismaClient,
) {
  return new RecommendationExperimentEvaluationService({ prisma })
}

async function completeRun(
  tx: Prisma.TransactionClient,
  runId: string,
  input: { expectedGeneration: number; claimId: string },
  now: Date,
) {
  const completed = await tx.recommendationExperimentEvaluationRun.updateMany({
    where: {
      id: runId,
      generation: input.expectedGeneration,
      claimId: input.claimId,
      state: RecommendationExperimentEvaluationRunState.CLAIMED,
    },
    data: {
      state: RecommendationExperimentEvaluationRunState.COMPLETED,
      completedAt: now,
    },
  })
  if (completed.count !== 1) {
    throw new RecommendationInternalStateError("experiment_claim_lost")
  }
}

async function fenceRun(
  tx: Prisma.TransactionClient,
  runId: string,
  input: { expectedGeneration: number; claimId: string },
  now: Date,
) {
  await tx.recommendationExperimentEvaluationRun.updateMany({
    where: {
      id: runId,
      generation: input.expectedGeneration,
      claimId: input.claimId,
      state: RecommendationExperimentEvaluationRunState.CLAIMED,
    },
    data: {
      state: RecommendationExperimentEvaluationRunState.FENCED,
      failureReason: "experiment_generation_changed",
      completedAt: now,
    },
  })
}

async function loadEvidence(
  tx: Prisma.TransactionClient,
  input: {
    experimentId: string
    windowStart: Date
    windowEnd: Date
    capturedAt: Date
  },
): Promise<ExperimentEvaluationInput> {
  const rows = await tx.$queryRaw<AggregateRow[]>(Prisma.sql`
    WITH scoped_assignments AS MATERIALIZED (
      SELECT assignment.*, experiment.control_manifest_id,
        experiment.challenger_manifest_id,
        experiment.configuration_digest AS experiment_configuration_digest,
        experiment.generation AS experiment_generation
      FROM recommendation_experiment_assignment assignment
      JOIN recommendation_experiment experiment
        ON experiment.id = assignment.experiment_id
      WHERE assignment.experiment_id = ${input.experimentId}
        AND assignment.state = 'active'
        AND assignment.assigned_at >= ${input.windowStart}
        AND assignment.assigned_at < ${input.windowEnd}
        AND assignment.assigned_at <= ${input.capturedAt}
    ),
    scoped_requests AS MATERIALIZED (
      SELECT request.*, assignment.arm
      FROM recommendation_request request
      JOIN scoped_assignments assignment
        ON assignment.id = request.experiment_assignment_id
      WHERE request.created_at <= ${input.capturedAt}
    ),
    scoped_exposures AS MATERIALIZED (
      SELECT exposure.*, assignment.arm AS assigned_arm,
        assignment.control_manifest_id, assignment.challenger_manifest_id,
        assignment.configuration_digest AS assignment_configuration_digest,
        assignment.experiment_configuration_digest,
        assignment.generation AS assignment_generation,
        assignment.experiment_generation
      FROM recommendation_experiment_exposure exposure
      JOIN scoped_assignments assignment
        ON assignment.id = exposure.assignment_id
      WHERE exposure.received_at <= ${input.capturedAt}
    ),
    latest_eligibility AS MATERIALIZED (
      SELECT DISTINCT ON (decision.source_key) decision.*
      FROM recommendation_eligibility_decision decision
      WHERE decision.decided_at <= ${input.capturedAt}
      ORDER BY decision.source_key, decision.revision DESC
    ),
    latest_outcomes AS MATERIALIZED (
      SELECT outcome.*, request.arm
      FROM recommendation_outcome_revision outcome
      JOIN scoped_requests request ON request.id = outcome.request_id
      WHERE outcome.created_at <= ${input.capturedAt}
        AND NOT EXISTS (
          SELECT 1 FROM recommendation_outcome_revision successor
          WHERE successor.supersedes_id = outcome.id
            AND successor.created_at <= ${input.capturedAt}
        )
    ),
    attribution_eligible_episodes AS MATERIALIZED (
      SELECT episode.id
      FROM recommendation_playback_episode episode
      JOIN recommendation_selection selection
        ON selection.request_id = episode.request_id
        AND selection.item_id = episode.item_id
        AND selection.id = episode.selection_id
      JOIN scoped_requests request ON request.id = episode.request_id
      WHERE selection.attribution_eligible_at <= ${input.capturedAt}
    ),
    eligible_outcomes AS MATERIALIZED (
      SELECT outcome.*
      FROM latest_outcomes outcome
      JOIN latest_eligibility decision
        ON decision.source_key = 'playback_outcome:' || outcome.id
      WHERE decision.state = 'eligible'
        AND 'experiment' = ANY(decision.eligible_scopes)
        AND EXISTS (
          SELECT 1 FROM attribution_eligible_episodes episode
          WHERE episode.id = outcome.episode_id
        )
    ),
    eligible_actions AS MATERIALIZED (
      SELECT action.*, request.arm
      FROM recommendation_content_action action
      JOIN scoped_requests request ON request.id = action.request_id
      JOIN latest_eligibility decision
        ON decision.source_key = 'content_action:' || action.id
      WHERE action.received_at <= ${input.capturedAt}
        AND action.action_class = 'human_action'
        AND decision.state = 'eligible'
        AND 'experiment' = ANY(decision.eligible_scopes)
        AND EXISTS (
          SELECT 1 FROM attribution_eligible_episodes episode
          WHERE episode.id = action.episode_id
        )
    )
    SELECT
      COUNT(*) FILTER (WHERE assignment.arm = 'control') AS "controlAssigned",
      COUNT(*) FILTER (WHERE assignment.arm = 'challenger') AS "challengerAssigned",
      (SELECT COUNT(DISTINCT assignment_id) FROM scoped_exposures WHERE assigned_arm = 'control') AS "controlExposed",
      (SELECT COUNT(DISTINCT assignment_id) FROM scoped_exposures WHERE assigned_arm = 'challenger') AS "challengerExposed",
      (SELECT COUNT(DISTINCT experiment_assignment_id) FROM scoped_requests request JOIN recommendation_selection selection ON selection.request_id = request.id WHERE request.arm = 'control' AND selection.received_at <= ${input.capturedAt} AND selection.attribution_eligible_at <= ${input.capturedAt}) AS "controlSelections",
      (SELECT COUNT(DISTINCT experiment_assignment_id) FROM scoped_requests request JOIN recommendation_selection selection ON selection.request_id = request.id WHERE request.arm = 'challenger' AND selection.received_at <= ${input.capturedAt} AND selection.attribution_eligible_at <= ${input.capturedAt}) AS "challengerSelections",
      (SELECT COUNT(DISTINCT request.experiment_assignment_id) FROM eligible_outcomes outcome JOIN scoped_requests request ON request.id = outcome.request_id WHERE outcome.arm = 'control' AND outcome.qualified_view = true) AS "controlQualified",
      (SELECT COUNT(DISTINCT request.experiment_assignment_id) FROM eligible_outcomes outcome JOIN scoped_requests request ON request.id = outcome.request_id WHERE outcome.arm = 'challenger' AND outcome.qualified_view = true) AS "challengerQualified",
      (SELECT COUNT(DISTINCT request.experiment_assignment_id) FROM eligible_actions action JOIN scoped_requests request ON request.id = action.request_id WHERE action.arm = 'control') AS "controlMission",
      (SELECT COUNT(DISTINCT request.experiment_assignment_id) FROM eligible_actions action JOIN scoped_requests request ON request.id = action.request_id WHERE action.arm = 'challenger') AS "challengerMission",
      (SELECT COUNT(DISTINCT request.experiment_assignment_id) FROM recommendation_playback_fact fact JOIN scoped_requests request ON request.id = fact.request_id JOIN attribution_eligible_episodes episode ON episode.id = fact.episode_id WHERE request.arm = 'control' AND fact.kind = 'playback_error' AND fact.received_at <= ${input.capturedAt}) AS "controlPlaybackErrors",
      (SELECT COUNT(DISTINCT request.experiment_assignment_id) FROM recommendation_playback_fact fact JOIN scoped_requests request ON request.id = fact.request_id JOIN attribution_eligible_episodes episode ON episode.id = fact.episode_id WHERE request.arm = 'challenger' AND fact.kind = 'playback_error' AND fact.received_at <= ${input.capturedAt}) AS "challengerPlaybackErrors",
      (SELECT COUNT(*) FROM scoped_exposures exposure WHERE exposure.assigned_arm <> exposure.arm OR exposure.effective_manifest_id <> CASE WHEN exposure.assigned_arm = 'challenger' THEN exposure.challenger_manifest_id ELSE exposure.control_manifest_id END OR exposure.assignment_configuration_digest <> exposure.experiment_configuration_digest OR exposure.assignment_generation <> exposure.experiment_generation) AS contamination,
      (SELECT COUNT(*) FROM recommendation_conflict conflict JOIN scoped_requests request ON request.id = conflict.request_id WHERE conflict.last_seen_at <= ${input.capturedAt}) AS "conflictingOutcomes"
    FROM scoped_assignments assignment
  `)
  const row = rows[0]
  if (!row) {
    throw new RecommendationInternalStateError(
      "experiment_aggregate_row_missing",
    )
  }
  return {
    counts: Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, safeCount(value)]),
    ) as unknown as ExperimentCounts,
    // The evaluator reads all five sources in one serializable database
    // snapshot. The capture time is therefore the exact ingestion watermark
    // for each source, including a truthful zero-activity window.
    watermarks: {
      assignment: input.capturedAt,
      exposure: input.capturedAt,
      outcome: input.capturedAt,
      mission: input.capturedAt,
      eligibility: input.capturedAt,
    },
  }
}

function assertWindow(start: Date, end: Date, capturedAt: Date) {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end ||
    end > capturedAt
  ) {
    throw new RecommendationInputError(
      "Recommendation experiment evaluation window is invalid",
    )
  }
}

function safeCount(value: bigint | number): number {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RecommendationInternalStateError(
      "experiment_aggregate_count_invalid",
    )
  return count
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value))
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

const DATABASE_STATE = {
  pass: RecommendationExperimentEvaluationState.PASS,
  fail: RecommendationExperimentEvaluationState.FAIL,
  inconclusive: RecommendationExperimentEvaluationState.INCONCLUSIVE,
  data_unhealthy: RecommendationExperimentEvaluationState.DATA_UNHEALTHY,
} as const

function policyState(
  state: RecommendationExperimentEvaluationState,
): "pass" | "fail" | "inconclusive" | "data_unhealthy" {
  return state === RecommendationExperimentEvaluationState.PASS
    ? "pass"
    : state === RecommendationExperimentEvaluationState.FAIL
      ? "fail"
      : state === RecommendationExperimentEvaluationState.INCONCLUSIVE
        ? "inconclusive"
        : "data_unhealthy"
}
