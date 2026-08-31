import { Prisma, type PrismaClient } from "@prisma/client"
import {
  classifyRecommendationHealth,
  type RecommendationHealthState,
} from "@/services/recommendations/health"
import { RECOMMENDATION_SERVING_CONTROL_ID } from "@/services/recommendations/manifest.service"
import { readRecommendationRetentionHealth } from "@/services/recommendations/retention.service"
import { RecommendationInternalStateError } from "@/services/recommendations/errors"
import {
  resolveRecommendationOpsWindow,
  type RecommendationOpsWindow,
} from "./shared"
import {
  loadRecommendationPrivacyHealth,
  type RecommendationPrivacyHealth,
} from "./privacy.service"
import {
  loadProfileShadowOverview,
  loadPromotionState,
  recommendationPromotionOverview,
} from "./overview-profile-promotion"

type AggregateRow = Readonly<{
  preparedRequests: bigint | number
  issuedRequests: bigint | number
  issuanceFailedRequests: bigint | number
  servedItems: bigint | number
  renderedItems: bigint | number
  impressions: bigint | number
  selections: bigint | number
  playbackStarts: bigint | number
  finalizedEpisodes: bigint | number
  fallbackRequests: bigint | number
  committedRejections: bigint | number
  writeFailures: bigint | number
  lossSuspected: bigint | number
  replays: bigint | number
  conflicts: bigint | number
  late: bigint | number
  classifierLag: bigint | number
  selectionWithoutImpression: bigint | number
  retrievalP50Ms: number | null
  retrievalP95Ms: number | null
  deliverySuccessAt: Date | null
  evidenceSuccessAt: Date | null
  oldestPendingAt: Date | null
  eligibilityPending: bigint | number
  eligibilityEligible: bigint | number
  eligibilityExcluded: bigint | number
  eligibilityQuarantined: bigint | number
  eligibilityHumanAnonymous: bigint | number
  eligibilityHumanSignedIn: bigint | number
  eligibilityMachine: bigint | number
  eligibilityInternal: bigint | number
  eligibilityTest: bigint | number
  eligibilityContamination: bigint | number
  eligibilityReasonCounts: unknown
}>

export type RecommendationAggregateCounts = Readonly<{
  preparedRequests: number
  issuedRequests: number
  issuanceFailedRequests: number
  servedItems: number
  renderedItems: number
  impressions: number
  selections: number
  playbackStarts: number
  finalizedEpisodes: number
  fallbackRequests: number
  committedRejections: number
  writeFailures: number
  lossSuspected: number
  replays: number
  conflicts: number
  late: number
  classifierLag: number
  selectionWithoutImpression: number
}>

export type RecommendationOverviewData = Readonly<{
  window: RecommendationOpsWindow
  health: Readonly<{
    primary: RecommendationHealthState
    states: RecommendationHealthState[]
  }>
  counts: RecommendationAggregateCounts | null
  latency: Readonly<{ p50Ms: number | null; p95Ms: number | null }> | null
  watermarks: Readonly<{
    deliverySuccessAt: Date | null
    evidenceSuccessAt: Date | null
    retentionSuccessAt: Date | null
    databaseProbeAt: Date
  }> | null
  oldestPendingAt: Date | null
  eligibility: Readonly<{
    pending: number
    eligible: number
    excluded: number
    quarantined: number
    actorClasses: Readonly<{
      humanAnonymous: number
      humanSignedIn: number
      machine: number
      internal: number
      test: number
    }>
    contamination: number
    reasonCodes: Array<Readonly<{ reasonCode: string; count: number }>>
  }> | null
  privacy: RecommendationPrivacyHealth | null
  retention: Readonly<{
    healthy: boolean
    reason: "healthy" | "retention_overdue" | "missing_success_watermark"
    latestSuccessAt: Date | null
    oldestOverdueAt: Date | null
  }> | null
  serving: Readonly<{
    enabled: boolean
    reasonCode: string
    manifest: Readonly<{
      id: string
      strategyVersion: string
      contractVersion: string
      surfaceVersion: string
      generator: string
      maxItems: number
    }>
  }> | null
  controlReadiness: RecommendationControlReadinessData | null
  experimentEvaluation: RecommendationExperimentEvaluationData | null
  promotion: RecommendationPromotionOverviewData | null
  profileShadow: RecommendationProfileShadowOverviewData | null
}>

