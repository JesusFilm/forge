import { Prisma, type PrismaClient } from "@prisma/client"
import { parseStudyProtocol, studyMatchesIncumbent } from "./study-protocol"
import {
  INCUMBENT_HYBRID_MANIFEST_ID,
  COWATCH_MMR_GENERATOR_SET_VERSION,
} from "../promotion/manifest"
import {
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
  HYBRID_DETERMINISTIC_RANKER_VERSION,
  HYBRID_SLATE_COMPOSER_VERSION,
  SEMANTIC_CANDIDATE_GENERATOR_VERSION,
  DETERMINISTIC_RANKER_VERSION,
  CANDIDATE_ELIGIBILITY_VERSION,
} from "../candidate"
import { MMR_SLATE_POLICY_VERSION } from "../composition/mmr"
import { ACTIVE_WATCH_PROXY_VERSION } from "../contracts"
import {
  RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD,
  RECOMMENDATION_INTEGRITY_POLICY_VERSION,
} from "../integrity-policy"
import { readRecommendationRetentionHealth } from "../retention.service"
import { VIEWING_MODE_VERSION } from "../viewing-mode"
import {
  PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
  PROFILE_USEFULNESS_OUTCOME_POLICY_VERSION,
} from "./assignment"
import {
  evaluateUsefulnessSnapshot,
  evaluateUsefulnessCalibration,
  type UsefulnessSnapshot,
} from "./usefulness-offline"

type UnitRow = {
  unitDigest: string
  unitKind: string
  arm: "control" | "challenger"
  assignedAt: Date
  qualifiedViews: number
  claimedEpisodes: number
  missingActiveEpisodes: number
  unresolvedEpisodes: number
  conflictingOutcomes: number
  contaminated: boolean
  fenced: boolean
  requestCount: number
  unmatchedExposures: number
}

export type UsefulnessExtractionInput = {
  experimentId: string
  configurationDigest: string
  enrollmentStart: Date
  enrollmentEnd: Date
  plannedAssignmentsPerArm: number
  minimumUsefulDelta: number | null
}

/** Privileged offline reader. No enrollment, approval, or serving mutations. */
export async function extractUsefulnessSnapshot(
  prisma: PrismaClient,
  input: UsefulnessExtractionInput,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      return extractUsefulnessSnapshotInTransaction(tx, input)
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20_000,
      maxWait: 2_000,
    },
  )
}

