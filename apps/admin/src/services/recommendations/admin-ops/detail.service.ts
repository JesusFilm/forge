import { Prisma, type PrismaClient } from "@prisma/client"
import { mapRecommendationRequestDetail } from "./detail.mapper"
import type {
  DetailAuditRow,
  DetailCandidateRunRow,
  DetailCandidateStageRow,
  DetailConflictRow,
  DetailContentActionRow,
  DetailControlReadinessRow,
  DetailEpisodeRow,
  DetailFactRow,
  DetailItemRow,
  DetailOutcomeRow,
  DetailPersonalizationRow,
  DetailRootRow,
  DetailShadowNominationRow,
  DetailShadowRunRow,
  RecommendationRequestDetailData,
} from "./detail.types"
import {
  RECOMMENDATION_OPS_DAY_MS,
  RECOMMENDATION_TRACE_ACCESS_REASON,
  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS,
  boundedRecommendationActorDigest,
  boundedRecommendationIdentifier,
} from "./shared"

export type {
  RecommendationEpisodeDetail,
  RecommendationFactMetrics,
  RecommendationRequestDetailData,
} from "./detail.types"

/**
 * Active-root detail plus its access audit share one transaction. Every JSON
 * source is projected to named, bounded scalars by Postgres; arbitrary JSON is
 * never materialized in application memory.
 */