export type RecommendationProfileShadowOverviewData = Readonly<{
  manifestId: string
  manifestEnabled: boolean
  shadowOnly: true
  generationCount: number
  durableGenerationCount: number
  sessionGenerationCount: number
  failedRunCount: number
  metricsSuppressed: boolean
  coverage: number | null
  stability: number | null
  inputWatermark: Date | null
  expiryWatermark: Date | null
  interests: ReadonlyArray<
    Readonly<{
      kind: "durable" | "session"
      ordinal: number
      generations: number
      stability: number | null
    }>
  >
  evaluation: Readonly<{
    state: "active" | "terminal"
    sampledCount: number
    processedCount: number
    failedCount: number
    coverage: number | null
    overlap: number | null
    novelty: number | null
    diversity: number | null
    cohortQuality: number | null
    latencyP95Ms: number | null
    inputWatermark: Date | null
    decision: string | null
    reasonCode: string | null
    reevaluationCondition: string | null
  }> | null
}>

export type RecommendationPromotionOverviewData = Readonly<{
  generation: number
  stage: "control" | "bounded" | "permanent"
  activeManifestId: string
  targetManifestId: string | null
  lastKnownGoodManifestId: string
  fallbackAvailable: boolean
  exposureCeilingBps: number
  proposedExposureCeilingBps: number
  killSwitchEnabled: boolean
  reasonCode: string
  readiness: Readonly<{
    ready: boolean
    reason: string
    nextAction: string
    impact: string
    restore: string
  }>
  approval: Readonly<{
    id: string
    manifestDigest: string
    maxExposureBps: number
    approvedAt: Date
    expiresAt: Date
  }> | null
  evaluationId: string | null
  evaluationState: "pass" | "fail" | "inconclusive" | "data-unhealthy" | null
  workflow: Readonly<{
    id: string
    action: string
    state: "pending" | "active" | "complete" | "failed" | "stale"
    failureReason: string | null
    createdAt: Date
    completedAt: Date | null
  }> | null
  conflictCount: number
  audit: Array<
    Readonly<{
      id: string
      eventType: string
      fromManifestId: string | null
      toManifestId: string
      pointerGeneration: number
      reasonCode: string
      actorClass: string
      occurredAt: Date
    }>
  >
}>

export type RecommendationExperimentEvaluationData = Readonly<{
  id: string
  experimentId: string
  experimentVersion: string
  surfaceVersion: string
  revision: number
  supersedesRevision: number | null
  state: "pass" | "fail" | "inconclusive" | "data-unhealthy"
  expectedChallengerProbability: number
  controlManifestId: string
  challengerManifestId: string
  evaluatedAt: Date
  window: Readonly<{ start: Date; end: Date; inputCapturedAt: Date }>
  watermarks: Readonly<{
    assignment: Date | null
    exposure: Date | null
    outcome: Date | null
    mission: Date | null
    eligibility: Date | null
  }>
  versions: Readonly<{
    assignment: string
    outcome: string
    integrity: string
    evaluation: string
  }>
  inputDigest: string
  counts: Readonly<Record<string, number | null>>
  intentToTreat: Readonly<Record<string, unknown>>
  exposedOnly: Readonly<Record<string, unknown>>
  uncertainty: Readonly<Record<string, unknown>>
  guardrails: Readonly<Record<string, unknown>>
  sampleRatio: Readonly<Record<string, unknown>>
  reasonCodes: string[]
  purpose: string
  identityClass: string
  accessClass: string
  deletionBehavior: string
  fallbackBehavior: string
  retentionDays: number
}>