/** Caller owns isolation and the study source fence when publishing authority. */
export async function extractUsefulnessSnapshotInTransaction(
  tx: Prisma.TransactionClient,
  input: UsefulnessExtractionInput,
) {
  if (
    !/^[a-zA-Z0-9_-]{1,191}$/.test(input.experimentId) ||
    !/^[a-f0-9]{64}$/.test(input.configurationDigest) ||
    !Number.isFinite(input.enrollmentStart.getTime()) ||
    !Number.isFinite(input.enrollmentEnd.getTime()) ||
    input.enrollmentEnd <= input.enrollmentStart ||
    input.enrollmentEnd.getTime() - input.enrollmentStart.getTime() >
      14 * 86_400_000
  ) {
    throw new Error("Invalid usefulness extraction window")
  }
  await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  const [{ capturedAt }] = await tx.$queryRaw<
    Array<{ capturedAt: Date }>
  >`SELECT clock_timestamp() AS "capturedAt"`
  const experiment = await tx.recommendationExperiment.findUnique({
    where: { id: input.experimentId },
    include: { study: true },
  })
  if (
    !experiment ||
    experiment.configurationDigest !== input.configurationDigest ||
    experiment.assignmentPolicyVersion !==
      PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION ||
    experiment.outcomePolicyVersion !==
      PROFILE_USEFULNESS_OUTCOME_POLICY_VERSION ||
    experiment.challengerProbability !== 0.5 ||
    input.enrollmentStart.getTime() !== experiment.startsAt.getTime() ||
    input.enrollmentEnd.getTime() !== experiment.endsAt.getTime()
  ) {
    throw new Error("Usefulness experiment configuration does not match")
  }
  const protocol = experiment.study
    ? parseStudyProtocol(experiment.study.protocol)
    : null
  const expectedManifest = Prisma.sql`CASE WHEN assignment.arm = 'control' THEN ${experiment.controlManifestId} ELSE ${experiment.challengerManifestId} END`
  const incumbentExecution = Prisma.sql`(
    decision.execution_mode IN ('hybrid_personalized', 'viewing_mode_personalized')
    AND (candidate.generator_version = ${HYBRID_CANDIDATE_GENERATOR_SET_VERSION}
      OR (decision.execution_mode = 'viewing_mode_personalized' AND candidate.generator_version = ${SEMANTIC_CANDIDATE_GENERATOR_VERSION}
        AND candidate.ranker_version = 'viewing-mode-affinity-v1'))
    AND candidate.ranker_version IN (${HYBRID_DETERMINISTIC_RANKER_VERSION}, 'viewing-mode-affinity-v1')
    AND candidate.composer_version = ${HYBRID_SLATE_COMPOSER_VERSION}
  )`
  const fallbackExecution = Prisma.sql`(${incumbentExecution} OR (
    decision.execution_mode = 'semantic_fallback'
    AND candidate.generator_version = ${SEMANTIC_CANDIDATE_GENERATOR_VERSION}
    AND candidate.ranker_version = ${DETERMINISTIC_RANKER_VERSION}
    AND candidate.composer_version IN ('minimal-playable-slate-v1', ${HYBRID_SLATE_COMPOSER_VERSION})
  ) OR (
    decision.execution_mode = 'curated_fallback'
    AND candidate.generator_version = 'seeded-curated-empty-fallback-v1'
    AND candidate.ranker_version = ${HYBRID_DETERMINISTIC_RANKER_VERSION}
    AND candidate.composer_version = ${HYBRID_SLATE_COMPOSER_VERSION}
  ))`
  const treatment =
    protocol?.comparison === "incumbent-cowatch-mmr"
      ? Prisma.sql`assignment.arm = 'challenger'`
      : Prisma.sql`false`
  const policyContamination =
    protocol && studyMatchesIncumbent(protocol)
      ? Prisma.sql`NOT COALESCE((
      candidate.eligibility_version = ${CANDIDATE_ELIGIBILITY_VERSION} AND (
        (request.result = 'served' AND decision.effective_manifest_id = ${expectedManifest} AND
          CASE WHEN ${treatment} THEN (
            decision.execution_mode = 'cowatch_mmr_personalized'
            AND candidate.generator_version = ${COWATCH_MMR_GENERATOR_SET_VERSION}
            AND candidate.composer_version = ${MMR_SLATE_POLICY_VERSION}
            AND candidate.ranker_version IN (${HYBRID_DETERMINISTIC_RANKER_VERSION}, 'viewing-mode-affinity-v1')
            AND candidate.evidence_complete
          ) ELSE ${incumbentExecution} END)
        OR (request.result IN ('fallback', 'empty')
          AND decision.effective_manifest_id = ${INCUMBENT_HYBRID_MANIFEST_ID}
          AND decision.reason_code = CASE WHEN ${treatment} THEN 'cowatch_mmr_incumbent_fallback' ELSE 'incumbent_operational_fallback' END
          AND ${fallbackExecution})
      )), false)`
      : Prisma.sql`(decision.effective_manifest_id IS DISTINCT FROM ${expectedManifest}
        OR candidate.ranker_version = 'viewing-mode-affinity-v1'
        OR (${expectedManifest} <> 'semantic-profile-hybrid-v1' AND decision.execution_mode = 'hybrid_personalized'))`
  const rows = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
  WITH assignments AS MATERIALIZED (
    SELECT assignment.*, profile.state AS profile_state,
      profile.privacy_generation AS current_privacy_generation,
      profile.expires_at AS profile_expires_at
    FROM recommendation_experiment_assignment assignment
    LEFT JOIN recommendation_profile profile ON profile.id = assignment.profile_id
    WHERE assignment.experiment_id = ${input.experimentId}
      AND assignment.assigned_at >= ${input.enrollmentStart}
      AND assignment.assigned_at < ${input.enrollmentEnd}
    ORDER BY assignment.assigned_at, assignment.id LIMIT 100001
  )
  SELECT assignment.unit_digest AS "unitDigest", assignment.unit_kind::text AS "unitKind",
    assignment.arm::text AS arm, assignment.assigned_at AS "assignedAt",
    (assignment.state <> 'active' OR assignment.expires_at <= ${capturedAt}
      OR assignment.profile_state IS DISTINCT FROM 'active'
      OR assignment.current_privacy_generation IS DISTINCT FROM assignment.privacy_generation
      OR assignment.profile_expires_at <= ${capturedAt}) AS fenced,
    (assignment.configuration_digest <> ${input.configurationDigest}
      OR assignment.generation <> ${experiment.generation}
      OR assignment.assignment_probability <> 0.5
      OR stats.contaminated > 0) AS contaminated,
    stats."requestCount", stats."unmatchedExposures",
    outcomes."qualifiedViews", outcomes."claimedEpisodes", outcomes."missingActiveEpisodes",
    outcomes."unresolvedEpisodes", outcomes."conflictingOutcomes"
  FROM assignments assignment
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS "requestCount",
      count(*) FILTER (WHERE request.locale <> 'en' OR candidate.id IS NULL OR ${policyContamination})::int AS contaminated,
      (SELECT count(*)::int FROM recommendation_impression impression
        JOIN recommendation_request root ON root.id = impression.request_id
        LEFT JOIN recommendation_experiment_exposure exposure ON exposure.item_id = impression.item_id AND exposure.request_id = impression.request_id
        WHERE root.experiment_assignment_id = assignment.id
          AND root.created_at >= assignment.assigned_at AND root.created_at < assignment.assigned_at + interval '24 hours'
          AND impression.received_at <= ${capturedAt} AND (exposure.id IS NULL OR exposure.arm <> assignment.arm OR exposure.assignment_probability <> 0.5)) AS "unmatchedExposures"
    FROM recommendation_request request
    LEFT JOIN recommendation_personalization_decision decision ON decision.request_id = request.id
    LEFT JOIN recommendation_candidate_run candidate ON candidate.request_id = request.id
    WHERE request.experiment_assignment_id = assignment.id
      AND request.created_at >= assignment.assigned_at AND request.created_at < assignment.assigned_at + interval '24 hours'
  ) stats
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE clean AND attributed AND (
        (outcome.qualified_view AND eligibility.state = 'eligible' AND 'experiment' = ANY(eligibility.eligible_scopes))
        OR mode.sound_off_qualified OR mode.sound_on_qualified))::int AS "qualifiedViews",
      count(*) FILTER (WHERE episode.claimed_at IS NOT NULL)::int AS "claimedEpisodes",
      count(*) FILTER (WHERE episode.claimed_at IS NOT NULL AND COALESCE(outcome.active_coverage, 'missing') = 'missing'
        AND COALESCE(mode.sound_off_milliseconds + mode.sound_on_milliseconds, 0) = 0)::int AS "missingActiveEpisodes",
      count(*) FILTER (WHERE episode.claimed_at IS NOT NULL AND
        (episode.hard_until > ${capturedAt} OR outcome.id IS NULL))::int AS "unresolvedEpisodes",
      count(*) FILTER (WHERE episode.conflict_count > 0)::int AS "conflictingOutcomes"
    FROM recommendation_request request
    JOIN recommendation_playback_episode episode ON episode.request_id = request.id
    JOIN recommendation_selection selection ON selection.id = episode.selection_id
    LEFT JOIN LATERAL (
      SELECT revision.* FROM recommendation_outcome_revision revision
      WHERE revision.episode_id = episode.id AND revision.classifier_version = ${ACTIVE_WATCH_PROXY_VERSION}
        AND revision.created_at <= ${capturedAt} AND revision.expires_at > ${capturedAt}
      ORDER BY revision.revision DESC LIMIT 1
    ) outcome ON true
    LEFT JOIN LATERAL (
      SELECT decision.* FROM recommendation_eligibility_decision decision
      WHERE decision.source_key = 'playback_outcome:' || outcome.id AND decision.decided_at <= ${capturedAt}
        AND decision.policy_version = ${RECOMMENDATION_INTEGRITY_POLICY_VERSION} AND decision.expires_at > ${capturedAt}
      ORDER BY decision.revision DESC LIMIT 1
    ) eligibility ON true
    LEFT JOIN recommendation_viewing_mode_evidence mode ON mode.episode_id = episode.id
      AND mode.profile_id = assignment.profile_id AND mode.privacy_generation = assignment.privacy_generation
      AND mode.policy_version = ${VIEWING_MODE_VERSION} AND mode.expires_at > ${capturedAt}
      AND mode.observed_at <= ${capturedAt}
    CROSS JOIN LATERAL (SELECT
      episode.conflict_count = 0 AND episode.replay_count < ${RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD}
        AND episode.expires_at > ${capturedAt}
        AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact fact WHERE fact.episode_id = episode.id AND (fact.late OR fact.kind = 'playback_error'))
        AND NOT EXISTS (SELECT 1 FROM recommendation_promotion_slate_fence fence WHERE fence.request_id = request.id) AS clean,
      selection.attribution_eligible_at <= ${capturedAt} AS attributed
    ) integrity
    WHERE request.experiment_assignment_id = assignment.id
      AND request.state = 'issued'
      AND request.created_at >= assignment.assigned_at AND request.created_at < assignment.assigned_at + interval '24 hours'
      AND selection.occurred_at >= assignment.assigned_at AND selection.occurred_at < assignment.assigned_at + interval '24 hours'
      AND episode.created_at <= ${capturedAt}
  ) outcomes
