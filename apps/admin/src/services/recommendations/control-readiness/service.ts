import { createHash, randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationControlDimensionOutcome,
  RecommendationControlReadinessState,
  type PrismaClient,
} from "@prisma/client"
import { RECOMMENDATION_SERVING_CONTROL_ID } from "../manifest.service"
import {
  RecommendationInputError,
  RecommendationInternalStateError,
} from "../errors"
import {
  RECOMMENDATION_CONTROL_READINESS_POLICY,
  evaluateSemanticControlReadiness,
  type SemanticControlDimensionState,
  type SemanticControlEvidence,
  type SemanticControlReadinessState,
} from "./policy"

const DAY_MS = 86_400_000
export const RECOMMENDATION_CONTROL_EVALUATION_RETENTION_DAYS = 365
const RECOMMENDATION_CONTROL_EVALUATION_LOCK_ID = 381_000_001

type AggregateRow = Readonly<{
  issuedRequests: bigint | number
  servedRequests: bigint | number
  fallbackRequests: bigint | number
  servedItems: bigint | number
  impressions: bigint | number
  selections: bigint | number
  selectionWithoutImpression: bigint | number
  matureOutcomes: bigint | number
  qualifiedViewOutcomes: bigint | number
  missionQualifiedOutcomes: bigint | number
  missionOffsetOutcomes: bigint | number
  rejectedMissionOffsets: bigint | number
  machineExcluded: bigint | number
  integrityExcluded: bigint | number
  classifierLag: bigint | number
  writeFailures: bigint | number
  conflicts: bigint | number
  lateEvidence: bigint | number
  retrievalP95Ms: number | null
  requestWatermark: Date | null
  impressionWatermark: Date | null
  selectionWatermark: Date | null
  outcomeWatermark: Date | null
  missionWatermark: Date | null
  eligibilityWatermark: Date | null
}>

type EvaluationDependencies = Readonly<{
  prisma: PrismaClient
  now?: () => Date
  newId?: () => string
}>

export type RecommendationControlEvaluationResult =
  | Readonly<{
      status: "published" | "existing"
      evaluationId: string
      revision: number
      state: SemanticControlReadinessState
    }>
  | Readonly<{
      status: "fenced"
      reason:
        | "serving_control_missing"
        | "serving_control_version_changed"
        | "manifest_changed"
        | "manifest_not_semantic_control"
    }>

export class RecommendationControlReadinessService {
  constructor(private readonly deps: EvaluationDependencies) {}