export type RecommendationControlReadinessData = Readonly<{
  state: "ready" | "not-ready" | "inconclusive" | "data-unhealthy"
  revision: number
  evaluatedAt: Date
  window: Readonly<{ start: Date; end: Date; inputCapturedAt: Date }>
  watermarks: Readonly<{
    request: Date | null
    impression: Date | null
    selection: Date | null
    outcome: Date | null
    mission: Date | null
    eligibility: Date | null
  }>
  manifestId: string
  strategyVersion: string
  contractVersion: string
  surfaceVersion: string
  servingControlVersion: number
  policyVersion: string
  outcomePolicyVersion: string
  classifierVersion: string
  integrityPolicyVersion: string
  inputDigest: string
  manifestDigest: string
  dimensions: Readonly<{
    delivery: "pass" | "fail" | "inconclusive" | "unhealthy"
    attribution: "pass" | "fail" | "inconclusive" | "unhealthy"
    maturity: "pass" | "fail" | "inconclusive" | "unhealthy"
    operational: "pass" | "fail" | "inconclusive" | "unhealthy"
    mission: "pass" | "fail" | "inconclusive" | "unhealthy"
    guardrail: "pass" | "fail" | "inconclusive" | "unhealthy"
  }>
  evidence: Readonly<Record<string, number | null>>
  rates: Readonly<Record<string, number | null>>
  uncertainty: Readonly<Record<string, unknown>>
  reasonCodes: string[]
  explanation: string
  purpose: string
  identityClass: string
  accessClass: string
  deletionBehavior: string
  fallbackBehavior: string
  retentionDays: number
  supersedesRevision: number | null
}>

/**
 * Aggregate-only reader. It intentionally never loads a request list or any
 * root identifiers, so an EDITOR cannot receive a trace cursor or link target.
 */