export async function loadRecommendationRequestDetail(
  prisma: PrismaClient,
  input: { requestId: string; actorDigest: string; now?: Date },
): Promise<RecommendationRequestDetailData | null> {
  if (!boundedRecommendationIdentifier.test(input.requestId)) return null
  if (!boundedRecommendationActorDigest.test(input.actorDigest)) return null
  const now = input.now ?? new Date()
  const auditExpiresAt = new Date(
    now.getTime() +
      RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS * RECOMMENDATION_OPS_DAY_MS,
  )
  const data = await prisma.$transaction(
    async (tx) => {
      const roots = await tx.$queryRaw<DetailRootRow[]>(Prisma.sql`
      SELECT
        root.id,
        root.contract_version AS "contractVersion",
        root.surface_version AS "surfaceVersion",
        root.strategy_version AS "strategyVersion",
        root.classifier_version AS "classifierVersion",
        root.seed_media_id AS "seedMediaId",
        root.locale,
        root.expected_item_count AS "expectedItemCount",
        root.state,
        root.result,
        root.fallback_reason AS "fallbackReason",
        root.retrieval_latency_ms AS "retrievalLatencyMs",
        root.response_bytes AS "responseBytes",
        root.created_at AS "createdAt",
        root.issued_at AS "issuedAt",
        manifest.id AS "manifestId",
        manifest.strategy_version AS "manifestStrategyVersion",
        manifest.contract_version AS "manifestContractVersion",
        manifest.surface_version AS "manifestSurfaceVersion",
        manifest.generator AS "manifestGenerator",
        manifest.max_items AS "manifestMaxItems",
        root.experiment_bypass_reason AS "experimentBypassReason",
        assignment.id AS "assignmentId",
        assignment.experiment_id AS "assignmentExperimentId",
        experiment.experiment_version AS "experimentVersion",
        assignment.arm::text AS "assignmentArm",
        assignment.assignment_probability AS "assignmentProbability",
        assignment.configuration_digest AS "assignmentConfigurationDigest",
        assignment.generation AS "assignmentGeneration",
        CASE WHEN assignment.arm = 'challenger'
          THEN experiment.challenger_manifest_id
          ELSE experiment.control_manifest_id
        END AS "effectiveManifestId",
        (SELECT COUNT(*) FROM recommendation_experiment_exposure exposure
          WHERE exposure.request_id = root.id) AS "actualExposureCount"
      FROM recommendation_request root
      JOIN recommendation_strategy_manifest manifest ON manifest.id = root.manifest_id
      LEFT JOIN recommendation_experiment_assignment assignment
        ON assignment.id = root.experiment_assignment_id
      LEFT JOIN recommendation_experiment experiment
        ON experiment.id = assignment.experiment_id
      WHERE root.id = ${input.requestId}
        AND root.expires_at > ${now}
      FOR SHARE OF root
    `)
      const root = roots[0]
      if (!root) return null
      const experimentEvaluation = root.assignmentExperimentId
        ? ((await tx.recommendationExperimentEvaluation?.findFirst?.({
            where: {
              experimentId: root.assignmentExperimentId,
              windowStart: { lte: root.createdAt },
              windowEnd: { gt: root.createdAt },
              expiresAt: { gt: now },
            },
            orderBy: [{ revision: "desc" }, { evaluatedAt: "desc" }],
            select: {
              revision: true,
              state: true,
              inputDigest: true,
              evaluatedAt: true,
            },
          })) ?? null)
        : null

      const candidateRuns = await tx.$queryRaw<DetailCandidateRunRow[]>(
        Prisma.sql`
      SELECT
        run.id,
        run.purpose,
        run.context_version AS "contextVersion",
        run.generator_version AS "generatorVersion",
        run.union_version AS "unionVersion",
        run.eligibility_version AS "eligibilityVersion",
        run.ranker_version AS "rankerVersion",
        run.composer_version AS "composerVersion",
        run.candidate_eligibility_parity AS "candidateEligibilityParity",
        run.ranker_parity AS "rankerParity",
        run.nominated_count AS "nominatedCount",
        run.canonicalized_count AS "canonicalizedCount",
        run.deduplicated_count AS "deduplicatedCount",
        run.rejected_count AS "rejectedCount",
        run.scored_count AS "scoredCount",
        run.ordered_count AS "orderedCount",
        run.requested_count AS "requestedCount",
        run.composed_count AS "composedCount",
        run.shortfall_reason AS "shortfallReason",
        run.evidence_complete AS "evidenceComplete",
        run.fallback_reason AS "fallbackReason"
      FROM recommendation_candidate_run run
      WHERE run.request_id = ${root.id}
        AND run.expires_at > ${now}
      LIMIT 1
    `,
      )
      const candidateRun = candidateRuns[0] ?? null
      const personalizationRows = await tx.$queryRaw<
        DetailPersonalizationRow[]
      >(Prisma.sql`
          SELECT
            decision.lane,
            decision.execution_mode AS "executionMode",
            decision.effective_manifest_id AS "effectiveManifestId",
            decision.reason_code AS "reasonCode",
            decision.projection_scope AS "projectionScope",
            decision.projection_version AS "projectionVersion",
            decision.projection_generation_number AS "projectionGeneration",
            decision.interest_count AS "interestCount",
            decision.session_intent_present AS "sessionIntentPresent",
            decision.profile_retrieval_latency_ms AS "retrievalLatencyMs",
            COALESCE(ARRAY(
              SELECT DISTINCT contribution_request.id
              FROM recommendation_profile_projection_contribution contribution
              JOIN recommendation_outcome_revision source_outcome
                ON source_outcome.id = contribution.source_outcome_id
              JOIN recommendation_request contribution_request
                ON contribution_request.id = source_outcome.request_id
              WHERE contribution.generation_id = decision.projection_generation_id
                AND contribution_request.expires_at > ${now}
              ORDER BY contribution_request.id
              LIMIT 16
            ), ARRAY[]::text[]) AS "feedbackSourceRequestIds"
          FROM recommendation_personalization_decision decision
          WHERE decision.request_id = ${root.id}
            AND decision.expires_at > ${now}
          LIMIT 1
        `)
      const candidateStages = candidateRun
        ? await tx.$queryRaw<DetailCandidateStageRow[]>(Prisma.sql`
          SELECT
            stage.stage,
            stage.ordinal,
            left(stage.candidate_key, 191) AS "candidateKey",
            left(stage.target_media_id, 191) AS "targetMediaId",
            left(stage.source_generator, 64) AS "sourceGenerator",
            stage.source_rank AS "sourceRank",
            stage.source_score AS "sourceScore",
            jsonb_array_length(stage.source_evidence) AS "sourceCount",
            ARRAY(
              SELECT
                left(CASE
                  WHEN jsonb_typeof(source.value -> 'generator') = 'string'
                  THEN source.value ->> 'generator'
                  ELSE 'unknown'
                END, 64)
                || ' · rank '
                || left(COALESCE(source.value ->> 'rank', 'n/a'), 16)
                || ' · score '
                || left(COALESCE(source.value ->> 'score', 'n/a'), 32)
              FROM jsonb_array_elements(stage.source_evidence)
                WITH ORDINALITY source(value, position)
              ORDER BY source.position
              LIMIT 16
            ) AS "sourceSummaries",
            COALESCE((
              SELECT jsonb_agg(contributor.value ORDER BY contributor.position)
              FROM (
                SELECT
                  source.position,
                  jsonb_build_object(
                    'generator', left(source.value ->> 'generator', 64),
                    'generatorVersion', left(source.value ->> 'generatorVersion', 64),
                    'rank', (source.value ->> 'rank')::integer
                  ) AS value
                FROM jsonb_array_elements(stage.source_evidence)
                  WITH ORDINALITY source(value, position)
                WHERE jsonb_typeof(source.value -> 'generator') = 'string'
                  AND length(source.value ->> 'generator') BETWEEN 1 AND 64
                  AND jsonb_typeof(source.value -> 'generatorVersion') = 'string'
                  AND length(source.value ->> 'generatorVersion') BETWEEN 1 AND 64
                  AND (source.value ->> 'rank') ~ '^[0-9]{1,2}$'
                  AND (source.value ->> 'rank')::integer BETWEEN 1 AND 64
                ORDER BY source.position
                LIMIT 16
              ) contributor
            ), '[]'::jsonb) AS contributors,
            stage.normalized_score AS "normalizedScore",
            stage.rrf_score AS "rrfScore",
            stage.deterministic_score AS "deterministicScore",
            stage.final_position AS "finalPosition",
            ARRAY(
              SELECT left(reason, 64)
              FROM unnest(stage.reason_codes) reason
              LIMIT 16
            ) AS "reasonCodes"
          FROM recommendation_candidate_stage_evidence stage
          WHERE stage.run_id = ${candidateRun.id}
            AND stage.expires_at > ${now}
          ORDER BY
            array_position(ARRAY[
              'nominated', 'canonicalized', 'deduplicated', 'rejected',
              'scored', 'ordered', 'composed'
            ]::text[], stage.stage),
            stage.ordinal ASC,
            stage.id ASC
          LIMIT 448
        `)
        : []

      const shadowRuns = await tx.$queryRaw<DetailShadowRunRow[]>(Prisma.sql`
        SELECT
          evaluation.id AS "evaluationId",
          run.id AS "runId",
          left(evaluation.generator_version, 64) AS "generatorVersion",
          evaluation.state::text AS "evaluationState",
          run.state::text AS "runState",
          run.sample_ordinal AS "sampleOrdinal",
          left(evaluation.sampling_version, 64) AS "samplingVersion",
          left(run.context_projection_version, 64) AS "contextVersion",
          left(run.eligibility_version, 64) AS "eligibilityVersion",
          left(run.retention_policy_version, 64) AS "retentionPolicyVersion",
          (run.projection_profile_id IS NOT NULL) AS "usedProfileProjection",
          run.privacy_generation AS "privacyGeneration",
          run.live_slate_unchanged AS "liveSlateUnchanged",
          run.nominated_count AS "nominatedCount",
          run.eligible_count AS "eligibleCount",
          run.rejected_count AS "rejectedCount",
          run.coverage,
          run.overlap,
          run.novelty,
          run.diversity,
          run.rejection,
          run.latency_ms AS "latencyMs",
          run.cohort_quality AS "cohortQuality",
          run.input_freshness_ms AS "inputFreshnessMs",
          run.input_captured_at AS "inputCapturedAt",
          run.finished_at AS "finishedAt",
          decision.decision::text AS decision,
          left(decision.reason_code, 64) AS "decisionReasonCode",
          left(decision.reevaluation_condition, 512) AS "reevaluationCondition",
          decision.decided_at AS "decidedAt"
        FROM recommendation_shadow_run run
        JOIN recommendation_shadow_evaluation evaluation
          ON evaluation.id = run.evaluation_id
        LEFT JOIN recommendation_shadow_decision decision
          ON decision.evaluation_id = evaluation.id
          AND decision.expires_at > ${now}
        WHERE run.request_id = ${root.id}
          AND run.expires_at > ${now}
          AND evaluation.expires_at > ${now}
        ORDER BY evaluation.created_at DESC, run.sample_ordinal ASC, run.id ASC
        LIMIT 16
      `)
      const shadowNominations = shadowRuns.length
        ? await tx.$queryRaw<DetailShadowNominationRow[]>(Prisma.sql`
            SELECT
              nomination.run_id AS "runId",
              nomination.ordinal,
              left(nomination.candidate_key, 191) AS "candidateKey",
              left(nomination.target_media_id, 191) AS "targetMediaId",
              left(nomination.generator, 64) AS generator,
              left(nomination.generator_version, 64) AS "generatorVersion",
              nomination.source_rank AS "sourceRank",
              nomination.source_score AS "sourceScore",
              nomination.eligible,
              ARRAY(
                SELECT left(reason, 64)
                FROM unnest(nomination.reason_codes) reason
                LIMIT 16
              ) AS "reasonCodes",
              nomination.shadow_position AS "shadowPosition",
              nomination.overlaps_live AS "overlapsLive",
              ARRAY(
                SELECT left(entry.key, 64)
                FROM jsonb_each(nomination.provenance) entry
                ORDER BY entry.key
                LIMIT 16
              ) AS "provenanceKeys",
              jsonb_strip_nulls(jsonb_build_object(
                'interestOrdinal', CASE
                  WHEN (nomination.provenance ->> 'interestOrdinal') ~ '^[0-4]$'
                  THEN (nomination.provenance ->> 'interestOrdinal')::integer
                END,
                'interestKind', CASE
                  WHEN nomination.provenance ->> 'interestKind' IN ('durable', 'session')
                  THEN nomination.provenance ->> 'interestKind'
                END,
                'projectionVersion', CASE
                  WHEN jsonb_typeof(nomination.provenance -> 'projectionVersion') = 'string'
                  THEN left(nomination.provenance ->> 'projectionVersion', 64)
                END,
                'manifestId', CASE
                  WHEN jsonb_typeof(nomination.provenance -> 'manifestId') = 'string'
                  THEN left(nomination.provenance ->> 'manifestId', 191)
                END,
                'fallbackReason', CASE
                  WHEN jsonb_typeof(nomination.provenance -> 'fallbackReason') = 'string'
                  THEN left(nomination.provenance ->> 'fallbackReason', 64)
                END
              )) AS provenance
            FROM recommendation_shadow_nomination nomination
            JOIN recommendation_shadow_run run ON run.id = nomination.run_id
            WHERE run.request_id = ${root.id}
              AND nomination.expires_at > ${now}
              AND run.expires_at > ${now}
            ORDER BY nomination.run_id ASC, nomination.ordinal ASC
            LIMIT 1024
          `)
        : []

      const items = await tx.$queryRaw<DetailItemRow[]>(Prisma.sql`
      SELECT
        item.id,
        item.position,
        item.target_media_id AS "targetMediaId",
        item.canonical_href AS "canonicalHref",
        item.candidate_generator AS "candidateGenerator",
        CASE
          WHEN (item.candidate_provenance ->> 'sceneIndex') ~ '^[0-9]{1,9}$'
          THEN (item.candidate_provenance ->> 'sceneIndex')::integer
        END AS "sceneIndex",
        CASE
          WHEN length(item.candidate_provenance ->> 'similarity') <= 32
            AND (item.candidate_provenance ->> 'similarity') ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN CASE
            WHEN (item.candidate_provenance ->> 'similarity')::double precision BETWEEN 0 AND 1
            THEN (item.candidate_provenance ->> 'similarity')::double precision
          END
        END AS similarity,
        CASE WHEN jsonb_typeof(item.presentation -> 'videoTitle') = 'string'
          THEN left(item.presentation ->> 'videoTitle', 200) END AS "videoTitle",
        CASE WHEN jsonb_typeof(item.presentation -> 'audioLanguageSlug') = 'string'
          THEN left(item.presentation ->> 'audioLanguageSlug', 64) END AS "audioLanguageSlug",
        CASE
          WHEN length(item.presentation ->> 'startSeconds') <= 32
            AND (item.presentation ->> 'startSeconds') ~ '^[0-9]+([.][0-9]+)?$'
          THEN CASE
            WHEN (item.presentation ->> 'startSeconds')::double precision BETWEEN 0 AND 86400
            THEN (item.presentation ->> 'startSeconds')::double precision
          END
        END AS "startSeconds",
        CASE
          WHEN length(item.presentation ->> 'endSeconds') <= 32
            AND (item.presentation ->> 'endSeconds') ~ '^[0-9]+([.][0-9]+)?$'
          THEN CASE
            WHEN (item.presentation ->> 'endSeconds')::double precision BETWEEN 0 AND 86400
            THEN (item.presentation ->> 'endSeconds')::double precision
          END
        END AS "endSeconds",
        rendered.id AS "renderedId",
        rendered.occurred_at AS "renderedOccurredAt",
        rendered.received_at AS "renderedReceivedAt",
        impression.id AS "impressionId",
        impression.visibility_policy AS "impressionVisibilityPolicy",
        impression.occurred_at AS "impressionOccurredAt",
        impression.received_at AS "impressionReceivedAt",
        selection.id AS "selectionId",
        selection.occurred_at AS "selectionOccurredAt",
        selection.received_at AS "selectionReceivedAt"
      FROM recommendation_served_item item
      LEFT JOIN recommendation_rendered_fact rendered ON rendered.item_id = item.id
      LEFT JOIN recommendation_impression impression ON impression.item_id = item.id
      LEFT JOIN recommendation_selection selection ON selection.item_id = item.id
      WHERE item.request_id = ${root.id}
      ORDER BY item.position ASC, item.id ASC
    `)
      const episodes = await tx.$queryRaw<DetailEpisodeRow[]>(Prisma.sql`
      SELECT id, item_id AS "itemId", state, media_id AS "mediaId",
        created_at AS "createdAt", claimed_at AS "claimedAt",
        finalized_at AS "finalizedAt", active_until AS "activeUntil"
      FROM recommendation_playback_episode
      WHERE request_id = ${root.id}
      ORDER BY created_at ASC, id ASC
    `)
      const facts = await tx.$queryRaw<DetailFactRow[]>(Prisma.sql`
      SELECT
        fact.id,
        fact.episode_id AS "episodeId",
        fact.sequence,
        fact.kind,
        fact.occurred_at AS "occurredAt",
        fact.received_at AS "receivedAt",
        fact.late,
        CASE WHEN fact.payload ->> 'initiation' IN ('manual', 'automatic')
          THEN fact.payload ->> 'initiation' END AS initiation,
        ${boundedJsonNumber("positionSeconds", 0, 86_400)} AS "positionSeconds",
        ${boundedJsonNumber("fromSeconds", 0, 86_400)} AS "fromSeconds",
        ${boundedJsonNumber("toSeconds", 0, 86_400)} AS "toSeconds",
        ${boundedJsonNumber("durationSeconds", 0, 86_400)} AS "durationSeconds",
        ${boundedJsonNumber("progress", 0, 1)} AS progress,
        ${boundedJsonNumber("wallElapsedMilliseconds", 0, 21_600_000)} AS "wallElapsedMilliseconds",
        ${boundedJsonNumber("activeMilliseconds", 0, 60_000)} AS "activeMilliseconds",
        CASE WHEN fact.payload ->> 'coverage' IN ('complete', 'partial')
          THEN fact.payload ->> 'coverage' END AS coverage,
        CASE WHEN fact.payload ->> 'missingReason' IN (
          'visibility_unavailable',
          'player_state_unavailable'
        ) THEN fact.payload ->> 'missingReason' END AS "missingReason",
        CASE WHEN jsonb_typeof(fact.payload -> 'completed') = 'boolean'
          THEN (fact.payload ->> 'completed')::boolean END AS completed,
        CASE WHEN fact.payload ->> 'reason' IN (
          'ended',
          'route_exit',
          'pagehide',
          'hidden'
        ) THEN fact.payload ->> 'reason' END AS reason,
        CASE
          WHEN (fact.payload ->> 'code') ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
          THEN fact.payload ->> 'code'
        END AS code
      FROM recommendation_playback_fact fact
      WHERE fact.request_id = ${root.id}
      ORDER BY fact.episode_id ASC, fact.sequence ASC, fact.id ASC
    `)
      const outcomes = await tx.$queryRaw<DetailOutcomeRow[]>(Prisma.sql`
      SELECT
        outcome.id,
        outcome.episode_id AS "episodeId",
        outcome.classifier_version AS "classifierVersion",
        outcome.fact_watermark AS "factWatermark",
        outcome.revision,
        supersedes.revision AS "supersedesRevision",
        outcome.qualified_view AS "qualifiedView",
        outcome.view_quality_weight AS "viewQualityWeight",
        outcome.view_quality_weight_reason AS "viewQualityWeightReason",
        outcome.active_playback_milliseconds AS "activePlaybackMilliseconds",
        outcome.duration_seconds AS "durationSeconds",
        outcome.duration_cohort AS "durationCohort",
        outcome.active_coverage AS "activeCoverage",
        COALESCE(
          eligibility.state = 'eligible'
          AND cardinality(eligibility.eligible_scopes) > 0,
          false
        ) AS "learningEligible",
        CASE WHEN eligibility.id IS NULL THEN 'pending'
          ELSE eligibility.state::text END AS "eligibilityState",
        eligibility.policy_version AS "eligibilityPolicyVersion",
        eligibility.revision AS "eligibilityRevision",
        COALESCE(ARRAY(
          SELECT left(reason, 64)
          FROM unnest(eligibility.reason_codes) reason
          LIMIT 16
        ), ARRAY[]::text[]) AS "eligibilityReasonCodes",
        COALESCE(eligibility.eligible_scopes, ARRAY[]::text[]) AS "eligibleScopes",
        eligibility.contribution_weight AS "contributionWeight",
        ARRAY(
          SELECT left(reason, 64)
          FROM unnest(outcome.reasons) reason
          LIMIT 16
        ) AS reasons,
        outcome.created_at AS "createdAt"
      FROM recommendation_outcome_revision outcome
      LEFT JOIN recommendation_outcome_revision supersedes ON supersedes.id = outcome.supersedes_id
      LEFT JOIN recommendation_eligibility_decision eligibility
        ON eligibility.outcome_id = outcome.id
        AND eligibility.is_current = true
        AND eligibility.policy_version = 'recommendation-integrity-v1'
      WHERE outcome.request_id = ${root.id}
      ORDER BY outcome.episode_id ASC, outcome.revision ASC, outcome.id ASC
    `)
      const contentActions = await tx.$queryRaw<DetailContentActionRow[]>(
        Prisma.sql`
      SELECT
        action.id,
        action.item_id AS "itemId",
        action.episode_id AS "episodeId",
        action.action_class AS "actionClass",
        action.action_kind AS "actionKind",
        action.actor_class AS "actorClass",
        action.purpose,
        action.action_detail AS "actionDetail",
        action.target_media_id AS "targetMediaId",
        action.candidate_generator AS "candidateGenerator",
        CASE
          WHEN action.destination_deleted_at IS NOT NULL THEN 'deleted'
          WHEN action.destination_artifact_id IS NOT NULL THEN 'active'
          ELSE 'none'
        END AS "destinationState",
        action.occurred_at AS "occurredAt",
        action.received_at AS "receivedAt",
        action.late,
        COALESCE(
          eligibility.state = 'eligible'
          AND cardinality(eligibility.eligible_scopes) > 0,
          false
        ) AS "learningEligible",
        CASE WHEN eligibility.id IS NULL THEN 'pending'
          ELSE eligibility.state::text END AS "eligibilityState",
        eligibility.policy_version AS "eligibilityPolicyVersion",
        eligibility.revision AS "eligibilityRevision",
        COALESCE(ARRAY(
          SELECT left(reason, 64)
          FROM unnest(eligibility.reason_codes) reason
          LIMIT 16
        ), ARRAY[]::text[]) AS "eligibilityReasonCodes",
        COALESCE(eligibility.eligible_scopes, ARRAY[]::text[]) AS "eligibleScopes",
        eligibility.contribution_weight AS "contributionWeight",
        action.replay_count AS "replayCount",
        action.conflict_count AS "conflictCount"
      FROM recommendation_content_action action
      LEFT JOIN recommendation_eligibility_decision eligibility
        ON eligibility.content_action_id = action.id
        AND eligibility.is_current = true
        AND eligibility.policy_version = 'recommendation-integrity-v1'
      WHERE action.request_id = ${root.id}
      ORDER BY action.received_at ASC, action.id ASC
    `,
      )
      const audits = await tx.$queryRaw<DetailAuditRow[]>(Prisma.sql`
      SELECT id, kind, reason_code AS "reasonCode", count,
        occurred_at AS "occurredAt"
      FROM recommendation_evidence_audit
      WHERE request_id = ${root.id}
      ORDER BY occurred_at ASC, id ASC
    `)
      const conflicts = await tx.$queryRaw<DetailConflictRow[]>(Prisma.sql`
      SELECT id, attempts, first_seen_at AS "firstSeenAt",
        last_seen_at AS "lastSeenAt"
      FROM recommendation_conflict
      WHERE request_id = ${root.id}
      ORDER BY first_seen_at ASC, id ASC
    `)
      const controlReadiness = await tx.$queryRaw<DetailControlReadinessRow[]>(
        Prisma.sql`
      SELECT
        evaluation.revision,
        evaluation.state::text AS state,
        evaluation.policy_version AS "policyVersion",
        evaluation.window_start AS "windowStart",
        evaluation.window_end AS "windowEnd",
        evaluation.evaluated_at AS "evaluatedAt",
        evaluation.explanation
      FROM recommendation_control_evaluation evaluation
      WHERE evaluation.manifest_id = ${root.manifestId}
        AND evaluation.surface_version = ${root.surfaceVersion}
        AND evaluation.window_start <= ${root.createdAt}
        AND evaluation.window_end > ${root.createdAt}
        AND evaluation.expires_at > ${now}
      ORDER BY evaluation.evaluated_at DESC, evaluation.revision DESC
      LIMIT 1
    `,
      )
      await tx.recommendationTraceAccessAudit.create({
        data: {
          requestId: root.id,
          actorDigest: input.actorDigest,
          reasonCode: RECOMMENDATION_TRACE_ACCESS_REASON,
          accessedAt: now,
          expiresAt: auditExpiresAt,
        },
      })
      return {
        root,
        experimentEvaluation,
        personalization: personalizationRows[0] ?? null,
        candidateRun,
        candidateStages,
        shadowRuns,
        shadowNominations,
        items,
        episodes,
        facts,
        outcomes,
        contentActions,
        audits,
        conflicts,
        controlReadiness: controlReadiness[0] ?? null,
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  )
  if (!data) return null
  return mapRecommendationRequestDetail(data)
}

function boundedJsonNumber(key: string, minimum: number, maximum: number) {
  return Prisma.sql`
    CASE
      WHEN length(fact.payload ->> ${key}) <= 32
        AND (fact.payload ->> ${key}) ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN CASE
        WHEN (fact.payload ->> ${key})::double precision BETWEEN ${minimum} AND ${maximum}
        THEN (fact.payload ->> ${key})::double precision
      END
    END
  `
}