`)
  if (
    rows.length > 100_000 ||
    rows.some((row) => row.unitKind !== "anonymous_profile")
  ) {
    throw new Error("Usefulness assignment cohort is oversized or incompatible")
  }
  const sum = (
    key:
      | "qualifiedViews"
      | "claimedEpisodes"
      | "missingActiveEpisodes"
      | "unresolvedEpisodes"
      | "conflictingOutcomes"
      | "requestCount"
      | "unmatchedExposures",
  ) => rows.reduce((total, row) => total + row[key], 0)
  // Freeze passive expiry as well as the source-write epoch. The active-study
  // request path can then use one authority lookup without rescanning a cohort.
  const [sourceHorizon] = await tx.$queryRaw<
    Array<{ expiresAt: Date | null }>
  >(Prisma.sql`
    WITH assigned AS MATERIALIZED (
      SELECT id, profile_id, expires_at FROM recommendation_experiment_assignment
      WHERE experiment_id = ${input.experimentId}
    ), requests AS MATERIALIZED (
      SELECT request.id, request.expires_at FROM recommendation_request request
      JOIN assigned ON assigned.id = request.experiment_assignment_id
    )
    SELECT min(expires_at) AS "expiresAt" FROM (
      SELECT expires_at FROM assigned
      UNION ALL SELECT profile.expires_at FROM recommendation_profile profile JOIN assigned ON assigned.profile_id = profile.id
      UNION ALL SELECT expires_at FROM requests
      UNION ALL SELECT source.expires_at FROM recommendation_playback_episode source JOIN requests ON requests.id = source.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_playback_fact source JOIN requests ON requests.id = source.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_outcome_revision source JOIN requests ON requests.id = source.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_eligibility_decision source JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id JOIN requests ON requests.id = outcome.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_viewing_mode_evidence source JOIN recommendation_playback_episode episode ON episode.id = source.episode_id JOIN requests ON requests.id = episode.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_personalization_decision source JOIN requests ON requests.id = source.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_candidate_run source JOIN requests ON requests.id = source.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_impression source JOIN requests ON requests.id = source.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_selection source JOIN requests ON requests.id = source.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_experiment_exposure source JOIN requests ON requests.id = source.request_id
      UNION ALL SELECT source.expires_at FROM recommendation_promotion_slate_fence source JOIN requests ON requests.id = source.request_id
    ) dependencies
  `)
  const retention = await readRecommendationRetentionHealth(
    tx as unknown as PrismaClient,
    capturedAt,
  )
  const snapshot: UsefulnessSnapshot = {
    schemaVersion: "recommendation-usefulness-offline-v2",
    experimentId: input.experimentId,
    configurationDigest: input.configurationDigest,
    enrollmentStart: input.enrollmentStart.toISOString(),
    enrollmentEnd: input.enrollmentEnd.toISOString(),
    capturedAt: capturedAt.toISOString(),
    plannedAssignmentsPerArm: input.plannedAssignmentsPerArm,
    minimumUsefulDelta: input.minimumUsefulDelta,
    health: {
      assignmentLedgerCount: rows.length,
      claimedEpisodes: sum("claimedEpisodes"),
      missingActiveEpisodes: sum("missingActiveEpisodes"),
      unresolvedEpisodes: sum("unresolvedEpisodes"),
      conflictingOutcomes: sum("conflictingOutcomes"),
      contaminatedAssignments: rows.filter((row) => row.contaminated).length,
      fencedAssignments: rows.filter((row) => row.fenced).length,
      routingVerified:
        sum("requestCount") > 0 && rows.every((row) => !row.contaminated),
      collectionHealthy:
        sum("requestCount") > 0 && sum("unmatchedExposures") === 0,
      retentionHealthy: retention.healthy,
      // The ledger cannot attest to a profile A/A or external HTTP/latency
      // guardrails. Fail closed until separately reviewed evidence is joined.
      aaPassed: false,
      guardrailsPassed: false,
    },
    units: rows.map((row) => ({
      unitDigest: row.unitDigest,
      unitKind: "anonymous_profile",
      arm: row.arm,
      assignedAt: row.assignedAt.toISOString(),
      qualifiedViews: row.fenced || row.contaminated ? 0 : row.qualifiedViews,
    })),
  }
  return {
    snapshot,
    sourceAuthorityExpiresAt: sourceHorizon?.expiresAt ?? capturedAt,
    assessment:
      input.minimumUsefulDelta === null
        ? evaluateUsefulnessCalibration(snapshot)
        : evaluateUsefulnessSnapshot(snapshot),
    externalEvidenceRequired: [
      "profile_unit_aa_with_viewing_mode_v2",
      "http_error_latency_guardrails",
    ],
  }
}