export async function loadRecommendationOverview(
  prisma: PrismaClient,
  input: { window?: string | string[]; now?: Date } = {},
): Promise<RecommendationOverviewData> {
  const now = input.now ?? new Date()
  const window = resolveRecommendationOpsWindow(input.window, now)
  try {
    const [
      rows,
      retention,
      serving,
      privacy,
      controlReadiness,
      experimentEvaluation,
      promotionState,
      profileShadow,
    ] = await Promise.all([
      prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
        WITH active_roots AS (
          SELECT id, state, result, retrieval_latency_ms, created_at
          FROM recommendation_request
          WHERE created_at >= ${window.start}
            AND created_at < ${window.end}
            AND expires_at > ${now}
        ),
        audit_summary AS (
          SELECT
            COALESCE(SUM(audit.count) FILTER (WHERE audit.kind = 'committed_rejection'), 0) AS "committedRejections",
            COALESCE(SUM(audit.count) FILTER (WHERE audit.kind = 'write_failure'), 0) AS "writeFailures",
            COALESCE(SUM(audit.count) FILTER (WHERE audit.kind = 'replay'), 0) AS replays
          FROM recommendation_evidence_audit audit
          JOIN active_roots root ON root.id = audit.request_id
          WHERE audit.expires_at > ${now}
            AND audit.occurred_at >= ${window.start}
            AND audit.occurred_at < ${window.end}
            AND audit.kind IN (
              'committed_rejection',
              'write_failure',
              'replay'
            )
        ),
        success_watermark AS (
          SELECT
            MAX(audit.occurred_at) FILTER (WHERE audit.kind = 'delivery_success') AS "deliverySuccessAt",
            MAX(audit.occurred_at) FILTER (WHERE audit.kind = 'evidence_success') AS "evidenceSuccessAt"
          FROM recommendation_evidence_audit audit
          JOIN recommendation_request root ON root.id = audit.request_id
          WHERE root.expires_at > ${now}
            AND audit.expires_at > ${now}
            AND audit.kind IN ('delivery_success', 'evidence_success')
        ),
        playback_summary AS (
          SELECT
            COUNT(*) FILTER (WHERE fact.kind = 'playback_start') AS "playbackStarts",
            COUNT(*) FILTER (WHERE fact.late = true) AS late
          FROM recommendation_playback_fact fact
          JOIN active_roots root ON root.id = fact.request_id
        ),
        episode_summary AS (
          SELECT
            COUNT(*) FILTER (
              WHERE episode.state IN ('finalized', 'timed_out')
            ) AS "finalizedEpisodes",
            COUNT(*) FILTER (
              WHERE NOT EXISTS (
                  SELECT 1
                  FROM recommendation_outcome_revision outcome
                  WHERE outcome.episode_id = episode.id
                )
                AND (
                  EXISTS (
                    SELECT 1
                    FROM recommendation_playback_fact terminal_fact
                    WHERE terminal_fact.episode_id = episode.id
                      AND terminal_fact.kind IN ('playback_end', 'playback_error')
                  )
                  OR (
                    episode.state IN ('pending', 'claimed')
                    AND episode.active_until <= ${now}
                  )
                )
            ) AS "classifierLag",
            MIN(episode.created_at) FILTER (
              WHERE episode.state IN ('pending', 'claimed')
            ) AS "oldestPendingAt"
          FROM recommendation_playback_episode episode
          JOIN active_roots root ON root.id = episode.request_id
        ),
        selection_summary AS (
          SELECT
            COUNT(*) AS selections,
            COUNT(*) FILTER (
              WHERE NOT EXISTS (
                SELECT 1
                FROM recommendation_impression impression
                WHERE impression.item_id = selection.item_id
              )
            ) AS "selectionWithoutImpression"
          FROM recommendation_selection selection
          JOIN active_roots root ON root.id = selection.request_id
        ),
        latest_outcomes AS (
          SELECT outcome.id, outcome.created_at
          FROM recommendation_outcome_revision outcome
          JOIN active_roots root ON root.id = outcome.request_id
          WHERE NOT EXISTS (
            SELECT 1
            FROM recommendation_outcome_revision successor
            WHERE successor.supersedes_id = outcome.id
          )
        ),
        eligibility_sources AS (
          SELECT
            'playback_outcome:' || outcome.id AS source_key,
            'human_anonymous'::"RecommendationContentActionActorClass" AS actor_class
          FROM latest_outcomes outcome
          UNION ALL
          SELECT
            'content_action:' || action.id AS source_key,
            action.actor_class
          FROM recommendation_content_action action
          WHERE action.occurred_at >= ${window.start}
            AND action.occurred_at < ${window.end}
            AND action.expires_at > ${now}
            AND (
              action.request_id IS NULL
              OR EXISTS (
                SELECT 1 FROM active_roots root WHERE root.id = action.request_id
              )
            )
        ),
        current_eligibility AS (
          SELECT decision.*
          FROM recommendation_eligibility_decision decision
          WHERE decision.is_current = true
            AND decision.policy_version = 'recommendation-integrity-v1'
            AND decision.expires_at > ${now}
        ),
        eligibility_summary AS (
          SELECT
            COUNT(*) FILTER (WHERE decision.id IS NULL) AS pending,
            COUNT(*) FILTER (WHERE decision.state = 'eligible') AS eligible,
            COUNT(*) FILTER (WHERE decision.state = 'excluded') AS excluded,
            COUNT(*) FILTER (WHERE decision.state = 'quarantined') AS quarantined,
            COUNT(*) FILTER (WHERE source.actor_class = 'human_anonymous') AS "humanAnonymous",
            COUNT(*) FILTER (WHERE source.actor_class = 'human_signed_in') AS "humanSignedIn",
            COUNT(*) FILTER (WHERE source.actor_class = 'machine') AS machine,
            COUNT(*) FILTER (WHERE source.actor_class = 'internal') AS internal,
            COUNT(*) FILTER (WHERE source.actor_class = 'test') AS test,
            COUNT(*) FILTER (
              WHERE decision.id IS NOT NULL
                AND (
                  (decision.state = 'eligible' AND (
                    cardinality(decision.eligible_scopes) = 0
                    OR source.actor_class IN ('machine', 'internal', 'test')
                  ))
                  OR (
                    decision.state <> 'eligible'
                    AND cardinality(decision.eligible_scopes) > 0
                  )
                )
            ) AS contamination
          FROM eligibility_sources source
          LEFT JOIN current_eligibility decision
            ON decision.source_key = source.source_key
        ),
        eligibility_reasons AS (
          SELECT COALESCE(jsonb_object_agg(reason_code, reason_count), '{}'::jsonb) AS counts
          FROM (
            SELECT reason_code, COUNT(*) AS reason_count
            FROM eligibility_sources source
            JOIN current_eligibility decision
              ON decision.source_key = source.source_key
            CROSS JOIN LATERAL unnest(decision.reason_codes) reason_code
            GROUP BY reason_code
            ORDER BY reason_count DESC, reason_code ASC
            LIMIT 8
          ) bounded_reasons
        )
        SELECT
          COUNT(*) FILTER (WHERE state = 'prepared') AS "preparedRequests",
          COUNT(*) FILTER (WHERE state = 'issued') AS "issuedRequests",
          COUNT(*) FILTER (WHERE state = 'issuance_failed') AS "issuanceFailedRequests",
          (SELECT COUNT(*) FROM recommendation_served_item item JOIN active_roots root ON root.id = item.request_id) AS "servedItems",
          (SELECT COUNT(*) FROM recommendation_rendered_fact fact JOIN active_roots root ON root.id = fact.request_id) AS "renderedItems",
          (SELECT COUNT(*) FROM recommendation_impression fact JOIN active_roots root ON root.id = fact.request_id) AS impressions,
          (SELECT selections FROM selection_summary) AS selections,
          (SELECT "playbackStarts" FROM playback_summary) AS "playbackStarts",
          (SELECT "finalizedEpisodes" FROM episode_summary) AS "finalizedEpisodes",
          COUNT(*) FILTER (WHERE result = 'fallback') AS "fallbackRequests",
          (SELECT "committedRejections" FROM audit_summary) AS "committedRejections",
          (SELECT "writeFailures" FROM audit_summary) AS "writeFailures",
          (SELECT "committedRejections" + "writeFailures" FROM audit_summary) AS "lossSuspected",
          (SELECT replays FROM audit_summary) AS replays,
          (SELECT COUNT(*) FROM recommendation_conflict conflict JOIN active_roots root ON root.id = conflict.request_id) AS conflicts,
          (SELECT late FROM playback_summary) AS late,
          (SELECT "classifierLag" FROM episode_summary) AS "classifierLag",
          (SELECT "selectionWithoutImpression" FROM selection_summary) AS "selectionWithoutImpression",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY retrieval_latency_ms) FILTER (WHERE retrieval_latency_ms IS NOT NULL) AS "retrievalP50Ms",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY retrieval_latency_ms) FILTER (WHERE retrieval_latency_ms IS NOT NULL) AS "retrievalP95Ms",
          (SELECT "deliverySuccessAt" FROM success_watermark) AS "deliverySuccessAt",
          (SELECT "evidenceSuccessAt" FROM success_watermark) AS "evidenceSuccessAt",
          (SELECT "oldestPendingAt" FROM episode_summary) AS "oldestPendingAt"
          ,(SELECT pending FROM eligibility_summary) AS "eligibilityPending"
          ,(SELECT eligible FROM eligibility_summary) AS "eligibilityEligible"
          ,(SELECT excluded FROM eligibility_summary) AS "eligibilityExcluded"
          ,(SELECT quarantined FROM eligibility_summary) AS "eligibilityQuarantined"
          ,(SELECT "humanAnonymous" FROM eligibility_summary) AS "eligibilityHumanAnonymous"
          ,(SELECT "humanSignedIn" FROM eligibility_summary) AS "eligibilityHumanSignedIn"
          ,(SELECT machine FROM eligibility_summary) AS "eligibilityMachine"
          ,(SELECT internal FROM eligibility_summary) AS "eligibilityInternal"
          ,(SELECT test FROM eligibility_summary) AS "eligibilityTest"
          ,(SELECT contamination FROM eligibility_summary) AS "eligibilityContamination"
          ,(SELECT counts FROM eligibility_reasons) AS "eligibilityReasonCounts"
        FROM active_roots
      `),
      readRecommendationRetentionHealth(prisma, now),
      prisma.recommendationServingControl.findUnique({
        where: { id: RECOMMENDATION_SERVING_CONTROL_ID },
        select: {
          enabled: true,
          reasonCode: true,
          manifest: {
            select: {
              id: true,
              strategyVersion: true,
              contractVersion: true,
              surfaceVersion: true,
              generator: true,
              maxItems: true,
            },
          },
        },
      }),
      loadRecommendationPrivacyHealth(prisma, window),
      prisma.recommendationControlEvaluation.findFirst({
        where: {
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          expiresAt: { gt: now },
        },
        orderBy: [{ evaluatedAt: "desc" }, { revision: "desc" }],
        select: {
          id: true,
          revision: true,
          state: true,
          evaluatedAt: true,
          windowStart: true,
          windowEnd: true,
          inputCapturedAt: true,
          requestWatermark: true,
          impressionWatermark: true,
          selectionWatermark: true,
          outcomeWatermark: true,
          missionWatermark: true,
          eligibilityWatermark: true,
          manifestId: true,
          strategyVersion: true,
          contractVersion: true,
          surfaceVersion: true,
          servingControlVersion: true,
          policyVersion: true,
          outcomePolicyVersion: true,
          classifierVersion: true,
          integrityPolicyVersion: true,
          inputDigest: true,
          manifestDigest: true,
          deliveryOutcome: true,
          attributionOutcome: true,
          maturityOutcome: true,
          operationalOutcome: true,
          missionOutcome: true,
          guardrailOutcome: true,
          evidence: true,
          rates: true,
          uncertainty: true,
          reasonCodes: true,
          explanation: true,
          purpose: true,
          identityClass: true,
          accessClass: true,
          deletionBehavior: true,
          fallbackBehavior: true,
          retentionDays: true,
          supersedes: { select: { revision: true } },
        },
      }),
      prisma.recommendationExperimentEvaluation?.findFirst?.({
        where: {
          experiment: { surfaceVersion: "watch-below-player-v1" },
          expiresAt: { gt: now },
        },
        orderBy: [{ evaluatedAt: "desc" }, { revision: "desc" }],
        select: {
          id: true,
          revision: true,
          state: true,
          evaluatedAt: true,
          windowStart: true,
          windowEnd: true,
          inputCapturedAt: true,
          assignmentWatermark: true,
          exposureWatermark: true,
          outcomeWatermark: true,
          missionWatermark: true,
          eligibilityWatermark: true,
          assignmentPolicyVersion: true,
          outcomePolicyVersion: true,
          integrityPolicyVersion: true,
          evaluationPolicyVersion: true,
          inputDigest: true,
          counts: true,
          intentToTreat: true,
          exposedOnly: true,
          uncertainty: true,
          guardrails: true,
          sampleRatio: true,
          reasonCodes: true,
          purpose: true,
          identityClass: true,
          accessClass: true,
          deletionBehavior: true,
          fallbackBehavior: true,
          retentionDays: true,
          supersedes: { select: { revision: true } },
          experiment: {
            select: {
              id: true,
              experimentVersion: true,
              surfaceVersion: true,
              challengerProbability: true,
              controlManifestId: true,
              challengerManifestId: true,
            },
          },
        },
      }) ?? Promise.resolve(null),
      loadPromotionState(prisma, now),
      loadProfileShadowOverview(prisma, window, now),
    ])
    const row = rows[0]
    if (!row) {
      throw new RecommendationInternalStateError(
        "recommendation_aggregate_row_missing",
      )
    }
    const counts: RecommendationAggregateCounts = {
      preparedRequests: count(row.preparedRequests),
      issuedRequests: count(row.issuedRequests),
      issuanceFailedRequests: count(row.issuanceFailedRequests),
      servedItems: count(row.servedItems),
      renderedItems: count(row.renderedItems),
      impressions: count(row.impressions),
      selections: count(row.selections),
      playbackStarts: count(row.playbackStarts),
      finalizedEpisodes: count(row.finalizedEpisodes),
      fallbackRequests: count(row.fallbackRequests),
      committedRejections: count(row.committedRejections),
      writeFailures: count(row.writeFailures),
      lossSuspected: count(row.lossSuspected),
      replays: count(row.replays),
      conflicts: count(row.conflicts),
      late: count(row.late),
      classifierLag: count(row.classifierLag),
      selectionWithoutImpression: count(row.selectionWithoutImpression),
    }
    const durableSuccessWatermark = latestDate(
      row.deliverySuccessAt,
      row.evidenceSuccessAt,
    )
    const health = classifyRecommendationHealth({
      databaseAvailable: true,
      retentionOverdue: !retention.healthy,
      durableSuccessWatermark,
      requestCount:
        counts.preparedRequests +
        counts.issuedRequests +
        counts.issuanceFailedRequests,
      committedRejectionCount: counts.committedRejections,
      writeFailureCount: counts.writeFailures,
      replayCount: counts.replays,
      conflictCount: counts.conflicts,
      lateCount: counts.late,
      classifierLagCount: counts.classifierLag,
      selectionWithoutImpressionCount: counts.selectionWithoutImpression,
    })
    return {
      window,
      health: { primary: health.primary, states: health.states },
      counts: health.primary === "unavailable_unknown" ? null : counts,
      latency:
        health.primary === "unavailable_unknown"
          ? null
          : {
              p50Ms: finiteNumber(row.retrievalP50Ms),
              p95Ms: finiteNumber(row.retrievalP95Ms),
            },
      watermarks: {
        deliverySuccessAt: row.deliverySuccessAt,
        evidenceSuccessAt: row.evidenceSuccessAt,
        retentionSuccessAt: retention.latestSuccessAt,
        databaseProbeAt: now,
      },
      oldestPendingAt: row.oldestPendingAt,
      eligibility: {
        pending: count(row.eligibilityPending),
        eligible: count(row.eligibilityEligible),
        excluded: count(row.eligibilityExcluded),
        quarantined: count(row.eligibilityQuarantined),
        actorClasses: {
          humanAnonymous: count(row.eligibilityHumanAnonymous),
          humanSignedIn: count(row.eligibilityHumanSignedIn),
          machine: count(row.eligibilityMachine),
          internal: count(row.eligibilityInternal),
          test: count(row.eligibilityTest),
        },
        contamination: count(row.eligibilityContamination),
        reasonCodes: eligibilityReasonCounts(row.eligibilityReasonCounts),
      },
      privacy,
      retention,
      serving,
      controlReadiness: controlReadiness
        ? {
            state: readinessState(controlReadiness.state),
            revision: controlReadiness.revision,
            evaluatedAt: controlReadiness.evaluatedAt,
            window: {
              start: controlReadiness.windowStart,
              end: controlReadiness.windowEnd,
              inputCapturedAt: controlReadiness.inputCapturedAt,
            },
            watermarks: {
              request: controlReadiness.requestWatermark,
              impression: controlReadiness.impressionWatermark,
              selection: controlReadiness.selectionWatermark,
              outcome: controlReadiness.outcomeWatermark,
              mission: controlReadiness.missionWatermark,
              eligibility: controlReadiness.eligibilityWatermark,
            },
            manifestId: controlReadiness.manifestId,
            strategyVersion: controlReadiness.strategyVersion,
            contractVersion: controlReadiness.contractVersion,
            surfaceVersion: controlReadiness.surfaceVersion,
            servingControlVersion: controlReadiness.servingControlVersion,
            policyVersion: controlReadiness.policyVersion,
            outcomePolicyVersion: controlReadiness.outcomePolicyVersion,
            classifierVersion: controlReadiness.classifierVersion,
            integrityPolicyVersion: controlReadiness.integrityPolicyVersion,
            inputDigest: controlReadiness.inputDigest,
            manifestDigest: controlReadiness.manifestDigest,
            dimensions: {
              delivery: dimensionState(controlReadiness.deliveryOutcome),
              attribution: dimensionState(controlReadiness.attributionOutcome),
              maturity: dimensionState(controlReadiness.maturityOutcome),
              operational: dimensionState(controlReadiness.operationalOutcome),
              mission: dimensionState(controlReadiness.missionOutcome),
              guardrail: dimensionState(controlReadiness.guardrailOutcome),
            },
            evidence: numericJsonObject(controlReadiness.evidence),
            rates: numericJsonObject(controlReadiness.rates, true),
            uncertainty: jsonObject(controlReadiness.uncertainty),
            reasonCodes: controlReadiness.reasonCodes,
            explanation: controlReadiness.explanation,
            purpose: controlReadiness.purpose,
            identityClass: controlReadiness.identityClass,
            accessClass: controlReadiness.accessClass,
            deletionBehavior: controlReadiness.deletionBehavior,
            fallbackBehavior: controlReadiness.fallbackBehavior,
            retentionDays: controlReadiness.retentionDays,
            supersedesRevision: controlReadiness.supersedes?.revision ?? null,
          }
        : null,
      experimentEvaluation: experimentEvaluation
        ? {
            id: experimentEvaluation.id,
            experimentId: experimentEvaluation.experiment.id,
            experimentVersion:
              experimentEvaluation.experiment.experimentVersion,
            surfaceVersion: experimentEvaluation.experiment.surfaceVersion,
            revision: experimentEvaluation.revision,
            supersedesRevision:
              experimentEvaluation.supersedes?.revision ?? null,
            state: experimentEvaluationState(experimentEvaluation.state),
            expectedChallengerProbability:
              experimentEvaluation.experiment.challengerProbability,
            controlManifestId:
              experimentEvaluation.experiment.controlManifestId,
            challengerManifestId:
              experimentEvaluation.experiment.challengerManifestId,
            evaluatedAt: experimentEvaluation.evaluatedAt,
            window: {
              start: experimentEvaluation.windowStart,
              end: experimentEvaluation.windowEnd,
              inputCapturedAt: experimentEvaluation.inputCapturedAt,
            },
            watermarks: {
              assignment: experimentEvaluation.assignmentWatermark,
              exposure: experimentEvaluation.exposureWatermark,
              outcome: experimentEvaluation.outcomeWatermark,
              mission: experimentEvaluation.missionWatermark,
              eligibility: experimentEvaluation.eligibilityWatermark,
            },
            versions: {
              assignment: experimentEvaluation.assignmentPolicyVersion,
              outcome: experimentEvaluation.outcomePolicyVersion,
              integrity: experimentEvaluation.integrityPolicyVersion,
              evaluation: experimentEvaluation.evaluationPolicyVersion,
            },
            inputDigest: experimentEvaluation.inputDigest,
            counts: numericJsonObject(experimentEvaluation.counts, true),
            intentToTreat: jsonObject(experimentEvaluation.intentToTreat),
            exposedOnly: jsonObject(experimentEvaluation.exposedOnly),
            uncertainty: jsonObject(experimentEvaluation.uncertainty),
            guardrails: jsonObject(experimentEvaluation.guardrails),
            sampleRatio: jsonObject(experimentEvaluation.sampleRatio),
            reasonCodes: experimentEvaluation.reasonCodes,
            purpose: experimentEvaluation.purpose,
            identityClass: experimentEvaluation.identityClass,
            accessClass: experimentEvaluation.accessClass,
            deletionBehavior: experimentEvaluation.deletionBehavior,
            fallbackBehavior: experimentEvaluation.fallbackBehavior,
            retentionDays: experimentEvaluation.retentionDays,
          }
        : null,
      promotion: promotionState
        ? recommendationPromotionOverview({
            state: promotionState,
            evaluation: experimentEvaluation,
            now,
          })
        : null,
      profileShadow,
    }
  } catch {
    console.warn(
      "recommendation.admin_overview.unavailable reason_code=aggregate_read_failed",
    )
    return {
      window,
      health: {
        primary: "unavailable_unknown",
        states: ["unavailable_unknown"],
      },
      counts: null,
      latency: null,
      watermarks: null,
      oldestPendingAt: null,
      eligibility: null,
      privacy: null,
      retention: null,
      serving: null,
      controlReadiness: null,
      experimentEvaluation: null,
      promotion: null,
      profileShadow: null,
    }
  }
}

function experimentEvaluationState(
  state: string,
): RecommendationExperimentEvaluationData["state"] {
  return state === "DATA_UNHEALTHY"
    ? "data-unhealthy"
    : (state.toLowerCase() as RecommendationExperimentEvaluationData["state"])
}

function readinessState(
  state: string,
): RecommendationControlReadinessData["state"] {
  return state === "NOT_READY"
    ? "not-ready"
    : state === "INCONCLUSIVE"
      ? "inconclusive"
      : state === "DATA_UNHEALTHY"
        ? "data-unhealthy"
        : "ready"
}

function dimensionState(
  state: string,
): RecommendationControlReadinessData["dimensions"]["delivery"] {
  return state === "FAIL"
    ? "fail"
    : state === "INCONCLUSIVE"
      ? "inconclusive"
      : state === "UNHEALTHY"
        ? "unhealthy"
        : "pass"
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function numericJsonObject(
  value: unknown,
  nullable = false,
): Readonly<Record<string, number | null>> {
  const entries: Array<[string, number | null]> = []
  for (const [key, entry] of Object.entries(jsonObject(value))) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      entries.push([key, entry])
    } else if (nullable && entry == null) {
      entries.push([key, null])
    }
  }
  return Object.fromEntries(entries)
}
function latestDate(...values: Array<Date | null>): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest
    return !latest || value > latest ? value : latest
  }, null)
}

function count(value: bigint | number): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}

function eligibilityReasonCounts(
  value: unknown,
): Array<{ reasonCode: string; count: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>)
    .filter(
      ([reasonCode, total]) =>
        /^[a-z0-9][a-z0-9_-]{0,63}$/.test(reasonCode) &&
        typeof total === "number" &&
        Number.isSafeInteger(total) &&
        total >= 0,
    )
    .map(([reasonCode, total]) => ({ reasonCode, count: total as number }))
    .sort(
      (a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode),
    )
    .slice(0, 8)
}