  async evaluate(input: {
    windowStart: Date
    windowEnd: Date
    expectedServingControlVersion: number
    expectedManifestId?: string
  }): Promise<RecommendationControlEvaluationResult> {
    const capturedAt = this.deps.now?.() ?? new Date()
    assertWindow(input, capturedAt)

    return this.deps.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(${RECOMMENDATION_CONTROL_EVALUATION_LOCK_ID})
        `
        const control = await tx.recommendationServingControl.findUnique({
          where: { id: RECOMMENDATION_SERVING_CONTROL_ID },
          include: { manifest: true },
        })
        if (!control) {
          return { status: "fenced", reason: "serving_control_missing" }
        }
        if (control.version !== input.expectedServingControlVersion) {
          return {
            status: "fenced",
            reason: "serving_control_version_changed",
          }
        }
        if (
          input.expectedManifestId != null &&
          control.manifestId !== input.expectedManifestId
        ) {
          return { status: "fenced", reason: "manifest_changed" }
        }
        const manifest = control.manifest
        if (
          manifest.generator !== "semantic" ||
          manifest.surfaceVersion !== "watch-below-player-v1"
        ) {
          return { status: "fenced", reason: "manifest_not_semantic_control" }
        }

        const rows = await tx.$queryRaw<AggregateRow[]>(Prisma.sql`
          WITH active_requests AS MATERIALIZED (
            SELECT request.*
            FROM recommendation_request request
            WHERE request.manifest_id = ${manifest.id}
              AND request.surface_version = ${manifest.surfaceVersion}
              AND request.created_at >= ${input.windowStart}
              AND request.created_at < ${input.windowEnd}
              AND request.created_at <= ${capturedAt}
          ),
          served_items AS MATERIALIZED (
            SELECT item.*
            FROM recommendation_served_item item
            JOIN active_requests request ON request.id = item.request_id
          ),
          scoped_impressions AS MATERIALIZED (
            SELECT impression.*
            FROM recommendation_impression impression
            JOIN active_requests request ON request.id = impression.request_id
            WHERE impression.received_at <= ${capturedAt}
          ),
          scoped_selections AS MATERIALIZED (
            SELECT selection.*
            FROM recommendation_selection selection
            JOIN active_requests request ON request.id = selection.request_id
            WHERE selection.received_at <= ${capturedAt}
          ),
          eligible_selections AS MATERIALIZED (
            SELECT selection.*
            FROM scoped_selections selection
            WHERE selection.attribution_eligible_at <= ${capturedAt}
          ),
          attribution_eligible_episodes AS MATERIALIZED (
            SELECT episode.id
            FROM recommendation_playback_episode episode
            JOIN eligible_selections selection
              ON selection.request_id = episode.request_id
              AND selection.item_id = episode.item_id
              AND selection.id = episode.selection_id
          ),
          latest_outcomes AS MATERIALIZED (
            SELECT outcome.*
            FROM recommendation_outcome_revision outcome
            JOIN active_requests request ON request.id = outcome.request_id
            WHERE outcome.classifier_version = ${RECOMMENDATION_CONTROL_READINESS_POLICY.classifierVersion}
              AND outcome.created_at <= ${capturedAt}
              AND NOT EXISTS (
                SELECT 1
                FROM recommendation_outcome_revision successor
                WHERE successor.supersedes_id = outcome.id
                  AND successor.created_at <= ${capturedAt}
              )
          ),
          pinned_eligibility AS MATERIALIZED (
            SELECT DISTINCT ON (decision.source_key)
              decision.*
            FROM recommendation_eligibility_decision decision
            WHERE decision.policy_version = ${RECOMMENDATION_CONTROL_READINESS_POLICY.integrityPolicyVersion}
              AND decision.decided_at <= ${capturedAt}
            ORDER BY decision.source_key, decision.revision DESC
          ),
          classified_outcomes AS MATERIALIZED (
            SELECT outcome.*, decision.actor_class, decision.state AS eligibility_state,
              decision.eligible_scopes, decision.decided_at AS eligibility_decided_at
            FROM latest_outcomes outcome
            LEFT JOIN pinned_eligibility decision
              ON decision.source_key = 'playback_outcome:' || outcome.id
          ),
          human_outcomes AS MATERIALIZED (
            SELECT outcome.*
            FROM classified_outcomes outcome
            WHERE outcome.eligibility_state = 'eligible'
              AND outcome.actor_class IN ('human_anonymous', 'human_signed_in')
              AND 'aggregate' = ANY(outcome.eligible_scopes)
              AND EXISTS (
                SELECT 1 FROM attribution_eligible_episodes episode
                WHERE episode.id = outcome.episode_id
              )
          ),
          scoped_actions AS MATERIALIZED (
            SELECT action.*, decision.actor_class AS eligibility_actor_class,
              decision.state AS eligibility_state,
              decision.eligible_scopes,
              decision.decided_at AS eligibility_decided_at
            FROM recommendation_content_action action
            JOIN active_requests request ON request.id = action.request_id
            LEFT JOIN pinned_eligibility decision
              ON decision.source_key = 'content_action:' || action.id
            WHERE action.received_at <= ${capturedAt}
          ),
          eligible_mission_actions AS MATERIALIZED (
            SELECT action.*
            FROM scoped_actions action
            WHERE action.action_class = 'human_action'
              AND action.eligibility_state = 'eligible'
              AND action.eligibility_actor_class IN ('human_anonymous', 'human_signed_in')
              AND 'aggregate' = ANY(action.eligible_scopes)
              AND EXISTS (
                SELECT 1 FROM attribution_eligible_episodes episode
                WHERE episode.id = action.episode_id
              )
          ),
          mission_by_episode AS MATERIALIZED (
            SELECT
              outcome.id AS outcome_id,
              BOOL_OR(
                action.purpose IN ('find_to_share', 'course_build')
              ) AS has_declared_offset,
              BOOL_OR(
                action.purpose NOT IN ('find_to_share', 'course_build')
              ) AS has_rejected_offset
            FROM human_outcomes outcome
            JOIN eligible_mission_actions action
              ON action.episode_id = outcome.episode_id
            WHERE outcome.qualified_view = false
            GROUP BY outcome.id
          ),
          due_episodes AS MATERIALIZED (
            SELECT episode.*
            FROM recommendation_playback_episode episode
            JOIN active_requests request ON request.id = episode.request_id
            WHERE episode.state IN ('finalized', 'timed_out')
              OR episode.active_until <= ${capturedAt}
          )
          SELECT
            COUNT(*) FILTER (WHERE request.state = 'issued') AS "issuedRequests",
            COUNT(*) FILTER (WHERE request.state = 'issued' AND request.result = 'served') AS "servedRequests",
            COUNT(*) FILTER (WHERE request.result = 'fallback') AS "fallbackRequests",
            (SELECT COUNT(*) FROM served_items) AS "servedItems",
            (SELECT COUNT(*) FROM scoped_impressions) AS impressions,
            (SELECT COUNT(*) FROM eligible_selections) AS selections,
            (
              SELECT COUNT(*)
              FROM scoped_selections selection
              WHERE selection.attribution_eligible_at IS NULL
                OR selection.attribution_eligible_at > ${capturedAt}
            ) AS "selectionWithoutImpression",
            (SELECT COUNT(*) FROM human_outcomes) AS "matureOutcomes",
            (SELECT COUNT(*) FROM human_outcomes WHERE qualified_view = true) AS "qualifiedViewOutcomes",
            (SELECT COUNT(DISTINCT episode_id) FROM eligible_mission_actions) AS "missionQualifiedOutcomes",
            (SELECT COUNT(*) FROM mission_by_episode WHERE has_declared_offset) AS "missionOffsetOutcomes",
            (SELECT COUNT(*) FROM mission_by_episode WHERE has_rejected_offset) AS "rejectedMissionOffsets",
            (
              SELECT COUNT(*) FROM classified_outcomes outcome
              WHERE outcome.actor_class IN ('machine', 'internal', 'test')
            ) + (
              SELECT COUNT(*) FROM scoped_actions action
              WHERE action.actor_class IN ('machine', 'internal', 'test')
            ) AS "machineExcluded",
            (
              SELECT COUNT(*) FROM classified_outcomes outcome
              WHERE outcome.eligibility_state IS DISTINCT FROM 'eligible'
                OR NOT ('aggregate' = ANY(COALESCE(outcome.eligible_scopes, ARRAY[]::TEXT[])))
            ) AS "integrityExcluded",
            (
              SELECT COUNT(*) FROM due_episodes episode
              WHERE NOT EXISTS (
                SELECT 1 FROM latest_outcomes outcome
                WHERE outcome.episode_id = episode.id
              )
            ) AS "classifierLag",
            (
              SELECT COALESCE(SUM(audit.count), 0)
              FROM recommendation_evidence_audit audit
              JOIN active_requests active ON active.id = audit.request_id
              WHERE audit.kind = 'write_failure'
                AND audit.occurred_at <= ${capturedAt}
            ) AS "writeFailures",
            (
              SELECT COUNT(*)
              FROM recommendation_conflict conflict
              JOIN active_requests active ON active.id = conflict.request_id
              WHERE conflict.last_seen_at <= ${capturedAt}
            ) AS conflicts,
            (
              SELECT COUNT(*)
              FROM recommendation_playback_fact fact
              JOIN active_requests active ON active.id = fact.request_id
              WHERE fact.late = true AND fact.received_at <= ${capturedAt}
            ) AS "lateEvidence",
            percentile_cont(0.95) WITHIN GROUP (ORDER BY request.retrieval_latency_ms)
              FILTER (WHERE request.retrieval_latency_ms IS NOT NULL) AS "retrievalP95Ms",
            MAX(COALESCE(request.issued_at, request.created_at)) AS "requestWatermark",
            (SELECT MAX(received_at) FROM scoped_impressions) AS "impressionWatermark",
            (
              SELECT MAX(GREATEST(received_at, COALESCE(attribution_eligible_at, received_at)))
              FROM scoped_selections
            ) AS "selectionWatermark",
            (SELECT MAX(created_at) FROM latest_outcomes) AS "outcomeWatermark",
            (SELECT MAX(received_at) FROM scoped_actions) AS "missionWatermark",
            (
              SELECT MAX(eligibility_decided_at)
              FROM (
                SELECT eligibility_decided_at FROM classified_outcomes
                UNION ALL
                SELECT eligibility_decided_at FROM scoped_actions
              ) watermarks
            ) AS "eligibilityWatermark"
          FROM active_requests request
        `)
        const row = rows[0]
        if (!row) {
          throw new RecommendationInternalStateError(
            "semantic_control_aggregate_row_missing",
          )
        }
        const evidence = evidenceFrom(row)
        const decision = evaluateSemanticControlReadiness(evidence)
        const watermarks = {
          request: row.requestWatermark,
          impression: row.impressionWatermark,
          selection: row.selectionWatermark,
          outcome: row.outcomeWatermark,
          mission: row.missionWatermark,
          eligibility: row.eligibilityWatermark,
        }
        const manifestDigest = digest({
          id: manifest.id,
          strategyVersion: manifest.strategyVersion,
          contractVersion: manifest.contractVersion,
          surfaceVersion: manifest.surfaceVersion,
          generator: manifest.generator,
          maxItems: manifest.maxItems,
          configuration: manifest.configuration,
        })
        const inputDigest = digest({
          manifestDigest,
          servingControlVersion: control.version,
          policy: RECOMMENDATION_CONTROL_READINESS_POLICY,
          window: {
            start: input.windowStart.toISOString(),
            end: input.windowEnd.toISOString(),
          },
          watermarks: mapDates(watermarks),
          evidence,
        })
        const previous = await tx.recommendationControlEvaluation.findFirst({
          where: {
            surfaceVersion: manifest.surfaceVersion,
            manifestId: manifest.id,
            policyVersion: RECOMMENDATION_CONTROL_READINESS_POLICY.version,
          },
          orderBy: [{ revision: "desc" }, { evaluatedAt: "desc" }],
          select: {
            id: true,
            revision: true,
            inputDigest: true,
            state: true,
          },
        })
        if (previous?.inputDigest === inputDigest) {
          return {
            status: "existing",
            evaluationId: previous.id,
            revision: previous.revision,
            state: readinessState(previous.state),
          }
        }

        const revision = (previous?.revision ?? 0) + 1
        const created = await tx.recommendationControlEvaluation.create({
          data: {
            id: this.deps.newId?.() ?? randomUUID(),
            manifestId: manifest.id,
            strategyVersion: manifest.strategyVersion,
            contractVersion: manifest.contractVersion,
            surfaceVersion: manifest.surfaceVersion,
            generator: manifest.generator,
            servingControlVersion: control.version,
            policyVersion: RECOMMENDATION_CONTROL_READINESS_POLICY.version,
            outcomePolicyVersion:
              RECOMMENDATION_CONTROL_READINESS_POLICY.outcomePolicyVersion,
            classifierVersion:
              RECOMMENDATION_CONTROL_READINESS_POLICY.classifierVersion,
            integrityPolicyVersion:
              RECOMMENDATION_CONTROL_READINESS_POLICY.integrityPolicyVersion,
            manifestDigest,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            inputCapturedAt: capturedAt,
            requestWatermark: row.requestWatermark,
            impressionWatermark: row.impressionWatermark,
            selectionWatermark: row.selectionWatermark,
            outcomeWatermark: row.outcomeWatermark,
            missionWatermark: row.missionWatermark,
            eligibilityWatermark: row.eligibilityWatermark,
            inputDigest,
            revision,
            supersedesId: previous?.id ?? null,
            state: READINESS_STATE[decision.state],
            deliveryOutcome:
              DIMENSION_STATE[decision.dimensions.delivery.state],
            attributionOutcome:
              DIMENSION_STATE[decision.dimensions.attribution.state],
            maturityOutcome:
              DIMENSION_STATE[decision.dimensions.maturity.state],
            operationalOutcome:
              DIMENSION_STATE[decision.dimensions.operational.state],
            missionOutcome: DIMENSION_STATE[decision.dimensions.mission.state],
            guardrailOutcome:
              DIMENSION_STATE[decision.dimensions.guardrail.state],
            evidence: evidence satisfies Prisma.InputJsonValue,
            rates: decision.rates satisfies Prisma.InputJsonValue,
            uncertainty: decision.uncertainty satisfies Prisma.InputJsonValue,
            policyConfiguration:
              RECOMMENDATION_CONTROL_READINESS_POLICY satisfies Prisma.InputJsonValue,
            reasonCodes: decision.reasonCodes,
            explanation: decision.explanation,
            evaluatedAt: capturedAt,
            expiresAt: new Date(
              capturedAt.getTime() +
                RECOMMENDATION_CONTROL_EVALUATION_RETENTION_DAYS * DAY_MS,
            ),
          },
        })
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
}

export function createRecommendationControlReadinessService(
  prisma: PrismaClient,
): RecommendationControlReadinessService {
  return new RecommendationControlReadinessService({ prisma })
}

function evidenceFrom(row: AggregateRow): SemanticControlEvidence {
  return {
    issuedRequests: count(row.issuedRequests),
    servedRequests: count(row.servedRequests),
    fallbackRequests: count(row.fallbackRequests),
    servedItems: count(row.servedItems),
    impressions: count(row.impressions),
    selections: count(row.selections),
    selectionWithoutImpression: count(row.selectionWithoutImpression),
    matureOutcomes: count(row.matureOutcomes),
    qualifiedViewOutcomes: count(row.qualifiedViewOutcomes),
    missionQualifiedOutcomes: count(row.missionQualifiedOutcomes),
    missionOffsetOutcomes: count(row.missionOffsetOutcomes),
    rejectedMissionOffsets: count(row.rejectedMissionOffsets),
    machineExcluded: count(row.machineExcluded),
    integrityExcluded: count(row.integrityExcluded),
    classifierLag: count(row.classifierLag),
    writeFailures: count(row.writeFailures),
    conflicts: count(row.conflicts),
    lateEvidence: count(row.lateEvidence),
    retrievalP95Ms: finiteNonnegative(row.retrievalP95Ms),
  }
}

function assertWindow(
  input: {
    windowStart: Date
    windowEnd: Date
    expectedServingControlVersion: number
  },
  capturedAt: Date,
): void {
  const expectedDuration =
    RECOMMENDATION_CONTROL_READINESS_POLICY.evidenceWindowDays * DAY_MS
  if (
    !Number.isSafeInteger(input.expectedServingControlVersion) ||
    input.expectedServingControlVersion < 1 ||
    !Number.isFinite(input.windowStart.getTime()) ||
    !Number.isFinite(input.windowEnd.getTime()) ||
    input.windowEnd.getTime() - input.windowStart.getTime() !==
      expectedDuration ||
    input.windowEnd > capturedAt
  ) {
    throw new RecommendationInputError(
      "Semantic control evaluation window or generation is invalid",
    )
  }
}

function count(value: bigint | number): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RecommendationInternalStateError(
      "semantic_control_aggregate_count_invalid",
    )
  }
  return result
}

function finiteNonnegative(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function mapDates(value: Record<string, Date | null>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, date]) => [
      key,
      date?.toISOString() ?? null,
    ]),
  )
}

const READINESS_STATE = {
  ready: RecommendationControlReadinessState.READY,
  "not-ready": RecommendationControlReadinessState.NOT_READY,
  inconclusive: RecommendationControlReadinessState.INCONCLUSIVE,
  "data-unhealthy": RecommendationControlReadinessState.DATA_UNHEALTHY,
} satisfies Record<
  SemanticControlReadinessState,
  RecommendationControlReadinessState
>

const DIMENSION_STATE = {
  pass: RecommendationControlDimensionOutcome.PASS,
  fail: RecommendationControlDimensionOutcome.FAIL,
  inconclusive: RecommendationControlDimensionOutcome.INCONCLUSIVE,
  unhealthy: RecommendationControlDimensionOutcome.UNHEALTHY,
} satisfies Record<
  SemanticControlDimensionState,
  RecommendationControlDimensionOutcome
>

function readinessState(
  state: RecommendationControlReadinessState,
): SemanticControlReadinessState {
  switch (state) {
    case RecommendationControlReadinessState.NOT_READY:
      return "not-ready"
    case RecommendationControlReadinessState.INCONCLUSIVE:
      return "inconclusive"
    case RecommendationControlReadinessState.DATA_UNHEALTHY:
      return "data-unhealthy"
    default:
      return "ready"
  }
}
